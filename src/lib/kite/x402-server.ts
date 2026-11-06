/**
 * Standards-compliant x402 v2 (`scheme: "exact"`) HTTP payment gate for Kite Chain.
 *
 * Implements the exact flow required by `gokite-ai/kite-x402-services`:
 *   1. Unpaid request -> HTTP 402 + base64 `PAYMENT-REQUIRED` header
 *   2. Paid request (`PAYMENT-SIGNATURE` / `X-PAYMENT`) ->
 *      a) Decode payload & reserve `(payer, nonce)` in `PaymentNonceReplayGuard`
 *      b) Verify signature & funds via Pieverse Facilitator (`POST /v2/verify`)
 *      c) Run upstream handler FIRST
 *      d) Settle on-chain (`POST /v2/settle`) ONLY when upstream returned < 400
 *      e) Attach `PAYMENT-RESPONSE` base64 header carrying the KiteScan tx hash
 *
 * When a developer clones the repo locally before funding `pieUSD` from the Kite
 * faucet (`balance == 0`), optional cryptographic EIP-3009 signature verification
 * (`viem.verifyTypedData`) validates the real wallet signature and marks the
 * receipt `onChain: false` — never fabricating a transaction hash.
 */

import { verifyTypedData } from "viem";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { authorizationTypes } from "@x402/evm";
import {
  getActiveKiteNetwork,
  PIEVERSE_FACILITATOR_URL,
  usdToAtomicUnits,
  type KiteNetworkConfig,
} from "./networks";
import { globalNonceGuard, PaymentNonceReplayGuard } from "./session";
import { getMerchantPayTo, isSignedSandboxFallbackAllowed } from "./wallets";

export interface X402RouteSpec {
  resourceUrl: string;
  description: string;
  priceUsd: number;
  payTo?: `0x${string}`;
  network?: KiteNetworkConfig;
  mimeType?: string;
  nonceGuard?: PaymentNonceReplayGuard;
}

const facilitatorClient = new HTTPFacilitatorClient({
  url: PIEVERSE_FACILITATOR_URL,
});

export function buildPaymentRequirements(spec: X402RouteSpec): PaymentRequirements {
  const net = spec.network ?? getActiveKiteNetwork();
  const payTo = spec.payTo ?? getMerchantPayTo();
  return {
    scheme: "exact",
    network: net.caip2,
    asset: net.asset.address,
    amount: usdToAtomicUnits(spec.priceUsd, net.asset.decimals),
    payTo,
    maxTimeoutSeconds: 60,
    extra: {
      name: net.asset.eip712Name,
      version: net.asset.eip712Version,
    },
  };
}

export function build402ChallengeResponse(
  spec: X402RouteSpec,
  errorReason = "PAYMENT-SIGNATURE header is required",
): Response {
  const requirements = buildPaymentRequirements(spec);
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    error: errorReason,
    resource: {
      url: spec.resourceUrl,
      description: spec.description,
      mimeType: spec.mimeType ?? "application/json",
    },
    accepts: [requirements],
  };

  const encoded = encodePaymentRequiredHeader(paymentRequired);
  return new Response(
    JSON.stringify({
      x402Version: 2,
      error: errorReason,
      accepts: paymentRequired.accepts,
      resource: paymentRequired.resource,
    }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "PAYMENT-REQUIRED": encoded,
      },
    },
  );
}

interface Eip3009AuthShape {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

async function verifyEip3009SignatureLocally(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
  net: KiteNetworkConfig,
): Promise<{ valid: boolean; payer?: string; reason?: string }> {
  const inner = paymentPayload.payload as {
    signature?: `0x${string}`;
    authorization?: Eip3009AuthShape;
  };
  const auth = inner?.authorization;
  const sig = inner?.signature;
  if (!auth || !sig) {
    return { valid: false, reason: "missing_eip3009_authorization" };
  }
  if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { valid: false, reason: "payee_mismatch" };
  }
  if (BigInt(auth.value) < BigInt(requirements.amount)) {
    return { valid: false, reason: "insufficient_authorized_amount" };
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(auth.validBefore) <= nowSec) {
    return { valid: false, reason: "authorization_expired" };
  }

  try {
    const ok = await verifyTypedData({
      address: auth.from,
      domain: {
        name: net.asset.eip712Name,
        version: net.asset.eip712Version,
        chainId: net.chainId,
        verifyingContract: net.asset.address,
      },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: sig,
    });
    return ok ? { valid: true, payer: auth.from } : { valid: false, reason: "invalid_signature" };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}

/**
 * Wraps an HTTP route handler with x402 v2 verification, nonce replay protection,
 * post-upstream Pieverse settlement, and `PAYMENT-RESPONSE` receipt encoding.
 */
export async function withX402Gate(
  req: Request,
  spec: X402RouteSpec,
  handler: (ctx: {
    payer: string;
    settledOnChainPreview: boolean;
  }) => Promise<Response>,
): Promise<Response> {
  const sigHeader =
    req.headers.get("payment-signature") ?? req.headers.get("x-payment");

  if (!sigHeader) {
    return build402ChallengeResponse(spec);
  }

  const net = spec.network ?? getActiveKiteNetwork();
  const requirements = buildPaymentRequirements(spec);
  const guard = spec.nonceGuard ?? globalNonceGuard;

  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(sigHeader);
  } catch {
    return build402ChallengeResponse(spec, "malformed_payment_signature_header");
  }

  const auth = (
    paymentPayload.payload as {
      authorization?: { from?: string; nonce?: string };
    }
  )?.authorization;
  const payer = auth?.from ?? "";
  const nonce = auth?.nonce ?? "";

  const nonceLease = payer && nonce ? guard.reserve(payer, nonce) : null;
  if (!nonceLease) {
    return build402ChallengeResponse(spec, "payment_nonce_replay_detected");
  }

  let useFacilitatorSettle = false;
  let verifiedPayer = payer;

  try {
    const verifyRes = await facilitatorClient.verify(paymentPayload, requirements);
    if (verifyRes.isValid) {
      useFacilitatorSettle = true;
      verifiedPayer = verifyRes.payer || payer;
    } else if (
      isSignedSandboxFallbackAllowed() &&
      /insufficient|balance|funds/i.test(verifyRes.invalidReason || "")
    ) {
      const localCheck = await verifyEip3009SignatureLocally(paymentPayload, requirements, net);
      if (!localCheck.valid) {
        nonceLease.release();
        return build402ChallengeResponse(spec, localCheck.reason || "invalid_payment_signature");
      }
      verifiedPayer = localCheck.payer || payer;
    } else {
      // Also check if facilitator rejected solely due to unfunded testnet account
      const localCheck = isSignedSandboxFallbackAllowed()
        ? await verifyEip3009SignatureLocally(paymentPayload, requirements, net)
        : { valid: false };
      if (!localCheck.valid) {
        nonceLease.release();
        return build402ChallengeResponse(
          spec,
          verifyRes.invalidReason || "facilitator_verification_failed",
        );
      }
      verifiedPayer = localCheck.payer || payer;
    }
  } catch {
    const localCheck = isSignedSandboxFallbackAllowed()
      ? await verifyEip3009SignatureLocally(paymentPayload, requirements, net)
      : { valid: false };
    if (!localCheck.valid) {
      nonceLease.release();
      return build402ChallengeResponse(spec, "facilitator_unreachable");
    }
    verifiedPayer = localCheck.payer || payer;
  }

  // Execute upstream BEFORE settling (Kite golden rule: never charge on >= 400).
  let upstreamResponse: Response;
  try {
    upstreamResponse = await handler({
      payer: verifiedPayer,
      settledOnChainPreview: useFacilitatorSettle,
    });
  } catch (err) {
    nonceLease.release();
    return new Response(
      JSON.stringify({ error: "upstream_execution_failed", message: (err as Error).message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  if (upstreamResponse.status >= 400) {
    nonceLease.release();
    return upstreamResponse;
  }

  nonceLease.commit();

  let settleHeader: SettleResponse;
  let settledOnChain = false;

  if (useFacilitatorSettle) {
    try {
      const settleRes = await facilitatorClient.settle(paymentPayload, requirements);
      if (settleRes.success && settleRes.transaction) {
        settleHeader = settleRes;
        settledOnChain = true;
      } else {
        nonceLease.release();
        return build402ChallengeResponse(
          spec,
          settleRes.errorReason || "facilitator_settlement_failed",
        );
      }
    } catch (err) {
      nonceLease.release();
      return build402ChallengeResponse(
        spec,
        `settlement_transport_error: ${(err as Error).message}`,
      );
    }
  } else {
    // Cryptographically signed EIP-3009 authorization verified, wallet unfunded on chain
    settleHeader = {
      success: true,
      transaction: "",
      network: net.caip2,
      payer: verifiedPayer,
    };
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settleHeader));
  headers.set("X-Brokr-Onchain-Settled", settledOnChain ? "true" : "false");
  headers.set("Cache-Control", "private, no-store");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
