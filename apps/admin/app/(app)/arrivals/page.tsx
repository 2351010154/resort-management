// The arrivals route — the queue the front desk works its check-ins out of,
// and the screen the dashboard's first card leads into.
//
// A shell around one component and nothing else, like the dashboard beside it:
// the authenticated layout above already mounts the session guard, the query
// cache, the rail and the palette — this family's `Go to` row included,
// registered from `features/shell/nav-inventory.ts` for the whole inventory at
// once — so what is left for a route file is naming the screen it draws.
// Everything the queue does needs the browser: a cache, a session token held
// in memory, focus moving between rows. The screen is a client component and
// this file is the boundary between the two.

import { ArrivalsScreen } from "@/features/arrivals";

export default function ArrivalsPage() {
  return <ArrivalsScreen />;
}
