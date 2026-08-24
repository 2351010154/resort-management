"use client";

import type { StaffRole } from "@mariva/shared";
import { useId, useMemo, useState } from "react";

import {
  EmptyState,
  KeyHint,
  PageHeader,
  StatusChip,
  type StatusTone,
} from "@/components/console";
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
 * The rail scrolls inside itself rather than running the page down, and it stays
 * put while the detail beside it is worked. Forty rooms at a row apiece is twice
 * the height of the panel they open, so a rail that grew with its list would put
 * the closure form the operator is typing into off the top of the window by the
 * time they had reached the room at the bottom of it. The count under the list
 * is the other half of that: a list that ends mid-row is only obviously scrolled
 * if something says how many rooms there are.
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

  const roomCount = countRooms(groups);
  const shownCount = countRooms(shown);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Rooms"
        description="Room condition, occupancy, and inventory closures."
      />

      {list.status === "pending" ? (
        // In the two cards the screen itself arrives in, and in the same grid,
        // so nothing changes shape underneath the operator when the board
        // answers. Row-height blocks in the rail rather than one tall one: what
        // is coming is a list, and a single slab says a paragraph is.
        <div
          className="mt-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]"
          aria-busy
        >
          <Card className="flex flex-col gap-2 p-4">
            <Skeleton className="mb-2 h-11 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
          <Card className="flex flex-col gap-4 p-5">
            <Skeleton className="h-14 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </Card>
        </div>
      ) : null}

      {list.status === "failed" ? (
        // The console's error device is a rule on the leading edge as much as
        // the colour: --color-danger is a warm red-brown a shade off the umber
        // every other line on the screen is set in, and a sentence that
        // differed only in that would be read as ordinary copy.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Rooms could not be loaded. Inventory details are unavailable.
        </p>
      ) : null}

      {list.status === "ready" ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Bounded and sticky rather than as tall as the property. `self-start`
              is what lets it be either: a grid item stretches to the row by
              default, which is a rail as tall as the panel beside it and a
              `sticky` that can never move. `overflow-hidden` is the containment
              — a chip or a tinted row is drawn inside the rounded card or not at
              all. */}
          <Card className="flex max-h-[70svh] flex-col gap-3 overflow-hidden p-4 lg:sticky lg:top-6 lg:max-h-[calc(100svh_-_3rem)] lg:self-start">
            <Field
              label="Find a room"
              value={query}
              hint="Number, type, or condition."
              onChange={setQuery}
            />

            {shown.length === 0 ? (
              <EmptyState
                title="No matching room"
                description="Clear the search to see every room."
                className="px-4 py-8 shadow-none"
              />
            ) : (
              /* The list is the scrollport, and the negative margin with the
                 padding that cancels it is what keeps the focus ring inside it:
                 a scrollport clips whatever hangs over its edge, and the
                 console's outline is 3px drawn 2px outside the row. `min-h-0`
                 is what makes it scroll rather than grow — a flex item's
                 automatic minimum is its content, so without it the rail would
                 be forty rows tall and the max-height above would decide
                 nothing. */
              <RovingFocusGroup
                aria-label="Rooms"
                className="-mx-1.5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1.5"
              >
                {shown.map((group) => (
                  <section key={group.roomType}>
                    <h2 className="px-3 text-xs font-semibold tracking-caps text-muted-foreground uppercase">
                      {/* The code as the contract spells it. The console names
                        room types this way on every other screen — arrivals'
                        "Sold as" column, the new booking form's choices — and a
                        second spelling here would be a second opinion about the
                        catalogue.

                        It is also the only place the type is written: this
                        heading names every row under it, so a row repeating it
                        would be the same word twice on one line — and it was the
                        word that pushed the state chip out through the side of
                        the rail. */}
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
            )}

            {/* How much list there is, and what moves through it. A rail that
                ends mid-row has said "there is more below" only to somebody who
                already knew — the count says it in words, and the chips are the
                console's own way of naming a key. */}
            <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-border border-t pt-3 text-sm text-muted-foreground">
              <span>{roomCountLabel(shownCount, roomCount)}</span>
              <span className="inline-flex items-center gap-1.5">
                <KeyHint>↑</KeyHint>
                <KeyHint>↓</KeyHint>
                move
              </span>
            </p>
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

/** How many rooms a set of groups holds. */
function countRooms(groups: readonly RoomTypeGroup[]): number {
  return groups.reduce((total, group) => total + group.rooms.length, 0);
}

/** The list's own size, and how much of it the search left. */
function roomCountLabel(shown: number, total: number): string {
  const rooms = total === 1 ? "room" : "rooms";

  return shown === total
    ? `${total} ${rooms}`
    : `${shown} of ${total} ${rooms}`;
}

/**
 * The colour a room's state is drawn in.
 *
 * One place rather than two, because the row and the detail's header say the
 * same sentence about the same room and a chip that was amber in the list and
 * green beside it would be the screen disagreeing with itself. Out of order is
 * the only state the console draws in danger: it is the one an operator is being
 * told to stop at.
 */
function roomTone(room: BoardRoom): StatusTone {
  if (room.status === "OUT_OF_ORDER") {
    return "danger";
  }

  return room.isReady ? "success" : "warning";
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
        // Three states and not one value for all of them, the arrangement the
        // desk queues use: hover is the lightest because a pointer passing over
        // a room has decided nothing, while focus and the chosen room are the
        // full tint because those are where the operator actually is.
        //
        // Neither child may shrink and neither needs to: the number is fixed
        // and the chip is one of a handful of known sentences, so the row's
        // width is the rail's to hold rather than something to truncate.
        //
        // The chip follows the number rather than being pushed to the far edge.
        // Pushed, its left edge moved with the length of its own sentence — a
        // ragged column of states — and below the two-pane breakpoint, where the
        // rail is the width of the window, it ended up half a screen away from
        // the room it describes.
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm transition-colors duration-150 ease-ui hover:bg-accent-soft/50 focus-visible:bg-accent-soft",
          selected ? "bg-accent-soft text-accent-strong" : null,
        )}
      >
        <span className="grid h-8 min-w-12 shrink-0 place-items-center rounded-md border border-border bg-card px-2 font-semibold tabular-nums shadow-xs">
          {room.roomNumber}
        </span>
        <StatusChip className="shrink-0" tone={roomTone(room)}>
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
      {/* No glyph. A bed tile is the same picture on all forty rooms, so it
          names nothing the word beside it does not — and it pushed the number
          out of the column every label under it is set in. What earns the
          trailing edge instead is the state, in the chip the row was chosen
          from, so the list and the panel answer "what is this room doing?" in
          one sentence rather than two. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b p-5">
        <div>
          <span className="block text-xs font-semibold tracking-caps text-muted-foreground uppercase">
            Room
          </span>
          <h2 className="text-2xl font-semibold leading-8 tabular-nums">
            {room.roomNumber}
          </h2>
        </div>
        <StatusChip tone={roomTone(room)}>{roomStateLabel(room)}</StatusChip>
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

      {/* Its own band with a rule across the card, like the header's, rather
          than an inset hairline floating between two blocks of padding. */}
      <p className="border-border border-t px-5 py-4 text-sm text-muted-foreground">
        Guest details stay with the booking. Room catalogue changes are not
        available here.
      </p>

      {/* `items-start`, so each act is as tall as it is. Stretched to a shared
          row, the shorter of the two — one field and a press — carried a hand's
          width of empty tint under it, which reads as a control that failed to
          load rather than as one that is simply smaller. */}
      <div className="grid items-start gap-4 px-5 pb-5 xl:grid-cols-2">
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
  const busy = outOfOrder.isPending;

  if (!mayMarkOutOfOrder(role)) {
    return null;
  }

  function act(shutting: boolean) {
    // The press that arrives while the last one is still in flight. Dropped
    // here rather than by `disabled` on the button: a disabled control is
    // unfocusable, and the browser answers that by moving focus to <body> — so
    // an operator who pressed Enter on this button would be left nowhere, with
    // the refusal sentence beside a control they can no longer reach.
    if (outOfOrder.isPending) {
      return;
    }

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
            aria-disabled={busy}
            aria-busy={busy}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={() => {
              act(false);
            }}
          >
            Return to service
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            The room returns as dirty for housekeeping release.
          </p>
        </div>
      ) : (
        /* Stacked, and the press on its own line under the field it acts on.
           Beside the field it sat on the input's baseline with the label above
           it, which reads as a second control belonging to the same row. */
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            act(true);
          }}
        >
          <Field
            label="Reason"
            value={reason}
            placeholder="Shower mixer leaking"
            hint="Required — the desk is asked why the room is shut."
            onChange={setReason}
          />
          {/* The doubled rule rather than a colour, because the console's
              danger and primary are a warm brown and an umber a shade apart.
              Shutting a room is the verb that variant is for. */}
          <Button
            className="mt-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            type="submit"
            variant="destructive"
            aria-disabled={busy}
            aria-busy={busy}
          >
            Mark out of order
          </Button>
        </form>
      )}

      {problem === null ? null : (
        // Announced, not only drawn. A refusal an operator who had looked away
        // never hears is a press that did nothing and said nothing.
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
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
  const busy = closeRoom.isPending;

  if (!mayCloseRooms(role)) {
    // The act still named, in the shape the act itself would take. A bare
    // sentence where the other control has a titled panel reads as something
    // that failed rather than as something withheld.
    return (
      <section className="rounded-lg bg-surface-muted p-4">
        <h3 className="font-semibold">Schedule closure</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Withdrawing a room from sale for a range of nights is a manager's act.
        </p>
      </section>
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
    // The repeat press, dropped here rather than by `disabled` on the button,
    // for the reason `OutOfOrderControl` states: a disabled control cannot hold
    // focus, and the browser drops it on <body>.
    if (closeRoom.isPending) {
      return;
    }

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
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* The three fields are the form; the press is not one of them. In the
            same grid it took a cell beside the reason and aligned to the top of
            it, which put the button a label's height above the input next to
            it. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="First night"
            value={fields.checkIn}
            /* An example rather than a list of every accepted spelling. The
               console teaches this parser the same way on every screen that
               takes a typed date — a placeholder shows one, and the refusal
               names the rest — and a row of formats sitting under an empty
               field reads as a value somebody entered. */
            placeholder="15/3"
            hint="The first night withdrawn from sale."
            onChange={(checkIn) => {
              change({ checkIn });
            }}
          />
          <Field
            label="Back on sale"
            value={fields.checkOut}
            placeholder="+2d"
            hint="The night the room sells again."
            onChange={(checkOut) => {
              change({ checkOut });
            }}
          />
          <Field
            className="sm:col-span-2"
            label="Reason"
            value={fields.reason}
            placeholder="Bathroom retiling"
            onChange={(reason) => {
              change({ reason });
            }}
          />
        </div>

        {/* Between the range and the press, which is where the count is worth
            reading: it is the hit to sellable inventory, and after the button it
            would be a figure the manager passed on their way out. */}
        {attempt !== null && "input" in attempt ? (
          <p className="mt-3 text-sm">
            Withdraws {attempt.nights}{" "}
            {attempt.nights === 1 ? "night" : "nights"} of {room.roomType} from
            sale, from {formatShortDate(attempt.input.checkIn)} up to{" "}
            {formatShortDate(attempt.input.checkOut)}, which stays on sale.
          </p>
        ) : null}

        <Button
          className="mt-4 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          type="submit"
          aria-disabled={busy}
          aria-busy={busy}
        >
          Schedule closure
        </Button>
      </form>

      {problem === null ? null : (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}

      {closeRoom.data === undefined ? null : (
        // What the API took, said out loud. Not an alert: nothing is wrong and
        // nothing is owed, so it waits for the reader rather than interrupting.
        <p className="mt-3 text-sm text-muted-foreground" role="status">
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
  className,
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={fieldId}
        className="block text-sm font-semibold text-muted-foreground"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        // Named as well as drawn. A hint that only exists visually is guidance
        // the operator this console is built for never receives.
        aria-describedby={hint === undefined ? undefined : hintId}
        className="mt-1"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
