"use client";

// One night. A day number, and a name that says everything the pixels say.
//
// **The price has gone out of the cell.** It used to sit under every number —
// Amadeus does that, and it is the only way to answer "which nights are cheap"
// without a second control, which is why it was here. What it cost was sixty-one
// figures on a screen whose whole job is to be read at a glance, and at two
// months wide that reads as a spreadsheet rather than a calendar. The rate is
// stated where a guest is deciding on it: in the stay panel, and on the room
// cards. The trade is real and it is deliberate — a guest can no longer scan a
// month for a cheap night.
//
// Two things here are corrections to pickers verified for this screen rather
// than inventions, and both survive:
//
// 1. **`aria-disabled`, never `disabled`.** React Aria draws the distinction for
//    us: a date failing `minValue` is `isDisabled` and drops out of the tab
//    order, which is right for a date in the past — there is nothing to explain.
//    A date failing `isDateUnavailable` is `isUnavailable`, stays focusable, and
//    carries `aria-disabled`. cal.com uses a real `disabled` for its unavailable
//    days, so a keyboard user cannot land on them and never learns why they are
//    gone.
//
// 2. **The reason is in the accessible name.** React Aria's own label is the date
//    and its selection state; the restriction is appended here, because that is
//    the failure shared by every picker probed — Resy's sold-out days carry
//    exactly the same name as its free ones. The price is no longer appended, for
//    the reason above: a name should say what the cell says.

import type { CalendarDate } from "@internationalized/date";
import { useCalendarCell } from "@react-aria/calendar";
import type { RangeCalendarState } from "@react-stately/calendar";
import { useRef } from "react";
import { formatStayDate } from "@/features/booking/lib/booking-search";
import {
  type AvailabilityRules,
  reasonSentence,
  unpickableReason,
} from "./stay-availability";
import styles from "./stay-calendar.module.css";

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
  rules,
  isOutsideMonth,
  onPress,
}: {
  readonly state: RangeCalendarState;
  readonly date: CalendarDate;
  readonly rules: AvailabilityRules;
  readonly isOutsideMonth: boolean;
  /** Runs after React Aria's own press handler, never instead of it. */
  readonly onPress: (date: CalendarDate) => void;
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
    isFocused ? styles.dayFocused : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Why the night cannot be taken, after React Aria's date.
  //
  // A past date gets nothing. It is `isDisabled` rather than merely unpickable, and
  // the argument for putting a reason in the name is that the guest can act on it —
  // nobody can act on last Tuesday.
  const reasonText =
    reason && !isDisabled
      ? reasonSentence(
          reason,
          state.anchorDate ? formatStayDate(state.anchorDate) : undefined,
        )
      : "";

  // The way out of a chosen stay, said on the cell that is the way out. It costs
  // the screen nothing — the status line carries the same sentence for a sighted
  // guest — and without it the affordance is invisible to anyone who cannot see the
  // filled disc they would be pressing again.
  const undoText =
    position === "start" && state.value ? "Press again to start over." : "";

  const label = [buttonProps["aria-label"], reasonText, undoText]
    .filter(Boolean)
    .join(" ");

  return (
    <td {...cellProps} className={cellClass}>
      {/* `data-date` is the night this cell sells, in the property's own
          calendar. It is here so a test can pick a stay the way a guest does —
          by pressing two days — rather than by matching a locale-formatted
          accessible name, which changes shape with the locale and would make the
          harness the thing under test. */}
      <button
        {...buttonProps}
        aria-label={label}
        className={buttonClass}
        data-date={date.toString()}
        // Composed, not overridden. React Aria's own handler runs first and does
        // what it does — set an anchor, commit a range — and `stay-calendar.tsx`
        // then decides whether this particular press meant "start over". Spreading
        // `buttonProps` after this would silently drop one of the two.
        //
        // **Both paths, because React Aria does not give one.** Its press hook
        // handles Enter and Space inside `onKeyDown` and calls `preventDefault`, so
        // the browser never synthesises the click a keyboard press would normally
        // produce — hooking `onClick` alone made this work with a mouse and do
        // nothing at all from the keyboard. Verified: `buttonProps` carries
        // `onKeyDown` and no `onKeyUp`, which is why the key test is here.
        onClick={(event) => {
          buttonProps.onClick?.(event);
          onPress(date);
        }}
        onKeyDown={(event) => {
          buttonProps.onKeyDown?.(event);
          if (event.key === "Enter" || event.key === " ") onPress(date);
        }}
        ref={ref}
        type="button"
      >
        {/* The number carries the disc. Hover, focus and the two ends of the stay
            are all a round ground behind this span rather than a fill of the whole
            cell — a 58 × 48 cell filled edge to edge reads as a block of colour,
            and the shape a chosen date wants is the shape of the number. */}
        <span className={styles.dayNumber}>{formattedDate}</span>
      </button>
    </td>
  );
}
