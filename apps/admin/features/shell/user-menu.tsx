"use client";

import type { StaffSessionUser } from "@mariva/shared";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEndSession } from "@/lib/auth";

/* Who is signed in, at the foot of the rail.
 *
 * It answers one question and offers one act. The question is whose shift this
 * is — a shared desk terminal is the normal case at a property this size, and
 * an operator who cannot tell at a glance that the last person never signed out
 * will post a cash payment against somebody else's drawer. The act is signing
 * out, which is the same act the palette offers under `session.sign-out` and
 * runs through the same hook, because two spellings of ending a session is one
 * too many.
 *
 * The role is shown beside the name rather than being left implicit. What the
 * rail offers is decided by it, and a receptionist wondering where Payments
 * went should be able to see the reason without asking anyone.
 */

/** How each role is written for an operator. The wire spelling is a Postgres
 *  enum; nobody's job title is `HOUSEKEEPING`. */
const ROLE_LABELS: Record<StaffSessionUser["role"], string> = {
  RECEPTIONIST: "Reception",
  HOUSEKEEPING: "Housekeeping",
  ACCOUNTANT: "Accounting",
  MANAGER: "Manager",
  ADMIN: "Administrator",
};

export function UserMenu({ user }: { user: StaffSessionUser }) {
  const endSession = useEndSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
        {/* A line of its own, and it truncates rather than reflowing: full
         * Vietnamese names run long, and one that wrapped would push the role
         * under it off the bottom of the rail. */}
        <span className="w-full truncate">{user.fullName}</span>
        <span className="text-muted-foreground text-xs tracking-caps uppercase">
          {ROLE_LABELS[user.role]}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* The address, and it is here rather than on the trigger because it is
         * how two accounts with one person's name are told apart — a check
         * worth one click and not worth a line of rail on every screen. */}
        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={endSession}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
