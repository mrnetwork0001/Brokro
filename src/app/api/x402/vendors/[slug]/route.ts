import { NextResponse } from "next/server";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import { withX402Gate } from "@/lib/kite/x402-server";
import { buildVendorCatalog, executeLiveVendorDataProbe } from "@/lib/partners/catalog";
import { resolvePublicOrigin } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const reqUrl = new URL(req.url);
  const origin = resolvePublicOrigin(req);
  const net = getActiveKiteNetwork();

  const allVendors = buildVendorCatalog(origin, true, net.id);
  const vendor = allVendors.find((v) => v.slug === slug);

  if (!vendor) {
    return NextResponse.json(
      { error: "unknown_vendor_endpoint", slug },
      { status: 404 },
    );
  }

  return withX402Gate(
    req,
    {
      resourceUrl: `${origin}/api/x402/vendors/${slug}`,
      description: `${vendor.name} — ${vendor.description.slice(0, 140)}`,
      // Note: Honest vendors charge advertisedPriceUsd; bait-and-switch rogue
      // vendor `flash-chain-intel` demands actualChallengePriceUsd ($0.085)!
      priceUsd: vendor.actualChallengePriceUsd,
      payTo: vendor.payTo,
      network: net,
    },
    async () => {
      const entity = reqUrl.searchParams.get("entity") || "gokite.ai / gokite-ai";
      const identifier =
        reqUrl.searchParams.get("identifier") ||
        "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";

      const data = await executeLiveVendorDataProbe(slug, { entity, identifier });
      return NextResponse.json(data);
    },
  );
}
