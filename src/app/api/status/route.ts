import { NextResponse } from "next/server";
import { searchKiteCatalogViaCli, probeKpassEnvironment } from "@/lib/kite/kpass";
import {
  readPassportAllowance,
  readPassportIdentity,
  resolveSettlementRail,
} from "@/lib/kite/passport";
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
import { EXTERNAL_MERCHANT_NETWORKS } from "@/lib/partners/external-merchants";

export const dynamic = "force-dynamic";

export async function GET() {
  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();
  const merchantPayTo = getMerchantPayTo();

  const [
    walletBalances,
    facilitator,
    kpassEnv,
    kiteCatalogSample,
    passportIdentity,
    passportAllowance,
    settlementRail,
  ] = await Promise.all([
    readKiteWalletBalances(buyer.address, net).catch(() => ({
      tokenRaw: "0",
      tokenFormatted: "0",
      tokenUsd: 0,
      nativeKiteFormatted: "0",
    })),
    checkFacilitatorHealth(),
    probeKpassEnvironment(),
    searchKiteCatalogViaCli("", 4),
    readPassportIdentity(),
    readPassportAllowance(),
    resolveSettlementRail(),
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
    // The Kite half of the mandate: who this agent is, and the ceiling its
    // owner set. Both are read live from Passport rather than from our config,
    // so lowering the allowance in Kite's dashboard shows up here immediately.
    passport: {
      identity: passportIdentity,
      allowance: passportAllowance,
      rail: settlementRail.rail,
      railReason: settlementRail.reason,
      // Where money actually moves, which is not the configured home chain.
      // Third-party merchants price in USDC on Base, so a run that buys from
      // them settles there while `network` still describes Kite. Reporting
      // only the home chain made the desk look like it settled on Kite.
      settlesOn: EXTERNAL_MERCHANT_NETWORKS,
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
