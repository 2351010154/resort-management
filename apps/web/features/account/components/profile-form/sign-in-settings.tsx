"use client";

// How a guest signs in, managed in place — `screens.md` §Account.
//
// Two forms rather than two screens, and a sibling file rather than a component
// folder of its own: this is the second half of `/account` and shares its
// stylesheet, the way `stay-panel/party-rows.tsx` shares its panel's.
//
// **The current password is required and cannot be made optional.** Anyone who
// reaches an unlocked browser, or a session cookie, would otherwise take the
// account outright instead of borrowing it. The API also revokes every other
// session on success, which it sets server-side so that no caller can decline
// the lock-out a password change exists to perform.
//
// **The new address is not the identifier until its link is followed.** The
// account keeps answering to the address it holds while the change is unproven,
// so the sentence below promises a link and not a change — naming an address
// must not be enough to make it a credential.
//
// **A Google-only account is offered neither form.** Google keeps its address
// and its password, and `guest-auth.factory.ts` refuses both routes before they
// reach an endpoint. What is here is therefore presentation: the enforcement is
// the API's, and this only declines to draw a control that would be refused.

import { useState, type FormEvent } from "react";
import {
  changeEmail,
  changePassword,
  type CredentialOutcome,
} from "@/features/account/lib/profile";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/lib/guest-auth";
import styles from "./profile-form.module.css";

export function SignInSettings({
  email,
  hasPassword,
}: {
  /** The address the account signs in with today — not the one being asked for. */
  readonly email: string;
  readonly hasPassword: boolean;
}) {
  const [password, setPassword] = useState<CredentialOutcome>();
  const [address, setAddress] = useState<CredentialOutcome>();
  const [sentTo, setSentTo] = useState<string>();
  const [pending, setPending] = useState<"password" | "email">();

  if (!hasPassword) {
    return (
      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} caps-label`}>How you sign in</h2>
        <p className={styles.notice}>
          This account signs in with Google. Your address and your password are
          Google&rsquo;s to change, and you can do it from your Google account.
        </p>
      </section>
    );
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const form = event.currentTarget;
    const entered = new FormData(form);

    setPending("password");
    setPassword(undefined);

    const outcome = await changePassword({
      currentPassword: String(entered.get("currentPassword") ?? ""),
      newPassword: String(entered.get("newPassword") ?? ""),
    });

    // Cleared on success only. A guest correcting a typo should find what they
    // typed still there, and what they typed is the thing that was wrong.
    if (outcome.ok) {
      form.reset();
    }

    setPassword(outcome);
    setPending(undefined);
  }

  async function onEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const form = event.currentTarget;
    const wanted = String(new FormData(form).get("newEmail") ?? "");

    setPending("email");
    setAddress(undefined);

    const outcome = await changeEmail(wanted);

    if (outcome.ok) {
      setSentTo(wanted);
      form.reset();
    }

    setAddress(outcome);
    setPending(undefined);
  }

  return (
    <section className={styles.section}>
      <h2 className={`${styles.sectionTitle} caps-label`}>How you sign in</h2>

      {/* Native validation left on, here as on the login screen: an empty
          submit would otherwise reach the API and come back as a refusal about
          a password, which is both wrong and the one message here that has to
          stay trustworthy. */}
      <form className={styles.form} onSubmit={onPassword}>
        <h3 className={styles.subheading}>Password</h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="currentPassword">
            Current password
          </label>
          <input
            autoComplete="current-password"
            className={styles.input}
            id="currentPassword"
            name="currentPassword"
            placeholder="••••••••••••"
            required
            type="password"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="newPassword">
            New password
          </label>
          <input
            autoComplete="new-password"
            className={styles.input}
            id="newPassword"
            minLength={MIN_PASSWORD_LENGTH}
            name="newPassword"
            placeholder="••••••••••••"
            required
            type="password"
          />
        </div>

        <p className={styles.hint}>
          At least {MIN_PASSWORD_LENGTH} characters. Changing it signs you out
          everywhere else.
        </p>

        {password ? (
          <p
            className={password.ok ? styles.notice : styles.error}
            role={password.ok ? "status" : "alert"}
          >
            {password.ok
              ? "Your password is changed. Any other browser signed in to this account has been signed out."
              : password.message}
          </p>
        ) : null}

        <button
          className={`${styles.submit} caps-label`}
          disabled={pending !== undefined}
          type="submit"
        >
          {pending === "password" ? "Changing" : "Change password"}
        </button>
      </form>

      <form className={styles.form} onSubmit={onEmail}>
        <h3 className={styles.subheading}>Email address</h3>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="newEmail">
            New email address
          </label>
          <input
            autoComplete="email"
            className={styles.input}
            id="newEmail"
            name="newEmail"
            placeholder="name@email.com"
            required
            type="email"
          />
        </div>

        <p className={styles.hint}>
          You sign in with {email} until the new address is confirmed by the
          link we send to it.
        </p>

        {address ? (
          <p
            className={address.ok ? styles.notice : styles.error}
            role={address.ok ? "status" : "alert"}
          >
            {address.ok
              ? `A confirmation link is on its way to ${sentTo}. Follow it and that address becomes the one you sign in with. Until then, nothing has changed.`
              : address.message}
          </p>
        ) : null}

        <button
          className={`${styles.submit} caps-label`}
          disabled={pending !== undefined}
          type="submit"
        >
          {pending === "email" ? "Sending" : "Send confirmation link"}
        </button>
      </form>
    </section>
  );
}
