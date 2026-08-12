"use client";

/* The console's 404, and — until the first screen family lands — its only exit.
 *
 * The role-aware landing sends a signed-in operator to `/dashboard`,
 * `/housekeeping` or `/payments`, and none of those exist yet. That is the
 * honest state of a console with a working session and no screens, but honest
 * is not the same as recoverable: the screen families that would carry the
 * palette are the missing ones, so there is no ⌘K here and therefore no sign
 * out, and `/login` sends an operator who still has a session straight back to
 * the destination that produced this page. Without the button below, signing in
 * is a one-way door until the refresh cookie expires.
 *
 * It is a 404 rather than a placeholder for any planned screen: it says the
 * screen is not built, names nothing that is going to be built, and describes
 * no inventory. It goes away on its own terms, not when a particular screen
 * arrives.
 *
 * `staffSession` is reached directly rather than through the provider, because
 * `not-found.tsx` renders inside the root layout — outside `(app)` and outside
 * anything that mounts one.
 */

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { LOGIN_ROUTE, staffSession } from "@/lib/auth";

export default function NotFound() {
  const router = useRouter();
  const session = useSyncExternalStore(
    staffSession.subscribe,
    staffSession.getState,
    staffSession.getState,
  );

  // No restore is started from here. This page is reached either by a signed-in
  // operator whose landing does not exist — in which case the store is already
  // filled by the route that redirected them — or by anyone typing a wrong
  // address, who is owed a 404 and not a round trip.
  const signedIn = session.status === "authenticated";

  return (
    <main className="flex min-h-svh items-center justify-center p-rhythm-3">
      <div className="w-full max-w-sm">
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Mariva
        </p>
        <h1 className="font-display text-display-sm mt-2">Console</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          {signedIn
            ? "This screen has not been built yet."
            : "There is nothing at this address."}
        </p>

        <Button
          className="mt-rhythm-2"
          onClick={() => {
            // The same order the palette's command uses: leave first, then
            // revoke, so no authenticated screen is left rendered after the
            // token is gone.
            router.replace(LOGIN_ROUTE);
            void staffSession.signOut();
          }}
          type="button"
        >
          {signedIn ? "Sign out" : "Go to sign in"}
        </Button>
      </div>
    </main>
  );
}
