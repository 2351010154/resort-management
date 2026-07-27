"use client";

// Nothing free. The state everyone forgets, and the one that decides whether a
// full property loses the booking or moves it.
//
// Resy's moves, in order:
//
// 1. **State the fact plainly, naming the dates the guest asked for.** Not "no
//    results" — the dates, back to them.
// 2. **Offer the nearest thing that works, parameterised by the same party.**
//    "The next availability *for 2*" is the detail Resy gets right; a generic
//    "try other dates" is a different, weaker feature.
//
// Resy has a third move — a "notify me" button — and it is **deliberately absent
// here**, because there is no waitlist entity in the API. A button that answers
// "Noted." and records nothing is a lie told to a guest who has just been
// disappointed, which is worse than not offering. When the entity exists this is
// where it goes; until then the nearest-dates offer above carries the page, and it
// is why that query is the load-bearing one.

import type { StayRange } from "@mariva/shared";
import { formatStayDates } from "@/features/booking/lib/booking-search";
import type { Alternative } from "@/features/booking/lib/nearest-availability";
import { type Party, partySize } from "@/features/booking/lib/stay-quote";
import styles from "./no-availability.module.css";

export function NoAvailability({
  requested,
  party,
  alternatives,
  onPick,
}: {
  readonly requested: StayRange;
  readonly party: Party;
  readonly alternatives: readonly Alternative[];
  readonly onPick: (range: StayRange) => void;
}) {
  const requestedStay = formatStayDates(requested);
  const guests = partySize(party);

  return (
    <section className={styles.empty}>
      <h2 className={styles.headline}>
        Nothing free for {requestedStay.dates}.
      </h2>

      <p className={styles.forParty}>
        {guests === 1 ? "One guest" : `${guests} guests`} ·{" "}
        {requestedStay.nights}.
      </p>

      {alternatives.length > 0 ? (
        <ul className={styles.options}>
          {alternatives.map((option) => {
            const dates = formatStayDates(option.range);
            return (
              <li
                className={styles.option}
                key={option.range.checkIn.toString()}
              >
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  <span className={styles.optionDates}>
                    {dates.dates} · {dates.nights}
                  </span>
                </span>
                <button
                  className={styles.show}
                  onClick={() => onPick(option.range)}
                  type="button"
                >
                  Show these dates
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.nothingNear}>
          Nothing in the next two months takes a party of {guests}.
        </p>
      )}
    </section>
  );
}
