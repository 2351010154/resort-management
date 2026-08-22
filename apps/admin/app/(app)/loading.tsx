// What the console draws between two of its screens.
//
// One file at the group root covers every family below it, and what it replaces
// is the only part of the window that changes: `(app)/layout.tsx` keeps the
// rail, the shift bar, the palette and the session mounted across a navigation
// within this group, so the fallback is drawn inside `main` with all of that
// still on screen and still usable. The operator does not leave the console to
// wait for it.
//
// The wait itself is a client chunk, not a server render — every screen family
// here is a client component behind a one-line route file — so this shows for
// the length of a fetch on a cold family and not at all on one the router has
// already loaded.

import { ConsoleWait } from "@/components/console-wait";

export default function AppLoading() {
  return <ConsoleWait />;
}
