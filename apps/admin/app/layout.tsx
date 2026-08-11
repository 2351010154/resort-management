import type { Metadata } from "next";
import "@mariva/tokens/tokens.css";

// The root layout carries only what every route on this origin needs: the
// document element and the brand tokens. Everything that distinguishes a signed
// -in operator's view from the login screen belongs to a route group below —
// a provider mounted here would be in the tree of the login screen too, which
// is the one route that must render before a session exists.
//
// @mariva/tokens is the same palette and spacing scale the guest site uses; the
// console is a different product, not a different brand. It declares no font
// family — the type stack and the Tailwind theme that reads these custom
// properties arrive with the styling layer, not with the scaffold.
//
// No WebGL, no scroll machinery, no animation runtime. This console is
// keyboard-first and deliberately plain, and the cheapest way to keep it that
// way is to never give the root layout somewhere to hang those from.

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
