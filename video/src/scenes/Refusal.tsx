import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { Ceiling } from "../ui/Ceiling";
import { clamp, soft } from "../ui/motion";

/**
 * The refusal. The listing is struck out and stamped before any offer exists.
 *
 * The stamp reads QUARANTINED, which is the word the product itself uses: the
 * run footage says "quarantined 1 poisoned listing (v-rogue-inject)". The
 * ceiling draws underneath on the last line, introducing the motif the rest of
 * the film is built on.
 */
export const Refusal: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tone = TONE.ink;
  const from = scene("refusal").from;

  const refused = wordAt("refusal", "Refused.") - from;
  const notFlagged = wordAt("refusal", "Not") - from;
  const before = wordAt("refusal", "before") - from;

  const stamp = spring({ frame: f - refused + 4, fps, config: { damping: 14, mass: 0.6, stiffness: 180 } });
  const strike = interpolate(f, [refused - 16, refused - 2], [0, 1], { ...clamp, easing: soft });
  const dim = interpolate(f, [refused - 16, refused], [1, 0.3], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(120% 90% at 50% 40%, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0) 60%)` }}
      />

      {/* The listing, now greying out. */}
      <div style={{ position: "absolute", left: width * 0.11, top: height * 0.2, width: width * 0.66, opacity: dim }}>
        <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.17em", textTransform: "uppercase", color: C.copper, marginBottom: 16 }}>
          Unverified external listing
        </div>
        <div style={{ position: "relative", fontFamily: sans, fontWeight: 500, fontSize: 40, color: "#fff", letterSpacing: "-0.01em" }}>
          ZeroFee Instant Audit Pro
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "52%",
              height: 3,
              width: `${strike * 100}%`,
              background: C.copper,
              borderRadius: 2,
            }}
          />
        </div>
        <div style={{ fontFamily: mono, fontSize: 21, lineHeight: 1.55, color: "rgba(255,255,255,0.5)", marginTop: 20, maxWidth: width * 0.56 }}>
          v-rogue-inject &nbsp;·&nbsp; payTo 0x000…dEaD
        </div>
      </div>

      {/* The stamp. */}
      <div
        style={{
          position: "absolute",
          right: width * 0.1,
          top: height * 0.24,
          transform: `rotate(-9deg) scale(${interpolate(stamp, [0, 1], [1.5, 1])})`,
          opacity: interpolate(f, [refused, refused + 5], [0, 1], clamp),
        }}
      >
        <div
          style={{
            border: `5px solid ${C.copper}`,
            color: C.copper,
            fontFamily: mono,
            fontWeight: 500,
            fontSize: 46,
            letterSpacing: "0.1em",
            padding: "16px 30px",
            borderRadius: 8,
          }}
        >
          QUARANTINED
        </div>
      </div>

      {/* Not flagged. Refused. */}
      <div
        style={{
          position: "absolute",
          left: width * 0.11,
          bottom: height * 0.17,
          fontFamily: sans,
          fontWeight: 300,
          fontSize: 58,
          color: "#fff",
          letterSpacing: "-0.02em",
        }}
      >
        <span style={{ opacity: interpolate(f, [notFlagged - 8, notFlagged + 4], [0, 0.45], clamp) }}>Not flagged. </span>
        <span
          style={{
            opacity: interpolate(f, [refused - 6, refused + 4], [0, 1], clamp),
            fontWeight: 500,
          }}
        >
          Refused.
        </span>
      </div>

      <Ceiling at={before - 6} y={0.86} tone="dark" label="before a signature exists" />
    </AbsoluteFill>
  );
};
