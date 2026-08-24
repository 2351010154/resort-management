"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { useCommands } from "@/features/command-palette";
import { useStaffSession } from "@/lib/auth";

import { mayWorkADrawer } from "./shift-day";
import { type DrawerIntent, ShiftPanel } from "./shift-panel";
import { useCurrentShift } from "./shift-queries";

/* Where the desk's drawer is reached from, on every screen at once.
 *
 * Three pieces and one piece of state between them, because `screens.md` puts
 * the two halves of this family in two different places in the shell: the
 * current shift "lives in the shell's top bar", and opening, counting, closing
 * and handing over "are command-palette actions available from any screen". The
 * bar is drawn where the layout draws it and the commands are registered after
 * the children, so a screen that ever needs to claim one of these ids still
 * wins — which is the rule `app/(app)/layout.tsx` states for the shell's own
 * commands. Two surfaces in two positions with one panel between them is what
 * the context is for, and it holds exactly one value: which act is open.
 *
 * The panel is rendered by the provider rather than by either caller. It portals
 * itself to the document body, so where it is written decides nothing visual —
 * what it decides is that the panel is not unmounted when the operator navigates
 * between screens, and that neither the bar nor the palette owns a surface the
 * other one opens.
 *
 * It is keyed on the act, so each intent opens a panel with nothing left in it
 * from the last one: a count that was abandoned, a note half typed, a drawer
 * already counted out. State that survived the act it belonged to is the kind of
 * thing that gets submitted by accident.
 */

interface ShiftSurface {
  /** Open the drawer panel on one of its four acts. */
  open(intent: DrawerIntent): void;
}

const ShiftSurfaceContext = createContext<ShiftSurface | null>(null);

export function ShiftSurfaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [intent, setIntent] = useState<DrawerIntent | null>(null);
  // One identity for the life of the provider. The consumers below are the bar
  // and the palette's registration, and a fresh object every render would
  // re-register four commands on every state change anywhere under this.
  const surface = useMemo<ShiftSurface>(() => ({ open: setIntent }), []);

  return (
    <ShiftSurfaceContext.Provider value={surface}>
      {children}

      {intent === null ? null : (
        <ShiftPanel
          key={intent}
          intent={intent}
          onIntent={setIntent}
          onDismiss={() => {
            setIntent(null);
          }}
        />
      )}
    </ShiftSurfaceContext.Provider>
  );
}

/**
 * The way to the drawer panel, for anything mounted under the provider.
 *
 * Throws rather than answering a no-op, for the reason the command registry's
 * own accessor does: a surface that silently did nothing would be a control that
 * looks live and is not, discovered by an operator rather than by a compiler.
 */
export function useShiftSurface(): ShiftSurface {
  const surface = useContext(ShiftSurfaceContext);

  if (surface === null) {
    throw new Error("useShiftSurface must be used inside ShiftSurfaceProvider");
  }

  return surface;
}

/**
 * The four acts, under ⌘K, from wherever the operator is standing.
 *
 * Offered to the three roles the matrix lets *work* a drawer rather than to the
 * four it lets read one: an accountant holds 👁 on the row, which the API
 * refuses on every write route in the family, so all four of these would answer
 * 403 for them. What their grant is for is the history, which is a screen and is
 * where they are offered it.
 *
 * Every row stays registered whether or not the state allows it, and the ones
 * the state forbids are `disabled`. A palette whose rows appear and disappear
 * with the desk's state cannot be learned by muscle memory — and "Close the
 * drawer", greyed, is a better answer to a receptionist who has not opened one
 * than no row at all, because it says the act exists and this is where it lives.
 *
 * Handing over is never disabled: the backlog is readable by anybody who holds
 * the row, and it is the one thing on this list that is not about a drawer being
 * open.
 */
export function ShiftCommands() {
  const session = useStaffSession();
  const surface = useShiftSurface();

  const offered =
    session.status === "authenticated" && mayWorkADrawer(session.user.role);

  const drawer = useCurrentShift(offered);
  // Undecided until the read answers. Treated as "no drawer" for what is
  // disabled, because the alternative is offering a count of something that may
  // not exist — and the panel re-reads on the way in either way, so a row
  // pressed a moment early opens on the truth rather than on this guess.
  const onDrawer = Boolean(drawer.data);

  useCommands(
    offered
      ? [
          {
            id: "shifts.open-drawer",
            label: "Open a cash drawer",
            group: "actions" as const,
            keywords: ["shift", "float", "till", "mở ca", "start shift"],
            disabled: onDrawer,
            action: () => {
              surface.open("open");
            },
          },
          {
            id: "shifts.count-drawer",
            label: "Count the drawer",
            group: "actions" as const,
            keywords: ["cash", "till", "đếm tiền", "count"],
            disabled: !onDrawer,
            action: () => {
              surface.open("count");
            },
          },
          {
            id: "shifts.close-drawer",
            label: "Close the drawer",
            group: "actions" as const,
            keywords: ["end shift", "variance", "đóng ca", "handover"],
            disabled: !onDrawer,
            action: () => {
              surface.open("close");
            },
          },
          {
            id: "shifts.hand-over",
            label: "Open handover",
            group: "actions" as const,
            keywords: ["pending", "backlog", "bàn giao", "notes"],
            action: () => {
              surface.open("handover");
            },
          },
        ]
      : [],
  );

  return null;
}
