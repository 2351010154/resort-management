import type { Metadata } from "next";
import "./globals.css";

// The root layout carries only what every route on this origin needs: the
// document element, the type stack, and the admin-only stylesheet. Everything that distinguishes a signed-in
// operator's view from the login screen belongs to a route group below — a
// provider mounted here would be in the tree of the login screen too, which is
// the one route that must render before a session exists.
//
// globals.css imports the console tokens before its `@theme` block. The one
// Figtree family arrives there too, so no document class is needed for type.
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
