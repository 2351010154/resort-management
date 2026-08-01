// Which dates a guest may pick, and what the cell has to say about the ones they
// may not.
//
// This is the whole rule layer of the calendar, kept out of the component so it
// can be read — and so the two states that matter can be stated once each rather
// than re-derived in the cell, the predicate and the live region.
//
// The shape it has to fit is `isDateUnavailable(date, anchorDate)`, React Aria's
// hook for exactly this. The second argument is what makes a hotel calendar
// possible: the rules for "may I arrive here" and "may I leave here" are
// different rules, and before an anchor exists only the first one applies.

import type { CalendarDate } from "@internationalized/date";
import type { NightRate, StayRange } from "@mariva/shared";
import type { NightIndex } from "@/features/booking/lib/stay-quote";

/** Why a date cannot be picked. `null` means it can. */
export type UnpickableReason =
  | { readonly kind: "sold-out" }
  | { readonly kind: "closed-to-arrival" }
  | { readonly kind: "minimum-stay"; readonly nights: number }
  | { readonly kind: "before-arrival" }
  | { readonly kind: "no-data" };

export interface AvailabilityRules {
  readonly nights: NightIndex;
  /** The range already chosen, if any. Controlled by the URL. */
  readonly selected: StayRange | null;
}

function nightAt(
  rules: AvailabilityRules,
  date: CalendarDate,
): NightRate | undefined {
  return rules.nights.get(date.toString());
}

function nightsBetween(from: CalendarDate, to: CalendarDate): number {
  return to.compare(from);
}

/**
 * Why `date` cannot be picked, given where the guest is in the selection.
 *
 * `anchor` is the arrival they have already clicked, or `null` while they are
 * still choosing one. The two branches are genuinely different questions:
 *
 * - **No anchor — "may a stay begin here?"** Sold out, or closed to arrival.
 *   Amadeus proves the second one has to be its own named state rather than a
 *   generic unavailability, because a guest who reads "check-out only" learns the
 *   rule and a guest who reads "unavailable" only learns they were blocked.
 *
 * - **Anchored — "may a stay that began on the anchor end here?"** Not before the
 *   arrival, not shorter than that arrival's minimum, and no sold-out night in
 *   between. The arrival itself is the exception, and see below for why.
 *
 * The departure date is deliberately exempt from the night-level flags. A
 * departure buys no night — `stay-date.ts`'s half-open range is the same fact —
 * so whether a room is free on the morning the guest leaves is not a question
 * about their stay. Getting this wrong is the off-by-one that puts three filled
 * boxes on a two-night stay.
 */
export function unpickableReason(
  rules: AvailabilityRules,
  date: CalendarDate,
  anchor: CalendarDate | null,
): UnpickableReason | null {
  if (anchor) {
    // **The arrival stays pickable while it is the anchor, and that is the way
    // out of a half-made selection.** React Aria will not press a cell this
    // function calls unavailable — `useCalendarCell` passes `isSelectable` to
    // `usePress` as `isDisabled` — so calling the anchor unavailable did not
    // merely grey it. It sealed the only exit: a guest who pressed the wrong day
    // could not press it again, and could not press any earlier day either,
    // because every date before the anchor is unavailable too. The one way back
    // was the Escape key, which is not an affordance anybody can see.
    //
    // So the anchor answers "may a stay end here?" with yes, and the nought-night
    // range that press produces is read by `stay-calendar.tsx` as "start over".
    if (date.compare(anchor) === 0) return null;
    if (date.compare(anchor) < 0) return { kind: "before-arrival" };

    const arrival = nightAt(rules, anchor);
    const wanted = nightsBetween(anchor, date);
    if (arrival && wanted < arrival.minimumStay) {
      return { kind: "minimum-stay", nights: arrival.minimumStay };
    }

    // Every night the stay would sell, which is [anchor, date) — the departure
    // date itself is not one of them.
    for (let offset = 0; offset < wanted; offset += 1) {
      const each = nightAt(rules, anchor.add({ days: offset }));
      if (!each) return { kind: "no-data" };
      if (each.isSoldOut) return { kind: "sold-out" };
    }
    return null;
  }

  // No anchor. One exception first: the departure of the range already chosen is
  // not being bought as a night, so no night-level flag disqualifies it. Without
  // this, a stay whose departure morning happens to be sold out is reported by
  // React Aria as an invalid selection — `aria-invalid` on a range that is
  // perfectly legal.
  if (rules.selected && date.compare(rules.selected.checkOut) === 0)
    return null;

  const night = nightAt(rules, date);
  if (!night) return { kind: "no-data" };
  if (night.isSoldOut) return { kind: "sold-out" };
  if (night.isClosedToArrival) return { kind: "closed-to-arrival" };
  return null;
}

/**
 * The reason, as the sentence appended to the cell's accessible name.
 *
 * This is the improvement over every picker verified for this screen: Amadeus
 * renders "Check-out only" as pixels and gives the screen reader the date alone;
 * Resy gives a sold-out day the same name as a free one. A reason a sighted guest
 * can see is a reason that belongs in the name.
 */
export function reasonSentence(
  reason: UnpickableReason,
  arrival?: string,
): string {
  switch (reason.kind) {
    case "sold-out":
      return "Not free.";
    case "closed-to-arrival":
      return "Arrival closed — you cannot start a stay on this date.";
    case "minimum-stay":
      return arrival
        ? `${reason.nights}-night minimum from ${arrival}.`
        : `${reason.nights}-night minimum.`;
    case "before-arrival":
      return "Before the night you arrive.";
    case "no-data":
      return "Not yet priced.";
  }
}

/**
 * Whether the whole selected range can actually be sold.
 *
 * A guard rather than a display concern. The predicate above stops a guest
 * clicking their way to an illegal stay, but it is anchor-shaped and there is one
 * path around it — pressing a date inside a range already chosen starts a *new*
 * anchor, and the arrival rules for that press are checked against a state the
 * predicate has already exempted. So the committed range is validated once more
 * here, where the answer is about the range rather than about a cell.
 */
export function rangeViolation(
  rules: AvailabilityRules,
  range: StayRange,
): UnpickableReason | null {
  const arrival = nightAt(rules, range.checkIn);
  if (!arrival) return { kind: "no-data" };
  if (arrival.isSoldOut) return { kind: "sold-out" };
  if (arrival.isClosedToArrival) return { kind: "closed-to-arrival" };

  const wanted = nightsBetween(range.checkIn, range.checkOut);
  if (wanted < arrival.minimumStay) {
    return { kind: "minimum-stay", nights: arrival.minimumStay };
  }

  for (let offset = 0; offset < wanted; offset += 1) {
    const each = nightAt(rules, range.checkIn.add({ days: offset }));
    if (!each) return { kind: "no-data" };
    if (each.isSoldOut) return { kind: "sold-out" };
  }
  return null;
}
