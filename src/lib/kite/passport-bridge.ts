/**
 * Passport rail over HTTP, for runtimes that cannot run the `kpass` CLI.
 *
 * Vercel's serverless functions have no persistent filesystem and no CLI, so a
 * deployment there cannot talk to Kite Passport directly. A long-lived host
 * that *can* (a VPS, a container) runs the same codebase and exposes
 * `POST /api/passport/pay`; the serverless instance forwards to it and keeps
 * the keyless rail instead of falling back to a hot private key.
 *
 * This endpoint spends real money, so it is deliberately narrow:
 *
 *   - a bearer secret is required, compared in constant time;
 *   - the target URL must be an allow-listed merchant host, so a leaked secret
 *     cannot redirect Brokro's allowance to an attacker's endpoint;
 *   - the bridge never returns the allowance credential itself, only the
 *     result of a payment Passport already decided to make.
 *
 * The real ceiling still lives in Kite: even a fully compromised bridge cannot
 * spend beyond the allowance the owner approved with a passkey.
 */

import { timingSafeEqual } from "node:crypto";

export interface BridgePayRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  idempotencyKey?: string;
}

export function getBridgeUrl(): string | undefined {
  const raw = (process.env.BROKR_PASSPORT_BRIDGE_URL || "").trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

export function getBridgeSecret(): string | undefined {
  const raw = (process.env.BROKR_PASSPORT_BRIDGE_SECRET || "").trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Constant-time bearer comparison.
 *
 * `===` on a secret leaks its prefix through timing. Lengths are compared
 * first because `timingSafeEqual` throws on a mismatch, and that throw would
 * itself be a length oracle.
 */
export function bridgeSecretMatches(presented: string | null): boolean {
  const expected = getBridgeSecret();
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Hosts the bridge may be asked to pay.
 *
 * Derived from the merchant registry rather than hand-listed, so a merchant
 * added to the registry is payable and anything else is refused. Extra hosts
 * can be added for self-hosted supply nodes, but the default is closed.
 */
export function getBridgeAllowedHosts(): string[] {
  const extra = (process.env.BROKR_PASSPORT_BRIDGE_EXTRA_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return extra;
}

export function isHostPayable(targetUrl: string, allowedHosts: string[]): boolean {
  let host: string;
  try {
    const parsed = new URL(targetUrl);
    // Only ever pay over TLS: a bridge that will post a payment header to
    // plain HTTP can be downgraded into leaking it.
    if (parsed.protocol !== "https:") return false;
    host = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.includes(host);
}
