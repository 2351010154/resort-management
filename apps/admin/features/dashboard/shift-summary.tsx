"use client";

import { formatVnd } from "@mariva/shared";
import {
  BanknoteIcon,
  ClipboardListIcon,
  LockIcon,
  type LucideIcon,
  UnlockIcon,
} from "lucide-react";

import {
  expectedInDrawer,
  mayWorkADrawer,
  type PendingItem,
  type Shift,
  useCurrentShift,
  usePendingItems,
  useShiftSurface,
} from "@/features/shifts";
import { useStaffSession } from "@/lib/auth";
import { propertyMomentAt } from "@/lib/business-date";

/* The drawer the operator is on, and what the last shift left them.
 *
 * `docs/screens.md` is firm that shifts "never own a screen visit": the current
 * shift lives in the shell's top bar and the four acts are palette commands
 * reachable from anywhere. This panel adds no fifth place for any of that — it
 * opens the same surfaces through the same `useShiftSurface` the palette uses,
 * so there is one implementation of counting a drawer and this is a second door
 * onto it rather than a second copy of it.
 *
 * What it adds that the bar cannot is the backlog. The bar is a strip with room
 * for one figure; the handover is a list of sentences somebody wrote for
 * whoever came next, and a receptionist who has to press ⌘K and remember the
 * word "handover" to find out that room 12 has no aircon will find out from the
 * guest instead. The launchpad is the screen they land on, so it is where the
 * inheritance belongs.
 *
 * **Everything here is gated on the same predicate the bar and the commands
 * use.** A role that may not work a drawer is offered no drawer — not a
 * disabled one — and the request is never made, which is `useCurrentShift`'s
 * whole reason for taking `offered` rather than discovering it from a 403.
 */

/** How many outstanding items the panel lists before it defers to the surface. */
const BACKLOG_PREVIEW_LIMIT = 3;

export function ShiftSummary() {
  const session = useStaffSession();
  const surface = useShiftSurface();

  const offered =
    session.status === "authenticated" && mayWorkADrawer(session.user.role);

  const drawer = useCurrentShift(offered);
  const backlog = usePendingItems(offered);

  if (!offered) {
    return null;
  }

  const shift = drawer.data ?? null;

  return (
    <section
      aria-labelledby="shift-summary-heading"
      className="flex flex-col rounded-lg bg-card p-5 shadow-card"
    >
      <h2
        id="shift-summary-heading"
        className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
      >
        Your shift
      </h2>

      <DrawerReading
        pending={drawer.isPending}
        failed={drawer.isError}
        shift={shift}
      />

      {/* Four acts in the order they happen, which is also the order the
          palette lists them. Disabled rather than hidden when the drawer state
          rules one out: a control that disappears teaches nothing about why,
          and `shift-surface.tsx` makes the same argument for the same four. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ActTile
          label="Open drawer"
          icon={UnlockIcon}
          disabled={shift !== null}
          onPress={() => {
            surface.open("open");
          }}
        />
        <ActTile
          label="Count"
          icon={BanknoteIcon}
          disabled={shift === null}
          onPress={() => {
            surface.open("count");
          }}
        />
        <ActTile
          label="Close"
          icon={LockIcon}
          disabled={shift === null}
          onPress={() => {
            surface.open("close");
          }}
        />
        <ActTile
          label="Handover"
          icon={ClipboardListIcon}
          onPress={() => {
            surface.open("handover");
          }}
        />
      </div>

      <Backlog
        pending={backlog.isPending}
        failed={backlog.isError}
        items={backlog.data?.items ?? []}
        onOpen={() => {
          surface.open("handover");
        }}
      />
    </section>
  );
}

function DrawerReading({
  pending,
  failed,
  shift,
}: {
  pending: boolean;
  failed: boolean;
  shift: Shift | null;
}) {
  if (pending) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">Reading drawer.</p>
    );
  }

  // Drawn in words here rather than raised as a toast, which is the exchange
  // `useCurrentShift` documents: this read sits on every screen at once and a
  // central toast for it would be the same red sentence once per navigation.
  if (failed) {
    return (
      <p className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger">
        The drawer could not be read.
      </p>
    );
  }

  if (shift === null) {
    return (
      <>
        <p className="mt-3 text-xl font-semibold tracking-[-0.01em]">
          No drawer open
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Cash taken at the desk belongs to a shift. Open one before the first
          payment.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-xl font-semibold lining-nums tabular-nums tracking-[-0.01em]">
          {formatVnd(expectedInDrawer(shift))}
        </span>
        <span className="text-sm text-muted-foreground">expected</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Open since {propertyMomentAt(new Date(shift.openedAt)).clock} ·{" "}
        {shift.operatorName}
      </p>
    </>
  );
}

function ActTile({
  label,
  icon: Icon,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border border-border bg-background px-2 py-3 text-sm font-medium transition-colors duration-150 ease-ui hover:border-accent-line hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-45"
    >
      <Icon
        aria-hidden="true"
        className="size-5 text-accent-strong"
        strokeWidth={1.6}
      />
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

function Backlog({
  pending,
  failed,
  items,
  onOpen,
}: {
  pending: boolean;
  failed: boolean;
  items: readonly PendingItem[];
  onOpen(): void;
}) {
  return (
    <div className="mt-5 border-border border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Handover
        </h3>
        <button
          type="button"
          onClick={onOpen}
          className="text-sm font-semibold underline-offset-4 hover:underline"
        >
          {items.length > BACKLOG_PREVIEW_LIMIT
            ? `All ${items.length}`
            : "Raise an item"}
        </button>
      </div>

      {pending ? (
        <p className="mt-3 text-sm text-muted-foreground">Reading handover.</p>
      ) : null}

      {failed ? (
        <p className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger">
          The outstanding items could not be read.
        </p>
      ) : null}

      {!pending && !failed && items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing outstanding. The desk was handed over clean.
        </p>
      ) : null}

      {!pending && !failed && items.length > 0 ? (
        <ul className="mt-3 space-y-2.5">
          {items.slice(0, BACKLOG_PREVIEW_LIMIT).map((item) => (
            <li
              key={item.id}
              className="border-accent-mark border-l-2 pl-3 text-sm"
            >
              <p className="text-pretty">{item.description}</p>
              <p className="mt-0.5 text-sm text-muted-foreground lining-nums tabular-nums">
                {propertyMomentAt(new Date(item.createdAt)).clock}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
