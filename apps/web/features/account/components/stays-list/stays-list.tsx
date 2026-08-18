"use client";

// `/account/stays` — every stay this account has taken.
//
// **The list only navigates.** `screens.md` §Account is explicit: cancelling an
// upcoming stay, providing the identity document and leaving post-stay feedback
// all happen on `/bookings/<reference>`, the one surface that owns a stay's full
// context and knows which of those its state allows. A card that offered a
// cancel button here would be a second place for that decision to be made, kept
// in step with the first by hand.
//
// So every card is a link and nothing else, and the whole card is the link
// rather than a word inside it: the target is one stay, and a guest reaching for
// it on a phone should not have to find the four characters that were
// underlined.
//
// The two groups and their order are `stay-history.ts`'s, and argued there. What
// this file adds is today — the property's own date rather than the browser's,
// because a guest reading this in Auckland must see the same two groups as one
// reading it in Lisbon.

import { parseDate, today } from "@internationalized/date";
import { nightCount, PROPERTY_TIME_ZONE } from "@mariva/shared";
import { useEffect, useState } from "react";
import { AccountShell } from "@/features/account/components/account-shell/account-shell";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./stays-list.module.css";

export function StaysList() {
  const [stays, setStays] = useState<readonly OwnStay[]>();
  const [refusal, setRefusal] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    void readStays().then((outcome) => {
      if (!live) {
        return;
      }

      if (outcome.ok) {
        setStays(outcome.stays);
      } else {
        setRefusal(outcome.message);
      }

      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, []);

  if (loading) {
    return (
      <AccountShell
        here="stays"
        subtitle="One moment while the property reads your bookings."
        title="Your stays"
      >
        <p className={styles.notice}>Reading your stays.</p>
      </AccountShell>
    );
  }

  // No list, and one way to arrive at that: a browser with no session, or one
  // whose session has ended. An account with no stays is a different answer
  // entirely, and it is below.
  if (!stays) {
    return (
      <AccountShell
        here="stays"
        subtitle="The property could not read your bookings."
        title="Your stays"
      >
        <p className={styles.error} role="alert">
          {refusal}
        </p>
        <p className={styles.footnote}>
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>{" "}
          and your stays are here waiting.
        </p>
      </AccountShell>
    );
  }

  const { upcoming, past } = stayHistory(
    stays,
    today(PROPERTY_TIME_ZONE).toString(),
  );

  return (
    <AccountShell
      here="stays"
      subtitle="What is coming, and what has been. Each one opens the stay it belongs to."
      title="Your stays"
    >
      {stays.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.notice}>
            Nothing under this account yet. A stay you booked before you had one
            is kept with the link in its confirmation email — open that link and
            it comes with you.
          </p>
          <a className={`${styles.book} caps-label`} href="/booking">
            Book a stay
          </a>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <section className={styles.group}>
          <h2 className={`${styles.groupTitle} caps-label`}>Coming up</h2>
          <ul className={styles.list}>
            {upcoming.map((stay) => (
              <StayCard key={stay.id} stay={stay} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className={styles.group}>
          <h2 className={`${styles.groupTitle} caps-label`}>Before this</h2>
          <ul className={styles.list}>
            {past.map((stay) => (
              <StayCard key={stay.id} stay={stay} />
            ))}
          </ul>
        </section>
      ) : null}
    </AccountShell>
  );
}

/**
 * One stay, as a link to the surface that owns it.
 *
 * The reference is encoded because it is composed into an address — it is the
 * property's own string and not a credential, and `/bookings/<reference>` is
 * where the guest's confirmation already sent them.
 */
function StayCard({ stay }: { readonly stay: OwnStay }) {
  const checkIn = parseDate(stay.checkIn);
  const checkOut = parseDate(stay.checkOut);
  const nights = nightCount({ checkIn, checkOut });
  const standing = standingOf(stay.state);

  return (
    <li className={styles.item}>
      <a
        className={styles.card}
        href={`/bookings/${encodeURIComponent(stay.reference)}`}
      >
        <span className={styles.head}>
          <span className={`${styles.room} font-display`}>
            {roomType(stay.roomType).name}
          </span>
          <span className={styles.badge} data-tone={standing.tone}>
            {standing.label}
          </span>
        </span>

        <span className={styles.dates}>
          {longDate(checkIn)} — {longDate(checkOut)}
        </span>

        <span className={styles.meta}>
          {nights === 1 ? "1 night" : `${nights} nights`} ·{" "}
          <span className={styles.reference}>{stay.reference}</span>
        </span>
      </a>
    </li>
  );
}

/** "19 August 2026" — the property's own date, never the browser's instant. */
function longDate(date: ReturnType<typeof parseDate>): string {
  // "UTC" is safe here and only here: a `CalendarDate` converted at UTC midnight
  // formats as itself, which is the point. A browser at UTC+9 parsing the ISO
  // text and formatting locally renders the day before, silently, for exactly
  // the guests most likely to book a resort in Vietnam.
  return DAY.format(date.toDate("UTC"));
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
