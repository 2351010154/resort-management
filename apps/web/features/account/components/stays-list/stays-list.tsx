"use client";

// `/account/stays` — every stay this account has taken, and the ones to come.
//
// **The list only navigates.** `screens.md` §Account is explicit: cancelling an
// upcoming stay and leaving post-stay feedback both happen on
// `/bookings/<reference>`, the one surface that owns a stay's full context and
// knows which of those its state allows. A line that offered a cancel button
// here would be a second place for that decision to be made, kept in step with
// the first by hand. So every stay leads there and nothing else does anything.
//
// **The page runs the way a guest looks.** The two groups and their order are
// `stay-history.ts`'s — what is coming, forwards, then what has been,
// backwards. What is coming is set large, the way the profile sets the next
// stay (`stay-feature.tsx`), because those are the stays a guest is still
// planning around; what has been is a register in one panel, broken by year,
// because "the one in 2025" is how a person remembers a holiday. Today is the
// property's own date rather than the browser's, because a guest reading this
// in Auckland must see the same two groups as one reading it in Lisbon.
//
// **The head states the tally** — what is ahead, the stays taken and the
// nights in them — each a labelled figure, never a line of counts run together.
//
// The profile is read alongside the list for one reason: the member card in
// the head is cut with the guest's name and standing. A profile that cannot be
// read leaves the card uncut and the page otherwise whole.

import { parseDate, today } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { useEffect, useState } from "react";
import { AccountFrame } from "@/features/account/components/account-frame/account-frame";
import {
  AccountHeading,
  type HeadingFact,
} from "@/features/account/components/account-frame/account-heading";
import { CircleLink } from "@/features/account/components/account-frame/circle-link";
import type { MemberCardFacts } from "@/features/account/components/account-frame/member-card";
import { Panel } from "@/features/account/components/account-frame/panel";
import {
  StayFeature,
  StayInvitation,
} from "@/features/account/components/stay-feature/stay-feature";
import { readProfile } from "@/features/account/lib/profile";
import { stayHistory, staysTaken } from "@/features/account/lib/stay-history";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { StayRow } from "./stay-row";
import styles from "./stays-list.module.css";

export function StaysList() {
  const [stays, setStays] = useState<readonly OwnStay[]>();
  const [card, setCard] = useState<MemberCardFacts>();
  const [refusal, setRefusal] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    // Both at once: neither waits on the other, and the list is drawn
    // whether or not the card can be cut.
    void Promise.all([readStays(), readProfile()]).then(
      ([outcome, profileOutcome]) => {
        if (!live) {
          return;
        }

        if (outcome.ok) {
          setStays(outcome.stays);
        } else {
          setRefusal(outcome.message);
        }

        if (profileOutcome.ok) {
          setCard({
            name: profileOutcome.profile.fullName,
            tier: profileOutcome.profile.vipTier,
          });
        }

        setLoading(false);
      },
    );

    return () => {
      live = false;
    };
  }, []);

  if (loading) {
    return (
      <AccountFrame
        card={undefined}
        heading={<AccountHeading hiddenTitle="Your stays" />}
        here="stays"
      >
        <p className={styles.waiting}>Reading your stays.</p>
      </AccountFrame>
    );
  }

  // No list, and one way to arrive at that: a browser with no session, or one
  // whose session has ended. An account with no stays is a different answer
  // entirely, and it is below.
  if (!stays) {
    return (
      <AccountFrame
        card={card}
        heading={<AccountHeading title="Your stays" />}
        here="stays"
      >
        <Panel title="Your bookings">
          <p className={`${styles.awayLine} font-display`} role="alert">
            {refusal}
          </p>
          <div>
            <CircleLink href="/login">Log in</CircleLink>
          </div>
        </Panel>
      </AccountFrame>
    );
  }

  const now = today(PROPERTY_TIME_ZONE);
  const { upcoming, past } = stayHistory(stays, now.toString());

  return (
    <AccountFrame
      card={card}
      heading={
        <AccountHeading
          facts={stays.length > 0 ? tally(upcoming.length, stays) : []}
          title="Your stays"
        />
      }
      here="stays"
    >
      <Panel title="Coming up">
        {upcoming.length > 0 ? (
          upcoming.map((stay) => (
            <StayFeature key={stay.id} roomAs="h3" stay={stay} today={now} />
          ))
        ) : stays.length > 0 ? (
          <StayInvitation title="Until you return." />
        ) : (
          // The one line on the page that tells a guest what to do: a stay
          // booked before the account existed is claimed from its email.
          <StayInvitation
            note="Booked before you had an account? Open the link in your confirmation email."
            title="Until you arrive."
          />
        )}
      </Panel>

      {past.length > 0 ? (
        <Panel title="Past stays">
          {byYear(past).map(([year, group]) => (
            <section
              aria-labelledby={`stays-${year}`}
              className={styles.year}
              key={year}
            >
              <h3
                className={`${styles.yearMark} font-display`}
                id={`stays-${year}`}
              >
                {year}
              </h3>
              <ul className={styles.list}>
                {group.map((stay) => (
                  <StayRow key={stay.id} stay={stay} />
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      ) : null}
    </AccountFrame>
  );
}

/** The head's three figures: what is ahead, and what is behind. */
function tally(
  upcoming: number,
  stays: readonly OwnStay[],
): readonly HeadingFact[] {
  const taken = staysTaken(stays);

  return [
    { label: "Upcoming", value: String(upcoming) },
    { label: "Stays taken", value: String(taken.stays) },
    { label: "Nights with us", value: String(taken.nights) },
  ];
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
