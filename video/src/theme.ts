import { loadFont as loadSans } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";

/**
 * The app's own three families, from src/app/layout.tsx: Geist for text,
 * Geist Mono for anything machine-written (hashes, DIDs, step ids), and
 * Newsreader for display. The film uses them for the same jobs, so a frame of
 * the film and a frame of the product belong to one piece of design.
 */
export const sans = loadSans("normal", { weights: ["300", "400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const serif = loadSerif("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const serifItalic = loadSerif("italic", { weights: ["400"], subsets: ["latin"] }).fontFamily;

/** Brokro's palette, verbatim from src/app/globals.css. */
export const C = {
  paper: "#f5f4ef",
  sunken: "#eceae2",
  sheet: "#ffffff",
  ink: "#111317",
  inkMuted: "#49505b",
  inkFaint: "#6e7582",
  rule: "#dcd9ce",
  ruleStrong: "#c2beb0",
  brand: "#143642",
  copper: "#a84b20",
  ok: "#146c43",
  warn: "#9a5b13",
  bad: "#b92b27",
};

export type Tone = "paper" | "ink" | "copper";

export const TONE: Record<Tone, { bg: string; ink: string; muted: string; line: string; pill: string }> = {
  // The working surface: the product's own background.
  paper: { bg: C.paper, ink: C.ink, muted: "rgba(17,19,23,0.52)", line: "rgba(17,19,23,0.12)", pill: "rgba(255,255,255,0.86)" },
  // The dark stage, used where the film is talking rather than showing.
  ink: { bg: C.brand, ink: "#ffffff", muted: "rgba(255,255,255,0.62)", line: "rgba(255,255,255,0.16)", pill: "rgba(10,28,34,0.55)" },
  // Full-bleed accent, for the turn and the close only.
  copper: { bg: C.copper, ink: "#ffffff", muted: "rgba(255,255,255,0.74)", line: "rgba(255,255,255,0.24)", pill: "rgba(80,30,10,0.42)" },
};

/**
 * Tone per scene.
 *
 * The attack is told on the dark stage, the product is shown on its own paper,
 * and copper is spent only twice: the turn and the close. Reserving it makes
 * those two beats land instead of becoming wallpaper.
 */
export const SCENE_TONE: Record<string, Tone> = {
  open: "ink",
  refusal: "ink",
  problem: "paper",
  turn: "copper",
  ceiling: "paper",
  keyless: "ink",
  shop: "paper",
  verify: "paper",
  proof: "ink",
  gas: "ink",
  deployed: "paper",
  close: "copper",
};

/** The one figure the film is built around, read from data/onchain.json at build. */
export const EXPLORER = "https://basescan.org/tx/";
