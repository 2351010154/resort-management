// Who a party is, and what the heads beyond the rate cost — `FR-PRC-04`.
//
// Authority is `docs/architecture/property-and-tariff.md` §3. It settles the
// age bands and it does not settle the extra *bed*, and keeping those two apart
// is the whole discipline of this file. §9 leaves the bed rule with the owner
// and states that no pricing path may infer it from bed capacity, so nothing
// here reads `takesExtraBed` or `beddingSleeps` — an extra person is a charge on
// a head, an extra bed is a service line, and this module does not know the
// second exists. A party of three is priced the same whether the third head
// sleeps in existing bedding or on a bed somebody has to carry in, because that
// is the only answer that does not assume the owner's.
//
// It lives in `@mariva/shared` for the reason `INCLUDED_OCCUPANCY` does, one
// file over: the API prices against these bands and the funnel quotes against
// them, and two copies of a pricing boundary is how a quote and an invoice come
// to disagree. The API's use of it is the authoritative one — the funnel runs
// the same arithmetic so its card can show a total before a round trip, not so
// it can hold an opinion the server will later contradict.
//
// All amounts are `bigint`, and the half-rate band is `/ 2n`: integer division
// that truncates the odd đồng downward, which is the guest's direction. `money.ts`
// chose the type precisely so a band could not be applied as a float multiply.

import type { VndAmount } from "./money.js";
import { INCLUDED_OCCUPANCY } from "./rate-calendar.js";

/**
 * Below this age a child is free, sharing existing bedding — §3.
 *
 * The same line governs breakfast under `BB`. §3 says the plan covers "the
 * booked occupancy" without saying what a small child eats, and a child too
 * young to be charged for a bed is not charged for a meal either. That is an
 * assumption rather than a quotation, which is why it is one named constant
 * both rules read instead of a `6` written twice.
 */
export const CHILD_FREE_BELOW_AGE = 6;

/** From `CHILD_FREE_BELOW_AGE` up to this age, half the extra-person rate — §3. */
export const CHILD_HALF_RATE_BELOW_AGE = 12;

/** A child, with the age that decides what they cost — §3. */
export interface Child {
  readonly age: number;
}

/**
 * The heads a stay is quoted for.
 *
 * Children are ages and not a count, because §3 prices them in three bands and
 * a count cannot say which. An adult carries no age: §3 has one adult band, and
 * a field nothing reads is a field somebody will later populate wrongly.
 */
export interface Party {
  readonly adults: number;
  readonly children: readonly Child[];
}

/** Heads in the party, of any age. What the type's maximum is compared against. */
export function partySize({ adults, children }: Party): number {
  return adults + children.length;
}

/**
 * What one head of this age costs when they are one of the extra ones — §3.
 *
 * Not exported. The bands only mean anything after `INCLUDED_OCCUPANCY` has
 * decided *which* heads are extra, and a caller reaching for a per-head figure
 * on its own would be pricing every guest in the room.
 */
function chargeForAge(
  age: number,
  extraPersonPerNightGross: VndAmount,
): VndAmount {
  if (age < CHILD_FREE_BELOW_AGE) return 0n;
  if (age < CHILD_HALF_RATE_BELOW_AGE) return extraPersonPerNightGross / 2n;
  return extraPersonPerNightGross;
}

/**
 * Extra-person charge for one night, cheapest heads first — `FR-PRC-04`.
 *
 * §3: the bands apply to whoever is beyond the included occupancy, and the
 * cheapest heads are the ones counted as beyond it. Two adults and a
 * nine-year-old pay one half-rate extra person and not one full one — the child
 * is the third head, not one of the two the rate already covers.
 *
 * That ordering is a requirement rather than a kindness. Charging the adults
 * instead would make a family with a small child cost more than the same family
 * without them, which is the opposite of what a table with a free band says.
 *
 * Sorted by what a head costs rather than by age, so the ordering cannot drift
 * from the bands: a future band that made some older child cheaper would be
 * honoured here without this function being touched.
 */
export function extraPersonPerNight(
  party: Party,
  extraPersonPerNightGross: VndAmount,
): VndAmount {
  const beyond = partySize(party) - INCLUDED_OCCUPANCY;
  if (beyond <= 0) return 0n;

  const charges = [
    ...party.children.map((child) =>
      chargeForAge(child.age, extraPersonPerNightGross),
    ),
    ...Array.from({ length: party.adults }, () => extraPersonPerNightGross),
    // A `bigint` difference is not a `number`, and `sort` requires one — so the
    // comparator comes out as a sign rather than as a subtraction.
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  return charges
    .slice(0, beyond)
    .reduce<VndAmount>((total, charge) => total + charge, 0n);
}

/**
 * Heads breakfast is charged for under `BB` — §3, and see
 * {@link CHILD_FREE_BELOW_AGE} for why the under-6 line carries across.
 *
 * Every head over the line, not only the ones beyond the included occupancy: a
 * meal is eaten by whoever eats it, where a bed is what the room rate already
 * covers for two.
 */
export function breakfastHeads(party: Party): number {
  return (
    party.adults +
    party.children.filter((child) => child.age >= CHILD_FREE_BELOW_AGE).length
  );
}
