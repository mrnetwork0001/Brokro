import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans, serifItalic, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { clamp, soft } from "../ui/motion";

/** The turn: the mark, the name, the line. Copper, full bleed, spent once. */
export const Turn: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const tone = TONE.copper;
  const from = scene("turn").from;
  const name = wordAt("turn", "Brokro.") - from;

  const hit = spring({ frame: f - name + 2, fps, config: { damping: 15, mass: 0.5, stiffness: 150 } });
  const seal = interpolate(hit, [0, 1], [0.75, 1]);
  const tag = interpolate(f, [name + 14, name + 34], [0, 1], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30, transform: `scale(${seal})`, opacity: interpolate(f, [name - 6, name + 4], [0, 1], clamp) }}>
        <div style={{ width: 104, height: 104, borderRadius: 22, background: "#fff", color: tone.bg, fontFamily: sans, fontWeight: 600, fontSize: 62, display: "flex", alignItems: "center", justifyContent: "center" }}>B</div>
        <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 108, color: "#fff", letterSpacing: "-0.035em" }}>Brokro</div>
      </div>

      <div style={{ marginTop: 44, fontFamily: sans, fontWeight: 300, fontSize: 52, color: "#fff", opacity: tag, transform: `translateY(${(1 - tag) * 16}px)`, letterSpacing: "-0.018em", textAlign: "center" }}>
        Your agent gets a <span style={{ fontFamily: serifItalic, fontStyle: "italic", fontSize: "1.1em" }}>signed mandate</span>, not your wallet.
      </div>

      <div style={{ position: "absolute", bottom: height * 0.09, fontFamily: mono, fontSize: 20, letterSpacing: "0.2em", textTransform: "uppercase", color: tone.muted, opacity: tag }}>
        agent commerce, under a limit
      </div>
    </AbsoluteFill>
  );
};
