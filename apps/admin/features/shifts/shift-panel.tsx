"use client";

import { formatVnd } from "@mariva/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatInstant } from "@/features/guests/guest-record";
import { formatLongDate } from "@/lib/business-date";

import {
  CloseDrawerForm,
  ClosedDrawer,
  DrawerFigures,
  OpenDrawerForm,
  PendingItems,
  Problem,
} from "./drawer-forms";
import { expectedInDrawer, type Shift } from "./shift-day";
import { useCurrentShift } from "./shift-queries";

/* The drawer, wherever the operator already is.
 *
 * `screens.md` §"Staff surfaces": shifts "never own a screen visit" — opening,
 * counting, closing and handing over "are command-palette actions available from
 * any screen". A panel over the work is what that sentence describes: the
 * arrivals queue, the rate grid or the folio behind it is still there when the
 * drawer is dealt with, and the operator returns to the row they were on rather
 * than to a screen they navigated away from.
 *
 * ## Four intents, one surface
 *
 * They are four acts and not four screens, and each is the one the palette row
 * named — but a drawer that turns out not to be open makes two of them
 * unanswerable, so each intent that needs a drawer offers opening one in place
 * rather than telling the operator to press ⌘K again. The same courtesy the
 * checkout sequence pays a refused cash payment, and for the same reason: the
 * remedy belongs where the refusal was met.
 *
 * ## The count is re-asked as the panel opens
 *
 * What the till should hold is the opening float plus every đồng of cash bound
 * to the shift, and cash lands on it from a checkout on a screen this panel is
 * merely opening over. The cache's thirty seconds are the right trade for a bar
 * somebody glances at and the wrong one for a figure somebody is about to count
 * against, so counting and closing ask the API again on the way in.
 */

/** Which act the palette asked for. */
export type DrawerIntent = "open" | "count" | "close" | "handover";

const INTENT_TITLES: Record<DrawerIntent, string> = {
  open: "Open a cash drawer",
  count: "Count the drawer",
  close: "Close the drawer",
  handover: "Handover",
};

const INTENT_DESCRIPTIONS: Record<DrawerIntent, string> = {
  open: "Every cash payment belongs to an open drawer. Count the till in, and the day's takings are held against this figure when it is counted out.",
  close:
    "The count is the one figure only somebody standing at the drawer can supply. What it came to against what was expected is the property's answer, and it comes back on the press.",
  count:
    "What this drawer should be holding, so it can be counted without closing it. Nothing here is recorded — a count is written when the drawer is closed.",
  handover:
    "What this shift could not finish, and what earlier ones left. An item outlives the drawer that found it: it stays on this list until some shift clears it.",
};

export function ShiftPanel({
  intent,
  onIntent,
  onDismiss,
}: {
  intent: DrawerIntent;
  /** Move to another act without leaving the panel — counting leads into
   *  closing, and every intent that needs a drawer leads into opening one. */
  onIntent(next: DrawerIntent): void;
  onDismiss(): void;
}) {
  const drawer = useCurrentShift(true);
  const [closed, setClosed] = useState<Shift | null>(null);
  const { refetch } = drawer;

  useEffect(() => {
    if (intent === "count" || intent === "close") {
      void refetch();
    }
  }, [intent, refetch]);

  return (
    <Dialog
      open
      onOpenChange={(showing) => {
        if (!showing) {
          onDismiss();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {INTENT_TITLES[intent]}
          </DialogTitle>
          <DialogDescription>{INTENT_DESCRIPTIONS[intent]}</DialogDescription>
        </DialogHeader>

        {drawer.isPending ? (
          <p className="text-muted-foreground text-sm" aria-busy>
            Reading the drawer.
          </p>
        ) : drawer.isError ? (
          <Problem said="The drawer could not be read, so nothing here would be a statement about it. Nothing has changed at the desk." />
        ) : closed !== null ? (
          <CountedOut shift={closed} onDismiss={onDismiss} />
        ) : (
          <Act
            intent={intent}
            shift={drawer.data ?? null}
            onIntent={onIntent}
            onClosed={setClosed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Whichever of the four acts the palette asked for, against the drawer as the
 *  API has just answered it. */
function Act({
  intent,
  shift,
  onIntent,
  onClosed,
}: {
  intent: DrawerIntent;
  shift: Shift | null;
  onIntent(next: DrawerIntent): void;
  onClosed(closed: Shift): void;
}) {
  if (intent === "handover") {
    return <PendingItems onDrawer={shift !== null} offered />;
  }

  if (shift === null) {
    // Opening is the answer to all three of the remaining intents when there is
    // no drawer: counting and closing one that does not exist is not a refusal
    // to explain but an act to offer. The words on the press say which act the
    // operator asked for, so nobody is surprised by what the press did.
    return (
      <div>
        {intent === "open" ? null : (
          <p className="text-muted-foreground mb-rhythm-1 text-sm">
            There is no drawer open in your name, so there is nothing to{" "}
            {intent === "count" ? "count" : "close"} yet.
          </p>
        )}
        <OpenDrawerForm
          confirm="Open the drawer"
          onOpened={() => {
            // Straight into the handover: the first thing a shift taking the desk
            // over needs is what the last one left, and a panel that closed on
            // the open would make that a second deliberate act nobody performs.
            onIntent("handover");
          }}
        />
      </div>
    );
  }

  if (intent === "open") {
    return (
      <div>
        <p className="text-muted-foreground text-sm">
          You already have a drawer open — one operator, one drawer, which is
          what makes a variance attributable. It was opened{" "}
          {formatInstant(shift.openedAt)} on the trading day{" "}
          {formatLongDate(shift.openingBusinessDate)}.
        </p>
        <div className="mt-rhythm-1">
          <DrawerFigures shift={shift} />
        </div>
        <div className="mt-rhythm-1 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onIntent("count");
            }}
          >
            Count it
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onIntent("close");
            }}
          >
            Close it
          </Button>
        </div>
      </div>
    );
  }

  if (intent === "count") {
    return (
      <div>
        <DrawerFigures shift={shift} />
        <p className="text-muted-foreground mt-rhythm-1 text-sm">
          Opened {formatInstant(shift.openedAt)}, on the trading day{" "}
          {formatLongDate(shift.openingBusinessDate)}. Count the till against{" "}
          {formatVnd(expectedInDrawer(shift))} — if it does not agree, the
          difference is worth finding now rather than at the handover.
        </p>
        <div className="mt-rhythm-1">
          <Button
            type="button"
            onClick={() => {
              onIntent("close");
            }}
          >
            Close the drawer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-rhythm-2">
      <CloseDrawerForm shift={shift} onClosed={onClosed} />
      <PendingItems onDrawer offered />
    </div>
  );
}

/** The drawer as it was counted out, which is the answer the close came back
 *  with rather than a figure this panel worked out. */
function CountedOut({ shift, onDismiss }: { shift: Shift; onDismiss(): void }) {
  return (
    <div>
      <ClosedDrawer shift={shift} />
      <p className="text-muted-foreground mt-rhythm-1 text-sm">
        The drawer is closed and the shift has joined the history, where a
        manager reads it. Anything still outstanding stays on the backlog for
        whoever takes the desk next.
      </p>
      <div className="mt-rhythm-1">
        <Button type="button" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}
