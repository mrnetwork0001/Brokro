import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Browser, syncTo } from "../ui/Footage";
import { C, mono, sans, TONE } from "../theme";
import { scene, wordAt } from "../timing";
import onchain from "../../data/onchain.json";
import { Words } from "../ui/Words";
import { clamp, soft } from "../ui/motion";

const DATA = onchain as any;

/** Who paid the gas, and the balance that never needed any. */
export const Gas: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tone = TONE.ink;
  const from = scene("gas").from;
  const relayer = wordAt("gas", "relayer.") - from;
  const holds = wordAt("gas", "holds") - from;
  const stable = wordAt("gas", "stablecoin") - from;

  const reveal = interpolate(f, [relayer - 12, relayer + 4], [0, 1], { ...clamp, easing: soft });
  const bal = interpolate(f, [holds - 6, holds + 10], [0, 1], { ...clamp, easing: soft });

  return (
    <AbsoluteFill style={{ background: tone.bg, padding: `${height * 0.16}px ${width * 0.11}px` }}>
      <div style={{ fontFamily: sans, fontWeight: 300, fontSize: 54, color: "#fff", letterSpacing: "-0.02em", maxWidth: width * 0.62 }}>
        <Words text="Look at who paid the gas." at={2} every={3} />
      </div>

      {/* The explorer's own From row, rather than a graphic asserting it. */}
      <div style={{ opacity: reveal }}>
        <Browser
          name="basescan"
          url="base.blockscout.com"
          width={width * 0.46}
          left={width * 0.5}
          top={height * 0.26}
          startFrom={syncTo("basescan", "basescan_tx", 4)}
          stopAt={46}
          cams={[{ f: 0, z: 1.9, rect: "from" }, { f: 110, z: 2.05, rect: "from" }]}
        />
      </div>
      <div style={{ position: "absolute", left: width * 0.11, top: height * 0.34, width: width * 0.33, opacity: reveal, transform: `translateY(${(1 - reveal) * 16}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.14em", textTransform: "uppercase", color: tone.muted, marginBottom: 12 }}>
          gas paid by
        </div>
        <div style={{ fontFamily: mono, fontSize: 24, color: C.copper, wordBreak: "break-all", lineHeight: 1.45 }}>{DATA.txs.bridge.gasPaidBy}</div>
        <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 34, color: "#fff", marginTop: 16 }}>Kite&rsquo;s relayer.</div>
        <div style={{ fontFamily: sans, fontSize: 30, color: "rgba(255,255,255,0.66)" }}>Not us.</div>
      </div>

      <div style={{ position: "absolute", left: width * 0.11, bottom: height * 0.19, display: "flex", gap: 58, opacity: bal, transform: `translateY(${(1 - bal) * 16}px)` }}>
        {[
          { k: "usdc held", v: `${DATA.wallets.passportWallet.usdc}`, c: "#fff" },
          { k: "native token held", v: DATA.wallets.passportWallet.eth, c: C.copper },
        ].map((x) => (
          <div key={x.k}>
            <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: "0.14em", textTransform: "uppercase", color: tone.muted, marginBottom: 10 }}>{x.k}</div>
            <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 86, color: x.c, letterSpacing: "-0.03em" }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", right: width * 0.07, bottom: height * 0.1, width: width * 0.4, textAlign: "right", fontFamily: sans, fontWeight: 400, fontSize: 36, color: "#fff", letterSpacing: "-0.015em", opacity: interpolate(f, [stable - 8, stable + 6], [0, 1], clamp) }}>
        One stablecoin. Nothing else.
      </div>
    </AbsoluteFill>
  );
};
