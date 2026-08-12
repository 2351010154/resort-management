"use client";

/* What makes `(app)` the authenticated realm rather than a folder named after
 * one.
 *
 * The guard is a client component and not middleware, and that follows from
 * where the session lives: the access token is in memory and the refresh token
 * is an httpOnly cookie scoped to `/auth/staff` on the *API's* origin, so a
 * request to this origin carries nothing an edge function could read. The
 * browser is the only place that can answer "is there a session", and it
 * answers by spending the cookie.
 *
 * Nothing renders until it has. Rendering the screen first and redirecting
 * afterwards would put an operator's arrivals queue on screen for a frame
 * before deciding they may not see it, and a frame is long enough to read and
 * to screenshot.
 */

import { usePathname, useRouter } from "next/navigation";
import type * as React from "react";
import { useEffect } from "react";

import { loginHref } from "./landing-route";
import { useStaffSession } from "./session-provider";

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const session = useStaffSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status !== "anonymous") {
      return;
    }

    // The query string is read off the location rather than through
    // `useSearchParams`, which would opt every screen under this layout into
    // client-side rendering to give the same answer. This runs in an effect, so
    // there is always a window.
    const from = `${pathname}${window.location.search}`;

    // `replace`, not `push`: the screen they could not see should not be behind
    // the back button of the login screen they were sent to.
    router.replace(loginHref(from));
  }, [session.status, pathname, router]);

  if (session.status !== "authenticated") {
    return null;
  }

  return children;
}
