// The three staff-auth calls, as plain requests.
//
// A bare `fetch` rather than `@mariva/api-client`, and that is not a shortcut:
// these routes set and clear an httpOnly refresh cookie, which is why they sit
// outside the oRPC contract the client is generated from. What they do share
// with the API is their shapes — every body below is validated against the same
// `@mariva/shared` schema the Nest controller validates with, so a field
// renamed on either side breaks both at compile time and a response that is not
// the session it claims to be is caught here rather than three screens later.
//
// `credentials: "include"` on all three, for the cookie. Without it sign-in
// succeeds, the browser discards the cookie the API set, and the session ends
// silently the first time the access token needs replacing.

import {
  type StaffSession,
  type StaffSignInBody,
  staffSessionSchema,
} from "@mariva/shared";

// The same variable `apps/web` reads. One name for the API's location across
// the two front ends, so a deployment configures it once.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** `@Controller("auth/staff")`. The cookie's path is this prefix, so nothing
 *  below may move without the cookie moving with it. */
const STAFF_AUTH_PATH = "/auth/staff";

/**
 * Why a call did not produce a session.
 *
 * Three kinds and not a message, because the same failure reads differently
 * depending on who is waiting for it: a 401 on sign-in is a sentence for the
 * operator to act on, and a 401 on a background refresh is the session ending
 * with nobody looking at the screen.
 */
export type StaffAuthFailure =
  /** The API answered, and the answer was no. */
  | "refused"
  /** The API did not answer, or did not answer with a session. */
  | "unreachable";

export class StaffAuthError extends Error {
  constructor(
    readonly kind: StaffAuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "StaffAuthError";
  }
}

/** Exchanges credentials for a session, and lets the API set the refresh
 *  cookie. Throws {@link StaffAuthError} — the store above it decides what the
 *  operator is told. */
export async function requestStaffSignIn(
  credentials: StaffSignInBody,
): Promise<StaffSession> {
  return sessionFrom(await post("/sign-in", credentials));
}

/**
 * Spends the refresh cookie for a new access token.
 *
 * The body is empty on purpose: the API reads the cookie first and falls back
 * to a token in the body only for callers that cannot hold cookies. A browser
 * can, and the whole reason the long-lived half is a cookie is that this page
 * must not be able to read it.
 */
export async function requestStaffRefresh(): Promise<StaffSession> {
  return sessionFrom(await post("/refresh", {}));
}

/**
 * Ends the session server-side so the refresh cookie is revoked and cleared.
 *
 * Answers 204 with no body, so there is nothing to parse. It resolves even when
 * the API refuses: the caller has already dropped the access token it held, and
 * an operator who pressed sign out is signed out of this page whatever the
 * server thinks. The cookie surviving a failed call is the API's own problem to
 * report, not a reason to leave the console looking signed in.
 */
export async function requestStaffSignOut(): Promise<void> {
  try {
    await post("/sign-out", {});
  } catch {
    return;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${STAFF_AUTH_PATH}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    throw new StaffAuthError("unreachable", "The API could not be reached");
  }

  if (!response.ok) {
    // The status is the whole answer. The API returns one sentence for every
    // credential failure by design — reading the body to find out *which* half
    // was wrong would be reading an answer it deliberately does not give.
    throw new StaffAuthError(
      response.status === 401 || response.status === 400
        ? "refused"
        : "unreachable",
      `The API refused with ${response.status}`,
    );
  }

  return response;
}

async function sessionFrom(response: Response): Promise<StaffSession> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new StaffAuthError("unreachable", "The API answered with no session");
  }

  const parsed = staffSessionSchema.safeParse(body);

  if (!parsed.success) {
    // A 200 whose body is not a session is a deployment mismatch, not a
    // credential problem. Treated as unreachable so the console retries rather
    // than telling the operator their password is wrong.
    throw new StaffAuthError(
      "unreachable",
      "The API answered with something other than a session",
    );
  }

  return parsed.data;
}
