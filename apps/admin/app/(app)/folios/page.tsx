// The folios route — the property's accounts, and the append-only ledger behind
// one stay's.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// This file is also what stops `/folios` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// Everything the screen does needs the browser: a cache the checkout sequence
// shares the same folio through, a session token held in memory, focus moving
// between accounts. The screen is a client component and this file is the
// boundary between the two.

import { FoliosScreen } from "@/features/folios";

export default function FoliosPage() {
  return <FoliosScreen />;
}
