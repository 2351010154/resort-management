// The route every unbuilt screen family resolves to, and the reason the
// console's 404 can keep its shell.
//
// A `not-found.tsx` inside a route group is only reached when a segment that
// *matched* asks for it. An address nothing matches — `/housekeeping`,
// `/folios`, any of the families `features/shell/nav-inventory.ts` names and no
// page yet occupies — matches no segment at all, so Next falls out to the root
// `app/not-found.tsx`: outside `(app)`, outside its layout, and outside the
// session that layout holds in memory. The rail disappears and the store the
// landed-on page reads is empty, which is indistinguishable from signed out.
//
// This catch-all gives those addresses something to match inside the group, so
// the 404 they raise is the group's own — drawn in the shell, under the guard,
// with the session intact.
//
// It claims nothing a screen family will later want: a static route always wins
// over a dynamic one, so the day `app/(app)/folios/page.tsx` lands, `/folios`
// stops arriving here and nothing has to be removed for it to.

import { notFound } from "next/navigation";

export default function UnbuiltScreenPage() {
  notFound();
}
