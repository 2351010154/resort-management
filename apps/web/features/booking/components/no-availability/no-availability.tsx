"use client";

// Nothing the guest can take. The state everyone forgets, and the one that
// decides whether a full property loses the booking or moves it.
//
// Resy's moves, in order:
//
// 1. **State the fact plainly, naming the dates the guest asked for** — and the
//    party, because "nothing free" for two and for four are different facts.
//    Not "no results". The dates, back to them.
// 2. **Offer the nearest thing that works, parameterised by the same party.**
//    "The next two nights free *for 2*" is the detail Resy gets right; a generic
//    "try other dates" is a different, weaker feature.
//
// Resy has a third move — a "notify me" button — and it is **deliberately absent
// here**, because there is no waitlist entity in the API. A button that answers
// "Noted." and records nothing is a lie told to a guest who has just been
// disappointed, which is worse than not offering. When the entity exists this is
// where it goes; until then the nearest-dates offer above carries the page, and
// it is why that query is the load-bearing one. **Two moves, not three**, and
// that is a decision rather than an omission.
//
// This is also where a party that fits nothing lands. Five types and forty
// rooms, and a guest of four looking at a week when only Superiors are free, is
// not a special case of "sold out" — it is the same answer: nothing here for
// you, here is what there is.

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
  const forParty = guests === 1 ? "for one guest" : `for ${guests} guests`;

  return (
    <section className={styles.empty}>
      {/* The dates and the party in one sentence, so the offer below can be a
          sentence about dates alone. Round 1 spent a second line restating the
          party and the length; the length is in the dates.
        *
        * `<h1>`, and it is the view's own. The other two views take a title from
        * the screen — "Your nights", "Your room" — and neither of them is true
        * here: a heading saying "Your room" over a page saying there is no room
        * is a page arguing with itself. So this state states the fact as its
        * heading and the screen prints none above it. */}
      <h1 className={styles.headline}>
        Nothing free for {requestedStay.dates}, {forParty}.
      </h1>

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
                  <span className={styles.optionDates}>{dates.dates}</span>
                </span>
                <button
                  className={styles.show}
                  onClick={() => onPick(option.range)}
                  type="button"
                >
                  Show those nights
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
