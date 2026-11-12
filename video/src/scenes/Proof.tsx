import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Browser, syncTo } from "../ui/Footage";
import { ONCHAIN } from "../onchain";
import { clamp, soft } from "../ui/motion";

const TX = ONCHAIN.txs.bridge;

/** The on-chain proof. Every figure here is read from data/onchain.json. */
export const Proof: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.ink;
  const from = scene("proof").from;
  const block = wordAt("proof", "Block") - from;
  const paid = wordAt("proof", "paid") - from;

  const rows: [string, string][] = [
    ["time", `${TX.utc.slice(11, 19)} UTC · 12 Nov 2026`],
    ["block", Number(TX.block).toLocaleString("en-US")],
    ["amount", `${TX.transfers[0].amount} USDC`],
    ["to", "Otto AI"],
    ["network", "Base · eip155:8453"],
  ];

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <Browser
        name="basescan"
        url="basescan.org"
        width={width * 0.56}
        left={width * 0.05}
        top={height * 0.17}
        startFrom={syncTo("basescan", "basescan_tx", 6)}
        cams={[{ f: 0, z: 1.55, rect: "details" }, { f: 110, z: 1.7, rect: "details" }]}
      />

      <div style={{ position: "absolute", right: width * 0.06, top: height * 0.19, width: width * 0.3 }}>
        <div style={{ fontFamily: mono, fontSize: 18, color: tone.muted, wordBreak: "break-all", lineHeight: 1.5, marginBottom: 30, opacity: interpolate(f, [6, 22], [0, 1], clamp) }}>
          {TX.hash}
        </div>
        {rows.map((r, i) => {
          const at = block - 20 + i * 12;
          const p = interpolate(f, [at, at + 12], [0, 1], { ...clamp, easing: soft });
          return (
            <div key={r[0]} style={{ opacity: p, transform: `translateY(${(1 - p) * 12}px)`, display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 0", borderBottom: `1px solid ${tone.line}` }}>
              <span style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: tone.muted }}>{r[0]}</span>
              <span style={{ fontFamily: mono, fontSize: 26, color: "#fff" }}>{r[1]}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 28, fontFamily: sans, fontWeight: 500, fontSize: 34, color: C.copper, opacity: interpolate(f, [paid, paid + 12], [0, 1], clamp) }}>
          Settled.
        </div>
      </div>
    </AbsoluteFill>
  );
};
