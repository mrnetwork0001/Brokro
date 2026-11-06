import { NextResponse } from "next/server";
import { searchKiteCatalogViaCli, probeKpassEnvironment } from "@/lib/kite/kpass";
import {
  checkFacilitatorHealth,
  explorerAddressUrl,
  getActiveKiteNetwork,
  readKiteWalletBalances,
} from "@/lib/kite/networks";
import { getBuyerAccount, getMerchantPayTo, isPaymentsEnabled } from "@/lib/kite/wallets";
import { getLedgerSummary } from "@/lib/ledger";
import { PRESET_MANDATES, WHOLESALE_BUNDLE_PRICE_USD } from "@/lib/partners/catalog";
import { isDolphinConfigured } from "@/lib/partners/dolphin";
import { isReppoConfigured } from "@/lib/partners/reppo";
import { isServConfigured } from "@/lib/serv";

export const dynamic = "force-dynamic";

export async function GET() {
  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();
  const merchantPayTo = getMerchantPayTo();

  const [walletBalances, facilitator, kpassEnv, kiteCatalogSample] = await Promise.all([
    readKiteWalletBalances(buyer.address, net).catch(() => ({
      tokenRaw: "0",
      tokenFormatted: "0",
      tokenUsd: 0,
      nativeKiteFormatted: "0",
    })),
    checkFacilitatorHealth(),
    probeKpassEnvironment(),
    searchKiteCatalogViaCli("", 4),
  ]);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    paymentsEnabled: isPaymentsEnabled(),
    wholesalePriceUsd: WHOLESALE_BUNDLE_PRICE_USD,
    network: {
      id: net.id,
      name: net.name,
      chainId: net.chainId,
      caip2: net.caip2,
      rpcUrl: net.rpcUrl,
      explorerBaseUrl: net.explorerBaseUrl,
      faucetUrl: net.faucetUrl ?? null,
      asset: net.asset,
    },
    wallets: {
      buyerAddress: buyer.address,
      buyerExplorerUrl: explorerAddressUrl(net, buyer.address),
      merchantPayTo,
      merchantExplorerUrl: explorerAddressUrl(net, merchantPayTo),
      balances: walletBalances,
    },
    facilitator,
    kpass: {
      ...kpassEnv,
      liveCatalogSample: kiteCatalogSample,
    },
    engines: {
      servConfigured: isServConfigured(),
      dolphinConfigured: isDolphinConfigured(),
      reppoConfigured: isReppoConfigured(),
    },
    ledger: getLedgerSummary(),
    presets: PRESET_MANDATES,
  });
}
