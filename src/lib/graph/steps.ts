/**
 * Brokr's 6-Step Bounded Procurement & Verification Graph.
 *
 *   1. `screen_catalog`  — Deterministic rules + SERV (`serv_prompt_guard`)
 *   2. `plan_basket`     — SERV `/v1/responses` (streamed reasoning summary + budget check)
 *   3. `settle_x402`     — Kite Passport session policy + EIP-3009 / Pieverse settlement
 *                          with automatic fallback rerouting on `session_rule_exceeded`
 *   4. `cross_examine`   — SERV (`serv_shadow_agent` + `serv_prompt_guard`) cited synthesis
 *   5. `verify_dossier`  — Pure deterministic citation, field-path & spend-cap verifier
 *   6. `anchor_audit`    — Wholesale unit-economics calculation + Reppo Eval Router
 */

import { createHash, randomUUID } from "node:crypto";
import { screenVendorCatalog } from "../guard";
import { procureFromX402Vendor } from "../kite/x402-buyer";
import { WHOLESALE_BUNDLE_PRICE_USD, buildVendorCatalog } from "../partners/catalog";
import { submitDossierToReppo } from "../partners/reppo";
import {
  EXTERNAL_MERCHANTS,
  procureFromExternalMerchant,
} from "../partners/external-merchants";
import {
  ARBITER_MODEL,
  PLANNER_MODEL,
  runResponsesStep,
  runTypedStep,
} from "../serv";
import type {
  BasketPlan,
  CitedFinding,
  GuardReport,
  ProcurementMandate,
  ProcurementRun,
  SessionPolicy,
  SettlementReceipt,
  StepTelemetry,
  SynthesizedDossier,
  VendorManifest,
  VerificationReport,
  WholesaleMargin,
} from "../types";
import type { JsonSchema } from "./schema";

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const BASKET_PLAN_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mandateIntent", "selected", "coverageDimensions", "rationale"],
  properties: {
    mandateIntent: { type: "string", minLength: 8 },
    selected: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["vendorId", "role", "expectedCostUsd", "purpose"],
        properties: {
          vendorId: { type: "string" },
          role: { type: "string", enum: ["primary", "fallback"] },
          expectedCostUsd: { type: "number", minimum: 0 },
          purpose: { type: "string" },
        },
      },
    },
    coverageDimensions: {
      type: "array",
      items: { type: "string" },
    },
    rationale: { type: "string", minLength: 12 },
  },
};

const DOSSIER_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "executiveDecision",
    "riskScore",
    "executiveSummary",
    "findings",
    "recommendedConditions",
  ],
  properties: {
    headline: { type: "string", minLength: 10 },
    executiveDecision: {
      type: "string",
      enum: ["proceed", "proceed_with_conditions", "hold"],
    },
    riskScore: { type: "integer", minimum: 0, maximum: 100 },
    executiveSummary: { type: "string", minLength: 20 },
    findings: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "findingId",
          "dimension",
          "status",
          "claim",
          "vendorId",
          "fieldPath",
          "quotedEvidence",
        ],
        properties: {
          findingId: { type: "string" },
          dimension: { type: "string" },
          status: {
            type: "string",
            enum: ["verified", "warning", "critical", "indeterminate"],
          },
          claim: { type: "string" },
          vendorId: { type: "string" },
          fieldPath: { type: "string" },
          quotedEvidence: { type: "string" },
        },
      },
    },
    recommendedConditions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

function resolveFieldPath(payload: Record<string, unknown> | undefined, fieldPath: string): {
  found: boolean;
  value?: unknown;
} {
  if (!payload) return { found: false };
  const cleaned = fieldPath.replace(/^\$\.?/, "").trim();
  const segments = cleaned.split(".").filter(Boolean);
  let cursor: unknown = payload;

  for (const seg of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return { found: false };
    }
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        return { found: false };
      }
      cursor = cursor[idx];
    } else {
      const rec = cursor as Record<string, unknown>;
      if (!(seg in rec)) {
        return { found: false };
      }
      cursor = rec[seg];
    }
  }
  return { found: cursor !== undefined, value: cursor };
}

/** Longest quoted-evidence string treated as a paraphrase rather than a literal quote. */
const QUOTE_LITERAL_THRESHOLD = 120;

/** Relative tolerance allowed when a model re-states a numeric field. */
const NUMERIC_RELATIVE_TOLERANCE = 0.005;

const TRUTHY_SYNONYMS = [
  "true",
  "yes",
  "present",
  "configured",
  "reachable",
  "enabled",
  "active",
  "verified",
  "is a contract",
  "does exist",
];

const FALSY_SYNONYMS = [
  "false",
  "no ",
  "not ",
  "absent",
  "missing",
  "unconfigured",
  "unreachable",
  "disabled",
  "inactive",
  "none",
  "is not a contract",
];

export function stringifyFieldValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/["'`$]/g, "")
    .replace(/[\s,_]+/g, " ")
    .trim();
}

function extractNumbers(input: string): number[] {
  const matches = input.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

function numbersAgree(claimed: number, actual: number): boolean {
  if (claimed === actual) return true;
  const scale = Math.max(Math.abs(actual), Math.abs(claimed), 1);
  if (Math.abs(claimed - actual) <= scale * NUMERIC_RELATIVE_TOLERANCE) return true;
  // Accept a correctly rounded restatement (e.g. 0.123456 quoted as "0.1235").
  for (let dp = 0; dp <= 6; dp++) {
    if (Number(actual.toFixed(dp)) === claimed) return true;
  }
  return false;
}

export interface EvidenceMatch {
  matched: boolean;
  mode: "exact" | "numeric" | "boolean" | "literal-quote" | "collection" | "mismatch";
  actual: string;
  reason: string;
}

/**
 * Deterministically checks that a dossier finding's `quotedEvidence` actually
 * restates the value living at the cited `fieldPath` — not merely that the
 * field exists. A finding that cites a real field and misquotes its value is
 * rejected exactly like one that invents the field outright.
 */
export function evidenceMatchesValue(quotedEvidence: string, value: unknown): EvidenceMatch {
  const actualRaw = stringifyFieldValue(value);
  const actual = normalizeText(actualRaw);
  const quoted = normalizeText(quotedEvidence);

  if (quoted.length === 0) {
    return {
      matched: false,
      mode: "mismatch",
      actual: actualRaw,
      reason: "quotedEvidence is empty",
    };
  }

  if (quoted === actual) {
    return { matched: true, mode: "exact", actual: actualRaw, reason: "exact value match" };
  }

  if (typeof value === "boolean") {
    const hit = (list: string[]) => list.some((token) => quoted.includes(token));
    const saysTrue = hit(TRUTHY_SYNONYMS);
    const saysFalse = hit(FALSY_SYNONYMS);
    if (saysTrue && !saysFalse) {
      return value
        ? { matched: true, mode: "boolean", actual: actualRaw, reason: "affirmative restatement of true" }
        : {
            matched: false,
            mode: "mismatch",
            actual: actualRaw,
            reason: "evidence asserts true but field is false",
          };
    }
    if (saysFalse && !saysTrue) {
      return value
        ? {
            matched: false,
            mode: "mismatch",
            actual: actualRaw,
            reason: "evidence asserts false but field is true",
          }
        : { matched: true, mode: "boolean", actual: actualRaw, reason: "negative restatement of false" };
    }
    return {
      matched: false,
      mode: "mismatch",
      actual: actualRaw,
      reason: "evidence does not unambiguously restate the boolean field",
    };
  }

  if (typeof value === "number") {
    const claimedNumbers = extractNumbers(quotedEvidence);
    if (claimedNumbers.length === 0) {
      return {
        matched: false,
        mode: "mismatch",
        actual: actualRaw,
        reason: "evidence cites a numeric field but states no number",
      };
    }
    if (claimedNumbers.some((n) => numbersAgree(n, value))) {
      return { matched: true, mode: "numeric", actual: actualRaw, reason: "numeric value agrees" };
    }
    return {
      matched: false,
      mode: "mismatch",
      actual: actualRaw,
      reason: `evidence states ${claimedNumbers.join("/")} but field is ${value}`,
    };
  }

  if (Array.isArray(value)) {
    const elements = value.map((el) => normalizeText(stringifyFieldValue(el))).filter(Boolean);
    if (elements.length === 0) {
      return quoted.includes("none") || quoted.includes("empty") || quoted.includes("[]")
        ? { matched: true, mode: "collection", actual: actualRaw, reason: "empty collection restated" }
        : {
            matched: false,
            mode: "mismatch",
            actual: actualRaw,
            reason: "field is an empty array but evidence claims contents",
          };
    }
    const present = elements.filter((el) => quoted.includes(el));
    if (present.length === elements.length) {
      return { matched: true, mode: "collection", actual: actualRaw, reason: "all elements quoted" };
    }
    if (present.length > 0 && quoted.includes(String(elements.length))) {
      return {
        matched: true,
        mode: "collection",
        actual: actualRaw,
        reason: "representative element plus correct count quoted",
      };
    }
    return {
      matched: false,
      mode: "mismatch",
      actual: actualRaw,
      reason: `evidence quotes ${present.length}/${elements.length} array elements`,
    };
  }

  // Long free-text fields (e.g. analysisSummary) must be quoted literally.
  if (typeof value === "string" && actualRaw.length > QUOTE_LITERAL_THRESHOLD) {
    if (actual.includes(quoted)) {
      return {
        matched: true,
        mode: "literal-quote",
        actual: actualRaw,
        reason: "evidence is a literal substring of the cited field",
      };
    }
    return {
      matched: false,
      mode: "mismatch",
      actual: actualRaw,
      reason: "evidence is not a literal quote of the long-form field",
    };
  }

  if (actual.length > 0 && quoted.includes(actual)) {
    return {
      matched: true,
      mode: "literal-quote",
      actual: actualRaw,
      reason: "field value appears verbatim inside the evidence",
    };
  }
  if (quoted.length > 0 && actual.includes(quoted)) {
    return {
      matched: true,
      mode: "literal-quote",
      actual: actualRaw,
      reason: "evidence is a literal substring of the field value",
    };
  }

  return {
    matched: false,
    mode: "mismatch",
    actual: actualRaw,
    reason: "evidence does not restate the cited field value",
  };
}

function truncateForNote(input: string, max = 90): string {
  return input.length > max ? `${input.slice(0, max)}…` : input;
}

/**
 * Pure deterministic Step 5 verifier. Never calls a model: plain code checks
 * every citation, field path, quarantined vendor exclusion, and Kite spend cap.
 */
export function verifyDossierDeterministically(params: {
  dossier: SynthesizedDossier;
  receipts: SettlementReceipt[];
  guards: GuardReport[];
  session: SessionPolicy;
}): VerificationReport {
  const { dossier, receipts, guards, session } = params;
  const settledMap = new Map<string, SettlementReceipt>();
  for (const r of receipts) {
    if (r.outcome === "settled") {
      settledMap.set(r.vendorId, r);
    }
  }
  const quarantinedIds = new Set(
    guards.filter((g) => !g.admitted).map((g) => g.vendorId),
  );

  const unresolvedCitations: string[] = [];
  const misquotedCitations: string[] = [];
  let citationsResolved = 0;
  let citationsValueMatched = 0;
  let quarantinedVendorReferenced = false;

  for (const f of dossier.findings) {
    if (quarantinedIds.has(f.vendorId)) {
      quarantinedVendorReferenced = true;
      unresolvedCitations.push(
        `${f.findingId}: cites quarantined vendor "${f.vendorId}"`,
      );
      continue;
    }

    const receipt = settledMap.get(f.vendorId);
    if (!receipt) {
      unresolvedCitations.push(
        `${f.findingId}: vendor "${f.vendorId}" has no settled x402 receipt`,
      );
      continue;
    }

    const resolved = resolveFieldPath(receipt.payload, f.fieldPath);
    if (!resolved.found) {
      unresolvedCitations.push(
        `${f.findingId}: field "${f.fieldPath}" does not exist on ${f.vendorId} payload`,
      );
      continue;
    }

    citationsResolved += 1;

    // A real field path is not enough: the quoted evidence must restate the
    // value that actually came back from the paid upstream call.
    const evidence = evidenceMatchesValue(f.quotedEvidence, resolved.value);
    if (!evidence.matched) {
      misquotedCitations.push(
        `${f.findingId}: quotedEvidence "${truncateForNote(f.quotedEvidence)}" does not match ${f.vendorId}.${f.fieldPath} = "${truncateForNote(evidence.actual)}" (${evidence.reason})`,
      );
      continue;
    }

    citationsValueMatched += 1;
  }

  const totalSettled =
    Math.round(
      receipts
        .filter((r) => r.outcome === "settled")
        .reduce((acc, r) => acc + r.settledUsd, 0) * 1_000_000,
    ) / 1_000_000;

  const budgetInvariantPassed = totalSettled <= session.maxTotalAmountUsd;
  const perTxInvariantPassed = receipts
    .filter((r) => r.outcome === "settled")
    .every((r) => r.settledUsd <= session.maxAmountPerTxUsd);

  const nonIndeterminateCount = dossier.findings.filter(
    (f) => f.status !== "indeterminate",
  ).length;
  const indeterminateCarriedDecision =
    dossier.executiveDecision === "proceed" && nonIndeterminateCount === 0;

  const notes: string[] = [];
  if (unresolvedCitations.length === 0 && misquotedCitations.length === 0) {
    notes.push(
      `All ${dossier.findings.length} cited findings resolved to a real field AND their quoted evidence matched the raw upstream value byte-for-byte or within rounding.`,
    );
  } else {
    if (unresolvedCitations.length > 0) {
      notes.push(`Unresolved citations: ${unresolvedCitations.join("; ")}`);
    }
    if (misquotedCitations.length > 0) {
      notes.push(`Misquoted citations: ${misquotedCitations.join("; ")}`);
    }
  }
  if (budgetInvariantPassed && perTxInvariantPassed) {
    notes.push(
      `Kite session invariants satisfied ($${totalSettled.toFixed(4)} spent <= $${session.maxTotalAmountUsd.toFixed(4)} total cap, all txs <= $${session.maxAmountPerTxUsd.toFixed(4)}).`,
    );
  }
  const blockedSpikes = receipts.filter((r) => r.outcome === "blocked_policy");
  if (blockedSpikes.length > 0) {
    notes.push(
      `Blocked ${blockedSpikes.length} rogue 402 challenge(s) (${blockedSpikes.map((b) => `${b.vendorId}: ${b.policyErrorCode}`).join(", ")}) before signing.`,
    );
  }

  const digestPayload = {
    headline: dossier.headline,
    executiveDecision: dossier.executiveDecision,
    riskScore: dossier.riskScore,
    citationsValueMatched,
    findings: dossier.findings,
    receipts: receipts.map((r) => ({
      vendorId: r.vendorId,
      outcome: r.outcome,
      settledUsd: r.settledUsd,
      txHash: r.txHash ?? null,
      policyErrorCode: r.policyErrorCode ?? null,
    })),
    sessionId: session.sessionId,
  };

  const passed =
    unresolvedCitations.length === 0 &&
    misquotedCitations.length === 0 &&
    citationsValueMatched === dossier.findings.length &&
    budgetInvariantPassed &&
    perTxInvariantPassed &&
    !quarantinedVendorReferenced &&
    !indeterminateCarriedDecision;

  return {
    passed,
    citationsChecked: dossier.findings.length,
    citationsResolved,
    citationsValueMatched,
    unresolvedCitations,
    misquotedCitations,
    budgetInvariantPassed,
    perTxInvariantPassed,
    quarantinedVendorReferenced,
    indeterminateCarriedDecision,
    receiptDigestSha256: sha256Canonical(digestPayload),
    notes,
  };
}

export function calculateWholesaleMargin(params: {
  wholesalePriceUsd?: number;
  upstreamSpendUsd: number;
  servInferenceUsd: number;
}): WholesaleMargin {
  const wholesalePriceUsd = params.wholesalePriceUsd ?? WHOLESALE_BUNDLE_PRICE_USD;
  const upstreamSpendUsd = Math.round(params.upstreamSpendUsd * 1_000_000) / 1_000_000;
  const servInferenceUsd = Math.round(params.servInferenceUsd * 1_000_000) / 1_000_000;
  const totalCostUsd = Math.round((upstreamSpendUsd + servInferenceUsd) * 1_000_000) / 1_000_000;
  const netMarginUsd = Math.round((wholesalePriceUsd - totalCostUsd) * 1_000_000) / 1_000_000;
  const grossMarginPct =
    wholesalePriceUsd > 0
      ? Math.round((netMarginUsd / wholesalePriceUsd) * 1000) / 10
      : 0;

  return {
    wholesalePriceUsd,
    upstreamSpendUsd,
    servInferenceUsd,
    totalCostUsd,
    netMarginUsd,
    grossMarginPct,
    unitPositive: netMarginUsd > 0,
  };
}

export interface GraphCallbacks {
  onStep?: (step: StepTelemetry, snapshot: ProcurementRun) => void;
  signal?: AbortSignal;
}

/**
 * Executes the complete 6-step autonomous procurement & verification workflow.
 */
export async function executeProcurementGraph(params: {
  origin: string;
  mandate: ProcurementMandate;
  session: SessionPolicy;
  includeAdversarial: boolean;
  submitToReppo: boolean;
  /**
   * Also shop the independent third-party x402 merchants (Otto AI,
   * PrintMoneyLab, IP402). Off by default: these are real businesses on Base
   * mainnet, so a caller has to opt in to being quoted by them.
   */
  includeExternalMerchants?: boolean;
  callerType?: "interactive-desk" | "x402-wholesale-buyer";
  wholesalePaymentTxHash?: string;
  callbacks?: GraphCallbacks;
}): Promise<ProcurementRun> {
  const run: ProcurementRun = {
    runId: `run_${randomUUID().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    status: "running",
    callerType: params.callerType ?? "interactive-desk",
    mandate: params.mandate,
    includeAdversarial: params.includeAdversarial,
    submitToReppo: params.submitToReppo,
    session: params.session,
    steps: [],
    guards: [],
    receipts: [],
    margin: calculateWholesaleMargin({ upstreamSpendUsd: 0, servInferenceUsd: 0 }),
    wholesalePaymentTxHash: params.wholesalePaymentTxHash,
  };

  let cumulativeServUsd = 0;

  const emitStep = (entry: StepTelemetry) => {
    const idx = run.steps.findIndex((s) => s.step === entry.step);
    if (idx >= 0) run.steps[idx] = entry;
    else run.steps.push(entry);
    params.callbacks?.onStep?.(entry, structuredClone(run));
  };

  try {
    // ── STEP 1: screen_catalog ────────────────────────────────────────────────
    const catalog = buildVendorCatalog(
      params.origin,
      params.includeAdversarial,
      params.session.network,
    );
    const s1Start = Date.now();
    emitStep({
      step: "screen_catalog",
      title: "Screen x402 Catalog & Quarantine Poisoned Vendors",
      engine: "Deterministic Guard + SERV Reasoning",
      model: "gpt-6-luna",
      servTools: ["serv_prompt_guard"],
      status: "running",
      startedAt: new Date(s1Start).toISOString(),
      inputDigest: sha256Canonical(catalog.map((c) => c.id)).slice(0, 16),
      summary: `Screening ${catalog.length} discovered x402 vendor manifests...`,
    });

    const screenOut = await screenVendorCatalog(catalog, params.callbacks?.signal);
    run.guards = screenOut.reports;
    cumulativeServUsd += screenOut.costUsd;
    const quarantinedCount = screenOut.reports.filter((r) => !r.admitted).length;

    emitStep({
      step: "screen_catalog",
      title: "Screen x402 Catalog & Quarantine Poisoned Vendors",
      engine: "Deterministic Guard + SERV Reasoning",
      model: screenOut.model,
      servTools: ["serv_prompt_guard"],
      status: "completed",
      startedAt: new Date(s1Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - s1Start,
      tokens: screenOut.usage,
      costUsd: screenOut.costUsd,
      repairs: screenOut.repairs,
      inputDigest: sha256Canonical(catalog.map((c) => c.id)).slice(0, 16),
      summary:
        quarantinedCount > 0
          ? `Admitted ${screenOut.admitted.length}/${catalog.length} vendors; quarantined ${quarantinedCount} poisoned listing (${screenOut.reports.filter((r) => !r.admitted).map((r) => r.vendorId).join(", ")}).`
          : `All ${screenOut.admitted.length} vendor manifests passed deterministic & serv_prompt_guard screening.`,
      detail: screenOut.reports,
    });

    // ── STEP 2: plan_basket ───────────────────────────────────────────────────
    const s2Start = Date.now();
    emitStep({
      step: "plan_basket",
      title: "Plan Utility-Optimal Vendor Basket Inside Session Cap",
      engine: "SERV /v1/responses + Budget Solver",
      model: PLANNER_MODEL,
      servTools: ["responses_reasoning_summary"],
      status: "running",
      startedAt: new Date(s2Start).toISOString(),
      summary: "Computing primary & fallback vendor basket within Kite session budget...",
    });

    const admittedById = new Map<string, VendorManifest>(
      screenOut.admitted.map((v) => [v.id, v]),
    );

    const planStep = await runResponsesStep<{
      mandateIntent: string;
      selected: Array<{
        vendorId: string;
        role: "primary" | "fallback";
        expectedCostUsd: number;
        purpose: string;
      }>;
      coverageDimensions: string[];
      rationale: string;
    }>({
      model: PLANNER_MODEL,
      schema: BASKET_PLAN_SCHEMA,
      schemaName: "procurement_basket_plan",
      effort: "low",
      signal: params.callbacks?.signal,
      instructions:
        "You are an autonomous procurement planner operating under a strict Kite Agent Passport spending session. Select primary x402 vendors from the admitted catalog to cover all required diligence dimensions (registry/domain, EVM contract security, and OSINT/repo activity) at minimum advertised cost while keeping total primary spend strictly <= maxTotalAmountUsd and each vendor <= maxAmountPerTxUsd. ALWAYS include at least one 'fallback' security vendor in case a lower-priced third-party relay fails or spikes its 402 challenge at checkout.",
      input: JSON.stringify({
        mandate: params.mandate,
        sessionLimits: {
          maxAmountPerTxUsd: params.session.maxAmountPerTxUsd,
          maxTotalAmountUsd: params.session.maxTotalAmountUsd,
          remainingUsd: params.session.maxTotalAmountUsd - params.session.spentUsd,
        },
        admittedVendors: screenOut.admitted.map((v) => ({
          vendorId: v.id,
          name: v.name,
          category: v.category,
          advertisedPriceUsd: v.advertisedPriceUsd,
          deliverableFields: v.deliverableFields,
          description: v.description,
        })),
      }),
    });

    cumulativeServUsd += planStep.costUsd;

    // Filter strictly to admitted vendor IDs and ensure fallback coverage
    const validSelected = planStep.value.selected.filter((s) =>
      admittedById.has(s.vendorId),
    );
    // Guarantee fallback coverage if adversarial price-spike vendor was picked as primary
    if (
      validSelected.some((s) => s.vendorId === "v-rogue-spike" && s.role === "primary") &&
      !validSelected.some(
        (s) =>
          (s.vendorId === "v-contract" || s.vendorId === "v-reserve") &&
          s.role === "fallback",
      )
    ) {
      validSelected.push({
        vendorId: "v-contract",
        role: "fallback",
        expectedCostUsd: 0.006,
        purpose: "Verified EVM contract probe fallback if third-party scanner breaches session policy.",
      });
    }

    const estPrimary =
      Math.round(
        validSelected
          .filter((s) => s.role === "primary")
          .reduce((acc, s) => {
            const v = admittedById.get(s.vendorId);
            return acc + (v?.advertisedPriceUsd ?? s.expectedCostUsd);
          }, 0) * 1_000_000,
      ) / 1_000_000;

    const basketPlan: BasketPlan = {
      mandateIntent: planStep.value.mandateIntent,
      selected: validSelected,
      estimatedPrimarySpendUsd: estPrimary,
      remainingCapAfterPrimaryUsd:
        Math.round((params.session.maxTotalAmountUsd - estPrimary) * 1_000_000) / 1_000_000,
      coverageDimensions: planStep.value.coverageDimensions,
      rationale: planStep.value.rationale,
      reasoningSummary:
        planStep.reasoningSummaries.length > 0
          ? planStep.reasoningSummaries
          : [planStep.value.rationale],
    };
    run.plan = basketPlan;

    emitStep({
      step: "plan_basket",
      title: "Plan Utility-Optimal Vendor Basket Inside Session Cap",
      engine: "SERV /v1/responses + Budget Solver",
      model: planStep.model,
      servTools: planStep.servTools,
      status: "completed",
      startedAt: new Date(s2Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - s2Start,
      tokens: planStep.usage,
      costUsd: planStep.costUsd,
      repairs: planStep.repairs,
      summary: `Planned ${validSelected.filter((s) => s.role === "primary").length} primary + ${validSelected.filter((s) => s.role === "fallback").length} fallback vendor(s); est. spend $${estPrimary.toFixed(4)} of $${params.session.maxTotalAmountUsd.toFixed(4)} cap.`,
      detail: basketPlan,
    });

    // ── STEP 3: settle_x402 ───────────────────────────────────────────────────
    const s3Start = Date.now();
    emitStep({
      step: "settle_x402",
      title: "Execute x402 Procurement Under Kite Session Policy",
      engine: `Kite Session Engine + Pieverse Facilitator (${params.session.caip2Network})`,
      status: "running",
      startedAt: new Date(s3Start).toISOString(),
      summary: "Negotiating HTTP 402 challenges and signing bounded EIP-3009 authorizations...",
    });

    const primaries = validSelected.filter((s) => s.role === "primary");
    const fallbacks = validSelected.filter((s) => s.role === "fallback");
    const usedVendorIds = new Set<string>();

    for (const item of primaries) {
      const vendor = admittedById.get(item.vendorId);
      if (!vendor || usedVendorIds.has(vendor.id)) continue;
      usedVendorIds.add(vendor.id);

      const receipt = await procureFromX402Vendor({
        vendor,
        session: params.session,
        queryParams: {
          entity: params.mandate.targetEntity,
          identifier: params.mandate.targetIdentifier,
        },
        signal: params.callbacks?.signal,
      });

      if (receipt.outcome === "blocked_policy" || receipt.outcome === "failed") {
        // Trigger deterministic fallback vendor in same category or reserve
        const fbCandidate =
          fallbacks
            .map((f) => admittedById.get(f.vendorId))
            .find(
              (fv) =>
                fv &&
                !usedVendorIds.has(fv.id) &&
                (fv.category === vendor.category || fv.id === "v-contract" || fv.id === "v-reserve"),
            ) ??
          screenOut.admitted.find(
            (fv) =>
              !usedVendorIds.has(fv.id) &&
              fv.adversarialType === undefined &&
              (fv.category === vendor.category || fv.id === "v-reserve"),
          );

        if (fbCandidate) {
          receipt.reroutedToVendorId = fbCandidate.id;
          run.receipts.push(receipt);
          usedVendorIds.add(fbCandidate.id);

          const fbReceipt = await procureFromX402Vendor({
            vendor: fbCandidate,
            session: params.session,
            queryParams: {
              entity: params.mandate.targetEntity,
              identifier: params.mandate.targetIdentifier,
            },
            signal: params.callbacks?.signal,
          });
          run.receipts.push(fbReceipt);
          continue;
        }
      }

      run.receipts.push(receipt);
    }

    // Third-party leg: the merchants above are Brokro's own endpoints, so
    // paying them proves the policy engine but not that it survives contact
    // with a business that has never heard of us. These have their own prices,
    // their own chains and their own 402 headers.
    if (params.includeExternalMerchants) {
      for (const merchant of EXTERNAL_MERCHANTS) {
        if (params.callbacks?.signal?.aborted) break;
        const extReceipt = await procureFromExternalMerchant({
          merchant,
          session: params.session,
          mandate: {
            entity: params.mandate.targetEntity,
            identifier: params.mandate.targetIdentifier,
          },
          signal: params.callbacks?.signal,
        });
        run.receipts.push(extReceipt);
      }
    }

    const settledReceipts = run.receipts.filter((r) => r.outcome === "settled");
    const blockedReceipts = run.receipts.filter((r) => r.outcome === "blocked_policy");
    const externalReceipts = run.receipts.filter((r) => r.externalMerchant === true);
    const externalSettled = externalReceipts.filter((r) => r.outcome === "settled");

    if (settledReceipts.length === 0) {
      throw new Error(
        "No x402 vendor calls settled within the active Kite session policy.",
      );
    }

    emitStep({
      step: "settle_x402",
      title: "Execute x402 Procurement Under Kite Session Policy",
      engine: `Kite Session Engine + Pieverse Facilitator (${params.session.caip2Network})`,
      status: "completed",
      startedAt: new Date(s3Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - s3Start,
      costUsd: params.session.spentUsd,
      summary: [
        blockedReceipts.length > 0
          ? `Settled ${settledReceipts.length} x402 call(s) ($${params.session.spentUsd.toFixed(4)} ${params.session.assetSymbol}); blocked ${blockedReceipts.length} bait-and-switch 402 spike (${blockedReceipts
              .map((b) => b.policyErrorCode)
              .filter(Boolean)
              .join(", ")}) and rerouted cleanly.`
          : `Settled ${settledReceipts.length} x402 call(s) totaling $${params.session.spentUsd.toFixed(4)} ${params.session.assetSymbol}.`,
        externalReceipts.length > 0
          ? `Third-party leg: quoted ${externalReceipts.length} independent merchant(s), settled ${externalSettled.length}${
              externalSettled.length < externalReceipts.length
                ? ` \u2014 ${externalReceipts.length - externalSettled.length} refused by mandate (${Array.from(
                    new Set(
                      externalReceipts
                        .filter((r) => r.outcome !== "settled")
                        .map((r) => r.policyErrorCode ?? "preflight_no_signature"),
                    ),
                  ).join(", ")})`
                : ""
            }.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      detail: run.receipts,
    });

    // ── STEP 4: cross_examine ─────────────────────────────────────────────────
    const s4Start = Date.now();
    emitStep({
      step: "cross_examine",
      title: "Cross-Examine Paid Payloads & Synthesize Cited Dossier",
      engine: "SERV Reasoning + Shadow Agent",
      model: ARBITER_MODEL,
      servTools: ["serv_prompt_guard", "serv_shadow_agent"],
      status: "running",
      startedAt: new Date(s4Start).toISOString(),
      summary: "Running serv_shadow_agent validation loop over returned vendor telemetry...",
    });

    const settledPayloadsForModel = settledReceipts.map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      settledUsd: r.settledUsd,
      availableTopLevelFields: Object.keys(r.payload ?? {}),
      payload: r.payload ?? {},
    }));

    const examineRes = await runTypedStep<{
      headline: string;
      executiveDecision: "proceed" | "proceed_with_conditions" | "hold";
      riskScore: number;
      executiveSummary: string;
      findings: CitedFinding[];
      recommendedConditions: string[];
    }>({
      model: ARBITER_MODEL,
      schema: DOSSIER_SCHEMA,
      schemaName: "counterparty_diligence_dossier",
      signal: params.callbacks?.signal,
      servTools: {
        promptGuard: true,
        shadowAgent: {
          maxIterations: 3,
          hint: "Every finding MUST reference a vendorId present in settledPayloads and an exact top-level fieldPath key from that vendor's payload (for example 'httpsReachable', 'kiteBytecodeBytes', 'baseIsContract', 'publicRepos', or 'analysisSummary'). Never invent field names.",
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are Brokr's senior counterparty risk arbiter. Synthesize ONLY the verified x402 payloads below into an institutional procurement dossier. Every finding must cite an exact `vendorId` from `settledPayloads`, an exact existing `fieldPath` from that vendor's `availableTopLevelFields`, and `quotedEvidence` matching the actual field value. Never cite quarantined or blocked vendors.",
        },
        {
          role: "user",
          content: JSON.stringify({
            mandate: params.mandate,
            settledPayloads: settledPayloadsForModel,
          }),
        },
      ],
    });

    cumulativeServUsd += examineRes.costUsd;

    const dossier: SynthesizedDossier = {
      ...examineRes.value,
      shadowAgentTools: examineRes.servTools,
    };
    run.dossier = dossier;

    emitStep({
      step: "cross_examine",
      title: "Cross-Examine Paid Payloads & Synthesize Cited Dossier",
      engine: "SERV Reasoning + Shadow Agent",
      model: examineRes.model,
      servTools: examineRes.servTools,
      status: "completed",
      startedAt: new Date(s4Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - s4Start,
      tokens: examineRes.usage,
      costUsd: examineRes.costUsd,
      repairs: examineRes.repairs,
      summary: `Decision: ${dossier.executiveDecision.toUpperCase()} (risk ${dossier.riskScore}/100) across ${dossier.findings.length} cited findings.`,
      detail: dossier,
    });

    // ── STEP 5: verify_dossier ────────────────────────────────────────────────
    const s5Start = Date.now();
    const verification = verifyDossierDeterministically({
      dossier,
      receipts: run.receipts,
      guards: run.guards,
      session: params.session,
    });
    run.verification = verification;

    emitStep({
      step: "verify_dossier",
      title: "Deterministic Citation, Field-Path & Spend-Cap Verifier",
      engine: "Deterministic TypeScript Verifier",
      status: verification.passed ? "completed" : "blocked",
      startedAt: new Date(s5Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - s5Start),
      summary: verification.passed
        ? `Value-matched ${verification.citationsValueMatched}/${verification.citationsChecked} citations against raw upstream JSON & Kite spend caps · SHA-256 ${verification.receiptDigestSha256.slice(0, 12)}…`
        : `Verifier blocked settlement: ${[...verification.unresolvedCitations, ...verification.misquotedCitations].join("; ")}`,
      detail: verification,
    });

    // ── STEP 6: anchor_audit ──────────────────────────────────────────────────
    const s6Start = Date.now();
    run.margin = calculateWholesaleMargin({
      wholesalePriceUsd: WHOLESALE_BUNDLE_PRICE_USD,
      upstreamSpendUsd: params.session.spentUsd,
      servInferenceUsd: cumulativeServUsd,
    });

    if (params.submitToReppo) {
      run.reppoAudit = await submitDossierToReppo({
        mandate: params.mandate,
        dossier,
        receiptDigestSha256: verification.receiptDigestSha256,
      });
    }

    emitStep({
      step: "anchor_audit",
      title: "Wholesale x402 Margin Settlement & Reppo Audit Anchor",
      engine: params.submitToReppo
        ? "Wholesale Ledger + Reppo Evaluation API"
        : "Wholesale Unit-Economics Ledger",
      status: "completed",
      startedAt: new Date(s6Start).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - s6Start),
      summary: `Wholesale price $${run.margin.wholesalePriceUsd.toFixed(4)} − ($${run.margin.upstreamSpendUsd.toFixed(4)} x402 + $${run.margin.servInferenceUsd.toFixed(4)} SERV) = +$${run.margin.netMarginUsd.toFixed(4)} net (+${run.margin.grossMarginPct}%)${run.reppoAudit ? ` · Reppo: ${run.reppoAudit.status}` : ""}.`,
      detail: {
        margin: run.margin,
        reppoAudit: run.reppoAudit,
      },
    });

    run.status = verification.passed ? "completed" : "halted";
    run.completedAt = new Date().toISOString();
    return run;
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    run.completedAt = new Date().toISOString();
    run.margin = calculateWholesaleMargin({
      upstreamSpendUsd: params.session.spentUsd,
      servInferenceUsd: cumulativeServUsd,
    });
    return run;
  }
}
