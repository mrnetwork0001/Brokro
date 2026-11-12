import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { T, scene, wordAt } from "./timing";
import { C } from "./theme";
import { Captions } from "./ui/Captions";
import { Grain } from "./ui/Grain";
import { clamp } from "./ui/motion";
import { Open } from "./scenes/Open";
import { Refusal } from "./scenes/Refusal";
import { Problem } from "./scenes/Problem";
import { Turn } from "./scenes/Turn";
import { Ceiling as CeilingScene } from "./scenes/Ceiling";
import { Keyless } from "./scenes/Keyless";
import { Shop } from "./scenes/Shop";
import { Verify } from "./scenes/Verify";
import { Proof } from "./scenes/Proof";
import { Gas } from "./scenes/Gas";
import { Deployed } from "./scenes/Deployed";
import { Close } from "./scenes/Close";

const SCENES: Record<string, React.FC> = {
  open: Open, refusal: Refusal, problem: Problem, turn: Turn,
  ceiling: CeilingScene, keyless: Keyless, shop: Shop, verify: Verify,
  proof: Proof, gas: Gas, deployed: Deployed, close: Close,
};

const OVERLAP = 12; // frames each scene starts early, to dissolve over the last

/** Each scene eases in over the tail of the previous one, holding its first frame. */
const SceneIn: React.FC<{ S: React.FC; first: boolean }> = ({ S, first }) => {
  const f = useCurrentFrame();
  if (first) return <S />;
  const p = interpolate(f, [0, OVERLAP], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const body = f < OVERLAP ? <Freeze frame={0}><S /></Freeze> : <Sequence from={OVERLAP} layout="none"><S /></Sequence>;
  return (
    <AbsoluteFill style={{ opacity: p, transform: `scale(${1.03 - 0.03 * p})`, filter: p < 1 ? `blur(${(1 - p) * 10}px)` : undefined }}>
      {body}
    </AbsoluteFill>
  );
};

// Music ducks under every spoken line.
const LINES = T.scenes.flatMap((s) => s.lines.map((l) => [l.startFrame, l.words[l.words.length - 1].end] as const));
const DUCK: number[] = (() => {
  const v = new Array<number>(T.totalFrames + 1).fill(0);
  for (let f = 0; f <= T.totalFrames; f++) {
    let d = 0;
    for (const [a, b] of LINES) d = Math.max(d, interpolate(f, [a - 10, a, b, b + 14], [0, 1, 1, 0], clamp));
    v[f] = d;
  }
  return v;
})();
const musicVolume = (f: number) => {
  const end = T.totalFrames;
  const fadeIn = interpolate(f, [0, 24], [0, 1], clamp);
  const fadeOut = interpolate(f, [end - 50, end], [1, 0], clamp);
  // The cold open runs almost dry: the merchant should feel like it is talking
  // in a quiet room, not over a score.
  const openCeiling = interpolate(f, [0, scene("refusal").from], [0.22, 1], clamp);
  return (0.58 - 0.38 * DUCK[Math.min(end, Math.max(0, f))]) * fadeIn * fadeOut * openCeiling;
};

interface Fx { file: string; at: number; vol: number; dur?: number }
function effects(): Fx[] {
  const sc = (id: string) => scene(id).from;
  const w = (id: string, word: string, n = 0) => wordAt(id, word, n);
  const fx: Fx[] = [
    // Cold open: a terminal typing a line it should not be typing.
    { file: "type", at: 6, vol: 0.34, dur: 90 },
    { file: "tick", at: 2, vol: 0.26 },
    { file: "tick", at: 44, vol: 0.22 },
    { file: "tick", at: 86, vol: 0.2 },

    // The refusal lands as a stamp, then a door declining to open.
    { file: "stamp", at: w("refusal", "Refused.") - 4, vol: 0.62 },
    { file: "denied", at: w("refusal", "Refused.") + 4, vol: 0.4 },
    { file: "whoosh", at: sc("problem") - 8, vol: 0.28 },

    // The turn.
    { file: "riser", at: sc("turn") - 70, vol: 0.38 },
    { file: "impact", at: w("turn", "Brokro.") - 4, vol: 0.6 },

    // The ceiling draws, then locks.
    { file: "whoosh", at: sc("ceiling") - 8, vol: 0.26 },
    { file: "scan", at: w("ceiling", "directory.") - 10, vol: 0.3 },
    { file: "lock", at: w("ceiling", "passkey.") + 2, vol: 0.5 },

    // The key is crossed out.
    { file: "whoosh", at: sc("keyless") - 8, vol: 0.26 },
    { file: "chain", at: w("keyless", "raise") - 2, vol: 0.45 },
    { file: "impact", at: w("keyless", "decides.") - 4, vol: 0.34 },

    // Buying: a receipt per merchant.
    { file: "whoosh", at: sc("shop") - 8, vol: 0.26 },
    ...["Otto", "PrintMoneyLab,", "IP402."].map((x, i) => ({ file: "receipt", at: w("shop", x) - 4 + i, vol: 0.34 })),

    // Verification: scanning, then a claim vanishing.
    { file: "whoosh", at: sc("verify") - 8, vol: 0.26 },
    { file: "scan", at: w("verify", "traced") - 6, vol: 0.32 },
    { file: "erase", at: w("verify", "deleted.") - 2, vol: 0.55 },

    // The proof.
    { file: "whoosh", at: sc("proof") - 8, vol: 0.26 },
    { file: "coin", at: w("proof", "Otto") + 6, vol: 0.4 },
    { file: "confirm", at: w("proof", "Base.") + 2, vol: 0.4 },

    // Gas: the quiet reveal.
    { file: "reveal", at: w("gas", "relayer.") - 6, vol: 0.34 },

    // Deployed: two boxes under one line.
    { file: "whoosh", at: sc("deployed") - 8, vol: 0.26 },
    { file: "lock", at: w("deployed", "key.") - 2, vol: 0.42 },

    // Close.
    { file: "riser", at: sc("close") - 44, vol: 0.3 },
    { file: "impact", at: w("close", "Brokro.") - 4, vol: 0.5 },
  ];
  return fx.filter((x) => x.at >= 0 && x.at < T.totalFrames);
}

export const Film: React.FC = () => {
  // Captions sit out where big type already carries the words.
  const hideCaptions = (f: number) => {
    const s = T.scenes.find((x) => f >= x.from && f < x.from + x.durationInFrames);
    return !s || ["open", "problem", "turn", "keyless", "close"].includes(s.id);
  };
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      {T.scenes.map((s, i) => {
        const S = SCENES[s.id];
        const from = i === 0 ? s.from : s.from - OVERLAP;
        const dur = s.durationInFrames + (i === 0 ? 0 : OVERLAP);
        return S ? (
          <Sequence key={s.id} from={from} durationInFrames={dur} name={s.id}>
            <SceneIn S={S} first={i === 0} />
          </Sequence>
        ) : null;
      })}
      <Grain opacity={0.05} />
      <Captions hidden={hideCaptions} />
      <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />
      {T.scenes.flatMap((s) => s.lines).map((l, i) => (
        <Sequence key={`vo${i}`} from={l.startFrame} durationInFrames={l.durationFrames} name={`vo ${l.text.slice(0, 18)}`}>
          <Audio src={staticFile(l.file)} volume={1} />
        </Sequence>
      ))}
      {effects().map((x, i) => (
        <Sequence key={`fx${i}`} from={x.at} durationInFrames={x.dur ?? 150} name={`fx ${x.file}`}>
          <Audio
            src={staticFile(`audio/sfx/${x.file}.mp3`)}
            volume={(f) => x.vol * (x.dur ? interpolate(f, [0, 8, x.dur - 20, x.dur], [0, 1, 1, 0], clamp) : 1)}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
