import { NextResponse } from "next/server";
import { probeLiveKiteEcosystem } from "@/lib/partners/live-discovery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const rawMax = Number(reqUrl.searchParams.get("maxPerTxUsd") || "0.015");
  const maxPerTxUsd = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 0.015;

  const probes = await probeLiveKiteEcosystem(maxPerTxUsd);
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    probes,
  });
}
