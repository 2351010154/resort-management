// What the guest site shows between two screens.
//
// It is a feature folder of its own, and neither `arrival/` nor `booking/`,
// because it is the one surface both route groups reach. `(booking)` may not
// import from `features/arrival` at all — everything under it reaches three,
// gsap or lenis eventually, and `FR-BOOK-05` budgets the funnel at zero bytes
// of the three of them (design-foundations.md §5, "The budget"). Putting the
// curtain under `arrival/` would therefore have made it unreachable from the
// half of the site that needs it most, and putting it under `booking/` would
// have had the arrival importing from the funnel to borrow it.
//
// **It is markup and a stylesheet, and deliberately nothing else.** No state,
// no timer, no `"use client"`. The delay that keeps it from flashing past on a
// fast navigation is an `animation-delay` in the stylesheet rather than a
// `setTimeout` here, so the curtain costs a route fallback no JavaScript and no
// hydration — which matters precisely because the moment it renders is the
// moment the browser is already busy fetching the screen behind it.

import styles from "./threshold.module.css";

/**
 * The house's ground, its mark, and one line, held until the next screen lands.
 *
 * `role="status"` rather than a bare div: a guest reading the page through a
 * screen reader gets no visual cue that a navigation is in flight, and the live
 * region is what turns the wait into something announced instead of a silence.
 * Polite, so it does not interrupt whatever the reader was in the middle of.
 *
 * @param label What the house says while it waits. The default is the funnel's
 *   own phrase — `confirming-screen.tsx` titles its wait "One moment" — so a
 *   guest who meets both meets the same sentence rather than two synonyms.
 */
export function Threshold({
  label = "One moment",
}: {
  readonly label?: string;
}) {
  return (
    <div aria-live="polite" className={styles.screen} role="status">
      {/* Decorative: the line beside it already says everything this says, and
          a mark announced as "Mariva monogram" in front of it is the house's
          name read out twice. design-foundations.md §7. */}
      <span aria-hidden="true" className={styles.monogram} />

      <span className={`${styles.line} caps-label`}>{label}</span>
    </div>
  );
}
