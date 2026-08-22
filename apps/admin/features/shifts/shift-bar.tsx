"use client";

import { formatVnd } from "@mariva/shared";

import { Button } from "@/components/ui/button";
import { useStaffSession } from "@/lib/auth";

import { expectedInDrawer, mayWorkADrawer, type Shift } from "./shift-day";
import { useCurrentShift } from "./shift-queries";
import { useShiftSurface } from "./shift-surface";

/* Whether this operator is on a drawer, on every screen they are on.
 *
 * `screens.md` §"Staff surfaces": "The current shift lives in the shell's top
 * bar." It is there because of what it couples to — "every cash payment belongs
 * to an open shift, or drawer variance means nothing" — and a receptionist who
 * cannot tell at a glance that they are on no drawer will find out when a guest
 * is holding out money for a bill.
 *
 * ## Why it is not a screen and not a rail entry
 *
 * The rail is the console's map and every entry on it is a place. This is a
 * state, and the state changes twice a day: putting it in the rail would give a
 * fact a door, and putting it on a screen would make an operator visit one to
 * learn something they need to know while working somewhere else.
 *
 * ## Four states, and none of them is a red toast
 *
 * On a drawer, on none, unable to tell, and not yet asked. "On none" is the
 * ordinary state of a receptionist who has just signed in and is not a failure —
 * `contract/operations.ts` says so in as many words, which is why the route
 * answers null rather than refusing. "Unable to tell" is drawn here rather than
 * being reported centrally, because this read sits above every screen at once:
 * a toast for it would be the same red sentence over whatever the operator was
 * doing, once per screen change.
 *
 * The acts themselves belong to the palette and the panel it opens. What the bar
 * offers is the shortest way into the one act its own state implies — opening a
 * drawer when there is none, counting one when there is — because an operator
 * reading "no drawer open" at the moment they need one should not have to know
 * which command it is filed under.
 */

export function ShiftBar() {
  const session = useStaffSession();

  const offered =
    session.status === "authenticated" && mayWorkADrawer(session.user.role);

  // Called unconditionally and held on nothing for the roles the drawer row is
  // not granted to — a housekeeper's console would otherwise spend a request on
  // a 403 on every screen they open.
  const drawer = useCurrentShift(offered);
  const surface = useShiftSurface();

  if (!offered) {
    // The accountant's grant on this row is a read of the *history*, which is a
    // screen and is where they are offered it; the housekeeper holds neither
    // row. Neither of them works a till, so neither is told about one — and the
    // strip goes with the fact rather than standing empty above their screens.
    // That is why the strip is drawn here rather than by the layout: a wrapper
    // up there would rule a border across the top of a console holding nothing.
    return null;
  }

  return (
    <div className="border-border flex h-10 shrink-0 items-center justify-end gap-3 border-b px-rhythm-2 text-sm">
      {drawer.isPending ? (
        <span className="text-muted-foreground text-xs" aria-busy>
          Reading the drawer
        </span>
      ) : drawer.isError ? (
        <span className="border-destructive text-destructive border-l-2 pl-2 text-xs">
          The drawer could not be read
        </span>
      ) : drawer.data ? (
        <OpenDrawer
          shift={drawer.data}
          onCount={() => {
            surface.open("count");
          }}
          onClose={() => {
            surface.open("close");
          }}
        />
      ) : (
        <>
          <span className="text-muted-foreground text-xs tracking-caps uppercase">
            No drawer open
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              surface.open("open");
            }}
          >
            Open one
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The drawer that is open, and what it should be holding.
 *
 * The expected figure rather than the float or the takings alone, because it is
 * the only one that answers the question somebody glancing up asks: if I counted
 * this now, what should be in it. Its three terms are on the shift and the panel
 * prints them separately for anybody who wants them — including what the
 * property itself spent from this till, which the desk may not record and has to
 * be able to see.
 */
function OpenDrawer({
  shift,
  onCount,
  onClose,
}: {
  shift: Shift;
  onCount(): void;
  onClose(): void;
}) {
  return (
    <>
      <span className="text-muted-foreground text-xs tracking-caps uppercase">
        Drawer open
      </span>
      <span className="font-mono text-xs">
        {formatVnd(expectedInDrawer(shift))}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={onCount}>
        Count
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={onClose}>
        Close
      </Button>
    </>
  );
}
