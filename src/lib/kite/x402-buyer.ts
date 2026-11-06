/**
 * Autonomous Kite x402 Buyer Runtime.
 *
 * Performs the full HTTP 402 handshake under a deterministic `SessionPolicy`:
 *   1. Requests the target endpoint without credentials.
 *   2. Parses the HTTP 402 `PAYMENT-REQUIRED` header (`@x402/core/http`).
 *   3. Evaluates & atomically reserves the challenged amount in `session.ts`
 *      BEFORE signing anything — immediately catching bait-and-switch price
 *      spikes (`session_rule_exceeded`), budget overruns (`session_total_exceeded`),
 *      forbidden hosts (`session_endpoint_forbidden`), or burn payees.
 *   4. Signs the EIP-3009 `TransferWithAuthorization` payload via `@x402/evm`
 *      (`ExactEvmScheme` + `x402HTTPClient`) — or routes through `kpass` CLI
 *      when `session.mode === "kpass"` — and retries with `PAYMENT-SIGNATURE`.
 *   5. Decodes `PAYMENT-RESPONSE` and records the KiteScan tx hash.
 */

import { randomUUID } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { SessionPolicy, SettlementReceipt, VendorManifest } from "../types";
import { executePaidRequestViaKpass } from "./kpass";
import { atomicUnitsToUsd, explorerTxUrl, resolveKiteNetwork, usdToAtomicUnits } from "./networks";
import { reserveSessionSpend } from "./session";
import { createKiteX402Signer, getBuyerAccount, isPaymentsEnabled } from "./wallets";

export async function procureFromX402Vendor(params: {
  vendor: VendorManifest;
  session: SessionPolicy;
  queryParams?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<SettlementReceipt> {
  const { vendor, session } = params;
  const started = Date.now();
  const net = resolveKiteNetwork(session.network);

  if (!isPaymentsEnabled()) {
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: vendor.endpoint,
      httpStatus: 503,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd: 0,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "failed",
      executionEngine: "local-ledger-fallback",
      onChain: false,
      payTo: vendor.payTo,
      policyHint: "BROKR_PAYMENTS is switched off by operator kill-switch.",
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  const targetUrl = new URL(vendor.endpoint);
  if (params.queryParams) {
    for (const [k, v] of Object.entries(params.queryParams)) {
      targetUrl.searchParams.set(k, v);
    }
  }
  const urlString = targetUrl.toString();

  // Optional direct `kpass` CLI execution path when user runs an active kpass session
  if (session.mode === "kpass") {
    const preCheck = reserveSessionSpend(session, {
      endpointUrl: urlString,
      amountUsd: vendor.advertisedPriceUsd,
      caip2Network: net.caip2,
      assetAddress: net.asset.address,
      payTo: vendor.payTo,
    });
    if (!preCheck.ok) {
      return {
        receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
        vendorId: vendor.id,
        vendorName: vendor.name,
        endpoint: urlString,
        httpStatus: 402,
        advertisedUsd: vendor.advertisedPriceUsd,
        challengedUsd: vendor.advertisedPriceUsd,
        settledUsd: 0,
        assetSymbol: net.asset.symbol,
        caip2Network: net.caip2,
        outcome: "blocked_policy",
        executionEngine: "kpass-cli",
        onChain: false,
        payTo: vendor.payTo,
        policyErrorCode: preCheck.evaluation.errorCode,
        policyHint: preCheck.evaluation.hint,
        latencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    }

    const kpassRes = await executePaidRequestViaKpass({ url: urlString, method: "GET" });
    if (kpassRes.ok) {
      preCheck.lease.commit();
      return {
        receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
        vendorId: vendor.id,
        vendorName: vendor.name,
        endpoint: urlString,
        httpStatus: kpassRes.status ?? 200,
        advertisedUsd: vendor.advertisedPriceUsd,
        challengedUsd: vendor.advertisedPriceUsd,
        settledUsd: vendor.advertisedPriceUsd,
        assetSymbol: net.asset.symbol,
        caip2Network: net.caip2,
        outcome: "settled",
        executionEngine: "kpass-cli",
        onChain: Boolean(kpassRes.txHash),
        txHash: kpassRes.txHash,
        explorerUrl: kpassRes.txHash ? explorerTxUrl(net, kpassRes.txHash) : undefined,
        payer: session.agentAddress,
        payTo: vendor.payTo,
        latencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        payload: kpassRes.data,
      };
    }
    preCheck.lease.release();
  }

  // Step 1: Probe endpoint to receive the cryptographic HTTP 402 challenge
  const probeRes = await fetch(urlString, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: params.signal,
  });

  if (probeRes.status !== 402) {
    const freeBody = (await probeRes.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: probeRes.status,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd: 0,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: probeRes.ok ? "settled" : "failed",
      executionEngine: "pieverse-x402-exact",
      onChain: false,
      payTo: vendor.payTo,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      payload: freeBody,
    };
  }

  const paymentReqHeader = probeRes.headers.get("payment-required");
  if (!paymentReqHeader) {
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: 402,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd: 0,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "failed",
      executionEngine: "pieverse-x402-exact",
      onChain: false,
      payTo: vendor.payTo,
      policyHint: "Vendor returned HTTP 402 without a PAYMENT-REQUIRED header.",
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  const paymentRequired = decodePaymentRequiredHeader(paymentReqHeader);
  const option = paymentRequired.accepts[0];
  if (!option) {
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: 402,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd: 0,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "failed",
      executionEngine: "pieverse-x402-exact",
      onChain: false,
      payTo: vendor.payTo,
      policyHint: "402 challenge contained no accepted payment options.",
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  const challengedUsd = atomicUnitsToUsd(option.amount, net.asset.decimals);

  // Step 2: Deterministic Kite Passport session policy check + atomic budget lease
  const reservation = reserveSessionSpend(session, {
    endpointUrl: urlString,
    amountUsd: challengedUsd,
    caip2Network: option.network,
    assetAddress: option.asset,
    payTo: option.payTo,
  });

  if (!reservation.ok) {
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: 402,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "blocked_policy",
      executionEngine: "pieverse-x402-exact",
      onChain: false,
      payTo: option.payTo,
      policyErrorCode: reservation.evaluation.errorCode,
      policyHint: reservation.evaluation.hint,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  // Step 3: Sign EIP-3009 TransferWithAuthorization via @x402/evm & retry request
  try {
    const signer = createKiteX402Signer(net);
    const coreClient = x402Client.fromConfig({
      schemes: [
        {
          network: net.caip2,
          client: new ExactEvmScheme(signer, { rpcUrl: net.rpcUrl }),
        },
      ],
      spendControls: {
        allowedAssets: [
          {
            network: net.caip2,
            asset: net.asset.address,
            maxAmountPerPayment: usdToAtomicUnits(
              session.maxAmountPerTxUsd,
              net.asset.decimals,
            ),
          },
        ],
      },
    });
    const httpClient = new x402HTTPClient(coreClient);

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const sigHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    const authNonce = (
      paymentPayload.payload as { authorization?: { nonce?: string } }
    )?.authorization?.nonce;

    const paidRes = await fetch(urlString, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": randomUUID(),
        ...sigHeaders,
      },
      signal: params.signal,
    });

    if (!paidRes.ok) {
      reservation.lease.release();
      const errBody = await paidRes.text().catch(() => "");
      return {
        receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
        vendorId: vendor.id,
        vendorName: vendor.name,
        endpoint: urlString,
        httpStatus: paidRes.status,
        advertisedUsd: vendor.advertisedPriceUsd,
        challengedUsd,
        settledUsd: 0,
        assetSymbol: net.asset.symbol,
        caip2Network: net.caip2,
        outcome: "failed",
        executionEngine: "pieverse-x402-exact",
        onChain: false,
        payTo: option.payTo,
        nonce: authNonce,
        policyHint: `Paid call returned HTTP ${paidRes.status}: ${errBody.slice(0, 180)}`,
        latencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    }

    reservation.lease.commit();

    const responseHeaderRaw = paidRes.headers.get("payment-response");
    const onChainHeader = paidRes.headers.get("x-brokr-onchain-settled") === "true";
    const decodedSettle = responseHeaderRaw
      ? decodePaymentResponseHeader(responseHeaderRaw)
      : undefined;
    const txHash =
      decodedSettle?.transaction && decodedSettle.transaction.length > 0
        ? decodedSettle.transaction
        : undefined;
    const isOnChain = Boolean(txHash && onChainHeader);
    const body = (await paidRes.json()) as Record<string, unknown>;

    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: paidRes.status,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd,
      settledUsd: challengedUsd,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "settled",
      executionEngine: isOnChain ? "pieverse-x402-exact" : "local-ledger-fallback",
      onChain: isOnChain,
      txHash,
      explorerUrl: txHash ? explorerTxUrl(net, txHash) : undefined,
      payer: decodedSettle?.payer || getBuyerAccount().address,
      payTo: option.payTo,
      nonce: authNonce,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      payload: body,
    };
  } catch (err) {
    reservation.lease.release();
    return {
      receiptId: `rcpt_${randomUUID().slice(0, 10)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      endpoint: urlString,
      httpStatus: 500,
      advertisedUsd: vendor.advertisedPriceUsd,
      challengedUsd,
      settledUsd: 0,
      assetSymbol: net.asset.symbol,
      caip2Network: net.caip2,
      outcome: "failed",
      executionEngine: "pieverse-x402-exact",
      onChain: false,
      payTo: option.payTo,
      policyHint: (err as Error).message,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }
}
