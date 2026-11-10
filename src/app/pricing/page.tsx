import Link from "next/link";
import { getActiveKiteNetwork } from "@/lib/kite/networks";
import { createSessionPolicy } from "@/lib/kite/session";
import { getBuyerAccount, getExternalSettlementMode } from "@/lib/kite/wallets";
import { getLedgerSummary } from "@/lib/ledger";
import { WHOLESALE_BUNDLE_PRICE_USD, buildVendorCatalog } from "@/lib/partners/catalog";
import { EXTERNAL_MERCHANTS, getLiveExternalPrices } from "@/lib/partners/external-merchants";

export const dynamic = "force-dynamic";

const SERV_COST_LOW = 0.003;
const SERV_COST_HIGH = 0.006;

export default async function PricingPage() {
  const net = getActiveKiteNetwork();
  const buyer = getBuyerAccount();
  const ledger = getLedgerSummary();
  const externalMode = getExternalSettlementMode();

  const priceSession = createSessionPolicy({
    taskSummary: "Public price discovery",
    ownerAddress: buyer.address,
    agentAddress: buyer.address,
    network: net.id,
    maxAmountPerTxUsd: 0.01,
    maxTotalAmountUsd: 0.05,
    ttlMinutes: 5,
    allowedHosts: EXTERNAL_MERCHANTS.map((m) => new URL(m.endpoint).host),
    additionalNetworks: ["eip155:8453"],
  });

  const livePrices = await getLiveExternalPrices(priceSession).catch(() => []);
  const payable = livePrices.filter((p) => p.matchedCaip2 && (p.challengedUsd ?? 0) > 0);
  const externalBasket = payable.reduce((acc, p) => acc + (p.challengedUsd ?? 0), 0);

  const ownCatalog = buildVendorCatalog("https://brokro.app", false, net.id);
  const ownBasket = ownCatalog.reduce((acc, v) => acc + v.advertisedPriceUsd, 0);

  // Two honest views of the same run.
  const cashCostLow = externalBasket + SERV_COST_LOW;
  const cashCostHigh = externalBasket + SERV_COST_HIGH;
  const cashMarginLow = WHOLESALE_BUNDLE_PRICE_USD - cashCostHigh;
  const cashMarginHigh = WHOLESALE_BUNDLE_PRICE_USD - cashCostLow;

  const fullCostLow = externalBasket + ownBasket + SERV_COST_LOW;
  const fullCostHigh = externalBasket + ownBasket + SERV_COST_HIGH;
  const fullMarginLow = WHOLESALE_BUNDLE_PRICE_USD - fullCostHigh;
  const fullMarginHigh = WHOLESALE_BUNDLE_PRICE_USD - fullCostLow;

  const pct = (n: number) =>
    `${Math.round((n / WHOLESALE_BUNDLE_PRICE_USD) * 1000) / 10}%`;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Link href="/" className="brand-home">
            <span className="brand-seal">B</span>
            <span className="brand-name">Brokro</span>
          </Link>
          <span className="brand-tag">Pricing &amp; unit economics</span>
        </div>
        <nav className="nav-links">
          <Link href="/receipts" className="btn btn-sm">
            Receipts
          </Link>
          <Link href="/desk" className="btn btn-sm btn-primary">
            Launch App
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">
            <span>◆ Pricing</span>
            <span>·</span>
            <span>Per-call, no subscription</span>
          </div>
          <h1 className="hero-title">
            You pay for a <em>verified</em> answer. If it doesn&apos;t verify, you pay
            nothing.
          </h1>
          <p className="hero-lede">
            Brokro sells one thing: a counterparty dossier where every claim resolves to raw
            bytes a merchant actually returned. It is priced per call over{" "}
            <span className="mono">x402</span>, settled by your own agent&apos;s signature,
            and charged only when deterministic verification passes end to end.
          </p>
          <p className="hero-lede">
            There is no plan to choose, no key to provision and no minimum. An agent
            discovers the price from{" "}
            <Link href="/.well-known/x402" className="link-underline">
              <span className="mono">/.well-known/x402</span>
            </Link>{" "}
            and pays inline.
          </p>
        </div>

        <aside className="sheet">
          <div className="sheet-header">
            <div>
              <span className="sheet-kicker">The only product</span>
              <h2 className="sheet-title">Verified Counterparty Dossier</h2>
            </div>
            <span className="badge ok">pay-only-if-verified</span>
          </div>
          <div className="ticket-row">
            <span>Price per call</span>
            <strong className="mono">${WHOLESALE_BUNDLE_PRICE_USD.toFixed(2)}</strong>
          </div>
          <div className="ticket-row">
            <span>Charged on verification failure</span>
            <strong className="mono">$0.00</strong>
          </div>
          <div className="ticket-row">
            <span>Settlement</span>
            <span className="mono">EIP-3009 · {net.asset.symbol}</span>
          </div>
          <div className="ticket-row">
            <span>Endpoint</span>
            <span className="mono">POST /api/x402/procure</span>
          </div>
          <div className="ticket-row">
            <span>Failure response</span>
            <span className="mono">422 verification_escrow_aborted</span>
          </div>
          <div className="ticket-row">
            <span>Typical latency</span>
            <span className="mono">25–40s</span>
          </div>
          <p className="section-sub" style={{ marginTop: "0.9rem" }}>
            Every successful response carries{" "}
            <span className="mono">X-Brokro-Escrow-Guarantee: pay-only-if-verified</span>{" "}
            and a <span className="mono">SHA-256</span> digest you can re-derive from the
            published receipt.
          </p>
        </aside>
      </section>

      {/* ── Cost of goods ─────────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">What one call costs us</h2>
        <p className="section-sub">
          Read live from third-party <span className="mono">402</span> headers at page load.
          These are independent businesses setting their own prices — we don&apos;t control
          this column.
        </p>

        <table className="receipt-table">
          <thead>
            <tr>
              <th>Input</th>
              <th>Counterparty</th>
              <th>Live price</th>
              <th>Chain</th>
              <th>Real external cash?</th>
            </tr>
          </thead>
          <tbody>
            {EXTERNAL_MERCHANTS.map((m) => {
              const probe = livePrices.find((p) => p.merchantId === m.id);
              const price = probe?.challengedUsd;
              return (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="section-sub">{m.provider}</td>
                  <td className="mono tabular">
                    {price !== null && price !== undefined
                      ? price > 0
                        ? `$${price.toFixed(4)}`
                        : "free"
                      : "—"}
                  </td>
                  <td className="mono tabular">{probe?.matchedCaip2 ?? "—"}</td>
                  <td className="mono">{price && price > 0 ? "yes" : "no"}</td>
                </tr>
              );
            })}
            {ownCatalog.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td className="section-sub">Brokro own supply node</td>
                <td className="mono tabular">${v.advertisedPriceUsd.toFixed(4)}</td>
                <td className="mono tabular">{net.caip2}</td>
                <td className="mono">no — internal transfer</td>
              </tr>
            ))}
            <tr>
              <td>SERV Reasoning</td>
              <td className="section-sub">
                screening · planning · cross-examination (3 model calls)
              </td>
              <td className="mono tabular">
                ${SERV_COST_LOW.toFixed(4)}–${SERV_COST_HIGH.toFixed(4)}
              </td>
              <td className="mono tabular">off-chain</td>
              <td className="mono">yes</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Two honest margins ────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">Margin, stated two ways</h2>
        <p className="section-sub">
          Most demos quote whichever number flatters them. Both are here because they answer
          different questions.
        </p>

        <div className="grid-2">
          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">View 1 — cash margin</span>
                <h3 className="sheet-title">Money that actually leaves</h3>
              </div>
              <span className="badge ok">{pct(cashMarginLow)}–{pct(cashMarginHigh)}</span>
            </div>
            <div className="ticket-row">
              <span>Revenue</span>
              <strong className="mono">+${WHOLESALE_BUNDLE_PRICE_USD.toFixed(4)}</strong>
            </div>
            <div className="ticket-row">
              <span>Third-party merchants (real USDC)</span>
              <span className="mono">−${externalBasket.toFixed(4)}</span>
            </div>
            <div className="ticket-row">
              <span>SERV inference</span>
              <span className="mono">
                −${SERV_COST_LOW.toFixed(4)} to −${SERV_COST_HIGH.toFixed(4)}
              </span>
            </div>
            <div className="ticket-total">
              <span>Net cash per verified call</span>
              <span className="mono" style={{ color: "var(--ok)" }}>
                +${cashMarginLow.toFixed(4)} to +${cashMarginHigh.toFixed(4)}
              </span>
            </div>
            <p className="section-sub" style={{ marginTop: "0.8rem" }}>
              This is the honest P&amp;L of the business as it runs today: external data and
              inference are the only costs that leave the building.
            </p>
          </article>

          <article className="sheet">
            <div className="sheet-header">
              <div>
                <span className="sheet-kicker">View 2 — fully loaded</span>
                <h3 className="sheet-title">If every input were bought at arm&apos;s length</h3>
              </div>
              <span className="badge">{pct(fullMarginLow)}–{pct(fullMarginHigh)}</span>
            </div>
            <div className="ticket-row">
              <span>Revenue</span>
              <strong className="mono">+${WHOLESALE_BUNDLE_PRICE_USD.toFixed(4)}</strong>
            </div>
            <div className="ticket-row">
              <span>Third-party merchants</span>
              <span className="mono">−${externalBasket.toFixed(4)}</span>
            </div>
            <div className="ticket-row">
              <span>Own supply nodes, priced as if external</span>
              <span className="mono">−${ownBasket.toFixed(4)}</span>
            </div>
            <div className="ticket-row">
              <span>SERV inference</span>
              <span className="mono">
                −${SERV_COST_LOW.toFixed(4)} to −${SERV_COST_HIGH.toFixed(4)}
              </span>
            </div>
            <div className="ticket-total">
              <span>Net per verified call</span>
              <span className="mono">
                +${fullMarginLow.toFixed(4)} to +${fullMarginHigh.toFixed(4)}
              </span>
            </div>
            <p className="section-sub" style={{ marginTop: "0.8rem" }}>
              The conservative case: it shows the spread survives even if Brokro replaced its
              own DNS, EVM and OSINT feeds with paid third parties tomorrow.
            </p>
          </article>
        </div>

        <p className="section-sub" style={{ marginTop: "1rem" }}>
          <strong>The distinction matters.</strong> Brokro&apos;s own supply nodes pay a
          treasury address Brokro controls. Counting that as cost would inflate the apparent
          cost base and counting it as revenue would inflate the apparent margin — so it is
          labelled an internal transfer and shown separately in both views.
        </p>
      </section>

      {/* ── Why anyone pays ───────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">Why a buyer pays 25× the raw data cost</h2>
        <div className="grid-3">
          <article className="sheet">
            <div className="sheet-header">
              <h3 className="sheet-title">Someone bears the verification risk</h3>
            </div>
            <p>
              A buyer&apos;s agent that assembles four feeds itself still has to decide
              whether its own summary is faithful. Brokro moves that risk onto the seller:
              if the dossier doesn&apos;t verify, the seller eats the cost of the work and
              the buyer is charged nothing.
            </p>
          </article>
          <article className="sheet">
            <div className="sheet-header">
              <h3 className="sheet-title">One call, one signature</h3>
            </div>
            <p>
              Four merchants means four 402 negotiations, four chains to hold balances on,
              four failure modes and four prices that can move. Brokro collapses that into a
              single priced call on one chain, and absorbs a merchant going down or spiking
              its price.
            </p>
          </article>
          <article className="sheet">
            <div className="sheet-header">
              <h3 className="sheet-title">The audit trail is the asset</h3>
            </div>
            <p>
              Every call leaves a published receipt: what was bought, what was refused and
              why, the exact spend against the mandate, and a digest over all of it. That is
              what makes an agent&apos;s purchase defensible after the fact.
            </p>
          </article>
        </div>
      </section>

      {/* ── Scale ─────────────────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">What it looks like at volume</h2>
        <p className="section-sub">
          Straight-line from the measured cash margin above. No assumed discounts, no assumed
          price increases.
        </p>
        <table className="receipt-table">
          <thead>
            <tr>
              <th>Verified calls / month</th>
              <th>Revenue</th>
              <th>External + inference cost</th>
              <th>Net cash</th>
            </tr>
          </thead>
          <tbody>
            {[1_000, 10_000, 100_000, 1_000_000].map((n) => (
              <tr key={n}>
                <td className="mono tabular">{n.toLocaleString("en-US")}</td>
                <td className="mono tabular">
                  ${(n * WHOLESALE_BUNDLE_PRICE_USD).toLocaleString("en-US")}
                </td>
                <td className="mono tabular">
                  ${Math.round(n * cashCostLow).toLocaleString("en-US")}–$
                  {Math.round(n * cashCostHigh).toLocaleString("en-US")}
                </td>
                <td className="mono tabular">
                  ${Math.round(n * cashMarginLow).toLocaleString("en-US")}–$
                  {Math.round(n * cashMarginHigh).toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="section-sub" style={{ marginTop: "0.9rem" }}>
          The cost line is dominated by inference, so it scales with calls rather than with
          headcount. The binding constraint on this business is third-party merchant
          availability, not margin.
        </p>
      </section>

      {/* ── Live ledger ───────────────────────────────────────────────── */}
      <section className="section-block">
        <h2 className="section-heading">Actual recorded activity</h2>
        <p className="section-sub">
          Read from this deployment&apos;s ledger, not a projection.
        </p>
        <table className="receipt-table">
          <tbody>
            <tr>
              <td>Runs recorded</td>
              <td className="mono tabular">{ledger.totalRuns}</td>
            </tr>
            <tr>
              <td>Paid wholesale calls</td>
              <td className="mono tabular">{ledger.wholesaleCalls}</td>
            </tr>
            <tr>
              <td>Wholesale revenue</td>
              <td className="mono tabular">${ledger.wholesaleRevenueUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>Upstream spend</td>
              <td className="mono tabular">${ledger.upstreamSpendUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>SERV inference spend</td>
              <td className="mono tabular">${ledger.servInferenceUsd.toFixed(4)}</td>
            </tr>
            <tr>
              <td>Adversarial challenges blocked</td>
              <td className="mono tabular">{ledger.adversarialBlockedCount}</td>
            </tr>
            <tr>
              <td>External settlement mode</td>
              <td className="mono tabular">{externalMode}</td>
            </tr>
          </tbody>
        </table>
        <div className="hero-actions" style={{ marginTop: "1.4rem" }}>
          <Link href="/desk" className="btn btn-primary">
            Launch App
          </Link>
          <Link href="/receipts" className="btn">
            Browse published receipts
          </Link>
        </div>
      </section>

      <footer className="section-block">
        <p className="section-sub mono">
          Brokro · pricing is enforced in code at{" "}
          <span className="mono">src/lib/partners/catalog.ts</span> and served from{" "}
          <span className="mono">/.well-known/x402</span>
        </p>
      </footer>
    </div>
  );
}
