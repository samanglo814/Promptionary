// The root layout wraps EVERY page in the app (/, /host, /play, ...).
// Anything here (the <html> and <body> tags, fonts, global CSS) applies everywhere.

import type { Metadata } from "next";
import { Inter, Lilita_One } from "next/font/google";
import "./globals.css"; // Tailwind + design tokens + animations, loaded once for the whole app

// Fonts. next/font downloads them at build time and serves them from our own site,
// so there's no flash of the wrong font. `variable` exposes each one as a CSS variable.
// Lilita One for headlines, scores and timers (font-display); Inter for everything else.
const lilita = Lilita_One({
  variable: "--font-lilita",
  weight: "400",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// What shows in the browser tab and in link previews (when someone shares the URL).
export const metadata: Metadata = {
  title: "Drawrades",
  description:
    "Charades, but you describe it and the AI draws what it thought you meant. A party game for one big screen and everyone's phones.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lilita.variable} ${inter.variable} h-full antialiased`}
    >
      {/* {children} is whichever page you're on */}
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}