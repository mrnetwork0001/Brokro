// Renders one real script line in each candidate voice, for an A/B listen.
import { key, API, retry } from "./env.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const LINE =
  "Brokro. Your agent gets a signed mandate, not your wallet. " +
  "Which means the agent cannot raise it. On this rail Brokro holds no private key at all. It asks. Kite decides.";

const CANDIDATES = [
  ["1-ola-storyteller",  "8P18CIVcRlwP98FOjZDm", "Ola - Nigerian Storyteller (deep, documentary gravitas)"],
  ["2-uyi-nigerian-am",  "NwBN5lRnglDs8TBVmser", "Uyi - Nigerian American (warm, confident, mature)"],
  ["3-olu-lagos",        "ytMkkl3KqcF3nhlFgtys", "Olu - Lagos-Yoruba cadence, expressive"],
  ["4-michael-onoja",    "lessJP1z7bvQVbfEDaZ9", "Michael Onoja - clear, conversational explainer"],
  ["5-drseun",           "bq6RfVq8K5R1SBX9Hlsr", "Real Drseun - deep, warm African touch"],
];

mkdirSync(new URL("../out/voicetest/", import.meta.url), { recursive: true });

for (const [slug, id, label] of CANDIDATES) {
  try {
    const res = await retry(async () => {
      const r = await fetch(`${API}/text-to-speech/${id}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: LINE,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      return r;
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const path = new URL(`../out/voicetest/${slug}.mp3`, import.meta.url);
    writeFileSync(path, buf);
    console.log(`OK   ${slug.padEnd(20)} ${(buf.length / 1024).toFixed(0)}kb  ${label}`);
  } catch (e) {
    console.log(`FAIL ${slug.padEnd(20)} ${String(e.message).slice(0, 100)}`);
  }
}
