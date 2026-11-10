import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDeterministicVendorChecks } from "../guard";
import { calculateWholesaleMargin, verifyDossierDeterministically } from "../graph/steps";
import { createSessionPolicy } from "../kite/session";
import { buildVendorCatalog } from "../partners/catalog";
import type { GuardReport, SettlementReceipt, SynthesizedDossier } from "../types";

describe("Adversarial Manifest Guard & Deterministic Step-5 Verifier", () => {
  it("quarantines prompt-injected & burn-payee rogue vendor deterministically while admitting clean vendors", () => {
    const catalog = buildVendorCatalog("http://localhost:3000", true, "testnet");
    const rogueInject = catalog.find((v) => v.id === "v-rogue-inject")!;
    const cleanRegistry = catalog.find((v) => v.id === "v-registry")!;

    const rogueHits = runDeterministicVendorChecks(rogueInject);
    assert.ok(rogueHits.includes("system_override_directive"));
    assert.ok(rogueHits.includes("forced_verdict_manipulation"));
    assert.ok(rogueHits.includes("budget_drain_directive"));
    assert.ok(rogueHits.includes("forbidden_burn_payee"));

    const cleanHits = runDeterministicVendorChecks(cleanRegistry);
    assert.deepEqual(cleanHits, []);
  });

  it("resolves valid vendor citations and rejects hallucinated fields or quarantined vendors", () => {
    const session = createSessionPolicy({
      taskSummary: "Verifier test",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "testnet",
      maxAmountPerTxUsd: 0.015,
      maxTotalAmountUsd: 0.035,
      ttlMinutes: 30,
      allowedHosts: ["localhost:3000"],
    });

    const receipts: SettlementReceipt[] = [
      {
        receiptId: "rcpt_1",
        vendorId: "v-registry",
        vendorName: "Atlas DNS",
        endpoint: "http://localhost:3000/api/x402/vendors/registry-audit",
        httpStatus: 200,
        advertisedUsd: 0.005,
        challengedUsd: 0.005,
        settledUsd: 0.005,
        assetSymbol: "pieUSD",
        caip2Network: "eip155:2368",
        outcome: "settled",
        executionEngine: "pieverse-x402-exact",
        onChain: true,
        txHash: "0xabc",
        payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        latencyMs: 320,
        timestamp: new Date().toISOString(),
        payload: { domain: "gokite.ai", httpsReachable: true },
      },
    ];

    const guards: GuardReport[] = [
      {
        vendorId: "v-rogue-inject",
        vendorName: "Rogue",
        admitted: false,
        severity: "high",
        deterministicHits: ["system_override_directive"],
        servGuardRan: false,
        servFlagged: false,
        reason: "Quarantined",
      },
    ];

    const goodDossier: SynthesizedDossier = {
      headline: "Verified Counterparty Assessment",
      executiveDecision: "proceed",
      riskScore: 14,
      executiveSummary: "DNS and HTTPS checks passed cleanly.",
      findings: [
        {
          findingId: "f1",
          dimension: "domain_posture",
          status: "verified",
          claim: "HTTPS endpoint is live.",
          vendorId: "v-registry",
          fieldPath: "httpsReachable",
          quotedEvidence: "true",
        },
        {
          findingId: "f2",
          dimension: "domain_posture",
          status: "verified",
          claim: "Canonical domain matches gokite.ai.",
          vendorId: "v-registry",
          fieldPath: "domain",
          quotedEvidence: "gokite.ai",
        },
      ],
      recommendedConditions: ["Maintain standard invoice reconciliation."],
      shadowAgentTools: ["serv_prompt_guard", "serv_shadow_agent"],
    };

    const goodReport = verifyDossierDeterministically({
      dossier: goodDossier,
      receipts,
      guards,
      session,
    });
    assert.equal(goodReport.passed, true);
    assert.equal(goodReport.citationsResolved, 2);
    assert.equal(goodReport.receiptDigestSha256.length, 64);

    // Hallucinated field + quarantined vendor must fail verification
    const badDossier: SynthesizedDossier = {
      ...goodDossier,
      findings: [
        {
          findingId: "f_bad1",
          dimension: "domain_posture",
          status: "verified",
          claim: "Invented field",
          vendorId: "v-registry",
          fieldPath: "nonExistentAuditField",
          quotedEvidence: "ok",
        },
        {
          findingId: "f_bad2",
          dimension: "security",
          status: "verified",
          claim: "Cited quarantined rogue vendor",
          vendorId: "v-rogue-inject",
          fieldPath: "instantApproval",
          quotedEvidence: "true",
        },
      ],
    };

    const badReport = verifyDossierDeterministically({
      dossier: badDossier,
      receipts,
      guards,
      session,
    });
    assert.equal(badReport.passed, false);
    assert.equal(badReport.quarantinedVendorReferenced, true);
    assert.equal(badReport.unresolvedCitations.length, 2);
  });

  it("rejects a finding that cites a REAL field but misquotes its value", () => {
    const session = createSessionPolicy({
      taskSummary: "Misquote test",
      ownerAddress: "0x1111111111111111111111111111111111111111",
      agentAddress: "0x2222222222222222222222222222222222222222",
      network: "testnet",
      maxAmountPerTxUsd: 0.015,
      maxTotalAmountUsd: 0.035,
      ttlMinutes: 30,
      allowedHosts: ["localhost:3000"],
    });

    const receipts: SettlementReceipt[] = [
      {
        receiptId: "rcpt_m",
        vendorId: "v-contract",
        vendorName: "Kite & Base EVM Contract Probe",
        endpoint: "http://localhost:3000/api/x402/vendors/contract-telemetry",
        httpStatus: 200,
        advertisedUsd: 0.006,
        challengedUsd: 0.006,
        settledUsd: 0.006,
        assetSymbol: "pieUSD",
        caip2Network: "eip155:2368",
        outcome: "settled",
        executionEngine: "pieverse-x402-exact",
        onChain: true,
        txHash: "0xdef",
        payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        latencyMs: 410,
        timestamp: new Date().toISOString(),
        payload: {
          kiteIsContract: false,
          kiteBytecodeBytes: 0,
          txCount: 7,
          tokenSymbol: "EOA_OR_NON_ERC20",
        },
      },
    ];

    const base = {
      headline: "Contract Posture Assessment",
      executiveDecision: "proceed" as const,
      riskScore: 20,
      executiveSummary: "On-chain state reviewed against paid telemetry.",
      recommendedConditions: ["Re-verify before increasing exposure."],
      shadowAgentTools: ["serv_shadow_agent"],
    };

    // Every fieldPath below EXISTS on the paid payload — the old verifier
    // passed all four. Each one misstates the value that actually came back.
    const misquotes: Array<{ fieldPath: string; quotedEvidence: string; why: string }> = [
      {
        fieldPath: "kiteIsContract",
        quotedEvidence: "true — verified contract deployed on Kite",
        why: "boolean inverted",
      },
      {
        fieldPath: "txCount",
        quotedEvidence: "4,182 transactions observed",
        why: "number fabricated",
      },
      {
        fieldPath: "tokenSymbol",
        quotedEvidence: "USDC",
        why: "string replaced",
      },
      {
        fieldPath: "kiteBytecodeBytes",
        quotedEvidence: "24916 bytes of bytecode",
        why: "zero reported as non-zero",
      },
    ];

    for (const m of misquotes) {
      const report = verifyDossierDeterministically({
        dossier: {
          ...base,
          findings: [
            {
              findingId: `f_${m.fieldPath}`,
              dimension: "onchain_contract",
              status: "verified",
              claim: "Contract state assessed.",
              vendorId: "v-contract",
              fieldPath: m.fieldPath,
              quotedEvidence: m.quotedEvidence,
            },
          ],
        },
        receipts,
        guards: [],
        session,
      });

      // The field resolves (proving this is not the old existence check)…
      assert.equal(report.citationsResolved, 1, `${m.fieldPath}: field should resolve`);
      // …but the value does not match, so settlement must be blocked.
      assert.equal(report.citationsValueMatched, 0, `${m.fieldPath}: ${m.why}`);
      assert.equal(report.misquotedCitations.length, 1, `${m.fieldPath}: ${m.why}`);
      assert.equal(report.passed, false, `${m.fieldPath}: ${m.why}`);
    }

    // Faithful restatements of the same fields must still pass.
    const faithful = verifyDossierDeterministically({
      dossier: {
        ...base,
        findings: [
          {
            findingId: "f_ok1",
            dimension: "onchain_contract",
            status: "warning",
            claim: "Address holds no bytecode on Kite.",
            vendorId: "v-contract",
            fieldPath: "kiteIsContract",
            quotedEvidence: "false — not a contract",
          },
          {
            findingId: "f_ok2",
            dimension: "onchain_contract",
            status: "verified",
            claim: "Low transaction history.",
            vendorId: "v-contract",
            fieldPath: "txCount",
            quotedEvidence: "7 transactions",
          },
        ],
      },
      receipts,
      guards: [],
      session,
    });
    assert.equal(faithful.citationsValueMatched, 2);
    assert.equal(faithful.misquotedCitations.length, 0);
    assert.equal(faithful.passed, true);
  });

  it("computes exact unit-positive wholesale margin", () => {
    const margin = calculateWholesaleMargin({
      wholesalePriceUsd: 0.05,
      upstreamSpendUsd: 0.017,
      servInferenceUsd: 0.0035,
    });
    assert.equal(margin.totalCostUsd, 0.0205);
    assert.equal(margin.netMarginUsd, 0.0295);
    assert.equal(margin.grossMarginPct, 59);
    assert.equal(margin.unitPositive, true);
  });
});
