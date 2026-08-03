// Turning a range, a party and a plan into the two numbers on a card.
//
// Every rule here is `docs/architecture/property-and-tariff.md`: §3 for the plan
// arithmetic, §5 for gross display and for rounding being presentation-only.
// §3's child bands are applied here but no longer written here — see below.
// Nothing in this file rounds. The one function that does is
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
  breakfastHeads,
  extraPersonPerNight,
  type NightRate,
  nightCount,
  type Party,
  partySize,
  type RatePlanCode,
  type RoomTypeCode,
  type RoomTypeOffer,
  type StayDate,
  type StayRange,
  type VndAmount,
} from "@mariva/shared";
import { ROOM_TYPES, type RoomType } from "./room-types";

// The party type and §3's age bands come from `@mariva/shared` rather than from
// this file. They used to live here, which was defensible while the screen was
// the only thing that priced them; the API prices them now, and a band written
// twice is a card and an invoice free to disagree by one half-rate head.
//
// Re-exported under the names this feature already imports, so the screen goes
// on asking `stay-quote` for its party the way it always has.
export type { Child, Party } from "@mariva/shared";
export { partySize };

/**
 * The ⚑ prices this screen quotes against while it runs on a fixture.
 *
 * The property now stores two of the three — the extra person in
 * `property_tariff`, breakfast on `rate_plan` — and the quote endpoint applies
 * both. This interface is what the fixture supplies until the funnel reads that
 * endpoint, at which point it goes with the fixture. The extra bed is the one
 * figure nothing on the server will supply, because §9 has not decided when it
 * is charged.
 */
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

  return (
    room + breakfast + extraPersonPerNight(party, rates.extraPersonPerNight)
  );
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
