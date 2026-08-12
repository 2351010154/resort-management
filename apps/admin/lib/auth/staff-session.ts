/* The console's one session, and the one API client that carries it.
 *
 * A module singleton rather than something a provider constructs. The store has
 * to be reachable from three places that are not in one React tree — the login
 * screen under `(auth)`, the guard under `(app)`, and the index route above
 * both — and a session per subtree is three sessions, three refreshes, and
 * three tokens racing for one rotating cookie.
 *
 * It is safe to evaluate on the server, where it is simply a store nobody ever
 * fills: a Node render has no refresh cookie to spend, so the state stays
 * `restoring` until the browser takes over. Nothing here reads `window`.
 *
 * "Nobody ever fills it" is enforced rather than assumed. A module singleton in
 * a Next server is one object shared by every request that process handles, so
 * a session adopted there would be one operator's session published to whoever
 * rendered next. The transport below refuses to run outside a browser, which
 * makes that unreachable instead of merely unlikely.
 */

import { createApiClient } from "@mariva/api-client";

import {
  requestStaffRefresh,
  requestStaffSignIn,
  requestStaffSignOut,
} from "./staff-auth-requests";
import {
  createStaffSessionStore,
  type StaffAuthTransport,
} from "./staff-session-store";

/** The real transport in a browser, and a transport that answers nothing at
 *  all anywhere else. */
const transport: StaffAuthTransport =
  typeof window === "undefined"
    ? {
        signIn: () => Promise.reject(new ServerSideSessionError()),
        refresh: () => Promise.reject(new ServerSideSessionError()),
        signOut: () => Promise.resolve(),
      }
    : {
        signIn: requestStaffSignIn,
        refresh: requestStaffRefresh,
        signOut: requestStaffSignOut,
      };

export const staffSession = createStaffSessionStore(transport);

/** Thrown if a render on the server ever tries to fill the shared store. Not
 *  expected: the session is spent from effects, which do not run there. */
class ServerSideSessionError extends Error {
  readonly kind = "unreachable";

  constructor() {
    super(
      "The staff session cannot be established during a server render: the store is a module singleton shared by every request this process serves, and the refresh cookie is the browser's.",
    );
    this.name = "ServerSideSessionError";
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * The contract client, wired to the session above.
 *
 * `staffToken` is a function and not a string for the reason `api-client`'s own
 * comment gives: the token is replaced mid-session, and a client holding the
 * one it was built with would present an expired token until the page reloaded.
 * Reading it per request is what makes a silent refresh silent.
 */
export const api = createApiClient({
  url: API_URL,
  staffToken: () => staffSession.token(),
});

/**
 * Runs an API call with the session kept underneath it.
 *
 * Two things happen around the call, and both are the difference between a
 * session that survives a working day and one that drops the operator at 30
 * minutes past sign-in:
 *
 * **Before.** A token inside its expiry margin is replaced first, so the
 * request leaves with one that will still be valid when it lands.
 *
 * **After, once.** A 401 is still possible — the API restarted, the account was
 * deactivated, the clock disagreed — so one refresh is attempted and the call is
 * retried exactly once. Once, and never in a loop: a second 401 after a fresh
 * token is the API saying no about something a third token will not fix, and it
 * is left to the caller with the session already ended.
 */
export async function withStaffSession<T>(call: () => Promise<T>): Promise<T> {
  await staffSession.ensureFresh();

  try {
    return await call();
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }

    const recovered = await staffSession.refresh();

    if (recovered.status !== "authenticated") {
      throw error;
    }

    return call();
  }
}

/**
 * Whether a thrown value is the API refusing the token.
 *
 * Structural rather than an `instanceof`: oRPC's error carries the HTTP status
 * it was built from, and the client may also reject with a plain `Response`
 * shaped object from the fetch layer underneath it. Both spell the one fact
 * this needs the same way.
 */
export function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const status = (error as { status?: unknown }).status;

  return status === 401;
}
