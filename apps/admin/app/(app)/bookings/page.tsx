// The bookings route — where the desk finds a stay, and where the two bookings
// the funnel cannot take are taken.
//
// A shell around one component and nothing else, like the queues beside it: the
// authenticated layout above already mounts the session guard, the query cache,
// the rail, the palette and the `g` sequence — `g b` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once — so what is
// left for a route file is naming the screen it draws. Everything the screen
// does needs the browser: a cache, a session token held in memory, focus moving
// between rows and into a form. The screen is a client component and this file
// is the boundary between the two.

import { BookingsScreen } from "@/features/bookings";

export default function BookingsPage() {
  return <BookingsScreen />;
}
