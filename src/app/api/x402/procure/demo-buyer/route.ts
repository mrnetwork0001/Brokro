import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { explorerTxUrl, getActiveKiteNetwork, usdToAtomicUnits } from "@/lib/kite/networks";
import { createKiteX402Signer, getBuyerAccount } from "@/lib/kite/wallets";
import { acquireCallerLock } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * Simulates an external autonomous buyer agent calling Brokr's own paid
 * `/api/x402/procure` endpoint via a full HTTP 402 -> EIP-3009 signature
 * handshake so judges can verify Brokr's wholesale revenue flow in 1 click.
 */
export async function POST(req: Request) {
  const releaseLock = acquireCallerLock("demo-wholesale-buyer");
  if (!releaseLock) {
    return NextResponse.json(
      { error: "wholesale_call_already_running" },
      { status: 409 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      entity?: string;
      identifier?: string;
    };
    const origin = new URL(req.url).origin;
    const net = getActiveKiteNetwork();

    const target = new URL(`${origin}/api/x402/procure`);
    if (body.entity) target.searchParams.set("entity", body.entity);
    if (body.identifier) target.searchParams.set("identifier", body.identifier);

    // 1. Unpaid probe -> receive HTTP 402 challenge ($0.05)
    const unpaidRes = await fetch(target.toString(), { method: "GET" });
    if (unpaidRes.status !== 402) {
      return NextResponse.json(
        { error: "expected_402_challenge", status: unpaidRes.status },
        { status: 500 },
      );
    }

    const reqHeader = unpaidRes.headers.get("payment-required");
    if (!reqHeader) {
      return NextResponse.json({ error: "missing_payment_required_header" }, { status: 500 });
    }

    // 2. External buyer signs $0.05 EIP-3009 authorization via @x402/evm
    const paymentRequired = decodePaymentRequiredHeader(reqHeader);
    const signer = createKiteX402Signer(net);
    const client = x402Client.fromConfig({
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
            maxAmountPerPayment: usdToAtomicUnits(0.1, net.asset.decimals),
          },
        ],
      },
    });
    const httpClient = new x402HTTPClient(client);

    const payload = await httpClient.createPaymentPayload(paymentRequired);
    const sigHeaders = httpClient.encodePaymentSignatureHeader(payload);

    // 3. Retry with PAYMENT-SIGNATURE -> Brokr verifies, fulfills upstream, settles $0.05
    const paidRes = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": randomUUID(),
        ...sigHeaders,
      },
    });

    const settleHeader = paidRes.headers.get("payment-response");
    const onChain = paidRes.headers.get("x-brokro-onchain-settled") === "true";
    const escrowGuarantee = paidRes.headers.get("x-brokro-escrow-guarantee") || "pay-only-if-verified";
    const settleDecoded = settleHeader ? decodePaymentResponseHeader(settleHeader) : undefined;
    const txHash = settleDecoded?.transaction || undefined;
    const json = (await paidRes.json()) as Record<string, unknown>;

    return NextResponse.json({
      ok: paidRes.ok,
      httpStatus: paidRes.status,
      buyerAddress: getBuyerAccount().address,
      wholesaleTxHash: txHash ?? null,
      wholesaleExplorerUrl: txHash ? explorerTxUrl(net, txHash) : null,
      onChainSettled: onChain,
      escrowGuarantee,
      result: json,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "wholesale_buyer_error", message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    releaseLock();
  }
}
