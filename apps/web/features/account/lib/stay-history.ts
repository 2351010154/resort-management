// The order a guest reads their own stays in, and what each one is called.
//
// **Upcoming first, then past in reverse.** `screens.md` §Account: the upcoming
// ones are the stays a guest can still act on, so they are at the top and run
// forwards — the next arrival is the first thing on the page. What is behind
// them runs backwards, because the stay a guest is most likely to be looking for
// is the one they just took.
//
// The API answers `GET /bookings/mine` newest-arrival-first for every state at
// once, which is one order and cannot be both of these. So the split is made
// here, on the client, where the two groups are also drawn — and it is a pure
// function over dates and states rather than a sort inside the list, because the
// boundary between "upcoming" and "past" is the one thing on this screen that is
// worth a test.
//
// **Dates compare as text.** `YYYY-MM-DD` sorts lexicographically in calendar
// order, so no parsing is needed and none is done — a `Date` here would be an
// instant, and an instant is what a stay date is deliberately not
// (`stay-date.ts`). Today has to be the property's own date rather than the
// browser's, which is the caller's to supply: a guest reading this in Auckland
// must see the same two groups as one reading it in Lisbon.

import type { BookingState } from "@mariva/shared";

/** The three facts this file reads off a stay. Anything else travels with it. */
export interface StayFacts {
  readonly state: BookingState;
  readonly checkIn: string;
  readonly checkOut: string;
}

/** What a stay is called, and the tone it is drawn in. */
export interface StayStanding {
  readonly label: string;
  readonly tone: "ahead" | "present" | "done" | "off";
}

/**
 * The states that are over whatever their dates say.
 *
 * A cancelled stay next month is not upcoming — there is nothing left to act on
 * — and a no-show is a past arrival that happened to be missed. Both are facts
 * about the record rather than about the calendar, which is why they are read
 * before the dates are.
 */
const SETTLED: readonly BookingState[] = [
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
];

/**
 * What each state is called on a card.
 *
 * `screens.md` names three — upcoming, completed, cancelled — and two states it
 * does not name would have to borrow one of those to be drawn at all. A stay the
 * guest is standing in is not "upcoming" and a no-show is neither completed nor
 * cancelled, so each keeps its own word: a badge is a statement about somebody's
 * record, and a wrong one is worse than a longer vocabulary.
 *
 * A hold reads as upcoming because that is what it is — a stay not yet taken —
 * and the sentence about the payment still owing belongs on the stay's own
 * screen, which is where the guest can do something about it.
 */
const STANDINGS: Readonly<Record<BookingState, StayStanding>> = {
  HELD: { label: "Upcoming", tone: "ahead" },
  CONFIRMED: { label: "Upcoming", tone: "ahead" },
  CHECKED_IN: { label: "In stay", tone: "present" },
  CHECKED_OUT: { label: "Completed", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "off" },
  NO_SHOW: { label: "No-show", tone: "off" },
};

export function standingOf(state: BookingState): StayStanding {
  return STANDINGS[state];
}

/**
 * Whether a stay is still ahead of the guest.
 *
 * Measured on the departure date and not the arrival, under the half-open
 * convention `[checkIn, checkOut)`: a guest who arrived yesterday and leaves
 * tomorrow is in the middle of a stay, and a list that filed it under "past"
 * would be telling them their current stay is over. The departure date itself
 * counts as ahead — they are still in the room on the morning they leave.
 */
export function isAhead(stay: StayFacts, today: string): boolean {
  return !SETTLED.includes(stay.state) && stay.checkOut >= today;
}

export interface StayHistory<T> {
  readonly upcoming: readonly T[];
  readonly past: readonly T[];
}

/**
 * The stays as the screen draws them: what is coming, then what has been.
 *
 * Ties are broken on the departure and then on the reference, so two stays
 * arriving the same day keep one order between renders. Nothing is dropped —
 * cancelled and expired stays are in the list because they happened to this
 * account, and a history that silently removed them would answer "where did my
 * booking go?" with nothing at all.
 */
export function stayHistory<
  T extends StayFacts & { readonly reference: string },
>(stays: readonly T[], today: string): StayHistory<T> {
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const stay of stays) {
    (isAhead(stay, today) ? upcoming : past).push(stay);
  }

  upcoming.sort((a, b) => order(a, b));
  past.sort((a, b) => order(b, a));

  return { upcoming, past };
}

/** Ascending by arrival, then departure, then reference. */
function order(
  a: StayFacts & { reference: string },
  b: StayFacts & { reference: string },
): number {
  if (a.checkIn !== b.checkIn) {
    return a.checkIn < b.checkIn ? -1 : 1;
  }

  if (a.checkOut !== b.checkOut) {
    return a.checkOut < b.checkOut ? -1 : 1;
  }

  return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
}
