"use client";

// View A. One question: when.
//
// Round 1 asked both of the screen's questions at once — the calendar opened on
// arrival and five room cards sat under it, each saying "Choose your dates for
// prices." The band collapsing to a summary was never the problem. The problem
// was that the list never left, so the guest was asked "when" while five dead
// cards competed for the same attention.
//
// So this view is the calendar, at full page width, and nothing else is open.
// There is no bottom sheet at any width: at 375 the calendar *is* the view, so
// there is nothing left to put in one.
//
// **Guests are a stated assumption with an escape, not a third open control.**
// Two adults is what nearly every stay is, and a party stepper standing open
// beside a date grid is a second question asked at the same time as the first.
// So the assumption is written out — "For 2 guests." — and changing it swaps the
// calendar out in place rather than appearing beside it. Still one open
// decision.

import type { CalendarDate } from "@internationalized/date";
import type { StayRange } from "@mariva/shared";
import { useState } from "react";
import {
  type NightIndex,
  type Party,
  partySize,
} from "@/features/booking/lib/stay-quote";
import { StayCalendar } from "../stay-calendar/stay-calendar";
import { GuestFieldset } from "./guest-fieldset";
import styles from "./when-view.module.css";

export function WhenView({
  range,
  party,
  nights,
  minDate,
  onRangeChange,
  onPartyChange,
}: {
  readonly range: StayRange | null;
  readonly party: Party;
  readonly nights: NightIndex;
  readonly minDate: CalendarDate;
  readonly onRangeChange: (range: StayRange | null) => void;
  readonly onPartyChange: (party: Party) => void;
}) {
  const [isEditingGuests, setEditingGuests] = useState(false);
  const guests = partySize(party);

  return (
    <section className={styles.view} data-view="when">
      <p className={styles.guidance}>Choose the nights you are here.</p>

      {isEditingGuests ? (
        <div className={styles.guestPanel}>
          <GuestFieldset onChange={onPartyChange} party={party} />
          <button
            className={styles.done}
            onClick={() => setEditingGuests(false)}
            type="button"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <p className={styles.guests}>
            {guests === 1 ? "For 1 guest." : `For ${guests} guests.`}{" "}
            <button
              className={styles.change}
              onClick={() => setEditingGuests(true)}
              type="button"
            >
              Change
            </button>
          </p>

          <StayCalendar
            minDate={minDate}
            nights={nights}
            onSelect={onRangeChange}
            selected={range}
          />
        </>
      )}
    </section>
  );
}
