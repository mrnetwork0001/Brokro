import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Ceiling as CeilingLine } from "../ui/Ceiling";
import { clamp, soft } from "../ui/motion";

/**
 * Two machines under one line neither of them owns. The motif resolves here:
 * the ceiling is drawn once, above both boxes, and labelled as Kite's.
 */
const BOXES = [
  { title: "trybrokro.vercel.app", sub: "no key · no command line" },
  { title: "the bridge host", sub: "the CLI · still no key" },
];

export const Deployed: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.paper;
  const from = scene("deployed").from;
  const asks = wordAt("deployed", "asks") - from;
  const neither = wordAt("deployed", "Neither") - from;
  const still = wordAt("deployed", "still") - from;

  const arrow = interpolate(f, [asks - 6, asks + 14], [0, 1], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <CeilingLine at={Math.max(2, still - 14)} y={0.24} tone="light" label="the ceiling is still kite's" />

      <div style={{ position: "absolute", top: height * 0.42, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: width * 0.06 }}>
        {BOXES.map((b, i) => {
          const at = i * 16;
          const p = interpolate(f, [at, at + 16], [0, 1], { ...clamp, easing: soft });
          const lit = interpolate(f, [neither - 6, neither + 8], [0, 1], clamp);
          return (
            <React.Fragment key={b.title}>
              {i === 1 ? (
                <div style={{ width: width * 0.1, height: 3, background: C.copper, opacity: arrow, transform: `scaleX(${arrow})`, transformOrigin: "0 50%", borderRadius: 2 }} />
              ) : null}
              <div style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, width: width * 0.26, background: "#fff", border: `1px solid ${lit > 0.5 ? C.copper : tone.line}`, borderRadius: 14, padding: "30px 28px", boxShadow: "0 16px 40px rgba(17,19,23,0.07)" }}>
                <div style={{ fontFamily: mono, fontSize: 24, color: tone.ink, letterSpacing: "-0.005em", wordBreak: "break-all" }}>{b.title}</div>
                <div style={{ fontFamily: sans, fontSize: 25, color: tone.muted, marginTop: 14 }}>{b.sub}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: height * 0.12, textAlign: "center", fontFamily: sans, fontWeight: 500, fontSize: 58, color: tone.ink, letterSpacing: "-0.025em", opacity: interpolate(f, [neither - 4, neither + 8], [0, 1], clamp) }}>
        Neither end holds a key.
      </div>
    </AbsoluteFill>
  );
};
