/**
 * Live infrastructure diagnostic for Brokro.
 * Usage: npm run diag
 */

import { readFileSync, existsSync } from "node:fs";
import { probeKpassEnvironment, searchKiteCatalogViaCli } from "../src/lib/kite/kpass.ts";
import {
  checkFacilitatorHealth,
  getActiveKiteNetwork,
  readKiteWalletBalances,
} from "../src/lib/kite/networks.ts";
import { getBuyerAccount, getMerchantPayTo } from "../src/lib/kite/wallets.ts";
import { isServConfigured } from "../src/lib/serv.ts";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const net = getActiveKiteNetwork();
const buyer = getBuyerAccount();
const merchant = getMerchantPayTo();

console.log("── Brokro Live Infrastructure Diagnostic ──────────────────────────");
console.log(`Active Kite Network : ${net.name} (${net.caip2}, chainId ${net.chainId})`);
console.log(`Settlement Asset    : ${net.asset.symbol} (${net.asset.address}, ${net.asset.decimals} decimals)`);
console.log(`Buyer Session Signer: ${buyer.address}`);
console.log(`Merchant PayTo      : ${merchant}`);
console.log(`SERV_API_KEY Ready  : ${isServConfigured()}`);

const [balances, facilitator, kpass, catalog] = await Promise.all([
  readKiteWalletBalances(buyer.address, net),
  checkFacilitatorHealth(),
  probeKpassEnvironment(),
  searchKiteCatalogViaCli("", 3),
]);

console.log(`Buyer Balance       : ${balances.tokenFormatted} ${net.asset.symbol} | ${balances.nativeKiteFormatted} KITE`);
console.log(`Pieverse Facilitator: ${facilitator.ok ? "ONLINE" : "OFFLINE"} (${facilitator.latencyMs}ms) · 2368=${facilitator.kiteTestnetSupported} · 2366=${facilitator.kiteMainnetSupported}`);
console.log(`Kite Passport CLI   : ${kpass.installed ? kpass.kpassVersion : "Not installed"} · Live catalog hits=${catalog.length}`);
console.log("───────────────────────────────────────────────────────────────────");
