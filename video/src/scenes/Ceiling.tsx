import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Browser, syncTo } from "../ui/Footage";
import { clamp, soft } from "../ui/motion";

/**
 * Identity and the ceiling, shown twice: Brokro's own desk, then Kite's
 * dashboard holding the same figure. The second shot is the owner's screen
 * recording, because the Passport dashboard is behind a passkey and cannot be
 * driven headlessly.
 */
export const Ceiling: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.paper;
  const from = scene("ceiling").from;
  const dir = wordAt("ceiling", "directory.") - from;
  const ten = wordAt("ceiling", "Ten") - from;
  const inside = wordAt("ceiling", "inside") - from;

  // Hand over to the owner's dashboard on "that limit lives inside Kite".
  const cut = inside - 10;
  const toKite = interpolate(f, [cut, cut + 14], [0, 1], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <div style={{ opacity: 1 - toKite }}>
        <Browser
          name="passport"
          url="trybrokro.vercel.app/desk"
          width={width * 0.78}
          left={width * 0.11}
          top={height * 0.17}
          light
          startFrom={syncTo("passport", "passport_panel", 8)}
          cams={[
            { f: 0, z: 2.1, rect: "panel" },
            { f: Math.max(20, dir), z: 2.35, rect: "panel" },
            { f: Math.max(40, ten), z: 2.2, rect: "allowance" },
          ]}
        />
      </div>

      {/* Kite's own dashboard, muted, unedited. */}
      <AbsoluteFill style={{ opacity: toKite, alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: width * 0.78, borderRadius: 18, overflow: "hidden", boxShadow: "0 0 0 1px rgba(17,19,23,0.12), 0 44px 96px rgba(17,19,23,0.16)" }}>
          <OffthreadVideo src={staticFile("footage/owner/kite_allowance.mp4")} muted style={{ width: "100%", display: "block" }} />
        </div>
        <div style={{ marginTop: 26, fontFamily: mono, fontSize: 22, letterSpacing: "0.16em", textTransform: "uppercase", color: C.copper }}>
          the owner&rsquo;s kite passport
        </div>
      </AbsoluteFill>

      <div style={{ position: "absolute", left: width * 0.13, top: height * 0.045, fontFamily: sans, fontWeight: 400, fontSize: 34, color: tone.ink, letterSpacing: "-0.015em", opacity: interpolate(f, [4, 20], [0, 1], clamp) }}>
        A name anyone can look up. And a ceiling.
      </div>
    </AbsoluteFill>
  );
};
