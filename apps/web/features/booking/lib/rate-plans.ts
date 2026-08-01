// The three plans and their terms — `property-and-tariff.md` §3.
//
// This was a control on `/booking` and is now data with no control on this
// screen. The plan moves to `/details`: choosing a room is choosing a room, and
// making a guest answer "which cancellation policy" while they are still
// deciding which bed to sleep in is a third question asked out of order. What
// stays here is the *reading* of it — `/booking` quotes `STANDARD`, a link
// carrying `plan=NONREF` still quotes `NONREF`, and the room sheet states the
// terms of whichever plan the search holds.
//
// `NONREF`'s term is stated plainly and without dressing. It is a 100% charge on
// cancellation and the guest should meet it before a room is held, not on a
// confirmation page: the copy voice is a good hotel speaking quietly, which
// includes about its own bad news.

import type { RatePlanCode } from "@mariva/shared";

interface RatePlan {
  readonly code: RatePlanCode;
  readonly name: string;
  readonly term: string;
}

export const RATE_PLANS: readonly RatePlan[] = [
  {
    code: "STANDARD",
    name: "Standard",
    term: "Free to cancel until three days before you arrive.",
  },
  {
    code: "BB",
    name: "With breakfast",
    term: "Breakfast for everyone staying. Free to cancel until three days before.",
  },
  {
    code: "NONREF",
    name: "Non-refundable",
    term: "10% less. Nothing is refunded if you cancel.",
  },
];

function ratePlan(plan: RatePlanCode): RatePlan | undefined {
  return RATE_PLANS.find((option) => option.code === plan);
}

export function planName(plan: RatePlanCode): string {
  return ratePlan(plan)?.name ?? plan;
}

export function planTerm(plan: RatePlanCode): string {
  return ratePlan(plan)?.term ?? "";
}
