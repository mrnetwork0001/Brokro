import Link from "next/link";
import { listReceiptIndex } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default function ReceiptsIndexPage() {
  const rows = listReceiptIndex(50);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Link href="/" className="brand-home">
            <span className="brand-seal">B</span>
            <span className="brand-name">Brokro</span>
          </Link>
          <span className="brand-tag">Published receipts</span>
        </div>
        <nav className="nav-links">
          <Link href="/pricing" className="btn btn-sm">
            Pricing
          </Link>
          <Link href="/desk" className="btn btn-sm btn-primary">
            Launch App
          </Link>
        </nav>
      </header>

      <section className="section-block">
        <h1 className="section-heading">Every run leaves a receipt</h1>
        <p className="section-sub">
          A procurement an agent made on someone&rsquo;s behalf should be auditable after the
          fact by anyone holding the link. Each receipt below publishes what was bought, what
          was refused and why, the exact spend against the mandate, and a{" "}
          <span className="mono">SHA-256</span> digest over the whole record.
        </p>

        {rows.length === 0 ? (
          <article className="sheet">
            <p>
              No runs recorded yet in this deployment.{" "}
              <Link href="/desk" className="link-underline">
                Run a procurement on the desk
              </Link>{" "}
              and it will appear here with a shareable permalink.
            </p>
          </article>
        ) : (
          <table className="receipt-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Mandate</th>
                <th>Caller</th>
                <th>Verified</th>
                <th>Bought</th>
                <th>Refused</th>
                <th>Spend</th>
                <th>Digest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.runId}>
                  <td>
                    <Link href={`/receipt/${r.runId}`} className="link-underline mono">
                      {r.runId}
                    </Link>
                    <div className="section-sub mono">
                      {new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}Z
                    </div>
                  </td>
                  <td>
                    {r.title}
                    <div className="section-sub mono">{r.targetEntity}</div>
                  </td>
                  <td className="mono">
                    {r.callerType === "x402-wholesale-buyer" ? "x402 buyer" : "desk"}
                  </td>
                  <td className="mono tabular">
                    {r.verified ? (
                      <span className="badge ok">
                        {r.citationsValueMatched}/{r.citationsChecked}
                      </span>
                    ) : (
                      <span className="badge">
                        {r.citationsValueMatched}/{r.citationsChecked} failed
                      </span>
                    )}
                  </td>
                  <td className="mono tabular">
                    {r.settledCount}
                    {r.externalMerchantCount > 0 ? ` (${r.externalMerchantCount} ext)` : ""}
                  </td>
                  <td className="mono tabular">{r.blockedCount}</td>
                  <td className="mono tabular">${r.spentUsd.toFixed(4)}</td>
                  <td className="mono">{r.digest ? `${r.digest.slice(0, 10)}…` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
