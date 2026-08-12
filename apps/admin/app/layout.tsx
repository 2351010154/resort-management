import type { Metadata } from "next";
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
// and one import in one place is what guarantees that ordering. The two faces
// arrive the same way and for the same reason — globals.css imports them and
// names them, so nothing here has to put a class on <html> for type to work.
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
