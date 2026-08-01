"use client";

// Choosing the new password, with the token the emailed link carried.
//
// Three states: no token at all (the guest navigated here directly, or the API
// rejected the token and redirected with an error), the form, and done. The
// first is not an error the guest caused, so it reads as a fact and offers the
// way back rather than an apology.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  MIN_PASSWORD_LENGTH,
  resetPassword,
} from "@/features/auth/lib/guest-auth";
import { AuthShell, authStyles as styles } from "./auth-shell";

export function ResetPasswordScreen({
  token,
  linkError,
}: {
  readonly token: string | null;
  /** Better Auth redirects here with `?error=…` when the token in the link has
   *  expired or been spent — the link is single-use on purpose. */
  readonly linkError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || linkError) {
    return (
      <AuthShell
        title="That link has expired"
        subtitle="Reset links last an hour and work once. Asking for another takes a moment."
        footnote={
          <a className={styles.footnoteLink} href="/forgot-password">
            Ask for a new link
          </a>
        }
      >
        <p className={styles.notice}>Your password has not changed.</p>
      </AuthShell>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const fields = new FormData(event.currentTarget);
    const newPassword = String(fields.get("password") ?? "");

    // Checked here rather than only by the API: the two fields exist so the
    // guest cannot lock themselves out with a typo, and the API has no second
    // field to compare against.
    if (newPassword !== String(fields.get("confirm") ?? "")) {
      setError("Those two do not match.");

      return;
    }

    setPending(true);
    setError(null);

    const result = await resetPassword({ token: token!, newPassword });

    if (result.ok) {
      // Every other session was revoked by the API on the way through, which
      // is the point of a reset. Signing in again is the next step, and this
      // screen has nothing further to say.
      router.push("/login");

      return;
    }

    setError(result.message);
    setPending(false);
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Setting this signs you out everywhere else."
      footnote={
        <a className={styles.footnoteLink} href="/login">
          Back to log in
        </a>
      }
    >
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="password">
            New password
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

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="confirm">
            Once more
          </label>
          <input
            className={styles.input}
            id="confirm"
            type="password"
            name="confirm"
            placeholder="••••••••••••"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
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
          {pending ? "Setting it" : "Set password"}
        </button>
      </form>
    </AuthShell>
  );
}
