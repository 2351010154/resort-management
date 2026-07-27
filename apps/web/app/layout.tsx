import type { Metadata } from "next";
import { DM_Mono, Literata } from "next/font/google";
import "@mariva/tokens/tokens.css";
import "./globals.css";
import { motionTokensCss } from "@/lib/motion-tokens";

// The root layout carries only what every route on this domain needs: the
// document shell, the type family, and the design tokens. Nothing that pulls
// three / gsap / lenis belongs here — a provider mounted at the root is in the
// tree of every route, so it would drag the whole WebGL bundle into the booking
// funnel. The arrival's scroll machinery lives in app/(marketing)/layout.tsx.
//
// Tokens arrive in two pieces because they have two authors. @mariva/tokens is
// the brand — colour, type, space — and is plain CSS any app can import. The
// eases are code: the same two curves have to exist as GSAP strings for the
// tweens, so they are declared once in lib/motion-tokens.ts and emitted from
// there. The import order matters only to a reader; custom properties resolve
// at use, and no name is declared twice.

// The oryzo.ai pairing: Literata carries the display line, DM Mono every label
// and caps run. Both are variable-free swaps for the CSS custom properties, so
// the whole family is these two declarations.
// Literata carries the `vietnamese` subset, and that is not decoration: it is where
// the đồng sign lives.
//
// ₫ (U+20AB) is in Google Fonts' `vietnamese` subset, not `latin` — and **DM Mono
// has no Vietnamese subset at all**, so the mono face cannot draw the mark on a
// price no matter how it is requested. With `latin` on both faces the browser fell
// back per character, and every price on the booking funnel came out with its digits
// in DM Mono and its currency mark from whatever the system offered, small and off
// the baseline. The arrival never showed a price, so nothing caught it until
// `/booking` existed.
//
// The fallback is arranged in `globals.css` instead: DM Mono, then Literata, then
// the generic. A glyph DM Mono does not have is drawn by the house's other face
// rather than by the operating system's.
const display = Literata({
  subsets: ["latin", "vietnamese"],
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
      <head>
        <style>{motionTokensCss()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
