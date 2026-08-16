"use client";

/* The shell's own commands. One so far, and it is the session's.
 *
 * Sign out is drawn in the rail's user menu as well, and it is still registered
 * here: ⌘K is where an operator who has finished their shift will reach for it,
 * and the two surfaces run the same `useEndSession` so neither can end a
 * session differently from the other. Registering from the shell rather than
 * from a screen is what makes it available on all of them — and it is
 * registered last, after the children, so a screen that ever needs to intercept
 * it can claim the same id and win.
 */

import { useCommands } from "@/features/command-palette";

import { useEndSession } from "./use-end-session";

export function SessionCommands() {
  const endSession = useEndSession();

  useCommands([
    {
      id: "session.sign-out",
      label: "Sign out",
      group: "actions",
      keywords: ["log out", "đăng xuất", "end shift"],
      action: endSession,
    },
  ]);

  return null;
}
