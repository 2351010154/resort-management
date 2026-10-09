"use client";

// `/account` — the guest's own record of themselves, as the house keeps it.
//
// **The route is the profile, not a doorway to one.** `screens.md` §Account is
// explicit: `/account` is personal data, VIP tier and loyalty, and
// `/account/stays` is the history beside it.
//
// **A centred page in three parts, and no copy that explains it.** The head
// greets the guest by name with the three figures a member reads at a glance —
// their standing, their points and the month the account began — and their
// member card opposite. Under it the next stay, set large. Then the two things
// a guest keeps up here, side by side: the details the next stay will use,
// with the identity document the desk keeps, and how they sign in. Every part
// states facts; none of them carries a paragraph about itself.
//
// **Nothing here is a permission.** The tier and the points are read-only
// because no route exists to write them — `FR-GST-04` derives one from the
// trailing twelve months and `FR-GST-05` sums the other off an append-only
// ledger — so they are stated as facts in the head and never offered as a
// control. The two credential forms are hidden from a Google-only account
// rather than disabled, because `guest-auth.factory.ts` refuses both at the
// API — a page that omits a control is a page, and the request it omits can
// still be sent.

import { useEffect, useState } from "react";
import { AccountFrame } from "@/features/account/components/account-frame/account-frame";
import {
  AccountHeading,
  type HeadingFact,
} from "@/features/account/components/account-frame/account-heading";
import { CircleLink } from "@/features/account/components/account-frame/circle-link";
import { Panel } from "@/features/account/components/account-frame/panel";
import {
  type Profile,
  hasPassword as readHasPassword,
  readProfile,
} from "@/features/account/lib/profile";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { tierName } from "@/features/account/lib/tiers";
import { DetailsPanel } from "./details-form";
import { NextStay } from "./next-stay";
import styles from "./profile-screen.module.css";
import { SignInSettings } from "./sign-in-settings";

/** Points are a count rather than an amount, so they are grouped and not
 *  formatted as money — there is no currency and nothing to redeem them for. */
const POINTS = new Intl.NumberFormat("en-US");

/**
 * When the account began, to the month.
 *
 * A month and a year rather than a day: this is provenance over a name, and
 * the day the account was opened is a fact nobody on this screen acts on.
 * `en-GB` because the rest of the guest realm formats dates in it, and an
 * ordinary `Date` because `createdAt` is a real instant — the stay dates
 * elsewhere are `CalendarDate` text and must never be parsed this way.
 */
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

export function ProfileScreen() {
  const [profile, setProfile] = useState<Profile>();
  const [stays, setStays] = useState<readonly OwnStay[]>();
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refusal, setRefusal] = useState<string>();

  useEffect(() => {
    let live = true;

    // All three at once: they answer different realms — the profile and the
    // stays are the contract's, the account list is Better Auth's — and none
    // of them waits on another.
    void Promise.all([readProfile(), readHasPassword(), readStays()]).then(
      ([outcome, password, stayOutcome]) => {
        if (!live) {
          return;
        }

        if (stayOutcome.ok) {
          setStays(stayOutcome.stays);
        }

        if (outcome.ok) {
          setProfile(outcome.profile);
        } else {
          setRefusal(outcome.message);
        }

        setHasPassword(password);
        setLoading(false);
      },
    );

    return () => {
      live = false;
    };
  }, []);

  // Nothing read yet: the card is on the page and uncut, and the name is set
  // once, when it is known, rather than "Your profile" first and a name after.
  if (loading) {
    return (
      <AccountFrame
        card={undefined}
        heading={<AccountHeading hiddenTitle="Your profile" />}
        here="profile"
      >
        <p className={styles.waiting}>Reading your account.</p>
      </AccountFrame>
    );
  }

  // No profile, and one way to arrive at that: a browser with no session, or
  // one whose session has ended. The API's own sentence says which, and the
  // way forward is the same either way.
  if (!profile) {
    return (
      <AccountFrame
        card={undefined}
        heading={<AccountHeading title="Your profile" />}
        here="profile"
      >
        <Panel title="Your details">
          <p className={`${styles.awayLine} font-display`} role="alert">
            {refusal}
          </p>
          <div className={styles.actions}>
            <CircleLink href="/login">Log in</CircleLink>
          </div>
        </Panel>
      </AccountFrame>
    );
  }

  return (
    <AccountFrame
      card={{ name: profile.fullName, tier: profile.vipTier }}
      heading={
        <AccountHeading
          facts={headingFacts(profile)}
          greeting="Welcome back,"
          title={profile.fullName}
        />
      }
      here="profile"
    >
      {stays ? <NextStay stays={stays} /> : null}

      <div className={styles.grid}>
        <DetailsPanel onSaved={setProfile} profile={profile} />

        <Panel title="Signing in">
          <SignInSettings email={profile.email} hasPassword={hasPassword} />
        </Panel>
      </div>
    </AccountFrame>
  );
}

/**
 * The three figures the head states: where the guest stands, their points,
 * and the month the account began when it can be read.
 *
 * `BigInt` accepts the integer and the decimal text alike, so this reads the
 * same figure whichever the transport hands back — `stay-funnel.ts` makes the
 * same crossing for a stay's total.
 */
function headingFacts(profile: Profile): readonly HeadingFact[] {
  const facts: HeadingFact[] = [
    { label: "Standing", value: tierName(profile.vipTier) },
    {
      label: "Loyalty points",
      value: POINTS.format(BigInt(profile.loyaltyPoints)),
    },
  ];
  const since = memberSince(profile.createdAt);

  if (since) {
    facts.push({ label: "Member since", value: since });
  }

  return facts;
}

/**
 * The month the account was opened, or nothing.
 *
 * `createdAt` is declared `z.iso.datetime()` and arrives validated, so the
 * `NaN` branch is not a case the API can produce today. It is here because the
 * alternative when it is wrong is the words "Invalid Date" beside the guest's
 * own name, and a provenance line that cannot be trusted is better absent than
 * wrong.
 */
function memberSince(createdAt: string): string | undefined {
  const opened = new Date(createdAt);

  return Number.isNaN(opened.getTime()) ? undefined : MONTH.format(opened);
}
