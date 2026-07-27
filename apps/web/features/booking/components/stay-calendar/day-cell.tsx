"use client";

// One night. A day number, a price under it, and a name that says everything the
// pixels say.
//
// Three things here are corrections to pickers verified for this screen rather
// than inventions:
//
// 1. **The price lives inside the button.** Not beside it, not in a title
//    attribute. Amadeus puts the per-night rate in the cell and it is the only
//    way to answer "which nights are cheap" without a second control; putting it
//    outside the button would shrink the hit area below the 44 px floor.
//
// 2. **`aria-disabled`, never `disabled`.** React Aria draws the distinction for
//    us: a date failing `minValue` is `isDisabled` and drops out of the tab
//    order, which is right for a date in the past — there is nothing to explain.
//    A date failing `isDateUnavailable` is `isUnavailable`, stays focusable, and
//    carries `aria-disabled`. cal.com uses a real `disabled` for its unavailable
//    days, so a keyboard user cannot land on them and never learns why they are
//    gone.
//
// 3. **The reason is in the accessible name.** React Aria's own label is the date
//    and its selection state. The price and the restriction are appended here,
//    because that is the failure shared by every picker probed: Amadeus's label is
//    date-only while the cell shows a price and a rule, and Resy's sold-out days
//    carry exactly the same name as its free ones.

import type { CalendarDate } from "@internationalized/date";
import { formatVndThousands, type NightRate } from "@mariva/shared";
import type { RangeCalendarState } from "@react-stately/calendar";
import { useRef } from "react";
import { useCalendarCell } from "@react-aria/calendar";
import { formatStayDate } from "@/features/booking/lib/booking-search";
import styles from "./stay-calendar.module.css";
import {
  type AvailabilityRules,
  reasonSentence,
  unpickableReason,
} from "./stay-availability";

/** Where a date sits in the range being painted. */
type RangePosition = "none" | "start" | "inside" | "end" | "single";

function rangePosition(
  state: RangeCalendarState,
  date: CalendarDate,
): RangePosition {
  const range = state.highlightedRange;
  if (!range) return "none";
  if (date.compare(range.start) < 0 || date.compare(range.end) > 0)
    return "none";

  const isStart = date.compare(range.start) === 0;
  const isEnd = date.compare(range.end) === 0;
  if (isStart && isEnd) return "single";
  if (isStart) return "start";
  if (isEnd) return "end";
  return "inside";
}

export function DayCell({
  state,
  date,
  night,
  rules,
  isOutsideMonth,
}: {
  readonly state: RangeCalendarState;
  readonly date: CalendarDate;
  readonly night: NightRate | undefined;
  readonly rules: AvailabilityRules;
  readonly isOutsideMonth: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const {
    cellProps,
    buttonProps,
    formattedDate,
    isDisabled,
    isUnavailable,
    isFocused,
  } = useCalendarCell({ date, isOutsideMonth }, state, ref);

  // A day belonging to the neighbouring month. Rendered as an empty cell rather
  // than as a greyed number: with two months side by side, a trailing 1st in
  // August's grid sitting next to September's own 1st is two of the same date on
  // screen, and the guest has to work out which one is real.
  if (isOutsideMonth) {
    return <td className={styles.cellOutside} aria-hidden="true" />;
  }

  const reason = unpickableReason(rules, date, state.anchorDate);
  const position = rangePosition(state, date);
  const isAnchor = state.anchorDate?.compare(date) === 0;

  // The range paint. Driven from `highlightedRange` rather than from React Aria's
  // `isSelected`, which excludes any night the predicate calls unavailable — a
  // stay running through a closed-to-arrival night would otherwise paint with a
  // hole in it. The paint is a pseudo-element on this `<td>`, never a focusable
  // element of its own, and it bridges from the middle of the arrival cell to the
  // middle of the departure cell so a two-night stay shows two filled gaps rather
  // than three filled boxes.
  const cellClass = [
    styles.cell,
    position !== "none" ? styles[`range_${position}`] : "",
    isAnchor ? styles.cellAnchor : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buttonClass = [
    styles.day,
    isDisabled ? styles.dayPast : "",
    isUnavailable ? styles.dayUnpickable : "",
    reason?.kind === "sold-out" ? styles.daySoldOut : "",
    reason?.kind === "closed-to-arrival" ? styles.dayClosedToArrival : "",
    position === "start" || position === "single" ? styles.dayArrival : "",
    position === "end" ? styles.dayDeparture : "",
    position === "inside" ? styles.dayInside : "",
    isFocused ? styles.dayFocused : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Everything the cell shows, in one sentence, after React Aria's date.
  //
  // A past date gets neither. It is `isDisabled` rather than merely unpickable, and
  // the report's argument for putting a reason in the name is that the guest can act
  // on it — nobody can act on last Tuesday, and "Not yet priced." on a date before
  // today reads as a fault in the page rather than as a fact about the property.
  const priceSentence =
    !isDisabled && night?.lowestGross != null
      ? `From ${formatVndThousands(night.lowestGross)} thousand đồng.`
      : "";
  const reasonText =
    reason && !isDisabled
      ? reasonSentence(
          reason,
          state.anchorDate ? formatStayDate(state.anchorDate) : undefined,
        )
      : "";
  const label = [buttonProps["aria-label"], priceSentence, reasonText]
    .filter(Boolean)
    .join(" ");

  return (
    <td {...cellProps} className={cellClass}>
      <button
        {...buttonProps}
        aria-label={label}
        className={buttonClass}
        ref={ref}
        type="button"
      >
        <span className={styles.dayNumber}>{formattedDate}</span>
        {/* Sold-out nights carry no price, because a price on a night nobody can
            buy is noise. The slot is still rendered so the cells keep one height
            and the grid does not reflow row by row as availability changes. */}
        <span className={styles.dayPrice} aria-hidden="true">
          {night?.lowestGross != null
            ? formatVndThousands(night.lowestGross)
            : ""}
        </span>
      </button>
    </td>
  );
}
