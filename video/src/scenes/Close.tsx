import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans, serifItalic, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { clamp, soft } from "../ui/motion";

const PARTNERS = ["OpenServ SERV", "Kite Agent Passport", "x402", "Reppo"];

/** The close: who does what, then the mark, the line and the URL. */
export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tone = TONE.copper;
  const from = scene("close").from;
  const name = wordAt("close", "Brokro.") - from;
  const money = wordAt("close", "money") - from;

  const logo = spring({ frame: f - name + 2, fps, config: { damping: 15, mass: 0.5, stiffness: 150 } });
  const partnersOut = interpolate(f, [name - 14, name - 2], [1, 0], { ...clamp, easing: soft });
  const tag = interpolate(f, [money - 8, money + 10], [0, 1], { ...clamp, easing: soft });
  const url = interpolate(f, [money + 24, money + 40], [0, 1], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg, alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", top: height * 0.3, display: "flex", gap: 54, opacity: partnersOut }}>
        {PARTNERS.map((p, i) => {
          const at = 4 + i * 11;
          const o = interpolate(f, [at, at + 12], [0, 1], { ...clamp, easing: soft });
          return (
            <div key={p} style={{ opacity: o, transform: `translateY(${(1 - o) * 12}px)`, fontFamily: mono, fontSize: 25, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.9)" }}>
              {p}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 28, transform: `scale(${interpolate(logo, [0, 1], [0.78, 1])})`, opacity: interpolate(f, [name - 6, name + 4], [0, 1], clamp) }}>
        <div style={{ width: 96, height: 96, borderRadius: 20, background: "#fff", color: tone.bg, fontFamily: sans, fontWeight: 600, fontSize: 58, display: "flex", alignItems: "center", justifyContent: "center" }}>B</div>
        <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 100, color: "#fff", letterSpacing: "-0.035em" }}>Brokro</div>
      </div>

      <div style={{ marginTop: 40, maxWidth: width * 0.66, textAlign: "center", fontFamily: sans, fontWeight: 300, fontSize: 48, lineHeight: 1.24, color: "#fff", opacity: tag, transform: `translateY(${(1 - tag) * 14}px)`, letterSpacing: "-0.018em" }}>
        The money doesn&rsquo;t move unless the answer{" "}
        <span style={{ fontFamily: serifItalic, fontStyle: "italic", fontSize: "1.1em" }}>checks out</span>.
      </div>

      <div style={{ position: "absolute", bottom: height * 0.11, textAlign: "center", opacity: url }}>
        <div style={{ fontFamily: mono, fontSize: 30, color: "#fff", letterSpacing: "0.04em" }}>trybrokro.vercel.app</div>
        <div style={{ fontFamily: mono, fontSize: 20, color: tone.muted, marginTop: 12, letterSpacing: "0.08em" }}>
          did:kite:auto-lvcj3a:brokro
        </div>
      </div>
    </AbsoluteFill>
  );
};
