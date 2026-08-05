// What a booking's stay is made of — `booking-state-machine.md` §5's first five
// rows: which room, which nights, and which type.
//
// None of these change the state, and that is the reason they are here rather
// than in `booking.service.ts`. §5 calls them "where most real front-desk work
// happens": a guest is confirmed for a Superior all week and the room they sleep
// in is decided the afternoon they arrive, changed when the shower fails,
// upgraded when the property is short, and given up two nights early when the
// meeting they came for ends. The booking is the same booking through all of it,
// so `state-machine.ts` is never consulted — what is consulted is the state the
// booking is *in*, because §5 gives each operation its own list of states it is
// legal from.
//
// **Only an extension touches the frozen quote.** §8 forbids a booking from
// re-deriving a price it was quoted, and every operation here honours it: the
// room, the type and a shortened departure all leave the agreed total alone. An
// extension cannot, because nights nobody sold have no frozen price to leave
// alone — so it prices those nights off the calendar, under the plan terms the
// booking already froze, and re-runs the one total over the whole stay. What it
// never does is re-read the plan or the tariff, which is the difference between
// pricing new nights and repricing sold ones.
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

import {
  nightCount,
  type Party,
  type RoomTypeCode,
  type StayDate,
  stayTotalGross,
  type VndAmount,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { parseDate } from "@internationalized/date";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import {
  booking,
  type BookingRow,
  bookingNight,
} from "../../database/schema/booking.js";
import {
  room,
  roomAssignment,
  type RoomAssignmentRow,
  roomType,
} from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { BusinessDateService } from "./business-date.service.js";
import { type PolicyCharge, policyCharge } from "./cancellation-calculator.js";
import { StayQuoteService } from "./stay-quote.service.js";

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
  readonly assignment: HeldRoom | null;
}

/**
 * The room a booking is in, as the row plus the number the desk speaks.
 *
 * The whole row and not the columns this file happens to read: `check-in.guard.ts`
 * takes a `RoomAssignmentRow`, and narrowing it here would put a shape between
 * the guard and the table it is a guard about.
 */
export interface HeldRoom {
  readonly row: RoomAssignmentRow;
  readonly roomNumber: string;
}

/** What a lengthened stay added, for the caller that has to report it. */
export interface ExtendedStay {
  readonly bookingId: string;
  readonly checkOut: StayDate;
  /** Nights added — zero when the stay already ran that far. */
  readonly nightsAdded: number;
  /** The agreed total, with the added nights in it. */
  readonly stayTotalGross: VndAmount;
  readonly assignment: RoomAssignment | null;
}

/** What an early departure gave back, and what §4's grid charges for it. */
export interface ShortenedStay {
  readonly bookingId: string;
  readonly checkOut: StayDate;
  /** Nights released — zero when the stay already ended there. */
  readonly nightsReleased: number;
  /**
   * §4's early-departure amount, computed and not stored.
   * `cancellation-calculator.ts` says why nothing here writes it anywhere: a
   * charge is a folio posting, and the folio is `M6`.
   */
  readonly charge: PolicyCharge;
  readonly assignment: RoomAssignment | null;
}

@Injectable()
export class AssignmentService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly businessDate: BusinessDateService,
    private readonly quotes: StayQuoteService,
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
        .where(eq(roomAssignment.id, current.assignment.row.id));
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
    if (from.toString() === current.assignment.row.checkInDate) {
      await exec
        .delete(roomAssignment)
        .where(eq(roomAssignment.id, current.assignment.row.id));
    } else {
      await exec
        .update(roomAssignment)
        .set({ checkOutDate: from.toString() })
        .where(eq(roomAssignment.id, current.assignment.row.id));
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
          ? this.asAssignment(current.assignment, input.bookingId)
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

      if (from.toString() === current.assignment.row.checkInDate) {
        await exec
          .delete(roomAssignment)
          .where(eq(roomAssignment.id, current.assignment.row.id));
      } else {
        await exec
          .update(roomAssignment)
          .set({ checkOutDate: from.toString() })
          .where(eq(roomAssignment.id, current.assignment.row.id));
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
   * §5's "extend stay" — the guest is staying on, and the property has to have
   * the nights.
   *
   * "Needs inventory for the added nights; fails cleanly" is the row's own note,
   * and §4 lists this operation in the inventory-available guard beside the two
   * creating transitions. So the added nights go through `InventoryService` like
   * any other sale and a full house refuses the extension rather than the
   * counter going past what the property owns.
   *
   * Only the departure moves. Pulling the arrival earlier would be a different
   * booking — an earlier night is one the funnel's restrictions and the arrival
   * guard were never asked about — and §5 words this row as "the added nights",
   * which are the ones after the stay as sold.
   *
   * The added nights are priced, and this is the one place in this file that
   * touches money. §8 freezes a booking's price so it is never re-derived, and
   * nights nobody has sold have nothing frozen: they take the calendar price of
   * the day the guest asked for them, under the plan percentage, breakfast
   * figure and extra-person rate the booking already carries. Reading the *plan*
   * again is what §8 forbids, and {@link retotal} is where that line is drawn.
   *
   * The room follows the nights. An extension whose room is taken by the next
   * arrival is refused by `room_assignment_no_double_booking`, as a `409` the
   * desk resolves by moving the guest first — never by quietly dropping the
   * assignment, which {@link changeRoomType} refuses to do for the same reason.
   */
  async extendStay(
    exec: DbExecutor,
    input: { bookingId: string; checkOut: StayDate },
  ): Promise<ExtendedStay> {
    const current = await this.lock(exec, input.bookingId);

    this.assertAssignable(current, "extend the stay of");

    const departure = parseDate(current.row.checkOutDate);

    if (input.checkOut.compare(departure) < 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `This stay already departs on ${current.row.checkOutDate} — giving nights back is an early departure, which §4's grid puts a charge on`,
      });
    }

    // Idempotent, for the reason every transition in `booking.service.ts` is: a
    // retried request arriving as the extension that already happened must not
    // reserve the nights a second time. Doing so would have the booking hold two
    // rooms of its type across the same dates and hold neither of them for
    // anybody who could sleep in it.
    if (input.checkOut.compare(departure) === 0) {
      return {
        bookingId: input.bookingId,
        checkOut: departure,
        nightsAdded: 0,
        stayTotalGross: current.row.quotedStayTotalGross,
        assignment: current.assignment
          ? this.asAssignment(current.assignment, input.bookingId)
          : null,
      };
    }

    const added = await this.quotes.calendarNights(
      exec,
      current.row.roomTypeId,
      departure,
      input.checkOut,
    );

    const moved = await this.inventory.reserve(exec, {
      roomType: current.roomTypeCode,
      checkIn: departure,
      checkOut: input.checkOut,
    });

    // `do nothing` on a night the booking already holds a price for, which is
    // reachable: an early departure keeps the rows of the nights it released,
    // because they are what §4's grid charges against. A guest who cuts the stay
    // short and then extends it again gets those nights back at the price they
    // were sold at rather than at today's — the same stay, not a resale.
    await exec
      .insert(bookingNight)
      .values(
        added.map((night) => ({
          bookingId: input.bookingId,
          stayDate: night.stayDate.toString(),
          standardGross: night.standardGross,
        })),
      )
      .onConflictDoNothing({
        target: [bookingNight.bookingId, bookingNight.stayDate],
      });

    const total = await this.retotal(exec, current.row, input.checkOut);

    await exec
      .update(booking)
      .set({
        checkOutDate: input.checkOut.toString(),
        quotedStayTotalGross: total,
        updatedAt: new Date(),
      })
      .where(eq(booking.id, input.bookingId));

    let assignment: RoomAssignment | null = null;

    if (current.assignment) {
      const held = current.assignment;

      await this.whileHolding(
        async () =>
          await exec
            .update(roomAssignment)
            .set({ checkOutDate: input.checkOut.toString() })
            .where(eq(roomAssignment.id, held.row.id)),
        `Room ${held.roomNumber} is held by somebody else across part of ${current.row.checkOutDate} to ${input.checkOut.toString()} — move the guest to a room that is free for the rest of the stay, then extend it`,
      );

      assignment = {
        id: held.row.id,
        bookingId: input.bookingId,
        roomNumber: held.roomNumber,
        checkIn: parseDate(held.row.checkInDate),
        checkOut: input.checkOut,
      };
    }

    return {
      bookingId: input.bookingId,
      checkOut: input.checkOut,
      nightsAdded: moved.nights,
      stayTotalGross: total,
      assignment,
    };
  }

  /**
   * §5's "shorten stay / early departure" — "releases nights, posts the
   * early-departure charge".
   *
   * `CHECKED_IN` only, which is §5's own column and not a narrowing of it. A
   * booking that has not arrived gives its nights back by being cancelled, and
   * §2 is emphatic that the two are different acts: the guest in the building
   * slept nights the property sold and cannot have them erased, which is why
   * `CHECKED_IN → CANCELLED` is a cell the table closes.
   *
   * The charge is returned and never written. §4's grid puts the remaining
   * nights at 50% on a refundable plan and at 100% on a `NONREF` one, and
   * `cancellation-calculator.ts` computes both from the *stored* per-night
   * prices — "the remaining nights at 50%" may not be approximated by dividing a
   * total by a count when a weekend night costs more than a Tuesday. Where the
   * number goes is `M6`'s; a service that stored it would be a second place for
   * a balance to live.
   *
   * So the released nights keep their `booking_night` rows. They are the basis
   * of the charge, and deleting them would destroy the number the folio has to
   * post and later explain — the same reason a cancellation and the night audit
   * leave them alone. The frozen total is left alone too: it is the record of
   * what was sold, and the difference between that and what is owed is the
   * charge, not a renegotiated price.
   */
  async shortenStay(
    exec: DbExecutor,
    input: { bookingId: string; checkOut: StayDate },
  ): Promise<ShortenedStay> {
    const current = await this.lock(exec, input.bookingId);

    if (current.row.state !== "CHECKED_IN") {
      throw new ORPCError("CONFLICT", {
        message: `An early departure is for a guest who is in the building — this booking is ${current.row.state}, so cancelling it is the operation`,
      });
    }

    const arrival = parseDate(current.row.checkInDate);
    const departure = parseDate(current.row.checkOutDate);
    const today = this.businessDate.current();

    if (input.checkOut.compare(departure) > 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `This stay departs on ${current.row.checkOutDate} — keeping the guest longer is an extension, which has to find the inventory for the added nights`,
      });
    }

    // A night the guest has slept cannot be given back. The counter would take
    // it — `type_inventory` knows nothing about who was in the room — and the
    // property would then be showing a night for sale that has already happened.
    if (input.checkOut.compare(today) < 0) {
      throw new ORPCError("CONFLICT", {
        message: `The business date is ${today.toString()} and this guest has slept the nights up to it — ${input.checkOut.toString()} is not a departure the property can still take back`,
      });
    }

    // `booking_covers_at_least_one_night` refuses the row that would follow, but
    // it would refuse it as a `23514` naming a constraint rather than as the
    // answer: a guest who is in the building slept the night they arrived.
    if (input.checkOut.compare(arrival) <= 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `This stay arrived on ${current.row.checkInDate}, so it cannot depart on ${input.checkOut.toString()} — a booking covers at least one night`,
      });
    }

    // Priced before anything moves, off the nights as sold. `nightsSpent` is the
    // count the new departure date implies, which is what an early departure
    // arranged in advance means — the calculator's own note asks for postings
    // instead, and that reading is `M6`'s, for the guest already standing at the
    // desk on the day. There are no postings to count at `M4`, and the two
    // answers differ only for a stay whose folio is missing a night.
    const charge = policyCharge({
      plan: current.row.ratePlanCode,
      checkInDate: arrival,
      nights: await this.soldNights(
        exec,
        current.row.id,
        current.row.checkInDate,
        current.row.checkOutDate,
      ),
      event: {
        kind: "EARLY_DEPARTURE",
        nightsSpent: nightCount({ checkIn: arrival, checkOut: input.checkOut }),
      },
    });

    let nightsReleased = 0;
    let assignment: RoomAssignment | null = current.assignment
      ? this.asAssignment(current.assignment, input.bookingId)
      : null;

    // Idempotent by arithmetic rather than by an early return: a request naming
    // the departure date the stay already has releases an empty range, and
    // `inventory.service.ts` refuses a movement of no nights. The charge above
    // is zero on that path by the same reasoning — there are no remaining nights
    // to charge for.
    if (input.checkOut.compare(departure) < 0) {
      nightsReleased = (
        await this.inventory.release(exec, {
          roomType: current.roomTypeCode,
          checkIn: input.checkOut,
          checkOut: departure,
        })
      ).nights;

      if (current.assignment) {
        const held = current.assignment;
        const heldFrom = parseDate(held.row.checkInDate);

        // The hold ends when the stay does. Left running to the original
        // departure date it would keep the room against
        // `room_assignment_no_double_booking` across nights the counter has just
        // put back on sale — the room unsellable and the type reading free. A
        // guest leaving the day they moved into this room leaves it holding no
        // night at all, which is the row
        // `room_assignment_covers_at_least_one_night` refuses.
        if (input.checkOut.compare(heldFrom) <= 0) {
          await exec
            .delete(roomAssignment)
            .where(eq(roomAssignment.id, held.row.id));

          assignment = null;
        } else {
          await exec
            .update(roomAssignment)
            .set({ checkOutDate: input.checkOut.toString() })
            .where(eq(roomAssignment.id, held.row.id));

          assignment = {
            id: held.row.id,
            bookingId: input.bookingId,
            roomNumber: held.roomNumber,
            checkIn: heldFrom,
            checkOut: input.checkOut,
          };
        }
      }

      await exec
        .update(booking)
        .set({ checkOutDate: input.checkOut.toString(), updatedAt: new Date() })
        .where(eq(booking.id, input.bookingId));
    }

    return {
      bookingId: input.bookingId,
      checkOut: input.checkOut,
      nightsReleased,
      charge,
      assignment,
    };
  }

  /**
   * The prices a booking stored for a range of its nights, in stay order.
   *
   * Bounded at both ends because the rows can outlast the range: an early
   * departure keeps the ones it released, so a stay shortened twice would
   * otherwise charge the second time for nights the first one already priced.
   */
  private async soldNights(
    exec: DbExecutor,
    bookingId: string,
    from: string,
    to: string,
  ): Promise<VndAmount[]> {
    const nights = await exec
      .select({ standardGross: bookingNight.standardGross })
      .from(bookingNight)
      .where(
        and(
          eq(bookingNight.bookingId, bookingId),
          gte(bookingNight.stayDate, from),
          lt(bookingNight.stayDate, to),
        ),
      )
      .orderBy(asc(bookingNight.stayDate));

    return nights.map((night) => night.standardGross);
  }

  /**
   * The agreed total, re-run over the nights the booking has stored.
   *
   * One `stayTotalGross` call over the whole stay and never one per part, which
   * is `property-and-tariff.md` §5: integer đồng means every division truncates,
   * so a total assembled by adding a separately-adjusted extension to a
   * separately-adjusted original would fail to match the nights it was built
   * from. `schema/booking.ts` states the invariant this protects — the stored
   * nights and the four frozen inputs reproduce this figure exactly — and an
   * extension is precisely where a careless total would break it.
   *
   * The three plan figures are the booking's own and are never re-read. That is
   * the whole of §8: they are the terms the guest agreed to, and a stay extended
   * after a manager edited the plan is still that guest's stay.
   */
  private async retotal(
    exec: DbExecutor,
    row: BookingRow,
    checkOut: StayDate,
  ): Promise<VndAmount> {
    const nights = await this.soldNights(
      exec,
      row.id,
      row.checkInDate,
      checkOut.toString(),
    );

    return stayTotalGross({
      standardTotal: nights.reduce<VndAmount>(
        (total, night) => total + night,
        0n,
      ),
      percentAdjustment: row.quotedPercentAdjustment,
      breakfastPerPersonGross: row.quotedBreakfastPerPersonGross,
      extraPersonPerNightGross: row.quotedExtraPersonPerNightGross,
      nights: nights.length,
      party: this.partyOf(row),
    });
  }

  /**
   * The party the booking was quoted for, as `occupancy-pricing.ts` takes it.
   *
   * Ages and not a count, because §3 prices children in three bands — the same
   * reason `schema/booking.ts` stores the array rather than a head count.
   */
  private partyOf(row: BookingRow): Party {
    return {
      adults: row.adults,
      children: row.childAges.map((age) => ({ age })),
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

    return {
      row: row.booking,
      roomTypeCode: row.roomTypeCode,
      assignment: await this.current(exec, bookingId),
    };
  }

  /**
   * The room a booking is in *now*, or null when it holds none.
   *
   * `closure_reason is null` is what separates a guest's room from a room
   * withdrawn for a leaking pipe. Both are rows in this table —
   * `schema/inventory.ts` says why they must be — and only the first is a room
   * the booking is in.
   *
   * Public because check-in reads it too: §4's room requirement is asked of the
   * same row this file writes, and a second query spelling the ordering below
   * would be a second chance to spell it differently.
   */
  async current(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<HeldRoom | null> {
    const [held] = await exec
      .select({ row: roomAssignment, roomNumber: room.number })
      .from(roomAssignment)
      .innerJoin(room, eq(room.id, roomAssignment.roomId))
      .where(
        and(
          eq(roomAssignment.bookingId, bookingId),
          isNull(roomAssignment.closureReason),
        ),
      )
      // The room the booking is in now, and not the rooms it has been in. A
      // stay that has been moved holds a closed-off row for every earlier room,
      // so the latest arrival is the live one — ordered the other way, this
      // would move a guest out of a room they left on Tuesday.
      .orderBy(desc(roomAssignment.checkInDate))
      .limit(1);

    return held ?? null;
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

  /**
   * Writes the hold, and lets Postgres refuse a room that is already taken.
   *
   * Public because a reinstated no-show writes one too. §2's `NO_SHOW →
   * CHECKED_IN` "fails if the room was resold", and this refusal is what that
   * sentence is about — an `insert` spelled a second time in
   * `booking.service.ts` would be a second chance to leave the `23P01`
   * unmapped, and an unmapped exclusion violation reaches the desk as a `500`
   * for a room that is simply occupied.
   */
  async hold(
    exec: DbExecutor,
    values: {
      bookingId: string;
      roomId: string;
      roomNumber: string;
      checkInDate: string;
      checkOutDate: string;
    },
  ): Promise<RoomAssignment> {
    const [held] = await this.whileHolding(
      async () =>
        await exec
          .insert(roomAssignment)
          .values({
            roomId: values.roomId,
            bookingId: values.bookingId,
            checkInDate: values.checkInDate,
            checkOutDate: values.checkOutDate,
          })
          .returning({ id: roomAssignment.id }),
      `Room ${values.roomNumber} is already held across part of ${values.checkInDate} to ${values.checkOutDate}`,
    );

    return {
      id: held!.id,
      bookingId: values.bookingId,
      roomNumber: values.roomNumber,
      checkIn: parseDate(values.checkInDate),
      checkOut: parseDate(values.checkOutDate),
    };
  }

  /**
   * Runs a write against `room_assignment` and turns the one refusal it expects
   * into an answer.
   *
   * A 409 and not a 500, for the reason `closure.service.ts` gives: the room is
   * genuinely taken — by another guest, or by a closure — and the desk resolves
   * it by choosing a different room. §5's "never moves a different checked-in
   * guest" is this line.
   *
   * Shared by the insert and by the extension's update, because the constraint
   * does not care which statement reached it: lengthening a hold over the next
   * arrival's nights collides exactly as writing a new one over them does, and a
   * second spelling of the mapping is how one of the two comes to be missing it.
   * The message is the caller's, because what the desk should do next differs —
   * pick another room, or move the guest and then extend.
   */
  private async whileHolding<T>(
    write: () => Promise<T>,
    refusal: string,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (sqlStateOf(error) === EXCLUSION_VIOLATION) {
        throw new ORPCError("CONFLICT", { message: refusal });
      }

      throw error;
    }
  }

  /** An assignment already in hand, in the shape a caller reads. */
  private asAssignment(held: HeldRoom, bookingId: string): RoomAssignment {
    return {
      id: held.row.id,
      bookingId,
      roomNumber: held.roomNumber,
      checkIn: parseDate(held.row.checkInDate),
      checkOut: parseDate(held.row.checkOutDate),
    };
  }
}

