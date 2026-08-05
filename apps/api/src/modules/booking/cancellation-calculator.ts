// What a booking costs when the stay does not happen, or stops happening —
// `property-and-tariff.md` §4.
//
// A pure function over the grid, and it **persists nothing**. §4's amounts are
// charges, and a charge is a folio posting: `M4` computes the number and `M6`
// owns the ledger that puts it somewhere. `schema/booking.ts` makes the same
// point about why no money table exists yet — a balance written before the
// ledger that owns it is a second place for a balance to live.
//
// The grid, transcribed:
//
// | Event                              | `STANDARD` / `BB`        | `NONREF`                  |
// |------------------------------------|--------------------------|---------------------------|
// | Cancel ≥ 3 days before arrival, by 18:00 | free               | 100% of stay              |
// | Cancel < 3 days before arrival     | first night              | 100% of stay              |
// | No-show                            | first night              | 100% of stay              |
// | Early departure                    | remaining nights at 50%  | remaining nights at 100%  |
//
// The last cell is worth reading twice, because it is not "100% of stay" and it
// is not a softer deal either. On an early departure the nights already spent
// have been posted by the night audit as ordinary room charges; what is left to
// decide is the nights that will not be. Charging a `NONREF` guest the whole
// stay *again* would bill the spent nights twice. Remaining-at-100% plus the
// nights already posted is 100% of the stay, which is what the plan promised.
//
// **Nights, not a total.** §4 charges "the first night" and refunds "the
// remaining nights at 50%", and neither may be approximated by dividing a stay
// total by a count when a weekend night costs more than a Tuesday. That is why
// `booking_night` exists, and this is the caller it exists for.
//
// The basis those night amounts are on is the caller's to choose, and this file
// is deliberately agnostic: it selects and scales, and it never derives a price.
// `booking_night` stores the calendar price before the plan's percentage, and
// `property-and-tariff.md` §5 forbids rounding inside a calculation — so a
// caller assembling a folio line applies the plan's percentage once, over
// whatever this returns, rather than per night on the way in.

import {
  Time,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import {
  type ChargeBasis,
  PROPERTY_TIME_ZONE,
  type RatePlanCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";

/** §4: the free-cancellation window closes this many days before arrival. */
export const FREE_CANCELLATION_DAYS_BEFORE_ARRIVAL = 3;

/** §4: "Deadline is 18:00 ICT on the cutoff date." */
export const CANCELLATION_DEADLINE_HOUR = 18;

/**
 * The instant a free cancellation must arrive by — 18:00 in the property's zone
 * on the third day before arrival.
 *
 * An instant and not a date, which is the one place in this module a wall clock
 * is the right answer: a guest cancelling at 18:01 has missed a deadline that
 * was stated as a time. The stay boundary it is derived *from* is still a
 * `CalendarDate`, and the crossing between the two happens here, once.
 */
export function freeCancellationDeadline(checkInDate: StayDate): Date {
  const cutoff = checkInDate.subtract({
    days: FREE_CANCELLATION_DAYS_BEFORE_ARRIVAL,
  });

  return toZoned(
    toCalendarDateTime(cutoff, new Time(CANCELLATION_DEADLINE_HOUR)),
    PROPERTY_TIME_ZONE,
  ).toDate();
}

/**
 * Which row of the grid fired.
 *
 * Returned alongside the amount because a folio line at `M6` has to say what it
 * is for, and re-deriving that from the number would be impossible: a free
 * cancellation and an early departure on the final night both come to zero.
 *
 * `@mariva/shared` owns the list, for the reason it owns the booking states and
 * the refusal codes: two layers spell it — this calculator and the wire shape
 * `contract/booking.ts` gives an early departure — and a local copy of five
 * strings would compile.
 */
export type { ChargeBasis };

/**
 * What ended the stay.
 *
 * A discriminated union rather than a flag and four optional fields, because
 * each row needs a different fact and only one of them: a cancellation needs the
 * moment it arrived, an early departure needs how many nights are already
 * posted, and a no-show needs neither — the night audit already decided it by
 * comparing business dates, so there is nothing left here to re-decide.
 */
export type PolicyEvent =
  | { readonly kind: "CANCELLATION"; readonly cancelledAt: Date }
  | { readonly kind: "NO_SHOW" }
  | {
      readonly kind: "EARLY_DEPARTURE";
      /**
       * Leading nights the night audit has already posted to the folio — not
       * elapsed calendar nights, and never a date subtraction. The two agree on
       * an ordinary stay and part on a late arrival, which reverses its no-show
       * charge (`booking-state-machine.md` §3): that guest has a night behind
       * them with nothing posted for it, and counting it here would leave the
       * folio one night short. Count postings.
       */
      readonly nightsSpent: number;
    };

export interface PolicyChargeInput {
  readonly plan: RatePlanCode;
  readonly checkInDate: StayDate;
  /** One amount per night of the stay, in stay order. */
  readonly nights: readonly VndAmount[];
  readonly event: PolicyEvent;
}

export interface PolicyCharge {
  readonly amount: VndAmount;
  readonly basis: ChargeBasis;
}

function sum(amounts: readonly VndAmount[]): VndAmount {
  return amounts.reduce<VndAmount>((total, amount) => total + amount, 0n);
}

/**
 * The charge §4's grid prescribes.
 *
 * Waiving any of these is `refund.override` and a different capability — see
 * `rbac-matrix.md` §2. Nothing here knows about a waiver, deliberately: the
 * policy number and the decision to depart from it are two different records,
 * and a calculator that could return either would lose which one it returned.
 */
export function policyCharge({
  plan,
  checkInDate,
  nights,
  event,
}: PolicyChargeInput): PolicyCharge {
  // A stay of no nights is refused by `booking_covers_at_least_one_night`, so
  // an empty list here is a caller that assembled its input wrongly rather than
  // a booking that exists. Answering it with zero would be a penalty silently
  // waived.
  if (nights.length === 0) {
    throw new RangeError("a booking covers at least one night");
  }

  const isNonRefundable = plan === "NONREF";
  const fullStay: PolicyCharge = { amount: sum(nights), basis: "FULL_STAY" };

  switch (event.kind) {
    case "CANCELLATION": {
      if (isNonRefundable) return fullStay;

      // On the deadline is inside it — §4 reads "by 18:00", not "before".
      return event.cancelledAt.getTime() <=
        freeCancellationDeadline(checkInDate).getTime()
        ? { amount: 0n, basis: "NONE" }
        : { amount: nights[0], basis: "FIRST_NIGHT" };
    }

    case "NO_SHOW":
      return isNonRefundable
        ? fullStay
        : { amount: nights[0], basis: "FIRST_NIGHT" };

    case "EARLY_DEPARTURE": {
      if (!Number.isInteger(event.nightsSpent) || event.nightsSpent < 0) {
        throw new RangeError("nightsSpent is a count of nights already posted");
      }

      // Past the end of the stay this is empty, and zero is the right answer:
      // a guest leaving on their final night has no remaining nights to charge.
      const remaining = nights.slice(event.nightsSpent);
      const total = sum(remaining);

      return isNonRefundable
        ? { amount: total, basis: "REMAINING_NIGHTS_FULL" }
        : // Integer division truncates the odd đồng downward, which is the
          // guest's direction — the same choice `occupancy-pricing.ts` makes for
          // its half-rate band, and made here for the same reason: `money.ts`
          // chose `bigint` precisely so a percentage could not arrive as a float
          // multiply that leaves the ledger a few đồng short.
          { amount: total / 2n, basis: "REMAINING_NIGHTS_HALF" };
    }
  }
}
