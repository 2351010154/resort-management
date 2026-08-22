// The Reports route — the short menu of named reports.
//
// `docs/screens.md` describes the family as "a short menu of named reports —
// revenue, room status, occupancy, ADR and RevPAR — each a page with a range
// picker, a chart and an Excel export". All five figures are built: `FR-RPT-02`
// is revenue and room status, and `FR-RPT-03`'s three share one page, since they
// are three divisions of one pair of counts over one range. The menu lists what
// exists, filtered to what the role holds.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail, the
// palette and the `g` sequence — `g o` included, bound from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// This file is also what stops `/reports` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// The screen needs the browser: the session whose role decides which of the
// three pages are offered at all, and the palette it registers them with.

import { ReportsScreen } from "@/features/reports";

export default function ReportsPage() {
  return <ReportsScreen />;
}
