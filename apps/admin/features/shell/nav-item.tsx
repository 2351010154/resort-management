"use client";

import Link from "next/link";

import { useRovingFocusItem } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import type { NavItem as NavItemData } from "./nav-inventory";

/* One entry in the rail.
 *
 * A real `<a>` rather than a button that pushes a route, because navigation
 * that cannot be middle-clicked, opened in a second tab or read by a screen
 * reader as a link is navigation in name only — and because `next/link`
 * prefetches on hover and focus, which is what makes the rail feel instant on
 * the day the screens exist.
 *
 * The entry carries its own key hint. The hint is derived from the same written
 * chord the sequence binds (`navShortcut`) and formatted by the same function
 * the palette uses, so the three can only ever say the same thing.
 */

export interface NavItemProps {
  item: NavItemData;
  /** Whether the operator is on this family. Decided by `isActivePath`, from
   *  the pathname, so one rule answers it for the rail and for anything else
   *  that asks. */
  active: boolean;
  /** The key hint as the operator's keyboard prints it — "G D". */
  hint: string;
}

export function NavItem({ item, active, hint }: NavItemProps) {
  // The rail is one Tab stop and the arrows move within it. Forty entries with
  // forty stops is what `roving-focus.tsx` exists to prevent, and a rail is the
  // shortest list in the console that still has to answer for it: Tab from the
  // rail should reach the screen, not the fifteenth family.
  const roving = useRovingFocusItem(item.id);

  return (
    <Link
      href={item.href}
      // `aria-current="page"` rather than a class alone. The mark is a colour
      // and a rule, and neither is announced; an operator on a screen reader
      // otherwise has no way to hear where they are.
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
        // The active mark is the sand fill plus the umber text — the same
        // secondary pairing every selected surface in the console uses. Not the
        // accent: design-foundations reserves --dusk-amber for fills and state
        // marks and forbids it under text, and the rail's label is text.
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      {...roving}
    >
      <span>{item.label}</span>
      {/* Always shown, not revealed on hover. The hint is how the shortcut is
       * learned, and a console whose keyboard map is only visible to a mouse is
       * the failure this whole layer was built to avoid. */}
      <kbd className="text-xs text-muted-foreground tracking-caps">{hint}</kbd>
    </Link>
  );
}
