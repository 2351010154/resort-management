// The rates route — what every night costs, and the rules attached to it.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail, the
// palette and the `g` sequence — `g t` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is left
// for a route file is naming the screen it draws.
//
// Everything the screen does needs the browser: ten cached reads that share their
// entries with nothing else, a session token held in memory, focus moving along a
// row of nights, a selection that survives a window moving under it. The screen
// is a client component and this file is the boundary between the two.

import { RatesScreen } from "@/features/rates";

export default function RatesPage() {
  return <RatesScreen />;
}
