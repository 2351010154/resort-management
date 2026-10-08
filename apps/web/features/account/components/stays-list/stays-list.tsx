"use client";

// `/account/stays` — every stay this account has taken, as a register beside
// the stone.
//
// **The list only navigates.** `screens.md` §Account is explicit: cancelling an
// upcoming stay and leaving post-stay feedback both happen on
// `/bookings/<reference>`, the one surface that owns a stay's full context and
// knows which of those its state allows. A line that offered a cancel button
// here would be a second place for that decision to be made, kept in step with
// the first by hand. So every line is a link and nothing else
// (`stay-row.tsx`).
//
// **The stone holds the page's name and one room.** An arch cut through it
// shows the room of whichever stay the guest is reading
// (`stays-inscription.tsx`); nothing else is cut there, because the stone is
// the heavy half of the page. Nothing is fetched for it and nothing on it is a
// control over a stay.
//
// **The register runs the way a guest looks.** The two groups and their order
// are `stay-history.ts`'s — what is coming, forwards, then what has been,
// backwards — and the history is broken by year, because "the one in 2025" is
// how a person remembers a holiday. Today is the property's own date rather
// than the browser's, because a guest reading this in Auckland must see the
// same two groups as one reading it in Lisbon.

import { parseDate, today } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { useEffect, useState } from "react";
import { AccountFrame } from "@/features/account/components/account-frame/account-frame";
import type { ArchPicture } from "@/features/account/components/account-frame/arch-frame";
import { Chapter } from "@/features/account/components/account-frame/chapter";
import { CircleLink } from "@/features/account/components/account-frame/circle-link";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { BOOKING_HERO } from "@/features/booking/lib/booking-hero";
import {
  roomLead,
  tierSrc,
  tierSrcSet,
} from "@/features/booking/lib/room-images";
import { StayRow } from "./stay-row";
import { StaysInscription } from "./stays-inscription";
import styles from "./stays-list.module.css";

/** The property at dusk, for an account with nothing to show in the arch. */
const DUSK: ArchPicture = {
  key: "dusk",
  src: tierSrc(BOOKING_HERO.src, 1280),
  srcSet: tierSrcSet(BOOKING_HERO),
  width: BOOKING_HERO.width,
  height: BOOKING_HERO.height,
  alt: BOOKING_HERO.alt,
  // The open door of the court, which is what an arch-shaped crop of a wide
  // dusk photograph should be standing on.
  position: "56% 50%",
};

export function StaysList() {
  const [stays, setStays] = useState<readonly OwnStay[]>();
  const [refusal, setRefusal] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<OwnStay["id"]>();

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
      <AccountFrame
        here="stays"
        stone={<StaysInscription active={undefined} pictures={[]} />}
      >
        <p className={styles.notice}>Reading your stays.</p>
      </AccountFrame>
    );
  }

  // No list, and one way to arrive at that: a browser with no session, or one
  // whose session has ended. An account with no stays is a different answer
  // entirely, and it is below.
  if (!stays) {
    return (
      <AccountFrame
        here="stays"
        stone={<StaysInscription active={undefined} pictures={[]} />}
      >
        <div className={styles.close}>
          <p className={`${styles.closeLine} font-display`}>
            The property could not read your bookings.
          </p>
          <p className={styles.error} role="alert">
            {refusal}
          </p>
          <p className={styles.footnote}>
            <a className={styles.footnoteLink} href="/login">
              Log in
            </a>{" "}
            and your stays are here waiting.
          </p>
        </div>
      </AccountFrame>
    );
  }

  if (stays.length === 0) {
    return (
      <AccountFrame
        here="stays"
        stone={<StaysInscription active="dusk" pictures={[DUSK]} />}
      >
        <div className={styles.close}>
          <p className={`${styles.closeLine} font-display`}>
            Until you arrive.
          </p>
          <p className={styles.hint}>
            Nothing is under this account yet. A stay you booked before you had
            one is kept with the link in its confirmation email. Open that link
            and the stay comes with you.
          </p>
          <CircleLink href="/booking">Choose your dates</CircleLink>
        </div>
      </AccountFrame>
    );
  }

  const { upcoming, past } = stayHistory(
    stays,
    today(PROPERTY_TIME_ZONE).toString(),
  );
  // The first line of the register until the guest points at another.
  const showing =
    stays.find((stay) => stay.id === shown) ?? upcoming[0] ?? past[0];
  const years = byYear(past);
  const first = upcoming.length > 0 ? 2 : 1;

  return (
    <AccountFrame
      here="stays"
      stone={
        <StaysInscription
          active={showing?.roomType}
          muted={showing ? standingOf(showing.state).tone === "off" : false}
          pictures={roomsOf(stays)}
        />
      }
    >
      {upcoming.length > 0 ? (
        <Chapter line="What is ahead of you." name="Coming up" number="01">
          <ul className={styles.list}>
            {upcoming.map((stay) => (
              <StayRow key={stay.id} onShow={setShown} stay={stay} />
            ))}
          </ul>
        </Chapter>
      ) : null}

      {past.length > 0 ? (
        <Chapter
          line="Where you have been."
          name="Before this"
          number={String(first).padStart(2, "0")}
        >
          {years.map(([year, group]) => (
            <section
              aria-label={String(year)}
              className={styles.year}
              key={year}
            >
              <p
                aria-hidden="true"
                className={`${styles.yearMark} font-display`}
              >
                {year}
              </p>
              <ul className={styles.list}>
                {group.map((stay) => (
                  <StayRow key={stay.id} onShow={setShown} stay={stay} />
                ))}
              </ul>
            </section>
          ))}
        </Chapter>
      ) : null}

      <div className={styles.close}>
        <p className={`${styles.closeLine} font-display`}>
          The calendar is open.
        </p>
        <CircleLink href="/booking">Choose your dates</CircleLink>
      </div>
    </AccountFrame>
  );
}

/** One picture per room type the account has stayed in, for the arch. */
function roomsOf(stays: readonly OwnStay[]): readonly ArchPicture[] {
  const codes = [...new Set(stays.map((stay) => stay.roomType))];

  return codes.map((code) => {
    const frame = roomLead(code);

    return {
      key: code,
      src: tierSrc(frame.src, 1280),
      srcSet: tierSrcSet(frame),
      width: frame.width,
      height: frame.height,
      alt: frame.alt,
    };
  });
}

/** The past stays in their years, most recent year first — the order they
 *  already come in, broken where the arrival year changes. */
function byYear(
  stays: readonly OwnStay[],
): readonly (readonly [number, readonly OwnStay[]])[] {
  const groups: [number, OwnStay[]][] = [];

  for (const stay of stays) {
    const year = parseDate(stay.checkIn).year;
    const last = groups.at(-1);

    if (last && last[0] === year) {
      last[1].push(stay);
    } else {
      groups.push([year, [stay]]);
    }
  }

  return groups;
}
