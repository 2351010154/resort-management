"use client";

// `/account/stays` — every stay this account has taken.
//
// **The list only navigates.** `screens.md` §Account is explicit: cancelling an
// upcoming stay and leaving post-stay feedback both happen on
// `/bookings/<reference>`, the one surface that owns a stay's full context and
// knows which of those its state allows. A card that offered a
// cancel button here would be a second place for that decision to be made, kept
// in step with the first by hand. The rail is held to the same rule: it states
// what the two groups add up to and offers the way back into the funnel, and
// nothing in it acts on a stay either.
//
// So every card is a link and nothing else, and the whole card is the link
// rather than a word inside it: the target is one stay, and a guest reaching for
// it on a phone should not have to find the four characters that were
// underlined.
//
// **The card says what the payload already knows.** `plan`, `adults`,
// `childAges` and `stayTotalGross` all arrive with every stay and were being
// dropped on the floor — a guest scanning six bookings for the one that was the
// week with the children, or the expensive one, had to open each in turn. What
// is *not* here is the room number, because a guest books a room type and the
// number is assigned at check-in, and any breakdown of the total, because
// `listOwn` answers one gross figure and components of it would be arithmetic
// the API never sent.
//
// The two groups and their order are `stay-history.ts`'s, and argued there. What
// this file adds is today — the property's own date rather than the browser's,
// because a guest reading this in Auckland must see the same two groups as one
// reading it in Lisbon.

import { parseDate, today } from "@internationalized/date";
import {
  nightCount,
  PROPERTY_TIME_ZONE,
  roundVndForDisplay,
} from "@mariva/shared";
import { useEffect, useState } from "react";
import { AccountShell } from "@/features/account/components/account-shell/account-shell";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { Money } from "@/features/booking/components/money";
import { planName } from "@/features/booking/lib/rate-plans";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./stays-list.module.css";

const SUBTITLE =
  "What is coming, and what has been. Each one opens the stay it belongs to.";

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

  // The three states below pass no `aside` and so keep the measure: a rail that
  // counts stays has nothing to count until they have been read, and an empty
  // frame beside a sentence is worse than no frame at all.
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

  if (stays.length === 0) {
    return (
      <AccountShell here="stays" subtitle={SUBTITLE} title="Your stays">
        <div className={styles.empty}>
          <p className={styles.notice}>
            Nothing under this account yet. A stay you booked before you had one
            is kept with the link in its confirmation email. Open that link and
            the stay comes with you.
          </p>
          <a className={`${styles.book} caps-label`} href="/booking">
            Book a stay
          </a>
        </div>
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
      leftRail={<StaysRail ahead={upcoming.length} taken={past.length} />}
      leftRailLabel="Stay overview"
      subtitle={SUBTITLE}
      title="Your stays"
    >
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
 * The rail: what the list adds up to, and the way back into the funnel.
 *
 * Both figures are the two groups the page has already made, counted — nothing
 * is fetched for the rail and nothing in it is a control over a stay. It is the
 * `Options` panel of the reference screens with the only option this screen is
 * allowed to offer.
 */
function StaysRail({
  ahead,
  taken,
}: {
  readonly ahead: number;
  readonly taken: number;
}) {
  return (
    <div className={styles.rail}>
      <p className={styles.railSummary}>
        {aheadClause(ahead)}. {historyClause(taken)}.
      </p>

      <div className={styles.railFoot}>
        <a className={`${styles.book} caps-label`} href="/booking">
          Book a stay
        </a>
      </div>
    </div>
  );
}

/** "Two stays are coming up" — the first half of the rail's sentence. */
function aheadClause(count: number): string {
  if (count === 0) {
    return "Nothing is coming up";
  }

  return count === 1 ? "One stay is coming up" : `${count} stays are coming up`;
}

/** "Three stays are in your history" — includes completed and cancelled stays. */
function historyClause(count: number): string {
  if (count === 0) {
    return "Nothing is in your history yet";
  }

  return count === 1
    ? "One stay is in your history"
    : `${count} stays are in your history`;
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
          {longDate(checkIn)} – {longDate(checkOut)}
        </span>

        <span className={styles.tags}>
          <span className={styles.tag}>{planName(stay.plan)}</span>
        </span>

        <span className={styles.foot}>
          <span className={styles.specs}>
            {occupancySpecs(nights, stay.adults, stay.childAges.length).map(
              (spec) => (
                <span className={styles.spec} key={spec}>
                  {spec}
                </span>
              ),
            )}
            <span className={`${styles.spec} ${styles.reference}`}>
              {stay.reference}
            </span>
          </span>

          {/* `lining-nums` travels with `.font-display` — see `.price`. */}
          <span className={`${styles.price} font-display`}>
            <Money amount={roundVndForDisplay(stay.stayTotalGross)} />
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * "3 nights", "2 adults", "1 child" — the spec row, in reading order.
 *
 * Children are omitted rather than printed as a zero: "0 children" is a fact
 * about a form field and not about a stay, and most stays have none.
 */
function occupancySpecs(
  nights: number,
  adults: number,
  children: number,
): readonly string[] {
  const specs = [
    nights === 1 ? "1 night" : `${nights} nights`,
    adults === 1 ? "1 adult" : `${adults} adults`,
  ];

  if (children > 0) {
    specs.push(children === 1 ? "1 child" : `${children} children`);
  }

  return specs;
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
