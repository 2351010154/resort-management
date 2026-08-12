/* The console's session, held in memory and nowhere else.
 *
 * Not `localStorage`, not `sessionStorage`, not a cookie this page can read.
 * The API's own reasoning applies unchanged on this side of the wire: a token
 * JavaScript can read is a token an injected script can take, so the short-lived
 * half lives in a closure that dies with the tab and the long-lived half is an
 * httpOnly cookie the page never sees. The cost of that choice is this file —
 * a reload has no token, so the first thing the console does is spend the
 * cookie for a new one.
 *
 * The store is created around a transport rather than importing one, so what is
 * proved below — when a refresh is due, and that two callers wanting one get a
 * single request — is proved without a network or a fake server.
 */

import type {
  StaffSession,
  StaffSessionUser,
  StaffSignInBody,
} from "@mariva/shared";

/** The three calls a session is made of. `staff-auth-requests.ts` is the one
 *  that talks to the API; a spec passes its own. */
export interface StaffAuthTransport {
  signIn(credentials: StaffSignInBody): Promise<StaffSession>;
  refresh(): Promise<StaffSession>;
  signOut(): Promise<void>;
}

/**
 * What the tree may see. The access token is deliberately not in it: state is
 * read by components, and a token in a component's props is a token in a React
 * DevTools tree and in every error report that serialises one. It is reached
 * through `token()` by the two callers that put it on a request.
 */
export type StaffSessionState =
  /** Before the first refresh has answered. Neither signed in nor signed out —
   *  the cookie may yet produce a session, and treating this as anonymous is
   *  what bounces an operator to login on every reload. */
  | { readonly status: "restoring" }
  | { readonly status: "anonymous" }
  | {
      readonly status: "authenticated";
      readonly user: StaffSessionUser;
      /** Epoch milliseconds on *this* clock. The API counts seconds from the
       *  moment it issued; a browser can only schedule against its own. */
      readonly expiresAt: number;
    };

export type StaffSignInOutcome =
  | { readonly ok: true; readonly user: StaffSessionUser }
  | { readonly ok: false; readonly message: string };

/**
 * The API's single answer to every credential failure, repeated verbatim.
 *
 * It does not say which half was wrong, and neither does this: "no such
 * account" and "wrong password" are different facts, and telling them apart is
 * how a stolen address list becomes a list of staff addresses.
 */
export const CREDENTIALS_REFUSED = "Email or password is incorrect";

/** Everything that is not a refusal. The operator can act on this one — it is
 *  the network, not their password. Blameless and without an apology, per
 *  design-foundations §6. */
export const SIGN_IN_UNREACHABLE = "The connection did not hold. Try again.";

/**
 * How far ahead of expiry a token is replaced.
 *
 * The access token lives 30 minutes (`ACCESS_TOKEN_TTL_SECONDS`), so a minute
 * is 3% of it — long enough to cover a slow refresh and a browser clock a few
 * seconds off the API's, short enough that a session is not being renewed
 * constantly. It has to exceed the round trip: a margin under it would let a
 * request leave with a token that expires in flight, which is the 401 the
 * recovery path exists to catch rather than to rely on.
 */
export const REFRESH_MARGIN_MS = 60_000;

/**
 * The shortest wait the scheduler will accept between two renewals.
 *
 * The margin above assumes a token that outlives it. A token that does not —
 * an API misconfigured to issue a one-minute access token, or a clock that
 * disagrees by more than the token's whole life — would otherwise schedule
 * every renewal at zero and turn the console into a loop hammering `/refresh`
 * from every open tab. Five seconds is far below anything an operator would
 * notice and far above a loop.
 */
export const MIN_REFRESH_DELAY_MS = 5_000;

/** Whether a token is close enough to expiry to be worth replacing before use. */
export function needsRefresh(expiresAt: number, now: number): boolean {
  return expiresAt - now <= REFRESH_MARGIN_MS;
}

/**
 * How long to wait before renewing a token that expires at `expiresAt`.
 *
 * Never negative and never zero: a token already inside its margin — a laptop
 * reopened after being asleep — is renewed almost immediately rather than
 * scheduled into the past, and the floor is what stops "almost immediately"
 * from becoming a loop when every renewal lands back inside the margin. A call
 * site that needs the token *now* does not wait for this at all; it calls
 * `ensureFresh`, which refreshes on demand.
 */
export function refreshDelayMs(expiresAt: number, now: number): number {
  return Math.max(MIN_REFRESH_DELAY_MS, expiresAt - now - REFRESH_MARGIN_MS);
}

export interface StaffSessionStore {
  getState(): StaffSessionState;
  /** For `useSyncExternalStore`. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** The bearer token, or null when there is no session. Read per request. */
  token(): string | null;
  signIn(credentials: StaffSignInBody): Promise<StaffSignInOutcome>;
  /** Spends the refresh cookie. Shared between concurrent callers; a failure
   *  ends the session rather than being retried. */
  refresh(): Promise<StaffSessionState>;
  /** Refreshes only if the token is inside its margin, or has never been got.
   *  What a call site uses before putting a token on a request. */
  ensureFresh(): Promise<StaffSessionState>;
  /** Drops the token, then asks the API to revoke the cookie. */
  signOut(): Promise<void>;
}

export function createStaffSessionStore(
  transport: StaffAuthTransport,
): StaffSessionStore {
  let state: StaffSessionState = { status: "restoring" };
  let accessToken: string | null = null;
  const listeners = new Set<() => void>();

  /**
   * The one refresh in flight, if there is one.
   *
   * Every screen mounting at once on a restored page wants a token, and the
   * refresh token rotates on use — so two simultaneous requests would race for
   * one rotation and the loser would be spending a token the API has already
   * retired. Sharing the promise makes "refresh" idempotent for as long as it
   * takes to answer, which is exactly the window the duplicates arrive in.
   */
  let inFlight: Promise<StaffSessionState> | null = null;

  function publish(next: StaffSessionState): StaffSessionState {
    state = next;
    for (const listener of listeners) {
      listener();
    }
    return state;
  }

  function adopt(session: StaffSession): StaffSessionState {
    accessToken = session.accessToken;
    return publish({
      status: "authenticated",
      user: session.user,
      expiresAt: Date.now() + session.expiresIn * 1000,
    });
  }

  function abandon(): StaffSessionState {
    accessToken = null;
    return publish({ status: "anonymous" });
  }

  function refresh(): Promise<StaffSessionState> {
    if (inFlight) {
      return inFlight;
    }

    inFlight = transport
      .refresh()
      .then(adopt)
      // Both halves end the session, and neither retries. A refresh that failed
      // because the cookie is gone will fail again for the same reason, and a
      // console that keeps asking is a console hammering the API from every open
      // tab of a staff member who went home.
      .catch(abandon)
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    token: () => accessToken,

    async signIn(credentials) {
      try {
        const session = await transport.signIn(credentials);
        adopt(session);
        return { ok: true, user: session.user };
      } catch (error) {
        abandon();

        // Anything that is not the API saying no is the API not answering, and
        // the operator is owed the difference: one is a password to retype and
        // the other is a network to wait for.
        return {
          ok: false,
          message: isRefusal(error) ? CREDENTIALS_REFUSED : SIGN_IN_UNREACHABLE,
        };
      }
    },

    refresh,

    ensureFresh() {
      if (
        state.status === "authenticated" &&
        !needsRefresh(state.expiresAt, Date.now())
      ) {
        return Promise.resolve(state);
      }

      if (state.status === "anonymous") {
        // Already answered: the cookie was spent and did not produce a session.
        // Asking again on every call is the retry loop this avoids.
        return Promise.resolve(state);
      }

      return refresh();
    },

    async signOut() {
      // Cleared first. The operator pressed sign out, and this page is signed
      // out from that moment whatever the network does with the next line.
      abandon();
      await transport.signOut();
    },
  };
}

/** Whether a thrown value is the API refusing rather than failing to answer.
 *  Structural on purpose — the store is given its transport, and a spec's
 *  transport should not have to import an error class to be believed. */
function isRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    (error as { kind: unknown }).kind === "refused"
  );
}
