// Selling a room-night, and giving it back — `FR-INV-02`.
//
// The primitive every booking write ends in. `booking-state-machine.md` §3 says
// what it does in one line — "→ `HELD`: `sold_rooms += 1` per night" — and the
// same line read backwards is what a cancellation does. Two directions of one
// movement, so one implementation with the sign as its only parameter.
//
// **It moves the counter and nothing else.** No `room_assignment` is written
// here, because §1 gives a `HELD` booking no room, §5 makes assigning one a
// separate operation legal from `CONFIRMED` onward, and a room picked at hold
// time would mean two guests racing for the same physical key while the type
// still has stock — an exclusion violation refusing a sale the property could
// honour. Which room the guest gets is a question the front desk answers later,
// against a booking that already exists.
//
// The counter is the invariant, and it is not checked here first. `FR-INV-02`
// is a claim about fifty simultaneous requests, and a `select` that finds a
// room free is a fact that stops being true before the `update` that acts on
// it. So the row is written and `type_inventory_sold_at_most_total` refuses the
// one that would oversell — a `23514` this turns into a `409`, because a sold
// out night is an answer and not a fault.
//
// Two things about the statement below are load-bearing:
//
// - **One `update` for the whole stay.** A check that fails on the third night
//   aborts the statement, and with it the transaction, so a stay that cannot be
//   sold in full is not sold in part. The alternative — a statement per night —
//   would leave the first two nights consumed by a booking that never existed.
// - **The rows are locked in stay-date order.** `sold_rooms = sold_rooms + 1`
//   is already correct under concurrency; Postgres re-reads the row it waited
//   for and applies the increment to the value that committed. What ordering
//   buys is the absence of deadlock: two stays overlapping in the same type
//   otherwise take their row locks in whatever order each one's plan happened
//   to produce, and a short range on an index scan meeting a long one on a
//   sequential scan is two transactions holding what the other wants next.
//   Ordering the locking read makes that arrangement unreachable.

import {
  nightCount,
  type RoomTypeCode,
  type StayDate,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { eq, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomType } from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";

/** Postgres' SQLSTATE for the refusal this service expects. */
const CHECK_VIOLATION = "23514";

/** Which type, across which nights. Half-open, like every range in the system. */
export interface StayInventory {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
}

export interface InventoryMovement extends StayInventory {
  readonly nights: number;
}

/** The sign of a movement, and what it means when the database refuses it. */
interface Direction {
  readonly by: SQL;
  readonly refusal: string;
}

const CONSUME: Direction = {
  by: sql`+ 1`,
  refusal:
    "Every room of that type is sold on at least one night of that stay",
};

const RESTORE: Direction = {
  by: sql`- 1`,
  // `type_inventory_sold_not_negative` is what says so. Reaching it means a
  // release has run twice against a night that was only sold once, and the
  // refusal is the only thing standing between that and a row reading as
  // availability the property does not have.
  refusal:
    "More rooms would be released than were ever sold on at least one night of that stay",
};

@Injectable()
export class InventoryService {
  /**
   * Consumes one room of a type on every night of a stay, or none of them.
   *
   * The caller gets a `409` when the type is sold out on any night in the
   * range, and when the range covers a night the property has not opened for
   * sale. Both are answers the desk resolves by choosing different dates, which
   * is what makes them conflicts rather than faults.
   *
   * The executor is the caller's, and required. `booking-state-machine.md` §3
   * puts every caller of this inside a transition that also writes the booking
   * — so the transaction is the transition's, and this joins it rather than
   * opening one of its own beside it.
   */
  async reserve(
    exec: DbExecutor,
    stay: StayInventory,
  ): Promise<InventoryMovement> {
    return await this.move(exec, stay, CONSUME);
  }

  /**
   * Puts those nights back.
   *
   * The counterpart `CANCELLED` and an expired hold both end in — §3 gives them
   * the same inventory effect and different reason codes, so there is one
   * operation here and not two.
   */
  async release(
    exec: DbExecutor,
    stay: StayInventory,
  ): Promise<InventoryMovement> {
    return await this.move(exec, stay, RESTORE);
  }

  private async move(
    exec: DbExecutor,
    stay: StayInventory,
    direction: Direction,
  ): Promise<InventoryMovement> {
    const nights = nightCount(stay);

    // The same rule `room_assignment_covers_at_least_one_night` states in
    // storage: a stay of no nights consumes nothing and would report success
    // for a booking the property never took.
    if (nights < 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A stay must cover at least one night",
      });
    }

    const checkIn = stay.checkIn.toString();
    const checkOut = stay.checkOut.toString();

    try {
      const [type] = await exec
        .select({ id: roomType.id })
        .from(roomType)
        .where(eq(roomType.code, stay.roomType))
        .limit(1);

      // Read before the write, and legitimately: this resolves a name into an
      // id. It asks nothing about availability, so there is no answer here
      // that a concurrent request can invalidate.
      if (!type) {
        throw new ORPCError("NOT_FOUND", {
          message: `No room type coded ${stay.roomType}`,
        });
      }

      const moved = await exec.execute(sql`
        update type_inventory
           set sold_rooms = sold_rooms ${direction.by}
         where id in (
                 select id
                   from type_inventory
                  where room_type_id = ${type.id}
                    and stay_date >= ${checkIn}
                    and stay_date < ${checkOut}
                  order by stay_date
                    for update
               )
        returning id
      `);

      // Every night of the range must have had a counter to move. A night the
      // property never opened for sale has no row, and treating its absence
      // as nothing to do would sell a stay across a date that is not on sale.
      if (moved.rows.length !== nights) {
        throw new ORPCError("CONFLICT", {
          message:
            "The stay includes nights that are not open for sale — open the calendar for them first",
        });
      }

      return { ...stay, nights };
    } catch (error) {
      throw this.asRefusal(error, direction);
    }
  }

  /**
   * Turns the refusal this service expects into the status a caller can act on,
   * and leaves everything else alone.
   */
  private asRefusal(error: unknown, direction: Direction): unknown {
    if (sqlStateOf(error) === CHECK_VIOLATION) {
      return new ORPCError("CONFLICT", { message: direction.refusal });
    }

    return error;
  }
}
