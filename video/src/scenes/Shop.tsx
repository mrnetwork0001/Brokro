import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Browser, syncTo } from "../ui/Footage";
import { clamp, soft } from "../ui/motion";

const MERCHANTS = [
  { name: "Otto AI", what: "token security", price: "$0.001" },
  { name: "PrintMoneyLab", what: "kimchi premium", price: "$0.002" },
  { name: "IP402", what: "geolocation & ASN", price: "$0.001" },
];

/** Buying, from businesses we do not control. */
export const Shop: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.paper;
  const from = scene("shop").from;
  const otto = wordAt("shop", "Otto") - from;

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <Browser
        name="run"
        url="trybrokro.vercel.app/desk"
        width={width * 0.62}
        left={width * 0.04}
        top={height * 0.16}
        light
        startFrom={syncTo("run", "run_settled", 6)}
        cams={[{ f: 0, z: 1.2, rect: "kpis", dy: 320 }, { f: 110, z: 1.35, rect: "kpis", dy: 420 }]}
      />

      <div style={{ position: "absolute", right: width * 0.05, top: height * 0.2, width: width * 0.26 }}>
        {MERCHANTS.map((m, i) => {
          const at = otto + i * 22;
          const p = interpolate(f, [at, at + 14], [0, 1], { ...clamp, easing: soft });
          return (
            <div key={m.name} style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, background: "#fff", border: `1px solid ${tone.line}`, borderRadius: 12, padding: "22px 24px", marginBottom: 18, boxShadow: "0 12px 30px rgba(17,19,23,0.06)" }}>
              <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 30, color: tone.ink, letterSpacing: "-0.01em" }}>{m.name}</div>
              <div style={{ fontFamily: mono, fontSize: 19, color: tone.muted, marginTop: 8 }}>{m.what}</div>
              <div style={{ fontFamily: mono, fontSize: 26, color: C.ok, marginTop: 14 }}>{m.price}</div>
            </div>
          );
        })}
        <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: "0.14em", textTransform: "uppercase", color: C.copper, marginTop: 8, opacity: interpolate(f, [otto + 70, otto + 86], [0, 1], clamp) }}>
          independent · usdc on base
        </div>
      </div>
    </AbsoluteFill>
  );
};
