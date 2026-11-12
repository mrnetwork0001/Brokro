import { type NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import {
  buildSessionSignMessage,
  createSessionPolicy,
  verifySessionWalletSignature,
} from "@/lib/kite/session";
import {
  EXTERNAL_MERCHANT_HOSTS,
  EXTERNAL_MERCHANT_NETWORKS,
} from "@/lib/partners/external-merchants";
import { getBuyerAccount } from "@/lib/kite/wallets";
import type { KiteNetworkId, SessionMode } from "@/lib/types";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Returns the exact canonical text a wallet must sign for these parameters.
 *
 * The desk used to build this string itself, which meant two copies of the
 * format had to stay byte-identical forever; they drifted, and a mandate signed
 * before `/api/status` resolved named the testnet asset while the server ran on
 * mainnet. The server now authors the text and the client signs it verbatim, so
 * there is exactly one definition of what an owner is agreeing to.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ownerAddress = url.searchParams.get("ownerAddress");

  if (!ownerAddress || !isAddress(ownerAddress)) {
    return NextResponse.json(
      { error: "owner_address_required", message: "A valid ownerAddress is required." },
      { status: 400 },
    );
  }

  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();

  const maxAmountPerTxUsd = Number(url.searchParams.get("maxAmountPerTxUsd") ?? 0.015);
  const maxTotalAmountUsd = Number(url.searchParams.get("maxTotalAmountUsd") ?? 0.035);
  const ttlMinutes = Math.min(120, Math.max(5, Number(url.searchParams.get("ttlMinutes") ?? 30)));
  const includeExternalMerchants = url.searchParams.get("includeExternalMerchants") === "true";
  const nonce = randomUUID().replace(/-/g, "").slice(0, 10);

  if (
    !Number.isFinite(maxAmountPerTxUsd) ||
    !Number.isFinite(maxTotalAmountUsd) ||
    maxAmountPerTxUsd <= 0 ||
    maxTotalAmountUsd <= 0 ||
    maxAmountPerTxUsd > maxTotalAmountUsd
  ) {
    return NextResponse.json(
      {
        error: "invalid_session_parameters",
        message: "Spending limits must be positive, with per-transaction at or below the total.",
      },
      { status: 400 },
    );
  }

  const message = buildSessionSignMessage({
    ownerAddress,
    agentAddress: buyer.address,
    network: net.id,
    maxAmountPerTxUsd,
    maxTotalAmountUsd,
    ttlMinutes,
    nonce,
    externalMerchants: includeExternalMerchants,
    externalHosts: EXTERNAL_MERCHANT_HOSTS,
    externalNetworks: EXTERNAL_MERCHANT_NETWORKS,
  });

  return NextResponse.json({
    ok: true,
    message,
    nonce,
    network: net.id,
    maxAmountPerTxUsd,
    maxTotalAmountUsd,
    ttlMinutes,
    includeExternalMerchants,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mode?: SessionMode;
      taskSummary?: string;
      ownerAddress?: string;
      network?: KiteNetworkId;
      maxAmountPerTxUsd?: number;
      maxTotalAmountUsd?: number;
      ttlMinutes?: number;
      nonce?: string;
      walletSignature?: string;
      includeExternalMerchants?: boolean;
    };

    const originHost = new URL(req.url).host.toLowerCase();
    const net = getActiveKiteNetwork();
    const buyer = getBuyerAccount();

    const mode: SessionMode = body.mode || "delegated";
    const maxAmountPerTxUsd = Number(body.maxAmountPerTxUsd ?? 0.015);
    const maxTotalAmountUsd = Number(body.maxTotalAmountUsd ?? 0.035);
    const ttlMinutes = Math.min(120, Math.max(5, Number(body.ttlMinutes ?? 30)));
    const network: KiteNetworkId = body.network || net.id;
    const includeExternalMerchants = Boolean(body.includeExternalMerchants);

    let ownerAddress = buyer.address;
    if (mode === "wallet") {
      if (!body.ownerAddress || !isAddress(body.ownerAddress) || !body.walletSignature || !body.nonce) {
        return NextResponse.json(
          { error: "wallet_signature_required", message: "Wallet mode requires ownerAddress, nonce, and walletSignature." },
          { status: 400 },
        );
      }

      const expectedMessage = buildSessionSignMessage({
        ownerAddress: body.ownerAddress,
        agentAddress: buyer.address,
        network,
        maxAmountPerTxUsd,
        maxTotalAmountUsd,
        ttlMinutes,
        nonce: body.nonce,
        externalMerchants: includeExternalMerchants,
        externalHosts: EXTERNAL_MERCHANT_HOSTS,
        externalNetworks: EXTERNAL_MERCHANT_NETWORKS,
      });

      const validSig = await verifySessionWalletSignature({
        address: body.ownerAddress as `0x${string}`,
        message: expectedMessage,
        signature: body.walletSignature as `0x${string}`,
      });

      if (!validSig) {
        return NextResponse.json(
          { error: "invalid_wallet_signature", message: "Wallet signature verification failed." },
          { status: 401 },
        );
      }
      ownerAddress = body.ownerAddress as `0x${string}`;
    }

    const session = createSessionPolicy({
      mode,
      taskSummary: body.taskSummary || "Mandate-bound x402 counterparty diligence",
      ownerAddress,
      agentAddress: buyer.address,
      network,
      maxAmountPerTxUsd,
      maxTotalAmountUsd,
      ttlMinutes,
      // Must match what the run route would grant, or a wallet-signed mandate
      // silently loses the third-party merchant scope an unsigned one gets.
      allowedHosts: [
        originHost,
        "localhost:3000",
        "127.0.0.1:3000",
        ...(includeExternalMerchants ? EXTERNAL_MERCHANT_HOSTS : []),
      ],
      additionalNetworks: includeExternalMerchants ? EXTERNAL_MERCHANT_NETWORKS : [],
      // Wallet mode proves owner intent with a verified EIP-191 signature,
      // which createSessionPolicy records as "eip191-wallet-signature". It is
      // not a Kite Passport passkey, so it must not claim to be one.
      walletSignature: body.walletSignature,
    });

    return NextResponse.json({ ok: true, session });
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_session_parameters", message: (err as Error).message },
      { status: 400 },
    );
  }
}
