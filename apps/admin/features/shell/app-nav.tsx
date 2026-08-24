"use client";

import {
  BadgeDollarSignIcon,
  BedDoubleIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  Clock3Icon,
  CreditCardIcon,
  DoorOpenIcon,
  HouseIcon,
  LandmarkIcon,
  LogInIcon,
  LogOutIcon,
  type LucideIcon,
  ScrollTextIcon,
  SettingsIcon,
  SparklesIcon,
  UsersRoundIcon,
  WalletCardsIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { formatShortcut } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";
import { detectPlatform, RovingFocusGroup } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import {
  isActivePath,
  NAV_GROUPS,
  type NavGroupId,
  navItemsFor,
  navShortcut,
} from "./nav-inventory";
import { NavItem } from "./nav-item";
import { UserMenu } from "./user-menu";

const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: HouseIcon,
  arrivals: LogInIcon,
  departures: LogOutIcon,
  bookings: CalendarDaysIcon,
  guests: UsersRoundIcon,
  rooms: BedDoubleIcon,
  housekeeping: SparklesIcon,
  rates: BadgeDollarSignIcon,
  folios: WalletCardsIcon,
  payments: CreditCardIcon,
  shifts: Clock3Icon,
  finance: LandmarkIcon,
  reports: ChartNoAxesCombinedIcon,
  audit: ScrollTextIcon,
  settings: SettingsIcon,
};

const OPEN_GROUPS: Record<NavGroupId, boolean> = {
  today: true,
  reservations: true,
  property: true,
  money: true,
  management: true,
};

export function AppNav() {
  const session = useStaffSession();
  const pathname = usePathname();
  const platform = useMemo(() => detectPlatform(), []);
  const [expanded, setExpanded] = useState(OPEN_GROUPS);

  if (session.status !== "authenticated") {
    return null;
  }

  const items = navItemsFor(session.user.role);
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="Console sections"
      // The right border is load-bearing now the rail is light: it and the
      // screens beside it are two steps of the same ivory, and without a rule
      // the two grounds meet at an edge the eye has to guess at.
      className="sticky top-0 flex h-svh w-[72px] shrink-0 flex-col overflow-x-hidden overflow-y-auto border-border border-r bg-nav px-2 py-3 text-nav-text xl:w-[248px] xl:px-3"
    >
      <RovingFocusGroup className="flex flex-col gap-2" role="menu">
        {groups.map((group) => {
          const activeGroup = group.items.some((item) =>
            isActivePath(pathname, item.href),
          );
          const isOpen = expanded[group.id] || activeGroup;

          return (
            <section key={group.id} aria-labelledby={`nav-group-${group.id}`}>
              <button
                id={`nav-group-${group.id}`}
                type="button"
                aria-expanded={isOpen}
                className="hidden h-8 w-full items-center justify-between rounded-md px-3 text-left text-xs font-semibold tracking-caps text-nav-muted uppercase transition-colors duration-150 ease-ui hover:bg-nav-raised hover:text-nav-text xl:flex"
                onClick={() => {
                  setExpanded((current) => ({
                    ...current,
                    [group.id]: !current[group.id],
                  }));
                }}
              >
                {group.label}
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 transition-transform duration-150 ease-ui",
                    isOpen ? "rotate-0" : "-rotate-90",
                  )}
                />
              </button>
              <div
                className={cn(
                  "mt-0.5 flex flex-col gap-0.5 xl:mt-0",
                  !isOpen && "xl:hidden",
                )}
              >
                {group.items.map((item) => (
                  <NavItem
                    key={item.id}
                    item={item}
                    icon={NAV_ICONS[item.id] ?? DoorOpenIcon}
                    active={isActivePath(pathname, item.href)}
                    hint={formatShortcut(navShortcut(item), platform)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </RovingFocusGroup>

      <div className="mt-auto border-nav-raised border-t pt-2">
        <UserMenu user={session.user} />
      </div>
    </nav>
  );
}
