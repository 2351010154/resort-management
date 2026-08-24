// The finance route — the property's own money, in and out.
//
// `docs/screens.md` gives this family a screen of its own and draws its boundary
// narrowly: Finance is "strictly the money the folio system does not capture —
// categorised income and expense such as supplies, utilities and salaries",
// while stay revenue "lives in Reports, computed from night-audit snapshots".
// What is here is therefore the property's own cash book and nothing about a
// guest's account.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
//
// This file is also what stops `/finance` reaching `app/(app)/[...unbuilt]`: a
// static route always wins over a dynamic one, so the catch-all keeps claiming
// the families that have no page yet and claims this one no longer. Nothing else
// changed for that to be true.
//
// Everything the screen does needs the browser: a session whose role decides
// whether the book is read at all and whether the recording form is offered, and
// a cache the book, the property's day and the open drawers are keyed into. The
// screen is a client component and this file is the boundary between the two.

import { FinanceScreen } from "@/features/finance";

export default function FinancePage() {
  return <FinanceScreen />;
}
