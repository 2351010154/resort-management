"use client";

import type { StaffRole } from "@mariva/shared";
import { BedDoubleIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { EmptyState, PageHeader, StatusChip } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardRoom } from "@/features/housekeeping";
import { boardTile, CONDITION_LABELS } from "@/features/housekeeping";
import { useStaffSession } from "@/lib/auth";
import { formatLongDate, formatShortDate } from "@/lib/business-date";
import { RovingFocusGroup, useRovingFocusItem } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  type ClosureFields,
  closureAttempt,
  mayCloseRooms,
  mayMarkOutOfOrder,
  NO_CLOSURE_FIELDS,
  narrowRooms,
  outOfOrderAttempt,
  type RoomTypeGroup,
  roomStateLabel,
} from "./room-list";
import { useCloseRoom, useRoomList, useSetOutOfOrder } from "./rooms-queries";

/* The property's rooms, and the one place that answers "why is this room not
 * sellable?".
 *
 * `docs/screens.md` §"Staff surfaces" is explicit about the shape: Rooms keeps
 * its two kinds of "unavailable" on the room's detail, framed so they cannot be
 * confused — *mark out of order* is immediate and touches room state only, while
 * *schedule closure* is manager-only, takes a date range and previews its hit to
 * sellable inventory before confirming. Both acts live behind one door and the
 * controls behind it differ by role, which is what `nav-inventory.ts` already
 * says about this family.
 *
 * ## What this screen does not do
 *
 * It does not create, rename or delete a room or a room type. The contract has
 * no room and no room-type route at all — the list below is the housekeeping
 * board, which is the only read that answers every room of the property — so a
 * catalogue editor here would be a form with nowhere to send itself. The screen
 * says as much in a line rather than offering a control that cannot work.
 *
 * ## The keyboard
 *
 * Unlike the housekeeping grid, this screen is operated the way the rest of the
 * console is: the room list is **one Tab stop** with the arrows moving inside it
 * — a {@link RovingFocusGroup}, forty rooms, one stop — and Enter opens a room's
 * detail. The detail follows the list in the document, so Tab from a room falls
 * into its controls rather than into the next room.
 *
 * The list is searched by typing rather than by opening a filter: forty rooms is
 * a list an operator scrolls, and what they arrive with is a number read to them
 * over the telephone, a type they want a spare of, or a condition they are
 * chasing. {@link narrowRooms} decides what answers a query and is specified on
 * its own; the field only holds what was typed. A narrowed list does not close
 * the detail beside it — a reason half-typed for 402 must survive the operator
 * searching for 403 to check something.
 *
 * `g r` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * Role gating below is presentation and not a wall: the API's capability guard
 * is the wall, and what these predicates decide is whether an operator is
 * *offered* an act that would answer 403.
 */

/* One array rather than a fresh `[]` per render, so the memo below only
 * recomputes when the board or the query actually moved. */
const EMPTY_GROUPS: readonly RoomTypeGroup[] = [];

export function RoomsScreen() {
  const session = useStaffSession();
  const { businessDate, list } = useRoomList();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks — `features/shell/app-nav.tsx` makes the same argument.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;

  const groups = list.status === "ready" ? list.groups : EMPTY_GROUPS;

  // Memoized on the groups and the query for `rooms-queries.ts`'s reason: the
  // roving list is drawn from this, and a fresh array on every render is a list
  // rebuilt underneath the operator's arrow keys.
  const shown = useMemo(() => narrowRooms(groups, query), [groups, query]);

  // Looked up in the whole property rather than in what the search left, so
  // typing does not shut the detail an operator is working in.
  const room =
    groups
      .flatMap((group) => group.rooms)
      .find((one) => one.roomNumber === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Rooms"
        description="Room condition, occupancy, and inventory closures."
      />

      {list.status === "pending" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]" aria-busy>
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : null}

      {list.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Rooms could not be loaded. Inventory details are unavailable.
        </p>
      ) : null}

      {list.status === "ready" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="flex flex-col gap-4 p-4">
            <Field
              label="Find a room"
              value={query}
              hint="A number, a type, or a condition — 402, deluxe, out of order."
              onChange={setQuery}
            />

            {shown.length === 0 ? (
              <EmptyState
                title="No matching room"
                description="Clear the search to see every room."
                className="px-4 py-8 shadow-none"
              />
            ) : null}

            <RovingFocusGroup
              aria-label="Rooms"
              className="flex flex-col gap-4"
            >
              {shown.map((group) => (
                <section key={group.roomType}>
                  <h2 className="px-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {/* The code as the contract spells it. The console names room
                      types this way on every other screen — arrivals' "Sold as"
                      column, the new booking form's choices — and a second
                      spelling here would be a second opinion about the
                      catalogue. */}
                    {group.roomType}
                  </h2>
                  <ul className="mt-1 space-y-1">
                    {group.rooms.map((one) => (
                      <RoomRow
                        key={one.roomNumber}
                        room={one}
                        selected={one.roomNumber === selected}
                        onSelect={() => {
                          setSelected(one.roomNumber);
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </RovingFocusGroup>
          </Card>

          {room === null || role === null ? (
            <EmptyState
              title="Choose a room"
              description="Select a room to view its state and available actions."
            />
          ) : (
            /* Keyed by the room, so choosing another one resets the two forms
               below with it. A reason typed for 402 must not still be sitting in
               the field when the operator moves to 403. */
            <RoomDetail
              key={room.roomNumber}
              room={room}
              role={role}
              businessDate={businessDate}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One room in the list. */
function RoomRow({
  room,
  selected,
  onSelect,
}: {
  room: BoardRoom;
  selected: boolean;
  onSelect(): void;
}) {
  const roving = useRovingFocusItem(room.roomNumber);

  return (
    <li>
      <button
        {...roving}
        type="button"
        // The pressed room, for a screen reader as well as for the shading. The
        // detail beside the list is what this state selects, so it is "current"
        // rather than "checked".
        aria-current={selected}
        onClick={onSelect}
        className={cn(
          "flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm transition-colors duration-150 ease-ui hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60",
          selected ? "bg-accent-soft text-accent-strong" : null,
        )}
      >
        <span className="flex items-center gap-3">
          <span className="grid h-8 min-w-12 place-items-center rounded-md border border-border bg-card px-2 font-semibold tabular-nums shadow-xs">
            {room.roomNumber}
          </span>
          <span className="text-muted-foreground">{room.roomType}</span>
        </span>
        <StatusChip
          tone={
            room.status === "OUT_OF_ORDER"
              ? "danger"
              : room.isReady
                ? "success"
                : "warning"
          }
        >
          {roomStateLabel(room)}
        </StatusChip>
      </button>
    </li>
  );
}

/** A room, its state, and the two acts that make it unavailable. */
function RoomDetail({
  room,
  role,
  businessDate,
}: {
  room: BoardRoom;
  role: StaffRole;
  businessDate: string | null;
}) {
  const isShut = room.status === "OUT_OF_ORDER";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 border-border border-b p-5">
        <span className="grid size-12 place-items-center rounded-lg bg-accent-soft text-accent-strong">
          <BedDoubleIcon aria-hidden="true" className="size-5" />
        </span>
        <span>
          <span className="block text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Room
          </span>
          <h2 className="text-2xl font-semibold leading-8 tabular-nums">
            {room.roomNumber}
          </h2>
        </span>
      </div>

      <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Sold as" value={room.roomType} />
        <Fact label="Floor" value={String(room.floor)} />
        <Fact
          label="Condition"
          value={
            isShut
              ? CONDITION_LABELS.OUT_OF_ORDER
              : `${CONDITION_LABELS[room.status]}${room.isReady ? ", ready for a guest" : ""}`
          }
        />
        <Fact
          label="Assignment"
          value={room.isOccupied ? "Occupied" : "Vacant"}
        />
        {/* The board's own attribution, not a second rendering of it: the tile
            already answers who last set a room and when, in the property's zone,
            and a date sliced out of the timestamp here would disagree with the
            housekeeping grid for the hours either side of midnight. */}
        <Fact label="Last set" value={boardTile(room).touchedLabel} />
        {isShut ? (
          <Fact
            label="Out of order"
            value={room.note ?? "No reason recorded"}
          />
        ) : null}
      </dl>

      <p className="mx-5 border-border border-t pt-4 text-xs text-muted-foreground">
        Guest details stay with the booking. Room catalogue changes are not
        available here.
      </p>

      <div className="grid gap-4 p-5 xl:grid-cols-2">
        <OutOfOrderControl room={room} role={role} />
        <ClosureControl room={room} role={role} businessDate={businessDate} />
      </div>
    </Card>
  );
}

/**
 * *Mark out of order* — immediate, and room state only.
 *
 * The framing is the requirement: this control says nobody may enter the room,
 * and it moves no inventory counter, so the property still has the same number
 * of that type to sell on every date. The sentence beside it says so, because the
 * two acts on this screen are exactly the pair `screens.md` asks to be kept
 * apart.
 */
function OutOfOrderControl({
  room,
  role,
}: {
  room: BoardRoom;
  role: StaffRole;
}) {
  const outOfOrder = useSetOutOfOrder();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const isShut = room.status === "OUT_OF_ORDER";

  if (!mayMarkOutOfOrder(role)) {
    return null;
  }

  function act(shutting: boolean) {
    const attempt = outOfOrderAttempt(room.roomNumber, shutting, reason);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setReason("");
    // Fire and forget: the room has already repainted — `rooms-queries.ts`
    // writes the optimistic tile — and a failure is toasted centrally while the
    // cache is put back.
    outOfOrder.mutate(attempt.input);
  }

  return (
    <section className="rounded-lg bg-surface-muted p-4">
      <h3 className="font-semibold">Out of order</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Immediate room state. Sellable inventory does not change.
      </p>

      {isShut ? (
        <div className="mt-4">
          <Button
            type="button"
            disabled={outOfOrder.isPending}
            onClick={() => {
              act(false);
            }}
          >
            Return to service
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            The room returns as dirty for housekeeping release.
          </p>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            act(true);
          }}
        >
          <Field
            label="Reason"
            value={reason}
            hint="For example: shower mixer leaking."
            onChange={setReason}
          />
          {/* The doubled rule rather than a colour, because the console's
              destructive and primary umber are the same number. Shutting a room
              is the verb that variant is for. */}
          <Button
            type="submit"
            variant="destructive"
            disabled={outOfOrder.isPending}
          >
            Mark out of order
          </Button>
        </form>
      )}

      {problem === null ? null : (
        <p className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * *Schedule closure* — a manager's commercial act, previewed before it lands.
 *
 * The preview is the point of the control. Reducing what the property can sell
 * on a range of nights is not something to discover from a response, so the
 * nights are counted from the typed range as it is typed — `closureAttempt` owns
 * that arithmetic and shares it with the contract's own schema.
 */
function ClosureControl({
  room,
  role,
  businessDate,
}: {
  room: BoardRoom;
  role: StaffRole;
  businessDate: string | null;
}) {
  const closeRoom = useCloseRoom();
  const [fields, setFields] = useState<ClosureFields>(NO_CLOSURE_FIELDS);
  const [problem, setProblem] = useState<string | null>(null);

  if (!mayCloseRooms(role)) {
    return (
      <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted-foreground">
        Withdrawing a room from sale for a range of nights is a manager's act.
      </p>
    );
  }

  // Recomputed as the operator types, because the preview is the whole reason
  // this control is not a plain form. `null` only before the board has answered
  // the property's day, which is what every relative date is counted from.
  const attempt =
    businessDate === null
      ? null
      : closureAttempt(fields, room.roomNumber, businessDate);

  function change(part: Partial<ClosureFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    if (attempt === null) {
      setProblem("The property's day has not been read yet. Try again.");
      return;
    }

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    closeRoom.mutate(attempt.input, {
      onSuccess: () => {
        // Cleared on success only. A refused closure leaves the dates where the
        // manager typed them, which is where the correction is made.
        setFields(NO_CLOSURE_FIELDS);
      },
    });
  }

  return (
    <section className="rounded-lg bg-surface-muted p-4">
      <h3 className="font-semibold">Schedule closure</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Withdraws nights from sale without changing cleaning state.
      </p>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label="First night"
          value={fields.checkIn}
          hint="15/3, 2026-03-15, today, +2d"
          onChange={(checkIn) => {
            change({ checkIn });
          }}
        />
        <Field
          label="Back on sale"
          value={fields.checkOut}
          hint="The night the room sells again."
          onChange={(checkOut) => {
            change({ checkOut });
          }}
        />
        <Field
          label="Reason"
          value={fields.reason}
          onChange={(reason) => {
            change({ reason });
          }}
        />
        <Button type="submit" disabled={closeRoom.isPending}>
          Schedule closure
        </Button>
      </form>

      {attempt !== null && "input" in attempt ? (
        <p className="mt-rhythm-1 text-sm">
          Withdraws {attempt.nights} {attempt.nights === 1 ? "night" : "nights"}{" "}
          of {room.roomType} from sale, from{" "}
          {formatShortDate(attempt.input.checkIn)} up to{" "}
          {formatShortDate(attempt.input.checkOut)}, which stays on sale.
        </p>
      ) : null}

      {problem === null ? null : (
        <p className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger">
          {problem}
        </p>
      )}

      {closeRoom.data === undefined ? null : (
        <p className="text-muted-foreground mt-rhythm-1 text-sm">
          Closed {formatLongDate(closeRoom.data.checkIn)} to{" "}
          {formatLongDate(closeRoom.data.checkOut)}:{" "}
          {closeRoom.data.nightsWithdrawn} nights withdrawn from sale.
        </p>
      )}
    </section>
  );
}

/** One typed field, labelled. */
function Field({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange(value: string): void;
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
        className="mt-1"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p className="text-muted-foreground mt-1 max-w-64 text-xs">{hint}</p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
