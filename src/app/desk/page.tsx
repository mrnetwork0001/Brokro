"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  ArenaBenchmarkResult,
  GuardReport,
  LiveCatalogProbe,
  ProcurementMandate,
  ProcurementRun,
  ReppoAuditRecord,
  SessionPolicy,
  SettlementReceipt,
  StepTelemetry,
} from "@/lib/types";

interface StatusPayload {
  wholesalePriceUsd: number;
  network: {
    id: "testnet" | "mainnet";
    name: string;
    chainId: number;
    caip2: string;
    explorerBaseUrl: string;
    faucetUrl: string | null;
    asset: {
      address: string;
      symbol: string;
      decimals: number;
    };
  };
  wallets: {
    buyerAddress: string;
    buyerExplorerUrl: string;
    merchantPayTo: string;
    merchantExplorerUrl: string;
    balances: {
      tokenFormatted: string;
      tokenUsd: number;
      nativeKiteFormatted: string;
    };
  };
  facilitator: {
    ok: boolean;
    facilitatorUrl: string;
    latencyMs: number;
  };
  kpass: {
    installed: boolean;
    kpassVersion?: string;
    liveCatalogSample?: Array<{
      service_id: string;
      name: string;
      base_url: string;
      starting_price?: { amount: string };
    }>;
  };
  engines: {
    servConfigured: boolean;
    dolphinConfigured: boolean;
    reppoConfigured: boolean;
  };
  ledger: {
    totalRuns: number;
    wholesaleCalls: number;
    wholesaleRevenueUsd: number;
    upstreamSpendUsd: number;
    servInferenceUsd: number;
    netProfitUsd: number;
    adversarialBlockedCount: number;
    recentRuns: ProcurementRun[];
  };
  presets: ProcurementMandate[];
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function shortHex(val: string, head = 6, tail = 4): string {
  if (!val || val.length <= head + tail + 2) return val;
  return `${val.slice(0, head)}…${val.slice(-tail)}`;
}

export default function ClearinghouseDeskPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("mandate-kite-supplier");
  const [customMode, setCustomMode] = useState<boolean>(false);

  const [targetEntity, setTargetEntity] = useState<string>("gokite.ai / gokite-ai");
  const [targetIdentifier, setTargetIdentifier] = useState<string>(
    "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
  );
  const [counterpartyUsd, setCounterpartyUsd] = useState<number>(25000);
  const [mandatePrompt, setMandatePrompt] = useState<string>(
    "Verify DNS & TLS operational posture for gokite.ai, inspect on-chain bytecode and token state for 0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e on Kite/Base, and audit gokite-ai open-source repository activity before approving a $25,000 USDC supplier settlement.",
  );

  // Kite Session Policy Bounds
  const [maxPerTxUsd, setMaxPerTxUsd] = useState<number>(0.015);
  const [maxTotalUsd, setMaxTotalUsd] = useState<number>(0.035);
  const [ttlMinutes, setTtlMinutes] = useState<number>(30);

  // Wallet-bound session state
  const [signedSession, setSignedSession] = useState<SessionPolicy | null>(null);
  const [walletBusy, setWalletBusy] = useState<boolean>(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  // Adversarial & Reppo switches
  const [includeAdversarial, setIncludeAdversarial] = useState<boolean>(false);
  const [submitToReppo, setSubmitToReppo] = useState<boolean>(false);

  // Live streaming run state
  const [running, setRunning] = useState<boolean>(false);
  const [liveSession, setLiveSession] = useState<SessionPolicy | null>(null);
  const [liveSteps, setLiveSteps] = useState<StepTelemetry[]>([]);
  const [liveGuards, setLiveGuards] = useState<GuardReport[]>([]);
  const [liveReceipts, setLiveReceipts] = useState<SettlementReceipt[]>([]);
  const [completedRun, setCompletedRun] = useState<ProcurementRun | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Wholesale buyer simulation state
  const [wholesaleBusy, setWholesaleBusy] = useState<boolean>(false);
  const [wholesaleResult, setWholesaleResult] = useState<{
    ok: boolean;
    httpStatus: number;
    wholesaleTxHash: string | null;
    wholesaleExplorerUrl: string | null;
    onChainSettled: boolean;
    unitEconomics?: {
      wholesalePriceUsd: number;
      upstreamSpendUsd: number;
      servInferenceUsd: number;
      netMarginUsd: number;
      grossMarginPct: number;
    };
  } | null>(null);

  // Reppo live poller
  const [reppoPolling, setReppoPolling] = useState<boolean>(false);

  // Head-to-Head Attack Arena (SERV OFF vs SERV ON + Kite)
  const [arenaBusy, setArenaBusy] = useState<boolean>(false);
  const [arenaResult, setArenaResult] = useState<ArenaBenchmarkResult | null>(null);

  // Live External Kite x402 Ecosystem Pre-flight
  const [ecosystemBusy, setEcosystemBusy] = useState<boolean>(false);
  const [ecosystemProbes, setEcosystemProbes] = useState<LiveCatalogProbe[]>([]);

  const handleProbeEcosystem = useCallback(async (capPerTx = 0.015) => {
    setEcosystemBusy(true);
    try {
      const res = await fetch(`/api/ecosystem?maxPerTxUsd=${capPerTx}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { probes?: LiveCatalogProbe[] };
      if (Array.isArray(body.probes)) {
        setEcosystemProbes(body.probes);
      }
    } catch {
      // Ignore transient probe errors
    } finally {
      setEcosystemBusy(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusPayload;
      setStatus(data);
      setCompletedRun((prev) => prev ?? data.ledger.recentRuns[0] ?? null);
    } catch {
      // Ignore transient status refresh error
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void handleProbeEcosystem();
  }, [loadStatus, handleProbeEcosystem]);

  const handleSelectPreset = (preset: ProcurementMandate) => {
    setSelectedPresetId(preset.id);
    setCustomMode(false);
    setTargetEntity(preset.targetEntity);
    setTargetIdentifier(preset.targetIdentifier);
    setCounterpartyUsd(preset.counterpartyAmountUsd);
    setMandatePrompt(preset.prompt);
  };

  const handleSignSessionWithWallet = async () => {
    setWalletNotice(null);
    const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setWalletNotice("No injected browser wallet found. Defaulting to operator delegated Kite session.");
      return;
    }

    setWalletBusy(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const ownerAddress = accounts?.[0];
      if (!ownerAddress) throw new Error("No wallet account selected.");

      const net = status?.network;
      const agentAddr = status?.wallets.buyerAddress || ownerAddress;
      const nonce = Math.random().toString(36).slice(2, 12);
      const networkId = net?.id || "testnet";
      const caip2 = net?.caip2 || "eip155:2368";
      const symbol = net?.asset.symbol || "pieUSD";

      const message = [
        "Brokro — Kite Agent Spending Session Authorization",
        `Owner: ${ownerAddress}`,
        `Agent: ${agentAddr}`,
        `Network: ${caip2} (${symbol})`,
        `Max Per Transaction: $${maxPerTxUsd.toFixed(4)}`,
        `Max Session Budget: $${maxTotalUsd.toFixed(4)}`,
        `TTL: ${ttlMinutes} minutes`,
        `Nonce: ${nonce}`,
      ].join("\n");

      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, ownerAddress],
      })) as string;

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "wallet",
          ownerAddress,
          network: networkId,
          maxAmountPerTxUsd: maxPerTxUsd,
          maxTotalAmountUsd: maxTotalUsd,
          ttlMinutes,
          nonce,
          walletSignature: signature,
          taskSummary: `Wallet-signed mandate for ${targetEntity}`,
        }),
      });

      const body = (await res.json()) as {
        ok?: boolean;
        session?: SessionPolicy;
        message?: string;
      };
      if (!res.ok || !body.session) {
        throw new Error(body.message || "Failed to verify wallet session signature.");
      }

      setSignedSession(body.session);
      setWalletNotice(`Verified EIP-191 session ${body.session.sessionId} signed by ${shortHex(ownerAddress)}.`);
    } catch (err) {
      setWalletNotice((err as Error).message);
    } finally {
      setWalletBusy(false);
    }
  };

  const handleRunProcurement = async () => {
    setRunning(true);
    setRunError(null);
    setCompletedRun(null);
    setLiveSteps([]);
    setLiveGuards([]);
    setLiveReceipts([]);

    try {
      const res = await fetch("/api/procure/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: customMode ? "custom" : selectedPresetId,
          mandate: {
            id: customMode ? "custom-mandate" : selectedPresetId,
            title: customMode
              ? `Custom Counterparty Audit — ${targetEntity}`
              : status?.presets.find((p) => p.id === selectedPresetId)?.title ||
                `Counterparty Audit — ${targetEntity}`,
            targetEntity,
            targetIdentifier,
            counterpartyAmountUsd: counterpartyUsd,
            prompt: mandatePrompt,
            requiredDimensions: ["domain_posture", "onchain_contract", "osint_activity"],
          },
          sessionId: signedSession?.sessionId,
          maxAmountPerTxUsd: maxPerTxUsd,
          maxTotalAmountUsd: maxTotalUsd,
          ttlMinutes,
          includeAdversarial,
          submitToReppo,
        }),
      });

      if (!res.ok || !res.body) {
        const errJson = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(errJson.message || errJson.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventMatch = frame.match(/^event:\s*(.+)$/m);
          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1].trim();
          const payload = JSON.parse(dataMatch[1]);

          if (eventName === "session") {
            setLiveSession(payload as SessionPolicy);
          } else if (eventName === "step") {
            const d = payload as {
              step: StepTelemetry;
              session: SessionPolicy;
              guards: GuardReport[];
              receipts: SettlementReceipt[];
            };
            setLiveSession(d.session);
            setLiveGuards(d.guards);
            setLiveReceipts(d.receipts);
            setLiveSteps((prev) => {
              const idx = prev.findIndex((s) => s.step === d.step.step);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = d.step;
                return copy;
              }
              return [...prev, d.step];
            });
          } else if (eventName === "complete") {
            const finalRun = payload as ProcurementRun;
            setCompletedRun(finalRun);
            setLiveSession(finalRun.session);
            setLiveSteps(finalRun.steps);
            setLiveGuards(finalRun.guards);
            setLiveReceipts(finalRun.receipts);
            if (finalRun.status === "failed" && finalRun.error) {
              setRunError(finalRun.error);
            }
          }
        }
      }

      // Clear single-run signed session if used so next run gets fresh allowance
      setSignedSession(null);
      await loadStatus();
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const handleRunArena = async () => {
    setArenaBusy(true);
    setRunError(null);
    setArenaResult(null);
    try {
      const res = await fetch("/api/arena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: customMode ? "custom" : selectedPresetId,
          mandate: {
            id: customMode ? "custom-mandate" : selectedPresetId,
            title: customMode
              ? `Arena Defense — ${targetEntity}`
              : status?.presets.find((p) => p.id === selectedPresetId)?.title ||
                `Arena Defense — ${targetEntity}`,
            targetEntity,
            targetIdentifier,
            counterpartyAmountUsd: counterpartyUsd,
            prompt: mandatePrompt,
            requiredDimensions: ["domain_posture", "onchain_contract", "osint_activity"],
          },
          maxAmountPerTxUsd: maxPerTxUsd,
          maxTotalAmountUsd: maxTotalUsd,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        arena?: ArenaBenchmarkResult;
        error?: string;
      };
      if (!res.ok || !data.arena) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setArenaResult(data.arena);
      setCompletedRun(data.arena.brokroAgent);
      setLiveSession(data.arena.brokroAgent.session);
      setLiveSteps(data.arena.brokroAgent.steps);
      setLiveGuards(data.arena.brokroAgent.guards);
      setLiveReceipts(data.arena.brokroAgent.receipts);
      await loadStatus();
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setArenaBusy(false);
    }
  };

  const handleTestWholesaleBuyer = async () => {
    setWholesaleBusy(true);
    setWholesaleResult(null);
    try {
      const res = await fetch("/api/x402/procure/demo-buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: targetEntity,
          identifier: targetIdentifier,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        httpStatus: number;
        wholesaleTxHash: string | null;
        wholesaleExplorerUrl: string | null;
        onChainSettled: boolean;
        result?: {
          unitEconomics?: {
            wholesalePriceUsd: number;
            upstreamSpendUsd: number;
            servInferenceUsd: number;
            netMarginUsd: number;
            grossMarginPct: number;
          };
        };
      };
      setWholesaleResult({
        ok: data.ok,
        httpStatus: data.httpStatus,
        wholesaleTxHash: data.wholesaleTxHash,
        wholesaleExplorerUrl: data.wholesaleExplorerUrl,
        onChainSettled: data.onChainSettled,
        unitEconomics: data.result?.unitEconomics,
      });
      await loadStatus();
    } catch {
      setWholesaleResult({
        ok: false,
        httpStatus: 500,
        wholesaleTxHash: null,
        wholesaleExplorerUrl: null,
        onChainSettled: false,
      });
    } finally {
      setWholesaleBusy(false);
    }
  };

  const handlePollReppo = async (evalId: string) => {
    setReppoPolling(true);
    try {
      const res = await fetch(`/api/eval/${encodeURIComponent(evalId)}`);
      const body = (await res.json()) as { audit?: ReppoAuditRecord };
      const updatedAudit = body.audit;
      if (updatedAudit && completedRun) {
        setCompletedRun({
          ...completedRun,
          reppoAudit: updatedAudit,
        });
      }
    } finally {
      setReppoPolling(false);
    }
  };

  const activeSession = liveSession ?? completedRun?.session;
  const activeSteps = liveSteps.length > 0 ? liveSteps : completedRun?.steps ?? [];
  const activeGuards = liveGuards.length > 0 ? liveGuards : completedRun?.guards ?? [];
  const activeReceipts =
    liveReceipts.length > 0 ? liveReceipts : completedRun?.receipts ?? [];
  const activeDossier = completedRun?.dossier;
  const activeVerification = completedRun?.verification;
  const activeMargin = completedRun?.margin;

  const spentPct = activeSession
    ? Math.min(100, (activeSession.spentUsd / activeSession.maxTotalAmountUsd) * 100)
    : 0;

  return (
    <div className="shell">
      {/* ── Desk Header Bar ─────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="brand-lockup">
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "12px" }}>
            <span className="brand-seal">B</span>
            <span className="brand-name">Brokro</span>
          </Link>
          <span className="brand-tag">Zero-Drain Agent Commerce &amp; Arena</span>
        </div>

        <div className="nav-links">
          {status && (
            <>
              <span className="pill" title={status.facilitator.facilitatorUrl}>
                <span className={`dot ${status.facilitator.ok ? "ok" : "warn"}`} />
                {status.network.name} ({status.network.caip2})
              </span>
              <a
                href={status.wallets.buyerExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="pill"
              >
                Buyer {shortHex(status.wallets.buyerAddress)} ·{" "}
                <strong>
                  {Number(status.wallets.balances.tokenFormatted).toFixed(3)}{" "}
                  {status.network.asset.symbol}
                </strong>{" "}
                ↗
              </a>
              {status.kpass.installed && (
                <span className="pill">
                  <span className="dot ok" />
                  {status.kpass.kpassVersion || "kpass CLI Ready"}
                </span>
              )}
            </>
          )}
          <Link href="/" className="btn btn-sm">
            ← Overview
          </Link>
        </div>
      </header>

      <div className="desk-layout">
        {/* ── LEFT COLUMN: Mandate & Session Policy Configurator ────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <section className="sheet">
            <div className="sheet-header">
              <div>
                <div className="sheet-kicker">1 · Counterparty Mandate</div>
                <h2 className="sheet-title">Procurement Brief</h2>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCustomMode((v) => !v)}
              >
                {customMode ? "Use Presets" : "Custom Brief"}
              </button>
            </div>

            {!customMode && status?.presets ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                {status.presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className={`preset-card ${selectedPresetId === p.id ? "active" : ""}`}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "8px",
                        fontSize: "13px",
                        fontWeight: 600,
                      }}
                    >
                      <span>{p.targetEntity}</span>
                      <span className="mono" style={{ color: "var(--brand)" }}>
                        ${p.counterpartyAmountUsd.toLocaleString()}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--ink-muted)",
                        marginTop: "3px",
                      }}
                    >
                      {p.title}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
              <div>
                <label className="field-label">Target Domain / GitHub Org</label>
                <input
                  className="input mono"
                  value={targetEntity}
                  onChange={(e) => {
                    setTargetEntity(e.target.value);
                    setCustomMode(true);
                  }}
                  placeholder="e.g. gokite.ai / gokite-ai"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr", gap: "10px" }}>
                <div>
                  <label className="field-label">Contract / Wallet Address</label>
                  <input
                    className="input mono"
                    value={targetIdentifier}
                    onChange={(e) => {
                      setTargetIdentifier(e.target.value);
                      setCustomMode(true);
                    }}
                  />
                </div>
                <div>
                  <label className="field-label">Exposure (USD)</label>
                  <input
                    type="number"
                    className="input mono"
                    value={counterpartyUsd}
                    onChange={(e) => {
                      setCounterpartyUsd(Number(e.target.value));
                      setCustomMode(true);
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Mandate Instructions</label>
                <textarea
                  className="textarea"
                  value={mandatePrompt}
                  onChange={(e) => {
                    setMandatePrompt(e.target.value);
                    setCustomMode(true);
                  }}
                />
              </div>
            </div>
          </section>

          <section className="sheet">
            <div className="sheet-header">
              <div>
                <div className="sheet-kicker">2 · Kite Passport Session Bounds</div>
                <h2 className="sheet-title">Spending Limits &amp; Defense</h2>
              </div>
              <span className="badge brand">EIP-3009 Exact</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "14px" }}>
              <div>
                <label className="field-label">Max / Tx ($)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0.004"
                  max="0.25"
                  className="input mono"
                  value={maxPerTxUsd}
                  onChange={(e) => setMaxPerTxUsd(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="field-label">Total Cap ($)</label>
                <input
                  type="number"
                  step="0.005"
                  min="0.01"
                  max="0.50"
                  className="input mono"
                  value={maxTotalUsd}
                  onChange={(e) => setMaxTotalUsd(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="field-label">TTL (Min)</label>
                <input
                  type="number"
                  min="5"
                  max="120"
                  className="input mono"
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
              <label
                className={`toggle-row ${includeAdversarial ? "adversarial-on" : ""}`}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13.5px" }}>
                    Include Rogue Merchants (Attack Test)
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>
                    Injects poisoned vendor <span className="mono">v-rogue-inject</span> +
                    bait-and-switch $0.085 spike <span className="mono">v-rogue-spike</span>.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeAdversarial}
                  onChange={(e) => setIncludeAdversarial(e.target.checked)}
                  style={{ width: "18px", height: "18px", marginTop: "3px" }}
                />
              </label>

              <label className="toggle-row">
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13.5px" }}>
                    Anchor Async Verdict on Reppo
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>
                    Submits verified dossier to <span className="mono">eval.reppo.xyz</span>{" "}
                    (10m peer window; non-blocking).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={submitToReppo}
                  onChange={(e) => setSubmitToReppo(e.target.checked)}
                  style={{ width: "18px", height: "18px", marginTop: "3px" }}
                />
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", padding: "12px 18px", fontSize: "14.5px" }}
                disabled={running || arenaBusy}
                onClick={handleRunProcurement}
              >
                {running
                  ? "Running 6-Step SERV & Kite Graph…"
                  : includeAdversarial
                    ? "Execute Bounded Procurement (With Attack Test) →"
                    : "Execute Bounded Procurement →"}
              </button>

              <button
                type="button"
                className="btn btn-copper"
                style={{ width: "100%", padding: "10px 16px", fontSize: "13.5px" }}
                disabled={running || arenaBusy}
                onClick={handleRunArena}
              >
                {arenaBusy
                  ? "Running SERV OFF vs. SERV ON Battle…"
                  : "⚔ Run Attack Arena (SERV OFF vs. SERV ON) →"}
              </button>

              <button
                type="button"
                className="btn btn-sm"
                style={{ width: "100%" }}
                disabled={walletBusy || running || arenaBusy}
                onClick={handleSignSessionWithWallet}
              >
                {walletBusy
                  ? "Awaiting Wallet Signature…"
                  : signedSession
                    ? `✓ Wallet Session Active (${signedSession.sessionId})`
                    : "Optional: Bind & Sign Session Policy with Wallet"}
              </button>

              {walletNotice && (
                <div
                  className="mono"
                  style={{
                    fontSize: "11.5px",
                    color: signedSession ? "var(--ok)" : "var(--ink-muted)",
                    padding: "6px 8px",
                    background: "var(--bg-sunken)",
                    borderRadius: "4px",
                  }}
                >
                  {walletNotice}
                </div>
              )}
            </div>
          </section>

          {/* ── Wholesale x402 Seller Simulator Card ────────────────────── */}
          <section className="sheet">
            <div className="sheet-header">
              <div>
                <div className="sheet-kicker">3 · Zero-Hallucination Escrow</div>
                <h2 className="sheet-title">Wholesale x402 Desk ($0.05)</h2>
              </div>
              <span className="badge ok">Pay-Only-If-Verified</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", margin: "0 0 12px" }}>
              External agents pay <span className="mono">POST /api/x402/procure</span>{" "}
              <strong>$0.0500</strong> via HTTP 402; Brokro settles funds{" "}
              <strong>only after 100% Step-5 verification</strong>, procuring feeds for
              ~$0.0170 and booking the spread.
            </p>
            <button
              type="button"
              className="btn btn-copper"
              style={{ width: "100%" }}
              disabled={wholesaleBusy || running}
              onClick={handleTestWholesaleBuyer}
            >
              {wholesaleBusy
                ? "Negotiating 402 → Fulfilling Bundle…"
                : "Test External Buyer Call ($0.05 x402) →"}
            </button>

            {wholesaleResult && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  background: wholesaleResult.ok ? "var(--ok-soft)" : "var(--bad-soft)",
                  fontSize: "12.5px",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {wholesaleResult.ok
                    ? `HTTP ${wholesaleResult.httpStatus} · Wholesale Order Settled`
                    : `HTTP ${wholesaleResult.httpStatus} · Call Rejected`}
                </div>
                {wholesaleResult.unitEconomics && (
                  <div className="mono" style={{ marginTop: "4px", fontSize: "11.5px" }}>
                    Rev ${wholesaleResult.unitEconomics.wholesalePriceUsd.toFixed(4)} − Cost $
                    {(
                      wholesaleResult.unitEconomics.upstreamSpendUsd +
                      wholesaleResult.unitEconomics.servInferenceUsd
                    ).toFixed(4)}{" "}
                    ={" "}
                    <strong>
                      +${wholesaleResult.unitEconomics.netMarginUsd.toFixed(4)} (+
                      {wholesaleResult.unitEconomics.grossMarginPct}%)
                    </strong>
                  </div>
                )}
                {wholesaleResult.wholesaleExplorerUrl && (
                  <a
                    href={wholesaleResult.wholesaleExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link-underline mono"
                    style={{ fontSize: "11.5px", display: "inline-block", marginTop: "4px" }}
                  >
                    KiteScan Tx {shortHex(wholesaleResult.wholesaleTxHash || "")} ↗
                  </a>
                )}
              </div>
            )}

            {status && (
              <div
                style={{
                  marginTop: "14px",
                  paddingTop: "12px",
                  borderTop: "1px solid var(--rule)",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "8px",
                  fontSize: "11.5px",
                }}
              >
                <div>
                  <div className="sheet-kicker">Wholesale Rev</div>
                  <div className="mono" style={{ fontWeight: 600 }}>
                    ${status.ledger.wholesaleRevenueUsd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="sheet-kicker">Upstream Spend</div>
                  <div className="mono" style={{ fontWeight: 600 }}>
                    ${status.ledger.upstreamSpendUsd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="sheet-kicker">Blocked Attacks</div>
                  <div className="mono" style={{ fontWeight: 600, color: "var(--copper)" }}>
                    {status.ledger.adversarialBlockedCount}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ── RIGHT COLUMN: Live Allowance, Streaming Graph & Dossier ───── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Live Allowance Bar */}
          <section className="sheet">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              <div>
                <span className="sheet-kicker">Active Kite Session Allowance</span>
                <div style={{ fontWeight: 600, fontSize: "15px", marginTop: "2px" }}>
                  {activeSession ? (
                    <>
                      <span className="mono">{activeSession.sessionId}</span> · Mode:{" "}
                      <span className="badge brand">{activeSession.mode}</span>
                    </>
                  ) : (
                    "Ready — Configure bounds and execute procurement"
                  )}
                </div>
              </div>

              <div className="mono" style={{ fontSize: "13px" }}>
                Spent{" "}
                <strong>
                  ${(activeSession?.spentUsd ?? 0).toFixed(4)}
                </strong>{" "}
                / ${(activeSession?.maxTotalAmountUsd ?? maxTotalUsd).toFixed(4)}{" "}
                {activeSession?.assetSymbol || status?.network.asset.symbol || "pieUSD"} ·
                Per-Tx Cap $
                {(activeSession?.maxAmountPerTxUsd ?? maxPerTxUsd).toFixed(4)}
              </div>
            </div>

            <div className="allowance-meter">
              <div className="allowance-fill" style={{ width: `${spentPct}%` }} />
            </div>

            {status && status.wallets.balances.tokenUsd === 0 && (
              <div
                style={{
                  marginTop: "10px",
                  fontSize: "12px",
                  color: "var(--ink-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <span>
                  Note: Buyer wallet holds 0 {status.network.asset.symbol}; x402 calls
                  cryptographically verify real EIP-3009 signatures locally until funded on{" "}
                  {status.network.name}.
                </span>
                {status.network.faucetUrl && (
                  <a
                    href={status.network.faucetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link-underline mono"
                  >
                    Fund via Kite Faucet ({shortHex(status.wallets.buyerAddress)}) ↗
                  </a>
                )}
              </div>
            )}
          </section>

          {runError && (
            <div
              className="sheet"
              style={{ borderColor: "var(--bad)", background: "var(--bad-soft)" }}
            >
              <strong style={{ color: "var(--bad)" }}>Execution Halted:</strong>{" "}
              <span>{runError}</span>
            </div>
          )}

          {/* ── Head-to-Head Attack Arena Result Card ────────────────────── */}
          {arenaResult && (
            <section className="sheet" style={{ borderColor: "var(--copper)" }}>
              <div className="sheet-header">
                <div>
                  <div className="sheet-kicker">
                    Head-to-Head Attack Arena · {arenaResult.benchmarkId}
                  </div>
                  <h2 className="sheet-title">
                    SERV OFF (Naive Agent) vs. SERV ON (Brokro + Kite)
                  </h2>
                </div>
                <span className="badge ok">
                  Saved ${arenaResult.delta.savedUsd.toFixed(4)} ·{" "}
                  {arenaResult.delta.citationsVerifiedPct}% Verified
                </span>
              </div>

              <div className="grid-2" style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    background: "var(--bad-soft)",
                    border: "1px solid rgba(185, 43, 39, 0.35)",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                    <strong style={{ color: "var(--bad)" }}>Naive Agent · SERV OFF</strong>
                    <span className="badge bad">{arenaResult.naiveAgent.outcome}</span>
                  </div>
                  <div className="mono" style={{ fontSize: "12px", marginBottom: "6px" }}>
                    Exposure: <strong>${arenaResult.naiveAgent.attemptedSpendUsd.toFixed(4)}</strong>{" "}
                    (Cap ${arenaResult.sessionCapTotalUsd.toFixed(3)})
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>
                    {arenaResult.naiveAgent.summary}
                  </div>
                  {arenaResult.naiveAgent.promptInjectionEvidence && (
                    <div
                      className="mono"
                      style={{
                        marginTop: "6px",
                        fontSize: "11px",
                        padding: "5px 7px",
                        borderRadius: "4px",
                        background: "rgba(255,255,255,0.65)",
                      }}
                    >
                      {arenaResult.naiveAgent.promptInjectionEvidence}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    background: "var(--ok-soft)",
                    border: "1px solid rgba(20, 108, 67, 0.35)",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                    <strong style={{ color: "var(--ok)" }}>Brokro · SERV ON + Kite</strong>
                    <span className="badge ok">ZERO DRAIN ($0.0000 LOST)</span>
                  </div>
                  <div className="mono" style={{ fontSize: "12px", marginBottom: "6px" }}>
                    Quarantined: <strong>{arenaResult.delta.injectionsQuarantined}</strong> ·
                    Spikes Blocked: <strong>{arenaResult.delta.spikesBlocked}</strong> ·
                    Spread: <strong>+${arenaResult.delta.wholesaleNetMarginUsd.toFixed(4)}</strong>
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>
                    `serv_prompt_guard` quarantined poisoned listings in Step 1, Kite
                    SessionPolicy rejected any HTTP 402 price spike pre-signature, and Step 5
                    verified {arenaResult.delta.citationsVerifiedPct}% of cited claims.
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── 6-Step Streaming SERV Reasoning Graph ───────────────────── */}
          <section className="sheet">
            <div className="sheet-header">
              <div>
                <div className="sheet-kicker">Auditable Execution Trace</div>
                <h2 className="sheet-title">6-Step Bounded SERV Reasoning Graph</h2>
              </div>
              <span className="mono" style={{ fontSize: "12px", color: "var(--ink-muted)" }}>
                {running ? "● Streaming live SSE…" : `${activeSteps.length}/6 steps recorded`}
              </span>
            </div>

            {activeSteps.length === 0 ? (
              <div
                style={{
                  padding: "28px 16px",
                  textAlign: "center",
                  color: "var(--ink-muted)",
                  border: "1px dashed var(--rule-strong)",
                  borderRadius: "8px",
                }}
              >
                Click <strong>Execute Bounded Procurement</strong> on the left to stream live
                SERV Reasoning steps (<span className="mono">serv_prompt_guard</span>,{" "}
                <span className="mono">/v1/responses</span>,{" "}
                <span className="mono">serv_shadow_agent</span>) and Kite{" "}
                <span className="mono">x402</span> settlements.
              </div>
            ) : (
              <div className="step-tape">
                {activeSteps.map((s, idx) => {
                  const isOpen = expandedStep === s.step;
                  return (
                    <div key={s.step} className={`tape-item ${s.status}`}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "12px",
                          cursor: "pointer",
                        }}
                        onClick={() => setExpandedStep(isOpen ? null : s.step)}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span className="mono" style={{ fontSize: "11.5px", color: "var(--copper)", fontWeight: 600 }}>
                              0{idx + 1} · {s.step}
                            </span>
                            <span
                              className={`badge ${
                                s.status === "completed"
                                  ? "ok"
                                  : s.status === "running"
                                    ? "brand"
                                    : "bad"
                              }`}
                            >
                              {s.status}
                            </span>
                            {s.model && <span className="badge brand">{s.model}</span>}
                            {s.servTools?.map((tool) => (
                              <span key={tool} className="badge copper">
                                {tool}
                              </span>
                            ))}
                          </div>
                          <div style={{ fontWeight: 600, marginTop: "4px", fontSize: "14.5px" }}>
                            {s.title}
                          </div>
                          <div style={{ fontSize: "13px", color: "var(--ink-muted)", marginTop: "3px" }}>
                            {s.summary}
                          </div>
                        </div>

                        <div
                          className="mono"
                          style={{
                            textAlign: "right",
                            fontSize: "11.5px",
                            color: "var(--ink-faint)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.durationMs !== undefined && <div>{s.durationMs} ms</div>}
                          {s.costUsd !== undefined && s.costUsd > 0 && (
                            <div>${s.costUsd.toFixed(5)}</div>
                          )}
                          {s.tokens && <div>{s.tokens.total} tok</div>}
                          <div style={{ color: "var(--brand)", marginTop: "2px" }}>
                            {isOpen ? "Hide JSON ▲" : "Inspect ▼"}
                          </div>
                        </div>
                      </div>

                      {isOpen && s.detail !== undefined && (
                        <pre className="json-drawer">
                          {JSON.stringify(s.detail, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Guard Quarantine & x402 Settlement Receipts Table ───────── */}
          {(activeGuards.length > 0 || activeReceipts.length > 0) && (
            <section className="sheet">
              <div className="sheet-header">
                <div>
                  <div className="sheet-kicker">Defense &amp; Settlement Audit</div>
                  <h2 className="sheet-title">Vendor Screening &amp; x402 Receipts</h2>
                </div>
                <span className="badge brand">
                  {activeReceipts.filter((r) => r.outcome === "settled").length} Settled ·{" "}
                  {activeGuards.filter((g) => !g.admitted).length +
                    activeReceipts.filter((r) => r.outcome === "blocked_policy").length}{" "}
                  Blocked
                </span>
              </div>

              {activeGuards.some((g) => !g.admitted) && (
                <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {activeGuards
                    .filter((g) => !g.admitted)
                    .map((q) => (
                      <div
                        key={q.vendorId}
                        style={{
                          padding: "10px 13px",
                          borderRadius: "8px",
                          background: "var(--bad-soft)",
                          border: "1px solid rgba(185, 43, 39, 0.35)",
                          fontSize: "13px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                          <strong>
                            Quarantined in Step 1: {q.vendorName} ({q.vendorId})
                          </strong>
                          <span className="badge bad">PROMPT INJECTION QUARANTINED</span>
                        </div>
                        <div style={{ color: "var(--ink-muted)", marginTop: "3px", fontSize: "12.5px" }}>
                          {q.reason}
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {activeReceipts.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="receipt-table">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Advertised → 402 Challenge</th>
                        <th>Outcome / Policy</th>
                        <th>Settlement Proof</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeReceipts.map((r) => (
                        <tr key={r.receiptId}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.vendorName}</div>
                            <div className="mono" style={{ fontSize: "11px", color: "var(--ink-faint)" }}>
                              {r.vendorId} · {r.latencyMs}ms
                            </div>
                          </td>
                          <td className="mono">
                            ${r.advertisedUsd.toFixed(4)} →{" "}
                            <strong
                              style={{
                                color:
                                  r.challengedUsd > r.advertisedUsd
                                    ? "var(--bad)"
                                    : "var(--ink)",
                              }}
                            >
                              ${r.challengedUsd.toFixed(4)}
                            </strong>
                          </td>
                          <td>
                            {r.outcome === "settled" ? (
                              <span className="badge ok">SETTLED (${r.settledUsd.toFixed(4)})</span>
                            ) : r.outcome === "blocked_policy" ? (
                              <div>
                                <span className="badge bad">
                                  {r.policyErrorCode || "BLOCKED"}
                                </span>
                                {r.reroutedToVendorId && (
                                  <div
                                    className="mono"
                                    style={{ fontSize: "11px", color: "var(--copper)", marginTop: "3px" }}
                                  >
                                    ↳ Rerouted to {r.reroutedToVendorId}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="badge warn">FAILED (HTTP {r.httpStatus})</span>
                            )}
                          </td>
                          <td className="mono" style={{ fontSize: "11.5px" }}>
                            {r.txHash && r.explorerUrl ? (
                              <a
                                href={r.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="link-underline"
                              >
                                {shortHex(r.txHash, 8, 6)} ↗
                              </a>
                            ) : r.outcome === "settled" ? (
                              <span title={r.nonce || ""}>
                                EIP-3009 Sig Verified ({shortHex(r.nonce || "0x", 6, 4)})
                              </span>
                            ) : (
                              <span style={{ color: "var(--ink-faint)" }}>
                                Unsigned — Rejected Pre-Sign
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ── Verified Counterparty Dossier & Step-5 Seal ─────────────── */}
          {activeDossier && activeVerification && (
            <section className="sheet">
              <div className="sheet-header">
                <div>
                  <div className="sheet-kicker">Verified Deliverable</div>
                  <h2 className="sheet-title">{activeDossier.headline}</h2>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    className={`badge ${
                      activeDossier.executiveDecision === "proceed"
                        ? "ok"
                        : activeDossier.executiveDecision === "proceed_with_conditions"
                          ? "warn"
                          : "bad"
                    }`}
                  >
                    {activeDossier.executiveDecision.replace(/_/g, " ").toUpperCase()}
                  </span>
                  <span className="badge brand">
                    Risk {activeDossier.riskScore}/100
                  </span>
                </div>
              </div>

              <p style={{ margin: "0 0 18px", color: "var(--ink-muted)", fontSize: "14.5px" }}>
                {activeDossier.executiveSummary}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
                {activeDossier.findings.map((f) => (
                  <div key={f.findingId} className="finding-card">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "6px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="mono" style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--brand)" }}>
                        [{f.vendorId}.{f.fieldPath}] · {f.dimension}
                      </span>
                      <span
                        className={`badge ${
                          f.status === "verified"
                            ? "ok"
                            : f.status === "warning"
                              ? "warn"
                              : "bad"
                        }`}
                      >
                        {f.status}
                      </span>
                    </div>
                    <div style={{ fontSize: "13.5px", fontWeight: 500 }}>{f.claim}</div>
                    <div
                      className="mono"
                      style={{
                        marginTop: "6px",
                        fontSize: "11.5px",
                        color: "var(--ink-muted)",
                        background: "var(--bg-sunken)",
                        padding: "5px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      Evidence: &ldquo;{f.quotedEvidence}&rdquo;
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "10px",
                  background: activeVerification.passed ? "var(--ok-soft)" : "var(--bad-soft)",
                  border: `1px solid ${activeVerification.passed ? "rgba(20,108,67,0.3)" : "rgba(185,43,39,0.35)"}`,
                  marginBottom: "16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <strong style={{ fontSize: "13.5px" }}>
                    {activeVerification.passed
                      ? `✓ Deterministic Verifier Passed (${activeVerification.citationsResolved}/${activeVerification.citationsChecked} citations resolved)`
                      : "✕ Deterministic Verifier Flagged Dossier"}
                  </strong>
                  <span className="mono" style={{ fontSize: "11px" }}>
                    SHA-256: {shortHex(activeVerification.receiptDigestSha256, 12, 10)}
                  </span>
                </div>
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "12.5px", color: "var(--ink-muted)" }}>
                  {activeVerification.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>

              {/* Unit Economics + Optional Reppo Audit Footer */}
              {activeMargin && (
                <div className="grid-2">
                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px solid var(--rule)",
                      borderRadius: "8px",
                      background: "var(--bg-sheet-solid)",
                    }}
                  >
                    <div className="sheet-kicker">Run Unit Economics</div>
                    <div className="ticket-row">
                      <span>Wholesale Value</span>
                      <span className="mono">${activeMargin.wholesalePriceUsd.toFixed(4)}</span>
                    </div>
                    <div className="ticket-row">
                      <span>Upstream x402 Spend</span>
                      <span className="mono">−${activeMargin.upstreamSpendUsd.toFixed(4)}</span>
                    </div>
                    <div className="ticket-row">
                      <span>SERV Reasoning Tokens</span>
                      <span className="mono">−${activeMargin.servInferenceUsd.toFixed(4)}</span>
                    </div>
                    <div className="ticket-total" style={{ marginTop: "6px", paddingTop: "8px" }}>
                      <span>Net Margin</span>
                      <span className="mono" style={{ color: "var(--ok)" }}>
                        +${activeMargin.netMarginUsd.toFixed(4)} (+{activeMargin.grossMarginPct}%)
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px solid var(--rule)",
                      borderRadius: "8px",
                      background: "var(--bg-sheet-solid)",
                    }}
                  >
                    <div className="sheet-kicker">External Audit &amp; Conditions</div>
                    <ul style={{ margin: "6px 0 10px", paddingLeft: "18px", fontSize: "12.5px" }}>
                      {activeDossier.recommendedConditions.map((c, idx) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                    {completedRun?.reppoAudit && (
                      <div
                        style={{
                          paddingTop: "8px",
                          borderTop: "1px dashed var(--rule)",
                          fontSize: "12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span className="mono">
                          Reppo: <strong>{completedRun.reppoAudit.status}</strong> (
                          {shortHex(completedRun.reppoAudit.evalId, 8, 6)})
                        </span>
                        {completedRun.reppoAudit.evalId !== "unconfigured" &&
                          completedRun.reppoAudit.evalId !== "error" && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={reppoPolling}
                              onClick={() =>
                                handlePollReppo(completedRun.reppoAudit!.evalId)
                              }
                            >
                              {reppoPolling ? "Polling…" : "Refresh Verdict"}
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Live Kite Passport Ecosystem & External 402 Firewall ─────── */}
          {(ecosystemProbes.length > 0 ||
            (status?.kpass.liveCatalogSample && status.kpass.liveCatalogSample.length > 0)) && (
            <section className="sheet">
              <div className="sheet-header">
                <div>
                  <div className="sheet-kicker">Live Kite Passport Ecosystem</div>
                  <h2 className="sheet-title">
                    Third-Party x402 Pre-Flight Firewall (ksearch + Live HTTP 402)
                  </h2>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={ecosystemBusy}
                  onClick={() => void handleProbeEcosystem(maxPerTxUsd)}
                >
                  {ecosystemBusy ? "Probing HTTP 402…" : "Re-Probe Live x402 Endpoints"}
                </button>
              </div>

              {ecosystemProbes.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                  {ecosystemProbes.map((p) => (
                    <div
                      key={p.serviceId}
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--rule)",
                        borderRadius: "8px",
                        background: "var(--bg-sheet-solid)",
                        fontSize: "12.5px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                        <strong>{p.name}</strong>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <span className="mono badge brand">
                            HTTP {p.httpStatus || "ERR"} · {p.latencyMs}ms
                          </span>
                          {p.probedPriceUsd !== null && (
                            <span className="mono badge ok">${p.probedPriceUsd.toFixed(4)}</span>
                          )}
                          <span className={`badge ${p.servGuardPassed ? "ok" : "bad"}`}>
                            {p.servGuardPassed ? "PromptGuard Clean" : "Blocked"}
                          </span>
                          <span className={`badge ${p.kitePolicyAdmitted ? "ok" : "warn"}`}>
                            {p.kitePolicyAdmitted ? "Session Admitted" : "Session Policy Guarded"}
                          </span>
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: "11px", color: "var(--ink-faint)", marginTop: "4px" }}>
                        {p.probeEndpoint}
                        {p.probedNetworks.length > 0 ? ` · Networks: ${p.probedNetworks.join(", ")}` : ""}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "3px" }}>
                        {p.kitePolicyReason}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {status?.kpass.liveCatalogSample && status.kpass.liveCatalogSample.length > 0 && (
                <div className="grid-2">
                  {status.kpass.liveCatalogSample.map((item) => (
                    <div
                      key={item.service_id}
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--rule)",
                        borderRadius: "8px",
                        background: "var(--bg-sheet-solid)",
                        fontSize: "12.5px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <strong>{item.name}</strong>
                        {item.starting_price?.amount && (
                          <span className="mono badge ok">${item.starting_price.amount}</span>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: "11px", color: "var(--ink-faint)", marginTop: "3px" }}>
                        {item.base_url}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
