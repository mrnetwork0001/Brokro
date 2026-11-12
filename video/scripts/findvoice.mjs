// Searches the shared voice library for a narrator. Never prints the key.
import { key, API } from "./env.mjs";

const queries = [
  { label: "nigerian", params: "search=nigerian&gender=male&page_size=30" },
  { label: "african",  params: "search=african&gender=male&page_size=30" },
  { label: "accent=nigerian", params: "accent=nigerian&page_size=30" },
];

for (const q of queries) {
  const res = await fetch(`${API}/shared-voices?${q.params}`, { headers: { "xi-api-key": key } });
  if (!res.ok) { console.log(`${q.label}: HTTP ${res.status}`); continue; }
  const { voices = [] } = await res.json();
  console.log(`\n=== ${q.label} -> ${voices.length} ===`);
  for (const v of voices.slice(0, 12)) {
    const bits = [v.gender, v.accent, v.age, v.category, v.use_case, v.descriptive].filter(Boolean).join(" · ");
    console.log(`  ${(v.name || "?").padEnd(24)} ${v.voice_id}  ${bits}`);
    if (v.description) console.log(`      ${String(v.description).slice(0, 110)}`);
  }
}
