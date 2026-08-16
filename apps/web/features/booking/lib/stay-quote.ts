// What the funnel makes of an offer once the API has priced it: the nights a
// range sells, the nights of the window by date, whether a party fits a type,
// and how the five types are split across the room list.
//
// **No price is computed here any more, and the absence is the whole point.**
// This file used to hold §3's plan arithmetic — the percentage, the breakfast
// line, the extra-person band — because the funnel was quoting against a
// stand-in tariff while the read procedures did not exist. They do:
// `availability.ts` asks for the offers and `@mariva/shared`'s `stayTotalGross`
// is the one place the arithmetic lives, applied by the API against rows a
// manager edits and by the same function at the moment of sale. A second copy in
// the browser is a card and an invoice free to disagree.
//
// Nothing in this file rounds either. The one function that does is
// `roundVndForDisplay` in `@mariva/shared`, called by the components that render
// — because a total is the rounded sum of the nights and never the sum of the
// rounded nights, and the only way to keep that true is to have no rounding
// anywhere upstream of the text.

import {
  type NightRate,
  nightCount,
  type Party,
  partySize,
  type RoomTypeOffer,
  type StayDate,
  type StayRange,
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

// There is no `needsExtraBed` here any more, and its absence is deliberate.
// §1's rule counts the heads that need their own bedding — an under-6 shares
// existing bedding and does not — so a version reading `partySize` would put a
// bed in for a four-year-old. The rule is `bedsRequired` in `@mariva/shared`,
// beside the bands the API prices against, because a bed rule written twice is
// a card and a folio free to disagree about whether one is in the room. Nothing
// on this screen asks it: the guest is not offered a bed and is not charged for
// one, and the room's plate states the bed as a fact about the type.

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
