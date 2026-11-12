/**
 * Passport rail endpoint, served by a host that can run the `kpass` CLI.
 *
 * A Vercel deployment cannot run a CLI, so it forwards here instead of falling
 * back to a hot private key. This route spends from the owner's Kite allowance
 * and is therefore the most dangerous surface in the app: it requires a bearer
 * secret, refuses any host outside the merchant registry, and refuses to serve
 * at all when no secret is configured.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  bridgeSecretMatches,
  getBridgeAllowedHosts,
  getBridgeSecret,
  isHostPayable,
  type BridgePayRequest,
} from "@/lib/kite/passport-bridge";
import { EXTERNAL_MERCHANT_HOSTS } from "@/lib/partners/external-merchants";
import { payViaPassportSession, readPassportAllowance } from "@/lib/kite/passport";

export const dynamic = "force-dynamic";

function unauthorized() {
  // Deliberately identical for a missing and a wrong secret: distinguishing
  // them tells an attacker whether the bridge is configured at all.
  return NextResponse.json(
    { error: "unauthorized", message: "A valid bridge bearer secret is required." },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  if (!getBridgeSecret()) {
    return NextResponse.json(
      {
        error: "bridge_disabled",
        message:
          "BROKR_PASSPORT_BRIDGE_SECRET is unset, so this host does not serve the Passport rail.",
      },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  if (!bridgeSecretMatches(presented)) return unauthorized();

  let body: BridgePayRequest;
  try {
    body = (await req.json()) as BridgePayRequest;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json(
      { error: "url_required", message: "A target url is required." },
      { status: 400 },
    );
  }

  const allowedHosts = [...EXTERNAL_MERCHANT_HOSTS, ...getBridgeAllowedHosts()];
  if (!isHostPayable(body.url, allowedHosts)) {
    return NextResponse.json(
      {
        error: "host_not_payable",
        message:
          "This host is not in the merchant registry, or the URL is not https. The bridge will not pay it.",
        allowedHosts,
      },
      { status: 403 },
    );
  }

  const allowance = await readPassportAllowance();
  if (!allowance.active) {
    return NextResponse.json(
      { error: "no_allowance", message: allowance.note, allowance },
      { status: 409 },
    );
  }

  const result = await payViaPassportSession({
    url: body.url,
    method: body.method === "POST" ? "POST" : "GET",
    headers: body.headers,
    body: body.body,
    idempotencyKey: body.idempotencyKey,
  });

  // A refusal is a 200 with ok:false, not an HTTP error: the caller needs the
  // reason on the receipt, and an error status would lose it in a fetch catch.
  return NextResponse.json({ ok: result.ok, result });
}
