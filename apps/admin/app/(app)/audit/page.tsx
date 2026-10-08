// The audit route — who changed protected state, when, and what the record
// looked like on either side of it.
//
// A shell around one component, like the routes beside it: the authenticated
// layout above already mounts the session guard, the query cache, the rail and
// the palette — this family's `Go to` row included, registered from
// `features/shell/nav-inventory.ts` for the whole inventory at once. What is
// left for a route file is naming the screen it draws.
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
//
// The one thing this file does besides naming the screen is read the query
// string, because `screens.md` gives the log two doors: the menu, and a history
// link on a booking, a folio or a guest that opens the view "pre-filtered to
// that record". Read here rather than with `useSearchParams` in the screen, for
// the reason `app/(auth)/login/page.tsx` states about the destination it was
// interrupted with: the hook opts the whole screen into a Suspense boundary to
// answer a question the route already has the answer to, and a screen that
// suspends on its own url paints nothing on the first frame.
//
// `recordHistoryFilters` is what stands between an arbitrary url and the
// filters below. It has no failure to report: a parameter that is not a record
// is no filter at all, and what the reader gets is the sweep screen rather than
// an error about a link they did not write.

import { AuditScreen, recordHistoryFilters } from "@/features/audit";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AuditScreen filters={recordHistoryFilters(await searchParams)} />;
}
