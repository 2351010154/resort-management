"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable,
} from "@tanstack/react-table";
import { PlusIcon, SearchIcon } from "lucide-react";
import type * as React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  FilterBar,
  KeyHint,
  PageHeader,
  StatusChip,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffSession } from "@/lib/auth";
import { formatLongDate, formatShortDate } from "@/lib/business-date";
import {
  captureFocus,
  type FocusRestorer,
  RovingFocusGroup,
  useHotkeys,
  useRovingFocusItem,
} from "@/lib/keyboard";

import {
  mayTakeBookings,
  NO_SEARCH_FIELDS,
  type SearchCriteria,
  type SearchFields,
  type Stay,
  searchCriteria,
} from "./booking-search";
import { useBookingList } from "./bookings-queries";
import { NewBookingForm } from "./new-booking-form";

/* Every stay the property has, found and taken.
 *
 * `docs/screens.md` §"Staff surfaces" states the whole of it: Bookings opens
 * anchored on today — arriving, in-house and departing stays — "with the full
 * search one keystroke away; the common case is a guest calling about a current
 * stay, and it should need zero typing".
 *
 * ## The two screen keys
 *
 * - **`/` puts the caret in the search**, which is the keystroke the sentence
 *   above is about.
 * - **`n` takes a new booking**, for the two callers the funnel cannot serve.
 *
 * Both are registered through `lib/keyboard`'s registry rather than as a second
 * `document` listener, so they stack correctly with the shell's own bindings and
 * with whatever a panel mounts on top. Neither fires while a person is typing:
 * `useHotkeys` gates on `isFormField` by default, which is what stops the `n` of
 * "Nguyễn" in the guest field from opening a form. Both are turned off outright
 * while the new-booking panel is open — a screen turns its bindings off rather
 * than branching inside every handler.
 *
 * `g b` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * as `{ id: "bookings", key: "b", roles: LEDGER }` and `nav-shortcuts.tsx` binds
 * the whole inventory's sequence from the shell, so a binding on this screen
 * would be a second `g b` fighting the first.
 *
 * ## The list is the same list the two queues are
 *
 * One Tab stop, arrows within it, the row's identity being the booking rather
 * than its position — deliberately identical to arrivals and departures, because
 * the desk works all three in one shift and a second set of habits for the third
 * is a screen fighting its operator. What differs is that a row here opens
 * nothing: this screen finds a stay, and acting on one is the queue that owns
 * that act. Checking in is `g a`, checking out is `g e`.
 *
 * ## The day is the API's
 *
 * The business date comes from `GET /system/business-date`, resolved against
 * `system_config.business_date_rollover_hour`. Today's window is built from that
 * string and every relative date an operator types — "today", "+2d" — is counted
 * from it. A receptionist working at 01:30 is still on yesterday's business date,
 * and a console that decided otherwise would anchor on a day the property is not
 * working.
 *
 * It is that route and not the housekeeping board, which is where the other
 * operational screens read the day. They need the board's rooms anyway; this
 * screen needs the date alone, and the board's row is denied to the accountant
 * this family is deliberately offered to. Both routes resolve the day through
 * one service on the server, so the four screens cannot disagree.
 *
 * **No animation.** `NFR-04` forbids entrance animation on operational
 * surfaces.
 */

/** One identity for "no rows", so the table is not handed a new empty array on
 *  every render while the list is still loading. */
const NO_STAYS: Stay[] = [];

export function BookingsScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<SearchFields>(NO_SEARCH_FIELDS);
  // `null` is the default window — today's stays, keyed to the board's date.
  // A search replaces it wholesale rather than narrowing it, because the
  // criteria the API takes are its own and not a filter over an answer.
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { businessDate, list, rooms } = useBookingList(criteria);
  const searchField = useRef<HTMLInputElement>(null);
  // Where focus was when the panel opened. A panel that closes without handing
  // focus back drops it on `<body>`, which is the most common way a
  // keyboard-first screen becomes unusable with nothing looking broken.
  const beforePanel = useRef<FocusRestorer | null>(null);

  const stays = list.status === "ready" ? list.stays : NO_STAYS;
  const mayCreate =
    session.status === "authenticated" && mayTakeBookings(session.user.role);

  useHotkeys(
    "/",
    () => {
      searchField.current?.focus();
      searchField.current?.select();
    },
    { enabled: !creating },
  );

  useHotkeys(
    "n",
    () => {
      openPanel();
    },
    // The accountant is offered no creating control at all, so the key that
    // opens one is not bound for them either — a shortcut that answered 403
    // would be the console teaching a refusal.
    { enabled: mayCreate && !creating },
  );

  const columns = useMemo(() => bookingColumns(), []);

  const table = useReactTable({
    data: stays,
    columns,
    // The row's identity is the booking, not its position: the list re-sorts
    // and re-filters under the operator, and the roving group tracks its active
    // member by value for the same reason.
    getRowId: (stay) => stay.id,
    getCoreRowModel: getCoreRowModel(),
  });

  function openPanel() {
    beforePanel.current = captureFocus();
    setCreating(true);
  }

  function closePanel() {
    setCreating(false);
  }

  // Focus is handed back in an effect rather than in the handler, because the
  // control it goes to is only reachable once React has committed the screen
  // without the panel on it.
  useEffect(() => {
    if (creating || beforePanel.current === null) {
      return;
    }

    if (!beforePanel.current.restore()) {
      // Whatever opened the panel is gone. The search field is where an
      // operator can act from, and it is never removed.
      searchField.current?.focus();
    }

    beforePanel.current = null;
  }, [creating]);

  function runSearch() {
    if (businessDate === null) {
      // Only reachable before the board has answered. Relative dates are
      // counted from the property's day, and guessing one in the browser is the
      // single thing this screen must not do.
      setProblem("The property's day has not been read yet. Try again.");
      return;
    }

    const attempt = searchCriteria(fields, businessDate);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setCriteria(attempt.criteria);
  }

  function backToToday() {
    setFields(NO_SEARCH_FIELDS);
    setProblem(null);
    setCriteria(null);
    searchField.current?.focus();
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bookings"
        description={
          criteria !== null
            ? "Stays matching this search."
            : businessDate === null
              ? "Reading the hotel day."
              : `Arriving, in-house, and departing stays for ${formatLongDate(businessDate)}.`
        }
        actions={
          mayCreate ? (
            <Button type="button" onClick={openPanel}>
              <PlusIcon aria-hidden="true" />
              New booking
              <KeyHint>N</KeyHint>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        className="mt-6"
        fieldsClassName="lg:grid-cols-5"
        actions={
          <>
            <Button type="submit">
              <SearchIcon aria-hidden="true" />
              Search
            </Button>
            {criteria === null ? null : (
              <Button type="button" variant="ghost" onClick={backToToday}>
                Today
              </Button>
            )}
          </>
        }
        result={
          <span>{list.status === "ready" ? `${stays.length} stays` : ""}</span>
        }
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <SearchField
          label="Reference"
          value={fields.reference}
          inputRef={searchField}
          placeholder="BK-1042"
          onChange={(reference) => {
            setFields((current) => ({ ...current, reference }));
          }}
        />
        <SearchField
          label="Guest name"
          value={fields.guestName}
          onChange={(guestName) => {
            setFields((current) => ({ ...current, guestName }));
          }}
        />
        <SearchField
          label="Telephone"
          value={fields.guestPhone}
          onChange={(guestPhone) => {
            setFields((current) => ({ ...current, guestPhone }));
          }}
        />
        <SearchField
          label="From"
          value={fields.from}
          placeholder="15/3"
          onChange={(from) => {
            setFields((current) => ({ ...current, from }));
          }}
        />
        <SearchField
          label="To"
          value={fields.to}
          placeholder="+2d"
          onChange={(to) => {
            setFields((current) => ({ ...current, to }));
          }}
        />
      </FilterBar>

      {problem === null ? null : (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        <KeyHint>/</KeyHint> searches
        {mayCreate
          ? " · New booking is also available with N."
          : " · Read-only access."}
      </p>

      {creating && businessDate !== null ? (
        <div className="mt-6 overflow-hidden rounded-lg bg-card shadow-raised">
          <NewBookingForm
            businessDate={businessDate}
            rooms={rooms}
            onCancel={closePanel}
            onDone={closePanel}
          />
        </div>
      ) : null}

      {list.status === "pending" ? (
        <div className="mt-6 space-y-2" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {list.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The bookings could not be read. Nothing here is a statement about
          which stays the property has.
        </p>
      ) : null}

      {list.status === "ready" && stays.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={criteria === null ? "No stays today" : "No matching stays"}
          description={
            criteria === null
              ? "No stay occupies the hotel today."
              : "Try a reference or a shorter date range. Guest details appear after registration."
          }
        />
      ) : null}

      {list.status === "ready" && stays.length > 0 ? (
        // The wrapper carries the ref rather than the group: the group spreads
        // the props it does not name onto its own container, and a `ref` passed
        // through would replace the one its arrow handling reads the list from.
        <DataTableFrame className="mt-6 overflow-x-auto">
          <RovingFocusGroup
            // The table already says what it is, so the group claims nothing
            // over it — `roving-focus.tsx`'s own note about a queue of rows.
            role="presentation"
          >
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <caption className="px-4 py-3 text-left text-xs text-muted-foreground">
                {/* Said rather than implied, because a row here opens nothing:
                    an operator who has arrowed onto a stay and pressed Enter is
                    owed the reason nothing happened, and the reason is that the
                    act belongs to the queue that owns it. */}
                Arrow keys move between stays. Checking a guest in is Arrivals
                (g a); checking one out is Departures (g e).
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
                  <BookingRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>

            {list.truncated ? (
              <p className="border-border border-t px-4 py-3 text-sm text-muted-foreground">
                Showing the first fifty stays. Narrow the dates to find more.
              </p>
            ) : null}
          </RovingFocusGroup>
        </DataTableFrame>
      ) : null}
    </div>
  );
}

/** One stay, as a row the arrows reach. */
function BookingRow({ row }: { row: Row<Stay> }) {
  const roving = useRovingFocusItem(row.original.id);

  return (
    <tr
      {...roving}
      className="border-border border-b transition-colors duration-150 ease-ui hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60"
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

/**
 * What the list shows about a stay, and nothing beyond it.
 *
 * No money and no identity number, for the reason the two queues give: what a
 * stay costs is the folio's and the CCCD is `guest.unmask-cccd`'s, and a list is
 * neither of those routes. The state is here where the queues have no such
 * column — this screen answers "what about this stay", and whether it is held,
 * confirmed, in house, gone or cancelled is most of that answer.
 */
function bookingColumns(): ColumnDef<Stay>[] {
  return [
    {
      id: "reference",
      header: "Stay",
      accessorFn: (stay) => stay.reference,
      cell: (context) => (
        <span className="font-mono">{context.getValue<string>()}</span>
      ),
    },
    {
      id: "guest",
      header: "Guest",
      // Empty until check-in writes the registration records, so a stay nobody
      // has arrived for is identified by its reference. It is also why a name
      // finds no booking before check-in — the search matches the registration.
      accessorFn: (stay) => stay.guestNames.join(", "),
      cell: (context) =>
        context.getValue<string>() === "" ? (
          <span className="text-muted-foreground">Not yet registered</span>
        ) : (
          context.getValue<string>()
        ),
    },
    {
      id: "state",
      header: "State",
      accessorFn: (stay) => stay.state,
      cell: (context) => {
        const state = context.getValue<string>();
        const tone =
          state === "CHECKED_IN"
            ? "success"
            : state === "CONFIRMED"
              ? "info"
              : state === "CANCELLED"
                ? "danger"
                : "neutral";

        return (
          <StatusChip tone={tone}>{state.replaceAll("_", " ")}</StatusChip>
        );
      },
    },
    {
      id: "roomType",
      header: "Sold as",
      accessorFn: (stay) => stay.roomType,
    },
    {
      id: "stay",
      header: "Nights",
      accessorFn: (stay) =>
        `${formatShortDate(stay.checkIn)} to ${formatShortDate(stay.checkOut)}`,
    },
    {
      id: "room",
      header: "Room",
      accessorFn: (stay) => stay.roomNumber,
      cell: (context) =>
        context.getValue<string | null>() ?? (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
  ];
}

function SearchField({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="block text-xs font-semibold text-muted-foreground"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        ref={inputRef}
        className="mt-1"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
