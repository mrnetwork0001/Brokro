# Brokro — OpenServ SERV Hackathon Edition 02, Track 02 (Kite)

App: https://trybrokro.vercel.app
Demo: https://youtu.be/4NYNXsAoUm8
Code: https://github.com/mrnetwork0001/Brokro

Answers to the submission form, kept here so the wording is version-controlled
rather than retyped into a text box.

---

## Tell us about your project. What does it do, who is it for, what problem does it solve, and how does it work?

**What it does.** Brokro is a procurement desk for AI agents. You write a brief
— "screen this contract before I whitelist a recurring session" — and set a
spending ceiling. The agent then shops real third-party x402 merchants inside
that ceiling, pays them in USDC on Base, cross-examines what they sold it, and
hands back a dossier in which every sentence is traceable to bytes a merchant
actually returned. When it can't stand behind a claim, it deletes the claim and
tells you why.

**Who it's for.** Anyone who wants an agent to spend money on their behalf
without handing it a wallet: a security team buying contract screenings before a
treasury approval, an ops engineer paying per-call data APIs, a developer who
wants an agent to go buy something and come back with a receipt instead of a
plausible paragraph. Internally it's also a reference implementation of how to
put a budget around an autonomous buyer.

**The problem.** Agentic payments have two failure modes that the x402 ecosystem
hasn't closed yet. The first is custody: the standard way to let an agent pay is
to give it a private key, at which point the only thing between the agent and
your balance is the agent's own good behaviour. A prompt-injected or confused
agent with a key can empty the wallet, and no amount of system-prompt discipline
is an actual control. The second is provenance: an agent that pays for data and
then narrates a summary gives you no way to tell which parts came from the
merchant and which the model filled in. You've paid real money for an
unverifiable claim.

**How it works.** Four mechanisms, each of which refuses rather than warns.

1. **Keyless settlement.** On the Kite Agent Passport rail the agent holds no
   private key at all. It asks the owner's Passport to pay, and Kite enforces
   the weekly allowance the owner approved with a passkey — $10/week here. The
   agent cannot raise its own limit because it has nothing to raise it with. A
   hot-key EIP-3009 rail exists as a documented fallback, and the deployed site
   deliberately ships without that key configured, so the public instance can
   only settle the keyless way.

2. **Pay-nothing-if-unverified.** Settlement is an EIP-3009
   `transferWithAuthorization` through the Pieverse facilitator, which pays the
   gas — so the payer never needs a native token. Verification runs after the
   bytes arrive but before the buyer is charged. If a claim fails verification
   the buyer pays $0 and Brokro absorbs the merchant's fee. The incentive points
   the right way: the desk eats the cost of its own bad run.

3. **A verifier with no model in it.** Claims are checked mechanically against
   the merchant's response payload. Cite a field that doesn't exist and the
   sentence is deleted; cite a real field but misquote it and the sentence is
   still deleted, not flagged. There is no judge model to talk around.

4. **Refusing before paying.** Eight typed refusal codes cover session rules,
   totals, forbidden endpoints and assets, expiry, forbidden payees, nonce
   replay, and — added during this build — `target_not_servable`: before signing
   anything, the desk checks that the merchant can actually answer the question
   asked. If the mandate's target has no bytecode on the chain the merchant
   indexes, the merchant would happily charge and return nothing, so no
   signature is produced. Every refusal is a receipt, not a log line.

**What's real, and what isn't.** The merchants are real and external: Otto AI
(token security, DEX token price), PrintMoneyLab (Kimchi premium), IP402
(geolocation/ASN). Reppo's eval node anchors an outside opinion on the finished
dossier but never gates checkout. Every transaction in the demo is real USDC on
Base, and every figure on the site is read back off the chain rather than stored
— the landing page shows an em dash instead of a zero when an instance has no
runs to report, because a desk that has never refused anything and a desk with
nothing to say are not the same claim.

The attacker is ours. Two red-team listings sit in the catalogue behind a flag:
one carries a prompt injection telling the buying agent to ignore its rules and
route maximum budget to `0x…dEaD`, the other advertises $0.003 and demands
$0.085 in the HTTP 402 header. We wrote them, because you cannot ask a real
merchant to attack you on cue — but the controls they exercise are the same ones
that run against the real merchants, and the burn address never gets an offer.
