import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { clamp, soft } from "../ui/motion";

/**
 * The deletion beat. Two claims resolve to a field; the third cites a real
 * field and misquotes it, and is removed rather than flagged.
 */
const CLAIMS = [
  { text: "USDC.e reports 6 decimals on Kite mainnet.", field: "token.decimals", quote: "6", ok: true },
  { text: "Otto AI returned a verified source contract.", field: "security.isOpenSource", quote: "true", ok: true },
  { text: "Liquidity is locked at 94%.", field: "security.liquidity", quote: "[]", ok: false },
];

export const Verify: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.paper;
  const from = scene("verify").from;
  const traced = wordAt("verify", "traced") - from;
  const deleted = wordAt("verify", "deleted.") - from;

  return (
    <AbsoluteFill style={{ background: tone.bg, padding: `${height * 0.12}px ${width * 0.1}px` }}>
      <div style={{ fontFamily: mono, fontSize: 21, letterSpacing: "0.16em", textTransform: "uppercase", color: C.copper, marginBottom: 30 }}>
        05 · verify_dossier
      </div>

      {CLAIMS.map((c, i) => {
        const at = traced + i * 18;
        const p = interpolate(f, [at, at + 12], [0, 1], { ...clamp, easing: soft });
        // The third claim is struck through, then removed entirely.
        const kill = c.ok ? 0 : interpolate(f, [deleted - 10, deleted + 2], [0, 1], { ...clamp, easing: soft });
        const gone = c.ok ? 0 : interpolate(f, [deleted + 4, deleted + 20], [0, 1], { ...clamp, easing: soft });
        return (
          <div key={i} style={{ opacity: p * (1 - gone), transform: `translateY(${(1 - p) * 16 - gone * 10}px)`, marginBottom: 26, display: "flex", gap: 26, alignItems: "flex-start" }}>
            <div style={{ width: 16, height: 16, borderRadius: 9, marginTop: 14, background: c.ok ? C.ok : C.bad, opacity: c.ok ? 1 : 1 - kill * 0.3 }} />
            <div style={{ flex: 1 }}>
              <div style={{ position: "relative", fontFamily: sans, fontWeight: 400, fontSize: 42, color: tone.ink, letterSpacing: "-0.015em" }}>
                {c.text}
                <div style={{ position: "absolute", left: 0, top: "54%", height: 3, width: `${kill * 100}%`, background: C.bad, borderRadius: 2 }} />
              </div>
              <div style={{ fontFamily: mono, fontSize: 22, color: tone.muted, marginTop: 10 }}>
                {c.field} <span style={{ color: c.ok ? C.ok : C.bad }}>= {c.quote}</span>
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: height * 0.04, fontFamily: sans, fontWeight: 500, fontSize: 52, color: tone.ink, letterSpacing: "-0.022em", opacity: interpolate(f, [deleted - 4, deleted + 8], [0, 1], clamp) }}>
        Deleted, not flagged.
      </div>
    </AbsoluteFill>
  );
};
