import type { Metadata } from "next";
import { DM_Mono, Literata } from "next/font/google";
import "./globals.css";

// The root layout carries only what every route on this domain needs: the
// document shell, the type family, and the design tokens. Nothing that pulls
// three / gsap / lenis belongs here — a provider mounted at the root is in the
// tree of every route, so it would drag the whole WebGL bundle into the booking
// funnel. The arrival's scroll machinery lives in app/(marketing)/layout.tsx.

// The oryzo.ai pairing: Literata carries the display line, DM Mono every label
// and caps run. Both are variable-free swaps for the CSS custom properties, so
// the whole family is these two declarations.
const display = Literata({
  subsets: ["latin"],
  variable: "--font-display",
});

const ui = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: "Mariva — 5 Star Resort",
  description:
    "Rest. Relax. Rejuvenate. An arrival ritual — the Mariva resort concept.",
  icons: { icon: "/brand/mariva-monogram.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
