// Withdrawing a room from sale — `FR-INV-04`.
//
// A closure is a commercial act. The RBAC matrix gives it to `MANAGER` and
// `ADMIN` and notes why on the row itself: it changes `total_rooms`, and
// housekeeping's statuses never do. Marking 304 dirty decides who may enter it
// this afternoon; closing 304 decides that the property has one fewer Deluxe to
// sell on each of five nights, and only the second can turn a sellable night
// into a sold-out one.
//
// Both halves happen or neither does. The hold on the physical room and the
// decrement of the type's counter are the two layers `schema/inventory.ts`
// describes, and a closure that took the room but left the counter would leave
// the property selling a Deluxe it cannot hand a key for — an oversell arriving
// through the mechanism meant to prevent one. So it is one transaction, and the
// two constraints that guard it are the database's:
//
// - `room_assignment_no_overlap` refuses a closure across a room that is
//   already held, whether by a booking or by an earlier closure.
// - `type_inventory_sold_at_most_total` refuses a decrement that would push
//   `total_rooms` below what is already sold. A night with every Deluxe sold
//   cannot have one withdrawn, because the guest holding it has a reservation.
//
// Neither is checked here first. A check followed by a write is two statements
// a concurrent request can interleave; letting Postgres refuse the write is the
// only version that is true under concurrency.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import {
  room,
  roomAssignment,
  typeInventory,
} from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";

/** Postgres' SQLSTATE for the two refusals this service expects. */
const EXCLUSION_VIOLATION = "23P01";
const CHECK_VIOLATION = "23514";

export interface RoomClosure {
  readonly id: string;
  readonly roomNumber: string;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly reason: string;
  readonly nightsWithdrawn: number;
}

@Injectable()
export class ClosureService {
  /**
   * Withdraws a room from sale across a range.
   *
   * The executor is the caller's, and required — `database.module.ts` says why
   * a write may not open its own. Both halves of a closure still happen or
   * neither does; what changed is who draws the boundary around them.
   */
  async close(
    exec: DbExecutor,
    input: {
      roomNumber: string;
      checkIn: StayDate;
      checkOut: StayDate;
      reason: string;
    },
  ): Promise<RoomClosure> {
    const checkIn = input.checkIn.toString();
    const checkOut = input.checkOut.toString();

    try {
      const [held] = await exec
        .select({ id: room.id, roomTypeId: room.roomTypeId })
        .from(room)
        .where(eq(room.number, input.roomNumber))
        .limit(1);

      if (!held) {
        throw new ORPCError("NOT_FOUND", {
          message: `No room numbered ${input.roomNumber}`,
        });
      }

      const [closure] = await exec
        .insert(roomAssignment)
        .values({
          roomId: held.id,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          closureReason: input.reason,
        })
        .returning({ id: roomAssignment.id });

      const withdrawn = await exec
        .update(typeInventory)
        .set({ totalRooms: sql`${typeInventory.totalRooms} - 1` })
        .where(
          and(
            eq(typeInventory.roomTypeId, held.roomTypeId),
            gte(typeInventory.stayDate, checkIn),
            lt(typeInventory.stayDate, checkOut),
          ),
        )
        .returning({ id: typeInventory.id });

      // Every night of the range must have had a row to decrement. A night
      // the property never opened for sale has no counter, and silently
      // holding the room across it would leave the two layers disagreeing
      // the moment that date is opened — the room held, the counter full.
      if (withdrawn.length !== nightsBetween(input.checkIn, input.checkOut)) {
        throw new ORPCError("CONFLICT", {
          message:
            "The range includes nights that are not open for sale — open the calendar for them first",
        });
      }

      return {
        id: closure!.id,
        roomNumber: input.roomNumber,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        reason: input.reason,
        nightsWithdrawn: withdrawn.length,
      };
    } catch (error) {
      throw this.asRefusal(error, input.roomNumber);
    }
  }

  /**
   * Puts the room back on sale.
   *
   * Only a closure may be reopened. The `closure_reason is not null` predicate
   * is what makes that a database condition rather than a habit: without it
   * this endpoint would release a guest's room and credit the property with
   * inventory it has already sold, which is the same oversell from the other
   * direction.
   */
  async reopen(
    exec: DbExecutor,
    closureId: string,
  ): Promise<{
    id: string;
    nightsRestored: number;
  }> {
    const [released] = await exec
      .delete(roomAssignment)
      .where(
        and(
          eq(roomAssignment.id, closureId),
          isNotNull(roomAssignment.closureReason),
        ),
      )
      .returning({
        roomId: roomAssignment.roomId,
        checkInDate: roomAssignment.checkInDate,
        checkOutDate: roomAssignment.checkOutDate,
      });

    if (!released) {
      throw new ORPCError("NOT_FOUND", {
        message: "No closure with that id — a booking is not a closure",
      });
    }

    const [held] = await exec
      .select({ roomTypeId: room.roomTypeId })
      .from(room)
      .where(eq(room.id, released.roomId))
      .limit(1);

    const restored = await exec
      .update(typeInventory)
      .set({ totalRooms: sql`${typeInventory.totalRooms} + 1` })
      .where(
        and(
          eq(typeInventory.roomTypeId, held!.roomTypeId),
          gte(typeInventory.stayDate, released.checkInDate),
          lt(typeInventory.stayDate, released.checkOutDate),
        ),
      )
      .returning({ id: typeInventory.id });

    return { id: closureId, nightsRestored: restored.length };
  }

  /**
   * Turns the two refusals this service expects into the status a caller can
   * act on, and leaves everything else alone.
   *
   * A 409 rather than a 500 because neither is a fault: the room is genuinely
   * taken, or the type is genuinely sold out for a night in the range. Both are
   * answers, and both are things the desk resolves by choosing a different room
   * or a different week.
   */
  private asRefusal(error: unknown, roomNumber: string): unknown {
    const code = sqlStateOf(error);

    if (code === EXCLUSION_VIOLATION) {
      return new ORPCError("CONFLICT", {
        message: `Room ${roomNumber} is already held across part of that range`,
      });
    }

    if (code === CHECK_VIOLATION) {
      return new ORPCError("CONFLICT", {
        message:
          "Every room of that type is sold on at least one night in the range — there is none left to withdraw",
      });
    }

    return error;
  }
}

/** Nights a half-open range covers. */
function nightsBetween(checkIn: StayDate, checkOut: StayDate): number {
  let nights = 0;

  for (
    let date = checkIn;
    date.compare(checkOut) < 0;
    date = date.add({ days: 1 })
  ) {
    nights += 1;
  }

  return nights;
}
