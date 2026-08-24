"use client";

import type { StaffSessionUser } from "@mariva/shared";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEndSession } from "@/lib/auth";

const ROLE_LABELS: Record<StaffSessionUser["role"], string> = {
  RECEPTIONIST: "Reception",
  HOUSEKEEPING: "Housekeeping",
  ACCOUNTANT: "Accounting",
  MANAGER: "Manager",
  ADMIN: "Administrator",
};

function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function UserMenu({ user }: { user: StaffSessionUser }) {
  const endSession = useEndSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-h-12 w-full items-center justify-center gap-3 rounded-md px-2 text-left text-sm text-nav-muted transition-colors duration-150 ease-ui hover:bg-nav-raised hover:text-nav-text xl:justify-start xl:px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-nav-raised text-sm font-semibold text-nav-text">
          {initials(user.fullName)}
        </span>
        <span className="hidden min-w-0 flex-1 xl:block">
          <span className="block truncate font-medium text-nav-text">
            {user.fullName}
          </span>
          <span className="block truncate text-sm text-nav-muted">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
        <ChevronsUpDownIcon
          aria-hidden="true"
          className="hidden size-4 shrink-0 xl:block"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        sideOffset={8}
        className="w-64"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block font-medium text-foreground">
            {user.fullName}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={endSession}>
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
