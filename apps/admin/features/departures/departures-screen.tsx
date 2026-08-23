"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable,
} from "@tanstack/react-table";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DataTableFrame, EmptyState, PageHeader } from "@/components/console";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLongDate, formatShortDate } from "@/lib/business-date";
import { RovingFocusGroup, useRovingFocusItem } from "@/lib/keyboard";

import { CheckoutSequence } from "./checkout-sequence";
import { type Departure, departureAfter } from "./departure-queue";
import { useDepartureQueue } from "./departures-queries";

/* Today's departures, as a queue somebody works rather than a report they read.
 *
 * `docs/screens.md` §"Staff surfaces" states it as a mirror: departures mirrors
 * arrivals, picking a row opens the checkout sequence in place and returns to
 * the list for the next stay, because "the receptionist never leaves the screen
 * during the morning rush".
 *
 * ## The keyboard is the same keyboard
 *
 * Deliberately identical to the arrivals queue, because the desk works both in
 * one shift and a second set of habits for the second half of the day is a
 * screen fighting its operator:
 *
 * - The queue is **one Tab stop**, not one per row — a {@link RovingFocusGroup}
 *   with the arrows moving within it.
 * - **Enter on a row opens its sequence**, and the sequence is rendered in the
 *   row beneath, so Tab from the row falls into the first control of the step.
 * - **Focus comes back on its own.** When a guest is checked out the row leaves
 *   the queue, and focus is put on the departure after it — computed before the
 *   refetch, because the list the row is being left in is the only one that
 *   still contains it.
 *
 * The pointer works everywhere here and is required nowhere. Arrivals states a
 * hard no-pointer rule for itself; this screen keeps the same reachability
 * without claiming the same measurement.
 *
 * `g e` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * as `{ id: "departures", key: "e" }` and `nav-shortcuts.tsx` binds the whole
 * inventory's sequence from the shell, so a binding on this screen would be a
 * second `g e` fighting the first.
 *
 * ## The day is the API's
 *
 * The business date comes back on the housekeeping board, resolved against
 * `system_config.business_date_rollover_hour`. The queue is cut against that
 * string and never against the browser's clock: a receptionist working at 01:30
 * is still on yesterday's business date, and a console that decided otherwise
 * would show them a queue the property is not working.
 *
 * **No money in the queue.** What each stay owes is a folio read apiece, and
 * forty of those to draw a table is the whole ledger fetched for a column. The
 * balance is the first thing the sequence shows, which is where the operator
 * needs it and where one request answers it.
 *
 * **No animation.** `NFR-04` forbids entrance animation on operational
 * surfaces, and a row that expands with a transition is a row an operator is
 * waiting on mid-conversation.
 */

/** One identity for "no rows", so the table is not handed a new empty array on
 *  every render while the queue is still loading. */
const NO_DEPARTURES: Departure[] = [];

export function DeparturesScreen() {
  const { businessDate, queue } = useDepartureQueue();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row focus is owed to once the queue has been redrawn. Held in state
  // rather than focused inline, because the row it names is only reachable
  // after React has committed the list the checkout changed.
  const [focusId, setFocusId] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  const departures =
    queue.status === "ready" ? queue.departures : NO_DEPARTURES;

  useEffect(() => {
    if (focusId === null) {
      return;
    }

    queueRef.current
      ?.querySelector<HTMLElement>(
        `tr[data-roving-value="${CSS.escape(focusId)}"]`,
      )
      ?.focus();

    // Cleared whether or not the row was found. A queue that emptied has
    // nothing to focus, and leaving the request standing would re-run this on
    // every render for the rest of the session.
    setFocusId(null);
  }, [focusId]);

  const columns = useMemo(() => departureColumns(), []);

  const table = useReactTable({
    data: departures,
    columns,
    // The row's identity is the booking, not its position: the queue re-sorts
    // and re-filters under the operator, and the roving group tracks its active
    // member by value for the same reason.
    getRowId: (departure) => departure.id,
    getCoreRowModel: getCoreRowModel(),
  });

  function checkedOut(bookingId: string) {
    setOpenId(null);
    setFocusId(departureAfter(departures, bookingId));
  }

  function abandon(bookingId: string) {
    setOpenId(null);
    // Back to the row it was opened from, and not to the next one: the stay is
    // still in the building, so it is still the one being worked.
    setFocusId(bookingId);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Departures"
        description={
          businessDate === null
            ? "Reading the hotel day."
            : `In-house stays due out on ${formatLongDate(businessDate)}.`
        }
      />

      {queue.status === "pending" ? (
        <div className="mt-6 space-y-2" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {queue.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Departures could not be loaded. No due-out details are shown.
        </p>
      ) : null}

      {queue.status === "ready" && departures.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No departures waiting"
          description="No in-house stay is due to check out today."
        />
      ) : null}

      {queue.status === "ready" && departures.length > 0 ? (
        // The wrapper carries the ref rather than the group: the group spreads
        // the props it does not name onto its own container, and a `ref` passed
        // through would replace the one its arrow handling reads the list from.
        <DataTableFrame ref={queueRef} className="mt-6 overflow-x-auto">
          <RovingFocusGroup
            // The table already says what it is, so the group claims nothing
            // over it — `roving-focus.tsx`'s own note about a queue of rows.
            role="presentation"
          >
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">
                Today's departures. Arrow keys move between stays, Enter opens
                the checkout.
              </caption>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr
                    key={group.id}
                    className="border-border border-b bg-surface-muted/70"
                  >
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <DepartureRow
                    key={row.id}
                    row={row}
                    columnCount={columns.length}
                    open={openId === row.id}
                    onOpen={() => {
                      setOpenId(row.id);
                    }}
                  >
                    <CheckoutSequence
                      departure={row.original}
                      onCancel={() => {
                        abandon(row.id);
                      }}
                      onCheckedOut={() => {
                        checkedOut(row.id);
                      }}
                    />
                  </DepartureRow>
                ))}
              </tbody>
            </table>

            {queue.truncated ? (
              <p className="border-border border-t px-4 py-3 text-sm text-muted-foreground">
                Showing the first fifty departures.
              </p>
            ) : null}
          </RovingFocusGroup>
        </DataTableFrame>
      ) : null}
    </div>
  );
}

/** One stay, and the checkout that opens underneath it. */
function DepartureRow({
  row,
  columnCount,
  open,
  onOpen,
  children,
}: {
  row: Row<Departure>;
  columnCount: number;
  open: boolean;
  onOpen(): void;
  children: React.ReactNode;
}) {
  const roving = useRovingFocusItem(row.original.id);

  return (
    <>
      <tr
        {...roving}
        aria-expanded={open}
        className="border-border border-b transition-colors duration-150 ease-ui hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60"
        onKeyDown={(event) => {
          // Only the row's own press. Once the sequence is open the operator is
          // typing inside it, and every Enter in there bubbles through here on
          // its way up.
          if (event.key !== "Enter" || event.target !== event.currentTarget) {
            return;
          }

          event.preventDefault();

          if (!open) {
            onOpen();
          }
        }}
        onClick={() => {
          if (!open) {
            onOpen();
          }
        }}
      >
        {row.getVisibleCells().map((cell) => (
          <td key={cell.id} className="px-4 py-3">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>

      {open ? (
        <tr>
          {/* The sequence spans the row it belongs to rather than sitting in
              one column, and it comes after that row in the document — which is
              what makes Tab from the row land in the first control of the
              step. */}
          <td colSpan={columnCount} className="border-border border-b p-0">
            {children}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * What the queue shows about a stay, and nothing beyond it.
 *
 * The room leads, because a departing guest identifies themselves by it — which
 * is the same reason the queue is ordered by it. What the stay comes to is
 * absent for the reason the module header gives: a balance per row is a folio
 * per row.
 */
function departureColumns(): ColumnDef<Departure>[] {
  return [
    {
      id: "room",
      header: "Room",
      accessorFn: (departure) => departure.roomNumber,
      cell: (context) =>
        context.getValue<string | null>() ?? (
          <span className="text-muted-foreground">None held</span>
        ),
    },
    {
      id: "reference",
      header: "Stay",
      accessorFn: (departure) => departure.reference,
      cell: (context) => (
        <span className="font-mono">{context.getValue<string>()}</span>
      ),
    },
    {
      id: "guest",
      header: "Guest",
      accessorFn: (departure) => departure.guestNames.join(", "),
      cell: (context) =>
        context.getValue<string>() === "" ? (
          <span className="text-muted-foreground">Nobody registered</span>
        ) : (
          context.getValue<string>()
        ),
    },
    {
      id: "roomType",
      header: "Sold as",
      accessorFn: (departure) => departure.roomType,
    },
    {
      id: "stay",
      header: "Nights",
      accessorFn: (departure) =>
        `${formatShortDate(departure.checkIn)} to ${formatShortDate(departure.checkOut)}`,
    },
  ];
}
