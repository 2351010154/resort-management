// The guests route — the guest record, and the one audited control that reveals
// an identity number.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail, the
// palette and the `g` sequence — `g g` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is left
// for a route file is naming the screen it draws.
//
// Everything the screen does needs the browser: a search cache shared with
// Bookings, a session token held in memory, focus moving between candidates, and
// a reveal that must be a press rather than a render. The screen is a client
// component and this file is the boundary between the two — a number revealed on
// a server would be a reading filed by a page load.

import { GuestsScreen } from "@/features/guests";

export default function GuestsPage() {
  return <GuestsScreen />;
}
