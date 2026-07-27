"use client";

// One month, as a real table.
//
// `<table role="grid">` with a `<caption>` naming the month, `<th scope="col">`
// weekday heads, and a `<button>` inside every `<td>`. Trainline is the one picker
// verified for this screen that does this, and it is the one whose state survives
// contact with a screen reader — Amadeus ships `<span>`s inside `role="application"`
// and reports `tables: 0`, Limehome ships `div.ngb-dp-day` with `aria-label="1 - 7 - 2026"`,
// Aman ships a custom element with no accessible name at all.
//
// Two months means two tables, not one wide one. Each gets its own caption, so a
// guest arrowing from 31 August to 1 September crosses a boundary that is
// announced rather than one that is only visible.

import type { CalendarDate } from "@internationalized/date";
import type { NightIndex } from "@/features/booking/lib/stay-quote";
import type { RangeCalendarState } from "@react-stately/calendar";
import { useCalendarGrid } from "@react-aria/calendar";
import { DayCell } from "./day-cell";
import styles from "./stay-calendar.module.css";
import type { AvailabilityRules } from "./stay-availability";

export function MonthGrid({
  state,
  startDate,
  nights,
  rules,
  caption,
}: {
  readonly state: RangeCalendarState;
  readonly startDate: CalendarDate;
  readonly nights: NightIndex;
  readonly rules: AvailabilityRules;
  readonly caption: string;
}) {
  const { gridProps, headerProps, weekDays } = useCalendarGrid(
    { startDate, endDate: startDate.add({ months: 1 }).subtract({ days: 1 }) },
    state,
  );

  // Resolved up front so each row can be keyed by a date it actually contains,
  // rather than by its ordinal in the month — a week is identified by the days in
  // it, and paging the calendar replaces the days while the ordinals stay 0..5.
  const weeks = Array.from(
    { length: state.getWeeksInMonth(startDate) },
    (_unused, week) => state.getDatesInWeek(week, startDate),
  );

  return (
    <table {...gridProps} className={styles.month}>
      <caption className={`${styles.monthCaption} caps-label`}>
        {caption}
      </caption>
      <thead {...headerProps}>
        <tr>
          {/* The weekday heads are hidden from assistive tech by React Aria,
              because each cell's own name already carries its weekday — reading
              the column head as well says "Monday" twice for every cell.

              Keyed by position, because position is what a weekday head *is*: the
              narrow style repeats letters ("S" for both Saturday and Sunday), so
              the label is not unique and the column index is the only identity
              available. */}
          {weekDays.map((day, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the identity — seven fixed positions that never reorder, with labels that are not unique.
            <th className={styles.weekday} key={index} scope="col">
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((dates) => (
          <tr key={dates.find(Boolean)?.toString() ?? ""}>
            {dates.map((date, index) =>
              date ? (
                <DayCell
                  date={date}
                  isOutsideMonth={date.month !== startDate.month}
                  key={date.toString()}
                  night={nights.get(date.toString())}
                  rules={rules}
                  state={state}
                />
              ) : (
                // A date the calendar system does not have. Never happens in the
                // Gregorian calendar, and React Aria's contract allows for it.
                // biome-ignore lint/suspicious/noArrayIndexKey: a hole in a week has no date to key on, and its position in the row is its identity.
                <td className={styles.cellOutside} key={index} />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
