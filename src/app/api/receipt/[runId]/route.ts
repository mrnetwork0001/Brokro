import { NextResponse } from "next/server";
import { getRunById } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * Machine-readable receipt. Everything the human permalink shows, so another
 * agent can re-derive the SHA-256 digest and check the mandate itself.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const run = getRunById(runId);

  if (!run) {
    return NextResponse.json({ error: "unknown_run", runId }, { status: 404 });
  }

  return NextResponse.json({
    runId: run.runId,
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? null,
    status: run.status,
    callerType: run.callerType,
    mandate: {
      ...run.mandate,
      sessionId: run.session.sessionId,
      ownerAddress: run.session.ownerAddress,
      agentAddress: run.session.agentAddress,
      maxAmountPerTxUsd: run.session.maxAmountPerTxUsd,
      maxTotalAmountUsd: run.session.maxTotalAmountUsd,
      spentUsd: run.session.spentUsd,
      allowedAssets: run.session.allowedAssets ?? [],
      allowedHosts: run.session.allowedHosts,
      expiresAt: run.session.expiresAt,
      walletSignature: run.session.walletSignature ?? null,
    },
    quarantined: run.guards
      .filter((g) => !g.admitted)
      .map((g) => ({
        vendorId: g.vendorId,
        vendorName: g.vendorName,
        severity: g.severity,
        deterministicHits: g.deterministicHits,
        reason: g.reason,
      })),
    receipts: run.receipts.map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      externalMerchant: Boolean(r.externalMerchant),
      outcome: r.outcome,
      advertisedUsd: r.advertisedUsd,
      challengedUsd: r.challengedUsd,
      settledUsd: r.settledUsd,
      settlementNetwork: r.settlementNetwork ?? r.caip2Network,
      onChain: r.onChain,
      txHash: r.txHash ?? null,
      explorerUrl: r.explorerUrl ?? null,
      policyErrorCode: r.policyErrorCode ?? null,
      policyHint: r.policyHint ?? null,
    })),
    dossier: run.dossier ?? null,
    verification: run.verification ?? null,
    unitEconomics: run.margin,
    steps: run.steps.map((s) => ({
      step: s.step,
      engine: s.engine,
      model: s.model ?? null,
      servTools: s.servTools ?? [],
      status: s.status,
      durationMs: s.durationMs ?? null,
      tokens: s.tokens ?? null,
      costUsd: s.costUsd ?? null,
    })),
  });
}
