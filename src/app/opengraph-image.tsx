import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#F5F4EF",
          color: "#111317",
          fontFamily: "sans-serif",
          border: "16px solid #143642",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                backgroundColor: "#143642",
                color: "#F5F4EF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "26px",
                fontWeight: 700,
              }}
            >
              B
            </div>
            <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.02em" }}>
              Brokr
            </span>
          </div>
          <div
            style={{
              fontSize: "18px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#143642",
              padding: "10px 18px",
              border: "1.5px solid #C5C2B6",
              borderRadius: "999px",
              backgroundColor: "#FFFFFF",
            }}
          >
            SERV Reasoning · Kite Agent Passport · x402
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "980px" }}>
          <div
            style={{
              fontSize: "64px",
              lineHeight: 1.06,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "#111317",
            }}
          >
            Give an agent a mandate and a spending cap, not your wallet.
          </div>
          <div
            style={{
              fontSize: "26px",
              lineHeight: 1.4,
              color: "#4B515C",
            }}
          >
            Autonomous x402 procurement & wholesale clearinghouse. Screens rogue vendors on SERV, settles inside Kite Passport bounds, verifies every cited field, and earns +60% net margin per call.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "center",
            fontSize: "20px",
            color: "#143642",
            fontWeight: 600,
          }}
        >
          <span>● 6-Step Bounded SERV Graph</span>
          <span>·</span>
          <span>● Gasless Kite Chain x402 (2366 / 2368)</span>
          <span>·</span>
          <span>● Zero Unverified Spend</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
