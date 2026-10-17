// The root layout wraps EVERY page in the app (/, /host, /play, ...).
// Anything here (the <html> and <body> tags, fonts, global CSS) applies everywhere.

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css"; // Tailwind + design tokens + animations, loaded once for the whole app

// Fonts. next/font downloads them at build time and serves them from our own site,
// so there's no flash of the wrong font. `variable` exposes each one as a CSS variable.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// What shows in the browser tab and in link previews (when someone shares the URL).
export const metadata: Metadata = {
  title: "Reverse Charades",
  description:
    "Charades, but you describe it and the AI draws what it thought you meant. A party game for one big screen and everyone's phones.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* {children} is whichever page you're on */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}