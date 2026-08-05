// What a charge computed off `property-and-tariff.md` §4's grid is *for*, in one
// place because two layers spell it: the calculator that selects and scales the
// stored nights, and the route that hands the answer to a desk.
//
// Here at the root and not in `contract/`, for the reason `booking-refusal.ts`
// and `booking-state.ts` are: a basis is vocabulary, not a route. The wire shape
// that carries one — an amount beside a basis — belongs to `contract/booking.ts`,
// and this is the list that shape is built from.
//
// The amount is not here either, and deliberately. `money.ts` owns what an
// amount is; this owns what the amount is being claimed for, and the two are
// separate because a free cancellation and an early departure on the final night
// both come to zero. Re-deriving the reason from the number is impossible.

import { z } from "zod";

/**
 * The rows of §4's grid, as the thing a folio line at `M6` will say it is.
 *
 * `NONE` is a row and not the absence of one: a cancellation inside the free
 * window is a decision the property made, and a line that said nothing about it
 * would leave a guest asking why they were not charged.
 *
 * The two `REMAINING_NIGHTS_*` values are the early-departure row's two plans.
 * §4 charges a refundable plan half of what is left and a `NONREF` plan all of
 * it, and the difference matters to the caller reading this: the second is not
 * "100% of stay", because the nights already slept were posted by the night
 * audit and charging the whole stay again would bill them twice.
 */
export const CHARGE_BASES = [
  "NONE",
  "FIRST_NIGHT",
  "FULL_STAY",
  "REMAINING_NIGHTS_HALF",
  "REMAINING_NIGHTS_FULL",
] as const;

export const chargeBasisSchema = z.enum(CHARGE_BASES);

export type ChargeBasis = z.infer<typeof chargeBasisSchema>;
