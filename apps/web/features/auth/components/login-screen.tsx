"use client";

// The login screen. One form, always whole; the plates either side of it are
// the only thing that moves.
//
// The pane the strip is showing follows focus and nothing else. There is no
// blur handler on purpose: releasing to a default when focus leaves the form
// would pan the whole frame every time a guest reaches for a password manager
// or tabs out to the browser chrome, which reads as the screen flinching. Focus
// landing on a field is a decision; focus leaving one is not.
//
// **It is also where an anonymous stay gains an owner.** A guest whose address
// already had an account is invited by their confirmation email to sign in
// rather than to make a second one, and signing in here while the browser still
// holds that booking's cookie is the whole of the attach: the session proves the
// account, the cookie proves the stay, and `guest-attach.controller.ts` refuses
// unless the credential names the booking the address says. Which booking is
// meant travels in the address as an id — never a credential, and worth nothing
// without the cookie beside it.

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  AFTER_SIGN_IN,
  googleErrorMessage,
  signInWithEmail,
  signInWithGoogle,
} from "@/features/auth/lib/sign-in";
import {
  ATTACH_ON_ARRIVAL_PARAM,
  ATTACHING_BOOKING_PARAM,
  attachStay,
} from "@/lib/booking-links";
import styles from "./login-screen.module.css";

/** Which field the strip is framed on. */
type Pane = "email" | "password";

// Google is wired; Apple is not, and says so rather than doing nothing when
// pressed. The row's composition was settled before either had an OAuth client
// so it could not be bolted on later at whatever width happened to be free.
const PROVIDERS = [
  { id: "google", label: "Google", enabled: true },
  { id: "apple", label: "Apple", enabled: false },
] as const;

export function LoginScreen({
  /** The `?error=…` Better Auth redirects here with when a Google sign-in did
   *  not complete. Read on the server and handed down — see the page. */
  googleError = null,
  /** The stay to claim once this guest has signed in, if they came from one. */
  claiming = null,
  /** The same stay, on a browser that has just come back from Google already
   *  carrying its session — so the attach is owed now rather than after a
   *  press. */
  claimingNow = null,
  /** The guest surface that opened this deliberate sign-in. */
  afterSignIn = AFTER_SIGN_IN,
}: {
  readonly googleError?: string | null;
  readonly claiming?: string | null;
  readonly claimingNow?: string | null;
  readonly afterSignIn?: string;
}) {
  const router = useRouter();
  const [pane, setPane] = useState<Pane>("email");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(
    googleError ? googleErrorMessage(googleError) : null,
  );
  const [pending, setPending] = useState(false);

  // The stay a guest was sent back here to claim. Nothing is decided from the id
  // itself — the API attaches only the booking the cookie on the request already
  // proves — so a crafted one is a refusal and never somebody else's stay.
  useEffect(() => {
    if (claimingNow === null) {
      return;
    }

    let live = true;

    setPending(true);

    void attachStay(claimingNow).then((outcome) => {
      if (!live) return;

      if (outcome.ok) {
        router.replace(
          `/bookings/${encodeURIComponent(outcome.stay.reference)}`,
        );
        // Left pending: the navigation is in flight.
        return;
      }

      setError(outcome.message);
      setPending(false);
    });

    return () => {
      live = false;
    };
  }, [claimingNow, router]);

  /**
   * Where a signed-in guest goes, and what they take with them.
   *
   * The attach is made from here rather than left to the stay page, because this
   * is the moment both credentials are on one request — and its failure is worth
   * saying out loud: a booking cookie that expired while the guest was signing in
   * leaves the stay unclaimed, and the API's sentence names the way back to it.
   */
  async function land(): Promise<void> {
    if (claiming === null) {
      router.replace(afterSignIn);

      return;
    }

    const outcome = await attachStay(claiming);

    if (outcome.ok) {
      router.replace(`/bookings/${encodeURIComponent(outcome.stay.reference)}`);

      return;
    }

    setError(outcome.message);
    setPending(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const result = await signInWithEmail({
      email: String(fields.get("email") ?? ""),
      password: String(fields.get("password") ?? ""),
    });

    if (result.ok) {
      await land();
      // Left pending unless `land` said otherwise: the navigation is in flight
      // and the button should not offer itself again in the meantime.
      return;
    }

    setError(result.message);
    setPending(false);
  }

  async function onGoogle() {
    if (pending) return;

    setPending(true);
    setError(null);

    const result = await signInWithGoogle(
      // The stay has to survive the round trip, so the return address carries
      // it — and it comes back to this screen rather than to the booking,
      // because the attach is still owed and only this screen knows it.
      claiming === null
        ? afterSignIn
        : `/login?${ATTACH_ON_ARRIVAL_PARAM}=${encodeURIComponent(claiming)}`,
    );

    if (result.ok) {
      // The browser is on its way to Google. Left pending for the same reason
      // as above: the button should not offer itself again mid-navigation.
      return;
    }

    setError(result.message);
    setPending(false);
  }

  return (
    <main className={styles.screen}>
      <div className={styles.track} data-pane={pane}>
        {/* Both plates are atmosphere the copy does not depend on, so both are
            decorative and neither is in the accessibility tree —
            design-foundations.md §7. */}
        <aside className={styles.plate} data-plate="a" aria-hidden="true">
          <img
            className={styles.plateImage}
            src="/images/auth/sea-terrace-1920.webp"
            srcSet="/images/auth/sea-terrace-640.webp 640w, /images/auth/sea-terrace-1280.webp 1280w, /images/auth/sea-terrace-1920.webp 1920w"
            sizes="60vw"
            alt=""
            fetchPriority="high"
            decoding="async"
          />
          <div className={styles.plateScrim} />
          <div className={styles.plateBody}>
            <span className={styles.monogram} />
            <div>
              <p className={`${styles.statement} font-display`}>
                An experience worth returning to.
              </p>
              <p className={styles.statementNote}>
                Sign in to continue your journey.
              </p>
            </div>
          </div>
        </aside>

        <section className={styles.pane}>
          <div className={styles.paneBody}>
            <h1 className={`${styles.title} font-display`}>Welcome back</h1>
            {/* The same sentence for every guest who came from a stay, and it
                says nothing about them: what is in the address is a booking
                they were already reading. Whether their address has an account
                is settled in the confirmation email and nowhere a page can be
                asked. */}
            <p className={styles.subtitle}>
              {claiming === null && claimingNow === null
                ? "Log in to access your account."
                : "Log in and this stay is kept with your account."}
            </p>

            {/* Native validation left on. An empty submit would otherwise reach
                the API and come back as "that email and password do not
                match", which is both wrong and the one error message here that
                must stay trustworthy. */}
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
                  onFocus={() => setPane("email")}
                />
              </div>

              {/* A div, not a label: the reveal control is a labelable element
                  and a <label> may hold only one of those — its own. The label
                  below points at the input by id instead. */}
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="password">
                  Password
                </label>
                <input
                  className={styles.input}
                  id="password"
                  type={revealed ? "text" : "password"}
                  name="password"
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  onFocus={() => setPane("password")}
                />
                <button
                  className={styles.reveal}
                  type="button"
                  aria-pressed={revealed}
                  aria-label={revealed ? "Hide password" : "Show password"}
                  onClick={() => setRevealed(!revealed)}
                >
                  <EyeIcon className={styles.revealIcon} open={revealed} />
                </button>
              </div>

              <a className={styles.forgot} href="/forgot-password">
                Forgot password?
              </a>

              {/* Announced when it arrives, and it arrives after a round trip —
                  so it has to be a live region rather than something the guest
                  is expected to go back and find. */}
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
                {pending ? "Signing in" : "Log in"}
              </button>
            </form>

            <p className={styles.continueWith}>or continue with</p>
            <ul className={styles.providers}>
              {PROVIDERS.map((provider) => (
                <li key={provider.id}>
                  <button
                    className={styles.provider}
                    type="button"
                    disabled={!provider.enabled || pending}
                    aria-label={
                      provider.enabled
                        ? `Continue with ${provider.label}`
                        : `Continue with ${provider.label} — not available yet`
                    }
                    onClick={provider.id === "google" ? onGoogle : undefined}
                  >
                    <ProviderIcon
                      className={styles.providerIcon}
                      provider={provider.id}
                    />
                  </button>
                </li>
              ))}
            </ul>

            {/* The footnote names both ways on when a stay is being claimed,
                because a guest with no account has two and they fail in
                different places.

                `/signup` carries the booking now — `signup/page.tsx` takes the
                same parameter this page does and returns the verified guest to
                this screen's attach-on-arrival address, so the stay is claimed
                rather than left behind. It works because the browser reading
                this is the browser holding the booking's cookie, which is the
                half of the attach a mailbox cannot supply. Lose that cookie and
                the whole path goes with it.

                The confirmation email's other link is the one that survives
                that: it needs no cookie and no device, because the message
                itself is the proof of the address. It is named and not linked,
                and that is not an oversight — it is signed, minted per stay and
                exists only in the mailbox it went to, which is exactly what
                makes it proof. A page that could link to it is a page that
                could mint it.

                Neither sentence says anything about the reader. Whether an
                address already has an account is settled in the mail and must
                never be inferable from a page, because a hold is
                unauthenticated and anyone can make one naming somebody else's
                address. Every viewer reads the same words here. */}
            {claiming === null && claimingNow === null ? (
              <p className={styles.footnote}>
                New here?{" "}
                <a className={styles.footnoteLink} href="/signup">
                  Create an account
                </a>
              </p>
            ) : (
              <p className={styles.footnote}>
                New here?{" "}
                <a
                  className={styles.footnoteLink}
                  href={`/signup?${ATTACHING_BOOKING_PARAM}=${encodeURIComponent(
                    claiming ?? claimingNow ?? "",
                  )}`}
                >
                  Create an account
                </a>{" "}
                and this stay comes with you. Your confirmation email carries a
                link that does the same, from any device.
              </p>
            )}
          </div>
        </section>

        <aside className={styles.plate} data-plate="b" aria-hidden="true">
          {/* Not lazy. This plate is off-frame at first paint but it is one
              transform away from being the largest thing on screen, and a plate
              that decodes during the pan is the pan going wrong. */}
          <img
            className={styles.plateImage}
            src="/images/auth/alcove-vase-1920.webp"
            srcSet="/images/auth/alcove-vase-640.webp 640w, /images/auth/alcove-vase-1280.webp 1280w, /images/auth/alcove-vase-1920.webp 1920w"
            sizes="60vw"
            alt=""
            decoding="async"
          />
        </aside>
      </div>
    </main>
  );
}

function EyeIcon({ className, open }: { className: string; open: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M1.5 12S5.2 5.5 12 5.5 22.5 12 22.5 12 18.8 18.5 12 18.5 1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.25" />
      {open ? <path d="M4 20 20 4" /> : null}
    </svg>
  );
}

// Google's mark is the official four-colour G, because the button now actually
// offers Google sign-in and their brand guidelines apply from that moment — a
// recoloured G on a live button is a term of use, not a palette decision. Apple
// stays a monochrome glyph, which is what the reference composition sets and
// what an unwired button is entitled to; it changes when that button does.
function ProviderIcon({
  className,
  provider,
}: {
  className: string;
  provider: "google" | "apple";
}) {
  if (provider === "apple") {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M16.2 12.7c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.6-1.9-1.5-.2-3 .9-3.8.9s-2-.9-3.2-.9C6 7.2 4.4 8.2 3.6 9.7c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.7c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.9ZM13.9 4.8c.7-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {/* The official G fills its own box edge to edge, where the Apple glyph
          beside it is drawn with margins. Scaled about its centre so the two
          discs read as one row — uniform, so the mark's proportions and
          colours are still Google's own. */}
      <g transform="translate(12 12) scale(0.82) translate(-12 -12)">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.89Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.87-3.02c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.28v3.11A11.995 11.995 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.27a7.19 7.19 0 0 1 0-4.55V6.61H1.28a12 12 0 0 0 0 10.77l3.99-3.11Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.61l3.99 3.11C6.22 6.88 8.87 4.75 12 4.75Z"
        />
      </g>
    </svg>
  );
}
