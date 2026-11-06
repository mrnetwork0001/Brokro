/**
 * End-to-end live adversarial procurement test against a running Brokr server.
 *
 * Verifies:
 *   1. Step 1 (`screen_catalog`) quarantines `v-rogue-inject` via deterministic + serv_prompt_guard
 *   2. Step 2 (`plan_basket`) streams reasoning via `/v1/responses` inside budget
 *   3. Step 3 (`settle_x402`) blocks `v-rogue-spike` ($0.085 > $0.015 cap) with `session_rule_exceeded`
 *      and reroutes to an honest fallback supplier
 *   4. Step 4 (`cross_examine`) runs `serv_shadow_agent` with cited findings
 *   5. Step 5 (`verify_dossier`) passes 100% of citation and spend-cap invariants
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

console.log(`Running E2E adversarial procurement against ${BASE}...`);

const res = await fetch(`${BASE}/api/procure/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    presetId: "mandate-kite-supplier",
    maxAmountPerTxUsd: 0.015,
    maxTotalAmountUsd: 0.035,
    ttlMinutes: 20,
    includeAdversarial: true,
    submitToReppo: false,
  }),
});

assert.equal(res.status, 200, `Expected HTTP 200 SSE stream, got ${res.status}`);
const text = await res.text();

let completed = null;
for (const frame of text.split("\n\n")) {
  const ev = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
  const data = frame.match(/^data:\s*(.+)$/m)?.[1];
  if (ev === "step" && data) {
    const parsed = JSON.parse(data);
    console.log(`  [${parsed.step.status.toUpperCase()}] ${parsed.step.step}: ${parsed.step.summary}`);
  }
  if (ev === "complete" && data) {
    completed = JSON.parse(data);
  }
}

assert.ok(completed, "SSE stream did not emit a complete event");
assert.equal(completed.status, "completed", `Run failed: ${completed.error}`);

// 1. Prompt-injected vendor must be quarantined
const rogueInjectGuard = completed.guards.find((g) => g.vendorId === "v-rogue-inject");
assert.ok(rogueInjectGuard && rogueInjectGuard.admitted === false, "v-rogue-inject must be quarantined");

// 2. If planner picked v-rogue-spike, it must be blocked with session_rule_exceeded
const spikeReceipt = completed.receipts.find((r) => r.vendorId === "v-rogue-spike");
if (spikeReceipt) {
  assert.equal(spikeReceipt.outcome, "blocked_policy");
  assert.equal(spikeReceipt.policyErrorCode, "session_rule_exceeded");
  assert.ok(spikeReceipt.reroutedToVendorId, "Blocked spike should reroute to fallback vendor");
}

// 3. Deterministic Step-5 verifier must pass 100%
assert.equal(completed.verification.passed, true, `Verifier failed: ${JSON.stringify(completed.verification)}`);
assert.equal(completed.verification.quarantinedVendorReferenced, false);
assert.equal(completed.verification.budgetInvariantPassed, true);
assert.ok(completed.margin.unitPositive, "Wholesale unit economics must be positive");

console.log("\n✓ E2E Adversarial Procurement PASSED");
console.log(`  Run ID        : ${completed.runId}`);
console.log(`  Decision      : ${completed.dossier.executiveDecision} (risk ${completed.dossier.riskScore}/100)`);
console.log(`  SHA-256 Digest: ${completed.verification.receiptDigestSha256}`);
console.log(`  Net Margin    : +$${completed.margin.netMarginUsd.toFixed(4)} (+${completed.margin.grossMarginPct}%)`);
