// Sound effects via ElevenLabs /v1/sound-generation. Skips files that already exist.
//   node scripts/sfx.mjs                 all missing
//   ONLY=stamp,impact node scripts/sfx.mjs   force regenerate some
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, post, retry } from "./env.mjs";

const SFX = {
  // The cold open: a terminal typing a line it should not be typing.
  type: ["Sparse mechanical keyboard keystrokes, close and dry, uneven rhythm, a few seconds, no music", 2.5],
  tick: ["Single dry clock tick, close, short, cold", 0.5],
  // The refusal.
  stamp: ["Firm rubber stamp striking paper, single, close, dry, final", 0.6],
  denied: ["Low firm digital refusal tone, single, clean, like a door declining to open", 1.0],
  // Transitions.
  whoosh: ["Soft fast airy whoosh, smooth cinematic transition, no music", 1.0],
  riser: ["Tension riser, rising airy synth swell building to a peak, cinematic, no drums", 3],
  impact: ["Deep clean cinematic impact with a warm sub tail, modern, single hit", 2],
  // The ceiling and the key.
  lock: ["Soft precise mechanical lock engaging, single, close, clean", 0.8],
  chain: ["Short metallic chain link snapping shut, crisp, single, close", 0.6],
  // Money and receipts.
  coin: ["One small coin settling onto a hard surface, clean, short, close", 0.8],
  receipt: ["Short paper receipt printing, quick mechanical feed, close, dry", 1.2],
  confirm: ["Bright clean confirmation chime, two soft ascending notes, modern, short tail", 1.5],
  // The verifier deleting a claim.
  erase: ["Short soft digital erase, a line of text vanishing, clean, single", 0.7],
  scan: ["Quiet digital scanning sweep, soft and precise, short", 1.2],
  // UI.
  click: ["Soft modern UI click, single, clean, short", 0.5],
  reveal: ["Soft airy reveal swell, short, clean, no drums", 1.5],
};

const dir = join(ROOT, "public/audio/sfx");
mkdirSync(dir, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

for (const [name, [text, dur]] of Object.entries(SFX)) {
  const f = join(dir, `${name}.mp3`);
  if (only ? !only.includes(name) : existsSync(f)) { console.log(`${name}: skip`); continue; }
  try {
    const buf = await retry(async () => {
      const res = await post("/sound-generation?output_format=mp3_44100_128", { text, duration_seconds: dur, prompt_influence: 0.5 });
      return Buffer.from(await res.arrayBuffer());
    });
    writeFileSync(f, buf);
    console.log(`${name}: ${(buf.length / 1024).toFixed(0)}kb`);
  } catch (e) { console.error(`${name}: FAILED ${e.message}`); }
}
