"use client";

// The date control. Two months, a price in every cell, three cell states, and one
// sentence that says where the guest is.
//
// Built on `@react-aria/calendar` + `@react-stately/calendar` rather than by hand.
// The keyboard model a range calendar needs — roving tabindex, arrows by day, rows
// by week, PageUp/PageDown by month, Home/End, Escape — is about four hundred
// lines of well-trodden code, and React Aria's version speaks
// `@internationalized/date`, which `packages/shared` already depends on for
// exactly the reason `tech-stack.md` gives: a stay date and an instant must not be
// the same type. What is written here is what is actually specific to this
// property: the prices, the restriction states, the copy, and the range paint.
//
// Two deliberate departures from React Aria's defaults, both evidence-led:
//
// **`role="application"` is dropped.** `useCalendarBase` puts it on the wrapper.
// Amadeus's picker does the same and it is the single worst thing about it: the
// role suppresses a screen reader's browse mode, which is exactly the mode needed
// to read a price line inside a cell. The `<table role="grid">` underneath already
// carries the interaction model, so the wrapper is a plain labelled group.
//
// **`allowsNonContiguousRanges` is on, and contiguity is enforced here instead.**
// React Aria's own version walks outward from the anchor to the first unavailable
// date and clamps selection to that run. That is right for a date picker and wrong
// for a hotel: a minimum-stay rule makes the night *after* the arrival
// unselectable, which React Aria reads as a wall one day out and would forbid the
// whole stay. `stay-availability.ts` answers the question in nights instead.

import {
  type CalendarDate,
  getLocalTimeZone,
  GregorianCalendar,
} from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayRange } from "@mariva/shared";
import { useRangeCalendar } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import { useRangeCalendarState } from "@react-stately/calendar";
import { useMemo, useRef, useState } from "react";
import { formatStayDate } from "@/features/booking/lib/booking-search";
import type { NightIndex } from "@/features/booking/lib/stay-quote";
import { MonthGrid } from "./month-grid";
import styles from "./stay-calendar.module.css";
import {
  type AvailabilityRules,
  rangeViolation,
  reasonSentence,
  unpickableReason,
} from "./stay-availability";

/** Months on screen. Two on desktop; CSS stacks them below 720px. */
const VISIBLE_MONTHS = 2;

/**
 * The only calendar system the property sells nights in.
 *
 * React Aria takes a `createCalendar` factory, and `@internationalized/date`
 * exports one that resolves any of nine systems — Buddhist, Coptic, Ethiopic,
 * Hebrew, Indian, Islamic, Japanese, Persian, Taiwan. Importing it pulls all nine
 * into the funnel's bundle, and a hotel in Ho Chi Minh City has one business date
 * per night in one calendar. Measured saving: see the note in the report.
 *
 * The `identifier` argument is ignored on purpose rather than switched on. If a
 * locale ever asks for a system this does not have, the honest failure is a
 * Gregorian grid — not a silently different set of month lengths.
 */
function gregorianOnly(): GregorianCalendar {
  return new GregorianCalendar();
}

export function StayCalendar({
  nights,
  selected,
  minDate,
  onSelect,
}: {
  readonly nights: NightIndex;
  readonly selected: StayRange | null;
  readonly minDate: CalendarDate;
  readonly onSelect: (range: StayRange | null) => void;
}) {
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);

  // The one sentence above the grid. Held in state rather than derived, because it
  // has to survive a rejected selection — a rule violation is a message about
  // something that did *not* happen, so there is no state change to derive it from.
  const [violation, setViolation] = useState<string | null>(null);

  const rules = useMemo<AvailabilityRules>(
    () => ({ nights, selected }),
    [nights, selected],
  );

  const state = useRangeCalendarState({
    locale,
    createCalendar: gregorianOnly,
    visibleDuration: { months: VISIBLE_MONTHS },
    selectionAlignment: "start",
    minValue: minDate,
    // `StayRange` names its ends checkIn/checkOut and React Aria's names them
    // start/end. Translated at this one boundary rather than by widening the
    // contract's type: a stay's two ends are an arrival and a departure, and
    // `stay-date.ts` makes the half-open convention part of what they mean.
    value: selected
      ? { start: selected.checkIn, end: selected.checkOut }
      : null,
    allowsNonContiguousRanges: true,
    isDateUnavailable: (date, anchor) =>
      unpickableReason(rules, date as CalendarDate, anchor) !== null,
    onChange: (range) => {
      if (!range) {
        setViolation(null);
        onSelect(null);
        return;
      }

      const picked: StayRange = {
        checkIn: range.start as CalendarDate,
        checkOut: range.end as CalendarDate,
      };

      // The guard the cell predicate cannot give: pressing a date inside a range
      // already chosen starts a fresh anchor against an exempted state, so the
      // committed range is checked once more as a range.
      const broken = rangeViolation(rules, picked);
      if (broken) {
        setViolation(reasonSentence(broken, formatStayDate(picked.checkIn)));
        return;
      }

      setViolation(null);
      onSelect(picked);
    },
  });

  const { calendarProps, title } = useRangeCalendar(
    { "aria-label": "Nights of your stay", minValue: minDate },
    state,
    ref,
  );

  // See the file header: the role React Aria sets here is the one thing about
  // Amadeus's picker that makes its in-cell prices unreadable.
  const { role: _application, ...groupProps } = calendarProps;

  const months = Array.from({ length: VISIBLE_MONTHS }, (_unused, index) =>
    state.visibleRange.start.add({ months: index }),
  );

  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const freeNights = months.reduce((count, month) => {
    let free = 0;
    for (let day = 1; day <= month.calendar.getDaysInMonth(month); day += 1) {
      const night = nights.get(month.set({ day }).toString());
      if (night && !night.isSoldOut) free += 1;
    }
    return count + free;
  }, 0);

  const daysShown = months.reduce(
    (count, month) => count + month.calendar.getDaysInMonth(month),
    0,
  );

  return (
    // A labelled group — and explicitly not `role="application"`, see the header.
    // biome-ignore lint/a11y/useSemanticElements: `<fieldset>` is Biome's suggestion and it is wrong here — this groups a grid, not form controls, and a fieldset would want a legend the caption already provides.
    <div {...groupProps} className={styles.calendar} ref={ref} role="group">
      <div className={styles.header}>
        <p className={styles.status} role="status">
          {violation ?? selectionSentence(state, selected)}
        </p>

        <div className={styles.navigation}>
          <button
            aria-label="Earlier months"
            className={styles.navButton}
            disabled={state.isPreviousVisibleRangeInvalid()}
            onClick={() => {
              setViolation(null);
              state.focusPreviousPage();
            }}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Later months"
            className={styles.navButton}
            disabled={state.isNextVisibleRangeInvalid()}
            onClick={() => {
              setViolation(null);
              state.focusNextPage();
            }}
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      {/* The visible range, for a sighted guest. React Aria announces the same
          thing to a screen reader on every page change, so this is not a live
          region — two announcements of one month change is worse than one. */}
      <p className={`${styles.visibleRange} caps-label`}>
        {title} · {freeNights} of {daysShown} nights free
      </p>

      <div className={styles.months}>
        {months.map((month) => (
          <MonthGrid
            caption={monthFormatter.format(month.toDate("UTC"))}
            key={month.toString()}
            nights={nights}
            rules={rules}
            startDate={month}
            state={state}
          />
        ))}
      </div>

      <ul className={styles.legend}>
        <li className={styles.legendFree}>
          Free — price is per night, in thousands of đồng
        </li>
        <li className={styles.legendSoldOut}>Sold out</li>
        <li className={styles.legendClosed}>Arrival closed</li>
      </ul>

      {/* Trainline renders its keyboard hint as visible text rather than hiding it,
          and it is right to: a sighted keyboard user needs it as much as a screen
          reader user, and a visually-hidden hint reaches only one of the two. */}
      <p className={`${styles.hint} caps-label`}>
        Cursor keys move by day, Page Up and Page Down by month
      </p>

      <p className={styles.timezoneNote}>
        Dates are the property's own, in {readableZone(PROPERTY_TIME_ZONE)}
        {timeZoneAside()}
      </p>
    </div>
  );
}

/**
 * Where the guest is, as a whole sentence.
 *
 * `role="status"` rather than a bare `aria-live` on a fragment: the region is
 * atomic, so it is read as one sentence rather than as a diff. It never fires on
 * hover — a hover-driven live region announces continuously and is worse than
 * silence, which is the mistake that makes most custom calendars unusable.
 */
function selectionSentence(
  state: ReturnType<typeof useRangeCalendarState>,
  selected: StayRange | null,
): string {
  if (state.anchorDate) {
    return `${formatStayDate(state.anchorDate)}. Now choose the night you leave.`;
  }
  if (selected) {
    const nights = selected.checkOut.compare(selected.checkIn);
    return `${formatStayDate(selected.checkIn)} to ${formatStayDate(
      selected.checkOut,
    )}. ${nights === 1 ? "One night" : `${nights} nights`}.`;
  }
  return "Choose the night you arrive.";
}

/**
 * The clock the guest is reading on, when it is not the property's.
 *
 * cal.com names the timezone next to the duration it governs, and a resort in
 * Vietnam sells to Seoul and Singapore. Said only when the two differ, because
 * telling a guest in Ho Chi Minh City which timezone they are in is noise.
 */
function timeZoneAside(): string {
  const here = getLocalTimeZone();
  return here === PROPERTY_TIME_ZONE ? "." : ` — not ${readableZone(here)}.`;
}

/**
 * An IANA zone as prose.
 *
 * `replaceAll`, not `replace`: "Asia/Ho_Chi_Minh" has two underscores, and the
 * single-shot version put "Asia/Ho Chi_Minh" on the page.
 */
function readableZone(zone: string): string {
  return zone.replaceAll("_", " ");
}
