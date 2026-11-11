import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunById } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function ts(iso: string): string {
  return `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)}Z`;
}

function shortHex(v: string, head = 10, tail = 6): string {
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = getRunById(runId);
  if (!run) notFound();

  const v = run.verification;
  const settled = run.receipts.filter((r) => r.outcome === "settled");
  const blocked = run.receipts.filter((r) => r.outcome === "blocked_policy");
  const failed = run.receipts.filter((r) => r.outcome === "failed");
  const quarantined = run.guards.filter((g) => !g.admitted);
  const external = run.receipts.filter((r) => r.externalMerchant);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Link href="/" className="brand-home">
            <span className="brand-seal">B</span>
            <span className="brand-name">Brokro</span>
          </Link>
          <span className="brand-tag mono">receipt {run.runId}</span>
        </div>
        <nav className="nav-links">
          <Link href="/receipts" className="btn btn-sm">
            ← All receipts
          </Link>
          <Link href="/desk" className="btn btn-sm btn-primary">
            Launch App
          </Link>
        </nav>
      </header>

      {/* ── Verdict ─────────────────────────────────────────────────── */}
      <section className="section-block">
        <div className="eyebrow">
          <span>◆ Published receipt</span>
          <span>·</span>
          <span className="mono">{ts(run.createdAt)}</span>
          <span>·</span>
          <span className="mono">
            {run.callerType === "x402-wholesale-buyer"
              ? "paid x402 buyer"
              : "interactive desk"}
          </span>
        </div>
        <h1 className="section-heading">{run.mandate.title}</h1>
        <p className="section-sub">
          Target <span className="mono">{run.mandate.targetEntity}</span> ·{" "}
          <span className="mono">{run.mandate.targetIdentifier}</span>
        </p>

        <div className="grid-3" style={{ marginTop: "1.2rem" }}>
          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">Settlement</span>
                <h2 className="sheet-title">
                  {v?.passed ? "Released" : "Withheld"}
                </h2>
              </div>
              <span className={`badge ${v?.passed ? "ok" : ""}`}>
                {v?.passed ? "verified" : "aborted"}
              </span>
            </div>
            <p className="section-sub">
              {v?.passed
                ? "Every cited claim matched the raw bytes its merchant returned, so the buyer's EIP-3009 authorization was settled."
                : "Verification did not pass, so the buyer's authorization was never captured. $0 was charged for this run."}
            </p>
          </article>

          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">Citations value-matched</span>
                <h2 className="sheet-title mono">
                  {v?.citationsValueMatched ?? 0}/{v?.citationsChecked ?? 0}
                </h2>
              </div>
            </div>
            <p className="section-sub">
              Each finding&apos;s quoted evidence compared against the value living at its
              cited field path — not merely that the field exists.
            </p>
          </article>

          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">Spend against mandate</span>
                <h2 className="sheet-title mono">
                  ${run.margin.upstreamSpendUsd.toFixed(4)}
                </h2>
              </div>
            </div>
            <p className="section-sub">
              Cap was ${run.session.maxTotalAmountUsd.toFixed(4)} total, $
              {run.session.maxAmountPerTxUsd.toFixed(4)} per transaction.{" "}
              {blocked.length > 0
                ? `${blocked.length} challenge(s) refused before signing.`
                : "No challenge breached the mandate."}
            </p>
          </article>
        </div>

        {v?.receiptDigestSha256 && (
          <article className="sheet" style={{ marginTop: "1.2rem" }}>
            <div className="sheet-header">
              <span className="sheet-kicker">Canonical SHA-256 digest</span>
            </div>
            <p className="mono" style={{ wordBreak: "break-all" }}>
              {v.receiptDigestSha256}
            </p>
            <p className="section-sub">
              Computed over the dossier, every receipt outcome, the value-match count and the
              mandate id. Re-derivable from this page&apos;s JSON.
            </p>
          </article>
        )}
      </section>

      {/* ── The mandate ─────────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">The mandate this ran under</h2>
        <table className="receipt-table">
          <tbody>
            <tr>
              <td>Mandate id</td>
              <td className="mono">{run.session.sessionId}</td>
            </tr>
            <tr>
              <td>Mode</td>
              <td className="mono">{run.session.mode}</td>
            </tr>
            <tr>
              <td>Owner</td>
              <td className="mono">{run.session.ownerAddress}</td>
            </tr>
            <tr>
              <td>Agent signer</td>
              <td className="mono">{run.session.agentAddress}</td>
            </tr>
            <tr>
              <td>Max per transaction</td>
              <td className="mono tabular">
                ${run.session.maxAmountPerTxUsd.toFixed(4)}
              </td>
            </tr>
            <tr>
              <td>Max total</td>
              <td className="mono tabular">
                ${run.session.maxTotalAmountUsd.toFixed(4)}
              </td>
            </tr>
            <tr>
              <td>Actually spent</td>
              <td className="mono tabular">${run.session.spentUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>Authorized chains &amp; assets</td>
              <td className="mono">
                {(run.session.allowedAssets ?? []).length > 0
                  ? (run.session.allowedAssets ?? [])
                      .map((a) => `${a.symbol} on ${a.caip2Network}`)
                      .join(" · ")
                  : `${run.session.assetSymbol} on ${run.session.caip2Network}`}
              </td>
            </tr>
            <tr>
              <td>Authorized hosts</td>
              <td className="mono">{run.session.allowedHosts.join(" · ")}</td>
            </tr>
            <tr>
              <td>Expires</td>
              <td className="mono">{ts(run.session.expiresAt)}</td>
            </tr>
            <tr>
              <td>Owner authorization</td>
              <td className="mono">
                {run.session.ownerAuthorization === "kite-passport-passkey"
                  ? "Kite Passport passkey approval"
                  : run.session.ownerAuthorization === "eip191-wallet-signature"
                    ? "EIP-191 wallet signature (verified)"
                    : "none \u2014 keyless demo session"}
              </td>
            </tr>
            {run.session.walletSignature && (
              <tr>
                <td>Owner wallet signature</td>
                <td className="mono">{shortHex(run.session.walletSignature, 20, 10)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── What was refused ────────────────────────────────────────── */}
      {(blocked.length > 0 || quarantined.length > 0 || failed.length > 0) && (
        <section className="section-block">
          <h2 className="section-heading">What was refused, and why</h2>
          <p className="section-sub">
            The refusals are the point. Each names the clause that stopped it.
          </p>
          <table className="receipt-table">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Stage</th>
                <th>Code</th>
                <th>Reason</th>
                <th>Charged</th>
              </tr>
            </thead>
            <tbody>
              {quarantined.map((g) => (
                <tr key={g.vendorId}>
                  <td>
                    {g.vendorName}
                    <div className="section-sub mono">{g.vendorId}</div>
                  </td>
                  <td className="mono">catalog screen</td>
                  <td className="mono">
                    {g.deterministicHits.length > 0
                      ? g.deterministicHits.join(", ")
                      : "serv_prompt_guard"}
                  </td>
                  <td className="section-sub">{g.reason}</td>
                  <td className="mono tabular">$0.0000</td>
                </tr>
              ))}
              {[...blocked, ...failed].map((r) => (
                <tr key={r.receiptId}>
                  <td>
                    {r.vendorName}
                    <div className="section-sub mono">
                      {r.vendorId}
                      {r.externalMerchant ? " · third-party" : ""}
                    </div>
                  </td>
                  <td className="mono">
                    {r.outcome === "blocked_policy" ? "pre-signature" : "execution"}
                  </td>
                  <td className="mono">{r.policyErrorCode ?? r.outcome}</td>
                  <td className="section-sub">{r.policyHint ?? "—"}</td>
                  <td className="mono tabular">${r.settledUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── What was bought ─────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">What was bought</h2>
        {external.length > 0 && (
          <p className="section-sub">
            {external.length} of these settled against{" "}
            <strong>independent third-party merchants</strong> rather than Brokro&apos;s own
            supply nodes.
          </p>
        )}
        <table className="receipt-table">
          <thead>
            <tr>
              <th>Counterparty</th>
              <th>Advertised</th>
              <th>Challenged</th>
              <th>Settled</th>
              <th>Chain</th>
              <th>On chain</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {settled.map((r) => (
              <tr key={r.receiptId}>
                <td>
                  {r.vendorName}
                  <div className="section-sub mono">
                    {r.externalMerchant ? "third-party merchant" : "Brokro supply node"}
                  </div>
                </td>
                <td className="mono tabular">${r.advertisedUsd.toFixed(4)}</td>
                <td className="mono tabular">${r.challengedUsd.toFixed(4)}</td>
                <td className="mono tabular">${r.settledUsd.toFixed(4)}</td>
                <td className="mono tabular">
                  {r.settlementNetwork ?? r.caip2Network}
                </td>
                <td className="mono">{r.onChain ? "yes" : "signed, unfunded"}</td>
                <td className="mono">
                  {r.explorerUrl && r.txHash ? (
                    <a
                      href={r.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="link-underline"
                    >
                      {shortHex(r.txHash)} ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── The dossier ─────────────────────────────────────────────── */}
      {run.dossier && (
        <section className="section-block">
          <h2 className="section-heading">The answer that was sold</h2>
          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">
                  {run.dossier.executiveDecision.replace(/_/g, " ")} · risk{" "}
                  {run.dossier.riskScore}/100
                </span>
                <h3 className="sheet-title">{run.dossier.headline}</h3>
              </div>
            </div>
            <p>{run.dossier.executiveSummary}</p>
          </article>

          <table className="receipt-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Finding</th>
                <th>Claim</th>
                <th>Cited field</th>
                <th>Quoted evidence</th>
                <th>Value match</th>
              </tr>
            </thead>
            <tbody>
              {run.dossier.findings.map((f) => {
                const misquoted = (v?.misquotedCitations ?? []).some((m) =>
                  m.startsWith(`${f.findingId}:`),
                );
                const unresolved = (v?.unresolvedCitations ?? []).some((m) =>
                  m.startsWith(`${f.findingId}:`),
                );
                return (
                  <tr key={f.findingId}>
                    <td className="mono">
                      {f.findingId}
                      <div className="section-sub">{f.status}</div>
                    </td>
                    <td>{f.claim}</td>
                    <td className="mono">
                      {f.vendorId}.{f.fieldPath}
                    </td>
                    <td className="section-sub">{f.quotedEvidence}</td>
                    <td className="mono">
                      {unresolved ? (
                        <span className="badge">unresolved</span>
                      ) : misquoted ? (
                        <span className="badge">misquoted</span>
                      ) : (
                        <span className="badge ok">matched</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {run.dossier.recommendedConditions.length > 0 && (
            <article className="sheet" style={{ marginTop: "1rem" }}>
              <div className="sheet-header">
                <span className="sheet-kicker">Recommended conditions</span>
              </div>
              <ul>
                {run.dossier.recommendedConditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </article>
          )}
        </section>
      )}

      {/* ── Verifier notes ──────────────────────────────────────────── */}
      {v && (
        <section className="section-block">
          <h2 className="section-heading">Verifier output</h2>
          <table className="receipt-table">
            <tbody>
              <tr>
                <td>Citations checked</td>
                <td className="mono tabular">{v.citationsChecked}</td>
              </tr>
              <tr>
                <td>Field paths resolved</td>
                <td className="mono tabular">{v.citationsResolved}</td>
              </tr>
              <tr>
                <td>Values matched</td>
                <td className="mono tabular">{v.citationsValueMatched}</td>
              </tr>
              <tr>
                <td>Budget invariant</td>
                <td className="mono">{v.budgetInvariantPassed ? "pass" : "fail"}</td>
              </tr>
              <tr>
                <td>Per-transaction invariant</td>
                <td className="mono">{v.perTxInvariantPassed ? "pass" : "fail"}</td>
              </tr>
              <tr>
                <td>Quarantined merchant cited</td>
                <td className="mono">{v.quarantinedVendorReferenced ? "yes" : "no"}</td>
              </tr>
            </tbody>
          </table>

          {(v.unresolvedCitations.length > 0 || v.misquotedCitations.length > 0) && (
            <article className="sheet" style={{ marginTop: "1rem" }}>
              <div className="sheet-header">
                <span className="sheet-kicker">Why settlement was withheld</span>
              </div>
              <ul>
                {v.unresolvedCitations.map((c, i) => (
                  <li key={`u${i}`} className="mono">
                    {c}
                  </li>
                ))}
                {v.misquotedCitations.map((c, i) => (
                  <li key={`m${i}`} className="mono">
                    {c}
                  </li>
                ))}
              </ul>
            </article>
          )}

          <article className="sheet" style={{ marginTop: "1rem" }}>
            <div className="sheet-header">
              <span className="sheet-kicker">Notes</span>
            </div>
            <ul>
              {v.notes.map((n, i) => (
                <li key={i} className="section-sub">
                  {n}
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}

      {/* ── Economics + steps ───────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">Economics of this call</h2>
        <table className="receipt-table">
          <tbody>
            <tr>
              <td>Sold for</td>
              <td className="mono tabular">${run.margin.wholesalePriceUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>Upstream spend</td>
              <td className="mono tabular">−${run.margin.upstreamSpendUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>SERV inference</td>
              <td className="mono tabular">−${run.margin.servInferenceUsd.toFixed(4)}</td>
            </tr>
            <tr className="ticket-total">
              <td>
                <strong>Net</strong>
              </td>
              <td className="mono tabular">
                <strong>
                  {run.margin.netMarginUsd >= 0 ? "+" : ""}$
                  {run.margin.netMarginUsd.toFixed(4)} ({run.margin.grossMarginPct}%)
                </strong>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="receipt-table" style={{ marginTop: "1.2rem" }}>
          <thead>
            <tr>
              <th>Step</th>
              <th>Engine</th>
              <th>Model</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((s) => (
              <tr key={s.step}>
                <td className="mono">{s.step}</td>
                <td className="section-sub">{s.engine}</td>
                <td className="mono">{s.model ?? "—"}</td>
                <td className="mono">{s.status}</td>
                <td className="mono tabular">{s.durationMs ? `${s.durationMs}ms` : "—"}</td>
                <td className="mono tabular">{s.tokens?.total ?? "—"}</td>
                <td className="mono tabular">
                  {s.costUsd !== undefined ? `$${s.costUsd.toFixed(5)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="section-block">
        <p className="section-sub mono">
          Machine-readable: <span className="mono">GET /api/receipt/{run.runId}</span>
        </p>
      </footer>
    </div>
  );
}
