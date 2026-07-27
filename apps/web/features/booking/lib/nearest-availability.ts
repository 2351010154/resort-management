// "The next availability for 2 is Tue., Aug. 25."
//
// Resy's second move, and the one that decides whether a full property loses the
// booking or moves it. A no-availability page that says only "nothing free" hands
// the guest back to a search engine; one that names the nearest date that works
// keeps them. The detail that makes it work is that the offer is parameterised by
// the *same party* — a generic "try other dates" is not the same feature.
//
// Local because it has to be: this query does not exist on the API, and the
// report specifying this screen flags it as the load-bearing one. It scans the
// nights the calendar already has, so it costs nothing and cannot be wrong about
// data the grid is not showing.

import type { NightRate, StayRange } from "@mariva/shared";
import type { NightIndex } from "./stay-quote";

/** How far past the requested arrival to look. Two months of nights, at most. */
const SEARCH_DAYS = 60;

function night(nights: NightIndex, iso: string): NightRate | undefined {
  return nights.get(iso);
}

/**
 * Whether a stay of `wanted` nights can begin on `start`.
 *
 * Three rules, and all three are the night's own, not the booking attempt's:
 * every night of the stay has a room free, the arrival night is not closed to
 * arrival, and the stay is at least as long as that night's minimum.
 */
function canBegin(
  nights: NightIndex,
  start: StayRange["checkIn"],
  wanted: number,
): boolean {
  const first = night(nights, start.toString());
  if (!first || first.isSoldOut || first.isClosedToArrival) return false;
  if (wanted < first.minimumStay) return false;

  for (let offset = 0; offset < wanted; offset += 1) {
    const each = night(nights, start.add({ days: offset }).toString());
    if (!each || each.isSoldOut) return false;
  }
  return true;
}

/** The soonest stay of exactly `wanted` nights that can be sold, at or after `from`. */
export function nextFreeRange(
  nights: NightIndex,
  from: StayRange["checkIn"],
  wanted: number,
): StayRange | null {
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const checkIn = from.add({ days: offset });
    if (canBegin(nights, checkIn, wanted)) {
      return { checkIn, checkOut: checkIn.add({ days: wanted }) };
    }
  }
  return null;
}

/**
 * The longest stay that can begin on the date the guest actually asked for.
 *
 * Offered before the nearest-other-dates alternative, because a guest who wanted
 * three nights from the tenth and can have two is closer to booked than one who
 * has to move the whole trip. Returns null when even one night is impossible.
 */
export function longestFreeRangeFrom(
  nights: NightIndex,
  checkIn: StayRange["checkIn"],
  wanted: number,
): StayRange | null {
  for (let length = wanted - 1; length >= 1; length -= 1) {
    if (canBegin(nights, checkIn, length)) {
      return { checkIn, checkOut: checkIn.add({ days: length }) };
    }
  }
  return null;
}

export interface Alternative {
  readonly range: StayRange;
  /** Why this one is being offered, in the house voice. */
  readonly label: string;
}

/**
 * What to offer when the requested range cannot be sold, best first.
 *
 * At most two ranges. A list of every near-miss is a puzzle, not an offer — the
 * shape that works is "here is the closest thing, here is one compromise", and
 * then the waitlist for everyone the two do not suit.
 */
export function alternatives(
  nights: NightIndex,
  requested: StayRange,
  wantedNights: number,
): Alternative[] {
  const found: Alternative[] = [];

  const shorter = longestFreeRangeFrom(nights, requested.checkIn, wantedNights);
  if (shorter) {
    const length = wantedNights - 1;
    found.push({
      range: shorter,
      label:
        length === 1
          ? "One night, from the day you wanted."
          : `${length} nights, from the day you wanted.`,
    });
  }

  const moved = nextFreeRange(
    nights,
    requested.checkIn.add({ days: 1 }),
    wantedNights,
  );
  if (moved) {
    found.push({
      range: moved,
      label: `The next ${wantedNights === 1 ? "night" : `${wantedNights} nights`} free.`,
    });
  }

  return found;
}
