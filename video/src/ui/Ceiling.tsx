import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, mono } from "../theme";

/**
 * The film's one recurring motif: a hard line above a thing that cannot pass it.
 *
 * Brokro's whole claim is a limit the agent does not hold. Every scene that
 * touches that idea draws the same line: the attack stops under it, the
 * allowance sits on it, the agent reaches and does not cross, and in the close
 * two machines sit beneath one line neither of them owns.
 *
 * It is deliberately plain. A ceiling that looked clever would read as
 * decoration; this one reads as a constraint.
 */
export const Ceiling: React.FC<{
  /** Frame, relative to the scene, at which the line draws in. */
  at: number;
  label?: string;
  /** 0..1 down the frame. */
  y?: number;
  tone?: "light" | "dark";
  /** Draws a short upward stroke that stops at the line. */
  reach?: boolean;
  reachAt?: number;
}> = ({ at, label, y = 0.42, tone = "dark", reach = false, reachAt }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const ink = tone === "dark" ? "#ffffff" : C.ink;
  const draw = spring({ frame: frame - at, fps, config: { damping: 200, mass: 0.7 } });
  const lineW = interpolate(draw, [0, 1], [0, width * 0.78]);
  const top = height * y;

  // The reach stops short of the line and stays short. It is not a near miss:
  // it is the same distance every time, because the limit does not negotiate.
  const rStart = reachAt ?? at + 14;
  const r = spring({ frame: frame - rStart, fps, config: { damping: 200, mass: 0.9 } });
  const reachH = interpolate(r, [0, 1], [0, height * 0.17]);
  const gap = height * 0.035;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: width * 0.11,
          top,
          width: lineW,
          height: 3,
          background: ink,
          opacity: 0.92,
          borderRadius: 2,
        }}
      />
      {label ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.11,
            top: top - 46,
            fontFamily: mono,
            fontSize: 24,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: ink,
            opacity: interpolate(draw, [0.4, 1], [0, 0.72], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {label}
        </div>
      ) : null}
      {reach ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.11 + 8,
            top: top + gap,
            width: 3,
            height: reachH,
            background: C.copper,
            borderRadius: 2,
            opacity: 0.95,
          }}
        />
      ) : null}
    </div>
  );
};

/**
 * A key, struck through. Used once, on the line that says Brokro holds none.
 */
export const KeyCrossed: React.FC<{ at: number; size?: number; tone?: "light" | "dark" }> = ({
  at,
  size = 190,
  tone = "dark",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = tone === "dark" ? "#ffffff" : C.ink;
  const appear = spring({ frame: frame - at, fps, config: { damping: 200 } });
  const strike = spring({ frame: frame - at - 12, fps, config: { damping: 200, mass: 0.6 } });

  return (
    <div style={{ position: "relative", width: size, height: size, opacity: appear }}>
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <circle cx="34" cy="38" r="17" stroke={ink} strokeWidth="5" opacity="0.5" />
        <path d="M46 48 L78 80" stroke={ink} strokeWidth="5" strokeLinecap="round" opacity="0.5" />
        <path d="M66 68 L74 60" stroke={ink} strokeWidth="5" strokeLinecap="round" opacity="0.5" />
        <path
          d="M14 86 L86 14"
          stroke={C.copper}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="102"
          strokeDashoffset={interpolate(strike, [0, 1], [102, 0])}
        />
      </svg>
    </div>
  );
};
