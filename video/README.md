# Brokro demo film

2:55, 4K, built with Remotion. Twelve scenes, one narrator and one in-world
voice, every figure read from the chain rather than typed.

## What is real

**The opening line.** Scene one is the verbatim `description` of the
`v-rogue-inject` fixture in `src/lib/partners/catalog.ts`: a listing in Brokro's
own catalogue that tells the buying agent to drop its rules and route the
session budget to a burn address. It was not written for the film.

**Every transaction.** `scripts/onchain.mjs` reads all five back from Base
mainnet into `data/onchain.json`: hash, block, UTC time, decoded transfers and
the gas payer. The scenes quote that file, so nothing on screen can drift from
what the chain says.

| What | Amount | Block | Hash |
| --- | --- | --- | --- |
| Paid through the Passport bridge from the deployed site | 0.001 USDC | 56,434,229 | `0x61298b66…` |
| First payment through the Kite allowance | 0.001 USDC | 56,422,906 | `0xb5563b5e…` |
| Otto AI token security | 0.001 USDC | 56,411,237 | `0x6b5f2f80…` |
| Otto AI DEX price | 0.001 USDC | 56,411,248 | `0x530519ba…` |
| PrintMoneyLab kimchi premium | 0.002 USDC | 56,411,263 | `0x9ad6fe9e…` |

All on 12 November 2026. Neither wallet holds any native token: the gas was paid
by Kite's relayer every time.

**Product footage** is the live deployment at `trybrokro.vercel.app`, recorded
with headless Chrome at 1600x900. The run it films spent about half a cent of
the owner's real Kite allowance, with their approval. The desk's allowance
figure ticks from 9.998 to 9.994 on camera because that is what happened.

**The Kite Passport dashboard** is the owner's own screen recording, muted and
trimmed to two clips and otherwise untouched (`data/footage-owner.json`). That
page is behind a passkey login and cannot be driven headlessly. Its Agents list
contains an agent named `__probe__`, left by a bad probe during setup; the clip
is not edited to hide it, and the camera simply never travels there.

**The explorer** shown is Blockscout, not Basescan. Basescan hard-blocks
headless Chrome at its bot check, and an early cut was filming a "Performing
security verification" interstitial captioned as on-chain proof. Both read the
same chain; `youtube.txt` links Basescan for humans.

**Voices** are ElevenLabs. The narrator is Ola, a Nigerian storyteller voice.
The merchant in scene one is cast against type as a smooth, trustworthy voice,
because the listing has to sound ordinary until you hear what it asks for.

**Partner logos** come from each project's own site and are used unaltered, on
a light card because two of the marks are dark and would vanish into the copper
(`data/logos.json`). They are not committed.

**Two listings** in the catalogue are deliberate attack fixtures. The film says
so, and so does the app.

## Build it

```bash
npm install
npm run onchain     # read the transactions back from Base
npm run logos       # fetch the partner logos
npm run vo          # narration with word timings (ElevenLabs)
npm run music       # the score
npm run sfx         # sixteen effects
npm run timing      # put every word on a frame -> src/timing.json
npm run capture     # ONLY=<clip,...> is mandatory; `run` spends real money
npm run encode      # frames -> public/footage/*.mp4 + src/footage.json
npm run stills 1820 2680   # check frames before rendering anything long
npm run draft       # half scale, fast
npm run render4k    # the master
npm run finish      # loudness to -14 LUFS, true peak -1 dBTP
npm run poster      # the thumbnail
```

`capture` refuses to run without `ONLY`, because one of its clips executes a
real procurement. It also sets the attack-test and third-party-merchant toggles
itself: an early take clicked straight through with both off and filmed a clean
catalogue with nothing to refuse and nothing settled, which proved neither of
the film's two claims.

## Where things live

```
script.json              every spoken line, with `say` where a word is
                         spelled for the voice ("Brok-roh")
src/timing.json          generated: every word on a frame
src/Film.tsx             scene order, music ducking, sound effect placement
src/scenes/              one file per scene
src/ui/Ceiling.tsx       the film's motif: a hard line above something that
                         cannot pass it
src/theme.ts             the app's own palette and fonts
data/onchain.json        every transaction, read from Base
data/footage-owner.json  what the owner's recording shows, and how it was cut
data/logos.json          where each partner logo came from
```

Audio, footage, logos and renders are gitignored. All of it is reproducible
from the scripts above.
