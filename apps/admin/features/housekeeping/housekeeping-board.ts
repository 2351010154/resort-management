/* What the board decides for itself, with no cache and no markup in the way.
 *
 * Pure, and separate from `board-queries.ts` and the screen beside it, for the
 * reason `features/arrivals/arrival-queue.ts` gives about its own queue:
 * everything below is a judgement the API does not make for the console — how
 * the floors are ordered, which state a tap moves a room to, and exactly which
 * facts about a room reach a housekeeper's eye. That last one is the reason this
 * file exists rather than the grid reading `room.status` inline.
 *
 * Three rules hold throughout, and `housekeeping-board.spec.ts` holds this file
 * to them:
 *
 * 1. **The tile is the whole of what the board says about a room.** `screens.md`
 *    §"Staff surfaces" gives housekeeping no money and no guest names, and a
 *    projection is how that is enforced instead of hoped for: the screen renders
 *    {@link BoardTile}'s fields and nothing else, so a field added to the board's
 *    response cannot appear on the floor by being in scope.
 * 2. **A tap advances the cleaning cycle and never crosses a capability line.**
 *    `DIRTY → CLEAN → INSPECTED → DIRTY` are the three states
 *    `housekeeping.set-condition` governs. `OUT_OF_ORDER` is the other row of
 *    the matrix, so {@link nextCondition} answers null for it — a tap on such a
 *    tile is not a write the board is allowed to guess at, and it would silently
 *    clear the repair note the desk is keeping.
 * 3. **A board nobody could read is not an empty property.** {@link boardReading}
 *    keeps "no answer yet" and "the request failed" apart from "every room is
 *    on screen", because a grid drawn from nothing looks like a hotel with no
 *    rooms in it.
 */

import type { HousekeepingStatus } from "@mariva/shared";

import { PROPERTY_TIME_ZONE } from "@/lib/business-date";

import type {
  BoardRoom,
  HousekeepingBoard,
  SetConditionInput,
} from "./board-queries";

/** The three states a cleaning round moves a room between, as the contract's
 *  own write takes them — read off `setCondition` rather than restated, so the
 *  status this file hands the mutation is the status that route admits. */
export type RoomReadiness = SetConditionInput["status"];

/** One floor of the property, and the rooms on it in door order. */
export interface BoardFloor {
  readonly floor: number;
  readonly rooms: readonly BoardRoom[];
}

/** What the screen knows about the board it is drawing. */
export type BoardReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly businessDate: string;
      readonly floors: readonly BoardFloor[];
    };

/** How each state is written for somebody standing in a corridor. */
export const CONDITION_LABELS: Record<HousekeepingStatus, string> = {
  DIRTY: "Dirty",
  CLEAN: "Clean",
  INSPECTED: "Inspected",
  OUT_OF_ORDER: "Out of order",
};

/** What the tap on a tile will do, named by its result rather than by "next" —
 *  a large target on a phone is pressed without reading twice, so it says the
 *  state it produces. */
const ADVANCE_LABELS: Record<RoomReadiness, string> = {
  CLEAN: "Mark clean",
  INSPECTED: "Mark inspected",
  DIRTY: "Mark dirty",
};

/**
 * The rooms of the property, by floor, in the order they are walked.
 *
 * Floors ascend and rooms run in door order within one. `numeric` collation, so
 * 402 sorts before 4010 — a plain string compare puts "4010" between "401" and
 * "402" and a housekeeper working the grid top to bottom would be sent back down
 * the corridor.
 *
 * A room's floor comes from the API rather than from the first digit of its
 * number: which digit means what is a property's own convention, and reading it
 * in the console would be a second opinion about the building.
 */
export function floorsOf(rooms: readonly BoardRoom[]): BoardFloor[] {
  const byFloor = new Map<number, BoardRoom[]>();

  for (const room of rooms) {
    const floor = byFloor.get(room.floor);

    if (floor === undefined) {
      byFloor.set(room.floor, [room]);
    } else {
      floor.push(room);
    }
  }

  return [...byFloor.entries()]
    .sort(([left], [right]) => left - right)
    .map(([floor, floorRooms]) => ({
      floor,
      rooms: floorRooms.sort((left, right) =>
        left.roomNumber.localeCompare(right.roomNumber, "en", {
          numeric: true,
        }),
      ),
    }));
}

/**
 * The state a tap moves the room to, or null when the board may not decide.
 *
 * The cycle closes rather than stopping at `INSPECTED`, and that is what makes
 * the grid correctable: a housekeeper who advanced 402 by mistake, or who has
 * just found a "clean" room somebody left a tray in, has no other way to say so
 * — and marking a room dirty is squarely inside `FR-HK-01`'s three states.
 *
 * `OUT_OF_ORDER` answers null. Writing a readiness onto that room is a
 * different capability's act with a reason attached, and `setCondition` clears
 * the note as it writes — so a stray tap would erase why the room is shut and
 * offer it to the next guest. The Rooms screen returns it to service.
 */
export function nextCondition(
  status: HousekeepingStatus,
): RoomReadiness | null {
  switch (status) {
    case "DIRTY":
      return "CLEAN";
    case "CLEAN":
      return "INSPECTED";
    case "INSPECTED":
      return "DIRTY";
    case "OUT_OF_ORDER":
      return null;
  }
}

/**
 * Everything one tile shows, and the enforcement of what it must not.
 *
 * The screen draws these fields and reads nothing else off a room, so the list
 * of things a housekeeper can see is this interface: a room number, what is in
 * the room, whether it is ready, whether somebody is in it, who last touched it,
 * and why it is shut if it is. No guest and no money — not because the response
 * happens not to carry them today, but because a tile is built from named
 * fields and a field nobody names cannot be rendered.
 */
export interface BoardTile {
  readonly roomNumber: string;
  readonly roomTypeLabel: string;
  readonly conditionLabel: string;
  readonly occupancyLabel: string;
  /** Who last set the state and when, in the property's own zone. */
  readonly touchedLabel: string;
  /** Why the room is out of order, when it is. Null otherwise: the note is
   *  cleared by every readiness write, so there is nothing else it can say. */
  readonly noteLabel: string | null;
  /** What a tap does, or null when the tile is not one to tap. */
  readonly advanceLabel: string | null;
  readonly next: RoomReadiness | null;
  readonly isReady: boolean;
}

// Day and time together, in Ho Chi Minh City. A bare clock would read "07:40"
// for a room last touched a week ago, and the board is the screen that answers
// "has anybody been in there today?".
const touchedFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  // h23, for `business-date.ts`'s reason: h24 renders midnight as hour 24.
  hourCycle: "h23",
});

export function boardTile(room: BoardRoom): BoardTile {
  const next = nextCondition(room.status);

  return {
    roomNumber: room.roomNumber,
    roomTypeLabel: room.roomType,
    conditionLabel: CONDITION_LABELS[room.status],
    occupancyLabel: room.isOccupied ? "Occupied" : "Vacant",
    touchedLabel: touchedLabel(room),
    noteLabel: room.status === "OUT_OF_ORDER" ? room.note : null,
    advanceLabel: next === null ? null : ADVANCE_LABELS[next],
    next,
    isReady: room.isReady,
  };
}

/**
 * Who last set this room, and when.
 *
 * A missing name is not attributed to check-out even though check-out is the
 * caller that leaves one: a room whose condition row was written by seeding
 * carries no name either, and a tile claiming a check-out that never happened
 * would be the board inventing property history. "The system" is the honest
 * width of what the response supports.
 */
function touchedLabel(room: BoardRoom): string {
  if (room.updatedAt === null) {
    return "Not recorded yet";
  }

  const when = touchedFormatter.format(new Date(room.updatedAt));

  return room.updatedBy === null
    ? `Set by the system, ${when}`
    : `${room.updatedBy}, ${when}`;
}

/**
 * The board's three states, folded out of one answer.
 *
 * Takes the failure as a flag and the answer as a value rather than reading a
 * query result, so the reading a housekeeper is shown can be checked without a
 * cache: the difference between "we do not know yet" and "there are no rooms" is
 * the whole point of it.
 */
export function boardReading(
  failed: boolean,
  board: HousekeepingBoard | undefined,
): BoardReading {
  if (failed) {
    return { status: "failed" };
  }

  if (board === undefined) {
    return { status: "pending" };
  }

  return {
    status: "ready",
    businessDate: board.businessDate,
    floors: floorsOf(board.rooms),
  };
}
