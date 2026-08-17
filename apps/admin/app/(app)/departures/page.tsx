// The departures route — the queue the front desk works its checkouts out of,
// and the screen the dashboard's second card leads into.
//
// A shell around one component and nothing else, like arrivals beside it: the
// authenticated layout above already mounts the session guard, the query cache,
// the rail, the palette and the `g` sequence — `g e` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once — so what
// is left for a route file is naming the screen it draws. Everything the queue
// does needs the browser: a cache, a session token held in memory, focus moving
// between rows. The screen is a client component and this file is the boundary
// between the two.

import { DeparturesScreen } from "@/features/departures";

export default function DeparturesPage() {
  return <DeparturesScreen />;
}
