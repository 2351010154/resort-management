"use client";

// The four facts a guest can change about themselves — the book's details
// chapter, read as a record and opened as a form.
//
// **A record first, a form when asked.** The register's old answer was "the
// boxes are the display": four open fields, always editable, a save button
// always under them. That makes the common visit — checking what the house
// holds — look like an errand, and it puts a blinking caret on a page a guest
// came to read. So the chapter is typeset rows by default, and "Edit" turns
// those same rows into fields in place: the values do not move, they become
// writable. Save or cancel, and the rows are a record again.
//
// **What is sent is `profile-edits.ts`'s business.** The contract is
// three-valued — absent leaves a field alone, `null` clears it — and the form
// is two-valued, so the crossing lives in one function the marks and the save
// both read. A field is marked exactly when the save would send it, and a save
// with nothing marked sends nothing: a PATCH carrying no field answers 200,
// which would read back as a change that happened.
//
// **The saved profile is handed up.** The contract answers a `PATCH` with the
// whole record, and the stone reads the name from it: a guest who corrects the
// spelling of their own name watches it cut again in the wall.

import { parseDate } from "@internationalized/date";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Chapter } from "@/features/account/components/account-frame/chapter";
import { type Profile, saveProfile } from "@/features/account/lib/profile";
import {
  hasEdits,
  type ProfileFields,
  profileEdits,
} from "@/features/account/lib/profile-edits";
import { longDate } from "@/features/account/lib/stay-display";
import styles from "./profile-screen.module.css";

export function DetailsChapter({
  number,
  profile,
  onSaved,
}: {
  readonly number: string;
  readonly profile: Profile;
  readonly onSaved: (profile: Profile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<ProfileFields>(() => boxes(profile));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const firstField = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // Set when the form closes, so focus goes back to the control that opened
  // it rather than to the top of the document the form was removed from.
  const returnFocus = useRef(false);

  const edits = profileEdits(profile, fields);
  const dirty = hasEdits(edits);

  useEffect(() => {
    if (editing) {
      firstField.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function open(): void {
    setFields(boxes(profile));
    setSaved(false);
    setRefusal(undefined);
    setEditing(true);
  }

  function close(): void {
    returnFocus.current = true;
    setEditing(false);
  }

  function edit(field: keyof ProfileFields, value: string): void {
    setFields({ ...fields, [field]: value });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    setRefusal(undefined);

    // Nothing changed: close without a round trip, and without a "Saved."
    // about a save that did not happen.
    if (!dirty) {
      close();

      return;
    }

    setPending(true);

    const outcome = await saveProfile(edits);

    setPending(false);

    if (outcome.ok) {
      setFields(boxes(outcome.profile));
      onSaved(outcome.profile);
      setSaved(true);
      close();
    } else {
      setRefusal(outcome.message);
    }
  }

  return (
    <Chapter
      action={
        editing ? null : (
          <button
            className={`${styles.textButton} caps-label`}
            onClick={open}
            ref={editButton}
            type="button"
          >
            Edit details
          </button>
        )
      }
      lede="These prefill your next booking and your next arrival. A stay you have already taken keeps the details it was taken with, and the desk still checks them against your document when you arrive."
      line="The name on the register."
      name="Your details"
      number={number}
    >
      {editing ? (
        <form aria-busy={pending} className={styles.form} onSubmit={onSubmit}>
          <div className={styles.rows}>
            <Field edited={"fullName" in edits} id="fullName" label="Full name">
              <input
                autoComplete="name"
                className={`${styles.input} font-display`}
                disabled={pending}
                id="fullName"
                maxLength={120}
                name="fullName"
                onChange={(event) => edit("fullName", event.target.value)}
                ref={firstField}
                type="text"
                value={fields.fullName}
              />
            </Field>

            <Field edited={"phone" in edits} id="phone" label="Phone">
              <input
                autoComplete="tel"
                className={`${styles.input} font-display`}
                disabled={pending}
                id="phone"
                maxLength={30}
                name="phone"
                onChange={(event) => edit("phone", event.target.value)}
                type="tel"
                value={fields.phone}
              />
            </Field>

            <Field
              edited={"dateOfBirth" in edits}
              id="dateOfBirth"
              label="Date of birth"
            >
              {/* A date input, so the text the contract's codec decodes is
                  what the browser produces — a free-text box would send
                  whatever a guest's own date convention happens to be. */}
              <input
                autoComplete="bday"
                className={`${styles.input} font-display`}
                disabled={pending}
                id="dateOfBirth"
                name="dateOfBirth"
                onChange={(event) => edit("dateOfBirth", event.target.value)}
                type="date"
                value={fields.dateOfBirth}
              />
            </Field>

            <Field
              edited={"nationality" in edits}
              id="nationality"
              label="Nationality"
            >
              <input
                autoComplete="country-name"
                className={`${styles.input} font-display`}
                disabled={pending}
                id="nationality"
                maxLength={60}
                name="nationality"
                onChange={(event) => edit("nationality", event.target.value)}
                type="text"
                value={fields.nationality}
              />
            </Field>
          </div>

          {refusal ? (
            <p className={styles.error} role="alert">
              {refusal}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              className={`${styles.submit} caps-label`}
              disabled={pending}
              type="submit"
            >
              {pending ? "Saving" : "Save details"}
            </button>
            <button
              className={`${styles.textButton} caps-label`}
              disabled={pending}
              onClick={close}
              type="button"
            >
              Cancel
            </button>

            {dirty && !pending ? (
              <span className={styles.pending}>Changes not yet saved</span>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <dl className={styles.rows}>
            <Stated label="Full name" value={profile.fullName} />
            <Stated label="Phone" value={profile.phone} />
            <Stated
              label="Date of birth"
              value={birthday(profile.dateOfBirth)}
            />
            <Stated label="Nationality" value={profile.nationality} />
          </dl>

          {/* Announced when it arrives, because it arrives after a round
              trip. */}
          {saved ? (
            <p className={styles.notice} role="status">
              Saved. Your next booking and your next arrival will use these.
            </p>
          ) : null}
        </>
      )}
    </Chapter>
  );
}

/**
 * A fact as the house holds it. Nothing on file is said in words — "Not
 * given" — rather than left as a gap that reads like a fault in the page.
 */
function Stated({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
}) {
  return (
    <div className={styles.row}>
      <dt className={`${styles.rowLabel} caps-label`}>{label}</dt>
      <dd
        className={`${styles.rowValue} font-display`}
        data-empty={value ? undefined : ""}
      >
        {value || "Not given"}
      </dd>
    </div>
  );
}

/**
 * A label beside its box, on the same tracks as the stated row it replaced,
 * and marked while the box holds something the property does not.
 */
function Field({
  id,
  label,
  edited,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly edited: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.editRow} data-edited={edited ? "" : undefined}>
      <label className={`${styles.rowLabel} caps-label`} htmlFor={id}>
        {label}
      </label>
      <div className={styles.fieldBox}>{children}</div>
    </div>
  );
}

/**
 * The date of birth as a person writes it, or nothing.
 *
 * It is calendar-date text, so it is parsed as one — never as a `Date`, which
 * would be an instant and could fall on the previous day west of UTC. Text
 * that does not parse is shown as it came rather than hidden.
 */
function birthday(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return longDate(parseDate(value));
  } catch {
    return value;
  }
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
