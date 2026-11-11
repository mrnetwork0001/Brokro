import { executeProcurementGraph } from "@/lib/graph/steps";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import { createSessionPolicy, getSessionPolicy } from "@/lib/kite/session";
import { getBuyerAccount } from "@/lib/kite/wallets";
import { checkDailyOutflowAllowed, recordCompletedRun } from "@/lib/ledger";
import { PRESET_MANDATES } from "@/lib/partners/catalog";
import type { ProcurementMandate, SessionMode } from "@/lib/types";
import { resolvePublicOrigin } from "@/lib/public-url";
import {
  EXTERNAL_MERCHANT_HOSTS,
  EXTERNAL_MERCHANT_NETWORKS,
} from "@/lib/partners/external-merchants";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const originUrl = new URL(req.url);
  const origin = resolvePublicOrigin(req);
  const originHost = new URL(origin).host.toLowerCase();
  const requestHost = originUrl.host.toLowerCase();

  let body: {
    mandate?: Partial<ProcurementMandate>;
    presetId?: string;
    sessionId?: string;
    sessionMode?: SessionMode;
    maxAmountPerTxUsd?: number;
    maxTotalAmountUsd?: number;
    ttlMinutes?: number;
    includeAdversarial?: boolean;
    submitToReppo?: boolean;
    includeExternalMerchants?: boolean;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const maxPerTx = Math.min(0.25, Math.max(0.004, Number(body.maxAmountPerTxUsd ?? 0.015)));
  const maxTotal = Math.min(0.5, Math.max(maxPerTx, Number(body.maxTotalAmountUsd ?? 0.035)));

  const outflow = checkDailyOutflowAllowed(maxTotal);
  if (!outflow.allowed) {
    return new Response(
      JSON.stringify({
        error: "daily_outflow_cap_reached",
        message: `Daily demo outflow cap ($${outflow.capUsd.toFixed(2)}) reached.`,
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const preset =
    PRESET_MANDATES.find((m) => m.id === body.presetId) ?? PRESET_MANDATES[0];

  const mandate: ProcurementMandate = {
    id: body.mandate?.id || preset.id,
    title: body.mandate?.title?.trim() || preset.title,
    targetEntity: body.mandate?.targetEntity?.trim() || preset.targetEntity,
    targetIdentifier: body.mandate?.targetIdentifier?.trim() || preset.targetIdentifier,
    counterpartyAmountUsd: Number(
      body.mandate?.counterpartyAmountUsd ?? preset.counterpartyAmountUsd,
    ),
    prompt: body.mandate?.prompt?.trim() || preset.prompt,
    requiredDimensions:
      body.mandate?.requiredDimensions ?? preset.requiredDimensions,
  };

  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();

  const includeExternalMerchants = Boolean(body.includeExternalMerchants);

  const existingSession = body.sessionId ? getSessionPolicy(body.sessionId) : undefined;
  const session =
    existingSession ??
    createSessionPolicy({
      mode: body.sessionMode || "delegated",
      taskSummary: mandate.title,
      ownerAddress: buyer.address,
      agentAddress: buyer.address,
      network: net.id,
      maxAmountPerTxUsd: maxPerTx,
      maxTotalAmountUsd: maxTotal,
      ttlMinutes: Number(body.ttlMinutes ?? 30),
      allowedHosts: [
        originHost,
        requestHost,
        "localhost:3000",
        "127.0.0.1:3000",
        // Scoped in only on opt-in: an unauthorized host is refused before a
        // signature exists, which is the behaviour the demo relies on.
        ...(includeExternalMerchants ? EXTERNAL_MERCHANT_HOSTS : []),
      ],
      additionalNetworks: includeExternalMerchants ? EXTERNAL_MERCHANT_NETWORKS : [],
      // No passkey and no signature: this is the keyless demo path, and the
      // receipt should say so. Sign a mandate from the desk to upgrade it.
    });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // Client disconnected
        }
      };

      send("session", session);

      const completedRun = await executeProcurementGraph({
        origin,
        mandate,
        session,
        includeAdversarial: Boolean(body.includeAdversarial),
        submitToReppo: Boolean(body.submitToReppo),
        includeExternalMerchants,
        callerType: "interactive-desk",
        callbacks: {
          signal: req.signal,
          onStep: (step, snapshot) => {
            send("step", {
              step,
              session: snapshot.session,
              guards: snapshot.guards,
              plan: snapshot.plan,
              receipts: snapshot.receipts,
            });
          },
        },
      });

      recordCompletedRun(completedRun);
      send("complete", completedRun);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
