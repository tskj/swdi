import type { Metadata } from "next";
import { Fraunces, Newsreader } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets:  ["latin"],
  variable: "--font-display",
  axes:     ["SOFT", "WONK", "opsz"],
});

const newsreader = Newsreader({
  subsets:  ["latin"],
  style:    ["normal", "italic"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "SWDI, the Sustainable Web & Internet Donations Initiative",
  description: "Remember what you read, and pay the people who wrote it.",
  // Tells the Dark Reader extension to leave the page alone: the palette in globals.css
  // already follows prefers-color-scheme, and Dark Reader's heuristics sometimes layer
  // an inversion filter on top of an already-dark page. The lock meta is that project's
  // sanctioned opt-out for sites with native dark mode.
  other: { "darkreader-lock": "true" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${newsreader.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  );
}
