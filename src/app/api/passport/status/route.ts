/**
 * Passport identity and allowance, read through the bridge.
 *
 * Payments already forward to a host with the `kpass` CLI, but the *reads* did
 * not, so a serverless deployment paid correctly while reporting "allowance
 * not set" and "identity unresolved" on its own desk. That understates the
 * product in the one place a judge looks first.
 *
 * Bearer-protected like the payment route: an allowance balance and spend
 * history are the owner's business, not a public endpoint's.
 */

import { type NextRequest, NextResponse } from "next/server";
import { bridgeSecretMatches, getBridgeSecret } from "@/lib/kite/passport-bridge";
import { readPassportAllowance, readPassportIdentity } from "@/lib/kite/passport";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!getBridgeSecret()) {
    return NextResponse.json(
      { error: "bridge_disabled", message: "This host does not serve the Passport rail." },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  if (!bridgeSecretMatches(presented)) {
    return NextResponse.json(
      { error: "unauthorized", message: "A valid bridge bearer secret is required." },
      { status: 401 },
    );
  }

  const [identity, allowance] = await Promise.all([
    readPassportIdentity(),
    readPassportAllowance(),
  ]);

  return NextResponse.json({ ok: true, identity, allowance });
}
