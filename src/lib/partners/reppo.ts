/**
 * Reppo Eval Router adapter (`https://eval.reppo.xyz/api/v1`).
 *
 * Brokro's own verification is deterministic and synchronous: plain TypeScript
 * matches every cited value against the raw merchant JSON before settlement is
 * released. Reppo answers a different question — not "did the agent quote this
 * field correctly" but "is the judgment it built on top of those fields any
 * good" — scored by a panel of independent evaluators rather than by us.
 *
 * So Reppo never gates checkout. It anchors an outside opinion on a dossier
 * that has already been proved internally consistent, which is the only
 * ordering that makes sense: there is no point paying a panel to assess a
 * report whose citations we can show are wrong.
 *
 * Evaluations are queued and scored in the background, typically in 30–90s, so
 * every call here returns immediately and the verdict is polled separately.
 */

import type { ProcurementMandate, ReppoAuditRecord, SynthesizedDossier } from "../types";

const REPPO_BASE_URL = process.env.REPPO_EVAL_BASE_URL || "https://eval.reppo.xyz/api/v1";
const CONSOLE_URL = "https://eval.reppo.xyz";

/** A text-only evaluation. The 22,000-credit signup bonus covers 50 of them. */
export const REPPO_TEXT_EVAL_CREDITS = 440;

export function isReppoConfigured(): boolean {
  return Boolean(process.env.REPPO_API_KEY && process.env.REPPO_API_KEY.trim().length > 0);
}

function base(): string {
  return REPPO_BASE_URL.replace(/\/+$/, "");
}

/** Shape returned by both the submit and read endpoints. */
interface ReppoEvalResponse {
  id?: string;
  status?: string;
  score?: number | null;
  route?: string | null;
  creditsCharged?: number;
  createdAt?: string;
  error?: string | null;
  result?: {
    score?: number;
    decision?: string;
    confidence?: string;
    route?: string;
    reason?: string;
    rubric_scores?: Record<string, number>;
  } | null;
}

function normalizeStatus(raw: string | undefined): ReppoAuditRecord["status"] {
  switch (raw) {
    case "QUEUED":
    case "PROCESSING":
    case "COMPLETED":
    case "FAILED":
      return raw;
    default:
      return "ERROR";
  }
}

function toRecord(d: ReppoEvalResponse, submittedAt: string): ReppoAuditRecord {
  const r = d.result ?? undefined;
  const status = normalizeStatus(d.status);
  return {
    evalId: d.id ?? "unknown",
    status,
    submittedAt: d.createdAt ?? submittedAt,
    score: r?.score ?? d.score ?? undefined,
    decision: r?.decision === "accept" || r?.decision === "reject" ? r.decision : undefined,
    confidence:
      r?.confidence === "high" || r?.confidence === "medium" || r?.confidence === "low"
        ? r.confidence
        : undefined,
    route:
      r?.route === "ship" || r?.route === "review" || r?.route === "block"
        ? r.route
        : d.route === "ship" || d.route === "review" || d.route === "block"
          ? d.route
          : undefined,
    critique: r?.reason,
    rubricScores: r?.rubric_scores,
    creditsCharged: d.creditsCharged,
    consoleUrl: CONSOLE_URL,
    note:
      status === "FAILED"
        ? `Evaluation failed and was not charged${d.error ? `: ${d.error}` : "."}`
        : undefined,
  };
}

function unconfigured(evalId: string, submittedAt: string): ReppoAuditRecord {
  return {
    evalId,
    status: "UNCONFIGURED",
    submittedAt,
    consoleUrl: CONSOLE_URL,
    note: `Set REPPO_API_KEY in .env.local to anchor an independent panel verdict on ${CONSOLE_URL}. New accounts get 22,000 credits, and a text evaluation costs ${REPPO_TEXT_EVAL_CREDITS}.`,
  };
}

/**
 * Submits a verified dossier for independent scoring.
 *
 * Sent as `taskType: "response"` with the mandate as the request and the
 * dossier as the answer, so the panel can judge whether the conclusion is
 * actually supported — which is the thing worth an outside opinion.
 */
export async function submitDossierToReppo(params: {
  mandate: ProcurementMandate;
  dossier: SynthesizedDossier;
  receiptDigestSha256: string;
}): Promise<ReppoAuditRecord> {
  const apiKey = process.env.REPPO_API_KEY?.trim();
  const now = new Date().toISOString();

  if (!apiKey) return unconfigured("unconfigured", now);

  const input = [
    `User request: Screen the counterparty "${params.mandate.targetEntity}" before authorizing $${params.mandate.counterpartyAmountUsd.toLocaleString()} of exposure, and state whether to proceed.`,
    "",
    `AI response: ${params.dossier.headline}`,
    `Decision: ${params.dossier.executiveDecision} (risk ${params.dossier.riskScore}/100)`,
    "",
    params.dossier.executiveSummary,
    "",
    "Findings, each citing a paid upstream x402 vendor field:",
    ...params.dossier.findings.map(
      (f) =>
        `- [${f.status}] ${f.dimension}: ${f.claim} (source ${f.vendorId}.${f.fieldPath} = "${f.quotedEvidence}")`,
    ),
    "",
    "Recommended conditions:",
    ...params.dossier.recommendedConditions.map((c) => `- ${c}`),
    "",
    `Assess whether the decision and risk score are justified by the cited evidence, and whether the conditions are proportionate. Evidence digest: ${params.receiptDigestSha256}.`,
  ].join("\n");

  try {
    const res = await fetch(`${base()}/agents/evals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskType: "response", input: input.slice(0, 50_000) }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        evalId: "error",
        status: "ERROR",
        submittedAt: now,
        consoleUrl: CONSOLE_URL,
        note:
          res.status === 402
            ? `Out of Reppo credits: a text evaluation costs ${REPPO_TEXT_EVAL_CREDITS}. Top up at ${CONSOLE_URL}/billing.`
            : `Reppo Eval Router returned HTTP ${res.status}: ${errText.slice(0, 180)}`,
      };
    }

    const body = (await res.json()) as ReppoEvalResponse;
    const record = toRecord(body, now);
    return {
      ...record,
      note:
        record.note ??
        "Queued on the Reppo evaluator panel; scored in the background, typically within 30-90s.",
    };
  } catch (err) {
    return {
      evalId: "error",
      status: "ERROR",
      submittedAt: now,
      consoleUrl: CONSOLE_URL,
      note: `Reppo transport error: ${(err as Error).message}`,
    };
  }
}

/** Reads an evaluation back. Poll until the status leaves QUEUED/PROCESSING. */
export async function pollReppoVerdict(evalId: string): Promise<ReppoAuditRecord> {
  const apiKey = process.env.REPPO_API_KEY?.trim();
  const now = new Date().toISOString();

  if (!apiKey || !evalId || evalId === "unconfigured" || evalId === "error") {
    return unconfigured(evalId || "unknown", now);
  }

  try {
    const res = await fetch(`${base()}/agents/evals/${encodeURIComponent(evalId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        evalId,
        status: "ERROR",
        submittedAt: now,
        consoleUrl: CONSOLE_URL,
        note:
          res.status === 404
            ? "No evaluation with that id for this account."
            : `HTTP ${res.status} reading the Reppo evaluation.`,
      };
    }

    return toRecord((await res.json()) as ReppoEvalResponse, now);
  } catch (err) {
    return {
      evalId,
      status: "ERROR",
      submittedAt: now,
      consoleUrl: CONSOLE_URL,
      note: `Reppo transport error: ${(err as Error).message}`,
    };
  }
}
