// How many beds have to be carried into a room, and nothing whatever about
// what they cost.
//
// Authority is `docs/architecture/property-and-tariff.md` §1: a bed is mandatory
// exactly when the heads that need their own bedding exceed what the room's
// bedding sleeps. §3 decides which heads those are — a head under 6 is free,
// sharing existing bedding — so an under-6 never puts a bed in a room. Two
// adults and a four-year-old need bedding for two; the same two adults and a
// nine-year-old need bedding for three.
//
// It keys on what the bedding sleeps and never on whether the type *takes* an
// extra bed. That column says a bed can go in, this function says one must, and
// reading the column here would answer the second question with the first. Under
// §1's mix only the Junior Suite can require one — a maximum of three against
// bedding for two — which is why the Deluxe and the Panorama Suite carry the
// column and can never be asked for a bed by it.
//
// **This module prices nothing, and that is the rule rather than an omission.**
// §1 makes a required bed free: the advertised maximum is a promise and the bed
// is how the property keeps it, so billing for it would charge the guest to
// receive the occupancy they were sold. §3's age-banded extra-person charge is
// the entire price of the extra head, and it lives one file over in
// `occupancy-pricing.ts`. §6's 350,000 ₫ item is a desk posting for a bed a guest
// asked for where occupancy did not require one; no quote reaches it. A function
// here returning money would be the inference §1 spent a paragraph forbidding.

import { CHILD_FREE_BELOW_AGE, type Party } from "./occupancy-pricing.js";

/**
 * Beds the property has to carry in for this party — §1.
 *
 * `beddingSleeps` is the type's own figure and never its maximum occupancy: a
 * party above the maximum is refused rather than bedded, and a party at the
 * maximum is precisely the one a bed exists for.
 *
 * The head count is not `breakfastHeads`, which arrives at the same number from
 * the same age line. Sharing the line as {@link CHILD_FREE_BELOW_AGE} is what
 * §3's own argument asks for; sharing the *function* would tie what a guest eats
 * to where they sleep, and a future band that moved one would silently move the
 * other.
 */
export function bedsRequired(party: Party, beddingSleeps: number): number {
  const needBedding =
    party.adults +
    party.children.filter((child) => child.age >= CHILD_FREE_BELOW_AGE).length;

  return Math.max(0, needBedding - beddingSleeps);
}
