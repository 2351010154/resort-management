"use client";

/* The shell's own commands. One so far, and it is the session's.
 *
 * Sign out is registered here rather than drawn as a control because the
 * console has no navigation yet and, when it has one, ⌘K is still where an
 * operator who has finished their shift will reach for it. Registering from the
 * shell rather than from a screen is what makes it available on all of them —
 * and it is registered last, after the children, so a screen that ever needs to
 * intercept it can claim the same id and win.
 */

import { useRouter } from "next/navigation";

import { useCommands } from "@/features/command-palette";

import { LOGIN_ROUTE } from "./landing-route";
import { staffSession } from "./staff-session";

export function SessionCommands() {
  const router = useRouter();

  useCommands([
    {
      id: "session.sign-out",
      label: "Sign out",
      group: "actions",
      keywords: ["log out", "đăng xuất", "end shift"],
      action: () => {
        // Navigate first, because `signOut` drops the in-memory token before it
        // awaits anything and the guard above this screen redirects the moment
        // the state turns anonymous. Which of the two navigations lands is not
        // worth arranging: both end on login, and the guard's carries the
        // screen the operator was on as `next`, so signing back in resumes it.
        // Either is a correct place to be — what matters is that neither leaves
        // an authenticated screen rendered after the token is gone.
        router.replace(LOGIN_ROUTE);

        // The request still matters after the navigation: it is what revokes
        // the refresh token and clears the cookie, and without it the next
        // reload would restore the session the operator just ended.
        void staffSession.signOut();
      },
    },
  ]);

  return null;
}
