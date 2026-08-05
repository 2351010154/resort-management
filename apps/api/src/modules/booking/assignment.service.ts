// Which physical room a booking gets — `booking-state-machine.md` §5's first,
// second and fifth rows.
//
// None of these change the state, and that is the reason they are here rather
// than in `booking.service.ts`. §5 calls them "where most real front-desk work
// happens": a guest is confirmed for a Superior all week and the room they sleep
// in is decided the afternoon they arrive, changed when the shower fails, and
// upgraded when the property is short. The booking is the same booking through
// all of it, so `state-machine.ts` is never consulted — what is consulted is the
// state the booking is *in*, because §5 gives each operation its own list of
// states it is legal from.
//
// **The exclusion constraint is not re-derived here.** `schema/inventory.ts`
// spells out `EXCLUDE USING gist (room_id WITH =, daterange(...) WITH &&)`, and
// §5's note on the first row — "never moves a different checked-in guest" — is
// that constraint doing its work rather than a check this file performs. The
// same argument `check-in.guard.ts` makes about the other half of §4's room
// requirement applies with more force here, because this is the file that writes
// the row: a `select` that finds room 304 free is a fact that stops being true
// before the `insert` that acts on it, so the row is written and Postgres
// refuses the one that would put two guests in it.
//
// **It does not open a transaction.** Same reason `booking.service.ts` does not
// — a room type change moves two inventory counters and rewrites an assignment,
// and only the caller can draw a boundary around all of it. The
// `TransactionRunner` sits at the controller.
//
// **It does not reprice.** §5 files "Change rate" as a separate operation with
// its own capability, and `rbac-matrix.md` gives it to `MANAGER` because pricing
// below the plan is a commercial decision. So a Superior upgraded to a Deluxe
// moves the inventory and keeps the quoted total the guest was given: the room
// they sleep in changed, what they agreed to pay did not. Charging for the
// upgrade is the rate operation, deliberately, and a type change that quietly
// repriced would be that manager-only decision taken by a receptionist.

import { nightCount, type RoomTypeCode, type StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { parseDate } from "@internationalized/date";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking, type BookingRow } from "../../database/schema/booking.js";
import {
  room,
  roomAssignment,
  roomType,
} from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { BusinessDateService } from "./business-date.service.js";

/** Postgres' SQLSTATE for the refusal every write in this file expects. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * The states §5 makes room work legal from.
 *
 * `HELD` is absent on purpose and `inventory.service.ts` argues why at length: a
 * held booking has no room, because picking one before the deposit is taken
 * would have two guests racing for a physical key while the type still has
 * stock. The terminal states are absent because there is nothing left to decide
 * — a departed guest's room is history, and a cancelled booking holds nothing.
 */
const ASSIGNABLE_STATES = ["CONFIRMED", "CHECKED_IN"] as const;

/** A room held for a booking, as the rest of the application sees it. */
export interface RoomAssignment {
  readonly id: string;
  readonly bookingId: string;
  readonly roomNumber: string;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
}

/** What a type change moved, for the caller that has to report it. */
export interface RoomTypeChange {
  readonly bookingId: string;
  readonly from: RoomTypeCode;
  readonly to: RoomTypeCode;
  readonly nights: number;
  /** The room now held — null when the booking had none to move. */
  readonly assignment: RoomAssignment | null;
}

/** The booking, its type's code, and the room it currently holds. */
interface LockedBooking {
  readonly row: BookingRow;
  readonly roomTypeCode: RoomTypeCode;
  readonly assignment: AssignmentRow | null;
}

/** The columns of an assignment this file decides from. */
interface AssignmentRow {
  readonly id: string;
  readonly roomId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
}

@Injectable()
export class AssignmentService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly businessDate: BusinessDateService,
  ) {}

  /**
   * §5's "assign / reassign room" — gives a booking the room it will occupy.
   *
   * Legal from `CONFIRMED` and `CHECKED_IN`, and the second is only reachable by
   * a booking that somehow lost its room: `check-in.guard.ts` refuses the
   * transition without one, so a checked-in stay arrives here already assigned
   * and is sent to {@link move} instead. That refusal is the whole difference
   * between the two methods — a guest who is in the building has slept in the
   * room they are leaving, and §5's second row keeps that night rather than
   * overwriting it.
   *
   * The room must be of the type the booking was sold. A Superior booking handed
   * a Deluxe key would leave the two layers `schema/inventory.ts` describes
   * disagreeing: the Deluxe counter says one is free while the room is occupied,
   * and the Superior counter says one is sold while every Superior is empty.
   * Giving the guest a different type is {@link changeRoomType}, which moves the
   * counters with the key.
   */
  async assign(
    exec: DbExecutor,
    input: { bookingId: string; roomNumber: string },
  ): Promise<RoomAssignment> {
    const current = await this.lock(exec, input.bookingId);

    this.assertAssignable(current, "assign a room to");

    if (current.assignment && current.row.state === "CHECKED_IN") {
      throw new ORPCError("CONFLICT", {
        message:
          "This guest is already in a room — moving them to another one is a room move, which keeps the nights they have already slept",
      });
    }

    const target = await this.roomOfType(
      exec,
      input.roomNumber,
      current.row.roomTypeId,
      current.roomTypeCode,
    );

    // A reassignment before arrival replaces the row outright rather than
    // closing it. Nobody has occupied the old room, so there is no night to
    // keep, and a closed-off row covering no nights is the one thing
    // `room_assignment_covers_at_least_one_night` refuses.
    if (current.assignment) {
      await exec
        .delete(roomAssignment)
        .where(eq(roomAssignment.id, current.assignment.id));
    }

    return await this.hold(exec, {
      bookingId: input.bookingId,
      roomId: target.id,
      roomNumber: input.roomNumber,
      checkInDate: current.row.checkInDate,
      checkOutDate: current.row.checkOutDate,
    });
  }

  /**
   * §5's "room move" — a checked-in guest changes rooms mid-stay.
   *
   * "New assignment row; old one closed at today's date", which is the row's
   * own note and is a statement about history rather than about bookkeeping.
   * The guest slept in 304 on Tuesday and in 512 on Wednesday, and both of those
   * are true: the folio charges the nights, housekeeping cleans both rooms, and
   * a single row rewritten to say 512 would claim nobody was ever in 304.
   *
   * Today's date is the property's, never the calendar's —
   * `business-date.service.ts` for the 04:00 rollover that makes a move logged
   * at 01:30 belong to the night that has not been audited yet.
   */
  async move(
    exec: DbExecutor,
    input: { bookingId: string; roomNumber: string },
  ): Promise<RoomAssignment> {
    const current = await this.lock(exec, input.bookingId);

    if (current.row.state !== "CHECKED_IN") {
      throw new ORPCError("CONFLICT", {
        message: `A room move is for a guest who is in the building — this booking is ${current.row.state}, so assigning a room is the operation`,
      });
    }

    if (!current.assignment) {
      throw new ORPCError("CONFLICT", {
        message:
          "This booking holds no room, so there is nothing to move out of — assign one instead",
      });
    }

    const target = await this.roomOfType(
      exec,
      input.roomNumber,
      current.row.roomTypeId,
      current.roomTypeCode,
    );

    const from = this.moveDate(current);

    // The old row keeps every night up to the move and stops there. When the
    // move lands on the night the guest arrived — the room was wrong the moment
    // they opened the door, which is the ordinary case rather than an edge — it
    // keeps nothing, and the row is deleted instead of being closed at its own
    // start date. `room_assignment_covers_at_least_one_night` refuses that row,
    // and rightly: a stay of no nights is the one hold the exclusion constraint
    // cannot see, so it would sit against the room colliding with nothing.
    if (from.toString() === current.assignment.checkInDate) {
      await exec
        .delete(roomAssignment)
        .where(eq(roomAssignment.id, current.assignment.id));
    } else {
      await exec
        .update(roomAssignment)
        .set({ checkOutDate: from.toString() })
        .where(eq(roomAssignment.id, current.assignment.id));
    }

    return await this.hold(exec, {
      bookingId: input.bookingId,
      roomId: target.id,
      roomNumber: input.roomNumber,
      checkInDate: from.toString(),
      checkOutDate: current.row.checkOutDate,
    });
  }

  /**
   * §5's "change room type (upgrade)" — "inventory moves between types
   * atomically".
   *
   * Atomically is the caller's transaction, and it is what makes the operation
   * safe rather than a pair of movements that can half-happen: a release that
   * committed without its reserve would hand the property a Superior back and
   * sell a Deluxe it does not have.
   *
   * The reserve runs first. Both directions roll back together either way, so
   * the order is not a correctness argument but a diagnostic one — a booking
   * that cannot be upgraded because every Deluxe is sold should be refused by
   * the counter that is actually full, and `inventory.service.ts` words that
   * refusal for the type it was asked about.
   *
   * The whole stay moves, not the nights that are left. The booking is sold as
   * one type for one range — `schema/booking.ts` holds a single `room_type_id`
   * — so a stay half-counted against each type would be a booking neither
   * counter could report on. A guest upgraded on Wednesday was in a Deluxe for
   * the week as far as the property's numbers are concerned.
   */
  async changeRoomType(
    exec: DbExecutor,
    input: {
      bookingId: string;
      roomType: RoomTypeCode;
      /** Required when the booking already holds a room — see below. */
      roomNumber?: string;
    },
  ): Promise<RoomTypeChange> {
    const current = await this.lock(exec, input.bookingId);

    this.assertAssignable(current, "change the room type of");

    const checkIn = parseDate(current.row.checkInDate);
    const checkOut = parseDate(current.row.checkOutDate);

    // Idempotent, and for the same reason every transition in
    // `booking.service.ts` is: a retried request or a double-clicked button
    // arriving as the change that already happened must not move the counters a
    // second time. Doing so would sell the property a room it never had and
    // release one it never sold.
    if (input.roomType === current.roomTypeCode) {
      return {
        bookingId: input.bookingId,
        from: current.roomTypeCode,
        to: input.roomType,
        nights: nightCount({ checkIn, checkOut }),
        assignment: current.assignment
          ? await this.asAssignment(exec, current.assignment, input.bookingId)
          : null,
      };
    }

    const [target] = await exec
      .select({ id: roomType.id })
      .from(roomType)
      .where(eq(roomType.code, input.roomType))
      .limit(1);

    if (!target) {
      throw new ORPCError("NOT_FOUND", {
        message: `No room type coded ${input.roomType}`,
      });
    }

    // A room of the old type cannot stay held by a booking that is no longer
    // sold as that type — the disagreement {@link assign} refuses on the way in.
    // So the caller names the room the guest is moving to, and the alternative
    // is worse than an argument: silently dropping the assignment would leave a
    // checked-in guest holding no room at all, which `check-in.guard.ts` treats
    // as a booking that may not be in the building.
    if (current.assignment && !input.roomNumber) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This booking holds a room of the type it is being changed from — name the room of the new type the guest is moving to",
      });
    }

    const moved = await this.inventory.reserve(exec, {
      roomType: input.roomType,
      checkIn,
      checkOut,
    });

    await this.inventory.release(exec, {
      roomType: current.roomTypeCode,
      checkIn,
      checkOut,
    });

    await exec
      .update(booking)
      .set({ roomTypeId: target.id, updatedAt: new Date() })
      .where(eq(booking.id, input.bookingId));

    let assignment: RoomAssignment | null = null;

    if (current.assignment && input.roomNumber) {
      const newRoom = await this.roomOfType(
        exec,
        input.roomNumber,
        target.id,
        input.roomType,
      );

      // The same split {@link move} makes, and for the same reason: a guest in
      // the building keeps the nights they slept in the old room, and one who
      // has not arrived leaves nothing behind.
      const from =
        current.row.state === "CHECKED_IN"
          ? this.moveDate(current)
          : checkIn;

      if (from.toString() === current.assignment.checkInDate) {
        await exec
          .delete(roomAssignment)
          .where(eq(roomAssignment.id, current.assignment.id));
      } else {
        await exec
          .update(roomAssignment)
          .set({ checkOutDate: from.toString() })
          .where(eq(roomAssignment.id, current.assignment.id));
      }

      assignment = await this.hold(exec, {
        bookingId: input.bookingId,
        roomId: newRoom.id,
        roomNumber: input.roomNumber,
        checkInDate: from.toString(),
        checkOutDate: current.row.checkOutDate,
      });
    }

    return {
      bookingId: input.bookingId,
      from: current.roomTypeCode,
      to: input.roomType,
      nights: moved.nights,
      assignment,
    };
  }

  /**
   * The booking and its room, locked for the rest of the transaction.
   *
   * `for update` for the reason `booking.service.ts` gives: two requests
   * assigning rooms to one booking would otherwise both read it unassigned,
   * both pass the check above and both write a row, leaving the stay holding two
   * keys. The exclusion constraint would not catch it — the rooms are different,
   * so the two holds do not overlap.
   *
   * `of booking` keeps the lock off the joined `room_type`, which is read for
   * its code and is not being decided about.
   */
  private async lock(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<LockedBooking> {
    const [row] = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(eq(booking.id, bookingId))
      .limit(1)
      .for("update", { of: booking });

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "No booking with that id" });
    }

    // `closure_reason is null` is what separates a guest's room from a room
    // withdrawn for a leaking pipe. Both are rows in this table —
    // `schema/inventory.ts` says why they must be — and only the first is this
    // booking's to move.
    const [assignment] = await exec
      .select({
        id: roomAssignment.id,
        roomId: roomAssignment.roomId,
        checkInDate: roomAssignment.checkInDate,
        checkOutDate: roomAssignment.checkOutDate,
      })
      .from(roomAssignment)
      .where(
        and(
          eq(roomAssignment.bookingId, bookingId),
          isNull(roomAssignment.closureReason),
        ),
      )
      // The row the booking is in *now*, and not the rooms it has been in. A
      // stay that has been moved holds a closed-off row for every earlier room,
      // so the latest arrival is the live one — ordered the other way, this
      // would move a guest out of a room they left on Tuesday.
      .orderBy(desc(roomAssignment.checkInDate))
      .limit(1);

    return {
      row: row.booking,
      roomTypeCode: row.roomTypeCode,
      assignment: assignment ?? null,
    };
  }

  /** §5's legality column, as a refusal that names what was attempted. */
  private assertAssignable(current: LockedBooking, attempt: string): void {
    if (
      !ASSIGNABLE_STATES.includes(
        current.row.state as (typeof ASSIGNABLE_STATES)[number],
      )
    ) {
      throw new ORPCError("CONFLICT", {
        message: `Cannot ${attempt} a booking that is ${current.row.state}`,
      });
    }
  }

  /**
   * The room, refused unless it is of the type the booking is sold as.
   *
   * A name resolved into an id, which is the read `inventory.service.ts` argues
   * is legitimate before a write: it asks nothing about availability, so there
   * is no answer here a concurrent request can invalidate. Whether the room is
   * *free* is not asked at all — that is the exclusion constraint's, on the
   * insert.
   */
  private async roomOfType(
    exec: DbExecutor,
    roomNumber: string,
    roomTypeId: string,
    roomTypeCode: RoomTypeCode,
  ): Promise<{ id: string }> {
    const [found] = await exec
      .select({ id: room.id, roomTypeId: room.roomTypeId })
      .from(room)
      .where(eq(room.number, roomNumber))
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message: `No room numbered ${roomNumber}`,
      });
    }

    if (found.roomTypeId !== roomTypeId) {
      throw new ORPCError("CONFLICT", {
        message: `Room ${roomNumber} is not a ${roomTypeCode} — changing what the guest is sold is a room type change, which moves the inventory with the key`,
      });
    }

    return { id: found.id };
  }

  /**
   * The date a move takes effect: today, or the arrival date when the property
   * admitted the guest before it.
   *
   * Early check-in is §7's first ⚑, so a `CHECKED_IN` booking whose arrival date
   * has not come round yet is a state the property can reach on purpose. Closing
   * the old row at today's date would then write a departure before its own
   * arrival, which is a row `room_assignment_covers_at_least_one_night` refuses
   * — correctly, and with a message about nights that would tell nobody why.
   */
  private moveDate(current: LockedBooking): StayDate {
    const today = this.businessDate.current();
    const arrival = parseDate(current.row.checkInDate);
    const from = today.compare(arrival) > 0 ? today : arrival;

    if (from.compare(parseDate(current.row.checkOutDate)) >= 0) {
      throw new ORPCError("CONFLICT", {
        message: `This stay departs on ${current.row.checkOutDate} and the business date is ${today.toString()} — there is no night left to move the guest into`,
      });
    }

    return from;
  }

  /** Writes the hold, and lets Postgres refuse a room that is already taken. */
  private async hold(
    exec: DbExecutor,
    values: {
      bookingId: string;
      roomId: string;
      roomNumber: string;
      checkInDate: string;
      checkOutDate: string;
    },
  ): Promise<RoomAssignment> {
    try {
      const [held] = await exec
        .insert(roomAssignment)
        .values({
          roomId: values.roomId,
          bookingId: values.bookingId,
          checkInDate: values.checkInDate,
          checkOutDate: values.checkOutDate,
        })
        .returning({ id: roomAssignment.id });

      return {
        id: held!.id,
        bookingId: values.bookingId,
        roomNumber: values.roomNumber,
        checkIn: parseDate(values.checkInDate),
        checkOut: parseDate(values.checkOutDate),
      };
    } catch (error) {
      // A 409 and not a 500, for the reason `closure.service.ts` gives: the room
      // is genuinely taken — by another guest, or by a closure — and the desk
      // resolves it by choosing a different room. §5's "never moves a different
      // checked-in guest" is this line.
      if (sqlStateOf(error) === EXCLUSION_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          message: `Room ${values.roomNumber} is already held across part of ${values.checkInDate} to ${values.checkOutDate}`,
        });
      }

      throw error;
    }
  }

  /** An assignment already in hand, in the shape a caller reads. */
  private async asAssignment(
    exec: DbExecutor,
    assignment: AssignmentRow,
    bookingId: string,
  ): Promise<RoomAssignment> {
    const [held] = await exec
      .select({ number: room.number })
      .from(room)
      .where(eq(room.id, assignment.roomId))
      .limit(1);

    return {
      id: assignment.id,
      bookingId,
      roomNumber: held!.number,
      checkIn: parseDate(assignment.checkInDate),
      checkOut: parseDate(assignment.checkOutDate),
    };
  }
}

