"use client";

import {
  BadgeDollarSignIcon,
  BedDoubleIcon,
  CalendarDaysIcon,
  ChartNoAxesCombinedIcon,
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
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useStaffSession } from "@/lib/auth";
import { RovingFocusGroup } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { isActivePath, NAV_GROUPS, navItemsFor } from "./nav-inventory";
import { NavItem } from "./nav-item";

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

interface ConsoleBrandProps {
  compact?: boolean;
  className?: string;
  onNavigate?(): void;
}

/** The brand lockup shared by the permanent sidebar and the mobile topbar. */
export function ConsoleBrand({
  compact = false,
  className,
  onNavigate,
}: ConsoleBrandProps) {
  return (
    <Link
      href="/dashboard"
      aria-label="Mariva console — dashboard"
      className={cn(
        "group/brand flex min-w-0 items-center text-foreground transition-opacity duration-200 ease-ui hover:opacity-70 active:opacity-55",
        className,
      )}
      onClick={onNavigate}
    >
      {compact ? (
        <img
          src="/brand/mariva-monogram.svg"
          alt=""
          width={34}
          height={26}
          className="h-[26px] w-[34px] shrink-0"
        />
      ) : (
        <img
          src="/brand/mariva-wordmark.svg"
          alt=""
          width={128}
          height={22}
          className="h-[22px] w-32"
        />
      )}
    </Link>
  );
}

interface NavigationProps {
  idPrefix: string;
  onNavigate?(): void;
}

function Navigation({ idPrefix, onNavigate }: NavigationProps) {
  const session = useStaffSession();
  const pathname = usePathname();

  if (session.status !== "authenticated") {
    return null;
  }

  const items = navItemsFor(session.user.role);
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  return (
    <RovingFocusGroup className="flex flex-col gap-5" role="menu">
      {groups.map((group) => (
        <section
          key={group.id}
          aria-labelledby={`${idPrefix}-nav-group-${group.id}`}
        >
          <h2
            id={`${idPrefix}-nav-group-${group.id}`}
            className="mb-1 px-3 text-xs font-semibold tracking-caps text-nav-muted uppercase"
          >
            {group.label}
          </h2>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                icon={NAV_ICONS[item.id] ?? DoorOpenIcon}
                active={isActivePath(pathname, item.href)}
                onSelect={onNavigate}
              />
            ))}
          </div>
        </section>
      ))}
    </RovingFocusGroup>
  );
}

/** Permanent navigation for desktop workstations. */
export function AppNav() {
  const session = useStaffSession();

  if (session.status !== "authenticated") {
    return null;
  }

  return (
    <nav
      aria-label="Console sections"
      className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col overflow-hidden border-border border-r bg-nav text-nav-text lg:flex"
    >
      <div className="flex min-h-[72px] items-center border-border border-b px-5">
        <ConsoleBrand />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 [scrollbar-gutter:stable]">
        <Navigation idPrefix="desktop" />
      </div>

      <div className="border-border border-t px-5 py-4">
        <p className="text-xs font-medium text-nav-muted">Mariva, Vietnam</p>
        <p className="mt-0.5 text-sm font-semibold text-nav-text">
          Front desk workspace
        </p>
      </div>
    </nav>
  );
}

/** Navigation content placed inside the small-screen sheet. */
export function MobileNav({ onNavigate }: { onNavigate(): void }) {
  return (
    <nav
      aria-label="Console sections"
      className="flex min-h-0 flex-1 flex-col bg-nav text-nav-text"
    >
      <div className="flex min-h-[72px] items-center border-border border-b px-5 pr-16">
        <ConsoleBrand onNavigate={onNavigate} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <Navigation idPrefix="mobile" onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
