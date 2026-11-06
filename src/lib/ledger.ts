/**
 * Process-safe Procurement & Wholesale Margin Ledger.
 *
 * Persists recent runs, cumulative x402 wholesale revenue, upstream spend,
 * blocked adversarial challenges, and daily outflow guardrails.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcurementRun } from "./types";

const LEDGER_FILE =
  process.env.BROKR_LEDGER_PATH || join(process.cwd(), ".brokr-ledger.json");

const DAILY_OUTFLOW_CAP_USD = Number(process.env.BROKR_DAILY_OUTFLOW_USD || "5.0");

interface PersistedLedger {
  runs: ProcurementRun[];
  wholesaleCalls: number;
  wholesaleRevenueUsd: number;
  upstreamSpendUsd: number;
  servInferenceUsd: number;
  adversarialBlockedCount: number;
}

let memoryLedger: PersistedLedger | null = null;
const activeRunLocks = new Set<string>();

function loadLedger(): PersistedLedger {
  if (memoryLedger) return memoryLedger;
  try {
    if (existsSync(/*turbopackIgnore: true*/ LEDGER_FILE)) {
      memoryLedger = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ LEDGER_FILE, "utf8"),
      ) as PersistedLedger;
      return memoryLedger;
    }
  } catch {
    // Ignore corrupt cache and start clean
  }
  memoryLedger = {
    runs: [],
    wholesaleCalls: 0,
    wholesaleRevenueUsd: 0,
    upstreamSpendUsd: 0,
    servInferenceUsd: 0,
    adversarialBlockedCount: 0,
  };
  return memoryLedger;
}

function flushLedger(state: PersistedLedger): void {
  try {
    writeFileSync(/*turbopackIgnore: true*/ LEDGER_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Read-only serverless filesystem fallback: keep in-memory state
  }
}

export function checkDailyOutflowAllowed(estimatedUsd: number): {
  allowed: boolean;
  spentTodayUsd: number;
  capUsd: number;
} {
  const ledger = loadLedger();
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const spentTodayUsd =
    Math.round(
      ledger.runs
        .filter((r) => r.createdAt.startsWith(todayPrefix))
        .reduce((acc, r) => acc + r.margin.upstreamSpendUsd, 0) * 1_000_000,
    ) / 1_000_000;

  return {
    allowed: spentTodayUsd + estimatedUsd <= DAILY_OUTFLOW_CAP_USD,
    spentTodayUsd,
    capUsd: DAILY_OUTFLOW_CAP_USD,
  };
}

export function acquireCallerLock(callerKey: string): (() => void) | null {
  if (activeRunLocks.has(callerKey)) return null;
  activeRunLocks.add(callerKey);
  return () => {
    activeRunLocks.delete(callerKey);
  };
}

export function recordCompletedRun(run: ProcurementRun): void {
  const ledger = loadLedger();
  ledger.runs.unshift(run);
  if (ledger.runs.length > 25) {
    ledger.runs = ledger.runs.slice(0, 25);
  }

  ledger.upstreamSpendUsd =
    Math.round((ledger.upstreamSpendUsd + run.margin.upstreamSpendUsd) * 1_000_000) /
    1_000_000;
  ledger.servInferenceUsd =
    Math.round((ledger.servInferenceUsd + run.margin.servInferenceUsd) * 1_000_000) /
    1_000_000;

  if (run.callerType === "x402-wholesale-buyer" && run.status === "completed") {
    ledger.wholesaleCalls += 1;
    ledger.wholesaleRevenueUsd =
      Math.round((ledger.wholesaleRevenueUsd + run.margin.wholesalePriceUsd) * 1_000_000) /
      1_000_000;
  }

  const quarantined = run.guards.filter((g) => !g.admitted).length;
  const blocked = run.receipts.filter((r) => r.outcome === "blocked_policy").length;
  ledger.adversarialBlockedCount += quarantined + blocked;

  flushLedger(ledger);
}

export function getLedgerSummary() {
  const ledger = loadLedger();
  const netProfitUsd =
    Math.round(
      (ledger.wholesaleRevenueUsd -
        ledger.upstreamSpendUsd -
        ledger.servInferenceUsd) *
        1_000_000,
    ) / 1_000_000;

  return {
    totalRuns: ledger.runs.length,
    wholesaleCalls: ledger.wholesaleCalls,
    wholesaleRevenueUsd: ledger.wholesaleRevenueUsd,
    upstreamSpendUsd: ledger.upstreamSpendUsd,
    servInferenceUsd: ledger.servInferenceUsd,
    netProfitUsd,
    adversarialBlockedCount: ledger.adversarialBlockedCount,
    recentRuns: ledger.runs.slice(0, 8),
  };
}
