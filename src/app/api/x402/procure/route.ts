import { NextResponse } from "next/server";
import { executeProcurementGraph } from "@/lib/graph/steps";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import { createSessionPolicy } from "@/lib/kite/session";
import { getBuyerAccount, getMerchantPayTo } from "@/lib/kite/wallets";
import { withX402Gate } from "@/lib/kite/x402-server";
import { checkDailyOutflowAllowed, recordCompletedRun } from "@/lib/ledger";
import { PRESET_MANDATES, WHOLESALE_BUNDLE_PRICE_USD } from "@/lib/partners/catalog";
import type { ProcurementMandate } from "@/lib/types";

export const dynamic = "force-dynamic";

async function handleWholesaleProcure(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  const origin = reqUrl.origin;
  const originHost = reqUrl.host.toLowerCase();
  const net = getActiveKiteNetwork();

  return withX402Gate(
    req,
    {
      resourceUrl: `${origin}/api/x402/procure`,
      description:
        "Brokr Wholesale Diligence Endpoint — Mandate-bound multi-vendor procurement verified by SERV Reasoning and deterministic citation checks ($0.05).",
      priceUsd: WHOLESALE_BUNDLE_PRICE_USD,
      payTo: getMerchantPayTo(),
      network: net,
    },
    async ({ payer }) => {
      const outflow = checkDailyOutflowAllowed(0.03);
      if (!outflow.allowed) {
        return NextResponse.json(
          {
            error: "daily_outflow_ceiling_reached",
            spentTodayUsd: outflow.spentTodayUsd,
            capUsd: outflow.capUsd,
          },
          { status: 429 },
        );
      }

      let bodyParams: Partial<ProcurementMandate> = {};
      if (req.method === "POST") {
        bodyParams = (await req.json().catch(() => ({}))) as Partial<ProcurementMandate>;
      }

      const entity =
        bodyParams.targetEntity ||
        reqUrl.searchParams.get("entity") ||
        PRESET_MANDATES[0].targetEntity;
      const identifier =
        bodyParams.targetIdentifier ||
        reqUrl.searchParams.get("identifier") ||
        PRESET_MANDATES[0].targetIdentifier;
      const exposure = Number(
        bodyParams.counterpartyAmountUsd ??
          reqUrl.searchParams.get("amountUsd") ??
          25_000,
      );

      const mandate: ProcurementMandate = {
        id: "wholesale-request",
        title: bodyParams.title || `Wholesale Counterparty Diligence: ${entity}`,
        targetEntity: entity,
        targetIdentifier: identifier,
        counterpartyAmountUsd: Number.isFinite(exposure) ? exposure : 25_000,
        prompt:
          bodyParams.prompt ||
          `Verify corporate domain DNS/TLS, EVM contract state (${identifier}), and public OSINT repository activity for ${entity}.`,
        requiredDimensions: ["domain_posture", "onchain_contract", "osint_activity"],
      };

      const buyer = getBuyerAccount();
      const internalSession = createSessionPolicy({
        mode: "delegated",
        taskSummary: `Wholesale fulfillment for buyer ${payer.slice(0, 10)}`,
        ownerAddress: payer || buyer.address,
        agentAddress: buyer.address,
        network: net.id,
        maxAmountPerTxUsd: 0.012,
        maxTotalAmountUsd: 0.03,
        ttlMinutes: 10,
        allowedHosts: [originHost, "localhost:3000", "127.0.0.1:3000"],
      });

      const run = await executeProcurementGraph({
        origin,
        mandate,
        session: internalSession,
        includeAdversarial: false,
        submitToReppo: false,
        callerType: "x402-wholesale-buyer",
      });

      recordCompletedRun(run);

      if (run.status === "failed") {
        return NextResponse.json(
          { error: "procurement_failed", message: run.error },
          { status: 502 },
        );
      }

      return NextResponse.json({
        ok: true,
        runId: run.runId,
        buyerPayer: payer,
        dossier: run.dossier,
        verification: run.verification,
        upstreamReceipts: run.receipts.map((r) => ({
          vendorId: r.vendorId,
          settledUsd: r.settledUsd,
          txHash: r.txHash ?? null,
          onChain: r.onChain,
        })),
        unitEconomics: run.margin,
      });
    },
  );
}

export async function GET(req: Request) {
  return handleWholesaleProcure(req);
}

export async function POST(req: Request) {
  return handleWholesaleProcure(req);
}
