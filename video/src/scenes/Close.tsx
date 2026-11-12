import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans, serifItalic, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import { clamp, soft } from "../ui/motion";

/**
 * The close: who did what, then the mark, the line and the URL.
 *
 * The four partners are shown with their own logos, unaltered, each on a light
 * card because two of the marks are dark and would vanish into the copper.
 * SERV and Kite land on the words that name them; x402 and Reppo follow, since
 * the narration does not name them but the film still owes them a credit.
 */
const PARTNERS: { file: string; name: string; role: string; pad: number; h: number }[] = [
  { file: "logos/openserv.png", name: "OpenServ SERV", role: "screens every seller,\nwrites the dossier", pad: 16, h: 74 },
  { file: "logos/kite.svg", name: "Kite Agent Passport", role: "the identity and\nthe spending limit", pad: 14, h: 44 },
  { file: "logos/x402.svg", name: "x402", role: "the payment rail", pad: 16, h: 50 },
  { file: "logos/reppo.png", name: "Reppo", role: "independent scoring,\nafter the fact", pad: 16, h: 62 },
];

const Card: React.FC<{ p: (typeof PARTNERS)[number]; at: number; out: number; w: number }> = ({ p, at, out, w }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // A spring pop with a touch of overshoot, so a card arrives rather than fades.
  const pop = spring({ frame: f - at, fps, config: { damping: 13, mass: 0.55, stiffness: 190 } });
  const gone = interpolate(f, [out, out + 12], [0, 1], { ...clamp, easing: soft });
  return (
    <div
      style={{
        width: w,
        opacity: (1 - gone) * interpolate(pop, [0, 0.35], [0, 1], clamp),
        transform: `translateY(${(1 - pop) * 34 - gone * 18}px) scale(${interpolate(pop, [0, 1], [0.86, 1])})`,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          height: 118,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${p.pad}px`,
          boxShadow: "0 18px 44px rgba(40,12,0,0.22)",
        }}
      >
        <Img src={staticFile(p.file)} style={{ maxWidth: "100%", maxHeight: p.h, objectFit: "contain" }} />
      </div>
      <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 25, color: "#fff", marginTop: 18, letterSpacing: "-0.01em" }}>
        {p.name}
      </div>
      <div style={{ fontFamily: mono, fontSize: 19, lineHeight: 1.5, color: "rgba(255,255,255,0.78)", marginTop: 7, whiteSpace: "pre-line" }}>
        {p.role}
      </div>
    </div>
  );
};

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tone = TONE.copper;
  const from = scene("close").from;

  const serv = wordAt("close", "SERV") - from;
  const kite = wordAt("close", "Kite") - from;
  const name = wordAt("close", "Brokro.") - from;
  const money = wordAt("close", "money") - from;

  // SERV and Kite land on their words; the other two follow close behind.
  const cardAt = [serv, kite, kite + 26, kite + 50];
  const cardsOut = name - 16;

  const logo = spring({ frame: f - name + 2, fps, config: { damping: 15, mass: 0.5, stiffness: 150 } });
  const tag = interpolate(f, [money - 8, money + 10], [0, 1], { ...clamp, easing: soft });
  const url = interpolate(f, [money + 26, money + 42], [0, 1], { ...clamp, easing: soft });

  const cardW = width * 0.19;

  return (
    <AbsoluteFill style={{ background: tone.bg, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          top: height * 0.22,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          gap: width * 0.025,
        }}
      >
        {PARTNERS.map((p, i) => (
          <Card key={p.name} p={p} at={cardAt[i]} out={cardsOut} w={cardW} />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
          transform: `scale(${interpolate(logo, [0, 1], [0.78, 1])})`,
          opacity: interpolate(f, [name - 6, name + 4], [0, 1], clamp),
        }}
      >
        <div style={{ width: 96, height: 96, borderRadius: 20, background: "#fff", color: tone.bg, fontFamily: sans, fontWeight: 600, fontSize: 58, display: "flex", alignItems: "center", justifyContent: "center" }}>
          B
        </div>
        <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 100, color: "#fff", letterSpacing: "-0.035em" }}>Brokro</div>
      </div>

      <div style={{ marginTop: 40, maxWidth: width * 0.66, textAlign: "center", fontFamily: sans, fontWeight: 300, fontSize: 48, lineHeight: 1.24, color: "#fff", opacity: tag, transform: `translateY(${(1 - tag) * 14}px)`, letterSpacing: "-0.018em" }}>
        The money doesn&rsquo;t move unless the answer{" "}
        <span style={{ fontFamily: serifItalic, fontStyle: "italic", fontSize: "1.1em" }}>checks out</span>.
      </div>

      <div style={{ position: "absolute", bottom: height * 0.1, textAlign: "center", opacity: url }}>
        <div style={{ fontFamily: mono, fontSize: 30, color: "#fff", letterSpacing: "0.04em" }}>trybrokro.vercel.app</div>
        <div style={{ fontFamily: mono, fontSize: 20, color: tone.muted, marginTop: 12, letterSpacing: "0.08em" }}>
          did:kite:auto-lvcj3a:brokro
        </div>
      </div>
    </AbsoluteFill>
  );
};
