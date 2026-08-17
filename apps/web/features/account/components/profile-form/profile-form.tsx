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
// boxes are the display, and the list above them holds only what a guest cannot
// change: the address they sign in with, the property's masked record of their
// document, and the two derived figures.
//
// **Nothing here is a permission.** The tier and the points are read-only
// because no route exists to write them — `FR-GST-04` derives one from the
// trailing twelve months and `FR-GST-05` sums the other off an append-only
// ledger. The document number is masked because `guestProfileSchema` carries no
// field an unmasked one could travel in. And the two credential forms are
// hidden from a Google-only account rather than disabled, because
// `guest-auth.factory.ts` refuses both at the API — a page that omits a control
// is a page, and the request it omits can still be sent.

import { useEffect, useState, type FormEvent } from "react";
import { AccountShell } from "@/features/account/components/account-shell/account-shell";
import {
  hasEdits,
  profileEdits,
  type ProfileFields,
} from "@/features/account/lib/profile-edits";
import {
  hasPassword as readHasPassword,
  type Profile,
  readProfile,
  saveProfile,
} from "@/features/account/lib/profile";
import { SignInSettings } from "./sign-in-settings";
import styles from "./profile-form.module.css";

/** The three rungs of `property-and-tariff.md` §7, as a guest is shown them. */
const TIERS: Readonly<Record<string, string>> = {
  MEMBER: "Member",
  SILVER: "Silver",
  GOLD: "Gold",
};

/** Points are a count rather than an amount, so they are grouped and not
 *  formatted as money — there is no currency and nothing to redeem them for. */
const points = new Intl.NumberFormat("en-US");

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile>();
  const [fields, setFields] = useState<ProfileFields>();
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
    void Promise.all([readProfile(), readHasPassword()]).then(
      ([outcome, password]) => {
        if (!live) {
          return;
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

  if (loading) {
    return (
      <AccountShell
        here="profile"
        subtitle="One moment while the property reads your details."
        title="Your profile"
      >
        <p className={styles.notice}>Reading your account.</p>
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
        <p className={styles.error} role="alert">
          {refusal}
        </p>
        <p className={styles.footnote}>
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>{" "}
          and your details are here waiting.
        </p>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      here="profile"
      subtitle="What the property knows about you, outside any single stay."
      title="Your profile"
    >
      <dl className={styles.facts}>
        <dt className={styles.factLabel}>Email</dt>
        <dd className={styles.factValue}>{profile.email}</dd>

        <dt className={styles.factLabel}>Identity document</dt>
        {/* Masked, and there is no control anywhere on this screen that could
            widen it: the profile carries `cccdMasked` and nothing else. The
            number itself is read off the document at the desk, and a number
            typed into a profile screen would be a second, unverified source for
            a statutory record. */}
        <dd className={styles.factValue}>
          {profile.cccdMasked ?? "None on file"}
        </dd>

        <dt className={styles.factLabel}>Tier</dt>
        <dd className={styles.factValue}>
          {TIERS[profile.vipTier] ?? profile.vipTier}
        </dd>

        <dt className={styles.factLabel}>Loyalty points</dt>
        {/* `BigInt` accepts the integer and the decimal text alike, so this
            reads the same figure whichever the transport hands back —
            `stay-funnel.ts` makes the same crossing for a stay's total. */}
        <dd className={styles.factValue}>
          {points.format(BigInt(profile.loyaltyPoints))}
        </dd>
      </dl>

      <p className={styles.aside}>
        Your tier and your points are worked out from the stays you have taken.
        Nobody at the property can adjust either, and there is nothing to spend
        them on.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <h2 className={`${styles.sectionTitle} caps-label`}>Your details</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="fullName">
            Full name
          </label>
          <input
            autoComplete="name"
            className={styles.input}
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
          These prefill your next booking and your next arrival. A stay you have
          already taken keeps the details it was taken with, and the desk still
          checks them against your document when you arrive.
        </p>

        {/* Announced when they arrive, because they arrive after a round trip. */}
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

      <SignInSettings email={profile.email} hasPassword={hasPassword} />

      <p className={styles.footnote}>
        <a className={styles.footnoteLink} href="/account/stays">
          Your stays
        </a>{" "}
        — every booking this account has taken.
      </p>
    </AccountShell>
  );
}

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
