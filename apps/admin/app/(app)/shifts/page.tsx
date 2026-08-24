// The shifts route — the desk's days as they were counted out.
//
// The history and nothing else. `docs/screens.md` §"Staff surfaces" is explicit
// that shifts "never own a screen visit": the drawer an operator is on lives in
// the shell's top bar, and opening, counting, closing and handing over are
// command-palette actions available from whatever screen the desk is already
// working. What is left for a family screen is the record — past shifts, their
// variances, and the notes each one left the next — which managers and the
// accountant read.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// This file is also what stops `/shifts` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// Everything the screen does needs the browser: a session whose role decides
// whether the reads are made at all and whether the operator filter is offered,
// and a cache the history and the backlog are keyed into. The screen is a client
// component and this file is the boundary between the two.

import { ShiftsScreen } from "@/features/shifts";

export default function ShiftsPage() {
  return <ShiftsScreen />;
}
