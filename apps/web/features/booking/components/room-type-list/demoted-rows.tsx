"use client";

// What the guest cannot take, and why — one line each, under the photographs.
//
// Round 1 kept a sold-out type in place as a full-height card with a disabled
// `Choose`, and a too-small type as a card saying "Sleeps 2. You are three." A
// full-height card with a dead primary action reads as broken whichever reason
// produced it — and now that every card carries a photograph, five pictures with
// three of them unbuyable is a wall the guest cannot act on.
//
// **Demoted, never hidden.** A guest who cannot see the Superior at all
// concludes the hotel has no such room; a guest who sees it on one line
// concludes it is not free this week. The second is true and the first is not.
//
// Two labels, because the system can produce exactly two rejections today. A
// third label means a third rejection reason exists, and that is a
// `stay-quote.ts` change rather than a copy change.

import type { RoomType } from "@/features/booking/lib/room-types";
import type { Party } from "@/features/booking/lib/stay-quote";
import { partySize } from "@/features/booking/lib/stay-quote";
import styles from "./demoted-rows.module.css";

/** Party sizes this property can be asked for — `booking-search.ts` caps it at 4. */
const NUMBER_WORDS = ["nobody", "one", "two", "three", "four"] as const;

function inWords(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

export function DemotedRows({
  soldOut,
  tooSmall,
  party,
}: {
  readonly soldOut: readonly RoomType[];
  readonly tooSmall: readonly RoomType[];
  readonly party: Party;
}) {
  if (soldOut.length === 0 && tooSmall.length === 0) return null;

  const guests = partySize(party);

  return (
    <div className={styles.demoted}>
      {soldOut.length > 0 ? (
        <section className={styles.group}>
          <h3 className={`${styles.label} caps-label`}>
            Not free for these nights
          </h3>
          <ul className={styles.rows}>
            {soldOut.map((type) => (
              <li className={styles.row} data-demoted-row key={type.code}>
                {type.name} — not free for these nights.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tooSmall.length > 0 ? (
        <section className={styles.group}>
          <h3 className={`${styles.label} caps-label`}>
            Too small for {inWords(guests)} guests
          </h3>
          <ul className={styles.rows}>
            {tooSmall.map((type) => (
              <li className={styles.row} data-demoted-row key={type.code}>
                {type.name} — sleeps {type.maxOccupancy}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
