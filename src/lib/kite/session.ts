/**
 * Deterministic Kite Agent Passport Session Policy Engine & Nonce Guard.
 *
 * Enforces every spending constraint BEFORE any EIP-3009 authorization is signed:
 *   - `session_expired`: current time >= `expiresAt`
 *   - `session_endpoint_forbidden`: target URL host outside `allowedHosts`
 *   - `session_asset_forbidden`: 402 challenge demands an unapproved token/chain
 *   - `payment_target_forbidden`: zero-address or burn-address payee (`0x000...` / `0xdead...`)
 *   - `session_rule_exceeded`: single 402 challenge exceeds `maxAmountPerTxUsd`
 *   - `session_total_exceeded`: `spentUsd + inFlightUsd + amountUsd` exceeds `maxTotalAmountUsd`
 *   - `payment_nonce_replay_detected`: duplicate EIP-3009 `(payer, nonce)` pair
 *
 * Spend reservations are synchronous in-memory leases so concurrent calls
 * against the same session cannot race past `maxTotalAmountUsd`.
 */

import { randomUUID } from "node:crypto";
import { verifyMessage } from "viem";
import type {
  AuthorizedAsset,
  KiteNetworkId,
  KitePolicyErrorCode,
  SessionMode,
  SessionPolicy,
} from "../types";
import { getSettlementNetwork } from "../x402/settlement-networks";
import { resolveKiteNetwork } from "./networks";

export interface PolicyEvaluation {
  allowed: boolean;
  errorCode?: KitePolicyErrorCode;
  hint?: string;
}

export interface SpendLease {
  leaseId: string;
  amountUsd: number;
  commit: () => void;
  release: () => void;
}

const sessions = new Map<string, SessionPolicy>();
const inFlightBySession = new Map<string, number>();

function roundUsd(val: number): number {
  return Math.round(val * 1_000_000) / 1_000_000;
}

const FORBIDDEN_PAYEES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000042069420694206942069",
]);

export function createSessionPolicy(params: {
  sessionId?: string;
  mode?: SessionMode;
  taskSummary: string;
  ownerAddress: string;
  agentAddress: string;
  network?: KiteNetworkId;
  maxAmountPerTxUsd: number;
  maxTotalAmountUsd: number;
  ttlMinutes?: number;
  allowedHosts: string[];
  /**
   * Set only when the mandate really went through Kite Passport's passkey
   * approval. Defaults to false: asserting an approval that never happened is
   * the one claim a spending-limit product cannot afford to get wrong.
   */
  passkeyVerified?: boolean;
  walletSignature?: string;
  /**
   * Extra CAIP-2 networks this mandate may pay on (e.g. "eip155:8453" to buy
   * from real Base-priced x402 merchants). The home Kite asset is always
   * included; anything not listed here is refused before signing.
   */
  additionalNetworks?: string[];
}): SessionPolicy {
  const net = resolveKiteNetwork(params.network);
  const now = Date.now();
  const ttlMs = Math.max(1, params.ttlMinutes ?? 30) * 60_000;

  if (params.maxAmountPerTxUsd <= 0 || params.maxTotalAmountUsd <= 0) {
    throw new Error("Session spending limits must be positive USD numbers");
  }
  if (params.maxAmountPerTxUsd > params.maxTotalAmountUsd) {
    throw new Error("maxAmountPerTxUsd cannot exceed maxTotalAmountUsd");
  }

  // The home Kite asset is always authorized; extra networks are opt-in per mandate.
  const allowedAssets: AuthorizedAsset[] = [
    {
      caip2Network: net.caip2,
      assetAddress: net.asset.address,
      symbol: net.asset.symbol,
      decimals: net.asset.decimals,
      realValue: net.id === "mainnet",
    },
  ];
  for (const caip2 of params.additionalNetworks ?? []) {
    const extra = getSettlementNetwork(caip2);
    if (!extra) {
      throw new Error(`Unknown settlement network "${caip2}" requested for session`);
    }
    if (allowedAssets.some((a) => a.caip2Network === extra.caip2)) continue;
    allowedAssets.push({
      caip2Network: extra.caip2,
      assetAddress: extra.asset.address,
      symbol: extra.asset.symbol,
      decimals: extra.asset.decimals,
      realValue: extra.realValue,
    });
  }

  const session: SessionPolicy = {
    sessionId: params.sessionId || `ksess_${randomUUID().slice(0, 12)}`,
    mode: params.mode || "delegated",
    taskSummary: params.taskSummary,
    ownerAddress: params.ownerAddress,
    agentAddress: params.agentAddress,
    network: net.id,
    caip2Network: net.caip2,
    assetSymbol: net.asset.symbol,
    assetAddress: net.asset.address,
    allowedAssets,
    maxAmountPerTxUsd: roundUsd(params.maxAmountPerTxUsd),
    maxTotalAmountUsd: roundUsd(params.maxTotalAmountUsd),
    spentUsd: 0,
    txCount: 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    allowedHosts: params.allowedHosts.map((h) => h.toLowerCase()),
    passkeyVerified: params.passkeyVerified ?? false,
    ownerAuthorization: params.passkeyVerified
      ? "kite-passport-passkey"
      : params.walletSignature
        ? "eip191-wallet-signature"
        : "none",
    walletSignature: params.walletSignature,
  };

  sessions.set(session.sessionId, session);
  return session;
}

export function getSessionPolicy(sessionId: string): SessionPolicy | undefined {
  return sessions.get(sessionId);
}

export function buildSessionSignMessage(input: {
  ownerAddress: string;
  agentAddress: string;
  network: KiteNetworkId;
  maxAmountPerTxUsd: number;
  maxTotalAmountUsd: number;
  ttlMinutes: number;
  nonce: string;
  /**
   * Whether this mandate may also pay independent third-party merchants on
   * their own chains. It is part of the signed text because an owner who signs
   * a spending limit has not thereby agreed to spend it with strangers —
   * granting that silently would make the signature attest to less than the
   * session actually permits.
   */
  externalMerchants?: boolean;
  /** Hosts the mandate may pay, when third-party commerce is authorized. */
  externalHosts?: string[];
  /** CAIP-2 networks the mandate may pay on, beyond the home Kite chain. */
  externalNetworks?: string[];
}): string {
  const net = resolveKiteNetwork(input.network);
  const lines = [
    "Brokro — Kite Agent Spending Session Authorization",
    `Owner: ${input.ownerAddress}`,
    `Agent: ${input.agentAddress}`,
    `Network: ${net.caip2} (${net.asset.symbol})`,
    `Max Per Transaction: $${input.maxAmountPerTxUsd.toFixed(4)}`,
    `Max Session Budget: $${input.maxTotalAmountUsd.toFixed(4)}`,
    `TTL: ${input.ttlMinutes} minutes`,
  ];
  if (input.externalMerchants) {
    lines.push(
      `Third-Party Merchants: AUTHORIZED on ${(input.externalNetworks ?? []).join(", ") || "none"}`,
      `Authorized Merchant Hosts: ${(input.externalHosts ?? []).join(", ") || "none"}`,
    );
  } else {
    lines.push("Third-Party Merchants: NOT AUTHORIZED");
  }
  lines.push(`Nonce: ${input.nonce}`);
  return lines.join("\n");
}

export async function verifySessionWalletSignature(params: {
  address: `0x${string}`;
  message: string;
  signature: `0x${string}`;
}): Promise<boolean> {
  try {
    return await verifyMessage({
      address: params.address,
      message: params.message,
      signature: params.signature,
    });
  } catch {
    return false;
  }
}

function normalizeHost(h: string): { host: string; hostname: string } {
  const clean = h.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const [hostname, port] = clean.split(":");
  const normalizedHostname = hostname === "127.0.0.1" ? "localhost" : hostname;
  return {
    host: port ? `${normalizedHostname}:${port}` : normalizedHostname,
    hostname: normalizedHostname,
  };
}

/**
 * Pure policy evaluation for an incoming HTTP 402 payment requirement.
 */
export function evaluatePaymentAgainstSession(
  session: SessionPolicy,
  req: {
    endpointUrl: string;
    amountUsd: number;
    caip2Network: string;
    assetAddress: string;
    payTo: string;
    nowMs?: number;
  },
): PolicyEvaluation {
  const now = req.nowMs ?? Date.now();
  if (now >= Date.parse(session.expiresAt)) {
    return {
      allowed: false,
      errorCode: "session_expired",
      hint: `Session ${session.sessionId} expired at ${session.expiresAt}. Approve a fresh session before retrying.`,
    };
  }

  let parsedHost = "";
  try {
    parsedHost = new URL(req.endpointUrl).host.toLowerCase();
  } catch {
    return {
      allowed: false,
      errorCode: "session_endpoint_forbidden",
      hint: `Malformed target URL "${req.endpointUrl}".`,
    };
  }

  if (session.allowedHosts.length > 0) {
    const target = normalizeHost(parsedHost);
    const isAllowed = session.allowedHosts.some((rawAllowed) => {
      const allowed = normalizeHost(rawAllowed);
      if (target.host === allowed.host) return true;
      if (target.hostname === allowed.hostname) return true;
      if (target.hostname.endsWith(`.${allowed.hostname}`)) return true;
      return false;
    });

    if (!isAllowed) {
      return {
        allowed: false,
        errorCode: "session_endpoint_forbidden",
        hint: `Host "${parsedHost}" is outside session scope [${session.allowedHosts.join(", ")}].`,
      };
    }
  }

  // A challenge must match one of the exact (network, asset) pairs this mandate
  // authorized. Sessions created before multi-asset support fall back to the
  // single home asset rather than silently authorizing everything.
  const authorizedAssets: AuthorizedAsset[] =
    session.allowedAssets && session.allowedAssets.length > 0
      ? session.allowedAssets
      : [
          {
            caip2Network: session.caip2Network,
            assetAddress: session.assetAddress,
            symbol: session.assetSymbol,
            decimals: session.assetSymbol === "pieUSD" ? 18 : 6,
            realValue: session.caip2Network === "eip155:2366",
          },
        ];

  const assetMatch = authorizedAssets.find(
    (a) =>
      a.caip2Network.toLowerCase() === req.caip2Network.trim().toLowerCase() &&
      a.assetAddress.toLowerCase() === req.assetAddress.trim().toLowerCase(),
  );

  if (!assetMatch) {
    return {
      allowed: false,
      errorCode: "session_asset_forbidden",
      hint: `Challenge requested ${req.assetAddress} on ${req.caip2Network}, but this mandate only authorizes ${authorizedAssets
        .map((a) => `${a.symbol} (${a.assetAddress}) on ${a.caip2Network}`)
        .join(" | ")}.`,
    };
  }

  const normalizedPayee = req.payTo.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalizedPayee) || FORBIDDEN_PAYEES.has(normalizedPayee)) {
    return {
      allowed: false,
      errorCode: "payment_target_forbidden",
      hint: `Payee "${req.payTo}" is a burn/zero/invalid address and is blocked by Kite session policy.`,
    };
  }

  if (roundUsd(req.amountUsd) > session.maxAmountPerTxUsd) {
    return {
      allowed: false,
      errorCode: "session_rule_exceeded",
      hint: `Vendor demanded $${req.amountUsd.toFixed(4)}, exceeding session max_amount_per_tx of $${session.maxAmountPerTxUsd.toFixed(4)}. Do not retry against the same session.`,
    };
  }

  const inFlight = inFlightBySession.get(session.sessionId) ?? 0;
  const projected = roundUsd(session.spentUsd + inFlight + req.amountUsd);
  if (projected > session.maxTotalAmountUsd) {
    return {
      allowed: false,
      errorCode: "session_total_exceeded",
      hint: `Cumulative spend ($${projected.toFixed(4)}) would exceed max_total_amount ($${session.maxTotalAmountUsd.toFixed(4)}).`,
    };
  }

  return { allowed: true };
}

/**
 * Atomically checks policy and reserves `amountUsd` on `session` so concurrent
 * calls cannot double-spend the remaining session budget.
 */
export function reserveSessionSpend(
  session: SessionPolicy,
  req: {
    endpointUrl: string;
    amountUsd: number;
    caip2Network: string;
    assetAddress: string;
    payTo: string;
    nowMs?: number;
  },
): { ok: true; lease: SpendLease } | { ok: false; evaluation: PolicyEvaluation } {
  const evaluation = evaluatePaymentAgainstSession(session, req);
  if (!evaluation.allowed) {
    return { ok: false, evaluation };
  }

  const currentInFlight = inFlightBySession.get(session.sessionId) ?? 0;
  const amount = roundUsd(req.amountUsd);
  inFlightBySession.set(session.sessionId, roundUsd(currentInFlight + amount));

  let closed = false;
  const lease: SpendLease = {
    leaseId: randomUUID(),
    amountUsd: amount,
    commit: () => {
      if (closed) return;
      closed = true;
      const inf = inFlightBySession.get(session.sessionId) ?? 0;
      inFlightBySession.set(session.sessionId, Math.max(0, roundUsd(inf - amount)));
      session.spentUsd = roundUsd(session.spentUsd + amount);
      session.txCount += 1;
    },
    release: () => {
      if (closed) return;
      closed = true;
      const inf = inFlightBySession.get(session.sessionId) ?? 0;
      inFlightBySession.set(session.sessionId, Math.max(0, roundUsd(inf - amount)));
    },
  };

  return { ok: true, lease };
}

/**
 * Replay guard modeled on `BrKDDD/kite-x402-hono/src/nonce-guard.ts` so a signed
 * EIP-3009 authorization nonce can never settle twice.
 */
export class PaymentNonceReplayGuard {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  reserve(
    payer: string,
    nonce: string,
  ): { commit: () => void; release: () => void } | null {
    const now = Date.now();
    for (const [k, exp] of this.seen.entries()) {
      if (exp <= now) this.seen.delete(k);
    }
    const key = `${payer.toLowerCase()}:${nonce.toLowerCase()}`;
    if (this.seen.has(key)) {
      return null;
    }
    this.seen.set(key, now + this.ttlMs);
    let committed = false;
    return {
      commit: () => {
        committed = true;
        this.seen.set(key, Date.now() + this.ttlMs);
      },
      release: () => {
        if (!committed) {
          this.seen.delete(key);
        }
      },
    };
  }
}

export const globalNonceGuard = new PaymentNonceReplayGuard();
