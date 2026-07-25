import type { Metadata } from "next";
import { DM_Mono, Literata } from "next/font/google";
import { LenisScrollProvider } from "@/lib/lenis-scroll-provider";
import { ConciergeNav } from "@/components/navigation/concierge-nav";
import { ActiveActTracker } from "@/components/navigation/active-act-tracker";
import "./globals.css";

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
      <body>
        <LenisScrollProvider>
          <ConciergeNav />
          <ActiveActTracker />
          {children}
        </LenisScrollProvider>
      </body>
    </html>
  );
}
