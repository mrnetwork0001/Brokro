import { NextResponse } from "next/server";
import { runAttackArenaBenchmark } from "@/lib/arena";
import { PRESET_MANDATES } from "@/lib/partners/catalog";
import type { ProcurementMandate } from "@/lib/types";
import { resolvePublicOrigin } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const reqUrl = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as {
      presetId?: string;
      mandate?: Partial<ProcurementMandate>;
      maxAmountPerTxUsd?: number;
      maxTotalAmountUsd?: number;
    };

    const preset =
      PRESET_MANDATES.find((m) => m.id === body.presetId) || PRESET_MANDATES[0];

    const mandate: ProcurementMandate = {
      id: body.mandate?.id || preset.id,
      title: body.mandate?.title || preset.title,
      targetEntity: body.mandate?.targetEntity || preset.targetEntity,
      targetIdentifier: body.mandate?.targetIdentifier || preset.targetIdentifier,
      counterpartyAmountUsd:
        body.mandate?.counterpartyAmountUsd ?? preset.counterpartyAmountUsd,
      prompt: body.mandate?.prompt || preset.prompt,
      requiredDimensions:
        body.mandate?.requiredDimensions || preset.requiredDimensions,
    };

    const result = await runAttackArenaBenchmark({
      origin: resolvePublicOrigin(req),
      originHost: new URL(resolvePublicOrigin(req)).host.toLowerCase(),
      mandate,
      maxAmountPerTxUsd: body.maxAmountPerTxUsd,
      maxTotalAmountUsd: body.maxTotalAmountUsd,
    });

    return NextResponse.json({ ok: true, arena: result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
