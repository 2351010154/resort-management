// What state a room is in, and the board the floors are walked with —
// `FR-HK-01` and `FR-HK-02`.
//
// Three operations, and the line between the first two is the requirement
// rather than a tidy-up. `FR-HK-01`'s three readiness states are a cleaning
// judgement; `OUT_OF_ORDER` says nobody may walk in at all, and the RBAC matrix
// spells them as two capability keys. One method taking all four statuses would
// let a caller holding `housekeeping.set-condition` write the status the other
// key governs — an authorisation boundary quietly relocated into an enum. So
// `setCondition` refuses `OUT_OF_ORDER` and `setOutOfOrder` writes nothing else,
// and the guard is at runtime rather than only in the type, because the value
// arrives from the wire and a compiled type refuses nothing there.
//
// **Nothing in this file touches `type_inventory`, and that is the requirement
// too.** `FR-HK-02` exists because the two have been conflated often enough to
// be worth naming: a housekeeper marks 402 out of order, the type quietly loses
// a room from sale on every date in the calendar, and the property finds out by
// not being bookable. Withdrawing a room from sale is `FR-INV-04`'s closure —
// `ClosureService`, a manager's capability, a commercial act. This service knows
// only which room is in what state.
//
// The write is an upsert rather than a read followed by an update. Two of them
// racing on a room whose condition row does not exist yet would both find
// nothing and both insert, and `room_condition_room_id_key` would refuse the
// loser — a housekeeper's tap failing because somebody else tapped first. `on
// conflict do update` lets Postgres settle it, which is the same argument the
// inventory counter makes for letting the check refuse rather than checking
// first.
//
// The board answers for *every* room, including one whose condition row is
// missing. Seeding and the housekeeping migration both write a row per room, so
// the fallback below is for a room that arrived by some other path — and a room
// missing from the grid is a room nobody is sent to clean, which is worse than
// one shown in the state a room nobody has touched is in. This is not the
// check-in guard: that reads the row itself and must fail closed on its absence.

import {
  HOUSEKEEPING_STATUSES,
  type HousekeepingStatus,
  type StayDate,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomCondition } from "../../database/schema/housekeeping.js";
import { staffUser } from "../../database/schema/identity.js";
import { room, roomAssignment } from "../../database/schema/inventory.js";

/** The three a cleaning round moves a room between — `FR-HK-01`. */
export type RoomReadiness = Exclude<HousekeepingStatus, "OUT_OF_ORDER">;

// Derived from the shared tuple rather than written out again, so a fifth
// status has to be placed on one side of the capability line or the other
// instead of defaulting to neither.
const READINESS: ReadonlySet<HousekeepingStatus> = new Set(
  HOUSEKEEPING_STATUSES.filter((status) => status !== "OUT_OF_ORDER"),
);

// `booking-state-machine.md` §4's room-ready guard, as the board's own column.
// `INSPECTED` sits above `CLEAN` rather than beside it — the optional
// supervisor pass — so both admit a guest and neither is a prerequisite for the
// other.
const READY_FOR_A_GUEST: ReadonlySet<HousekeepingStatus> = new Set([
  "CLEAN",
  "INSPECTED",
]);

/** A room's condition after a write, as the desk should now see it. */
export interface RoomCondition {
  readonly roomNumber: string;
  readonly status: HousekeepingStatus;
  readonly note: string | null;
  readonly updatedAt: Date;
}

/**
 * One tile of the board.
 *
 * Readiness and occupied/vacant, and deliberately nothing else: `screens.md`
 * §Staff surfaces gives housekeeping no money and no guest names, and the way
 * to keep a field off a screen is to keep it out of the answer the screen is
 * drawn from.
 *
 * `updatedBy` is the staff member's name and not the guest's — the board is
 * read to find out who last touched 402 and when. Null is a real answer: the
 * checkout transition sets `DIRTY` with nobody deciding to.
 */
export interface BoardRoom {
  readonly roomNumber: string;
  readonly floor: number;
  readonly status: HousekeepingStatus;
  readonly isReady: boolean;
  readonly isOccupied: boolean;
  readonly note: string | null;
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
}

/** What a write puts in the row, once the caller's input has been read. */
interface ConditionWrite {
  readonly status: HousekeepingStatus;
  readonly note: string | null;
  readonly updatedBy: string | null;
}

@Injectable()
export class HousekeepingService {
  /**
   * Moves a room through the three readiness states — `FR-HK-01`.
   *
   * `updatedBy` is optional because one caller is not a person: checkout hands
   * the room back to housekeeping as `DIRTY`
   * (`booking-state-machine.md` §3), and attributing that to whoever pressed
   * the button would put a cleaning judgement in their name.
   *
   * The note is cleared, always. It is the reason a room was out of order, and
   * a room reading `CLEAN` under "shower mixer leaking" is a board that
   * contradicts itself.
   *
   * The executor is the caller's and required — `database.module.ts` says why a
   * write may not open its own. Checkout is the case that settles it: the
   * transition writes the booking, releases the unspent nights and dirties the
   * room, and all three are one commit.
   */
  async setCondition(
    exec: DbExecutor,
    input: {
      roomNumber: string;
      status: RoomReadiness;
      updatedBy?: string | null;
    },
  ): Promise<RoomCondition> {
    // Reachable despite the type above: the status arrives from the wire, and
    // the capability that admits this call is not the one that governs
    // `OUT_OF_ORDER`.
    if (!READINESS.has(input.status)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Taking a room out of order is a separate act with its own reason",
      });
    }

    return await this.write(exec, input.roomNumber, {
      status: input.status,
      note: null,
      updatedBy: input.updatedBy ?? null,
    });
  }

  /**
   * Takes a room out of order, or puts it back — `FR-HK-02`.
   *
   * It moves no counter. The property still has the same number of rooms of
   * that type to sell on every date, and `type_inventory` is not named anywhere
   * in this file; the closure that *does* move it is a manager's, elsewhere.
   *
   * A room going out of order needs a reason. Storage refuses a blank one —
   * `room_condition_note_present_when_set` — and refusing it here as well is
   * what turns an empty form field into an answer rather than a constraint
   * violation surfacing as a fault. The reason is stored trimmed, so the board
   * shows what was written rather than what was typed around it.
   *
   * Clearing it returns the room to `DIRTY` rather than to `CLEAN`. Somebody
   * has been working in there, and §4's guard admits a guest into `CLEAN` or
   * `INSPECTED` — so guessing in that direction would open a room a housekeeper
   * has not seen since the repair. `DIRTY` costs a cleaning round; the other
   * guess costs a guest walking into it.
   */
  async setOutOfOrder(
    exec: DbExecutor,
    input: {
      roomNumber: string;
      outOfOrder: boolean;
      reason?: string | null;
      updatedBy?: string | null;
    },
  ): Promise<RoomCondition> {
    const updatedBy = input.updatedBy ?? null;

    if (!input.outOfOrder) {
      return await this.write(exec, input.roomNumber, {
        status: "DIRTY",
        note: null,
        updatedBy,
      });
    }

    const reason = input.reason?.trim() ?? "";

    if (reason.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A room going out of order needs a reason",
      });
    }

    return await this.write(exec, input.roomNumber, {
      status: "OUT_OF_ORDER",
      note: reason,
      updatedBy,
    });
  }

  /**
   * Every room, in the state it is in, for the day the property is having —
   * `FR-HK-02`.
   *
   * The business date is a parameter rather than something read in here. It is
   * the property's own day, rolled at the audit hour, and one board rendered
   * against two different answers to "what day is it" would show a departure as
   * still in house on one screen and gone on another. The caller resolves it
   * once and every row is answered against the same date.
   *
   * Occupied means a guest's stay covers that date, under the same half-open
   * convention every range in the system uses: the departure date is not a
   * night, so a room being left this morning reads vacant and — once checkout
   * has run — `DIRTY`, which is exactly the tile a housekeeper is looking for.
   * A closure holds a room without anybody being in it, so it is not occupancy
   * and does not claim to be.
   *
   * Ordered by floor and then room number because that is the walk: a
   * housekeeper works a floor at a time, and a grid whose tiles arrive in the
   * order Postgres found them is one nobody can check their trolley against.
   */
  async getBoard(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly BoardRoom[]> {
    const date = businessDate.toString();

    const rows = await exec
      .select({
        roomNumber: room.number,
        floor: room.floor,
        status: sql<HousekeepingStatus>`coalesce(${roomCondition.status}, 'CLEAN')`,
        note: roomCondition.note,
        updatedAt: roomCondition.updatedAt,
        updatedBy: staffUser.fullName,
        // A correlated `exists` rather than a join: a room held for three
        // separate stays across the year would otherwise arrive as three tiles
        // of the same room, and collapsing them afterwards is work the database
        // stops doing the moment it finds one.
        // The table and its columns are interpolated as schema objects rather
        // than written as text, which is `availability.service.ts`'s convention
        // and is there for one reason: a column renamed in `schema/inventory.ts`
        // becomes a build error here instead of a subquery that typechecks and
        // fails at runtime, on the board the housekeepers work from.
        isOccupied: sql<boolean>`exists (
          select 1
            from ${roomAssignment}
           where ${roomAssignment.roomId} = ${room.id}
             and ${roomAssignment.bookingId} is not null
             and ${roomAssignment.checkInDate} <= ${date}
             and ${roomAssignment.checkOutDate} > ${date}
        )`,
      })
      .from(room)
      .leftJoin(roomCondition, eq(roomCondition.roomId, room.id))
      .leftJoin(staffUser, eq(staffUser.id, roomCondition.updatedBy))
      .orderBy(room.floor, room.number);

    return rows.map((row) => ({
      ...row,
      isReady: READY_FOR_A_GUEST.has(row.status),
    }));
  }

  /**
   * The state one room is in — what §4's room-ready guard is asked about.
   *
   * `coalesce` to `CLEAN`, the same default `getBoard` applies and for the same
   * reason: a room the property has never recorded a condition for has never
   * been dirtied, and `schema/housekeeping.ts` stores the row rather than the
   * absence. Defaulting the other way would refuse check-in into every room of a
   * property that has not run a cleaning round yet.
   *
   * By id and not by number, because the caller already holds the assignment
   * row. Resolving the number back out of it would be a second read to reach a
   * value the first one returned.
   */
  async statusOf(
    exec: DbExecutor,
    roomId: string,
  ): Promise<HousekeepingStatus> {
    const [found] = await exec
      .select({
        status: sql<HousekeepingStatus>`coalesce(${roomCondition.status}, 'CLEAN')`,
      })
      .from(room)
      .leftJoin(roomCondition, eq(roomCondition.roomId, room.id))
      .where(eq(room.id, roomId))
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", { message: "No room with that id" });
    }

    return found.status;
  }

  /**
   * Writes the one condition row a room has.
   *
   * The room is resolved by number first, and that read is not a check a
   * concurrent request can invalidate — it turns a label the desk speaks into
   * an id. Without it a room number nobody has would be a foreign key violation
   * reported as a fault, when it is an answer: no such room.
   *
   * `updated_at` is set from the database's clock on the conflict path so it
   * comes from the same place the column's default gets it on the insert path.
   * A board sorted by a column fed by two clocks interleaves rows that did not
   * happen in that order.
   */
  private async write(
    exec: DbExecutor,
    roomNumber: string,
    condition: ConditionWrite,
  ): Promise<RoomCondition> {
    const [held] = await exec
      .select({ id: room.id })
      .from(room)
      .where(eq(room.number, roomNumber))
      .limit(1);

    if (!held) {
      throw new ORPCError("NOT_FOUND", {
        message: `No room numbered ${roomNumber}`,
      });
    }

    const [written] = await exec
      .insert(roomCondition)
      .values({ roomId: held.id, ...condition })
      .onConflictDoUpdate({
        target: roomCondition.roomId,
        set: { ...condition, updatedAt: sql`now()` },
      })
      .returning({
        status: roomCondition.status,
        note: roomCondition.note,
        updatedAt: roomCondition.updatedAt,
      });

    return { roomNumber, ...written! };
  }
}
