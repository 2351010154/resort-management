// The guest realm's two sign-in calls: an address and a password, or Google.
//
// A bare fetch rather than @mariva/api-client: that package has no source yet
// and this is its only would-be caller. It moves there the day a second screen
// needs the same session — repository-structure.md is explicit that one
// consumer does not make something shared.
//
// Better Auth serves this route itself (apps/api/src/modules/auth/guest), so
// the path below is its `basePath` plus its own endpoint name, and neither half
// is ours to rename. `GUEST_AUTH_BASE_PATH` in guest-auth.factory.ts is the
// other end of this string.

import { origin } from "./guest-auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const SIGN_IN_PATH = "/api/auth/sign-in/email";
const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

/**
 * Where a signed-in guest lands.
 *
 * No authenticated surface exists yet, so it is the arrival; this becomes the
 * funnel's first screen when there is one. Named here rather than on the login
 * screen because Google's round trip needs the same destination and a second
 * copy of it is a second thing to remember to change.
 */
export const AFTER_SIGN_IN = "/";

export type SignInResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

// Copy per design-foundations §6 — plain and blameless, no apology theatre and
// no exclamation marks. The credentials line deliberately does not say which
// half was wrong: telling a stranger that an address exists is an account
// enumeration oracle, and the API is careful not to be one either.
const MESSAGES = {
  credentials: "That email and password do not match.",
  unverified: "Confirm your address first. The link is in your inbox.",
  throttled: "Too many attempts. Try again in a minute.",
  unreachable: "The connection did not hold. Try again.",
  googleUnavailable:
    "Google sign-in is not available right now. Use your email and password.",
  googleRefused:
    "Google sign-in did not go through. Try again, or use your email and password.",
  // Reachable only by someone Google has just confirmed owns the address, so
  // it can say what is actually in the way. The account it names is one that
  // was opened with a password and never confirmed — Better Auth will not fold
  // a Google identity into a row nobody has proved they own, and that refusal
  // is what keeps a stranger from claiming an address by registering it first.
  googleNotLinked:
    "That address already has an account here. Log in with your password, or reset it.",
} as const;

/**
 * Signs a guest in and lets the API set the session cookie.
 *
 * Resolves rather than throws: every outcome here is something the screen has
 * a sentence for, and a rejected promise would only be caught and turned back
 * into one of these four strings at the call site.
 */
export async function signInWithEmail(credentials: {
  readonly email: string;
  readonly password: string;
}): Promise<SignInResult> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${SIGN_IN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The session is an httpOnly cookie the API sets on its own origin.
      // Without this the request succeeds and the browser discards the cookie,
      // which reads as "signed in, then immediately signed out".
      credentials: "include",
      body: JSON.stringify(credentials),
    });
  } catch {
    return { ok: false, message: MESSAGES.unreachable };
  }

  if (response.ok) return { ok: true };

  // Read off the status rather than the body's error code. The three statuses
  // below map one-to-one onto the API's configured behaviour — 429 from the
  // five-a-minute rule on /sign-in/email, 403 from
  // `requireEmailVerification` — and parsing a body to re-derive what the
  // status already says is a second thing that can be wrong.
  if (response.status === 429)
    return { ok: false, message: MESSAGES.throttled };
  if (response.status === 403)
    return { ok: false, message: MESSAGES.unverified };
  return { ok: false, message: MESSAGES.credentials };
}

/**
 * Hands the browser to Google, and resolves only if it never got there.
 *
 * Two steps rather than a link: the API answers this POST with the authorize
 * URL it built — client id, scopes, and a state parameter it will check on the
 * way back — and the navigation is the second. A hard `assign` rather than the
 * router, because the destination is not this application.
 *
 * The guest returns to the API's `/api/auth/callback/google`, which sets the
 * session cookie and redirects to one of the two URLs below. Both are on this
 * origin and both are absolute, for the reason `origin()` gives.
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${SOCIAL_SIGN_IN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${origin()}${AFTER_SIGN_IN}`,
        // Better Auth appends `?error=<code>`; the login screen reads it back
        // through `googleErrorMessage`.
        errorCallbackURL: `${origin()}/login`,
      }),
    });
  } catch {
    return { ok: false, message: MESSAGES.unreachable };
  }

  if (response.status === 429) {
    return { ok: false, message: MESSAGES.throttled };
  }

  // A 400 here is the provider not being registered — the API refuses to
  // register half a credential, so this is what a missing GOOGLE_CLIENT_ID
  // looks like from the browser.
  if (!response.ok) {
    return { ok: false, message: MESSAGES.googleUnavailable };
  }

  const url = await authorizeUrl(response);

  if (!url) {
    return { ok: false, message: MESSAGES.googleUnavailable };
  }

  window.location.assign(url);

  // The tab is leaving. Reported as success so the caller holds its pending
  // state rather than offering the button again mid-navigation.
  return { ok: true };
}

/**
 * The sentence for an `?error=` the API redirected back to /login with.
 *
 * Every failure on the far side of the round trip arrives this way — the guest
 * closing Google's window, a state parameter that did not survive, an address
 * that already belongs to an unconfirmed account here.
 */
export function googleErrorMessage(code: string): string {
  return code === "account_not_linked"
    ? MESSAGES.googleNotLinked
    : MESSAGES.googleRefused;
}

async function authorizeUrl(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { url?: unknown };

    return typeof body.url === "string" ? body.url : undefined;
  } catch {
    return undefined;
  }
}
