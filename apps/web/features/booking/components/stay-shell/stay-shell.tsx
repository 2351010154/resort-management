// The frame and the stay summary the four post-hold screens share.
//
// A component rather than four copies of the same heading and the same
// definition list, and deliberately not `app/(booking)/layout.tsx`: that layout
// wraps the auth screens and `/booking` too, and neither of those is standing on
// a stay. `auth-shell.tsx` draws the same line from the other side.
//
// It renders no step of its own logic. What each screen does — take a payment,
// wait for a gateway, show a confirmed booking — is that screen's, and this
// holds what they all have to say first: where the guest is, which stay this is
// about, and what it comes to.

import { formatVnd } from "@mariva/shared";
import type { ReactNode } from "react";
import { roomType } from "@/features/booking/lib/room-types";
import { type HeldStay, stayTotal } from "@/features/booking/lib/stay-funnel";
import styles from "./stay-shell.module.css";

export function StayShell({
  step,
  title,
  subtitle,
  stay,
  children,
  footnote,
}: {
  readonly step: string;
  readonly title: string;
  readonly subtitle: string;
  /** Absent while the stay is still being read, so the frame paints first. */
  readonly stay?: HeldStay;
  readonly children?: ReactNode;
  readonly footnote?: ReactNode;
}) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <p className={styles.step}>{step}</p>
        <h1 className={`${styles.title} font-display`}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {stay ? <StaySummary stay={stay} /> : null}

        {children}

        {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
      </div>
    </main>
  );
}

/**
 * The stay, written back to the guest before they are asked for anything.
 *
 * Every figure is the API's, and so is every figure on the room list the guest
 * arrived from — `/booking` reads `availability.search` now rather than quoting
 * a stand-in tariff. The total below is nonetheless the authoritative one: it is
 * the figure the property froze onto the hold, where the list's was a quote
 * against inventory that had not been taken off the shelf yet.
 */
function StaySummary({ stay }: { readonly stay: HeldStay }) {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const party = describeParty(stay.adults, stay.childAges.length);

  return (
    <>
      <dl className={styles.summary}>
        <dt className={styles.summaryLabel}>Room</dt>
        <dd className={styles.summaryValue}>{roomType(stay.roomType).name}</dd>

        <dt className={styles.summaryLabel}>Nights</dt>
        <dd className={styles.summaryValue}>
          {stay.checkIn} to {stay.checkOut}, {nights}
        </dd>

        <dt className={styles.summaryLabel}>Guests</dt>
        <dd className={styles.summaryValue}>{party}</dd>

        <dt className={styles.summaryLabel}>Reference</dt>
        <dd className={styles.summaryValue}>{stay.reference}</dd>
      </dl>

      <div className={styles.total}>
        <span className={styles.totalLabel}>
          Total, VAT and service included
        </span>
        <span className={styles.totalAmount}>{formatVnd(stayTotal(stay))}</span>
      </div>
    </>
  );
}

/**
 * How many nights the stay covers.
 *
 * Counted off the two dates rather than carried, because the API answers a stay
 * with its arrival and departure and the difference is the night count by
 * definition — `[checkIn, checkOut)`, half-open, so a Monday to a Wednesday is
 * two nights and not three.
 *
 * Both are `YYYY-MM-DD` in the property's zone. `Date.UTC` reads them as the
 * plain dates they are, which is what keeps the subtraction free of the
 * browser's timezone: a guest in Auckland and a guest in Lisbon count the same
 * nights for the same stay.
 */
function nightsBetween(checkIn: string, checkOut: string): string {
  const nights = Math.round(
    (midnightUtc(checkOut) - midnightUtc(checkIn)) / 86_400_000,
  );

  return nights === 1 ? "1 night" : `${nights} nights`;
}

function midnightUtc(day: string): number {
  const [year, month, date] = day.split("-").map(Number);

  return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
}

/** The party, in the words the guest chose it with. */
function describeParty(adults: number, children: number): string {
  const grownUps = adults === 1 ? "1 adult" : `${adults} adults`;

  if (children === 0) {
    return grownUps;
  }

  return `${grownUps}, ${children === 1 ? "1 child" : `${children} children`}`;
}

export { styles as stayStyles };
