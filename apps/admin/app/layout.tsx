import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// The root layout carries only what every route on this origin needs: the
// document element, the type stack, and the stylesheet that joins the brand
// tokens to Tailwind's theme. Everything that distinguishes a signed-in
// operator's view from the login screen belongs to a route group below — a
// provider mounted here would be in the tree of the login screen too, which is
// the one route that must render before a session exists.
//
// globals.css imports @mariva/tokens itself, so this file no longer does: the
// tokens have to be in scope *before* the `@theme` block that references them,
// and one import in one place is what guarantees that ordering.
//
// No WebGL, no scroll machinery, no animation runtime. This console is
// keyboard-first and deliberately plain, and the cheapest way to keep it that
// way is to never give the root layout somewhere to hang those from.

// The same two faces the guest site sets, for the same two reasons — the
// console is a different product, not a different brand, and apps/web's layout
// records the measurements behind the pairing.
//
// The short version of the one that matters here: IBM Plex Mono carries ₫
// (U+20AB) and the Vietnamese diacritics, which the console needs on every
// folio line and in every guest's own name. DM Mono, the face this replaced on
// the guest site, has neither.
//
// These are named for the face, not the role. The role names — --font-display
// and --font-ui — are assigned once in globals.css's `@theme`, so that the day
// a face is swapped there is exactly one line to change and no stylesheet
// anywhere is quietly asserting that "display" means "Cormorant".
const cormorant = Cormorant_Garamond({
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400"],
  variable: "--font-cormorant",
});

// No italic here, unlike the guest site: the arrival sets one line in italic
// for effect, and an operational screen has no equivalent. Loading a second
// drawn style would be bytes on the console's critical path for nothing.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Mariva Console",
  description: "Front-desk and management console for the Mariva property.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
