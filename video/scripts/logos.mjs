// Re-fetches the partner logos named in data/logos.json. They are used
// unaltered and are not committed: they belong to their projects.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const { sources } = JSON.parse(readFileSync(join(ROOT, "data/logos.json"), "utf8"));
mkdirSync(join(ROOT, "public/logos"), { recursive: true });

for (const [file, note] of Object.entries(sources)) {
  const url = note.split(" ")[0];
  const res = await fetch(url);
  if (!res.ok) { console.log(`${file}: HTTP ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(ROOT, "public/logos", file), buf);
  console.log(`${file}: ${(buf.length / 1024).toFixed(1)}kb`);
}
