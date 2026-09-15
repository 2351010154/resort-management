// §7's member discount, as the one place that decides which row applies.
//
// Two callers ask this question and they must not answer it differently.
// `modules/inventory` asks it while the guest is still choosing — the month grid
// and the room cards — and `modules/booking` asks it again at the moment of sale
// and freezes the answer onto the row. `stay-quote.ts` in `@mariva/shared` makes
// the argument one level down about the *arithmetic*; this file makes it about
// the *choice of row*, which is the other half of a price and was until now
// written out inside the quote service alone. A funnel that picked a campaign by
// its own reading of `valid_to` would show a total the sale then contradicts.
//
// **It is split in two because the grid prices 365 stays and the sale prices
// one.** A member's month view ranks the same handful of rows against every
// night in the window; a query per night would be a year of round trips on a
// route `NFR-03` gives 300 ms. So the fetch is one statement, and the ranking is
// arithmetic the caller repeats per stay. That also moves the window and
// minimum-nights conditions out of SQL and into {@link bestTierPromotion} — the
// same predicates, evaluated per candidate stay rather than baked into a query
// that only ever described one.
//
// **Only tier-gated rows are read here.** A `promotion` with no
// `requires_loyalty_tier` is a campaign open to everyone, and applying one would
// move the price of every stay the property sells. That is a larger decision
// than §7's, it needs a way to show a campaign on the funnel, and nothing here
// reaches for it — `isNotNull` below is what keeps it out.

import {
  type LoyaltyTier,
  type PromotionType,
  promotionReduction,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { promotion } from "../../database/schema/pricing.js";
import type { DerivedTier } from "../guest/tier-derivation.service.js";

/** A promotion as it was frozen, and the code that names the row it came from. */
export interface AppliedPromotion {
  readonly code: string;
  readonly type: PromotionType;
  /** Whole points when `PERCENTAGE`, whole đồng when `FIXED_AMOUNT`. Negative. */
  readonly value: bigint;
}

/** A candidate row with the two conditions a stay still has to satisfy. */
export interface TierPromotionCandidate extends AppliedPromotion {
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly minNights: number | null;
}

/** The stay a candidate is being ranked against. */
export interface PromotableStay {
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly nights: number;
  /** The room rate under the plan, before any promotion. */
  readonly roomGross: VndAmount;
}

/**
 * The tier a discount can be gated on, or null for a guest no discount is owed.
 *
 * `MEMBER` becomes null, and that is `rate-calendar.ts`'s rule rather than a
 * convenience: §7 gives the base tier no discount, so a promotion gated on it
 * would be gated on nothing, and `LOYALTY_TIERS` deliberately does not hold the
 * word. Stated once here because both the sale and the funnel derive a tier and
 * both have to narrow it the same way — two spellings of this line is how a
 * guest comes to be quoted as a member on one screen and not on the next.
 */
export function discountableTier(tier: DerivedTier): LoyaltyTier | null {
  return tier === "MEMBER" ? null : tier;
}

/**
 * Every live discount this tier stands at or above, cheapest query first.
 *
 * **The gate is a floor, not an equality.** `pricing.ts` calls
 * `requires_loyalty_tier` "the tier a discount is *gated on*", and a gate is
 * something a guest is at least as high as — which is also the only reading
 * under which the `MEMBER` sentence above holds. So a Gold guest qualifies for a
 * Silver-gated campaign as well as a Gold-gated one, and `loyalty_tier`'s
 * declaration order is what `<=` compares on.
 *
 * Ordered by code so a tie settles on the same row on every run. The tie is in
 * đồng and moves nobody's price; what it decides is which code a booking freezes,
 * and freezing the same one every time is what keeps two identical stays reading
 * identically afterwards.
 *
 * A null tier answers with no candidates and issues no statement — the ordinary
 * case on a public search, which is a stranger.
 */
export async function tierPromotions(
  exec: DbExecutor,
  tier: LoyaltyTier | null,
): Promise<readonly TierPromotionCandidate[]> {
  if (tier === null) {
    return [];
  }

  return await exec
    .select({
      code: promotion.code,
      type: promotion.type,
      value: promotion.value,
      validFrom: promotion.validFrom,
      validTo: promotion.validTo,
      minNights: promotion.minNights,
    })
    .from(promotion)
    .where(
      and(
        eq(promotion.isActive, true),
        // Tier-gated rows only — the header says why an open campaign is not
        // this path's to apply.
        isNotNull(promotion.requiresLoyaltyTier),
        lte(promotion.requiresLoyaltyTier, tier),
      ),
    )
    .orderBy(asc(promotion.code));
}

/**
 * The candidate that takes the most off this stay, or null.
 *
 * **One promotion applies, and it is the one that takes the most off.** Stacking
 * is a decision about campaigns rather than about tiers — which two combine, in
 * what order, to what floor — and §7 asks for none of it: a guest is on one rung
 * and is owed one discount. Ranking by what each candidate actually *reduces*,
 * rather than by its stored value, is what makes the two scales comparable at
 * all: −5% and 200,000 ₫ off order differently on one night than on seven.
 * `promotionReduction` is the same arithmetic `stayTotalGross` will apply, so
 * the row that wins here is the row that produces the lowest total there.
 *
 * **The window has to cover the whole stay.** The discount is taken off the
 * summed room total, so a campaign that expires mid-stay would otherwise
 * discount nights it had already stopped applying to. Requiring it to cover the
 * departure's last night — the departure date less one, since the departure is
 * not a night sold — is the reading that cannot overpay. §7's own rows carry no
 * window at all: a loyalty discount is open-ended by construction, which is what
 * the nullable ends of `promotion` are for.
 *
 * A candidate that reduces by nothing is discarded rather than returned. A
 * `FIXED_AMOUNT` row cannot reduce by nothing — the constraint keeps it below
 * zero — but a `PERCENTAGE` row can, against a stay whose room total is small
 * enough that integer division truncates the discount away. Returning that one
 * would put a code and a value on a booking whose total they did not move, and a
 * guest reading their confirmation would find a discount that took nothing off.
 */
export function bestTierPromotion(
  candidates: readonly TierPromotionCandidate[],
  stay: PromotableStay,
): AppliedPromotion | null {
  const opensBy = stay.checkIn.toString();
  const closesNoSoonerThan = stay.checkOut.subtract({ days: 1 }).toString();

  let winner: AppliedPromotion | null = null;
  let deepest = 0n;

  for (const candidate of candidates) {
    // A null at either end is a campaign that has always been running or has no
    // end — which is what §7's two rows are.
    if (candidate.validFrom !== null && candidate.validFrom > opensBy) {
      continue;
    }

    if (candidate.validTo !== null && candidate.validTo < closesNoSoonerThan) {
      continue;
    }

    if (candidate.minNights !== null && candidate.minNights > stay.nights) {
      continue;
    }

    const reduction = promotionReduction(stay.roomGross, candidate);

    if (reduction > deepest) {
      winner = { code: candidate.code, type: candidate.type, value: candidate.value };
      deepest = reduction;
    }
  }

  return winner;
}
