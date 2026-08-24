"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useCommands } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";

import { navCommandId, navItemsFor } from "./nav-inventory";

/* Reaching the rail without the mouse.
 *
 * Every family the operator is offered is a row under ⌘K's `Go to` group,
 * which is the console's keyboard route to a screen: the operator who knows
 * where they want to be types the name of it. The group was empty by design
 * until this existed; it is filled from the same list the rail draws, so a
 * family cannot be in one and missing from the other.
 *
 * Headless, and mounted after the children for the reason the layout gives:
 * effects flush innermost-first, so a screen registering the same command id is
 * registered before the shell and wins the row.
 */

export function NavCommands() {
  const session = useStaffSession();
  const router = useRouter();

  const items =
    session.status === "authenticated"
      ? navItemsFor(session.user.role)
      : // Not reachable inside the guard, which renders nothing until there is
        // a session. Written out so the hook below is called unconditionally
        // and registers nothing rather than being skipped.
        [];

  const go = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  useCommands(
    items.map((item) => ({
      id: navCommandId(item),
      label: item.label,
      group: "navigation" as const,
      keywords: item.keywords,
      action: () => {
        go(item.href);
      },
    })),
  );

  return null;
}
