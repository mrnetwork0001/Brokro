# Brokro — Zero-Drain Agent Commerce & Pay-Only-If-Verified `x402` Escrow

**OpenServ SERV Hackathon, Edition 02** · Kite Track · Open Track (`SERV Reasoning` · `Kite Agent Passport` · `x402` · `Dolphin` & `Reppo` Hooks)

> **Give an agent a mandate and a spending cap, not your wallet — and never settle for a hallucinated report.**

Handing an unbounded crypto wallet to an AI agent breaks in three ways:
1. A single prompt-injected `/.well-known/x402` listing hijacks the planner and drains funds.
2. A deceptive merchant advertises `$0.003` in discovery, then demands `$0.085` inside its HTTP `402` `PAYMENT-REQUIRED` header at checkout.
3. Downstream agents pay `$0.05` for reports full of unverified LLM hallucinations.

**Brokro** solves all three in one live clearinghouse built on **SERV Reasoning** and **Kite Agent Passport**:
1. **Head-to-Head Attack Arena (`SERV OFF` vs. `SERV ON + Kite`):** Proves side-by-side why a naive unguarded LLM falls for prompt injection or `$0.085` HTTP `402` checkout spikes while Brokro blocks both and loses `$0.00`.
2. **Live Kite `ksearch` Ecosystem Firewall:** Pre-flights real third-party `x402` services (`Otto AI`, `PrintMoneyLab`, `IP402`) and procures live Google DNS, Kite/Base EVM RPC, and Dolphin OSINT feeds inside hard passkey session bounds.
3. **Zero-Hallucination `x402` Escrow (`POST /api/x402/procure` · $0.05):** External buyer authorizations (`EIP-3009`) are withheld until Step 5 Deterministic TypeScript proves **100% of cited `vendorId.fieldPath` facts match raw upstream JSON**. If verification fails, settlement aborts (`HTTP 422`, `$0` charged). When verified, Brokro clears **+$0.024–$0.030 net profit (~50–59% gross margin)** per call.

---

## Judge Fast Path (5 Minutes · Zero Keys · Nothing to Install)

1. **Open `/desk` (`Launch Arena & Desk`).** Confirm live Kite Chain (`eip155:2368` / `eip155:2366`), Pieverse Facilitator health, `ksearch` external `x402` HTTP 402 pre-flight probes, and `/.well-known/x402`.
2. **Run `⚔ Run Attack Arena (SERV OFF vs. SERV ON) →`.** Watch an unguarded LLM (`SERV OFF`) fall for `v-rogue-inject` / `$0.085` price spikes against **Brokro (`SERV ON + Kite`)** quarantining the attack in Step 1 (`serv_prompt_guard`), rejecting spikes pre-signature (`session_rule_exceeded`), and saving `$0.00` stolen.
3. **Execute Bounded Procurement.** Stream all 6 typed SERV steps live via SSE (`/v1/responses`, `serv_prompt_guard`, `serv_shadow_agent`), inspect any step's JSON, and verify the SHA-256 citation digest.
4. **Verify Zero-Hallucination Wholesale Escrow.** Click **Test External Buyer Call ($0.05 x402)** to watch an autonomous buyer negotiate HTTP `402`, receive a 100%-verified dossier with `X-Brokro-Escrow-Guarantee: pay-only-if-verified`, and book live net profit on the ledger.

---

## Architecture — 6-Step Bounded SERV & Kite Execution Graph

```text
01 screen_catalog ──> 02 plan_basket ──> 03 settle_x402 ──> 04 cross_examine ──> 05 verify_dossier ──> 06 anchor_audit
 (Deterministic +      (SERV /v1/responses   (Kite Session +    (SERV Shadow Agent    (Plain TypeScript    (Pay-Only-If-Verified
  serv_prompt_guard)    + Budget Solver)      Pieverse x402)     + Strict Citations)   Citation Verifier)   Escrow + Reppo Eval)
```

| Step | Engine & SERV Primitives | Guarantee |
|---|---|---|
| `screen_catalog` | Deterministic regex/payee guard + SERV `gpt-6-luna` with `serv_prompt_guard` | Poisoned manifests and burn payees (`0x...dead`) are quarantined before entering planner context. |
| `plan_basket` | SERV `POST /v1/responses` (`gpt-5.4-mini`, `summary: "auto"`) | Exposes intermediate reasoning trace and builds primary + fallback baskets inside `maxTotalAmountUsd`. |
| `settle_x402` | Kite `SessionPolicy` + `@x402/evm` + Pieverse `/v2` | Enforces `session_rule_exceeded`, `session_total_exceeded`, `session_endpoint_forbidden`, and `PaymentNonceReplayGuard` *before* signing. |
| `cross_examine` | SERV `/v1/chat/completions` with `serv_shadow_agent` (`max_iterations: 3`) + `serv_prompt_guard` | Requires every finding to cite a settled `vendorId` and real JSON `fieldPath`. |
| `verify_dossier` | Pure deterministic TypeScript (`src/lib/graph/steps.ts`) | Verifies every citation against returned payloads, rejects quarantined references, and seals a canonical SHA-256 digest. |
| `anchor_audit` | Wholesale Escrow Ledger + Optional Reppo (`eval.reppo.xyz/api/v1`) | Releases buyer `EIP-3009` settlement only when Step 5 passes 100%, computes exact net spread, and optionally submits async peer audits. |

---

## Real Upstream Telemetry — Nothing Simulated

- **Third-Party Kite Ecosystem Pre-Flight (`src/lib/partners/live-discovery.ts`):** Queries live external merchants from `ksearch` (`x402.ottoai.services`, `api.printmoneylab.com`, `ip402.xyz`), decodes real HTTP `402` `PAYMENT-REQUIRED` headers, and evaluates them against active Kite `SessionPolicy` bounds.
- **`/api/x402/vendors/registry-audit` ($0.005):** Live Google DNS-over-HTTPS (`A`, `MX`, `TXT/SPF`) + HTTPS TLS reachability probe.
- **`/api/x402/vendors/contract-telemetry` ($0.006):** Live JSON-RPC `eth_getCode`, `eth_getTransactionCount`, and ERC-20 `symbol()` inspection across **Kite Chain (`rpc.gokite.ai`)** and **Base (`mainnet.base.org`)** via `viem`.
- **`/api/x402/vendors/osint-brief` ($0.006):** Live GitHub REST repository telemetry distilled by decentralized open-weight inference (`deepseek-ai/DeepSeek-V4.1-Flash` on **Dolphin** when `DOLPHIN_API_KEY` is configured).
- **`/api/x402/vendors/reserve-attestation` ($0.005):** Independent Kite RPC block & Pieverse Facilitator signer verification fallback node.

---

## Running & Verifying Locally

```bash
git clone <your-repo-url>
cd Brokro
npm install
cp .env.example .env.local
# Add SERV_API_KEY (https://console.openserv.ai) and BROKR_BUYER_PRIVATE_KEY
```

### Unit Tests, Typecheck & Production Build

```bash
npm test            # 8 pure unit tests: Kite session caps, 5-way race, prompt-injection guard, verifier
npm run typecheck   # next typegen && tsc --noEmit
npm run build       # Zero-warning Next.js 16 production build
```

### End-to-End Live Verification Suite

```bash
PORT=3099 npm run dev
# In a second terminal:
npm run diag                                                  # Probes Kite RPC, Pieverse /v2/supported, kpass CLI, SERV key
node --import ./scripts/ts-resolve.mjs scripts/e2e-race.mjs   # 5-way concurrent spend cap race test
node scripts/e2e-arena.mjs                                    # SERV OFF vs. SERV ON Attack Arena proof
node scripts/e2e-procure.mjs                                  # Full 6-step SERV run + rogue merchant quarantine & 402 spike block
node scripts/e2e-wholesale.mjs                                # External buyer 402 -> EIP-3009 -> verified escrow wholesale margin test
```

A ready-to-submit Kite catalog manifest is included at [`kite-service/service.yaml`](kite-service/service.yaml).

---

## License

MIT
