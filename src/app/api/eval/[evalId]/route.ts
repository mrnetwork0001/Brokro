import { NextResponse } from "next/server";
import { pollReppoVerdict } from "@/lib/partners/reppo";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ evalId: string }> },
) {
  const { evalId } = await context.params;
  const audit = await pollReppoVerdict(evalId);
  return NextResponse.json({ ok: true, audit });
}
