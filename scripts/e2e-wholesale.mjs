/**
 * End-to-end Wholesale x402 Revenue Test (`GET /.well-known/x402` -> HTTP 402 -> EIP-3009 -> HTTP 200).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const BASE = process.env.BROKR_URL || "http://127.0.0.1:3099";

console.log(`Probing ${BASE}/.well-known/x402...`);
const wk = await fetch(`${BASE}/.well-known/x402`).then((r) => r.json());
assert.equal(wk.x402Version, 2);
assert.equal(wk.wholesaleEndpoint.priceUsd, 0.05);
console.log(`  Discovered wholesale endpoint: ${wk.wholesaleEndpoint.url} ($${wk.wholesaleEndpoint.priceUsd})`);

console.log("Verifying unpaid request receives HTTP 402 + PAYMENT-REQUIRED header...");
const unpaid = await fetch(`${BASE}/api/x402/procure?entity=gokite.ai`);
assert.equal(unpaid.status, 402);
assert.ok(unpaid.headers.get("payment-required"), "Missing PAYMENT-REQUIRED header");

console.log("Executing autonomous external buyer handshake via /api/x402/procure/demo-buyer...");
const paid = await fetch(`${BASE}/api/x402/procure/demo-buyer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    entity: "gokite.ai / gokite-ai",
    identifier: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
  }),
}).then((r) => r.json());

assert.equal(paid.ok, true, `Wholesale call failed: ${JSON.stringify(paid)}`);
assert.equal(paid.httpStatus, 200);
assert.equal(paid.result.verification.passed, true);
assert.ok(paid.result.unitEconomics.netMarginUsd > 0);

console.log("\n✓ E2E Wholesale x402 Revenue Flow PASSED");
console.log(`  Buyer Payer : ${paid.buyerAddress}`);
console.log(`  Gross Rev   : $${paid.result.unitEconomics.wholesalePriceUsd.toFixed(4)}`);
console.log(`  Total Cost  : $${paid.result.unitEconomics.totalCostUsd.toFixed(4)}`);
console.log(`  Net Profit  : +$${paid.result.unitEconomics.netMarginUsd.toFixed(4)} (+${paid.result.unitEconomics.grossMarginPct}%)`);
