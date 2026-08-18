// The rooms route — the property's rooms, and the one place that answers why a
// room is not sellable.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail, the
// palette and the `g` sequence — `g r` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is left
// for a route file is naming the screen it draws.
//
// Everything the screen does needs the browser: a cache the housekeeping board is
// shared through, a session token held in memory, focus moving between rooms. The
// screen is a client component and this file is the boundary between the two.

import { RoomsScreen } from "@/features/rooms";

export default function RoomsPage() {
  return <RoomsScreen />;
}
