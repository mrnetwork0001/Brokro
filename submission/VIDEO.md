# Demo video — shot list

**Written for:** whoever records and narrates this, before judging closes on 15 November 2026.

Target **2:30–3:00**. Every claim below is one we can show on screen; nothing here needs a promise about future work.

The judging criteria are creativity, user readiness and revenue potential, and the track is Kite. So the spine of the film is: *the agent spends your money, under a limit it cannot raise, and refuses to ship a claim it cannot prove.*

---

## Before you record

- [ ] `https://trybrokro.vercel.app/desk` open, **hard reload** so the Passport panel has fresh allowance figures
- [ ] A second tab on `https://basescan.org` — you will paste a transaction hash into it live
- [ ] A third tab on the Kite Passport dashboard, **Sessions / Allowance** dialog open
- [ ] Browser zoom ~110%, window 1440×900, no bookmarks bar, no notifications
- [ ] Check the allowance has room: it resets Thursdays, and each run spends about $0.005

**Do not fake anything.** If a merchant times out mid-take, keep it and say so — a refusal that is visibly real is worth more than a smooth cut, and the whole thesis is that this thing tells you the truth.

---

## 00:00–00:18 · The problem, in one sentence

**Screen:** landing page, top. Hold on the headline.

> "Most agent demos end with the agent telling you it finished. Brokro's ends with a receipt that says what it bought, what it paid, and which claims survived checking."

Scroll slowly to **The problem**.

> "An agent that can spend your money has two failure modes. It overspends. Or it makes something up and you believe it. Brokro is built against both."

---

## 00:18–00:50 · Identity and the ceiling

**Screen:** `/desk`, the **Kite Agent Passport** panel at the top.

Point at the DID.

> "This agent is published in Kite's directory as `did:kite:auto-lvcj3a:brokro`. That's not a string in our database — anyone can resolve it."

**Cut to terminal.** Run it live:

```bash
kpass agent directory get did:kite:auto-lvcj3a:brokro --output json
```

> "Independent lookup. Same agent."

**Back to the desk.** Point at the allowance row: *$10 weekly, Kite enforces the ceiling*.

> "Ten dollars a week. Approved once with a passkey. Here's the part that matters —"

**Cut to the Passport dashboard**, Sessions dialog.

> "— this limit lives in Kite, not in Brokro. The agent holds no key on this rail. It cannot raise its own ceiling, because it has nothing to raise it with."

*(Optional, if the take allows: lower the allowance to $1, save, reload the desk, show the figure move. It is the single most convincing eight seconds available.)*

---

## 00:50–01:35 · The run

**Screen:** `/desk`. Leave every default. Press **Execute Bounded Procurement (With Attack Test)**.

Let the steps stream. Narrate over them, do not pause the run.

> "Six steps. Four of them can refuse."

**Step 1 — screen_catalog.** Point at the quarantined vendor.

> "ZeroFee Instant Audit Pro put instructions inside its own product description, trying to talk the buyer into paying it. It's refused here — before a payment is ever offered to it. Not flagged. Refused."

**Step 3 — settle_x402.** Point at the receipts appearing.

> "Now it's buying from businesses we don't control. Otto AI, PrintMoneyLab, IP402 — found through Kite's catalogue, priced in USDC on Base. Real money, real merchants."

**Step 5 — verify_dossier.** This is the beat to land.

> "And this is the part nobody demos. Every claim in the report gets resolved back to a field in a response a merchant actually returned. If a sentence cites a real field but misquotes the value, it is deleted. Not flagged — deleted. The verifier is plain TypeScript with no model in it, so a model can write a claim but cannot argue its way past the check."

---

## 01:35–02:10 · The receipt, and the chain

**Screen:** scroll to the receipt table.

Point at a row reading **SETTLED ON-CHAIN** with a tx hash.

> "Every purchase names the rail that paid and the policy that was enforced."

**Copy the tx hash. Paste it into Basescan. Let it load on camera.**

> "There it is. Real transaction, Base mainnet."

Point at the gas payer.

> "And notice who paid the gas — Kite's relayer, not us. The wallet holds zero ETH and never needed any. That's what makes an agent wallet practical to fund: one stablecoin, nothing else."

**Optional, 10s:** show a `SIGNED, NOT BROADCAST` receipt if one appears.

> "When a settlement signs but doesn't broadcast, it says so, and gives the facilitator's reason. An unfunded wallet still produces a valid signature — we'd rather tell you that than let you infer it from a missing hash."

---

## 02:10–02:35 · It holds no key, even deployed

**Screen:** the Passport panel badge, **KEYLESS · PASSPORT PAYS**.

> "One more thing. This is a serverless deployment. It can't run Kite's CLI. The easy fix would have been to give the public site a hot mainnet key."

> "We didn't. It forwards payments to a host that does have the CLI, over an authenticated bridge. Neither machine holds a key. Even holding the bridge secret, a caller can only pay merchants already in the registry — and the ceiling is still Kite's."

---

## 02:35–02:50 · Close

**Screen:** back to the landing page, **What it runs on**.

> "SERV Reasoning screens the vendors and writes the dossier. Kite Agent Passport is the identity and the spending limit. x402 moves the money. Reppo scores the result, after the fact, with a panel we don't control."

> "Brokro. Your agent gets a signed mandate, not your wallet."

**End card:** `trybrokro.vercel.app` · `did:kite:auto-lvcj3a:brokro`

---

## Things to say only if true on the day

- **Reppo** — only claim a score if one actually returns in the take.
- **Dolphin** — do not mention it. `DOLPHIN_API_KEY` is unset and `osint-brief` reports `deterministic-github-sensor`.
- **Kite Chain settlement** — do not imply money moves on `eip155:2366`. It doesn't: there's no mainnet USDC.e route, so that leg signs without broadcasting. The desk badge says **Home** for exactly this reason. If asked, the honest line is: *"Kite is the identity and the spending limit; Base is where these merchants price, so that's where it settles."*
- **The signing key** — the directory shows `activeKeyCount: 0`. If a judge spots it: *"the runtime key is for agents that sign as themselves; this one pays under an allowance, which needs no key."* True, and better said plainly than dodged.

## If you only get 60 seconds

Cut to three beats:

1. **00:00–0:15** the allowance, and that Kite enforces it, not us
2. **0:15–0:40** the run: the quarantined vendor, then a deleted claim at verify
3. **0:40–1:00** the tx hash on Basescan, with zero ETH in the wallet
