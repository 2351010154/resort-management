"use client";

// Creating an account. Three fields, and a confirmation step the guest cannot
// skip: the API refuses to sign anyone in until the address is proven, because
// a booking confirmation sent to an address nobody owns is a guest arriving to
// no reservation.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  MIN_PASSWORD_LENGTH,
  signUpWithEmail,
} from "@/features/auth/lib/guest-auth";
import { ATTACHING_BOOKING_PARAM } from "@/features/booking/lib/booking-links";
import { AuthShell, authStyles as styles } from "./auth-shell";

export function SignUpScreen({
  /** The stay this account is being made to keep, if the guest came from one.
   *  It decides nothing on this screen — it only has to survive as far as the
   *  return address the confirmation email is built with. */
  claiming = null,
}: {
  readonly claiming?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") ?? "");

    setPending(true);
    setError(null);

    const result = await signUpWithEmail({
      name: String(fields.get("name") ?? "").trim(),
      email,
      password: String(fields.get("password") ?? ""),
      claiming,
    });

    if (result.ok) {
      // The address travels to the next screen so its resend button has
      // something to resend to. It is not a secret — the guest just typed it —
      // and carrying it in the URL is what lets that screen survive a reload.
      //
      // The stay travels for the same reason. The link already in the post
      // carries its own return address, so this is not what gets the guest to
      // the attach — it is what the *second* link needs, because a guest who
      // presses "send it again" is asking for a message built from scratch and
      // one built without the stay would confirm the address and leave the
      // booking behind.
      router.push(
        `/verify-email?email=${encodeURIComponent(email)}${
          claiming === null
            ? ""
            : `&${ATTACHING_BOOKING_PARAM}=${encodeURIComponent(claiming)}`
        }`,
      );

      // Left pending: the navigation is in flight and the button should not
      // offer itself again in the meantime.
      return;
    }

    setError(result.message);
    setPending(false);
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account holds your bookings, your stay history and the details we should already know."
      footnote={
        <>
          Already with us?{" "}
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>
        </>
      }
    >
      {/* Native validation left on, for the same reason as the login screen:
          an empty submit would otherwise become a server error message, and
          the server's error messages here have to stay trustworthy. */}
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="name">
            Name
          </label>
          <input
            className={styles.input}
            id="name"
            type="text"
            name="name"
            placeholder="Nguyễn Minh Anh"
            autoComplete="name"
            required
            maxLength={200}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="email">
            Email address
          </label>
          <input
            className={styles.input}
            id="email"
            type="email"
            name="email"
            placeholder="name@email.com"
            autoComplete="email"
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="password">
            Password
          </label>
          <input
            className={styles.input}
            id="password"
            type="password"
            name="password"
            placeholder="••••••••••••"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          <p className={styles.hint}>
            {MIN_PASSWORD_LENGTH} characters or more.
          </p>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={`${styles.submit} caps-label`}
          type="submit"
          disabled={pending}
        >
          {pending ? "Creating your account" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
