/**
 * Kite Agent Passport as a settlement rail.
 *
 * Brokro can pay a merchant two ways, and the difference matters:
 *
 *   - `eip3009-signer`: Brokro holds `BROKR_BUYER_PRIVATE_KEY`, signs an
 *     EIP-3009 authorization itself and posts it to the Pieverse facilitator.
 *     The agent holds a hot mainnet key, and the only thing standing between
 *     that key and the money is Brokro's own policy engine.
 *
 *   - `kite-passport-session`: Brokro holds **no key at all**. It asks the
 *     owner's Passport to pay, and Passport enforces the allowance the owner
 *     approved with a passkey. The limit lives outside the agent, so the agent
 *     cannot widen it — which is the property a spending-limit product is
 *     actually selling.
 *
 * The second rail is strictly better and is preferred wherever it is
 * available. It needs the `kpass` CLI on the host, so a serverless deployment
 * falls back to the signer; `BROKR_SETTLEMENT_RAIL` can pin either explicitly.
 *
 * Response shapes here were read off a live `kpass session execute` against a
 * real merchant, not from documentation: the previous adapter in `kpass.ts`
 * guessed them (`agent:session execute`, a top-level `tx_hash`, no
 * idempotency key) and could never have succeeded.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { getSettlementNetwork } from "../x402/settlement-networks";
import { getBridgeSecret, getBridgeUrl } from "./passport-bridge";

const execFileAsync = promisify(execFile);

export type SettlementRail = "kite-passport-session" | "eip3009-signer";

/** `auto` prefers Passport and falls back to the signer when it is unusable. */
export type RailPreference = "auto" | "passport" | "signer";

export function getRailPreference(): RailPreference {
  const raw = (process.env.BROKR_SETTLEMENT_RAIL || "auto").trim().toLowerCase();
  return raw === "passport" || raw === "signer" ? raw : "auto";
}

/** Published DID of this deployment's buyer agent, for the receipt trail. */
export function getPassportAgentDid(): string | undefined {
  const did = (process.env.BROKR_KITE_AGENT_DID || "").trim();
  return did.length > 0 ? did : undefined;
}

function resolveKpassBinary(): string | null {
  const candidates = [
    process.env.KPASS_BIN,
    join(homedir(), ".local", "bin", "kpass"),
    join(homedir(), ".kpass", "bin", "kpass"),
    "/usr/local/bin/kpass",
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * `kpass agent *` resolves its runtime key from the working directory, while
 * auth lives in the home config. Passing the key path explicitly keeps the two
 * halves together wherever the server happens to be started from.
 */
function runtimeKeyArgs(): string[] {
  const explicit = process.env.KPASS_RUNTIME_KEY_FILE;
  const path = explicit || join(homedir(), ".kite-passport", "runtime.key");
  return existsSync(path) ? ["--key-file", path] : [];
}

async function runKpass(
  args: string[],
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const bin = resolveKpassBinary();
  if (!bin) return null;
  try {
    const { stdout } = await execFileAsync(
      bin,
      [...args, "--output", "json", "--no-interactive"],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (err) {
    // A non-zero exit still prints JSON on stdout for most kpass errors.
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.trim().startsWith("{")) {
      try {
        return JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface PassportAllowance {
  /** Whether an owner-approved allowance is active right now. */
  active: boolean;
  amountUsd?: number;
  spentUsd?: number;
  leftUsd?: number;
  reservedUsd?: number;
  period?: string;
  resetAt?: string;
  allowanceId?: string;
  /** Passport's own phrasing, shown verbatim so we never paraphrase a limit. */
  ownerMessage?: string;
  note: string;
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Reads the live account allowance. This is the spending limit the owner
 * approved with a passkey, enforced by Kite rather than by Brokro, so it is
 * read fresh rather than cached: an owner who lowers it in the Passport
 * dashboard should see Brokro's ceiling drop without a redeploy.
 */
export async function readPassportAllowance(): Promise<PassportAllowance> {
  const out = await runKpass(["allowance", "status"], 8_000);
  if (!out) {
    return { active: false, note: "kpass CLI not available on this host." };
  }
  if (out.status === "error") {
    return {
      active: false,
      note: String(out.error || "Passport allowance unreadable."),
    };
  }
  const active = out.set === true && out.state === "active";
  return {
    active,
    amountUsd: num(out.amount),
    spentUsd: num(out.spent),
    leftUsd: num(out.left),
    reservedUsd: num(out.reserved),
    period: typeof out.period === "string" ? out.period : undefined,
    resetAt: typeof out.reset_at === "string" ? out.reset_at : undefined,
    allowanceId: typeof out.allowance_id === "string" ? out.allowance_id : undefined,
    ownerMessage: typeof out.user_message === "string" ? out.user_message : undefined,
    note: active
      ? "Owner-approved allowance active; Kite enforces the ceiling."
      : "No active account allowance. The owner sets one in their Passport.",
  };
}

export interface PassportIdentity {
  /** Resolvable in Kite's public agent directory. */
  resolved: boolean;
  did?: string;
  agentId?: string;
  name?: string;
  kind?: string;
  verifiedTier?: string;
  /** Signing keys the owner has approved. Zero means it cannot sign yet. */
  activeKeyCount?: number;
  note: string;
}

/**
 * Resolves this agent's public identity from Kite's directory.
 *
 * Deliberately a directory read rather than a local claim: anyone can run the
 * same lookup and get the same answer, which is what makes the identity
 * verifiable instead of self-asserted.
 */
export async function readPassportIdentity(): Promise<PassportIdentity> {
  const did = getPassportAgentDid();
  if (!did) {
    return { resolved: false, note: "No BROKR_KITE_AGENT_DID configured." };
  }
  const out = await runKpass(["agent", "directory", "get", did], 8_000);
  if (!out || out.status === "error") {
    return {
      resolved: false,
      did,
      note: out ? String(out.error || "Directory lookup failed.") : "kpass CLI not available.",
    };
  }

  const keys = await runKpass(["agent", "directory", "keys", did], 8_000);
  const activeKeyCount = keys ? num(keys.active_count) : undefined;

  return {
    resolved: true,
    did: typeof out.did === "string" ? out.did : did,
    agentId: typeof out.id === "string" ? out.id : undefined,
    name: typeof out.name === "string" ? out.name : undefined,
    kind: typeof out.kind === "string" ? out.kind : undefined,
    verifiedTier: typeof out.verified_tier === "string" ? out.verified_tier : undefined,
    activeKeyCount,
    note:
      activeKeyCount && activeKeyCount > 0
        ? "Published in Kite's agent directory with an owner-approved signing key."
        : "Published in Kite's agent directory. No approved signing key yet, so it cannot sign as itself.",
  };
}

/** The spending policy Passport enforced on a payment, as it reported it. */
export interface PassportDelegation {
  currency?: string;
  maxAmountPerTx?: string;
  maxTotalAmount?: string;
  renewalPeriod?: string;
  taskSummary?: string;
}

export interface PassportPaymentResult {
  ok: boolean;
  httpStatus?: number;
  txHash?: string;
  payer?: string;
  caip2Network?: string;
  assetAddress?: string;
  amountAtomic?: string;
  amountUsd?: number;
  body?: Record<string, unknown>;
  delegation?: PassportDelegation;
  allowanceId?: string;
  errorCode?: string;
  errorMessage?: string;
}

function parseBody(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic units to USD, using the known decimals for the settling network. */
function atomicToUsd(amount: unknown, caip2: unknown): number | undefined {
  const atomic = Number(amount);
  if (!Number.isFinite(atomic)) return undefined;
  const net = typeof caip2 === "string" ? getSettlementNetwork(caip2) : undefined;
  const decimals = net?.asset.decimals ?? 6;
  return Math.round((atomic / 10 ** decimals) * 1_000_000) / 1_000_000;
}

/**
 * Buys one resource through the owner's Passport allowance.
 *
 * Brokro never sees a key here. Passport decides whether the call fits the
 * owner's limit, pays if it does, and returns the merchant's response along
 * with the delegation it enforced.
 *
 * `idempotencyKey` is required by the CLI and must be stable per logical
 * purchase: a retried network call must not become a second payment.
 */
export async function payViaPassportSession(params: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  idempotencyKey?: string;
}): Promise<PassportPaymentResult> {
  const bin = resolveKpassBinary();
  if (!bin) {
    // No CLI here: forward to a host that has one rather than reach for a key.
    if (getBridgeUrl() && getBridgeSecret()) return payViaBridge(params);
    return { ok: false, errorMessage: "kpass CLI not installed on this host." };
  }

  const args = [
    "session",
    "execute",
    "--url",
    params.url,
    "--method",
    params.method || "GET",
    "--idempotency-key",
    params.idempotencyKey || `brokro-${randomUUID()}`,
    ...runtimeKeyArgs(),
  ];
  if (params.headers) args.push("--headers", JSON.stringify(params.headers));
  if (params.body) args.push("--body", params.body);

  const out = await runKpass(args, 45_000);
  if (!out) {
    return { ok: false, errorMessage: "kpass session execute produced no parsable output." };
  }
  if (out.status === "error" || out.error) {
    return {
      ok: false,
      errorCode: typeof out.error_code === "string" ? out.error_code : undefined,
      errorMessage: String(out.error || "Passport refused the payment."),
    };
  }

  const payment = (out.payment ?? {}) as Record<string, unknown>;
  const response = (payment.payment_response ?? {}) as Record<string, unknown>;
  const delegationRaw = (out.delegation ?? {}) as Record<string, unknown>;
  const policy = (delegationRaw.payment_policy ?? {}) as Record<string, unknown>;
  const task = (delegationRaw.task ?? {}) as Record<string, unknown>;

  const httpStatus = num(payment.status_code);
  const txHash = typeof response.transaction === "string" && response.transaction.length > 0
    ? response.transaction
    : undefined;

  // Passport reports settlement success separately from the merchant's HTTP
  // status: a 200 with no transaction is not a payment.
  const settled = response.success === true && Boolean(txHash);

  return {
    ok: settled && (httpStatus ?? 0) < 400,
    httpStatus,
    txHash,
    payer: typeof response.payer === "string" ? response.payer : undefined,
    caip2Network:
      typeof response.network === "string"
        ? response.network
        : typeof payment.network === "string"
          ? payment.network
          : undefined,
    assetAddress: typeof payment.asset === "string" ? payment.asset : undefined,
    amountAtomic: typeof payment.amount === "string" ? payment.amount : undefined,
    amountUsd: atomicToUsd(payment.amount, response.network ?? payment.network),
    body: parseBody(payment.response_body),
    allowanceId: typeof out.allowance_id === "string" ? out.allowance_id : undefined,
    delegation: {
      currency: typeof policy.currency === "string" ? policy.currency : undefined,
      maxAmountPerTx:
        typeof policy.max_amount_per_tx === "string" ? policy.max_amount_per_tx : undefined,
      maxTotalAmount:
        typeof policy.max_total_amount === "string" ? policy.max_total_amount : undefined,
      renewalPeriod:
        typeof policy.renewal_period === "string" ? policy.renewal_period : undefined,
      taskSummary: typeof task.summary === "string" ? task.summary : undefined,
    },
    errorMessage: settled
      ? undefined
      : "Passport returned no settlement transaction for this call.",
  };
}

/**
 * Pays through a remote Brokro instance that can run the CLI.
 *
 * Keeps the keyless rail available to a serverless deployment: without this,
 * Vercel would have to fall back to holding a hot private key, which is a
 * strictly worse trust model than forwarding to a host the owner controls.
 */
async function payViaBridge(params: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  idempotencyKey?: string;
}): Promise<PassportPaymentResult> {
  const base = getBridgeUrl();
  const secret = getBridgeSecret();
  if (!base || !secret) {
    return { ok: false, errorMessage: "No Passport bridge configured." };
  }

  try {
    const res = await fetch(`${base}/api/passport/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(60_000),
    });

    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: PassportPaymentResult;
      error?: string;
      message?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        errorCode: payload.error,
        errorMessage: payload.message || `Passport bridge returned HTTP ${res.status}.`,
      };
    }
    if (!payload.result) {
      return { ok: false, errorMessage: "Passport bridge returned no result." };
    }
    return payload.result;
  } catch (err) {
    return {
      ok: false,
      errorMessage: `Passport bridge unreachable: ${(err as Error).message}`,
    };
  }
}

/**
 * Decides which rail a run should use, and says why.
 *
 * The reason travels with the decision because "which key paid for this" is
 * the first thing an auditor asks, and a deployed instance may legitimately
 * answer differently from a laptop.
 */
export async function resolveSettlementRail(): Promise<{
  rail: SettlementRail;
  reason: string;
  allowance?: PassportAllowance;
}> {
  const preference = getRailPreference();

  if (preference === "signer") {
    return {
      rail: "eip3009-signer",
      reason: "BROKR_SETTLEMENT_RAIL=signer pins Brokro's own EIP-3009 signer.",
    };
  }

  if (!resolveKpassBinary()) {
    // A configured bridge keeps the keyless rail available to a runtime that
    // cannot run a CLI, which is the whole point of having one.
    if (getBridgeUrl() && getBridgeSecret()) {
      return {
        rail: "kite-passport-session",
        reason:
          "No local kpass CLI, so payments are forwarded to the configured Passport bridge. Brokro still holds no key.",
      };
    }
    if (preference === "passport") {
      return {
        rail: "eip3009-signer",
        reason:
          "BROKR_SETTLEMENT_RAIL=passport, but there is no kpass CLI and no Passport bridge on this host. Falling back to the signer.",
      };
    }
    return {
      rail: "eip3009-signer",
      reason: "kpass CLI not installed, so Brokro signs EIP-3009 authorizations itself.",
    };
  }

  const allowance = await readPassportAllowance();
  if (!allowance.active) {
    return {
      rail: "eip3009-signer",
      reason: `Passport is installed but has no active allowance (${allowance.note}).`,
      allowance,
    };
  }

  return {
    rail: "kite-passport-session",
    reason: `Paying through the owner's Kite Passport allowance, ${allowance.leftUsd} ${
      allowance.period ?? ""
    } USD remaining. Brokro holds no key on this rail.`.trim(),
    allowance,
  };
}
