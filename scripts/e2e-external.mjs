/**
 * Live third-party x402 merchant procurement proof.
 *
 * Proves four things against REAL independent merchants (Otto AI,
 * PrintMoneyLab, IP402 — discovered via Kite `ksearch`), with no fixtures:
 *
 *   1. Their live HTTP 402 `PAYMENT-REQUIRED` headers decode, and the price,
 *      payee and settlement chain we read are the ones they actually serve.
 *   2. A Kite mandate that authorizes ONLY Kite refuses every one of them with
 *      `session_asset_forbidden` — a real merchant gets no extra trust.
 *   3. A mandate that explicitly authorizes Base USDC admits them.
 *   4. A per-transaction cap below the merchant's price still refuses them,
 *      so "real merchant" never means "unbounded spend".
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/e2e-external.mjs
 */

import assert from "node:assert/strict";
import { createSessionPolicy } from "../src/lib/kite/session.ts";
import {
  EXTERNAL_MERCHANTS,
  probeExternalMerchant,
  procureFromExternalMerchant,
} from "../src/lib/partners/external-merchants.ts";
import { getExternalSettlementMode } from "../src/lib/kite/wallets.ts";

const MANDATE = {
  entity: "gokite.ai / gokite-ai",
  identifier: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const OWNER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

function session(opts) {
  return createSessionPolicy({
    taskSummary: "External merchant procurement proof",
    ownerAddress: OWNER,
    agentAddress: AGENT,
    network: "testnet",
    maxAmountPerTxUsd: opts.maxPerTx,
    maxTotalAmountUsd: opts.maxTotal,
    ttlMinutes: 15,
    allowedHosts: opts.hosts,
    additionalNetworks: opts.networks,
  });
}

const EXTERNAL_HOSTS = [
  "x402.ottoai.services",
  "api.printmoneylab.com",
  "ip402.xyz",
];

console.log(`\nBROKR_EXTERNAL_SETTLEMENT = ${getExternalSettlementMode()}\n`);

// ── 1. Read what the real merchants actually demand ─────────────────────────
console.log("1. Live 402 challenges from independent merchants (Base-authorized mandate)");
const baseSession = session({
  maxPerTx: 0.01,
  maxTotal: 0.05,
  hosts: EXTERNAL_HOSTS,
  networks: ["eip155:8453"],
});

let reachableCount = 0;
let admittedCount = 0;
const observed = [];

for (const merchant of EXTERNAL_MERCHANTS) {
  const probe = await probeExternalMerchant({
    merchant,
    session: baseSession,
    mandate: MANDATE,
  });
  observed.push(probe);
  if (probe.reachable) reachableCount += 1;
  if (probe.matchedCaip2) admittedCount += 1;

  const price =
    probe.challengedUsd === null ? "n/a" : `$${probe.challengedUsd.toFixed(4)}`;
  console.log(
    `   ${probe.reachable ? "✔" : "✖"} ${merchant.name.padEnd(34)} HTTP ${String(
      probe.httpStatus,
    ).padEnd(4)} ${price.padEnd(9)} ${probe.matchedCaip2 ?? "—"}`,
  );
  if (probe.offeredNetworks.length > 0) {
    console.log(`        offers: ${probe.offeredNetworks.join(", ")}`);
  }
  console.log(`        ${probe.note}`);
}

assert.ok(reachableCount > 0, "at least one external merchant must be reachable");
assert.ok(
  admittedCount > 0,
  "at least one external merchant must offer an asset this mandate authorizes",
);

// Prices must be real numbers read off the wire, not our advertised guesses.
const priced = observed.filter((p) => p.challengedUsd && p.challengedUsd > 0);
assert.ok(priced.length > 0, "expected at least one priced 402 challenge");
for (const p of priced) {
  assert.ok(p.payTo && /^0x[a-fA-F0-9]{40}$/.test(p.payTo), `${p.merchantId}: real payee`);
}
console.log(
  `\n   → ${reachableCount}/${EXTERNAL_MERCHANTS.length} reachable, ${admittedCount} payable under mandate, cheapest $${Math.min(
    ...priced.map((p) => p.challengedUsd),
  ).toFixed(4)}\n`,
);

// ── 2. A Kite-only mandate must refuse all of them ─────────────────────────
console.log("2. Kite-only mandate (no Base authorization) must refuse every merchant");
const kiteOnly = session({ maxPerTx: 0.01, maxTotal: 0.05, hosts: EXTERNAL_HOSTS });

for (const merchant of EXTERNAL_MERCHANTS) {
  const probe = await probeExternalMerchant({
    merchant,
    session: kiteOnly,
    mandate: MANDATE,
  });
  if (probe.httpStatus !== 402) continue; // free resource, nothing to refuse
  assert.equal(
    probe.matchedCaip2,
    null,
    `${merchant.id} must NOT match a Kite-only mandate`,
  );

  const receipt = await procureFromExternalMerchant({
    merchant,
    session: kiteOnly,
    mandate: MANDATE,
  });
  assert.equal(receipt.outcome, "blocked_policy", `${merchant.id} must be blocked`);
  assert.equal(receipt.policyErrorCode, "session_asset_forbidden");
  assert.equal(receipt.settledUsd, 0);
  console.log(`   ✔ ${merchant.name.padEnd(34)} ${receipt.policyErrorCode}`);
}
assert.equal(kiteOnly.spentUsd, 0, "Kite-only mandate must have spent nothing");
console.log(`   → spentUsd = $${kiteOnly.spentUsd.toFixed(4)}\n`);

// ── 3. A cap below the merchant price must still refuse ────────────────────
console.log("3. Per-transaction cap below merchant price must refuse (real merchant, still bounded)");
const tinyCap = session({
  maxPerTx: 0.0005,
  maxTotal: 0.05,
  hosts: EXTERNAL_HOSTS,
  networks: ["eip155:8453"],
});

let capBlocks = 0;
for (const merchant of EXTERNAL_MERCHANTS) {
  const receipt = await procureFromExternalMerchant({
    merchant,
    session: tinyCap,
    mandate: MANDATE,
  });
  if (receipt.policyErrorCode === "session_rule_exceeded") {
    capBlocks += 1;
    console.log(
      `   ✔ ${merchant.name.padEnd(34)} demanded $${receipt.challengedUsd.toFixed(
        4,
      )} > $0.0005 cap → ${receipt.policyErrorCode}`,
    );
  }
}
assert.ok(capBlocks > 0, "at least one merchant must breach a $0.0005 per-tx cap");
assert.equal(tinyCap.spentUsd, 0, "cap-blocked mandate must have spent nothing");
console.log(`   → ${capBlocks} merchant(s) refused on price, spentUsd = $0.0000\n`);

// ── 4. Authorized + in-budget: settle for real, or state exactly why not ───
console.log("4. Authorized & in-budget purchase");
const mode = getExternalSettlementMode();
let settled = 0;

for (const merchant of EXTERNAL_MERCHANTS) {
  const receipt = await procureFromExternalMerchant({
    merchant,
    session: baseSession,
    mandate: MANDATE,
  });

  if (receipt.outcome === "settled" && receipt.settledUsd > 0) {
    settled += 1;
    console.log(
      `   ✔ PAID ${merchant.name} $${receipt.settledUsd.toFixed(4)} ${
        receipt.settlementAssetSymbol ?? ""
      } on ${receipt.settlementNetwork ?? ""}${
        receipt.txHash ? ` tx ${receipt.txHash}` : ""
      }`,
    );
    if (receipt.explorerUrl) console.log(`        ${receipt.explorerUrl}`);
    assert.ok(receipt.payload, "a paid call must return a payload");
  } else {
    console.log(`   · ${merchant.name.padEnd(34)} ${receipt.outcome}`);
    console.log(`        ${receipt.policyHint ?? ""}`);
  }
}

if (mode !== "on") {
  assert.equal(
    settled,
    0,
    "preflight mode must never settle — no value may move without explicit opt-in",
  );
  console.log(
    `\n   → mode "${mode}": mandate authorized these purchases but produced NO signature.`,
  );
  console.log("     Set BROKR_EXTERNAL_SETTLEMENT=on with a funded Base USDC wallet to settle.\n");
} else {
  console.log(`\n   → settled ${settled} real third-party purchase(s)\n`);
}

console.log("✅ External merchant procurement proof passed\n");
