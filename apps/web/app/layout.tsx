import type { Metadata } from "next";
// The house faces, carried in the lockfile rather than fetched while the app
// builds. next/font/google downloads the woff2 from fonts.gstatic.com during
// `next build`, which makes a green build depend on Google serving a CSS
// document whose file names still resolve — and when Google rotated the
// Cormorant Garamond binaries, the stale document some edges kept serving named
// files that 404, so the build failed on machines that reached those edges and
// passed on the ones that did not. A font is a dependency; it belongs where the
// other dependencies are.
//
// Every subset ships with its `unicode-range`, so a browser still downloads
// only latin and vietnamese — the same bytes over the wire as before. The
// variable file covers 300–700 in one download per style, which is why the two
// weights below cost what one used to.
//
// The role names --font-display and --font-ui are assigned from these in
// globals.css, which is the only place the face and the role are joined.
import "@fontsource-variable/cormorant-garamond/wght.css";
import "@fontsource-variable/cormorant-garamond/wght-italic.css";
import "@fontsource/ibm-plex-mono/300.css";
import "@fontsource/ibm-plex-mono/400.css";
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

// The house pairing: Cormorant Garamond carries every display line, IBM Plex Mono
// every label, caps run, and figure. Two declarations, and both of them chosen for
// this hotel rather than inherited.
//
// **Why Cormorant Garamond and not a text serif.** The compositions were drawn
// against a narrow, high-contrast face — several acts still carry the note that the
// old display face "sets wider than the comp's face" and were sized down to
// compensate. Measured: Cormorant Garamond's average lowercase advance is 0.44em
// against Literata's 0.56em, so it sets 21% narrower and the compensation is no
// longer needed. It also has a true 300 Light, which the acts already ask for, and a
// drawn italic for Act 5's turn — not a slanted upright.
//
// The cost is a small x-height: 0.386em against Literata's 0.507em, a ratio of 0.618
// to the cap where Literata sits at 0.724. A Cormorant line therefore reads smaller
// than a Literata line at the same `font-size`, which is why the `--text-display-*`
// steps in @mariva/tokens went up by roughly a quarter with this change. Both
// corrections — width and apparent size — land near the same figure, so one factor
// serves both.
//
// **Why IBM Plex Mono.** ₫ (U+20AB) lives in Google Fonts' `vietnamese` subset, not
// `latin`, and DM Mono has no Vietnamese subset at all — no đồng sign, and no
// diacritics for a guest's own name either. Every price on the booking funnel drew
// its digits in DM Mono and borrowed the mark from next/font's metric-adjusted
// fallback, which rendered it small and off the baseline; `money.tsx` existed to work
// around exactly that. IBM Plex Mono carries both the mark and the diacritics, so the
// workaround is gone rather than patched.
//
// Plex was picked over the other monos that cover Vietnamese because its metrics are
// nearest DM Mono's — x-height 0.516em against 0.496em, same 0.6em advance — so no
// caps size or tracking value in the app had to move, and because its humanist,
// pen-drawn terminals sit with a Garamond in a way a coding face does not.
//
// **Why the italic is a second import.** Act 5 sets a line in italic. Loading the
// drawn italic means the browser never has to shear the upright, which on a face
// with this much stroke contrast is the difference between an italic and a smear.
// The console does not import it — it has no equivalent line — which is the whole
// reason the two apps name their faces separately instead of sharing one module.

export const metadata: Metadata = {
  title: "Mariva",
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
    <html lang="en">
      <head>
        <style>{motionTokensCss()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
