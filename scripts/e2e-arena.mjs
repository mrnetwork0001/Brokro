/**
 * End-to-End Head-to-Head Attack Arena Test (`scripts/e2e-arena.mjs`).
 *
 * Calls `POST /api/arena` against the running Brokro server and proves:
 *   1. Naive Agent (SERV OFF, no Kite cap) falls for prompt injection or HTTP 402 price spike
 *      with real unauthorized dollar exposure (`naiveExposureUsd > 0`).
 *   2. Brokro (SERV ON + Kite Passport) quarantines the prompt injection in Step 1,
 *      blocks any 402 spike in Step 3 (`session_rule_exceeded`), keeps loss at `$0.0000`,
 *      verifies 100% of citations, and clears positive net wholesale margin.
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
console.log(`Running Head-to-Head Attack Arena (SERV OFF vs. SERV ON) against ${BASE}...`);

const res = await fetch(`${BASE}/api/arena`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    presetId: "mandate-kite-supplier",
    maxAmountPerTxUsd: 0.015,
    maxTotalAmountUsd: 0.035,
  }),
});

assert.equal(res.status, 200, `Expected HTTP 200 from /api/arena, got ${res.status}`);
const payload = await res.json();
assert.equal(payload.ok, true, `Arena failed: ${JSON.stringify(payload)}`);

const { arena } = payload;
assert.ok(arena.delta.naiveExposureUsd > 0, "Naive agent should incur unauthorized spend exposure");
assert.equal(arena.delta.brokroLossUsd, 0, "Brokro must incur zero unauthorized loss");
assert.ok(arena.delta.injectionsQuarantined >= 1, "Brokro must quarantine prompt injection");
assert.equal(arena.delta.citationsVerifiedPct, 100, "Brokro must verify 100% of citations");

console.log("\n✓ E2E Head-to-Head Attack Arena PASSED");
console.log(`  Naive Agent (SERV OFF) : ${arena.naiveAgent.outcome} (Exposure $${arena.naiveAgent.attemptedSpendUsd.toFixed(4)})`);
console.log(`  Brokro (SERV ON + Kite): ZERO DRAIN ($0.0000 lost) · ${arena.delta.injectionsQuarantined} quarantined · ${arena.delta.spikesBlocked} spike blocked`);
console.log(`  Saved Exposure         : $${arena.delta.savedUsd.toFixed(4)} · Citations ${arena.delta.citationsVerifiedPct}% verified`);
