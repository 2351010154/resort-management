"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { formatShortcut } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";
import { detectPlatform, RovingFocusGroup } from "@/lib/keyboard";
import { isActivePath, navItemsFor, navShortcut } from "./nav-inventory";
import { NavItem } from "./nav-item";
import { UserMenu } from "./user-menu";

/* The rail every authenticated screen is drawn beside.
 *
 * What it holds is decided by the session's role rather than by the screen, so
 * a housekeeper's console has one entry in it and an administrator's has
 * fifteen. That filtering is not a security boundary — the API's capability
 * guard is — but offering a door that answers 403 is the console telling
 * somebody their job includes a screen it does not, and they will ask why it is
 * broken rather than conclude it is not theirs.
 *
 * Persistent, and that is the point of it being in the layout rather than in a
 * page: Next keeps a layout mounted across a navigation within its group, so
 * the rail is not rebuilt, the roving Tab stop is not lost, and the sequence
 * bindings are not unregistered and re-registered on every screen change.
 */

export function AppNav() {
  const session = useStaffSession();
  const pathname = usePathname();
  // Read once. It cannot change within a session, and every entry's hint is
  // formatted against it.
  const platform = useMemo(() => detectPlatform(), []);

  // The guard above this renders nothing until the session is authenticated, so
  // this is unreachable in the shell. It is here because the narrowing is real
  // — `user` exists on one of the three states — and a cast would be a claim
  // about a component's position in a tree that nothing checks.
  if (session.status !== "authenticated") {
    return null;
  }

  const items = navItemsFor(session.user.role);

  return (
    <nav
      // Named, because a screen reader listing landmarks needs to tell this
      // apart from whatever navigation a screen draws inside itself.
      aria-label="Console sections"
      className="flex w-56 shrink-0 flex-col gap-4 border-border border-r bg-card px-3 py-4"
    >
      {/* The property, not a logo. The console is one hotel's back office and
       * an operator never needs to be told which product they are in — what the
       * head of the rail is for is somewhere for the eye to start. */}
      <span className="px-3 font-display text-lg">Mariva</span>

      <RovingFocusGroup className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            active={isActivePath(pathname, item.href)}
            hint={formatShortcut(navShortcut(item), platform)}
          />
        ))}
      </RovingFocusGroup>

      {/* Pushed to the foot of the rail by the margin rather than by a spacer
       * element, so the entries above stay a single list to the arrows. */}
      <div className="mt-auto border-border border-t pt-2">
        <UserMenu user={session.user} />
      </div>
    </nav>
  );
}
