/**
 * Buys one resource from every independent third-party x402 merchant in the
 * registry, for real, on Base mainnet.
 *
 * This is the reproducible proof that Brokro is a clearinghouse and not a
 * closed loop: the merchants are real businesses, the prices come from the
 * `PAYMENT-REQUIRED` headers they actually serve, and the transaction hashes
 * it prints are on Basescan. Run it after funding the buyer wallet.
 *
 *   npm run settle:external
 *
 * It spends real money — about $0.005 total across four merchants. Every
 * purchase is still evaluated against the same Kite Passport session policy
 * that guards Brokro's own supply nodes, so a merchant that spikes its price
 * or demands an unauthorized chain is refused before a signature exists.
 */

import { readFileSync, existsSync } from "node:fs";

// The app reads these from the Next.js runtime; a bare `node` process does not,
// so load them the same way `next dev` would before importing anything.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const { createSessionPolicy } = await import("../src/lib/kite/session.ts");
const {
  EXTERNAL_MERCHANTS,
  EXTERNAL_MERCHANT_HOSTS,
  EXTERNAL_MERCHANT_NETWORKS,
  procureFromExternalMerchant,
} = await import("../src/lib/partners/external-merchants.ts");
const { getBuyerAccount, getExternalSettlementMode } = await import("../src/lib/kite/wallets.ts");

const buyer = getBuyerAccount();
const mode = getExternalSettlementMode();

console.log("buyer            :", buyer.address);
console.log("settlement mode  :", mode);
console.log("merchant hosts   :", EXTERNAL_MERCHANT_HOSTS.join(", "));

if (mode !== "on") {
  console.log("");
  console.log(`BROKR_EXTERNAL_SETTLEMENT=${mode}, so nothing will be signed.`);
  console.log('Set it to "on" in .env.local to settle for real.');
}

const session = createSessionPolicy({
  taskSummary: "Third-party merchant settlement proof",
  ownerAddress: process.env.BROKR_MERCHANT_PAY_TO || buyer.address,
  agentAddress: buyer.address,
  maxAmountPerTxUsd: 0.05,
  maxTotalAmountUsd: 0.5,
  ttlMinutes: 15,
  allowedHosts: EXTERNAL_MERCHANT_HOSTS,
  additionalNetworks: EXTERNAL_MERCHANT_NETWORKS,
});

console.log("");
console.log("session          :", session.sessionId);
console.log("ownerAuthorization:", session.ownerAuthorization);
console.log(
  "allowedAssets    :",
  session.allowedAssets.map((a) => `${a.symbol}@${a.caip2Network}`).join(", "),
);

const mandate = {
  entity: "gokite.ai / gokite-ai",
  identifier: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

let settledOnChain = 0;
let spent = 0;

for (const merchant of EXTERNAL_MERCHANTS) {
  const receipt = await procureFromExternalMerchant({ merchant, session, mandate });
  console.log("");
  console.log("─".repeat(72));
  console.log(merchant.name);
  console.log("  outcome     :", receipt.outcome, receipt.policyErrorCode ? `(${receipt.policyErrorCode})` : "");
  console.log("  http        :", receipt.httpStatus);
  console.log("  challenged  : $" + receipt.challengedUsd, " settled: $" + receipt.settledUsd);
  console.log("  network     :", receipt.settlementNetwork, receipt.settlementAssetSymbol);
  console.log("  payTo       :", receipt.payTo);
  console.log("  ON-CHAIN    :", receipt.onChain);
  if (receipt.txHash) {
    console.log("  txHash      :", receipt.txHash);
    console.log("  explorer    :", receipt.explorerUrl);
    settledOnChain += 1;
  }
  if (receipt.policyHint) console.log("  hint        :", receipt.policyHint.slice(0, 240));
  if (receipt.payload) console.log("  payload     :", JSON.stringify(receipt.payload).slice(0, 240));
  spent += receipt.settledUsd;
}

console.log("");
console.log("─".repeat(72));
console.log(`settled on-chain : ${settledOnChain}/${EXTERNAL_MERCHANTS.length}`);
console.log("total spent      : $" + spent.toFixed(6));
console.log("session spent    : $" + session.spentUsd);
