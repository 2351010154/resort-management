"use client";

/* The 404 an operator meets while signed in, and the half of the console's
 * not-found story that keeps them signed in.
 *
 * It renders inside `(app)/layout.tsx`, which is the whole point of it existing
 * separately from the root one: the rail is still drawn, ⌘K still opens, the
 * session store is still mounted and still full, and the address that produced
 * this page is a screen that has not been built rather than an eviction. The
 * root `app/not-found.tsx` cannot offer any of that — it renders above the
 * group, where none of it is mounted.
 *
 * The exit is a link to the role's own landing and not a sign-out. Sign-out was
 * the only exit a 404 could offer when no screen family existed to carry the
 * palette; four of them do now, so leaving here costs a navigation instead of a
 * session.
 *
 * The session is read off the store rather than through `useStaffSession`,
 * even though the provider is mounted above this. The hook throws when it finds
 * no provider, and a not-found boundary is exactly the place not to depend on
 * one being there: this renders on paths the router reaches in its own order,
 * and a boundary that can throw turns a missing screen into a server error.
 * The store answers from anywhere and answers `anonymous` when it has nothing.
 */

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DEFAULT_LANDING, landingRouteFor, staffSession } from "@/lib/auth";

export default function AppNotFound() {
  const session = useSyncExternalStore(
    staffSession.subscribe,
    staffSession.getState,
    staffSession.getState,
  );

  // The guard renders nothing until the session is authenticated, so the
  // fallback is a spelling of "we do not know yet" rather than a default anyone
  // lands on — and `/dashboard` sends whoever does reach it through the same
  // role-aware junction the console's index uses.
  const landing =
    session.status === "authenticated"
      ? landingRouteFor(session.user.role)
      : DEFAULT_LANDING;

  return (
    // A section and not a `main`: the layout already drew one around this, and
    // a second landmark would leave anything reading the page in order with two
    // answers to where the content starts.
    <section className="flex min-h-[calc(100svh-3.5rem)] items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-md p-6 text-center">
        <p className="text-sm font-semibold  text-muted-foreground uppercase">
          Mariva
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-9">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This address is not part of the staff console.
        </p>

        <Button asChild className="mt-6">
          <Link href={landing}>Back to the console</Link>
        </Button>
      </Card>
    </section>
  );
}
