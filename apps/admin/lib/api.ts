/* The API, as the console reaches it.
 *
 * `packages/api-client` is the transport boundary — the client is derived from
 * the contract in `@mariva/shared`, so a route whose shape changes breaks this
 * app at compile time rather than at runtime in whichever side was deployed
 * second. This module is where the console's screens are meant to reach that
 * client, and the two things it adds to it are the session and a way to read a
 * failure.
 *
 * **The instance is not built here, and that is deliberate.** `lib/auth/staff-session.ts`
 * already constructs one, wired to the store that holds the access token, and
 * the token has to be read per request for a silent refresh to be silent. A
 * second `createApiClient` call here would be a second client presenting the
 * same rotating token from a snapshot, so this module re-exports the one that
 * exists instead of making another. The base address is
 * `NEXT_PUBLIC_API_URL` there, the same variable `staff-auth-requests.ts` and
 * `apps/web` read, so a deployment names the API once.
 *
 * **Every call goes through the session.** The client exported below is the
 * session-scoped one wrapped so that each procedure runs inside
 * `withStaffSession`: the token is replaced before the call if it is inside its
 * expiry margin, and a 401 is retried exactly once behind a fresh token. Doing
 * it here rather than in each caller is what stops a screen author from being
 * the reason a console drops its operator half an hour after sign-in.
 */

import type { ApiClient } from "@mariva/api-client";

import {
  api as sessionScopedApi,
  withStaffSession,
} from "./auth/staff-session";

/** Runs one API call and is allowed to do something around it — refresh a
 *  token, retry once. The shape `withStaffSession` already has. */
export type ApiCallRunner = <T>(call: () => Promise<T>) => Promise<T>;

/**
 * The same client, with every procedure run through `run`.
 *
 * A proxy rather than a generated wrapper, for the reason the client itself is
 * generated: there is no per-endpoint entry to add here, so a route that lands
 * in the contract tomorrow is session-guarded the moment it is callable. The
 * proxy mirrors the client's own shape — a property access returns another
 * proxy over whatever the real client had there, and a call reaches the real
 * procedure inside `run`.
 *
 * Separated from its one use below so it can be tested against a stand-in
 * client and a stand-in runner, which is the only way to assert "the path is
 * preserved and the call is wrapped" without a live API and a live session.
 */
export function runCallsThrough<T>(client: T, run: ApiCallRunner): T {
  return guard(client, run) as T;
}

function guard(node: unknown, run: ApiCallRunner): unknown {
  if (
    typeof node !== "function" &&
    (typeof node !== "object" || node === null)
  ) {
    return node;
  }

  // The target is a function so the `apply` trap is reachable: an oRPC client's
  // branches are callable as well as indexable, and a plain object target would
  // make `client.housekeeping.board(...)` a TypeError.
  const shell = (...args: unknown[]) =>
    run(() => (node as (...a: unknown[]) => Promise<unknown>)(...args));

  return new Proxy(shell, {
    get: (_shell, key) => {
      // `then` is answered as absent so the proxy is not mistaken for a
      // thenable. The oRPC client answers every string key with a callable, so
      // anything that awaited this object — a stray `Promise.resolve(api)` —
      // would otherwise call a procedure named `then` and never settle. No
      // contract procedure is called `then`; if one ever is, this is the line
      // that has to change.
      if (typeof key === "symbol" || key === "then") {
        return undefined;
      }

      return guard((node as Record<string, unknown>)[key], run);
    },
  });
}

/**
 * The API, typed by the contract and carrying the operator's session.
 *
 * Callable directly, and normally not called directly: screens reach it through
 * `lib/api-query.ts`, which is the same client with TanStack Query's cache in
 * front of it. A one-off call that has no business being cached — a report
 * export, a form's own submit — may use this.
 */
export const api: ApiClient = runCallsThrough(
  sessionScopedApi,
  withStaffSession,
);

/**
 * The HTTP status behind a thrown value, or null when there was none.
 *
 * Structural rather than an `instanceof`, the same reading `isUnauthorized`
 * does: oRPC raises an error carrying the status it was built from, and the
 * fetch layer underneath it can reject with a plain object shaped like a
 * response. A network that was not there produces neither, which is exactly the
 * case that reads as null — and that is the case worth retrying.
 */
export function apiStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const status = (error as { status?: unknown }).status;

  return typeof status === "number" ? status : null;
}

/**
 * What a call to the API failed with, in a sentence an operator can act on.
 *
 * The handler's own `message` is preferred over anything invented here, because
 * the API's refusals are written for the person who will read them — a folio
 * that cannot be closed says which posting is unsettled, a hold that expired
 * says so. The fallback is for what never reached a handler: a network that was
 * not there, an API that is not up, a CORS pair that does not agree.
 *
 * Deliberately not a status code. "409" tells a receptionist nothing, and the
 * screen that caught the error has somewhere better to put the distinction.
 */
export function apiMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }

  return fallback;
}
