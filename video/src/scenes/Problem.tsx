import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Words } from "../ui/Words";
import { clamp } from "../ui/motion";

/** Two failure modes, as plain type on the product's own paper. */
export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.paper;
  const from = scene("problem").from;
  const two = wordAt("problem", "two") - from;
  const much = wordAt("problem", "much.") - from;
  const believe = wordAt("problem", "believe") - from;

  const rule = (at: number) => interpolate(f, [at, at + 18], [0, 1], { ...clamp });

  return (
    <AbsoluteFill style={{ background: tone.bg, padding: `${height * 0.17}px ${width * 0.11}px` }}>
      <div style={{ fontFamily: sans, fontWeight: 300, fontSize: 58, lineHeight: 1.22, color: tone.ink, letterSpacing: "-0.022em", maxWidth: width * 0.74 }}>
        <Words text="An agent that can spend your money fails in" at={2} every={2} />
        <Words text="two ways." at={two - 6} every={3} accent={{ "two": C.copper }} />
      </div>

      <div style={{ marginTop: height * 0.1, display: "flex", flexDirection: "column", gap: 34 }}>
        {[
          { at: much - 26, n: "01", t: "It spends too much." },
          { at: believe - 44, n: "02", t: "Or it tells you something it cannot prove." },
        ].map((r) => (
          <div key={r.n} style={{ opacity: rule(r.at), transform: `translateY(${(1 - rule(r.at)) * 18}px)` }}>
            <div style={{ height: 1, background: tone.line, marginBottom: 22 }} />
            <div style={{ display: "flex", gap: 32, alignItems: "baseline" }}>
              <span style={{ fontFamily: sans, fontSize: 26, color: C.copper, fontWeight: 500 }}>{r.n}</span>
              <span style={{ fontFamily: sans, fontWeight: 400, fontSize: 50, color: tone.ink, letterSpacing: "-0.018em" }}>{r.t}</span>
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
