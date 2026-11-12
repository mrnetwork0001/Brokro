import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Ceiling as CeilingLine, KeyCrossed } from "../ui/Ceiling";
import { Words } from "../ui/Words";
import { clamp } from "../ui/motion";

/** The thesis. The agent reaches, the line does not move, and it holds no key. */
export const Keyless: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.ink;
  const from = scene("keyless").from;
  const raise = wordAt("keyless", "raise") - from;
  const noKey = wordAt("keyless", "key") - from;
  const asks = wordAt("keyless", "asks.") - from;
  const decides = wordAt("keyless", "decides.") - from;

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <CeilingLine at={2} y={0.3} tone="dark" label="$10 weekly · enforced by kite" reach reachAt={raise - 8} />

      <div style={{ position: "absolute", left: width * 0.11, top: height * 0.42, width: width * 0.5, fontFamily: sans, fontWeight: 300, fontSize: 54, lineHeight: 1.22, color: "#fff", letterSpacing: "-0.02em" }}>
        <Words text="The agent cannot raise it." at={raise - 14} every={3} accent={{ cannot: C.copper }} />
      </div>

      <div style={{ position: "absolute", right: width * 0.13, top: height * 0.44 }}>
        <KeyCrossed at={noKey - 10} size={210} tone="dark" />
      </div>

      <div style={{ position: "absolute", left: width * 0.11, bottom: height * 0.14, fontFamily: sans, fontWeight: 500, fontSize: 72, color: "#fff", letterSpacing: "-0.03em" }}>
        <span style={{ opacity: interpolate(f, [asks - 6, asks + 3], [0, 1], clamp) }}>It asks. </span>
        <span style={{ opacity: interpolate(f, [decides - 6, decides + 3], [0, 1], clamp), color: C.copper }}>Kite decides.</span>
      </div>
    </AbsoluteFill>
  );
};
