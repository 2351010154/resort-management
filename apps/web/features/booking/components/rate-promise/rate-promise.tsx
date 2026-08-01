// The one block of reassurance on the dates step, and every line of it is
// checkable against the code that quotes the stay.
//
// The comp puts two cards down the left of the plate: a flexible-dates offer and
// a best-rate guarantee with a "Learn more". Neither exists here. There is no
// flexible-rate product in `rate-plans.ts` to link to and no page a "Learn more"
// could open, and a card that promises a guest a guarantee nobody has written
// down is the one kind of placeholder they could act on.
//
// What is true is narrower and worth saying anyway, because it is what a guest
// is actually anxious about at the moment they press a date: who they are buying
// from, and whether the figure will grow. `/booking` posts to the property's own
// module with no channel in front of it, and `stay-quote.ts` totals gross
// amounts — VAT and service are inside every price on the funnel and nothing
// adds a fee later.
//
// **What has and has not happened yet is said in the foot instead**, not here.
// No card asked for, no room held, prices in đồng: those are facts about the
// state of the booking rather than about who is selling it, `funnel-foot.tsx`
// carries them under the plate, and a guest who reads the same reassurance twice
// on one screen trusts it less rather than more.
//
// So: one card, no offer, no link. If a rate guarantee is ever written down,
// this is where it goes and it will need a page behind it.

import styles from "./rate-promise.module.css";

export function RatePromise() {
  return (
    <aside className={styles.card}>
      {/* Drawn rather than fetched: one path in the inherited colour, correct on
          the first frame and correct if the ground ever changes. */}
      <svg
        aria-hidden="true"
        className={styles.mark}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        viewBox="0 0 24 24"
      >
        <path d="M12 2.5 20 5.5v6.2c0 4.6-3.2 8.6-8 9.8-4.8-1.2-8-5.2-8-9.8V5.5Z" />
        <path d="m8.4 12.2 2.6 2.6 4.9-5.2" />
      </svg>

      <h2 className={`${styles.title} caps-label`}>Booked direct</h2>

      <p className={styles.line}>
        This is the property&rsquo;s own booking, with nothing in between.
      </p>

      <p className={styles.line}>
        The figure you are shown is the figure you pay: VAT and service are
        inside it, and nothing is added afterwards.
      </p>
    </aside>
  );
}
