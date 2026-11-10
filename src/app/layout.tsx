import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const siteUrl =
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.RENDER_EXTERNAL_URL ??
  "http://localhost:3000";

const DESCRIPTION =
  "Zero-drain agent commerce and pay-only-if-verified x402 escrow on SERV Reasoning & Kite Agent Passport. Watch SERV OFF vs. SERV ON block prompt-injected vendors and HTTP 402 price spikes in real time.";

export const viewport: Viewport = {
  themeColor: "#f5f4ef",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Brokro — Zero-Drain Agent Commerce & x402 Escrow on SERV & Kite",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Brokro",
    title: "Brokro — Give an agent a mandate and a spending cap, not your wallet.",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Brokro — Give an agent a mandate and a spending cap, not your wallet.",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`}
    >
      <body>
        <div className="drafting-backdrop" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
