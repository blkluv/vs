import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pit — Robinhood Chain order flow as a fight",
  description:
    "Live buys and sells on trending Robinhood Chain tokens, rendered as a 3D brawl. No token, just spectacle. By jumpbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
