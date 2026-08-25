"use client";

// How a guest signs in, managed in place — `screens.md` §Account.
//
// One plate rather than two screens, and a sibling file rather than a component
// folder of its own: this is the second half of `/account` and shares its
// stylesheet, the way `stay-panel/party-rows.tsx` shares its panel's.
//
// **The two forms are disclosures now, not two open forms.** Each credential is
// a row that states what the account currently holds — the address it answers
// to, and a password as dots — and opens the form that changes it. A guest
// reaches this screen to correct a phone number far more often than to take a
// password apart, and two full credential forms standing open under the profile
// put the rare errand in front of the common one. Native `<details>`, so the
// open state is the browser's — no state to hold, no script to load, and the
// rows still open if the bundle never arrives.
//
// **A row states only what the account can be asked for.** There is no
// verification tick beside the address, no date beside the password and no
// second-factor row. `guestProfileSchema` carries none of the three and Better
// Auth is not asked for them here, so each would be a mark printed from
// nothing. A row on this plate is a fact a guest can act on; the plate that
// tells them how their account is reached is the last one on the screen that
// should carry a decorative claim.
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
// **A Google-only account is offered neither disclosure.** Google keeps its
// address and its password, and `guest-auth.factory.ts` refuses both routes
// before they reach an endpoint. What is here is therefore presentation: the
// enforcement is the API's, and this only declines to draw a control that would
// be refused.

import { type FormEvent, useState } from "react";
import {
  type CredentialOutcome,
  changeEmail,
  changePassword,
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
      <section className={styles.plate} id="sign-in-settings">
        <h2 className={`${styles.plateTitle} caps-label`}>
          Account &amp; security
        </h2>
        <AddressRow email={email} />
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
    <section className={styles.plate} id="sign-in-settings">
      <h2 className={`${styles.plateTitle} caps-label`}>
        Account &amp; security
      </h2>

      {/* The address is the row a guest reads to check they are looking at the
          right account, so it is the first one. */}
      <div className={styles.disclosures}>
        <details className={styles.disclosure}>
          <summary className={styles.summary}>
            <span className={styles.summaryLabel}>Email</span>
            <span className={styles.summaryValue}>{email}</span>
            {/* Decorative: the row already says what it opens, and the state
                the mark reflects is announced by `<details>` itself. */}
            <span aria-hidden="true" className={styles.chevronMark} />
          </summary>

          <form
            aria-busy={pending === "email"}
            className={`${styles.form} ${styles.disclosurePanel}`}
            onSubmit={onEmail}
          >
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="newEmail">
                New email address
              </label>
              <input
                autoComplete="email"
                className={styles.input}
                disabled={pending !== undefined}
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
        </details>

        <details className={styles.disclosure}>
          <summary className={styles.summary}>
            <span className={styles.summaryLabel}>Password</span>
            {/* A fixed run of dots, and not the password's own length: that one
                account holds a longer secret than another is not this screen's
                to say out loud. The word beside it is what a screen reader is
                given, because a row of bullets read aloud is noise. */}
            <span aria-hidden="true" className={styles.summaryValue}>
              ••••••••••
            </span>
            <span className={styles.summaryStatus}>Set</span>
            <span aria-hidden="true" className={styles.chevronMark} />
          </summary>

          {/* Native validation left on, here as on the login screen: an empty
              submit would otherwise reach the API and come back as a refusal
              about a password, which is both wrong and the one message here
              that has to stay trustworthy. */}
          <form
            aria-busy={pending === "password"}
            className={`${styles.form} ${styles.disclosurePanel}`}
            onSubmit={onPassword}
          >
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="currentPassword">
                Current password
              </label>
              <input
                autoComplete="current-password"
                className={styles.input}
                disabled={pending !== undefined}
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
                disabled={pending !== undefined}
                id="newPassword"
                minLength={MIN_PASSWORD_LENGTH}
                name="newPassword"
                placeholder="••••••••••••"
                required
                type="password"
              />
            </div>

            <p className={styles.hint}>
              At least {MIN_PASSWORD_LENGTH} characters. Changing it signs you
              out everywhere else.
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
        </details>
      </div>

      <p className={styles.hint}>
        Manage how you sign in and keep your account secure.
      </p>
    </section>
  );
}

/**
 * The address the account answers to, as a label/value row.
 *
 * The Google-only case only. An account that holds a password states its
 * address on the disclosure that changes it, where the current one is readable
 * without opening anything; an account that cannot change it here has no
 * disclosure to state it on, so it gets a plain row on the same columns.
 */
function AddressRow({ email }: { readonly email: string }) {
  return (
    <dl className={styles.rows}>
      <div className={styles.row}>
        <dt className={styles.rowLabel}>Email</dt>
        <dd className={styles.rowValue}>{email}</dd>
      </div>
    </dl>
  );
}
