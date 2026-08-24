"use client";

/* The console's 404 for an address outside the authenticated realm.
 *
 * It used to be every 404, and it used to sign the operator out, because when
 * no screen family existed there was nothing to go back to: no ⌘K, no rail, and
 * `/login` would send anyone who still held a session straight back to the
 * destination that produced this page. Signing out was the only exit that
 * worked.
 *
 * That is no longer where an operator lands. `(app)/[...unbuilt]/page.tsx`
 * catches the addresses the console's own navigation can reach and raises
 * `(app)/not-found.tsx` instead, inside the shell and with the session intact.
 * What is left here is what falls outside the group — a wrong address typed by
 * someone with no session — so the exit is the sign-in door and nothing is
 * revoked on the way to it.
 *
 * It is a 404 rather than a placeholder for any planned screen: it says nothing
 * is at this address, names nothing that is going to be built, and describes no
 * inventory.
 *
 * `staffSession` is reached directly rather than through the provider, because
 * `not-found.tsx` renders inside the root layout — outside `(app)` and outside
 * anything that mounts one.
 */

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DEFAULT_LANDING, LOGIN_ROUTE, staffSession } from "@/lib/auth";

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
    <main className="flex min-h-svh items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-md p-6 text-center">
        <p className="text-sm font-semibold  text-muted-foreground uppercase">
          Mariva
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-9">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {signedIn
            ? "This screen has not been built yet."
            : "There is nothing at this address."}
        </p>

        <Button
          className="mt-6"
          onClick={() => {
            // A session is never spent to leave a 404. Someone signed in who
            // reaches this page is one navigation away from the console they
            // already have; revoking their token to get them there was the old
            // behaviour and it cost them the shift's work in progress.
            router.replace(signedIn ? DEFAULT_LANDING : LOGIN_ROUTE);
          }}
          type="button"
        >
          {signedIn ? "Back to the console" : "Go to sign in"}
        </Button>
      </Card>
    </main>
  );
}
