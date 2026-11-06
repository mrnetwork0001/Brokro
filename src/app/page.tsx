import Link from "next/link";
import { checkFacilitatorHealth, getActiveKiteNetwork, readKiteWalletBalances } from "@/lib/kite/networks";
import { getBuyerAccount, getMerchantPayTo } from "@/lib/kite/wallets";
import { getLedgerSummary } from "@/lib/ledger";
import { WHOLESALE_BUNDLE_PRICE_USD } from "@/lib/partners/catalog";
import { isServConfigured } from "@/lib/serv";

export const dynamic = "force-dynamic";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function LandingPage() {
  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();
  const payTo = getMerchantPayTo();
  const ledger = getLedgerSummary();

  const [facilitator, balances] = await Promise.all([
    checkFacilitatorHealth(),
    readKiteWalletBalances(buyer.address, net).catch(() => ({
      tokenRaw: "0",
      tokenFormatted: "0",
      tokenUsd: 0,
      nativeKiteFormatted: "0",
    })),
  ]);

  const servReady = isServConfigured();

  return (
    <div className="shell">
      {/* ── Top Status Ribbon ───────────────────────────────────────────── */}
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-seal">B</span>
          <span className="brand-name">Brokr</span>
          <span className="brand-tag">SERV Reasoning · Kite Track</span>
        </div>

        <nav className="nav-links">
          <span className="pill">
            <span className={`dot ${servReady ? "ok" : "warn"}`} />
            SERV Reasoning {servReady ? "Live" : "Key Needed"}
          </span>
          <span className="pill">
            <span className={`dot ${facilitator.ok ? "ok" : "warn"}`} />
            {net.name} ({net.caip2}) · {net.asset.symbol}
          </span>
          <a
            href="/.well-known/x402"
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm mono"
          >
            /.well-known/x402 ↗
          </a>
          <Link href="/desk" className="btn btn-sm btn-primary">
            Launch Desk →
          </Link>
        </nav>
      </header>

      {/* ── Editorial Hero ──────────────────────────────────────────────── */}
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span>◆ OpenServ Hackathon 02</span>
            <span>·</span>
            <span>Autonomous x402 Clearinghouse</span>
          </div>
          <h1 className="hero-title">
            Give an agent a mandate and a <em>spending cap</em>, not your wallet.
          </h1>
          <p className="hero-lede">
            Too complex to procure with a single API call. Too dangerous to hand an
            unbounded wallet to a raw prompt. <strong>Brokr</strong> screens untrusted{" "}
            <span className="mono">x402</span> vendors on{" "}
            <strong>SERV Reasoning</strong>, pays inside passkey-locked{" "}
            <strong>Kite Agent Passport</strong> bounds, verifies every cited field
            before acceptance, and resells verified dossiers at a unit-positive spread.
          </p>

          <div className="hero-actions">
            <Link href="/desk" className="btn btn-primary">
              Open Clearinghouse Desk →
            </Link>
            <a href="#judge-fast-path" className="btn">
              5-Minute Judge Fast Path
            </a>
            <a
              href={`${net.explorerBaseUrl}/address/${buyer.address}`}
              target="_blank"
              rel="noreferrer"
              className="btn mono"
            >
              Agent {shortAddr(buyer.address)} ↗
            </a>
          </div>
        </div>

        {/* ── Live Unit-Economics & Clearinghouse Specimen ──────────────── */}
        <aside className="sheet">
          <div className="sheet-header">
            <div>
              <div className="sheet-kicker">Live Clearinghouse Ledger</div>
              <h2 className="sheet-title">Two-Sided x402 Unit Economics</h2>
            </div>
            <span className="badge ok">~59% Gross Margin</span>
          </div>

          <div className="ticket-row">
            <span>
              Wholesale Dossier Price (<span className="mono">POST /api/x402/procure</span>)
            </span>
            <strong className="mono">+${WHOLESALE_BUNDLE_PRICE_USD.toFixed(4)}</strong>
          </div>
          <div className="ticket-row">
            <span>Upstream Vendor 1 · Atlas DNS &amp; TLS Probe</span>
            <span className="mono">−$0.0050</span>
          </div>
          <div className="ticket-row">
            <span>Upstream Vendor 2 · Kite &amp; Base EVM Bytecode Probe</span>
            <span className="mono">−$0.0060</span>
          </div>
          <div className="ticket-row">
            <span>Upstream Vendor 3 · Dolphin Open-Weight OSINT Node</span>
            <span className="mono">−$0.0060</span>
          </div>
          <div className="ticket-row">
            <span>SERV Reasoning (6-Step Bounded Graph + Shadow Agent)</span>
            <span className="mono">−$0.0035</span>
          </div>

          <div className="ticket-total">
            <span>Net Clearing Spread per Automated Call</span>
            <span className="mono" style={{ color: "var(--ok)", fontSize: "17px" }}>
              +$0.0295 (+59.0%)
            </span>
          </div>

          <div
            style={{
              marginTop: "18px",
              paddingTop: "14px",
              borderTop: "1px solid var(--rule)",
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "10px",
              fontSize: "12px",
            }}
          >
            <div>
              <div className="sheet-kicker">Buyer Balance</div>
              <div className="mono" style={{ fontWeight: 600, marginTop: "3px" }}>
                {Number(balances.tokenFormatted).toFixed(4)} {net.asset.symbol}
              </div>
            </div>
            <div>
              <div className="sheet-kicker">Merchant PayTo</div>
              <div className="mono" style={{ fontWeight: 600, marginTop: "3px" }}>
                {shortAddr(payTo)}
              </div>
            </div>
            <div>
              <div className="sheet-kicker">Rogue Blocked</div>
              <div className="mono" style={{ fontWeight: 600, marginTop: "3px", color: "var(--copper)" }}>
                {ledger.adversarialBlockedCount} intercepted
              </div>
            </div>
          </div>
        </aside>
      </section>

      {/* ── Why Two Layers of Defense + 6-Step Bounded Graph ────────────── */}
      <section className="section-block">
        <div className="eyebrow">Architecture · Nothing Moves on a Model&apos;s Say-So</div>
        <h2 className="section-heading">
          Why autonomous buying requires both a reasoning graph and cryptographic session bounds
        </h2>
        <p className="section-sub">
          Prompt filters cannot see an HTTP 402 header price spike at checkout, and
          spending caps alone cannot tell if a cheap vendor injected instructions into
          its payload. Brokr pairs <strong>SERV Reasoning</strong> with{" "}
          <strong>Kite Agent Passport</strong> so neither failure mode touches funds.
        </p>

        <div className="step-grid">
          <div className="mini-step">
            <span className="mini-step-num">01 · SCREEN</span>
            <strong>Catalog Guard</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              Deterministic rules + <span className="mono">serv_prompt_guard</span>{" "}
              quarantine poisoned vendor manifests before planning.
            </span>
          </div>
          <div className="mini-step">
            <span className="mini-step-num">02 · PLAN</span>
            <strong>Budget Solver</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              SERV <span className="mono">/v1/responses</span> streams reasoning
              summaries and plans primary + fallback coverage inside cap.
            </span>
          </div>
          <div className="mini-step">
            <span className="mini-step-num">03 · SETTLE</span>
            <strong>Kite x402 Gate</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              Blocks mid-checkout 402 spikes (<span className="mono">session_rule_exceeded</span>)
              before EIP-3009 signing; settles via Pieverse.
            </span>
          </div>
          <div className="mini-step">
            <span className="mini-step-num">04 · EXAMINE</span>
            <strong>Shadow Agent</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              SERV <span className="mono">serv_shadow_agent</span> cross-examines
              live DNS, EVM, and Dolphin OSINT payloads with strict citations.
            </span>
          </div>
          <div className="mini-step">
            <span className="mini-step-num">05 · VERIFY</span>
            <strong>Plain-Code Audit</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              Deterministic TypeScript resolves every <span className="mono">vendorId.fieldPath</span>{" "}
              citation and seals a SHA-256 receipt digest.
            </span>
          </div>
          <div className="mini-step">
            <span className="mini-step-num">06 · ANCHOR</span>
            <strong>Wholesale &amp; Reppo</strong>
            <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
              Books live net wholesale margin and optionally anchors async peer verdicts
              on <span className="mono">eval.reppo.xyz</span>.
            </span>
          </div>
        </div>
      </section>

      {/* ── 5-Minute Judge Fast Path ────────────────────────────────────── */}
      <section id="judge-fast-path" className="section-block" style={{ borderBottom: "none" }}>
        <div className="eyebrow">Zero Keys · Nothing to Install</div>
        <h2 className="section-heading">Judge Fast Path — Verify Everything in 5 Minutes</h2>
        <div className="grid-3" style={{ marginTop: "24px" }}>
          <div className="sheet">
            <div className="badge brand" style={{ marginBottom: "10px" }}>
              1 · Clean Live Procurement
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>
              Stream the 6-Step SERV Graph
            </h3>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-muted)" }}>
              Open <Link href="/desk" className="link-underline">/desk</Link> and click{" "}
              <strong>Execute Bounded Procurement</strong>. Watch live Google DNS, Kite/Base
              EVM RPC, and GitHub/Dolphin probes settle inside a $0.035 Kite session cap
              with every cited JSON field verified.
            </p>
          </div>

          <div className="sheet">
            <div className="badge bad" style={{ marginBottom: "10px" }}>
              2 · Adversarial Rogue Vendors
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>
              Trigger Prompt-Hijack &amp; 402 Spike
            </h3>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-muted)" }}>
              Toggle on <strong>Include Rogue Merchants</strong> and run again. Watch{" "}
              <span className="mono">v-rogue-inject</span> get quarantined in Step 1 and{" "}
              <span className="mono">v-rogue-spike</span> ($0.003 → $0.085 bait-and-switch)
              get blocked cold with <span className="mono">session_rule_exceeded</span>{" "}
              and rerouted automatically.
            </p>
          </div>

          <div className="sheet">
            <div className="badge ok" style={{ marginBottom: "10px" }}>
              3 · Live Wholesale Revenue
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: "18px" }}>
              Call Brokr as a Paid x402 Service
            </h3>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-muted)" }}>
              Click <strong>Test External Buyer ($0.05)</strong> on the desk (or call{" "}
              <span className="mono">POST /api/x402/procure</span> with{" "}
              <span className="mono">kpass agent:session execute</span>) to verify HTTP 402
              challenge → EIP-3009 signature → ~59% net gross margin.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
