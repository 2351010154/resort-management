"use client";

// The console's entry point, which is now the redirect it was always going to
// become: to login when there is no session, and to the role's own landing when
// there is.
//
// The landing is role-aware because a console that opened everyone on the same
// screen would be opening most people on someone else's — housekeeping walks
// the floors from the board, the accountant works from payments, and the desk
// roles share the dashboard launchpad (`docs/screens.md` §"Staff surfaces").
// The map itself is in `lib/auth/landing-route.ts`, where it is one tested
// function rather than a branch in a component.
//
// **The destinations do not exist yet.** They are the paths the screen families
// will occupy, and until each lands the redirect ends on a 404 — which is what
// a console with a working session and no screens honestly is. Placeholder
// screens behind them would be a second opinion about an inventory that has an
// owner, and would look like progress that has not happened.
//
// It renders nothing of its own. The theme check this route used to carry —
// every part of globals.css exercised by one page's utilities — moved to the
// login screen, which is a real screen built out of the same steps, faces and
// rhythm and is compiled by the same build.
//
// A client component and not a server redirect: the session is a token in
// memory and an httpOnly cookie on the *API's* origin, so a request to this
// origin carries nothing a server render could read. Only the browser can ask.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { landingRouteFor, LOGIN_ROUTE, useSessionState } from "@/lib/auth";

export default function ConsoleIndexPage() {
  const session = useSessionState();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "restoring") {
      return;
    }

    router.replace(
      session.status === "authenticated"
        ? landingRouteFor(session.user.role)
        : LOGIN_ROUTE,
    );
  }, [session, router]);

  // Deliberately blank while the cookie is being spent. This route is a
  // junction rather than a screen, and anything drawn here — a heading, a
  // spinner, the word "Loading" — would flash for the length of one request on
  // the way to somewhere else.
  return null;
}
