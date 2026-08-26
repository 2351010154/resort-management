"use client";

// What the guest answered, in one line, and the way back to it.
//
// **The whole row is the button, and the value is its accessible name.** Not a
// caps label saying "Nights" beside a value saying "15 – 17 September" — that is
// two strings for one fact, and the day one of them is edited the other is a lie.
// A screen-reader guest hears exactly what a sighted guest reads.
//
// That is Google Flights' lesson, and this is deliberately only half of what it
// does. Its band stays a live control, and at 375 that costs 220px — 27% of the
// viewport spent restating the question before a single answer is visible. So
// this is a *summary*: one line, one row, one tap back to View A. The guest is
// looking at rooms now.

import type { StayRange } from "@mariva/shared";
import { formatStayDates } from "@/features/booking/lib/booking-search";
import { type Party, partySize } from "@/features/booking/lib/stay-quote";
import styles from "./rooms-view.module.css";

export function DateSummary({
  range,
  party,
  onChange,
}: {
  readonly range: StayRange;
  readonly party: Party;
  /**
   * Back to the dates step, keeping them.
   *
   * It used to clear the range, because clearing it was the only way to reopen
   * the calendar. With the step in the URL the guest arrives back at the grid with
   * their own dates still selected and stated beside it — which is what "Change"
   * always meant, rather than "start again".
   */
  readonly onChange: () => void;
}) {
  const stay = formatStayDates(range);
  const guests = partySize(party);

  return (
    <button
      className={styles.summary}
      data-date-summary
      onClick={onChange}
      type="button"
    >
      <span className={styles.summaryValue}>
        {stay.dates}, {stay.nights},{" "}
        {guests === 1 ? "1 guest" : `${guests} guests`}
      </span>
      <span className={styles.summaryChange}>Change</span>
    </button>
  );
}
