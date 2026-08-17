// One POST to Better Auth, and the outcomes every caller of it shares.
//
// Better Auth serves the guest realm's credential routes itself
// (apps/api/src/modules/auth/guest), so a browser reaches them with a bare
// `fetch` rather than through `@mariva/api-client` — the contract in
// `@mariva/shared` types the oRPC routes and knows nothing about these. That
// leaves every caller writing the same four steps: send it, resolve a network
// failure rather than throw, resolve a 429, and read the failure name out of the
// body because the status alone cannot separate the rest.
//
// Those four steps live here because there were about to be three copies of
// them. `guest-auth.ts` holds sign-up, verification and the two halves of a
// password reset; `profile.ts` holds the address and password changes on
// `/account`. Both need the identical skeleton and only differ in which failure
// names they have a sentence for — so the skeleton is the argument and the names
// are the parameter.
//
// **The unreachable and throttled sentences belong to the skeleton.** They are
// the two outcomes no caller decides: a request that never arrived and one the
// API refused to count are the same event whatever route was asked for, and two
// copies of one sentence is one of them being reworded later.
//
// `sign-in.ts` is deliberately not folded in. It is the one call with three
// distinct failure statuses to tell apart rather than a body to read, and
// bending this shape around it would make the parameter below carry a status
// map for the benefit of a single caller.

/** The API's own origin. The session is an httpOnly cookie it set there. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Every credential call answers this: resolved, never thrown, and one sentence
 *  per outcome that a screen can render as it stands. */
export type AuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

// Copy per design-foundations §6 — plain and blameless, no apology theatre and
// no exclamation marks.
const SHARED = {
  unreachable: "The connection did not hold. Try again.",
  throttled: "Too many attempts. Try again in a minute.",
} as const;

/** What the API refused with, as much of it as the caller needs to choose a
 *  sentence: the status, and the name Better Auth put in the body. */
export interface AuthFailure {
  readonly status: number;
  /** Absent when the body was not JSON, or carried no `code`. */
  readonly code: string | undefined;
}

/**
 * One credential call, with the caller saying only what its own refusals mean.
 *
 * `credentials: "include"` on every call and not per caller: the session is an
 * httpOnly cookie the API set on its own origin, and without it the request
 * succeeds while the browser discards the cookie — a failure that looks like a
 * signed-out guest rather than a missing option.
 *
 * `say` is asked for a sentence only once the two outcomes above are ruled out,
 * so a caller never has to remember to handle them and cannot word them
 * differently.
 */
export async function callBetterAuth(
  path: string,
  body: Record<string, unknown>,
  say: (failure: AuthFailure) => string,
): Promise<AuthResult> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: SHARED.unreachable };
  }

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 429) {
    return { ok: false, message: SHARED.throttled };
  }

  return {
    ok: false,
    message: say({ status: response.status, code: await errorCode(response) }),
  };
}

/**
 * The name Better Auth gave the failure.
 *
 * Read from the body because the status cannot carry it: a password that does
 * not match, one that is too short and an account that has no password at all
 * all arrive as 400, and they are three different things for a guest to do next.
 */
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
