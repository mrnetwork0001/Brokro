/**
 * 5-Way Concurrent Spend Race Test (`scripts/e2e-race.mjs`).
 *
 * Fires 5 simultaneous `procureFromX402Vendor` calls ($0.005 each) against a
 * single Kite `SessionPolicy` with `maxTotalAmountUsd = $0.012` against the
 * live server, proving that at most 2 calls ($0.010) settle and 3 are blocked
 * with `session_total_exceeded` before signing.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createSessionPolicy } from "../src/lib/kite/session.ts";
import { getBuyerAccount } from "../src/lib/kite/wallets.ts";
import { procureFromX402Vendor } from "../src/lib/kite/x402-buyer.ts";
import { buildVendorCatalog } from "../src/lib/partners/catalog.ts";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const BASE = process.env.BROKR_URL || "http://127.0.0.1:3099";
const host = new URL(BASE).host.toLowerCase();
const buyer = getBuyerAccount();

const session = createSessionPolicy({
  taskSummary: "5-way concurrent race verification",
  ownerAddress: buyer.address,
  agentAddress: buyer.address,
  network: "testnet",
  maxAmountPerTxUsd: 0.01,
  maxTotalAmountUsd: 0.012, // Fits at most 2 x $0.005 ($0.010 <= $0.012)
  ttlMinutes: 15,
  allowedHosts: [host],
});

const vendor = buildVendorCatalog(BASE, false, "testnet").find(
  (v) => v.id === "v-registry",
);
assert.ok(vendor);

console.log(`Firing 5 concurrent $0.005 x402 calls against $0.012 session cap on ${BASE}...`);
const results = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    procureFromX402Vendor({
      vendor,
      session,
      queryParams: { entity: `gokite.ai`, identifier: `0x000000000000000000000000000000000000000${i + 1}` },
    }),
  ),
);

const settled = results.filter((r) => r.outcome === "settled");
const blocked = results.filter((r) => r.outcome === "blocked_policy");

assert.equal(settled.length, 2, `Expected 2 settled calls, got ${settled.length}`);
assert.equal(blocked.length, 3, `Expected 3 blocked calls, got ${blocked.length}`);
for (const b of blocked) {
  assert.equal(b.policyErrorCode, "session_total_exceeded");
}
assert.equal(session.spentUsd, 0.01);

console.log(`✓ 5-Way Concurrency Race PASSED: ${settled.length} settled ($${session.spentUsd.toFixed(4)}), ${blocked.length} blocked (session_total_exceeded).`);
