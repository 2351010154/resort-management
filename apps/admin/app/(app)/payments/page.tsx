// The payments route — what the property has been paid, and the nights somebody
// held that against the gateway's own report.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// This file is also what stops `/payments` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// Everything the screen does needs the browser: a session whose role decides
// whether the reads are made at all, a cache the three of them are keyed into,
// and a caret that moves to the figures behind a disagreement when the row
// naming it is pressed. The screen is a client component and this file is the
// boundary between the two.

import { PaymentsScreen } from "@/features/payments";

export default function PaymentsPage() {
  return <PaymentsScreen />;
}
