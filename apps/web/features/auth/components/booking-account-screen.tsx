"use client";

// The confirmation email's other link, followed — the account it offers.
//
// **Nothing on this screen differs by whether the address already has an
// account.** The mail makes that branch, because it is delivered to the address
// being asked about and to nobody else; a page cannot make the same claim. A
// hold is unauthenticated and only rate-limited, so anyone can create one naming
// a victim's address, take a booking cookie without paying, and read whatever
// this rendered. So the screen is the same for everybody who reaches it, and the
// API answers it with a booking id and a reference — facts about the stay the
// link already proved, and nothing about an account.
//
// **The password is optional and stays optional.** The message proved the
// address, so the account is created with it already verified, and the stay is
// attached before any credential is written — a guest who sets none still owns
// their booking, and is signed in to it just the same.
//
// **So the way on is the booking, and it is the same way on for everybody.** The
// account this created comes back with a session on it, which is what makes the
// stay readable straight away; the rarer guest whose address had gained an
// account in the meantime arrives at the same page holding no session, and
// `stay-screen.tsx` answers that with the booking's own sentence and a way to
// log in. Neither outcome is named here, for the reason the paragraph above
// gives — this screen does not know which one happened, and must not.

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ACCOUNT_LINK_PARAM,
  type AttachedStay,
  createAccountFrom,
} from "@/features/booking/lib/booking-links";
import { usePresentedLink } from "@/features/booking/lib/use-presented-link";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/lib/guest-auth";
import { AuthShell, authStyles as styles } from "./auth-shell";

export function BookingAccountScreen() {
  const presented = usePresentedLink(ACCOUNT_LINK_PARAM);
  const link = presented.link;

  const [attached, setAttached] = useState<AttachedStay>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const done = useRef<HTMLParagraphElement>(null);

  // The form the guest was working in is gone by the time this state paints, and
  // focus with it. Moving it to the sentence that replaced the form is what
  // keeps a keyboard or screen reader in the place the screen has arrived at
  // rather than back at the top of the document.
  useEffect(() => {
    if (attached) {
      done.current?.focus();
    }
  }, [attached]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || link === null) {
      return;
    }

    const typed = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );

    setPending(true);
    setError(undefined);

    const outcome = await createAccountFrom({
      link,
      // Blank is a guest declining a password rather than choosing an empty
      // one, and the two must not arrive as the same request: the realm's floor
      // would refuse the empty string, turning a skip into a refusal.
      password: typed === "" ? undefined : typed,
    });

    if (outcome.ok) {
      setAttached(outcome.stay);

      // Left pending: the form is about to be replaced and the button must not
      // offer itself again for a link that has now been spent.
      return;
    }

    setError(outcome.message);
    setPending(false);
  }

  if (attached) {
    return (
      <AuthShell
        title="Your account is ready"
        subtitle={`Booking ${attached.reference} is in it. The message you followed proved your address, so there is nothing further to confirm.`}
        footnote={
          <a
            className={styles.footnoteLink}
            href={`/bookings/${encodeURIComponent(attached.reference)}`}
          >
            Go to your booking
          </a>
        }
      >
        {/* Says nothing about a password, and nothing about a session either.
            An address that gained an account between the message and this press
            is attached to that account instead — the password typed here is not
            its password and no session is issued over it, which
            `guest-attach.service.ts` is deliberate about. The sentence below is
            true of both guests, and the link above works for both: one arrives
            at their stay, the other at a page that offers them the log-in the
            older account needs. */}
        <p className={styles.notice} ref={done} role="status" tabIndex={-1}>
          Your stay is yours to open from here whenever you like.
        </p>
      </AuthShell>
    );
  }

  // Arrived without the credential: somebody navigated here, or came back to a
  // page whose link has already been read off its address. Not an error the
  // guest caused, so it reads as a fact and offers the way on —
  // `reset-password-screen.tsx` states the same case the same way.
  //
  // Only once the address has actually been consulted. The credential is in the
  // fragment, which no server render can see, so a screen that decided on the
  // first render would tell every guest who followed the link that they had not.
  if (presented.read && link === null) {
    return (
      <AuthShell
        title="Open this from your confirmation email"
        subtitle="The account link in that message is what opens this page. It lasts an hour and works once."
        footnote={
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>
        }
      >
        <p className={styles.notice}>
          Your booking is unaffected. It is yours with or without an account.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Keep this stay"
      subtitle="Your booking is already yours. An account keeps it, and every stay after it, in one place."
      footnote={
        <>
          Already with us?{" "}
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>
        </>
      }
    >
      {/* No `required` on the field below, and that is the whole design of this
          screen rather than an oversight: submitting it empty is a guest
          declining a password, which the API accepts. `minLength` still applies
          to a value that is typed. */}
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="password">
            Password
          </label>
          <input
            aria-describedby="password-hint"
            autoComplete="new-password"
            className={styles.input}
            id="password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            placeholder="••••••••••••"
            type="password"
          />
          <p className={styles.hint} id="password-hint">
            Optional, and {MIN_PASSWORD_LENGTH} characters or more if you set
            one. Leave it blank and the stay is still yours — you can choose a
            password later.
          </p>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={`${styles.submit} caps-label`}
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating your account" : "Create my account"}
        </button>
      </form>
    </AuthShell>
  );
}
