/**
 * Real third-party x402 merchant procurement.
 *
 * This is what makes Brokro a clearinghouse rather than a closed loop: the
 * merchants below are **independent businesses** discovered through Kite
 * `ksearch`, not fixtures. Their prices, payees, EIP-712 domains and settlement
 * networks are read from the `PAYMENT-REQUIRED` headers they actually serve —
 * all three price in USDC on Base (`eip155:8453`) at $0.001–$0.002 per call.
 *
 * Every purchase runs through the same Kite Agent Passport session policy that
 * guards Brokro's own supply nodes: an external merchant that spikes its price,
 * swaps its payee, or demands an unauthorized chain is refused before a
 * signature exists. The merchant being real does not buy it any extra trust.
 *
 * Settlement is gated by `BROKR_EXTERNAL_SETTLEMENT` (default `preflight`), so
 * a fresh clone probes real merchants and policy-checks them without ever
 * moving value.
 */

import { randomUUID } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  createX402SignerForChain,
  getBuyerAccount,
  getExternalSettlementMode,
} from "../kite/wallets";
import { payViaPassportSession, resolveSettlementRail } from "../kite/passport";
import { reserveSessionSpend } from "../kite/session";
import type { SessionPolicy, SettlementReceipt } from "../types";
import {
  buildViemChain,
  getSettlementNetwork,
  readSettlementBalance,
  settlementExplorerTxUrl,
  type SettlementNetwork,
} from "../x402/settlement-networks";

export interface ExternalMerchant {
  id: string;
  name: string;
  provider: string;
  /** Independent operator — not affiliated with Brokro. */
  homepage: string;
  wellKnownUrl: string;
  endpoint: string;
  method: "GET";
  category: "market" | "osint" | "registry" | "security";
  /** Price advertised in the merchant's own discovery manifest. */
  advertisedPriceUsd: number;
  description: string;
  /** Top-level JSON keys the merchant documents returning. */
  deliverableFields: string[];
  /** Fills in `{entity}` / `{identifier}` from the active mandate. */
  queryTemplate?: Record<string, string>;
}

export const EXTERNAL_MERCHANTS: ExternalMerchant[] = [
  {
    id: "x-otto-token-security",
    name: "Otto AI · Token Security",
    provider: "Otto AI (independent x402 merchant)",
    homepage: "https://x402.ottoai.services",
    wellKnownUrl: "https://x402.ottoai.services/.well-known/x402",
    endpoint: "https://x402.ottoai.services/token-security",
    method: "GET",
    category: "security",
    advertisedPriceUsd: 0.001,
    description:
      "Third-party token security screen: honeypot, tax, mint authority and liquidity-lock posture for an EVM token address.",
    deliverableFields: ["status", "data", "meta"],
    queryTemplate: { address: "{identifier}" },
  },
  {
    id: "x-otto-token-price",
    name: "Otto AI · DEX Token Price",
    provider: "Otto AI (independent x402 merchant)",
    homepage: "https://x402.ottoai.services",
    wellKnownUrl: "https://x402.ottoai.services/.well-known/x402",
    endpoint: "https://x402.ottoai.services/token-price",
    method: "GET",
    category: "market",
    advertisedPriceUsd: 0.001,
    description:
      "Live DEX price, 24h change, volume, market cap, FDV and liquidity for a ticker or contract address across eight chains.",
    deliverableFields: ["status", "data", "meta"],
    queryTemplate: { token: "{identifier}" },
  },
  {
    id: "x-printmoneylab-kimchi",
    name: "PrintMoneyLab · Kimchi Premium",
    provider: "PrintMoneyLab (independent x402 merchant)",
    homepage: "https://api.printmoneylab.com",
    wellKnownUrl: "https://api.printmoneylab.com/.well-known/x402",
    endpoint: "https://api.printmoneylab.com/api/v1/kimchi-premium",
    method: "GET",
    category: "market",
    advertisedPriceUsd: 0.002,
    description:
      "Korean market dislocation signal: Upbit vs Binance spread via live FX, used as an independent cross-market liquidity check.",
    deliverableFields: [
      "symbol",
      "upbit_krw",
      "binance_usdt",
      "fx_rate",
      "premium_percent",
      "premium_direction",
    ],
    queryTemplate: { symbol: "BTC" },
  },
  {
    id: "x-ip402-geo",
    name: "IP402 · Geolocation & ASN",
    provider: "IP402 (independent x402 merchant)",
    homepage: "https://ip402.xyz",
    wellKnownUrl: "https://ip402.xyz/.well-known/x402",
    endpoint: "https://ip402.xyz/8.8.8.8",
    method: "GET",
    category: "registry",
    advertisedPriceUsd: 0.001,
    description:
      "Normalized IP geolocation and ASN ownership, used to corroborate where a counterparty’s infrastructure actually terminates.",
    deliverableFields: ["ip", "country", "asn", "org"],
  },
];

function buildMerchantUrl(
  merchant: ExternalMerchant,
  mandate: { entity: string; identifier: string },
): string {
  const url = new URL(merchant.endpoint);
  for (const [key, template] of Object.entries(merchant.queryTemplate ?? {})) {
    const value = template
      .replace("{identifier}", mandate.identifier)
      .replace("{entity}", mandate.entity);
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export interface ExternalChallenge {
  merchantId: string;
  reachable: boolean;
  httpStatus: number;
  /** Chosen accept-option that matches an authorized (network, asset) pair. */
  matchedCaip2: string | null;
  matchedAsset: string | null;
  challengedUsd: number | null;
  payTo: string | null;
  /** Every option the merchant offered, for the audit trail. */
  offeredNetworks: string[];
  latencyMs: number;
  note: string;
}

function atomicToUsd(amount: string, decimals: number): number {
  try {
    const n = Number(amount) / 10 ** decimals;
    return Math.round(n * 1_000_000) / 1_000_000;
  } catch {
    return 0;
  }
}

/**
 * Reads a real merchant's live 402 challenge and picks the first accept-option
 * the active mandate actually authorizes. Never signs.
 */
export async function probeExternalMerchant(params: {
  merchant: ExternalMerchant;
  session: SessionPolicy;
  mandate: { entity: string; identifier: string };
  signal?: AbortSignal;
}): Promise<ExternalChallenge> {
  const { merchant, session } = params;
  const started = Date.now();
  const url = buildMerchantUrl(merchant, params.mandate);

  try {
    const res = await fetch(url, {
      method: merchant.method,
      headers: { Accept: "application/json" },
      signal: params.signal ?? AbortSignal.timeout(8_000),
    });

    if (res.status !== 402) {
      return {
        merchantId: merchant.id,
        reachable: true,
        httpStatus: res.status,
        matchedCaip2: null,
        matchedAsset: null,
        challengedUsd: 0,
        payTo: null,
        offeredNetworks: [],
        latencyMs: Date.now() - started,
        note:
          res.status < 400
            ? `Merchant served this resource without a payment challenge (HTTP ${res.status}).`
            : `Merchant returned HTTP ${res.status}; no challenge to evaluate.`,
      };
    }

    const header = res.headers.get("payment-required");
    if (!header) {
      return {
        merchantId: merchant.id,
        reachable: true,
        httpStatus: 402,
        matchedCaip2: null,
        matchedAsset: null,
        challengedUsd: null,
        payTo: null,
        offeredNetworks: [],
        latencyMs: Date.now() - started,
        note: "Merchant returned 402 with no PAYMENT-REQUIRED header.",
      };
    }

    const decoded = decodePaymentRequiredHeader(header);
    const offeredNetworks = decoded.accepts.map((a) => String(a.network));
    const authorized = session.allowedAssets ?? [];

    for (const option of decoded.accepts) {
      const match = authorized.find(
        (a) =>
          a.caip2Network.toLowerCase() === String(option.network).toLowerCase() &&
          a.assetAddress.toLowerCase() === String(option.asset).toLowerCase(),
      );
      if (match) {
        return {
          merchantId: merchant.id,
          reachable: true,
          httpStatus: 402,
          matchedCaip2: match.caip2Network,
          matchedAsset: match.assetAddress,
          challengedUsd: atomicToUsd(String(option.amount), match.decimals),
          payTo: String(option.payTo),
          offeredNetworks,
          latencyMs: Date.now() - started,
          note: `Merchant accepts ${match.symbol} on ${match.caip2Network}, which this mandate authorizes.`,
        };
      }
    }

    return {
      merchantId: merchant.id,
      reachable: true,
      httpStatus: 402,
      matchedCaip2: null,
      matchedAsset: null,
      challengedUsd: null,
      payTo: null,
      offeredNetworks,
      latencyMs: Date.now() - started,
      note: `Merchant offers [${offeredNetworks.join(", ")}], none of which this mandate authorizes.`,
    };
  } catch (err) {
    return {
      merchantId: merchant.id,
      reachable: false,
      httpStatus: 0,
      matchedCaip2: null,
      matchedAsset: null,
      challengedUsd: null,
      payTo: null,
      offeredNetworks: [],
      latencyMs: Date.now() - started,
      note: `Unreachable: ${(err as Error).message}`,
    };
  }
}

interface CachedProbes {
  at: number;
  probes: ExternalChallenge[];
}

let probeCache: CachedProbes | null = null;
const PROBE_CACHE_TTL_MS = 60_000;

/**
 * Live merchant prices for public surfaces (landing page, pricing page),
 * cached briefly so a page view does not hammer third-party merchants.
 */
export async function getLiveExternalPrices(session: SessionPolicy): Promise<ExternalChallenge[]> {
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_TTL_MS) {
    return probeCache.probes;
  }
  const probes = await Promise.all(
    EXTERNAL_MERCHANTS.map((merchant) =>
      probeExternalMerchant({
        merchant,
        session,
        mandate: {
          entity: "gokite.ai / gokite-ai",
          identifier: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
        signal: AbortSignal.timeout(5_000),
      }).catch(
        (): ExternalChallenge => ({
          merchantId: merchant.id,
          reachable: false,
          httpStatus: 0,
          matchedCaip2: null,
          matchedAsset: null,
          challengedUsd: null,
          payTo: null,
          offeredNetworks: [],
          latencyMs: 0,
          note: "probe failed",
        }),
      ),
    ),
  );
  probeCache = { at: Date.now(), probes };
  return probes;
}

/**
 * Hostnames of every independent merchant in the registry.
 *
 * A mandate scopes which hosts it may pay, so authorizing third-party commerce
 * means naming these explicitly — derived from the registry rather than
 * hand-listed so a new merchant cannot be silently unpayable (or, worse,
 * silently payable after the host list drifts).
 */
export const EXTERNAL_MERCHANT_HOSTS: string[] = Array.from(
  new Set(EXTERNAL_MERCHANTS.map((m) => new URL(m.endpoint).host.toLowerCase())),
);

/** CAIP-2 networks these merchants price in, for `additionalNetworks`. */
export const EXTERNAL_MERCHANT_NETWORKS: string[] = ["eip155:8453"];

export function getMerchantById(id: string): ExternalMerchant | undefined {
  return EXTERNAL_MERCHANTS.find((m) => m.id === id);
}

function failedReceipt(params: {
  merchant: ExternalMerchant;
  net: SettlementNetwork | undefined;
  url: string;
  httpStatus: number;
  challengedUsd: number;
  outcome: SettlementReceipt["outcome"];
  policyErrorCode?: SettlementReceipt["policyErrorCode"];
  policyHint: string;
  payTo: string;
  startedAt: number;
}): SettlementReceipt {
  return {
    receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
    vendorId: params.merchant.id,
    vendorName: params.merchant.name,
    endpoint: params.url,
    httpStatus: params.httpStatus,
    advertisedUsd: params.merchant.advertisedPriceUsd,
    challengedUsd: params.challengedUsd,
    settledUsd: 0,
    assetSymbol: params.net?.asset.symbol === "pieUSD" ? "pieUSD" : "USDC.e",
    caip2Network: params.net?.caip2 === "eip155:2366" ? "eip155:2366" : "eip155:2368",
    outcome: params.outcome,
    executionEngine: "pieverse-x402-exact",
    onChain: false,
    payTo: params.payTo,
    policyErrorCode: params.policyErrorCode,
    policyHint: params.policyHint,
    latencyMs: Date.now() - params.startedAt,
    timestamp: new Date().toISOString(),
    externalMerchant: true,
    settlementNetwork: params.net?.caip2,
    settlementAssetSymbol: params.net?.asset.symbol,
  };
}

/**
 * Buys one resource from a real third-party x402 merchant under the active
 * mandate. Policy is evaluated and the spend reserved BEFORE any signature.
 */
export async function procureFromExternalMerchant(params: {
  merchant: ExternalMerchant;
  session: SessionPolicy;
  mandate: { entity: string; identifier: string };
  signal?: AbortSignal;
}): Promise<SettlementReceipt> {
  const { merchant, session } = params;
  const started = Date.now();
  const url = buildMerchantUrl(merchant, params.mandate);
  const mode = getExternalSettlementMode();

  if (mode === "off") {
    return failedReceipt({
      merchant,
      net: undefined,
      url,
      httpStatus: 503,
      challengedUsd: 0,
      outcome: "failed",
      policyHint: "External merchant settlement disabled (BROKR_EXTERNAL_SETTLEMENT=off).",
      payTo: "",
      startedAt: started,
    });
  }

  const challenge = await probeExternalMerchant({ ...params, merchant });

  if (!challenge.reachable) {
    return failedReceipt({
      merchant,
      net: undefined,
      url,
      httpStatus: 0,
      challengedUsd: 0,
      outcome: "failed",
      policyHint: challenge.note,
      payTo: "",
      startedAt: started,
    });
  }

  // Resource served free — record it honestly as a $0 acquisition.
  if (challenge.httpStatus < 400 && challenge.httpStatus !== 402) {
    const body = await fetch(url, { signal: params.signal })
      .then((r) => r.json() as Promise<Record<string, unknown>>)
      .catch(() => ({}));
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: merchant.id,
      vendorName: merchant.name,
      endpoint: url,
      httpStatus: challenge.httpStatus,
      advertisedUsd: merchant.advertisedPriceUsd,
      challengedUsd: 0,
      settledUsd: 0,
      assetSymbol: "USDC.e",
      caip2Network: "eip155:2366",
      outcome: "settled",
      executionEngine: "local-ledger-fallback",
      onChain: false,
      payTo: "",
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      payload: body,
      externalMerchant: true,
      policyHint: "Merchant served this resource without charging.",
    };
  }

  if (!challenge.matchedCaip2 || challenge.challengedUsd === null) {
    return failedReceipt({
      merchant,
      net: undefined,
      url,
      httpStatus: 402,
      challengedUsd: 0,
      outcome: "blocked_policy",
      policyErrorCode: "session_asset_forbidden",
      policyHint: challenge.note,
      payTo: challenge.payTo ?? "",
      startedAt: started,
    });
  }

  const net = getSettlementNetwork(challenge.matchedCaip2);
  if (!net) {
    return failedReceipt({
      merchant,
      net: undefined,
      url,
      httpStatus: 402,
      challengedUsd: challenge.challengedUsd,
      outcome: "failed",
      policyHint: `No signer configured for ${challenge.matchedCaip2}.`,
      payTo: challenge.payTo ?? "",
      startedAt: started,
    });
  }

  // Full mandate check (price cap, budget, payee, host, TTL) + atomic reservation.
  const reservation = reserveSessionSpend(session, {
    endpointUrl: url,
    amountUsd: challenge.challengedUsd,
    caip2Network: challenge.matchedCaip2,
    assetAddress: challenge.matchedAsset!,
    payTo: challenge.payTo!,
  });

  if (!reservation.ok) {
    return failedReceipt({
      merchant,
      net,
      url,
      httpStatus: 402,
      challengedUsd: challenge.challengedUsd,
      outcome: "blocked_policy",
      policyErrorCode: reservation.evaluation.errorCode,
      policyHint: reservation.evaluation.hint ?? "Refused by mandate policy.",
      payTo: challenge.payTo!,
      startedAt: started,
    });
  }

  if (mode === "preflight") {
    reservation.lease.release();
    return failedReceipt({
      merchant,
      net,
      url,
      httpStatus: 402,
      challengedUsd: challenge.challengedUsd,
      outcome: "blocked_policy",
      policyHint: `Mandate authorizes this $${challenge.challengedUsd.toFixed(4)} ${net.asset.symbol} purchase on ${net.caip2}, but BROKR_EXTERNAL_SETTLEMENT=preflight so no signature was produced. Set it to "on" with a funded wallet to settle for real.`,
      payTo: challenge.payTo!,
      startedAt: started,
    });
  }

  // Prefer the keyless rail: if the owner's Passport can pay this under an
  // allowance they approved, Brokro never touches a private key at all.
  const railChoice = await resolveSettlementRail();
  if (railChoice.rail === "kite-passport-session") {
    const paid = await payViaPassportSession({
      url,
      method: merchant.method,
      headers: { Accept: "application/json" },
      // Scoped to the session, not just to (merchant, mandate target). Within
      // one run the key is stable, so a retry cannot buy the same resource
      // twice. Across runs it differs, because each run mints a new session.
      //
      // Keying on the mandate alone made every later purchase of the same
      // resource collide with the first: Kite answered "the earlier attempt
      // with this idempotency key was not charged", and the merchant came back
      // `failed` on every repeat demo.
      idempotencyKey: `brokro-${merchant.id}-${params.session.sessionId ?? params.mandate.identifier}`.slice(
        0,
        120,
      ),
    });

    if (paid.ok) {
      reservation.lease.commit();
      const policy = paid.delegation;
      return {
        receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
        vendorId: merchant.id,
        vendorName: merchant.name,
        endpoint: url,
        httpStatus: paid.httpStatus ?? 200,
        advertisedUsd: merchant.advertisedPriceUsd,
        challengedUsd: challenge.challengedUsd,
        settledUsd: paid.amountUsd ?? challenge.challengedUsd,
        assetSymbol: net.asset.symbol === "pieUSD" ? "pieUSD" : "USDC.e",
        caip2Network: net.caip2 === "eip155:2366" ? "eip155:2366" : "eip155:2368",
        outcome: "settled",
        executionEngine: "pieverse-x402-exact",
        onChain: Boolean(paid.txHash),
        txHash: paid.txHash,
        explorerUrl: paid.txHash ? settlementExplorerTxUrl(net, paid.txHash) : undefined,
        payer: paid.payer,
        payTo: challenge.payTo!,
        latencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        payload: paid.body,
        externalMerchant: true,
        settlementNetwork: paid.caip2Network ?? net.caip2,
        settlementAssetSymbol: net.asset.symbol,
        settlementRail: "kite-passport-session",
        enforcedByOwnerPolicy: policy?.maxAmountPerTx
          ? `Kite Passport allowance: max ${policy.currency ?? "USD"} ${policy.maxAmountPerTx} per payment, ${policy.maxTotalAmount ?? "?"} per ${policy.renewalPeriod ?? "period"}. Brokro holds no key on this rail.`
          : "Kite Passport allowance enforced by Kite.",
      };
    }

    // Passport refused or could not settle. Say so rather than silently
    // falling back to the hot key, which is a different trust model.
    reservation.lease.release();
    return failedReceipt({
      merchant,
      net,
      url,
      httpStatus: paid.httpStatus ?? 402,
      challengedUsd: challenge.challengedUsd,
      outcome: "failed",
      policyHint: `Kite Passport declined: ${paid.errorMessage || paid.errorCode || "no settlement returned"}.`,
      payTo: challenge.payTo!,
      startedAt: started,
    });
  }

  // Signer rail: verify we can actually cover it before signing.
  const buyer = getBuyerAccount();
  const balance = await readSettlementBalance(net, buyer.address);
  if (balance.readable && balance.usd < challenge.challengedUsd) {
    reservation.lease.release();
    return failedReceipt({
      merchant,
      net,
      url,
      httpStatus: 402,
      challengedUsd: challenge.challengedUsd,
      outcome: "failed",
      policyHint: `Buyer holds ${balance.formatted} ${net.asset.symbol} on ${net.name}, short of the $${challenge.challengedUsd.toFixed(4)} challenge. Fund ${buyer.address} to settle.`,
      payTo: challenge.payTo!,
      startedAt: started,
    });
  }

  try {
    const probeRes = await fetch(url, {
      method: merchant.method,
      headers: { Accept: "application/json" },
      signal: params.signal ?? AbortSignal.timeout(8_000),
    });
    const header = probeRes.headers.get("payment-required");
    if (!header) throw new Error("merchant stopped serving a payment challenge");
    const paymentRequired = decodePaymentRequiredHeader(header);

    const signer = createX402SignerForChain({
      chain: buildViemChain(net),
      rpcUrl: net.rpcUrl,
    });
    const coreClient = x402Client.fromConfig({
      schemes: [{ network: net.caip2, client: new ExactEvmScheme(signer, { rpcUrl: net.rpcUrl }) }],
      spendControls: {
        allowedAssets: [
          {
            network: net.caip2,
            asset: net.asset.address,
            maxAmountPerPayment: String(
              Math.round(session.maxAmountPerTxUsd * 10 ** net.asset.decimals),
            ),
          },
        ],
      },
    });
    const httpClient = new x402HTTPClient(coreClient);
    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const sigHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    const authNonce = (paymentPayload.payload as { authorization?: { nonce?: string } })
      ?.authorization?.nonce;

    const paidRes = await fetch(url, {
      method: merchant.method,
      headers: { Accept: "application/json", ...sigHeaders },
      signal: params.signal ?? AbortSignal.timeout(20_000),
    });

    if (!paidRes.ok) {
      reservation.lease.release();
      const errText = await paidRes.text().catch(() => "");
      return failedReceipt({
        merchant,
        net,
        url,
        httpStatus: paidRes.status,
        challengedUsd: challenge.challengedUsd,
        outcome: "failed",
        policyHint: `Merchant returned HTTP ${paidRes.status} after payment: ${errText.slice(0, 160)}`,
        payTo: challenge.payTo!,
        startedAt: started,
      });
    }

    reservation.lease.commit();

    const respHeader = paidRes.headers.get("payment-response");
    const decodedSettle = respHeader ? decodePaymentResponseHeader(respHeader) : undefined;
    const txHash =
      decodedSettle?.transaction && decodedSettle.transaction.length > 0
        ? decodedSettle.transaction
        : undefined;
    const body = (await paidRes.json().catch(() => ({}))) as Record<string, unknown>;

    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: merchant.id,
      vendorName: merchant.name,
      endpoint: url,
      httpStatus: paidRes.status,
      advertisedUsd: merchant.advertisedPriceUsd,
      challengedUsd: challenge.challengedUsd,
      settledUsd: challenge.challengedUsd,
      assetSymbol: net.asset.symbol === "pieUSD" ? "pieUSD" : "USDC.e",
      caip2Network: net.caip2 === "eip155:2366" ? "eip155:2366" : "eip155:2368",
      outcome: "settled",
      executionEngine: "pieverse-x402-exact",
      onChain: Boolean(txHash),
      txHash,
      explorerUrl: txHash ? settlementExplorerTxUrl(net, txHash) : undefined,
      payer: decodedSettle?.payer || buyer.address,
      payTo: challenge.payTo!,
      nonce: authNonce,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      payload: body,
      externalMerchant: true,
      settlementNetwork: net.caip2,
      settlementAssetSymbol: net.asset.symbol,
      settlementRail: "eip3009-signer",
      enforcedByOwnerPolicy: `Brokro's own session policy: max $${session.maxAmountPerTxUsd} per payment, $${session.maxTotalAmountUsd} per session. Signed with Brokro's key.`,
    };
  } catch (err) {
    reservation.lease.release();
    return failedReceipt({
      merchant,
      net,
      url,
      httpStatus: 500,
      challengedUsd: challenge.challengedUsd,
      outcome: "failed",
      policyHint: (err as Error).message,
      payTo: challenge.payTo!,
      startedAt: started,
    });
  }
}
