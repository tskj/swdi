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
  title: "SWDI",
  description: "Remember what you read, and pay the people who wrote it.",
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
