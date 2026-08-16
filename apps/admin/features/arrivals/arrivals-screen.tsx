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

import { formatLongDate, formatShortDate } from "@/lib/business-date";
import { RovingFocusGroup, useRovingFocusItem } from "@/lib/keyboard";

import { type Arrival, arrivalAfter } from "./arrival-queue";
import { useArrivalQueue } from "./arrivals-queries";
import { CheckInSequence } from "./check-in-sequence";

/* Today's arrivals, as a queue somebody works rather than a report they read.
 *
 * `docs/screens.md` §"Staff surfaces" states the whole of it: picking a row
 * opens the check-in sequence in place and returns to the list for the next
 * arrival, because check-in happens in bursts — the screen is optimised for ten
 * guests at two o'clock, not for one.
 *
 * ## Nothing here needs a pointer
 *
 * `NFR-11` is the requirement and the arrangement below is how it is met:
 *
 * - The queue is **one Tab stop**, not one per row. Forty arrivals with forty
 *   tab stops would put the control after the list forty presses away, which is
 *   keyboard-hostile rather than keyboard-first — so the rows are a
 *   {@link RovingFocusGroup} and the arrows move within it.
 * - **Enter on a row opens its sequence**, and the sequence is rendered in the
 *   row beneath, so Tab from the row falls into the first field rather than into
 *   the next arrival.
 * - **Focus comes back on its own.** When a guest is checked in the row leaves
 *   the queue, and focus is put on the arrival after it — computed before the
 *   refetch, because the list the row is being left in is the only one that
 *   still contains it.
 *
 * `g a` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell,
 * so a binding on this screen would be a second `g a` fighting the first.
 *
 * ## The day is the API's
 *
 * The business date comes back on the housekeeping board, resolved against
 * `system_config.business_date_rollover_hour`. The queue is cut against that
 * string and never against the browser's clock: a receptionist working at 01:30
 * is still on yesterday's business date, and a console that decided otherwise
 * would show them a queue the property is not working.
 *
 * **No animation.** `NFR-04` forbids entrance animation on operational
 * surfaces, and a row that expands with a transition is a row an operator is
 * waiting on mid-conversation.
 */

/** One identity for "no rows", so the table is not handed a new empty array on
 *  every render while the queue is still loading. */
const NO_ARRIVALS: Arrival[] = [];

export function ArrivalsScreen() {
  const { businessDate, queue, rooms } = useArrivalQueue();
  const [openId, setOpenId] = useState<string | null>(null);
  // The row focus is owed to once the queue has been redrawn. Held in state
  // rather than focused inline, because the row it names is only reachable
  // after React has committed the list the check-in changed.
  const [focusId, setFocusId] = useState<string | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  const arrivals = queue.status === "ready" ? queue.arrivals : NO_ARRIVALS;

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

  const columns = useMemo(() => arrivalColumns(), []);

  const table = useReactTable({
    data: arrivals,
    columns,
    // The row's identity is the booking, not its position: the queue re-sorts
    // and re-filters under the operator, and the roving group tracks its active
    // member by value for the same reason.
    getRowId: (arrival) => arrival.id,
    getCoreRowModel: getCoreRowModel(),
  });

  function checkedIn(bookingId: string) {
    setOpenId(null);
    setFocusId(arrivalAfter(arrivals, bookingId));
  }

  function abandon(bookingId: string) {
    setOpenId(null);
    // Back to the row it was opened from, and not to the next one: nothing
    // happened to this stay, so it is still the one being worked.
    setFocusId(bookingId);
  }

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Front desk
        </p>
        <h1 className="font-display text-display-sm mt-2">Arrivals</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          {businessDate === null
            ? "Reading the property's day."
            : `Confirmed stays due in on ${formatLongDate(businessDate)}.`}
        </p>
      </header>

      {queue.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading today's arrivals.
        </p>
      ) : null}

      {queue.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The arrivals queue could not be loaded. Nothing here is a statement
          about who is due in today.
        </p>
      ) : null}

      {queue.status === "ready" && arrivals.length === 0 ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm">
          Nobody is waiting to be checked in.
        </p>
      ) : null}

      {queue.status === "ready" && arrivals.length > 0 ? (
        // The wrapper carries the ref rather than the group: the group spreads
        // the props it does not name onto its own container, and a `ref` passed
        // through would replace the one its arrow handling reads the list from.
        <div ref={queueRef} className="mt-rhythm-2">
          <RovingFocusGroup
            // The table already says what it is, so the group claims nothing over
            // it — `roving-focus.tsx`'s own note about a queue of rows.
            role="presentation"
          >
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Today's arrivals. Arrow keys move between stays, Enter opens the
                check-in.
              </caption>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id} className="border-border border-b">
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="text-muted-foreground px-3 py-2 text-left text-xs font-normal tracking-caps uppercase"
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
                  <ArrivalRow
                    key={row.id}
                    row={row}
                    columnCount={columns.length}
                    open={openId === row.id}
                    onOpen={() => {
                      setOpenId(row.id);
                    }}
                  >
                    <CheckInSequence
                      arrival={row.original}
                      rooms={rooms}
                      onCancel={() => {
                        abandon(row.id);
                      }}
                      onCheckedIn={() => {
                        checkedIn(row.id);
                      }}
                    />
                  </ArrivalRow>
                ))}
              </tbody>
            </table>

            {queue.truncated ? (
              <p className="text-muted-foreground mt-rhythm-1 text-sm">
                The search answers at most fifty stays, so there may be arrivals
                this queue does not show.
              </p>
            ) : null}
          </RovingFocusGroup>
        </div>
      ) : null}
    </div>
  );
}

/** One stay, and the sequence that opens underneath it. */
function ArrivalRow({
  row,
  columnCount,
  open,
  onOpen,
  children,
}: {
  row: Row<Arrival>;
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
        className="border-border hover:bg-accent/40 focus-visible:bg-accent/40 border-b"
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
          <td key={cell.id} className="px-3 py-2">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>

      {open ? (
        <tr>
          {/* The sequence spans the row it belongs to rather than sitting in
              one column, and it comes after that row in the document — which is
              what makes Tab from the row land in the first field of the step. */}
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
 * No money and no identity number. A receptionist reading this list is deciding
 * which guest is in front of them — the reference they were given, the name on
 * the booking if anybody is registered, what they were sold, and whether a room
 * is already held. What a stay costs is the folio's and the CCCD is
 * `guest.unmask-cccd`'s, and a queue is neither of those routes.
 */
function arrivalColumns(): ColumnDef<Arrival>[] {
  return [
    {
      id: "reference",
      header: "Stay",
      accessorFn: (arrival) => arrival.reference,
      cell: (context) => (
        <span className="font-mono">{context.getValue<string>()}</span>
      ),
    },
    {
      id: "guest",
      header: "Guest",
      // Empty until check-in writes the registration records, which is every
      // row in this queue — so the booking's own reference is what identifies
      // the stay, and this column fills in as guests are admitted.
      accessorFn: (arrival) => arrival.guestNames.join(", "),
      cell: (context) =>
        context.getValue<string>() === "" ? (
          <span className="text-muted-foreground">Not yet registered</span>
        ) : (
          context.getValue<string>()
        ),
    },
    {
      id: "roomType",
      header: "Sold as",
      accessorFn: (arrival) => arrival.roomType,
    },
    {
      id: "stay",
      header: "Nights",
      accessorFn: (arrival) =>
        `${formatShortDate(arrival.checkIn)} – ${formatShortDate(arrival.checkOut)}`,
    },
    {
      id: "room",
      header: "Room",
      accessorFn: (arrival) => arrival.roomNumber,
      cell: (context) =>
        context.getValue<string | null>() ?? (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
  ];
}
