// The rest of the guest realm's calls: creating an account, confirming an
// address, and the two halves of a password reset.
//
// Same shape and same reasoning as `sign-in.ts` — a bare fetch rather than
// `@mariva/api-client`, every outcome resolved rather than thrown, and one
// sentence per outcome that the screen can render as it stands. Sign-in kept
// its own file because it was written first and is the only call with three
// distinct failure statuses; everything below shares the small helper at the
// bottom of this one.
//
// Better Auth serves all of these itself (apps/api/src/modules/auth/guest), so
// the paths are its `basePath` plus its own endpoint names, and neither half is
// ours to rename.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type AuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

// Copy per design-foundations §6 — plain and blameless, no apology theatre and
// no exclamation marks.
const MESSAGES = {
  weakPassword: "Passwords need at least 12 characters.",
  throttled: "Too many attempts. Try again in a minute.",
  expiredLink: "That link has expired. Ask for a new one.",
  unreachable: "The connection did not hold. Try again.",
  refused: "That did not go through. Check the details and try again.",
} as const;

/** The floor the API enforces — `MIN_PASSWORD_LENGTH` in guest-auth.factory.ts.
 *  Stated here so the form can say so before a round trip, and stated as the
 *  same number because a form that promised less would be lying. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Where the API sends a guest after it has acted on an emailed link, or on a
 * round trip to Google.
 *
 * Absolute and on this origin, both deliberately. A relative path would resolve
 * against the API's own origin and land the guest on a JSON endpoint, and an
 * origin the API does not trust is refused outright — `trustedOrigins` in
 * guest-auth.factory.ts is the list, and this is the site on it.
 */
export function origin(): string {
  // Every caller runs in a submit or click handler, so there is always a
  // window. A server-side fallback here would be a second source for this
  // value and a branch no test could reach.
  return window.location.origin;
}

/**
 * Creates an account and starts the confirmation.
 *
 * The API sends the verification email itself; there is nothing to do here but
 * tell the guest to go and look. It does not sign them in — `sign-in/email`
 * refuses until the address is confirmed, which is the whole point of the step.
 *
 * **An address that already has an account also succeeds.** Better Auth
 * answers with a plausible user object, writes nothing and sends nothing —
 * verified against the database, which gained no row, and the mail log, which
 * gained no message. It is deliberate: an endpoint that says "taken" is an
 * endpoint that answers "does this person stay here?" for anyone who asks. So
 * there is no taken-address message to render, and the screen's copy is
 * written not to promise an email that may not arrive.
 */
export async function signUpWithEmail(details: {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}): Promise<AuthResult> {
  return post("/api/auth/sign-up/email", {
    ...details,
    callbackURL: `${origin()}/verify-email?confirmed=1`,
  });
}

/** Sends the confirmation email again, for the guest who lost the first one. */
export async function resendVerificationEmail(
  email: string,
): Promise<AuthResult> {
  return post("/api/auth/send-verification-email", {
    email,
    callbackURL: `${origin()}/verify-email?confirmed=1`,
  });
}

/**
 * Starts a password reset.
 *
 * Succeeds whether or not the address has an account, and the screen says the
 * same thing either way. Anything else turns this form into a way of asking
 * "does this person stay here?" and getting an answer.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  return post("/api/auth/request-password-reset", {
    email,
    redirectTo: `${origin()}/reset-password`,
  });
}

/**
 * Finishes one, with the token the emailed link carried.
 *
 * The API revokes every other session on success, so a guest resetting a
 * password because someone else has it is not left signed in on that
 * someone else's device.
 */
export async function resetPassword(params: {
  readonly token: string;
  readonly newPassword: string;
}): Promise<AuthResult> {
  return post("/api/auth/reset-password", params);
}

/** Ends the session. The cookie is httpOnly, so only the API can clear it. */
export async function signOut(): Promise<AuthResult> {
  return post("/api/auth/sign-out", {});
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<AuthResult> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The session is an httpOnly cookie the API sets on its own origin.
      // Without this the request succeeds and the browser discards the cookie.
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: MESSAGES.unreachable };
  }

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 429) {
    return { ok: false, message: MESSAGES.throttled };
  }

  // Better Auth names its failures in the body, and two of those names are
  // worth reading: a password that is too short and a link that has expired are
  // different corrections for the guest to make, and both arrive as 400.
  const code = await errorCode(response);

  if (code === "PASSWORD_TOO_SHORT") {
    return { ok: false, message: MESSAGES.weakPassword };
  }

  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") {
    return { ok: false, message: MESSAGES.expiredLink };
  }

  return { ok: false, message: MESSAGES.refused };
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };

    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    // A response that is not JSON is a response with nothing to add. The
    // status has already been read.
    return undefined;
  }
}
