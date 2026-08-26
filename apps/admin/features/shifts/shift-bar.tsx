"use client";

import { formatVnd } from "@mariva/shared";
import { MenuIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatShortcut, openCommandPalette } from "@/features/command-palette";
import { ConsoleBrand, MobileNav, UserMenu } from "@/features/shell";
import { useStaffSession } from "@/lib/auth";
import { detectPlatform } from "@/lib/keyboard";

import { expectedInDrawer, mayWorkADrawer, type Shift } from "./shift-day";
import { useCurrentShift } from "./shift-queries";
import { useShiftSurface } from "./shift-surface";

/**
 * The global console bar: navigation on small screens, the brand, command
 * search, drawer state, and the current operator. Screen-specific actions
 * remain in each screen header below it.
 *
 * The property day is not here. It was the left-hand block the menu trigger
 * and the brand now occupy, and the screens that decide anything by the
 * business date read it themselves rather than off a bar.
 */
export function ShiftBar() {
  const session = useStaffSession();
  const platform = useMemo(() => detectPlatform(), []);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const offered =
    session.status === "authenticated" && mayWorkADrawer(session.user.role);
  const drawer = useCurrentShift(offered);
  const surface = useShiftSurface();

  if (session.status !== "authenticated") {
    return null;
  }

  return (
    <div className="sticky top-0 z-30 grid min-h-[72px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-border border-b bg-card/95 px-3 shadow-xs backdrop-blur sm:px-5 lg:gap-5 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open console navigation"
              className="lg:hidden"
            >
              <MenuIcon aria-hidden="true" className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            aria-describedby="mobile-navigation-description"
            className="right-auto left-0 w-[min(320px,calc(100vw-32px))] bg-nav p-0 sm:w-[320px]"
          >
            <SheetTitle className="sr-only">Console navigation</SheetTitle>
            <SheetDescription
              id="mobile-navigation-description"
              className="sr-only"
            >
              Move between Mariva hotel operations screens.
            </SheetDescription>
            <MobileNav
              onNavigate={() => {
                setNavigationOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>

        <ConsoleBrand compact className="lg:hidden" />
      </div>

      <Button
        type="button"
        variant="outline"
        aria-label="Open command palette"
        onClick={openCommandPalette}
        className="mx-auto w-11 max-w-2xl justify-center bg-background px-0 text-muted-foreground shadow-none md:w-full md:justify-between md:px-3"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SearchIcon aria-hidden="true" className="size-4" />
          <span className="hidden truncate md:inline">
            Search screens and actions
          </span>
        </span>
        <Kbd className="hidden lg:inline-flex">
          {formatShortcut("mod+k", platform)}
        </Kbd>
      </Button>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden sm:block">
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
        </div>
        <span
          aria-hidden="true"
          className="hidden h-8 w-px bg-border md:block"
        />
        <UserMenu user={session.user} />
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
      <span className="hidden px-2 text-sm text-muted-foreground xl:inline">
        Reading drawer
      </span>
    );
  }

  if (failed) {
    return (
      <span className="hidden px-2 text-sm text-danger xl:inline">
        Drawer unavailable
      </span>
    );
  }

  if (shift) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onCount}>
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
        <span className="hidden lg:inline">Drawer</span>
        <span className="hidden font-semibold tabular-nums 2xl:inline">
          {formatVnd(expectedInDrawer(shift))}
        </span>
      </Button>
    );
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
      <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
      <span className="hidden lg:inline">Open drawer</span>
      <span className="lg:hidden">Drawer</span>
    </Button>
  );
}
