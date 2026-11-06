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
  "Mandate-bound autonomous x402 procurement and wholesale clearinghouse built on SERV Reasoning and Kite Agent Passport. Screens poisoned listings, blocks 402 price spikes, verifies every cited field, and settles on Kite Chain.";

export const viewport: Viewport = {
  themeColor: "#f5f4ef",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Brokr — Mandate-Bound Autonomous Procurement on SERV & Kite",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Brokr",
    title: "Brokr — Give an agent a mandate and a spending cap, not your wallet.",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Brokr — Give an agent a mandate and a spending cap, not your wallet.",
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
