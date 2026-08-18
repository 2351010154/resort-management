"use client";

import type { StaffRole } from "@mariva/shared";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  outOfOrderAttempt,
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
 * `g r` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * Role gating below is presentation and not a wall: the API's capability guard
 * is the wall, and what these predicates decide is whether an operator is
 * *offered* an act that would answer 403.
 */

export function RoomsScreen() {
  const session = useStaffSession();
  const { businessDate, list } = useRoomList();
  const [selected, setSelected] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks — `features/shell/app-nav.tsx` makes the same argument.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;

  const rooms =
    list.status === "ready" ? list.groups.flatMap((group) => group.rooms) : [];
  const room = rooms.find((one) => one.roomNumber === selected) ?? null;

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Property
        </p>
        <h1 className="font-display text-display-sm mt-2">Rooms</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          Every room the property has, by what it is sold as. Pick one to shut
          it for maintenance or to withdraw it from sale.
        </p>
      </header>

      {list.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading the property's rooms.
        </p>
      ) : null}

      {list.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The rooms could not be loaded. Nothing here is a statement about what
          the property has to sell.
        </p>
      ) : null}

      {list.status === "ready" ? (
        <div className="mt-rhythm-2 grid gap-rhythm-2 lg:grid-cols-[16rem_1fr]">
          <RovingFocusGroup aria-label="Rooms" className="flex flex-col gap-4">
            {list.groups.map((group) => (
              <section key={group.roomType}>
                <h2 className="text-muted-foreground text-xs tracking-caps uppercase">
                  {/* The code as the contract spells it. The console names room
                      types this way on every other screen — arrivals' "Sold as"
                      column, the new booking form's choices — and a second
                      spelling here would be a second opinion about the
                      catalogue. */}
                  {group.roomType}
                </h2>
                <ul className="mt-1">
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

          {room === null || role === null ? (
            <p className="text-muted-foreground text-sm">
              Pick a room to see its state, and what can be done about it.
            </p>
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
          "hover:bg-accent/40 focus-visible:bg-accent/40 flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
          selected ? "bg-accent/60" : null,
        )}
      >
        <span className="font-mono">{room.roomNumber}</span>
        <span
          className={cn(
            "text-xs",
            room.status === "OUT_OF_ORDER"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {roomStateLabel(room)}
        </span>
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
    <div className="border-border border-l pl-4">
      <h2 className="font-display text-2xl">
        Room <span className="font-mono">{room.roomNumber}</span>
      </h2>

      <dl className="mt-rhythm-1 grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Sold as" value={room.roomType} />
        <Fact label="Floor" value={String(room.floor)} />
        <Fact
          label="Condition"
          value={
            isShut
              ? CONDITION_LABELS.OUT_OF_ORDER
              : `${CONDITION_LABELS[room.status]}${room.isReady ? " — a guest can be walked in" : ""}`
          }
        />
        <Fact
          label="Assignment"
          value={
            room.isOccupied
              ? "Occupied — a stay is in the room"
              : "Vacant — no stay holds it"
          }
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

      <p className="text-muted-foreground mt-rhythm-1 text-xs">
        Which stay is in the room is the booking's, not the room's — the board
        answers occupancy and never who is in it. Rooms and room types
        themselves are seeded and are not edited here.
      </p>

      <OutOfOrderControl room={room} role={role} />
      <ClosureControl room={room} role={role} businessDate={businessDate} />
    </div>
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
    <section className="mt-rhythm-2">
      <h3 className="text-sm">Out of order</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        Immediate, and room state only. The property still has the same number
        of {room.roomType} rooms to sell on every date.
      </p>

      {isShut ? (
        <div className="mt-rhythm-1">
          <Button
            type="button"
            disabled={outOfOrder.isPending}
            onClick={() => {
              act(false);
            }}
          >
            Return to service
          </Button>
          <p className="text-muted-foreground mt-1 text-xs">
            The room comes back as dirty rather than clean: somebody has been
            working in there, and housekeeping releases it.
          </p>
        </div>
      ) : (
        <form
          className="mt-rhythm-1 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            act(true);
          }}
        >
          <Field
            label="Reason"
            value={reason}
            hint="Shower mixer leaking, repainting — the desk will be asked why."
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
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
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
      <p className="text-muted-foreground mt-rhythm-2 text-xs">
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
    <section className="mt-rhythm-2">
      <h3 className="text-sm">Schedule closure</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        Withdraws the room from sale for a range of nights. This is a commercial
        act: it changes what a guest can buy and touches no cleaning state.
      </p>

      <form
        className="mt-rhythm-1 flex flex-wrap items-end gap-2"
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
          of {room.roomType} from sale —{" "}
          {formatShortDate(attempt.input.checkIn)} up to{" "}
          {formatShortDate(attempt.input.checkOut)}, which stays on sale.
        </p>
      ) : null}

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
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
        className="text-muted-foreground block text-xs tracking-caps uppercase"
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
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
