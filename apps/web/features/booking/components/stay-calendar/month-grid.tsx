"use client";

// One month, as a real table, with its own pager on the caption line.
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
//
// **The pager sits beside the caption, and outside the table.** It was a pair of
// bordered buttons in the calendar's header, a thousand pixels from the month they
// paged — which read as two stray controls. On the caption line it reads as what
// it is: this month, and the way to the one before or after it. Outside the
// `<table>` because a button inside `<caption>` joins the table's accessible
// name, and "August 2026 Earlier months" is not the name of a grid.

import type { CalendarDate } from "@internationalized/date";
import { useCalendarGrid } from "@react-aria/calendar";
import type { RangeCalendarState } from "@react-stately/calendar";
import { DayCell } from "./day-cell";
import type { AvailabilityRules } from "./stay-availability";
import styles from "./stay-calendar.module.css";

export function MonthGrid({
  state,
  startDate,
  rules,
  caption,
  pager,
  onDayPress,
}: {
  readonly state: RangeCalendarState;
  readonly startDate: CalendarDate;
  readonly rules: AvailabilityRules;
  readonly caption: string;
  /** Runs after React Aria's own press. See `stay-calendar.tsx`. */
  readonly onDayPress: (date: CalendarDate) => void;
  /** The one page control this month carries, if it carries either. */
  readonly pager: {
    readonly label: string;
    readonly glyph: string;
    readonly isDisabled: boolean;
    readonly onPress: () => void;
  } | null;
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
    <div className={styles.monthBlock}>
      {pager ? (
        <button
          aria-label={pager.label}
          className={styles.pager}
          data-side={pager.glyph === "‹" ? "start" : "end"}
          disabled={pager.isDisabled}
          onClick={pager.onPress}
          type="button"
        >
          {pager.glyph}
        </button>
      ) : null}

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
                    onPress={onDayPress}
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
    </div>
  );
}
