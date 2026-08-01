"use client";

// The date control. Two months, three cell states, and a sentence it hands
// upward.
//
// **The prices have left the cells and most of the small print has left the
// screen.** Both were here for good reasons — see `day-cell.tsx` for the price and
// `funnel-foot.tsx` for the rest — and both were costing the control the thing
// it exists for, which is being read in one look. Sixty-one figures and four lines
// of qualification make a spreadsheet with a grid in it.
//
// **The one sentence is printed by the caller, not here.** It opens as "Choose
// the night you arrive", becomes the way to start over once there is a stay, and
// becomes the reason a pick was refused when a rule refuses one — which is a
// lede, and a lede belongs under the screen's title rather than over the grid.
// The sentence can only be *composed* here, because half of it is React Aria
// state this file owns and the other half is a violation that describes
// something which did not happen; so it is composed here and handed to
// `onStatus`, and `dates-stage.tsx` puts it where the comp has it. What is left
// with the grid is the legend — the two marks nobody can decode from the drawing
// alone, which are about the cells and belong beside them.
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

import { type CalendarDate, GregorianCalendar } from "@internationalized/date";
import type { StayRange } from "@mariva/shared";
import { useRangeCalendar } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import { useRangeCalendarState } from "@react-stately/calendar";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatStayDate } from "@/features/booking/lib/booking-search";
import type { NightIndex } from "@/features/booking/lib/stay-quote";
import { MonthGrid } from "./month-grid";
import {
  type AvailabilityRules,
  rangeViolation,
  reasonSentence,
  unpickableReason,
} from "./stay-availability";
import styles from "./stay-calendar.module.css";

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
  maxDate,
  onSelect,
  onStatus,
}: {
  readonly nights: NightIndex;
  readonly selected: StayRange | null;
  readonly minDate: CalendarDate;
  /**
   * The last date the grid may reach — the morning after the last night the
   * property has priced.
   *
   * Without it the pager ran forward for ever into months where every night was
   * `no-data` and therefore every cell was dead. A guest four presses ahead of
   * today met a calendar that drew normally and refused every date on it, with
   * nothing on the screen saying why. A bound is the honest version: the pager
   * stops where the property stops selling.
   */
  readonly maxDate: CalendarDate;
  readonly onSelect: (range: StayRange | null) => void;
  /** Where the control's one sentence is printed. See the header. */
  readonly onStatus: (sentence: string) => void;
}) {
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const byKeyboard = useKeyboardModality();

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
    maxValue: maxDate,
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

      // A stay of no nights, which is the guest pressing the arrival they have
      // just chosen: "no, forget it". React Aria has no undo for a half-made
      // selection — see `stay-availability.ts` for why it could not even be
      // pressed until now — and by the time this runs it has already dropped the
      // anchor. So returning without committing is the whole of the undo, and it
      // leaves whatever was chosen before this press standing.
      if (picked.checkIn.compare(picked.checkOut) === 0) {
        setViolation(null);
        return;
      }

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
    {
      "aria-label": "Nights of your stay",
      minValue: minDate,
      maxValue: maxDate,
    },
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

  // Composed here, printed by the caller. An effect and not a call in the body,
  // because half of what it is composed from is React Aria state that changes
  // during this render — writing to the caller's state mid-render is the one
  // thing React will not have. It runs on the sentence, not on every render, so
  // hovering a cell does not touch it.
  const sentence = violation ?? selectionSentence(state, selected);
  useEffect(() => {
    onStatus(sentence);
  }, [onStatus, sentence]);

  return (
    // A labelled group — and explicitly not `role="application"`, see the header.
    // biome-ignore lint/a11y/useSemanticElements: `<fieldset>` is Biome's suggestion and it is wrong here — this groups a grid, not form controls, and a fieldset would want a legend the caption already provides.
    <div
      {...groupProps}
      className={styles.calendar}
      // Which hand is driving, and the grid's one ring answers to it. See
      // `useKeyboardModality` at the foot of this file.
      data-modality={byKeyboard ? "keyboard" : "pointer"}
      ref={ref}
      role="group"
    >
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

      {/* The band along the bottom, and it is two marks.
       *
       * It was four stacked lines: a three-item legend, a free-nights count, a
       * keyboard hint and a timezone note. Every one of them is worth having and
       * none of them is worth having *here* — small print under a control reads
       * as a form's terms rather than as its key, and four lines of it made the
       * calendar look like the busiest thing on a screen whose job is to be
       * scanned.
       *
       * So what stays with the grid is the two marks a guest cannot decode from
       * the drawing alone, which are a key to these cells and nothing else. The
       * rest is under the plate, one press away, in `funnel-foot.tsx`. */}
      <ul className={styles.legend}>
        <li className={styles.legendSoldOut}>Sold out</li>
        <li className={styles.legendClosed}>Arrival closed</li>
      </ul>
    </div>
  );
}

/**
 * Whether the guest is driving with the keyboard, for the one ring the grid draws.
 *
 * **`:focus-visible` cannot answer this here, and the wrong answer was on the
 * screen.** React Aria presses a date with `preventFocusOnPress` and focuses the
 * cell itself a moment later, and Chrome grants `:focus-visible` to a
 * programmatic focus — so every date pressed with a mouse came away wearing the
 * keyboard's amber ring, around the disc the comp draws bare.
 *
 * Listened for on the document rather than on the group, because tabbing *into*
 * the calendar is a keypress that happens while the focus is still outside it —
 * a listener on the group would miss it and leave the first cell a keyboard
 * guest lands on with no focus mark at all. React bails out of a `setState` that
 * does not change the value, so the flag re-renders on a change of hand and not
 * on a keystroke.
 */
function useKeyboardModality(): boolean {
  const [byKeyboard, setByKeyboard] = useState(false);

  useEffect(() => {
    const onKeyDown = () => setByKeyboard(true);
    const onPointerDown = () => setByKeyboard(false);

    // Capture, so a handler that stops propagation on the way up cannot leave
    // the flag describing the previous gesture.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return byKeyboard;
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
 * The live region it is printed into is the caller's — `dates-stage.tsx` — and it
 * is `role="status"` rather than a bare `aria-live` on a fragment: the region is
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
    // The way back is named here as well as under a whole stay, because this is
    // the state a guest is likeliest to be in by mistake — one press in, on the
    // wrong day, with every earlier day refusing them.
    return `${formatStayDate(state.anchorDate)}. Now choose the night you leave, or press it again to start over.`;
  }
  if (selected) {
    return `Press ${formatStayDate(selected.checkIn)} again to start over.`;
  }
  return "Choose the night you arrive.";
}
