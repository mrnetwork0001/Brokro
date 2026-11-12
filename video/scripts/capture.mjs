// Records the live Brokro deployment for the demo film.
//   ONLY=passport,run,receipts node scripts/capture.mjs
//
// Output: .cache/frames/<clip>/ (JPEG screencast + frames.json), .cache/marks.json
// (event times inside each clip), .cache/meta.json (element rects in CSS px for
// camera moves) and stills in public/stills/. scripts/encode.mjs turns the
// frames into public/footage/<clip>.mp4.
//
// WRITES. The `run` clip executes one real procurement on the live site. With
// BROKR_EXTERNAL_SETTLEMENT=on that spends about $0.005 of the owner's Kite
// allowance across four merchants. It is the only clip that spends anything,
// and ONLY is mandatory so it can never be repeated by accident.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE || "https://trybrokro.vercel.app";
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FRAMES = join(ROOT, ".cache/frames");
const STILLS = join(ROOT, "public/stills");
const VIEW = { w: 1600, h: 900 };

const ONLY = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
if (!ONLY) {
  console.error(
    "Set ONLY=<clip,...>. Clips: passport, run, receipts, landing, basescan.\n" +
      "`run` spends real money; it must be asked for by name.",
  );
  process.exit(1);
}
const want = (c) => ONLY.includes(c);
for (const d of [FRAMES, STILLS]) mkdirSync(d, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(0)}s`, ...a);
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
const marks = readJson(join(ROOT, ".cache/marks.json"));
const meta = readJson(join(ROOT, ".cache/meta.json"));
const save = () => {
  writeFileSync(join(ROOT, ".cache/marks.json"), JSON.stringify(marks, null, 1));
  writeFileSync(join(ROOT, ".cache/meta.json"), JSON.stringify(meta, null, 1));
};

// Headless Chrome draws no pointer, and an eased scroll reads better than a jump.
const OVERLAY = `(() => {
  if (window.__brokro) return;
  window.__brokro = 1;
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;z-index:2147483647;width:13px;height:13px;border-radius:50%;background:rgba(20,20,20,.82);box-shadow:0 0 0 2px rgba(255,255,255,.85),0 2px 7px rgba(0,0,0,.3);pointer-events:none;transition:transform .01s;left:0;top:0;transform:translate(-50px,-50px)";
  document.documentElement.appendChild(dot);
  window.__dot = (x, y) => { dot.style.transform = \`translate(\${x - 6}px, \${y - 6}px)\`; };
  window.__ease = (to, ms) => new Promise((done) => {
    const from = window.scrollY, start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, from + (to - from) * e);
      p < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });
})()`;

/** Moves the pointer to the centre of a rect over `ms`, easing. */
async function glide(page, rect, ms = 700) {
  if (!rect) return;
  const x = rect.x + rect.width / 2;
  const y = rect.y + Math.min(rect.height / 2, 24);
  await page.js(`(async () => {
    const steps = ${Math.max(6, Math.round(ms / 40))};
    const r = document.documentElement.getBoundingClientRect();
    for (let i = 1; i <= steps; i++) {
      const p = i / steps, e = 1 - Math.pow(1 - p, 3);
      window.__dot(${x} * e + 40 * (1 - e), ${y} * e + 40 * (1 - e));
      await new Promise((d) => setTimeout(d, ${Math.round(ms / Math.max(6, Math.round(ms / 40)))}));
    }
  })()`);
}

async function record(page, clip, fn) {
  const dir = join(FRAMES, clip);
  const stop = await page.screencast(dir);
  // encode.mjs wants a flat map of absolute epoch seconds, keyed per event.
  const started = Date.now() / 1000;
  const at = (k) => { marks[`${clip}_${k}`] = Date.now() / 1000; log(`  mark ${clip}_${k} (+${(Date.now() / 1000 - started).toFixed(1)}s)`); };
  await fn(at);
  const frames = await stop();
  log(`${clip}: ${frames.length} frames`);
  save();
}

const page = await launch({ width: VIEW.w, height: VIEW.h });
log(`launched, base ${BASE}`);

try {
  // ── The Passport panel: identity and the ceiling ────────────────────────
  if (want("passport")) {
    await page.goto(`${BASE}/desk`, 7000);
    await page.js(OVERLAY);
    await page.js(`window.scrollTo(0,0)`);
    await sleep(1200);
    const panel = await page.rectOf(
      `[...document.querySelectorAll("section")].find((s) => s.textContent.includes("Kite Agent Passport"))`,
    );
    if (panel) meta.passport = { panel };
    await record(page, "passport", async (at) => {
      await sleep(900);
      at("panel");
      if (panel) await page.js(`window.__ease(${Math.max(0, panel.y - 90)}, 1100)`);
      await sleep(2600);
      at("allowance");
      await sleep(2200);
    });
    await page.shot(join(STILLS, "passport.png"));
  }

  // ── The run. THIS SPENDS. ───────────────────────────────────────────────
  if (want("run")) {
    await page.goto(`${BASE}/desk`, 7000);
    await page.js(OVERLAY);
    await sleep(1500);
    // Two toggles decide whether this run is worth filming. Without the attack
    // test the catalogue is clean and step one has nothing to refuse; without
    // third-party merchants nothing settles for real and the allowance never
    // moves. The first capture missed both and produced a run that proved
    // neither point.
    const toggled = await page.js(`(() => {
      const hit = (label) => {
        const row = [...document.querySelectorAll("label")].find((l) => l.textContent.includes(label));
        if (!row) return "missing";
        const box = row.querySelector('input[type="checkbox"]');
        if (!box) return "no-input";
        if (!box.checked) { box.click(); return "on"; }
        return "already-on";
      };
      return {
        adversarial: hit("Include Rogue Merchants"),
        merchants: hit("Third-Party Merchants"),
      };
    })()`);
    log(`  toggles: ${JSON.stringify(toggled)}`);
    if (toggled.adversarial === "missing" || toggled.merchants === "missing") {
      throw new Error(`toggle not found: ${JSON.stringify(toggled)}`);
    }
    await sleep(600);

    const btn = await page.rectOf(
      `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Execute Bounded Procurement"))`,
    );
    await page.js(`window.__ease(${Math.max(0, (btn?.y ?? 600) - 420)}, 900)`);
    await sleep(900);
    const btn2 = await page.rectOf(
      `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Execute Bounded Procurement"))`,
    );
    await record(page, "run", async (at) => {
      await sleep(700);
      await glide(page, btn2, 800);
      at("hover");
      await sleep(350);
      const ok = await page.js(
        `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Execute Bounded Procurement") && !b.disabled); if (!b) return false; b.click(); return true; })()`,
      );
      if (!ok) throw new Error("run button not found or disabled");
      at("click");
      log("  RUN STARTED (spending)");
      // Let the six steps stream. The graph takes roughly 40-70s live.
      let marked = {};
      for (let i = 0; i < 150; i++) {
        await sleep(1000);
        const st = await page.js(`(() => {
          const t = document.body.innerText;
          return {
            quarantined: t.indexOf("QUARANTINE") >= 0 || t.indexOf("quarantined") >= 0,
            settled: t.indexOf("SETTLED ON-CHAIN") >= 0 || t.indexOf("SIGNED, NOT BROADCAST") >= 0,
            steps: (t.split("completed").length - 1),
            done: t.indexOf("6/6 steps") >= 0,
          };
        })()`);
        if (st.quarantined && !marked.quarantine) { at("quarantine"); marked.quarantine = 1; }
        if (st.settled && !marked.settled) { at("settled"); marked.settled = 1; }
        if ((st.done || st.steps >= 6) && i > 15) { at("complete"); break; }
      }
      await sleep(3000);
    });
    await page.shot(join(STILLS, "run.png"));
  }

  // ── Receipts, after the run has produced them ───────────────────────────
  if (want("receipts")) {
    const tbl = await page.rectOf(
      `[...document.querySelectorAll("table")].find((t) => t.textContent.includes("SETTLED") || t.textContent.includes("NOT BROADCAST"))`,
    );
    if (tbl) meta.receipts = { table: tbl };
    await record(page, "receipts", async (at) => {
      if (tbl) await page.js(`window.__ease(${Math.max(0, tbl.y - 120)}, 1200)`);
      await sleep(2200);
      at("table");
      await sleep(3000);
    });
    await page.shot(join(STILLS, "receipts.png"));
  }

  // ── The landing page stack section ──────────────────────────────────────
  if (want("landing")) {
    await page.goto(`${BASE}/`, 6000);
    await page.js(OVERLAY);
    const stack = await page.rect("#stack");
    await record(page, "landing", async (at) => {
      await sleep(800);
      if (stack) await page.js(`window.__ease(${Math.max(0, stack.y - 80)}, 1400)`);
      await sleep(2600);
      at("stack");
      await sleep(2200);
    });
    await page.shot(join(STILLS, "landing.png"));
  }

  // ── The explorer page for the bridge transaction ────────────────────────
  if (want("basescan")) {
    const chain = readJson(join(ROOT, "data/onchain.json"));
    // Basescan hard-blocks headless Chrome at the bot check. Blockscout is an
    // equally real Base explorer reading the same chain, and it serves. The
    // README and youtube description still link Basescan for humans.
    const url = chain.txs?.bridge?.blockscout || chain.txs?.bridge?.explorer;
    if (!url) throw new Error("data/onchain.json has no bridge tx; run scripts/onchain.mjs");
    // Basescan sits behind a bot check that headless Chrome trips. Give it time
    // to clear, then verify we are actually looking at the transaction rather
    // than an interstitial: filming a "Performing security verification" page
    // as on-chain proof would be worse than having no shot at all.
    await page.goto(url, 12000);
    let cleared = false;
    for (let i = 0; i < 20; i++) {
      const t = await page.js(`document.body.innerText.slice(0, 2000)`);
      if (t && t.indexOf("security verification") < 0 && t.indexOf("Just a moment") < 0 && (t.indexOf("Transaction details") >= 0 || t.indexOf("Transaction Hash") >= 0 || t.indexOf("Success") >= 0)) { cleared = true; break; }
      await sleep(2000);
    }
    if (!cleared) {
      console.error("basescan: still behind the bot check; not filming an interstitial");
      throw new Error("basescan blocked");
    }
    log("  basescan cleared the bot check");
    await page.js(OVERLAY);
    await record(page, "basescan", async (at) => {
      await sleep(1600);
      at("tx");
      await page.js(`window.__ease(240, 1200)`);
      await sleep(2800);
      at("detail");
      await sleep(1800);
    });
    await page.shot(join(STILLS, "basescan.png"));
  }
} finally {
  save();
  page.close();
  log("done");
}
