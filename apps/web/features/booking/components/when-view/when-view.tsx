"use client";

// View A. One question: when.
//
// Round 1 asked both of the screen's questions at once — the calendar opened on
// arrival and five room cards sat under it, each saying "Choose your dates for
// prices." The band collapsing to a summary was never the problem. The problem
// was that the list never left, so the guest was asked "when" while five dead
// cards competed for the same attention.
//
// So this view is the calendar and nothing else is open. Before a date is
// pressed it has the screen's whole width; the stay panel takes 30% of it back
// once there is a stay to state, and the grid is still the only thing in here.
//
// **The party controls have gone to the panel.** They used to be here, as a
// stated assumption with an escape — "For 2 guests." with a `Change` that swapped
// the calendar out — because a party stepper standing open beside a date grid is a
// second question asked at the same time as the first. The panel makes that trade
// unnecessary rather than reversing it: it does not exist until the dates are
// answered, so a control inside it is asked *after* the first question rather than
// beside it. See `stay-panel/party-rows.tsx`.
//
// What is left is one view with one control in it, which is what this file was
// always trying to be.

import type { CalendarDate } from "@internationalized/date";
import type { StayRange } from "@mariva/shared";
import type { NightIndex } from "@/features/booking/lib/stay-quote";
import { StayCalendar } from "../stay-calendar/stay-calendar";
import styles from "./when-view.module.css";

export function WhenView({
  range,
  nights,
  minDate,
  maxDate,
  onRangeChange,
  onStatus,
}: {
  readonly range: StayRange | null;
  readonly nights: NightIndex;
  readonly minDate: CalendarDate;
  readonly maxDate: CalendarDate;
  readonly onRangeChange: (range: StayRange | null) => void;
  /** Passed straight through: the grid composes the step's one sentence and the
   *  head prints it. See `stay-calendar.tsx`. */
  readonly onStatus: (sentence: string) => void;
}) {
  return (
    <section className={styles.view} data-view="when">
      <StayCalendar
        maxDate={maxDate}
        minDate={minDate}
        nights={nights}
        onSelect={onRangeChange}
        onStatus={onStatus}
        selected={range}
      />
    </section>
  );
}
