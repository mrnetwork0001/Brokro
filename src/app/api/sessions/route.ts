import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import {
  buildSessionSignMessage,
  createSessionPolicy,
  verifySessionWalletSignature,
} from "@/lib/kite/session";
import { getBuyerAccount } from "@/lib/kite/wallets";
import type { KiteNetworkId, SessionMode } from "@/lib/types";

export const dynamic = "force-dynamic";

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
    };

    const originHost = new URL(req.url).host.toLowerCase();
    const net = getActiveKiteNetwork();
    const buyer = getBuyerAccount();

    const mode: SessionMode = body.mode || "delegated";
    const maxAmountPerTxUsd = Number(body.maxAmountPerTxUsd ?? 0.015);
    const maxTotalAmountUsd = Number(body.maxTotalAmountUsd ?? 0.035);
    const ttlMinutes = Math.min(120, Math.max(5, Number(body.ttlMinutes ?? 30)));
    const network: KiteNetworkId = body.network || net.id;

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
      allowedHosts: [originHost, "localhost:3000", "127.0.0.1:3000"],
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
