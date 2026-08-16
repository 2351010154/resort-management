"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { LOGIN_ROUTE } from "./landing-route";
import { staffSession } from "./staff-session";

/* Ending a shift, from wherever the operator reached for it.
 *
 * Two surfaces offer sign-out — the palette's `Actions` group and the rail's
 * user menu — and the ordering below is the part that has to be identical in
 * both. A second copy of it in the menu would be a copy that drifts, and the
 * way it would drift is by awaiting the request first, which leaves an
 * authenticated screen on display while the token is being revoked.
 */

/** Signs the operator out and leaves for login. Safe to call from anywhere
 *  inside the app router. */
export function useEndSession(): () => void {
  const router = useRouter();

  return useCallback(() => {
    // Navigate first, because `signOut` drops the in-memory token before it
    // awaits anything and the guard above this screen redirects the moment the
    // state turns anonymous. Which of the two navigations lands is not worth
    // arranging: both end on login, and the guard's carries the screen the
    // operator was on as `next`, so signing back in resumes it. Either is a
    // correct place to be — what matters is that neither leaves an
    // authenticated screen rendered after the token is gone.
    router.replace(LOGIN_ROUTE);

    // The request still matters after the navigation: it is what revokes the
    // refresh token and clears the cookie, and without it the next reload would
    // restore the session the operator just ended.
    void staffSession.signOut();
  }, [router]);
}
