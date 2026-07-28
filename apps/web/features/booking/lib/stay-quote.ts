// Turning a range, a party and a plan into the two numbers on a card.
//
// Every rule here is `docs/architecture/property-and-tariff.md`: §3 for the plan
// arithmetic and the child bands, §5 for gross display and for rounding being
// presentation-only. Nothing in this file rounds. The one function that does is
// `roundVndForDisplay` in `@mariva/shared`, called by the components that render
// — because a total is the rounded sum of the nights and never the sum of the
// rounded nights, and the only way to keep that true is to have no rounding
// anywhere upstream of the text.
//
// All arithmetic is `bigint`. Percentages are therefore applied as an integer
// numerator over an integer denominator rather than a float multiply: `× 9n / 10n`
// truncates deterministically, where `× 0.9` would not typecheck at all — which
// is the whole reason `money.ts` chose the type.

import {
  type NightRate,
  nightCount,
  type RatePlanCode,
  type RoomTypeCode,
  type RoomTypeOffer,
  type StayDate,
  type StayRange,
  type VndAmount,
} from "@mariva/shared";
import { INCLUDED_OCCUPANCY, ROOM_TYPES, type RoomType } from "./room-types";

/** A child, with the age that decides what they cost — `property-and-tariff` §3. */
export interface Child {
  readonly age: number;
}

export interface Party {
  readonly adults: number;
  readonly children: readonly Child[];
}

export function partySize({ adults, children }: Party): number {
  return adults + children.length;
}

/**
 * Extra-person charge for one night, for one party, before the plan.
 *
 * §3's bands: under 6 free sharing existing bedding, 6–11 at half the
 * extra-person rate, 12 and over as an adult. The bands apply to whoever is
 * *beyond* the included occupancy, and the property charges the cheapest
 * qualifying heads last — a family of two adults and one nine-year-old pays one
 * half-rate extra person, not one full one.
 */
function extraPersonPerNight(party: Party, rates: TariffRates): VndAmount {
  const beyond = partySize(party) - INCLUDED_OCCUPANCY;
  if (beyond <= 0) return 0n;

  // Cheapest heads counted as the extra ones: under-6s cost nothing, so they
  // occupy the extra slots first and the adults stay inside the rate.
  const heads = [
    ...party.children.map((child) => child.age),
    ...Array.from({ length: party.adults }, () => 30),
  ].sort((left, right) => left - right);

  return heads
    .slice(0, beyond)
    .reduce<VndAmount>((sum, age) => sum + headRate(age, rates), 0n);
}

function headRate(age: number, rates: TariffRates): VndAmount {
  if (age < 6) return 0n;
  if (age < 12) return rates.extraPersonPerNight / 2n;
  return rates.extraPersonPerNight;
}

/**
 * Heads breakfast is charged for under `BB`.
 *
 * §3 says `BB` is "`STANDARD` + breakfast for the booked occupancy" and does not
 * say what a small child eats. The under-6 line in the same section is the
 * nearest rule the property has, so it carries: a child too young to be charged
 * for a bed is too young to be charged for breakfast. Stated here rather than
 * buried, because it is an assumption and not a quotation.
 */
function breakfastHeads(party: Party): number {
  return party.adults + party.children.filter((child) => child.age >= 6).length;
}

/** The ⚑ prices this screen needs and `property-and-tariff.md` leaves unset. */
export interface TariffRates {
  readonly extraPersonPerNight: VndAmount;
  readonly breakfastPerPersonPerNight: VndAmount;
  readonly extraBedPerNight: VndAmount;
}

/**
 * Gross for one night, for one type, under one plan.
 *
 * `NONREF` discounts the room only — a 10% cut that also cut the breakfast or
 * the extra person would be discounting somebody else's cost line, and §3's
 * "`STANDARD` − 10%" is about the rate.
 */
function nightGross(
  roomGross: VndAmount,
  party: Party,
  plan: RatePlanCode,
  rates: TariffRates,
): VndAmount {
  const room = plan === "NONREF" ? (roomGross * 9n) / 10n : roomGross;
  const breakfast =
    plan === "BB"
      ? rates.breakfastPerPersonPerNight * BigInt(breakfastHeads(party))
      : 0n;

  return room + breakfast + extraPersonPerNight(party, rates);
}

/** Nights the range sells — the departure date is not one of them. */
export function stayNights(range: StayRange): number {
  return nightCount(range);
}

/** The nights of a range, as dates. Excludes the departure date. */
export function nightsInRange(range: StayRange): StayDate[] {
  const nights: StayDate[] = [];
  for (
    let night = range.checkIn;
    night.compare(range.checkOut) < 0;
    night = night.add({ days: 1 })
  ) {
    nights.push(night);
  }
  return nights;
}

/** A night's row from the calendar, by date, for the range arithmetic. */
export type NightIndex = ReadonlyMap<string, NightRate>;

export function indexNights(nights: readonly NightRate[]): NightIndex {
  return new Map(nights.map((night) => [night.date.toString(), night]));
}

/**
 * Whether a type can be sold for the whole range.
 *
 * The calendar's `isSoldOut` is property-wide — no room of any type free. A type
 * can be individually sold out on a night the property still has rooms for, so
 * this reads the per-type availability the offer carries and falls back to the
 * property-wide flag, which is the conservative direction: never offer a night
 * the property has already said is gone.
 */
function isRangeSellable(range: StayRange, nights: NightIndex): boolean {
  return nightsInRange(range).every((date) => {
    const night = nights.get(date.toString());
    return night !== undefined && !night.isSoldOut;
  });
}

export interface QuoteInput {
  readonly range: StayRange;
  readonly party: Party;
  readonly plan: RatePlanCode;
  readonly rates: TariffRates;
  /** Per-type gross room rate for each night of the range. */
  readonly roomRates: ReadonlyMap<RoomTypeCode, ReadonlyMap<string, VndAmount>>;
  readonly nights: NightIndex;
  /** Types with no room free on at least one night of the range. */
  readonly soldOutTypes: ReadonlySet<RoomTypeCode>;
}

/**
 * One offer per type, in `ROOM_TYPES` order, priced for the range.
 *
 * `perNightGross` is the average and is labelled as a per-night figure on the
 * card; `stayTotalGross` is the authoritative sum. They are computed from the
 * same un-rounded night amounts, so the card's two lines agree once each is
 * rounded for display — which is the invariant the whole file exists for.
 */
export function quoteStay(input: QuoteInput): RoomTypeOffer[] {
  const nights = nightsInRange(input.range);
  const sellable = isRangeSellable(input.range, input.nights);

  return ROOM_TYPES.map((type) => {
    const perType = input.roomRates.get(type.code);
    const total = nights.reduce<VndAmount>((sum, date) => {
      const roomGross = perType?.get(date.toString()) ?? 0n;
      return sum + nightGross(roomGross, input.party, input.plan, input.rates);
    }, 0n);

    return {
      code: type.code,
      // Integer division: the average is display-only and the total is what
      // settles, so a truncated đồng here cannot reach the folio.
      perNightGross: nights.length > 0 ? total / BigInt(nights.length) : 0n,
      stayTotalGross: total,
      isAvailable: sellable && !input.soldOutTypes.has(type.code),
      extraBedPerNightGross: type.takesExtraBed
        ? input.rates.extraBedPerNight
        : null,
    };
  });
}

/**
 * Whether a party fits a type, and what to say when it does not.
 *
 * Returns a sentence rather than a boolean because the card keeps its place in
 * the list and replaces its price block with this — hiding a type that does not
 * fit makes the guest think the hotel does not have that room.
 */
export function occupancyFit(
  type: RoomType,
  party: Party,
): { readonly fits: true } | { readonly fits: false; readonly reason: string } {
  const size = partySize(party);
  if (size <= type.maxOccupancy) return { fits: true };

  return {
    fits: false,
    reason: `Sleeps ${type.maxOccupancy}. You are ${size}.`,
  };
}

/** Whether an extra bed is a thing this party needs, on this type. */
export function needsExtraBed(type: RoomType, party: Party): boolean {
  return type.takesExtraBed && partySize(party) > type.beddingSleeps;
}

/**
 * The five types split by what the guest can actually do with them.
 *
 * With five types and forty rooms, "some of them" is the common case rather than
 * the edge — four-of-five sold out will happen far more often than zero. So it
 * gets a shape: what is takeable becomes a photograph, and what is not becomes
 * one line under a label saying why.
 *
 * **Nothing is dropped.** A guest who cannot see the Superior at all concludes
 * the hotel has no such room; a guest who sees it demoted concludes it is not
 * free this week, which is the truth. The partition is presentation over data
 * that already exists — `occupancyFit` and `offer.isAvailable` are unchanged.
 *
 * Occupancy is tested first. A type that is both too small and sold out is still
 * too small next week, so telling the guest to move their dates would be a
 * suggestion that cannot work.
 */
export interface RoomTypePartition {
  /** Free for the range and big enough for the party. These get photographs. */
  readonly takeable: readonly RoomType[];
  /** Big enough, but not free on at least one night of the range. */
  readonly soldOut: readonly RoomType[];
  /** The party does not fit, whatever the dates say. */
  readonly tooSmall: readonly RoomType[];
}

export function partitionRoomTypes(
  offers: readonly RoomTypeOffer[],
  party: Party,
): RoomTypePartition {
  const byCode = new Map(offers.map((offer) => [offer.code, offer]));

  const takeable: RoomType[] = [];
  const soldOut: RoomType[] = [];
  const tooSmall: RoomType[] = [];

  for (const type of ROOM_TYPES) {
    if (!occupancyFit(type, party).fits) {
      tooSmall.push(type);
    } else if (byCode.get(type.code)?.isAvailable === true) {
      takeable.push(type);
    } else {
      soldOut.push(type);
    }
  }

  return { takeable, soldOut, tooSmall };
}
