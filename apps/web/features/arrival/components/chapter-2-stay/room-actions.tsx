"use client";

// The two things a reader can do about a room type, both against the one draft.
//
// **The booking action is an address.** It carries whatever the draft holds: a
// range typed into the rail sends it to the room list, and an unanswered one
// sends it to the calendar with the party still attached. Never a bare
// `/booking` that discards what was already said.
//
// **The other one is a scroll, and it is labelled for where it goes.** There is
// no room detail route on this site and no phase invented one, so the button
// scrolls to the page's own last question with the draft intact — it lives in
// the store, so arriving there carries it by construction. It used to read
// `View room`, which promised a room and delivered a date field; it says what it
// does now.
//
// **Neither carries the type, so neither claims to.** `booking-search.ts` has
// six params — `from`, `to`, `adults`, `ages`, `plan`, `step` — and no room-type
// hint. Adding one would be a change to the funnel's contract, which this work
// does not touch, so the deck hands over the stay and the funnel's own room list
// is where the type is chosen. The primary action therefore reads `Book your
// stay` rather than `Book this room`: the second was a promise the query cannot
// keep.

import {
  draftHref,
  useArrivalDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import { scrollToAct } from "@/features/arrival/components/navigation/nav-hover-link";
import styles from "./chapter-2-stay.module.css";

/** `name` is the type's own name, and it is only ever an accessible one: five
 *  cards of "Check availability" are five identical controls in a screen
 *  reader's list. It says which card the control belongs to, not that the type
 *  travels with it. */
export function RoomActions({ name }: { readonly name: string }) {
  const lenis = useLenis();
  const draft = useArrivalDraft();

  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={`caps-label ${styles.link}`}
        aria-label={`Check availability — ${name}`}
        onClick={() => scrollToAct(lenis, 7)}
      >
        Check availability
      </button>
      <a
        className={`caps-label ${styles.book}`}
        aria-label={`Book your stay — ${name}`}
        href={draftHref(draft)}
      >
        Book your stay
      </a>
    </div>
  );
}
