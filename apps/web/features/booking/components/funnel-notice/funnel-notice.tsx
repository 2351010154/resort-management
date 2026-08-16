"use client";

// What the room step says when it has no prices to show yet, and when it could
// not get any.
//
// It stands where the room list stands, in the same plate, and it carries the
// step's `<h1>` — because the list's heading is the first line of its own rail
// and `no-availability.tsx` carries its own for the same reason. A step with no
// heading while it loads is a step whose landmark changes shape under a screen
// reader; two headings would be worse.
//
// **The failure is a sentence and a button, never a fallback price.** The API is
// the only thing in this application that knows what a night costs, so a read
// that did not come back leaves the screen with nothing to say about money — and
// saying it plainly, with a way to ask again, is the whole of the honest answer.
// Copy per `design-foundations.md` §6: plain, blameless, no apology theatre.

import styles from "./funnel-notice.module.css";

export function FunnelNotice({
  headline,
  detail,
  onRetry,
}: {
  readonly headline: string;
  readonly detail: string;
  /** Offered only when asking again is a thing that could work. */
  readonly onRetry?: () => void;
}) {
  return (
    // Polite and atomic: the guest is waiting on this region, so it is read as
    // one sentence when it changes rather than as the words that differ.
    <section aria-atomic="true" aria-live="polite" className={styles.notice}>
      <h1 className={styles.headline}>{headline}</h1>
      <p className={styles.detail}>{detail}</p>

      {onRetry ? (
        <button className={styles.retry} onClick={onRetry} type="button">
          Try again
        </button>
      ) : null}
    </section>
  );
}
