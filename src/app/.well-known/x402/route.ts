import { NextResponse } from "next/server";
import { getActiveKiteNetwork, PIEVERSE_FACILITATOR_URL, usdToAtomicUnits } from "@/lib/kite/networks";
import { getMerchantPayTo } from "@/lib/kite/wallets";
import { WHOLESALE_BUNDLE_PRICE_USD, buildVendorCatalog } from "@/lib/partners/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const net = getActiveKiteNetwork();
  const payTo = getMerchantPayTo();
  const suppliers = buildVendorCatalog(origin, false, net.id);

  return NextResponse.json(
    {
      x402Version: 2,
      service: "Brokr Autonomous Procurement & Wholesale Clearinghouse",
      protocol: "exact",
      facilitatorUrl: PIEVERSE_FACILITATOR_URL,
      network: {
        id: net.id,
        caip2: net.caip2,
        chainId: net.chainId,
        asset: net.asset.address,
        symbol: net.asset.symbol,
        decimals: net.asset.decimals,
        eip712Domain: {
          name: net.asset.eip712Name,
          version: net.asset.eip712Version,
        },
      },
      wholesaleEndpoint: {
        url: `${origin}/api/x402/procure`,
        methods: ["GET", "POST"],
        priceUsd: WHOLESALE_BUNDLE_PRICE_USD,
        atomicAmount: usdToAtomicUnits(WHOLESALE_BUNDLE_PRICE_USD, net.asset.decimals),
        payTo,
        description:
          "Mandate-bound multi-vendor counterparty & smart-contract diligence dossier verified by SERV Reasoning (serv_prompt_guard + serv_shadow_agent) and deterministic citation checks.",
      },
      upstreamSupplyNodes: suppliers.map((v) => ({
        id: v.id,
        name: v.name,
        url: v.endpoint,
        method: "GET",
        priceUsd: v.advertisedPriceUsd,
        atomicAmount: usdToAtomicUnits(v.advertisedPriceUsd, net.asset.decimals),
        payTo: v.payTo,
        deliverableFields: v.deliverableFields,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30",
      },
    },
  );
}
