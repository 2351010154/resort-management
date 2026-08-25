"use client";

// `/account` — the guest's own record of themselves.
//
// **The route is the profile, not a doorway to one.** `screens.md` §Account is
// explicit: `/account` is personal data, VIP tier and loyalty, and
// `/account/stays` is the history beside it. A redirect here would make the
// area's front door a page that shows nothing.
//
// **The four editable fields are shown as the form.** A definition list of the
// same names above a form holding the same values is the same fact twice, and
// the pair drift the moment one is saved and the other is not repainted. So the
// boxes are the display, and what a guest cannot change is stated beside the
// thing it belongs to: the address sits with credential controls, and the
// property's masked document record sits in its own read-only plate.
//
// **The ledger is the house, not a second copy of the guest.** The narrow
// column before the form holds what the property offers — the collection, the
// three perks a tier carries, the stays already taken. It used to open with the
// guest's own name and address, which are already under the membership title
// and in the first box of the form; a third printing was the one thing on the
// screen that told a guest nothing they had not just read. It is outlined
// rather than filled for the reason its stylesheet gives: a wash would make it
// a third plate, and it is a boundary around an aside.
//
// **The two derived figures are the rail.** The tier and the points are the one
// part of this screen nobody is working on — they are read off a history — so
// they belong beside the form rather than above it, which is the arrangement
// `AccountShell` offers and `details-screen.module.css` already sets the
// funnel's review screen to. Stacked in the measure they read as preamble to
// scroll past.
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

import { parseDate, today } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import Image from "next/image";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { AccountShell } from "@/features/account/components/account-shell/account-shell";
import {
  type Profile,
  hasPassword as readHasPassword,
  readProfile,
  saveProfile,
} from "@/features/account/lib/profile";
import {
  hasEdits,
  type ProfileFields,
  profileEdits,
} from "@/features/account/lib/profile-edits";
import { standingOf, stayHistory } from "@/features/account/lib/stay-history";
import { type OwnStay, readStays } from "@/features/account/lib/stays";
import { roomType } from "@/features/booking/lib/room-types";
import styles from "./profile-form.module.css";
import { SignInSettings } from "./sign-in-settings";

/** The three rungs of `property-and-tariff.md` §7, as a guest is shown them. */
const TIERS: Readonly<Record<string, string>> = {
  MEMBER: "Member",
  SILVER: "Silver",
  GOLD: "Gold",
};

/** Points are a count rather than an amount, so they are grouped and not
 *  formatted as money — there is no currency and nothing to redeem them for. */
const points = new Intl.NumberFormat("en-US");

/**
 * When the account began, to the month.
 *
 * A month and a year rather than a day: this is provenance under a title, and
 * the day the account was opened is a fact nobody on this screen acts on.
 *
 * `en-GB` because the rest of the guest realm formats dates in it —
 * `stays-list.tsx` and `details-screen.tsx` both do — and an ordinary `Date`
 * because `createdAt` is a real instant. The stay dates elsewhere in this app
 * are `CalendarDate` text and must never be parsed this way; this one is a full
 * ISO datetime and this is the correct reading of it.
 */
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile>();
  const [fields, setFields] = useState<ProfileFields>();
  const [stays, setStays] = useState<readonly OwnStay[]>();
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refusal, setRefusal] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;

    // Both reads at once: they answer different realms — the profile is the
    // contract's and the account list is Better Auth's — and neither waits on
    // the other.
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
          setFields(boxes(outcome.profile));
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || !profile || !fields) {
      return;
    }

    const edits = profileEdits(profile, fields);

    setSaved(false);
    setRefusal(undefined);

    // Said here rather than sent. A PATCH carrying no field writes nothing and
    // answers 200, which reads back to the guest as a save that happened.
    if (!hasEdits(edits)) {
      setSaved(true);

      return;
    }

    setPending(true);

    const outcome = await saveProfile(edits);

    if (outcome.ok) {
      setProfile(outcome.profile);
      setFields(boxes(outcome.profile));
      setSaved(true);
    } else {
      setRefusal(outcome.message);
    }

    setPending(false);
  }

  // Nothing read yet, so no rail and no provenance line: the shell keeps the
  // measure rather than setting one sentence against an empty column.
  if (loading) {
    return (
      <AccountShell
        here="profile"
        subtitle="One moment while the property reads your details."
        title="Your profile"
      >
        <section className={styles.plate}>
          <p className={styles.notice}>Reading your account.</p>
        </section>
      </AccountShell>
    );
  }

  // No profile, and one way to arrive at that: a browser with no session, or one
  // whose session has ended. The API's own sentence says which, and the way
  // forward is the same either way.
  if (!profile || !fields) {
    return (
      <AccountShell
        here="profile"
        subtitle="The property could not read your details."
        title="Your profile"
      >
        <section className={styles.plate}>
          <p className={styles.error} role="alert">
            {refusal}
          </p>
          <p className={styles.footnote}>
            <a className={styles.footnoteLink} href="/login">
              Log in
            </a>{" "}
            and your details are here waiting.
          </p>
        </section>
      </AccountShell>
    );
  }

  const since = memberSince(profile.createdAt);

  return (
    <AccountShell
      aside={
        <section className={styles.railPlate}>
          <span aria-hidden="true" className={styles.railMonogram} />

          <h2 className={`${styles.railTitle} caps-label`}>Membership</h2>

          <div className={styles.railIdentity}>
            <p className={`${styles.guestName} font-display`}>
              {profile.fullName}
            </p>
            {since ? (
              <p className={styles.memberSince}>Member since {since}</p>
            ) : null}
          </div>

          <div className={styles.membershipGrid}>
            <div className={styles.membershipItem}>
              <p className={styles.pointsTerm}>Standing</p>
              {/* Tinted rather than outlined — the tier is a standing, and a
                  wash carries three rungs where three outlines would all read
                  alike. */}
              <p
                className={`${styles.tier} caps-label`}
                data-tier={profile.vipTier}
              >
                {TIERS[profile.vipTier] ?? profile.vipTier}
              </p>
            </div>

            <div className={styles.membershipItem}>
              <p className={styles.pointsTerm}>Loyalty points</p>
              {/* `BigInt` accepts the integer and the decimal text alike, so
                  this reads the same figure whichever the transport hands
                  back — `stay-funnel.ts` makes the same crossing for a stay's
                  total. */}
              <p className={`${styles.pointsFigure} font-display`}>
                {points.format(BigInt(profile.loyaltyPoints))}
              </p>
            </div>
          </div>

          <p className={styles.railNote}>
            Your tier and your points are worked out from the stays you have
            taken. Nobody at the property can adjust either, and there is
            nothing to spend them on.
          </p>

          <a className={`${styles.railLink} caps-label`} href="/account/stays">
            View your stays
            <span aria-hidden="true" className={styles.railArrow} />
          </a>
        </section>
      }
      asideLabel="Membership"
      here="profile"
      leftRail={<ProfileLedger stays={stays} />}
      leftRailLabel="Account overview"
      subtitle="What the property knows about you, outside any single stay."
      title="Your profile"
    >
      <section className={styles.plate} id="profile-details">
        <h2 className={`${styles.plateTitle} caps-label`}>Your details</h2>

        <form
          aria-busy={pending}
          className={`${styles.form} ${styles.detailsForm}`}
          onSubmit={onSubmit}
        >
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fullName">
              Full name
            </label>
            <input
              autoComplete="name"
              className={styles.input}
              disabled={pending}
              id="fullName"
              maxLength={120}
              name="fullName"
              onChange={(event) =>
                setFields({ ...fields, fullName: event.target.value })
              }
              type="text"
              value={fields.fullName}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="phone">
              Phone
            </label>
            <input
              autoComplete="tel"
              className={styles.input}
              disabled={pending}
              id="phone"
              maxLength={30}
              name="phone"
              onChange={(event) =>
                setFields({ ...fields, phone: event.target.value })
              }
              type="tel"
              value={fields.phone}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="dateOfBirth">
              Date of birth
            </label>
            {/* A date input, so the nine characters the contract's codec decodes
                are what the browser produces — a free-text box here would send
                whatever a guest's own date convention happens to be. */}
            <input
              autoComplete="bday"
              className={styles.input}
              disabled={pending}
              id="dateOfBirth"
              name="dateOfBirth"
              onChange={(event) =>
                setFields({ ...fields, dateOfBirth: event.target.value })
              }
              type="date"
              value={fields.dateOfBirth}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="nationality">
              Nationality
            </label>
            <input
              autoComplete="country-name"
              className={styles.input}
              disabled={pending}
              id="nationality"
              maxLength={60}
              name="nationality"
              onChange={(event) =>
                setFields({ ...fields, nationality: event.target.value })
              }
              type="text"
              value={fields.nationality}
            />
          </div>

          <p className={styles.hint}>
            These prefill your next booking and your next arrival. A stay you
            have already taken keeps the details it was taken with, and the desk
            still checks them against your document when you arrive.
          </p>

          {/* Announced when they arrive, because they arrive after a round
              trip. */}
          {saved ? (
            <p className={styles.notice} role="status">
              Saved.
            </p>
          ) : null}

          {refusal ? (
            <p className={styles.error} role="alert">
              {refusal}
            </p>
          ) : null}

          <button
            className={`${styles.submit} caps-label`}
            disabled={pending}
            type="submit"
          >
            {pending ? "Saving" : "Save details"}
          </button>
        </form>
      </section>

      <SignInSettings email={profile.email} hasPassword={hasPassword} />

      <section className={styles.plate} id="property-record">
        <h2 className={`${styles.plateTitle} caps-label`}>
          On file at the property
        </h2>

        {/* Read-only and masked. There is deliberately no add, edit, upload or
            reveal control on the guest surface. */}
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={styles.rowLabel}>Identity document</dt>
            <dd className={styles.rowValue}>
              {profile.cccdMasked ?? "None recorded"}
            </dd>
          </div>
        </dl>

        <p className={styles.hint}>
          The desk records this from the physical document at check-in. It
          cannot be added, changed or revealed from your account.
        </p>
      </section>
    </AccountShell>
  );
}

/**
 * The three perks `FR-GST-04` names, as a guest is told them.
 *
 * They are the requirement's own — late checkout to 14:00 when the room is
 * unsold, an upgrade at check-in when a better type is free, a welcome amenity
 * — and not a longer list assembled to fill the rail. `property-and-tariff.md`
 * §7 records all three as specified and unbuilt: nothing in the tree represents
 * a perk entitlement, and each is an operational judgement made at a moment
 * rather than a figure a route could apply.
 *
 * That is why the note under them says the desk honours them and why there is
 * no control here. A rail that offered to claim one would be offering a request
 * that reaches nothing, and a rail that listed perks the property does not owe
 * would be worse than an empty one.
 */
const BENEFITS: readonly {
  readonly term: string;
  readonly note: string;
  readonly mark: ReactNode;
}[] = [
  {
    term: "Late checkout",
    note: "To 14:00 when unsold",
    mark: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.25V12l3.25 1.9" />
      </>
    ),
  },
  {
    term: "Room upgrade",
    note: "When a better room is free",
    mark: (
      <>
        <path d="M12 19.25V6.5" />
        <path d="m6.75 11.75 5.25-5.25 5.25 5.25" />
      </>
    ),
  },
  {
    term: "Welcome amenity",
    note: "Placed before you arrive",
    mark: (
      <>
        <path d="M5.25 5.5h13.5L12 13z" />
        <path d="M12 13v6.25" />
        <path d="M8.5 19.25h7" />
      </>
    ),
  },
];

function ProfileLedger({ stays }: { readonly stays?: readonly OwnStay[] }) {
  const ordered = stays
    ? stayHistory(stays, today(PROPERTY_TIME_ZONE).toString())
    : undefined;
  const recent = ordered
    ? [...ordered.upcoming, ...ordered.past].slice(0, 3)
    : [];

  return (
    <div className={styles.ledger}>
      {/* The house, not the guest. Their name is already under the membership
          title and in the first box of the form, and a third printing of it
          here would be the one thing on the rail that says nothing new. */}
      <section className={styles.ledgerSection}>
        <h2 className={`${styles.ledgerTitle} caps-label`}>At a glance</h2>
        <div className={styles.ledgerImage}>
          <Image
            alt=""
            fill
            sizes="15rem"
            src="/images/account/profile-material-640.webp"
          />
        </div>
        <p className={styles.ledgerName}>Mariva Residences</p>
        <p className={styles.ledgerCopy}>Our private collection</p>
        <a className={`${styles.ledgerLink} caps-label`} href="/booking">
          Explore
        </a>
      </section>

      <section className={styles.ledgerSection}>
        <h2 className={`${styles.ledgerTitle} caps-label`}>Member benefits</h2>
        <ul className={styles.benefits}>
          {BENEFITS.map((benefit) => (
            <li className={styles.benefit} key={benefit.term}>
              {/* Decorative: the term beside it is the label, and a mark that
                  named itself would have the line read twice. */}
              <svg
                aria-hidden="true"
                className={styles.benefitMark}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.25"
                viewBox="0 0 24 24"
              >
                {benefit.mark}
              </svg>
              <div>
                <p className={styles.benefitTerm}>{benefit.term}</p>
                <p className={styles.benefitNote}>{benefit.note}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.ledgerNote}>
          The desk honours these on arrival. There is nothing to claim in
          advance.
        </p>
      </section>

      <section className={styles.ledgerSection}>
        <h2 className={`${styles.ledgerTitle} caps-label`}>Your stays</h2>
        {recent.length > 0 ? (
          <ol className={styles.ledgerStays}>
            {recent.map((stay) => {
              const standing = standingOf(stay.state);

              return (
                <li className={styles.ledgerStay} key={stay.id}>
                  <a
                    className={styles.ledgerStayLink}
                    href={`/bookings/${encodeURIComponent(stay.reference)}`}
                  >
                    <time dateTime={stay.checkIn}>
                      {stayMonth(stay.checkIn)}
                    </time>
                    <span>{standing.label}</span>
                    <strong>{roomType(stay.roomType).name}</strong>
                  </a>
                </li>
              );
            })}
          </ol>
        ) : stays ? (
          <p className={styles.ledgerCopy}>No stays under this account yet.</p>
        ) : null}
        <a className={`${styles.ledgerLink} caps-label`} href="/account/stays">
          View full history
        </a>
      </section>
    </div>
  );
}

function stayMonth(value: string): string {
  return STAY_MONTH.format(parseDate(value).toDate("UTC"));
}

const STAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The profile as four boxes.
 *
 * Nothing on file is an empty box rather than the word "none": the box is where
 * the guest would type it, and a placeholder that had to be deleted first would
 * be a value they never entered.
 */
function boxes(profile: Profile): ProfileFields {
  return {
    fullName: profile.fullName,
    phone: profile.phone ?? "",
    dateOfBirth: profile.dateOfBirth ?? "",
    nationality: profile.nationality ?? "",
  };
}

/**
 * The month the account was opened, or nothing.
 *
 * `createdAt` is declared `z.iso.datetime()` and arrives validated, so the
 * `NaN` branch is not a case the API can produce today. It is here because the
 * alternative when it is wrong is the words "Invalid Date" printed under the
 * guest's own name, and a provenance line that cannot be trusted is better
 * absent than wrong.
 */
function memberSince(createdAt: string): string | undefined {
  const opened = new Date(createdAt);

  return Number.isNaN(opened.getTime()) ? undefined : MONTH.format(opened);
}
