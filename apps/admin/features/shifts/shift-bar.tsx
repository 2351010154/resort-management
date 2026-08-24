"use client";

import { formatVnd } from "@mariva/shared";
import { CalendarDaysIcon, SearchIcon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { formatShortcut, openCommandPalette } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";
import { formatLongDate } from "@/lib/business-date";
import { detectPlatform } from "@/lib/keyboard";

import { expectedInDrawer, mayWorkADrawer, type Shift } from "./shift-day";
import { useCurrentShift } from "./shift-queries";
import { useShiftSurface } from "./shift-surface";

export function ShiftBar() {
  const session = useStaffSession();
  const businessDate = useBusinessDate();
  const platform = useMemo(() => detectPlatform(), []);
  const offered =
    session.status === "authenticated" && mayWorkADrawer(session.user.role);
  const drawer = useCurrentShift(offered);
  const surface = useShiftSurface();

  return (
    <div className="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-3 border-border border-b bg-card/95 px-3 shadow-xs backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-strong">
          <CalendarDaysIcon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Hotel day
          </span>
          <span className="block truncate text-sm font-semibold">
            {businessDate.isPending
              ? "Reading date"
              : businessDate.data
                ? formatLongDate(businessDate.data.businessDate)
                : "Date unavailable"}
          </span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {offered ? (
          <DrawerStatus
            pending={drawer.isPending}
            failed={drawer.isError}
            shift={drawer.data ?? null}
            onOpen={() => {
              surface.open("open");
            }}
            onCount={() => {
              surface.open("count");
            }}
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Open command palette"
          onClick={openCommandPalette}
          className="bg-background"
        >
          <SearchIcon aria-hidden="true" />
          <span className="hidden sm:inline">Quick find</span>
          <Kbd className="hidden md:inline-flex">
            {formatShortcut("mod+k", platform)}
          </Kbd>
        </Button>
      </div>
    </div>
  );
}

function DrawerStatus({
  pending,
  failed,
  shift,
  onOpen,
  onCount,
}: {
  pending: boolean;
  failed: boolean;
  shift: Shift | null;
  onOpen(): void;
  onCount(): void;
}) {
  if (pending) {
    return (
      <span className="hidden text-sm text-muted-foreground lg:inline">
        Reading drawer
      </span>
    );
  }

  if (failed) {
    return (
      <span className="hidden text-sm text-danger lg:inline">
        Drawer unavailable
      </span>
    );
  }

  if (shift) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onCount}>
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
        <span className="hidden lg:inline">Drawer</span>
        <span className="hidden font-semibold tabular-nums md:inline">
          {formatVnd(expectedInDrawer(shift))}
        </span>
      </Button>
    );
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
      <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
      <span className="hidden sm:inline">Open drawer</span>
      <span className="sm:hidden">Drawer</span>
    </Button>
  );
}
