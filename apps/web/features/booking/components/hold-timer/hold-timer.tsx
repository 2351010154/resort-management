"use client";

// The hold countdown. Specified here, used from `/booking/<hold>/details` onward.
//
// **There is no hold on `/booking`.** `booking-state-machine.md` §3 starts the TTL
// on entry to `HELD`, and `repository-structure.md` puts the hold id in the path
// "from step three on" — `/booking` is stateless and its state is search params. So
// this component is not rendered by the search screen; the card says what choosing
// a room *will* do instead. It lives here because the countdown is one funnel-wide
// decision and specifying it twice is how two steps end up disagreeing about how
// long a guest has.
//
// Eventbrite's checkout is the reference, and the thing worth copying is not
// obvious: **two representations of one countdown.**
//
// - The visible digits tick every second.
// - A visually-hidden `aria-live="polite"` region carries a *coarsened* figure, in
//   whole minutes. A live region that fires every second makes a page unusable with
//   a screen reader — it never stops talking, and the guest cannot read anything
//   else while it is counting.
//
// And the styling is the argument. Measured off Eventbrite: 12px, muted grey,
// transparent background, static position, no weight change, no red, and no
// threshold colour change at all. A hold timer that shouts is a dark pattern;
// design-foundations.md §6 forbids urgency outright. This one reads as a receipt
// line, which is what it is.

import { useEffect, useState } from "react";
import styles from "./hold-timer.module.css";

/** Where the supporting line changes, once. */
const NEARLY_UP_SECONDS = 120;

function secondsLeft(expiresAt: Date): number {
  return Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000));
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function HoldTimer({
  expiresAt,
  onExpired,
}: {
  /** The server's own deadline. Never a duration — see below. */
  readonly expiresAt: Date;
  readonly onExpired?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsLeft(expiresAt));

  useEffect(() => {
    // Recomputed against `Date.now()` on every tick rather than decremented, and
    // recomputed again on `visibilitychange`. A decremented counter drifts, and a
    // backgrounded tab is throttled to once a minute — so a guest who switches
    // apps comes back to a clock that is minutes behind the hold it describes.
    // The deadline is the server's because a skewed device clock otherwise lies
    // in whichever direction it is wrong.
    const tick = () => setRemaining(secondsLeft(expiresAt));

    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [expiresAt]);

  useEffect(() => {
    if (remaining === 0) onExpired?.();
  }, [remaining, onExpired]);

  const minutes = Math.ceil(remaining / 60);

  return (
    <div className={styles.hold}>
      {/* role="timer" on the wrapper, per Eventbrite — and unlike Eventbrite, no
          <label for> pointing at a <div> and no role="alert" contradicting a
          polite live region on the same element. */}
      <p className={styles.line} role="timer">
        Held for <span className={styles.digits}>{clock(remaining)}</span>
      </p>

      {/* Whole minutes only, never per second. */}
      <span aria-atomic="true" aria-live="polite" className={styles.announced}>
        {remaining === 0
          ? "Your hold has run out."
          : `Your room is held for ${minutes} more ${minutes === 1 ? "minute" : "minutes"}.`}
      </span>

      {/* One change, once, and nothing else about the component changes with it.
          No colour, no size, no weight — the sentence is the whole difference. */}
      <p className={styles.note}>
        {remaining === 0
          ? "Your hold ran out. The dates are still here."
          : remaining <= NEARLY_UP_SECONDS
            ? "A few minutes left. We can start again if you need longer."
            : "Nothing is charged until you pay."}
      </p>
    </div>
  );
}
