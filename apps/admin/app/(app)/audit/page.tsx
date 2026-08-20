// The audit route — who changed protected state, when, and what the record
// looked like on either side of it.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail, the
// palette and the `g` sequence — `g u` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is left
// for a route file is naming the screen it draws.
//
// This file is also what stops `/audit` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// Everything the screen does needs the browser: a session whose role decides
// whether the reads are made at all, a cache the two of them are keyed into, and
// a row that opens the record behind it when pressed. The screen is a client
// component and this file is the boundary between the two.

import { AuditScreen } from "@/features/audit";

export default function AuditPage() {
  return <AuditScreen />;
}
