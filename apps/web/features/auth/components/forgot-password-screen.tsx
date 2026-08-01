"use client";

// Asking for a reset link.
//
// The screen says the same thing whether or not the address has an account,
// because the API answers the same way. A form that confirmed an address would
// be a way of asking "does this person stay here?" and getting an answer, which
// for a hotel is a worse disclosure than for most systems.

import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/features/auth/lib/guest-auth";
import { AuthShell, authStyles as styles } from "./auth-shell";

export function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    const result = await requestPasswordReset(
      String(new FormData(event.currentTarget).get("email") ?? ""),
    );

    if (result.ok) {
      setSent(true);
    } else {
      setError(result.message);
    }

    setPending(false);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Give us the address on the account and we will send a link to choose a new password."
      footnote={
        <>
          Remembered it?{" "}
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>
        </>
      }
    >
      {sent ? (
        <p className={styles.notice} role="status">
          If that address has an account, a link is on its way. It expires in an
          hour.
        </p>
      ) : (
        <form className={styles.form} onSubmit={onSubmit}>
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
            {pending ? "Sending" : "Send the link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
