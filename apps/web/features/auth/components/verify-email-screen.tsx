"use client";

// Two states, one screen.
//
// Before the link is clicked it says where to look and offers to send another.
// After it is clicked — the API redirects here with `confirmed=1` — it says so,
// and the guest is already signed in: `autoSignInAfterVerification` means
// proving the address is the last thing they have to do.
//
// One screen rather than two because the second state is one sentence, and a
// route that exists to hold one sentence is a route to keep in step forever.

import { useState } from "react";
import {
  resendVerificationEmail,
  type AuthResult,
} from "@/features/auth/lib/guest-auth";
import { AuthShell, authStyles as styles } from "./auth-shell";

export function VerifyEmailScreen({
  email,
  confirmed,
}: {
  readonly email: string | null;
  readonly confirmed: boolean;
}) {
  const [outcome, setOutcome] = useState<AuthResult | null>(null);
  const [pending, setPending] = useState(false);

  if (confirmed) {
    return (
      <AuthShell
        title="Your address is confirmed"
        subtitle="You are signed in. Your account is ready whenever you are."
        footnote={
          <a className={styles.footnoteLink} href="/">
            Back to the arrival
          </a>
        }
      >
        <p className={styles.notice}>Nothing else is needed.</p>
      </AuthShell>
    );
  }

  async function resend() {
    if (pending || !email) {
      return;
    }

    setPending(true);
    setOutcome(null);
    setOutcome(await resendVerificationEmail(email));
    setPending(false);
  }

  return (
    <AuthShell
      title="Check your inbox"
      subtitle={
        email
          ? `A confirmation link is on its way to ${email}. It expires in an hour.`
          : "A confirmation link is on its way. It expires in an hour."
      }
      footnote={
        <>
          Confirmed already?{" "}
          <a className={styles.footnoteLink} href="/login">
            Log in
          </a>
        </>
      }
    >
      {/* Only offered when there is an address to send to. Arriving here
          without one means the guest navigated directly, and a button that
          asks them to retype the address would be a second sign-up form. */}
      {email ? (
        <button
          className={styles.secondary}
          type="button"
          onClick={resend}
          disabled={pending}
        >
          {pending ? "Sending" : "Send it again"}
        </button>
      ) : null}

      {outcome ? (
        <p
          className={outcome.ok ? styles.notice : styles.error}
          role={outcome.ok ? "status" : "alert"}
        >
          {outcome.ok ? "Sent. It should arrive shortly." : outcome.message}
        </p>
      ) : null}
    </AuthShell>
  );
}
