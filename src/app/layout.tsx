import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const APP_URL = "https://vs.hoodmemes.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "VS — Robinhood Chain order flow as a fight",
  description:
    "Live buys and sells on trending Robinhood Chain tokens, rendered as a 3D brawl. No token, just spectacle. By Hood Memes.",
  openGraph: {
    title: "Pit — Robinhood Chain order flow as a fight",
    description: "Pick two trending memecoins; their live buys and sells drive a 3D brawl. Buys strike, sells expose.",
    url: APP_URL,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pit — Robinhood Chain order flow as a fight",
    description: "Pick two trending memecoins; their live buys and sells drive a 3D brawl. By jumpbox.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
