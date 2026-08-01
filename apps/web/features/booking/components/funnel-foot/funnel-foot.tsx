// The band under the plate: where the booking stands, and everything that
// qualifies the grid above it.
//
// **This is where the calendar's small print went.** It used to hang off the
// foot of the grid — a legend, a free-nights count, a keyboard hint and a
// timezone note — and four lines of qualification directly under a control read
// as a form's terms rather than as its key. The two marks a guest cannot decode
// from the drawing stayed with the drawing, in the calendar's own foot; the rest
// is here, one press away, under the card rather than inside it.
//
// **The marks are facts about the state of the booking, not a guarantee.** No
// card has been asked for on this step, no room is held until the guest
// confirms — which is what the screen's own next-step line says in the same
// words — and the tariff is in đồng, which is worth stating before a guest
// converts a five-figure number in their head. Who the property is and what is
// inside the price is `rate-promise.tsx`'s job, on the plate; nothing is said
// twice.

import { getLocalTimeZone } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import type { NightIndex } from "@/features/booking/lib/stay-quote";
import styles from "./funnel-foot.module.css";

export function FunnelFoot({ nights }: { readonly nights: NightIndex }) {
  // Counted over everything priced, not over what happens to be on screen. The
  // sentence used to say "on screen", which meant it changed when the guest
  // paged the grid and was therefore a different claim each time it was read.
  // The priced window is a fixed thing the screen can state once.
  let free = 0;
  for (const night of nights.values()) if (!night.isSoldOut) free += 1;

  return (
    <footer className={styles.foot}>
      <p className={styles.marks}>
        {/* The house mark, masked over `currentColor` like the wordmark in the
            bar — decorative, and the sentence beside it reads without it. */}
        <span aria-hidden="true" className={styles.ornament} />
        No payment today
        <span aria-hidden="true"> · </span>
        Nothing held until you confirm
        <span aria-hidden="true"> · </span>
        Prices in Vietnamese đồng
      </p>

      {/* `<details>` rather than a scripted disclosure: prose that reveals prose
          needs no state of its own and gets its keyboard behaviour free. */}
      <details className={styles.about}>
        <summary className={styles.summary}>About these dates</summary>

        <div className={styles.body}>
          <p>
            {free} of the next {nights.size} nights are free.
          </p>

          {/* Trainline renders its keyboard hint as visible text rather than
              hiding it, and it is right to: a sighted keyboard user needs it as
              much as a screen reader user, and a visually-hidden hint reaches
              only one of the two. Behind a summary it is still visible text —
              one press, for both of them, instead of a line on the screen for
              neither. */}
          <p>Cursor keys move by day, Page Up and Page Down by month.</p>

          <p>
            Dates are the property&rsquo;s own, in{" "}
            {readableZone(PROPERTY_TIME_ZONE)}
            {timeZoneAside()}
          </p>
        </div>
      </details>
    </footer>
  );
}

/**
 * The clock the guest is reading on, when it is not the property's.
 *
 * cal.com names the timezone next to the duration it governs, and a resort in
 * Vietnam sells to Seoul and Singapore. Said only when the two differ, because
 * telling a guest in Ho Chi Minh City which timezone they are in is noise.
 */
function timeZoneAside(): string {
  const here = getLocalTimeZone();
  return here === PROPERTY_TIME_ZONE ? "." : ` — not ${readableZone(here)}.`;
}

/**
 * An IANA zone as prose.
 *
 * `replaceAll`, not `replace`: "Asia/Ho_Chi_Minh" has two underscores, and the
 * single-shot version put "Asia/Ho Chi_Minh" on the page.
 */
function readableZone(zone: string): string {
  return zone.replaceAll("_", " ");
}
