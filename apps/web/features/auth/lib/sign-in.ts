// The guest realm's sign-in call.
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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const SIGN_IN_PATH = "/api/auth/sign-in/email";

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
