"use client";

// Chapter 0's second half: the compact dates rail, under the bar.
//
// The bar carries `Book your stay` from the first pixel, so the rail is not
// there to offer booking again — it is there so that the offer stops being a
// door and becomes a question the reader can answer without leaving the chapter
// they are in. It therefore appears only once the threshold is behind them
// (`navPhase === "scrolled"`, the same hysteresis the bar's own crossfade uses —
// no ScrollTrigger, so it is identical with motion off).
//
// It writes the same draft chapter 7 does, so the two are one form in two
// places: a range typed up here is in the card at the bottom of the page, and a
// range typed into the card is up here on the way back.
//
// On a phone there is no room for three controls under a 360px bar, so the rail
// collapses to the single control and hands the reader to the card that has the
// room. Both are in the DOM and CSS picks one, which keeps the choice out of
// JavaScript and therefore correct on the first paint.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useArrivalActStore } from "@/features/arrival/lib/act-store";
import {
  useArrivalBookingDraftStore,
  useArrivalDraft,
  validateDraft,
} from "@/features/arrival/lib/arrival-booking-draft";
import { chapterIsDark } from "@/features/arrival/lib/chapter-tone";
import { useLenis } from "@/features/arrival/lib/lenis-scroll-provider";
import {
  MAX_ADULTS,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";
import { scrollToAct } from "./nav-hover-link";
import styles from "./dates-rail.module.css";

const ADULT_OPTIONS = Array.from({ length: MAX_ADULTS }, (_, i) => i + 1);

export function DatesRail() {
  const router = useRouter();
  const lenis = useLenis();
  const navPhase = useArrivalActStore((s) => s.navPhase);
  const dark = useArrivalActStore(chapterIsDark);
  const draft = useArrivalDraft();
  const setFrom = useArrivalBookingDraftStore((s) => s.setFrom);
  const setTo = useArrivalBookingDraftStore((s) => s.setTo);
  const setAdults = useArrivalBookingDraftStore((s) => s.setAdults);
  const [error, setError] = useState<string | null>(null);

  // The threshold owns the first screen whole, and the open menu is a sheet over
  // everything — neither wants a second bar under the first.
  if (navPhase !== "scrolled") return null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateDraft(draft);
    if (!result.ok) {
      // One line in a rail this slim: the first rule the draft breaks. The card
      // in chapter 7 is where every field gets its own sentence.
      setError(Object.values(result.errors)[0] ?? null);
      return;
    }
    setError(null);
    router.push(`/booking${writeBookingSearch(result.search)}`);
  };

  return (
    <div className={styles.rail} data-theme={dark ? "dark" : "light"}>
      <form
        className={styles.form}
        action="/booking"
        method="get"
        onSubmit={submit}
        noValidate
      >
        <input type="hidden" name="step" value="rooms" />

        <label className={styles.field} htmlFor="rail-from">
          <span className="caps-label">From</span>
          <input
            id="rail-from"
            className={styles.control}
            type="date"
            name="from"
            value={draft.from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>

        <label className={styles.field} htmlFor="rail-to">
          <span className="caps-label">To</span>
          <input
            id="rail-to"
            className={styles.control}
            type="date"
            name="to"
            value={draft.to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>

        <label className={styles.field} htmlFor="rail-adults">
          <span className="caps-label">Guests</span>
          <select
            id="rail-adults"
            className={styles.control}
            name="adults"
            value={String(draft.adults)}
            onChange={(e) => setAdults(Number.parseInt(e.target.value, 10))}
          >
            {ADULT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className={`caps-label ${styles.submit}`}>
          Check availability
        </button>

        <p className={styles.error} role="alert">
          {error ?? ""}
        </p>
      </form>

      {/* The phone's whole rail. A button, not a link: chapter 7 is a section on
          this page, and the draft it is being handed is already in the store. */}
      <button
        type="button"
        className={`caps-label ${styles.compact}`}
        onClick={() => scrollToAct(lenis, 7)}
      >
        Check availability
      </button>
    </div>
  );
}
