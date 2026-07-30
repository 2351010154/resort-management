"use client";

// The date control. Two months, three cell states, and one sentence that says
// where the guest is.
//
// **The prices have left the cells and most of the small print has left the
// screen.** Both were here for good reasons — see `day-cell.tsx` for the price and
// the foot of this file for the rest — and both were costing the control the thing
// it exists for, which is being read in one look. Sixty-one figures and four lines
// of qualification make a spreadsheet with a grid in it.
//
// Built on `@react-aria/calendar` + `@react-stately/calendar` rather than by hand.
// The keyboard model a range calendar needs — roving tabindex, arrows by day, rows
// by week, PageUp/PageDown by month, Home/End, Escape — is about four hundred
// lines of well-trodden code, and React Aria's version speaks
// `@internationalized/date`, which `packages/shared` already depends on for
// exactly the reason `tech-stack.md` gives: a stay date and an instant must not be
// the same type. What is written here is what is actually specific to this
// property: the restriction states, the copy, and the range paint.
//
// Two deliberate departures from React Aria's defaults, both evidence-led:
//
// **`role="application"` is dropped.** `useCalendarBase` puts it on the wrapper,
// and the role suppresses a screen reader's browse mode — the mode a guest needs
// to read anything in a cell beyond its own name. The `<table role="grid">`
// underneath already carries the interaction model, so the wrapper is a plain
// labelled group.
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

  // Pressing the arrival again takes the whole stay back.
  //
  // React Aria has no notion of this: with a range already chosen, a press starts a
  // fresh anchor on whatever was pressed, and the guest who meant "no, forget it"
  // has instead begun a one-night stay from their own check-in. There was no way out
  // of a chosen range except choosing a different one.
  //
  // So this runs *after* React Aria's own press handler — `day-cell.tsx` composes
  // the two rather than replacing one — and undoes it: the anchor React Aria has
  // just set is cleared, and the range goes back to the URL as null. The check is
  // against `selected`, the committed range, so it only fires on a stay that was
  // actually complete; pressing the anchor again mid-selection is React Aria's own
  // business and it already does the sensible thing.
  //
  // **The arrival only, not both ends.** Pressing the departure again reads as
  // "change when I leave", which is what starting a new selection there gives you.
  // Pressing the arrival reads as "start over", and now it is.
  const onDayPress = (date: CalendarDate) => {
    if (selected?.checkIn.compare(date) !== 0) return;

    state.setAnchorDate(null);
    setViolation(null);
    onSelect(null);
  };

  // `title` — "June – July 2026" — is deliberately not taken. It used to print
  // above the grid, and with a month caption over each of the two tables it was
  // the same fact twice; React Aria announces the range on every page change
  // regardless, so dropping the line costs a screen reader nothing and buys the
  // grid a whole line of air.
  const { calendarProps } = useRangeCalendar(
    { "aria-label": "Nights of your stay", minValue: minDate },
    state,
    ref,
  );

  // See the file header: the role React Aria sets here is the one that puts a
  // screen reader into a mode where the grid cannot be browsed.
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
      {/* The one sentence, directly under the screen's heading, where a lede
          would be. It *is* the lede: it opens as "Choose the night you arrive",
          becomes the range once there is one, and becomes the reason a selection
          was refused when one is. A second static line above it would have said
          the same thing in words that could never change. */}
      <p className={styles.status} role="status">
        {violation ?? selectionSentence(state, selected)}
      </p>

      <div className={styles.months}>
        {months.map((month, index) => (
          <MonthGrid
            caption={monthFormatter.format(month.toDate("UTC"))}
            key={month.toString()}
            onDayPress={onDayPress}
            pager={
              index === 0
                ? {
                    glyph: "‹",
                    isDisabled: state.isPreviousVisibleRangeInvalid(),
                    label: "Earlier months",
                    onPress: () => {
                      setViolation(null);
                      state.focusPreviousPage();
                    },
                  }
                : {
                    glyph: "›",
                    isDisabled: state.isNextVisibleRangeInvalid(),
                    label: "Later months",
                    onPress: () => {
                      setViolation(null);
                      state.focusNextPage();
                    },
                  }
            }
            rules={rules}
            startDate={month}
            state={state}
          />
        ))}
      </div>

      {/* The band along the bottom, and it is two marks and a disclosure.
       *
       * It was four stacked lines: a three-item legend, a free-nights count, a
       * keyboard hint and a timezone note. Every one of them is worth having and
       * none of them is worth having *open* — small print under a control reads
       * as a form's terms rather than as its key, and four lines of it made the
       * calendar look like the busiest thing on a screen whose job is to be
       * scanned.
       *
       * So what stays open is the two marks a guest cannot decode from the
       * drawing alone. The rest is one press away, and `<details>` rather than a
       * scripted disclosure because prose that reveals prose needs no state of
       * its own and gets its keyboard behaviour from the browser. */}
      <div className={styles.foot}>
        <ul className={styles.legend}>
          <li className={styles.legendSoldOut}>Sold out</li>
          <li className={styles.legendClosed}>Arrival closed</li>
        </ul>

        <details className={styles.about}>
          <summary className={styles.aboutSummary}>About these dates</summary>

          <div className={styles.aboutBody}>
            <p>
              {freeNights} of {daysShown} nights on screen are free.
            </p>

            {/* Trainline renders its keyboard hint as visible text rather than
                hiding it, and it is right to: a sighted keyboard user needs it as
                much as a screen reader user, and a visually-hidden hint reaches
                only one of the two. Behind a summary it is still visible text —
                one press, for both of them, instead of a line on the screen for
                neither. */}
            <p>Cursor keys move by day, Page Up and Page Down by month.</p>

            <p>
              Dates are the property's own, in{" "}
              {readableZone(PROPERTY_TIME_ZONE)}
              {timeZoneAside()}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * What to do next, as a whole sentence. **Never what has already been done.**
 *
 * This line used to read "21 August 2026 to 23 August 2026. 2 nights." the moment a
 * stay was complete — and the panel two columns away was saying the same thing at
 * the same time, in a structure built for it: two labelled ends, both weekdays, the
 * night count as its own row. A summary competing with a better summary is a line
 * the guest has to read twice to learn it says nothing new.
 *
 * So the line's job is narrower than it was: guidance, and errors. Before a stay it
 * asks for the arrival; mid-selection it asks for the departure; when a rule refuses
 * a pick it says which rule, which is the one thing here that exists nowhere else on
 * the screen. And once the stay is whole it carries the *other* thing that exists
 * nowhere else — the way to undo it.
 *
 * `role="status"` rather than a bare `aria-live` on a fragment: the region is
 * atomic, so it is read as one sentence rather than as a diff. It never fires on
 * hover — a hover-driven live region announces continuously and is worse than
 * silence, which is the mistake that makes most custom calendars unusable. The
 * selection itself is still announced: React Aria keeps its own hidden live region
 * for that, so dropping the range from this line costs a screen reader nothing.
 */
function selectionSentence(
  state: ReturnType<typeof useRangeCalendarState>,
  selected: StayRange | null,
): string {
  if (state.anchorDate) {
    return `${formatStayDate(state.anchorDate)}. Now choose the night you leave.`;
  }
  if (selected) {
    return `Press ${formatStayDate(selected.checkIn)} again to start over.`;
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
