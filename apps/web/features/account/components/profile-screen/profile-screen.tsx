"use client";

// `/account` — the guest's own record of themselves, as the house keeps it.
//
// **The route is the profile, not a doorway to one.** `screens.md` §Account is
// explicit: `/account` is personal data, VIP tier and loyalty, and
// `/account/stays` is the history beside it.
//
// **The stone and the book.** The screen stands in `AccountFrame`: the guest's
// name cut into a limestone pillar (`profile-inscription.tsx`) and nothing
// else, and beside it an ivory book of five numbered chapters — the next stay,
// the guest's standing, the details the next stay will use, how they sign in,
// and what the desk keeps on file. The two meet at a seam; nothing on the page is laid over
// anything else.
//
// **What a guest cannot change is stated beside the thing it belongs to.** The
// address sits with the credential rows, the masked document in its own
// chapter, and the derived tier and points in the standing chapter, with the
// sentence that says how they are worked out.
//
// **Nothing here is a permission.** The tier and the points are read-only
// because no route exists to write them — `FR-GST-04` derives one from the
// trailing twelve months and `FR-GST-05` sums the other off an append-only
// ledger. The document number is masked because `guestProfileSchema` carries no
// field an unmasked one could travel in, and there is no reveal control because
// `FR-GST-03` makes unmasking an audited staff capability. The two credential
// forms are hidden from a Google-only account rather than disabled, because
// `guest-auth.factory.ts` refuses both at the API — a page that omits a control
// is a page, and the request it omits can still be sent.

import { useEffect, useState } from "react";
import { AccountFrame } from "@/features/account/components/account-frame/account-frame";
import { Chapter } from "@/features/account/components/account-frame/chapter";
import {
  type Profile,
  hasPassword as readHasPassword,
  readProfile,
} from "@/features/account/lib/profile";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { DetailsChapter } from "./details-form";
import { NextStay } from "./next-stay";
import { ProfileInscription } from "./profile-inscription";
import styles from "./profile-screen.module.css";
import { SignInSettings } from "./sign-in-settings";
import { StandingLadder } from "./standing-ladder";

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

  // Nothing read yet: the wall is up and uncut, so the name is carved once,
  // when it is known, rather than "Your profile" first and a name after it.
  if (loading) {
    return (
      <AccountFrame
        here="profile"
        stone={<ProfileInscription name={undefined} />}
      >
        <p className={styles.notice}>Reading your account.</p>
      </AccountFrame>
    );
  }

  // No profile, and one way to arrive at that: a browser with no session, or
  // one whose session has ended. The API's own sentence says which, and the
  // way forward is the same either way.
  if (!profile) {
    return (
      <AccountFrame
        here="profile"
        stone={<ProfileInscription name="Your profile" />}
      >
        <div className={styles.away}>
          <p className={`${styles.awayLine} font-display`}>
            The property could not read your details.
          </p>
          <p className={styles.error} role="alert">
            {refusal}
          </p>
          <p className={styles.footnote}>
            <a className={styles.footnoteLink} href="/login">
              Log in
            </a>{" "}
            and your details are here waiting.
          </p>
        </div>
      </AccountFrame>
    );
  }

  const since = memberSince(profile.createdAt);
  // `BigInt` accepts the integer and the decimal text alike, so this reads the
  // same figure whichever the transport hands back — `stay-funnel.ts` makes
  // the same crossing for a stay's total.
  const points = POINTS.format(BigInt(profile.loyaltyPoints));
  // The chapters are numbered in the order they stand, and the next stay is
  // only there when the stays could be read.
  const first = stays ? 2 : 1;

  return (
    <AccountFrame
      here="profile"
      stone={<ProfileInscription name={profile.fullName} />}
    >
      {stays ? <NextStay number="01" stays={stays} /> : null}

      {/* Second, so the guest's standing — once cut into the stone — is
          still the first thing the book says about them after their stay. */}
      <Chapter
        lede="Your standing is worked out from the stays of the last twelve months, and nobody at the property can set it by hand. Silver and Gold are quoted a member rate when they book signed in."
        line="Earned by staying."
        name="Your standing"
        number={chapterNumber(first)}
      >
        <StandingLadder
          memberSince={since}
          points={points}
          tier={profile.vipTier}
        />
      </Chapter>

      <DetailsChapter
        number={chapterNumber(first + 1)}
        onSaved={setProfile}
        profile={profile}
      />

      <Chapter
        lede={
          hasPassword
            ? "The address you sign in with, and your password."
            : "The address this account answers to."
        }
        line="Your key to the house."
        name="Signing in"
        number={chapterNumber(first + 2)}
      >
        <SignInSettings email={profile.email} hasPassword={hasPassword} />
      </Chapter>

      <Chapter
        lede="The desk records this from the physical document at check-in. It cannot be added, changed or revealed from your account."
        line="What the desk keeps."
        name="On file"
        number={chapterNumber(first + 3)}
      >
        {/* Read-only and masked. There is deliberately no add, edit, upload or
            reveal control on the guest surface. */}
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={`${styles.rowLabel} caps-label`}>
              Identity document
            </dt>
            <dd
              className={`${styles.rowValue} ${styles.figures} font-display`}
              data-empty={profile.cccdMasked ? undefined : ""}
            >
              {profile.cccdMasked ?? "None recorded"}
            </dd>
          </div>
        </dl>
      </Chapter>
    </AccountFrame>
  );
}

/** "02" — the book's chapters are numbered in two digits, as the landing's are. */
function chapterNumber(index: number): string {
  return String(index).padStart(2, "0");
}

/**
 * The month the account was opened, or nothing.
 *
 * `createdAt` is declared `z.iso.datetime()` and arrives validated, so the
 * `NaN` branch is not a case the API can produce today. It is here because the
 * alternative when it is wrong is the words "Invalid Date" over the guest's own
 * name, and a provenance line that cannot be trusted is better absent than
 * wrong.
 */
function memberSince(createdAt: string): string | undefined {
  const opened = new Date(createdAt);

  return Number.isNaN(opened.getTime()) ? undefined : MONTH.format(opened);
}
