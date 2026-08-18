/* The rooms screen's decisions: what it groups, who may act, and what it sends.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/arrivals/arrival-queue.ts` gives about its own queue: everything
 * below is a judgement the API does not make for the console — how the rooms are
 * grouped, which of them answer what an operator typed, which of the two kinds
 * of "unavailable" an operator is offered, how many nights a closure actually
 * withdraws, and what the board will read like the instant after a write lands.
 *
 * Three rules hold throughout, and `room-list.spec.ts` holds this file to them:
 *
 * 1. **The two kinds of unavailable never blur.** `docs/screens.md` §"Staff
 *    surfaces" puts both on the room's detail precisely so one place answers
 *    "why is this room not sellable?", and keeps them apart by permission and by
 *    framing: out of order is immediate and touches room state only, a closure
 *    is a manager's commercial act that withdraws nights from sale.
 *    {@link mayMarkOutOfOrder} and {@link mayCloseRooms} are that line, and
 *    neither is a wall — the API's capability guard is.
 * 2. **The nights a closure costs are counted before it is confirmed.**
 *    {@link closureAttempt} answers the count along with the input, so the
 *    operator reads the hit to sellable inventory rather than discovering it in
 *    the response.
 * 3. **A refusal the operator can still fix is not sent.** The contract refuses
 *    a closure with no reason, a range that does not run forwards, and a room
 *    taken out of order without one; so does this, in the contract's own words,
 *    before a request leaves the browser.
 *
 * The room list itself comes from `housekeeping.board`, which is the only read
 * in the contract that answers every room of the property. There is no room or
 * room-type read route, so this screen manages the *state* of rooms and not the
 * rooms themselves.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  closeRoomInput as closureSchema,
  nightCount,
  setOutOfOrderInput as outOfOrderSchema,
  ROOM_TYPE_CODES,
  type RoomTypeCode,
  type StaffRole,
} from "@mariva/shared";

/* The board is where the rooms come from, and its two modules are imported by
 * their own paths rather than through `features/housekeeping`. That barrel
 * carries the hooks, so a spec for this file would pull TanStack Query and a
 * cache in behind them — the argument `features/bookings/booking-search.ts`
 * makes about reaching past a barrel for `shiftDate`. */
import type {
  BoardRoom,
  HousekeepingBoard,
} from "@/features/housekeeping/board-queries";
import { CONDITION_LABELS } from "@/features/housekeeping/housekeeping-board";
import { parseLiberalDate } from "@/lib/date-parser";

/* The write shapes, read off the client rather than restated: `@mariva/shared`
 * types the client from the contract's own schemas, so a field renamed there
 * breaks this file in the pull request that renamed it. */
export type CloseRoomInput = Parameters<ApiClient["inventory"]["closeRoom"]>[0];
export type SetOutOfOrderInput = Parameters<
  ApiClient["housekeeping"]["setOutOfOrder"]
>[0];

/** One room type, and the property's rooms of it. */
export interface RoomTypeGroup {
  readonly roomType: RoomTypeCode;
  readonly rooms: readonly BoardRoom[];
}

/**
 * The property's rooms, grouped by what they are sold as.
 *
 * The group order is `ROOM_TYPE_CODES` and not alphabetical, so this list runs
 * in the same order as every other room-type list in the product — the rate
 * grid's rows, the funnel's cards — rather than inventing a sixth ordering.
 * A type the property has no rooms of is absent rather than shown empty: the
 * board is the source, and a heading over nothing would be this screen claiming
 * to know the type catalogue, which no route in the contract answers.
 *
 * Rooms run in door order within a group, with `numeric` collation for
 * `floorsOf`'s reason: 402 sorts before 4010.
 */
export function roomsByType(rooms: readonly BoardRoom[]): RoomTypeGroup[] {
  return ROOM_TYPE_CODES.map((roomType) => ({
    roomType,
    rooms: rooms
      .filter((room) => room.roomType === roomType)
      .sort((left, right) =>
        left.roomNumber.localeCompare(right.roomNumber, "en", {
          numeric: true,
        }),
      ),
  })).filter((group) => group.rooms.length > 0);
}

/**
 * A room's state in one line — the indicator the list carries.
 *
 * Out of order is said on its own rather than beside a cleaning state. A room
 * nobody may enter is not "dirty and also shut": the condition underneath it is
 * not the fact an operator scanning the list needs, and printing both invites
 * exactly the confusion `screens.md` asks this screen to prevent.
 */
export function roomStateLabel(room: BoardRoom): string {
  if (room.status === "OUT_OF_ORDER") {
    return CONDITION_LABELS.OUT_OF_ORDER;
  }

  return `${CONDITION_LABELS[room.status]} · ${room.isOccupied ? "Occupied" : "Vacant"}`;
}

/**
 * Who is offered *mark out of order* — the matrix's `housekeeping.set-out-of-order`
 * row, which is room state and nothing else.
 *
 * The accountant is the one staff role denied it. They read money and the
 * records money is attached to, and shutting a room is neither.
 */
export function mayMarkOutOfOrder(role: StaffRole): boolean {
  return (
    role === "RECEPTIONIST" ||
    role === "HOUSEKEEPING" ||
    role === "MANAGER" ||
    role === "ADMIN"
  );
}

/** Who is offered a closure — `inventory.close-room`, management only, because
 *  it moves `total_rooms` and changes what a guest can buy. */
export function mayCloseRooms(role: StaffRole): boolean {
  return role === "MANAGER" || role === "ADMIN";
}

/** What the operator typed into the closure form, before any of it is read. */
export interface ClosureFields {
  checkIn: string;
  checkOut: string;
  reason: string;
}

/** An empty closure form, and the identity the screen resets to. */
export const NO_CLOSURE_FIELDS: ClosureFields = {
  checkIn: "",
  checkOut: "",
  reason: "",
};

/** Either a closure the contract will take — with the nights it costs — or the
 *  sentence that says why it is not one yet. */
export type ClosureAttempt =
  | { readonly input: CloseRoomInput; readonly nights: number }
  | { readonly problem: string };

/**
 * The closure as `closeRoomInput` takes it, and the inventory it withdraws.
 *
 * Dates go through `parseLiberalDate` against the property's business date, like
 * every other date on the console: a manager types "+7d" or "15/3" and never
 * opens a picker. The bounds and the required reason are the contract's own
 * schema run here rather than restated, so a rule changed in
 * `packages/shared/src/contract/inventory.ts` cannot drift from what this form
 * enforces.
 *
 * The nights come from the decoded range and are the hit to sellable inventory
 * for one room: `nightCount` under the half-open convention, which is the same
 * arithmetic the closure service withdraws `type_inventory` rows with. What is
 * *sent* is the typed input and never the parsed output — a `CalendarDate` is a
 * shape for a service to hold and not one to put on the wire.
 */
export function closureAttempt(
  fields: ClosureFields,
  roomNumber: string,
  businessDate: string,
): ClosureAttempt {
  const checkIn = parseLiberalDate(fields.checkIn, businessDate);
  const checkOut = parseLiberalDate(fields.checkOut, businessDate);

  if (checkIn === null || checkOut === null) {
    return {
      problem:
        "A closure needs a first and a last night. Type a date — 15/3, +7d — for both.",
    };
  }

  const input: CloseRoomInput = {
    roomNumber,
    checkIn,
    checkOut,
    reason: fields.reason.trim(),
  };

  const checked = closureSchema.safeParse(input);

  if (!checked.success) {
    // The schema's own words, and the first refusal rather than all of them: a
    // form with one message beside it is one thing to fix.
    return {
      problem:
        checked.error.issues[0]?.message ??
        "That is not a closure the API takes.",
    };
  }

  return { input, nights: nightCount(checked.data) };
}

/** Either a room-state write the contract will take, or the sentence that says
 *  why not. */
export type OutOfOrderAttempt =
  | { readonly input: SetOutOfOrderInput }
  | { readonly problem: string };

/**
 * Shutting a room, or opening it again.
 *
 * The reason is required going out and absent coming back, which is the
 * contract's shape and the service's: storage refuses a blank reason on a room
 * that is shut — the desk asking "why is 304 out?" is the question that column
 * exists to answer — and putting a room back needs none.
 */
export function outOfOrderAttempt(
  roomNumber: string,
  outOfOrder: boolean,
  reason: string,
): OutOfOrderAttempt {
  const trimmed = reason.trim();

  const input: SetOutOfOrderInput = outOfOrder
    ? { roomNumber, outOfOrder, reason: trimmed }
    : { roomNumber, outOfOrder };

  const checked = outOfOrderSchema.safeParse(input);

  if (!checked.success) {
    // The missing reason is the one refusal an operator can act on — it is the
    // only field they typed — so it is answered in the property's own words.
    // Anything else the schema refuses is about the room number this screen
    // supplied, and reporting *that* as a missing reason would send the operator
    // to fix a field which is already correct; the schema's own sentence is the
    // honest answer there.
    return {
      problem:
        outOfOrder && trimmed === ""
          ? "A room going out of order needs a reason. The desk will be asked why it is shut."
          : (checked.error.issues[0]?.message ??
            "That is not a room-state write the API takes."),
    };
  }

  return { input };
}

/**
 * The board as it will read once the API has accepted an out-of-order write.
 *
 * The optimistic guess `board-queries.ts` sets the pattern for, applied to the
 * other room-state route. It is the service's own behaviour and not a
 * convenient one: shutting a room stores the trimmed reason, and *opening* one
 * returns it to `DIRTY` rather than to `CLEAN`, because somebody has been
 * working in there and a guest must not be walked into a room no housekeeper
 * has seen since the repair. A console that guessed `CLEAN` here would paint a
 * room as ready for one second, which is the flicker the pattern exists to
 * prevent — and in this direction it would be a flicker on the exact field the
 * check-in guard reads.
 */
export function withOutOfOrder(
  board: HousekeepingBoard,
  input: SetOutOfOrderInput,
): HousekeepingBoard {
  return {
    ...board,
    rooms: board.rooms.map((room) =>
      room.roomNumber === input.roomNumber
        ? {
            ...room,
            status: input.outOfOrder ? "OUT_OF_ORDER" : "DIRTY",
            isReady: false,
            note: input.outOfOrder ? (input.reason?.trim() ?? null) : null,
          }
        : room,
    ),
  };
}

/**
 * Whether one room answers what the operator typed — number, type or condition.
 *
 * Three fields and no more, because those are the three an operator at the desk
 * has in their head when they reach for this screen: a number somebody read them
 * over the telephone, a type they are looking for a spare of, and a condition
 * they are chasing ("out of order", "dirty"). The condition is matched through
 * {@link roomStateLabel}, so what is typed is matched against the words the row
 * actually prints — a search that answered "dirty" while the row said something
 * else would be a second vocabulary for the same fact.
 *
 * The type is matched with its underscore spelled as a space as well as as
 * itself, so "junior suite" finds `JUNIOR_SUITE` — the code is what the row
 * prints and it is not how anybody says it out loud.
 *
 * Substring rather than prefix, and case-insensitive: "02" finds 402 and 502,
 * which is what somebody halfway through a number wants.
 */
export function roomMatches(room: BoardRoom, query: string): boolean {
  const wanted = query.trim().toLowerCase();

  if (wanted === "") {
    return true;
  }

  return [
    room.roomNumber,
    room.roomType,
    room.roomType.replaceAll("_", " "),
    roomStateLabel(room),
  ].some((field) => field.toLowerCase().includes(wanted));
}

/**
 * The groups with every room the query does not answer taken out of them.
 *
 * A type left with no rooms disappears with them, for {@link roomsByType}'s own
 * reason: a heading over nothing says the property has none of that type, which
 * is a different sentence from "none of them match what you typed". The screen
 * says the second one once, under the whole list.
 */
export function narrowRooms(
  groups: readonly RoomTypeGroup[],
  query: string,
): RoomTypeGroup[] {
  return groups
    .map((group) => ({
      roomType: group.roomType,
      rooms: group.rooms.filter((one) => roomMatches(one, query)),
    }))
    .filter((group) => group.rooms.length > 0);
}
