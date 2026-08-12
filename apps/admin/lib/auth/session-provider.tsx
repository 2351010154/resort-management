"use client";

/* The session, as the React tree sees it.
 *
 * The store underneath is a module singleton, so this provider owns no state of
 * its own. What it owns is the two things a store cannot do for itself: the
 * first refresh, which turns the httpOnly cookie back into a token after a
 * reload, and the timer that replaces that token before it expires.
 *
 * Both live here rather than in the store because they are effects with a
 * lifetime, and the lifetime that makes sense is "while the console is on
 * screen". A store that scheduled its own timers would keep a tab that has been
 * closed to a background one refreshing a session nobody is using.
 */

import type * as React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

import { staffSession } from "./staff-session";
import { refreshDelayMs, type StaffSessionState } from "./staff-session-store";

const StaffSessionContext = createContext<StaffSessionState | null>(null);

/**
 * Subscribes to the session and keeps it fresh, without a provider.
 *
 * For the two routes that are outside the authenticated shell and still need to
 * know whether a session exists: the index route, which redirects by role, and
 * the login screen, which must not offer a form to somebody already signed in.
 * The shell's provider is built on this same hook, so there is one restore
 * decision and one refresh schedule however many callers there are — the store
 * shares a single in-flight refresh between all of them.
 */
export function useSessionState(): StaffSessionState {
  const state = useSyncExternalStore(
    staffSession.subscribe,
    staffSession.getState,
    // The server has no cookie jar and no token. `restoring` is the honest
    // answer there and it is what the client renders first too, so hydration
    // matches and the redirect happens after the browser has asked.
    staffSession.getState,
  );

  useEffect(() => {
    if (state.status === "restoring") {
      void staffSession.refresh();
    }
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    const timer = setTimeout(
      () => {
        void staffSession.refresh();
      },
      refreshDelayMs(state.expiresAt, Date.now()),
    );

    // Cleared on every change of expiry, which is every successful refresh: the
    // new token schedules the next one, and the timer belonging to the token it
    // replaced would otherwise fire a second, pointless rotation.
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  return state;
}

/** Publishes the session to the authenticated tree. Mounted by the `(app)`
 *  layout, above the guard that reads it. */
export function StaffSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = useSessionState();

  return (
    <StaffSessionContext.Provider value={state}>
      {children}
    </StaffSessionContext.Provider>
  );
}

/**
 * The session, for a screen inside the shell.
 *
 * Throws outside the provider rather than reporting "anonymous". A screen that
 * silently believes nobody is signed in would render its empty state on a
 * perfectly good session, and that is indistinguishable from a bug in the
 * screen itself.
 */
export function useStaffSession(): StaffSessionState {
  const state = useContext(StaffSessionContext);

  if (state === null) {
    throw new Error(
      "useStaffSession was called outside StaffSessionProvider. The provider is mounted in app/(app)/layout.tsx; a screen that needs the session belongs inside that route group.",
    );
  }

  return state;
}
