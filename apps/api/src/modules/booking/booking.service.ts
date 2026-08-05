// Taking a booking, confirming it and giving it back — `FR-BOOK-01`,
// `FR-BOOK-02`, and the first four cells of `booking-state-machine.md` §2.
//
// Everything here is one shape: read the current state, ask the table in
// `state-machine.ts` whether the move is allowed, apply §3's inventory effect,
// then write the row. What makes it correct is what it does NOT do.
//
// **It does not open a transaction.** `database.module.ts` says why a write
// takes its executor: a transition consumes inventory, writes a booking and its
// nights, and at `M6` will post a folio line and record a payment beside them.
// All of that is one commit, and only the caller can draw a boundary that wide.
// The `TransactionRunner` sits at the controller.
//
// **It does not touch `type_inventory`.** Every night consumed or released goes
// through `InventoryService`, which is the only path that takes the row locks in
// stay-date order and lets `type_inventory_sold_at_most_total` refuse an
// oversell. `NFR-01` is a claim about fifty simultaneous requests, and a second
// path to the counter is how that claim quietly stops being true.
//
// **It does not check-then-write.** The reference's uniqueness is the unique
// index's to enforce, the cancellation reason's presence is a `CHECK`'s, and a
// sold-out night is the counter's. This reads their answers rather than
// anticipating them.
//
// Idempotency is a guard and not an error — §4. A retried request, a
// double-clicked button and a job that ran twice all arrive as the transition
// that already happened, and each returns the current state without repeating
// the effect. That last part is the whole of it: a second `cancel` that answered
// politely and released the nights again would credit the property with
// inventory it never sold.
//
// Check-in and check-out are here and the operations of §5 are not, which is the
// line §5 itself draws: those change no state and are `assignment.service.ts`'s.
// These two do, and each is the transition plus the effects §3 gives it — so
// they read a business date, an assignment, a housekeeping status and a folio
// balance, and hand each answer to the pure guard that judges it. The guards
// stay pure and this file stays the one place a booking's state changes.

import { parseDate } from "@internationalized/date";
import {
  type BookingState,
  type CancellationReason,
  type Party,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, eq, isNull } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import {
  booking,
  type BookingRow,
  bookingNight,
} from "../../database/schema/booking.js";
import { registration } from "../../database/schema/guest.js";
import { roomAssignment, roomType } from "../../database/schema/inventory.js";
import { GuestService, type NewGuest } from "../guest/guest.service.js";
import { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { AssignmentService, type HeldRoom } from "./assignment.service.js";
import { BusinessDateService } from "./business-date.service.js";
import {
  validateArrivalWindow,
  validateRoomAssigned,
  validateRoomReady,
} from "./guards/check-in.guard.js";
import { validateFolioSettled } from "./guards/check-out.guard.js";
import { FOLIO_PORT, type FolioPort } from "./ports/folio.port.js";
import { applyTransition } from "./state-machine.js";
import { retryOnCollision } from "./reference-generator.js";
import { assertFunnelMaySell } from "./stay-restriction-guard.js";
import { StayQuoteService } from "./stay-quote.service.js";

const MS_PER_MINUTE = 60_000;

/** What a stay is sold as. The price is not in here — see `stay-quote.service.ts`. */
export interface CreateBookingInput {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly party: Party;
}

/**
 * A booking as the rest of the application sees it.
 *
 * Dates come back as `StayDate` and not as the ISO text the column holds —
 * `NFR-12`, and the same crossing `closure.service.ts` performs. The controller
 * encodes them for the wire, once, where it can be seen.
 */
export interface Booking {
  readonly id: string;
  readonly reference: string;
  readonly state: BookingState;
  readonly cancellationReason: CancellationReason | null;
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly adults: number;
  readonly childAges: readonly number[];
  readonly stayTotalGross: VndAmount;
  /** Set only while the booking is `HELD`. */
  readonly holdExpiresAt: Date | null;
}

/**
 * A reference the unique index already holds.
 *
 * Not exported, because it never leaves the retry loop below. It exists so that
 * `retryOnCollision` — which is written around a thrown error — can be driven by
 * an insert that deliberately does not throw one. See {@link BookingService}'s
 * `create` for why the insert cannot.
 */
class ReferenceTaken extends Error {
  constructor(reference: string) {
    super(`booking reference ${reference} is already issued`);
    this.name = "ReferenceTaken";
  }
}

/**
 * Somebody to register at check-in: a person the property has met before, or a
 * record it is creating now.
 *
 * Both, because the property genuinely has both. A returning guest already has
 * a row — `guest.ts` refuses a second one carrying the same CCCD, and rightly —
 * so a check-in that could only create would turn every repeat visit into a
 * duplicate-number conflict at the desk. Discriminated by the presence of an id
 * rather than by a tag field: `NewGuest` requires a name and this does not have
 * one, so the two shapes cannot be confused by a caller or by the compiler.
 */
export type CheckInGuest = { readonly guestId: string } | NewGuest;

@Injectable()
export class BookingService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly quotes: StayQuoteService,
    private readonly businessDate: BusinessDateService,
    private readonly assignments: AssignmentService,
    private readonly guests: GuestService,
    private readonly housekeeping: HousekeepingService,
    @Inject(FOLIO_PORT) private readonly folio: FolioPort,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The public funnel's booking — §2's *(new)* → `HELD`, with a TTL running.
   *
   * `FR-BOOK-02` gives only the funnel this door. The nights are consumed in
   * full at this point and not at payment, because a hold that did not consume
   * them would be a room two guests could reach the payment step for.
   *
   * This is also the only door the property's stay restrictions close.
   * `stay-restriction-guard.ts` argues the split at length: the funnel obeys the
   * published minimum stay and the closed dates, and the desk below overrides
   * them the way a desk does.
   */
  async createHold(
    exec: DbExecutor,
    input: CreateBookingInput,
  ): Promise<Booking> {
    await assertFunnelMaySell(exec, input);

    return await this.create(exec, input, "HELD");
  }

  /**
   * The front desk's booking — §2's *(new)* → `CONFIRMED`, no TTL.
   *
   * A walk-in or a phone reservation is confirmed by the person taking it, so
   * there is nothing for a sweep to expire and
   * `booking_hold_expiry_exactly_when_held` refuses an expiry on it.
   *
   * Stay restrictions are deliberately not applied here — see `createHold`. What
   * still binds this path is everything the property cannot physically do: the
   * room type's occupancy, a priced calendar, and the arrival guard in `create`.
   */
  async createConfirmed(
    exec: DbExecutor,
    input: CreateBookingInput,
  ): Promise<Booking> {
    return await this.create(exec, input, "CONFIRMED");
  }

  /**
   * `HELD` → `CONFIRMED` — §3, and the one transition that moves no inventory.
   *
   * The nights were consumed when the hold was taken. Reserving them again here
   * would sell the stay twice to the guest who was already holding it.
   */
  async confirm(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CONFIRMED");

    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    // The expiry goes with the state. A confirmed stay carrying a stale TTL is
    // a date the sweep could act on, and what it would do with it is cancel a
    // room the property has sold.
    const [confirmed] = await exec
      .update(booking)
      .set({ state: next, holdExpiresAt: null, updatedAt: new Date() })
      .where(eq(booking.id, bookingId))
      .returning();

    return this.asBooking({
      booking: confirmed!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * `HELD` or `CONFIRMED` → `CANCELLED`, releasing every night — §3.
   *
   * One method for both rows of the table, because §3 gives them one inventory
   * effect and different reason codes. An expired hold arrives here from the TTL
   * sweep carrying `HOLD_EXPIRED`; a guest arrives carrying `GUEST_REQUEST`.
   *
   * `CHECKED_IN` → `CANCELLED` is refused by the table above, on purpose: the
   * guest is in the building and the stay happened. Shortening it is an early
   * departure, which is §5's and posts a policy charge.
   *
   * The refund is not computed here. `cancellation-calculator.ts` prices §4's
   * grid and persists nothing, and `refund.policy` and `refund.override` are two
   * endpoints with two capabilities — a service that returned an amount from the
   * cancellation itself would collapse them into one.
   */
  async cancel(
    exec: DbExecutor,
    bookingId: string,
    reason: CancellationReason,
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CANCELLED");

    // §4's idempotency guard, and the release is what makes it matter. A second
    // cancellation that answered politely and put the nights back again would
    // credit the property with inventory it never sold — the row would then read
    // as availability that does not exist, which is the refusal
    // `type_inventory_sold_not_negative` is there to catch when it goes further.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    await this.inventory.release(exec, {
      roomType: current.roomTypeCode,
      checkIn: parseDate(current.booking.checkInDate),
      checkOut: parseDate(current.booking.checkOutDate),
    });

    // The second row a cancellation has to close, now that `assignment.service.ts`
    // writes them. An assignment left behind holds its room against
    // `room_assignment_no_double_booking`, so the room could be given to nobody
    // else and would read as occupied on the housekeeping board for a stay that
    // is not happening — the counter saying the room is free and the exclusion
    // constraint saying it is taken.
    //
    // Deleted rather than closed off. A cancelled stay slept no night, so there
    // is no history to keep and no row that could cover one; the guest never
    // arrived, which is the whole difference from a check-out.
    await this.releaseRooms(exec, bookingId);

    const [cancelled] = await exec
      .update(booking)
      .set({
        state: next,
        cancellationReason: reason,
        // A cancelled hold no longer holds anything, and
        // `booking_hold_expiry_exactly_when_held` refuses the row that kept its
        // expiry.
        holdExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(booking.id, bookingId))
      .returning();

    return this.asBooking({
      booking: cancelled!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * `CONFIRMED` → `CHECKED_IN` — the guest is in the building.
   *
   * All three of §4's guards run, in the order §4 lists them, and the order is
   * not cosmetic: it is the order the desk can act on. A stay that is a day
   * early is refused for being early rather than for the room not being ready,
   * because sending a housekeeper to a room the guest may not have yet is work
   * nobody needed. The room is then required before its condition is asked
   * about, since there is no status to read without one.
   *
   * §3's other effect is the registration record, and §1 files it as a property
   * of the state rather than as a later step: `CHECKED_IN` is the row whose
   * "registration" column reads **Yes**. It is written in this transaction for
   * the reason `guest.module.ts` gives — a stay that moved to `CHECKED_IN` and
   * failed to record who is in the room would be a statutory residence record
   * with a hole in it.
   *
   * The housekeeping status is read and not written. §3 gives check-in no
   * housekeeping effect, and that is right: the room was `CLEAN` before the
   * guest walked in and it is `CLEAN` after. It stops being clean when they
   * leave, which is {@link checkOut}'s line.
   */
  async checkIn(
    exec: DbExecutor,
    input: {
      bookingId: string;
      /** At least one, and the first is the booking holder — see below. */
      guests: readonly CheckInGuest[];
    },
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, input.bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_IN");

    // §4's idempotency row. A double-clicked button must not register the same
    // party twice — `registration_booking_guest_key` would refuse the second
    // row, but as a constraint violation rather than as the polite answer §4
    // asks for.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    await this.admissible(exec, current);

    return await this.admit(exec, current, input.guests);
  }

  /**
   * `CONFIRMED` → `NO_SHOW` — the guest never came.
   *
   * §3 releases "the nights **after** the arrival night" and keeps that first
   * one, which is not an arbitrary split: the no-show charge is levied against
   * it, and a night the property is charging for is a night it has not resold.
   * The rest go back on sale, because nobody is coming for them.
   *
   * The room follows the counter. The hold is cut back to the arrival night for
   * the reason `checkOut` cuts it back on an early departure — a room still held
   * to the original departure date across nights the counter now reads as free
   * is a room nothing can be given, on a board that shows it occupied.
   *
   * When the charge is levied is not decided here, and the amount is not
   * computed here. §3 has the night audit write this transition and
   * `cancellation-calculator.ts` says why no money is persisted from a state
   * change — `D3` in `plans/backlog.md` still owes the no-show amount itself.
   */
  async markNoShow(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "NO_SHOW");

    // §4's idempotency row. A sweep that ran twice over the same night must not
    // release the remaining nights twice — `type_inventory_sold_not_negative`
    // would catch it as a fault, and by then the counter has already lied.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    const arrival = parseDate(current.booking.checkInDate);
    const departure = parseDate(current.booking.checkOutDate);
    const afterArrival = arrival.add({ days: 1 });

    // A one-night stay has nothing after its arrival night, so the release is
    // skipped rather than asked for an empty range — `inventory.service.ts`
    // refuses a movement of no nights, and rightly.
    if (afterArrival.compare(departure) < 0) {
      await this.inventory.release(exec, {
        roomType: current.roomTypeCode,
        checkIn: afterArrival,
        checkOut: departure,
      });

      await exec
        .update(roomAssignment)
        .set({ checkOutDate: afterArrival.toString() })
        .where(
          and(
            eq(roomAssignment.bookingId, bookingId),
            isNull(roomAssignment.closureReason),
          ),
        );
    }

    return await this.setState(exec, current, next);
  }

  /**
   * `NO_SHOW` → `CHECKED_IN` — the guest landed at 02:00 after all.
   *
   * §2 calls this an ordinary event rather than a data-entry error, and §3 gives
   * it one inventory effect: "re-consume remaining nights, fail if unavailable".
   * Failing is the interesting half. The nights went back on sale the moment the
   * audit ran, so somebody else may hold them — and then the honest answer is
   * that this stay cannot be reinstated, not that the counter should go past
   * what the property owns. `type_inventory_sold_at_most_total` is what says so,
   * surfaced as the `409` the desk acts on by finding the guest another room.
   *
   * Which nights are "remaining" depends on when the guest turns up. Landing on
   * the arrival date — the ordinary case, hours after the audit — the arrival
   * night is still held and it is the rest that are re-consumed. Turning up two
   * days later, the nights in between were never slept and are not bought back;
   * the stay resumes from today.
   *
   * Only from `NO_SHOW`. §2 lets `CONFIRMED` reach `CHECKED_IN` as well, and
   * that path is {@link checkIn} — arriving here it would re-consume nights the
   * booking already holds, which is the property selling itself the same room
   * twice.
   */
  async reinstate(
    exec: DbExecutor,
    input: {
      bookingId: string;
      guests: readonly CheckInGuest[];
    },
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, input.bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_IN");

    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    if (current.booking.state !== "NO_SHOW") {
      throw new ORPCError("CONFLICT", {
        message: `Only a no-show is reinstated — this booking is ${current.booking.state}, so checking the guest in is the transition`,
      });
    }

    const arrival = parseDate(current.booking.checkInDate);
    const departure = parseDate(current.booking.checkOutDate);
    const today = this.businessDate.current();

    // The guards run before the counters move. A room that is not ready is an
    // answer the desk gets without the property having bought back nights it is
    // about to give up again — the transaction would undo them either way, but
    // the refusal is the same refusal and this way it costs nothing.
    const held = await this.admissible(exec, current);

    // Never the arrival night: the no-show kept it, and buying it a second time
    // is the property selling itself a room it already holds.
    const from = today.compare(arrival) > 0 ? today : arrival.add({ days: 1 });

    if (from.compare(departure) < 0) {
      await this.inventory.reserve(exec, {
        roomType: current.roomTypeCode,
        checkIn: from,
        checkOut: departure,
      });

      // A second row rather than the first one stretched back out, which is the
      // shape `assignment.service.ts` gives a room move and for the same reason:
      // the arrival night the property charged for stays a night this room was
      // held, and the nights nobody slept in between are not claimed at all.
      //
      // Written through the assignment service rather than here, because §2's
      // "it fails if the room was resold" is `room_assignment_no_double_booking`
      // refusing this insert, and that file is where the `23P01` is turned into
      // the `409` the desk acts on. Reaching for the table directly would leave
      // an occupied room arriving at the desk as a fault.
      await this.assignments.hold(exec, {
        bookingId: input.bookingId,
        roomId: held.row.roomId,
        roomNumber: held.roomNumber,
        checkInDate: from.toString(),
        checkOutDate: departure.toString(),
      });
    }

    return await this.admit(exec, current, input.guests);
  }

  /**
   * §4's three guards against `→ CHECKED_IN`, in the order §4 lists them.
   *
   * Returns the room, because the caller that passed needs it and reading it
   * again would be a second answer to a question already asked. The order is not
   * cosmetic: it is the order the desk can act on. A stay that is a day early is
   * refused for being early rather than for the room not being ready, because
   * sending a housekeeper to a room the guest may not have yet is work nobody
   * needed. The room is then required before its condition is asked about, since
   * there is no status to read without one.
   */
  private async admissible(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
  ): Promise<HeldRoom> {
    validateArrivalWindow({
      businessDate: this.businessDate.current(),
      arrivalDate: parseDate(current.booking.checkInDate),
      departureDate: parseDate(current.booking.checkOutDate),
      earlyCheckInEnabled: this.env.BOOKING_EARLY_CHECK_IN_ENABLED,
    });

    const held = await this.assignments.current(exec, current.booking.id);

    validateRoomAssigned(held?.row ?? null);

    validateRoomReady(
      await this.housekeeping.statusOf(exec, held!.row.roomId),
      this.env.BOOKING_DIRTY_ROOM_CHECK_IN_ENABLED,
    );

    return held!;
  }

  /**
   * The party into the residence record, and the booking into `CHECKED_IN`.
   *
   * Shared by {@link checkIn} and {@link reinstate} because §1 files the
   * registration record as a property of the state rather than of the route that
   * reached it: a guest who arrives at 14:00 and one who arrives at 02:00 the
   * next morning are equally in the building, and a stay that recorded who was
   * in the room only on one of those paths would be a statutory residence record
   * with a hole in it.
   */
  private async admit(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
    guests: readonly CheckInGuest[],
  ): Promise<Booking> {
    // Nobody in the room is not a check-in. The residence record is the reason
    // the transition exists at all, and a stay that reached `CHECKED_IN` with an
    // empty party would be one the property cannot say who was in.
    if (guests.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Check-in registers at least one guest",
      });
    }

    // The first is the holder. §3 calls it "the booking holder, as against the
    // other occupants", `registration_one_primary_per_booking_key` allows
    // exactly one, and taking it from the order the desk entered them is the
    // one rule that needs no extra field on the wire.
    let primary = true;

    for (const person of guests) {
      const guestId =
        "guestId" in person
          ? person.guestId
          : (await this.guests.createGuest(exec, person)).id;

      await exec.insert(registration).values({
        bookingId: current.booking.id,
        guestId,
        isPrimary: primary,
      });

      primary = false;
    }

    return await this.setState(exec, current, "CHECKED_IN");
  }

  /** The state written, and the booking read back in the application's shape. */
  private async setState(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
    state: BookingState,
  ): Promise<Booking> {
    const [written] = await exec
      .update(booking)
      .set({ state, updatedAt: new Date() })
      .where(eq(booking.id, current.booking.id))
      .returning();

    return this.asBooking({
      booking: written!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /** Every room this booking holds, given up. */
  private async releaseRooms(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<void> {
    await exec
      .delete(roomAssignment)
      .where(
        and(
          eq(roomAssignment.bookingId, bookingId),
          isNull(roomAssignment.closureReason),
        ),
      );
  }

  /**
   * `CHECKED_IN` → `CHECKED_OUT` — the stay is over.
   *
   * §4's one guard, asked through `folio.port.ts` so that `M6` can answer it
   * from a real ledger without this transition changing. Today the stub reports
   * every folio settled, which is why the guard is exercised here through the
   * port rather than skipped until there is money to count.
   *
   * §3's inventory effect is "release unspent nights", and which nights those
   * are is the one judgement in this method. A guest leaving on business date
   * `D` has slept the nights up to `D` and will not occupy `D` itself — the
   * night of `D` runs from `D` into tomorrow, and at any hour of the property's
   * day it has not happened yet. So the release covers `[D, departure)`, which
   * puts tonight back on sale for a walk-in. The same reading makes an ordinary
   * departure release nothing at all: on the departure date the range is empty,
   * and there was never an unspent night to give back.
   *
   * The room goes back as `DIRTY` — §3's "Other" column, and `FR-HK-01`. It is
   * attributed to nobody, because `housekeeping.service.ts` says why: the
   * property is not making a cleaning judgement about the room, it is stating
   * that somebody has been in it.
   */
  async checkOut(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_OUT");

    // §4's idempotency row, and the release below is what makes it matter. A
    // second check-out that answered politely and released the nights again
    // would credit the property with inventory it never sold — the same reason
    // `cancel` guards it.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    validateFolioSettled(await this.folio.getBalance(bookingId));

    const departure = parseDate(current.booking.checkOutDate);
    const arrival = parseDate(current.booking.checkInDate);
    const today = this.businessDate.current();

    // Clamped to the arrival, because early check-in is §7's first ⚑ and a
    // guest admitted before their arrival date can leave before it too. The
    // unclamped range would release nights the booking never consumed, which
    // `type_inventory_sold_not_negative` refuses — correctly, and as a fault
    // rather than as the answer it is.
    const from = today.compare(arrival) > 0 ? today : arrival;

    if (from.compare(departure) < 0) {
      await this.inventory.release(exec, {
        roomType: current.roomTypeCode,
        checkIn: from,
        checkOut: departure,
      });
    }

    const held = await this.assignments.current(exec, bookingId);

    // A checked-in booking has a room — §4's second guard is what guarantees it
    // — so this is the shape of the one case that would leave a room held for a
    // stay that has ended, rather than a condition worth refusing a departure
    // over. The guest is leaving either way.
    if (held) {
      // The hold ends when the stay does. Left running to the original
      // departure date, an early check-out would keep the room against
      // `room_assignment_no_double_booking` for nights the counter has just
      // put back on sale — the two layers `schema/inventory.ts` describes
      // disagreeing, with the room unsellable and the type reading free.
      if (from.toString() === held.row.checkInDate) {
        await exec
          .delete(roomAssignment)
          .where(eq(roomAssignment.id, held.row.id));
      } else if (from.compare(departure) < 0) {
        await exec
          .update(roomAssignment)
          .set({ checkOutDate: from.toString() })
          .where(eq(roomAssignment.id, held.row.id));
      }

      await this.housekeeping.setCondition(exec, {
        roomNumber: held.roomNumber,
        status: "DIRTY",
      });
    }

    const [departed] = await exec
      .update(booking)
      .set({ state: next, updatedAt: new Date() })
      .where(eq(booking.id, bookingId))
      .returning();

    return this.asBooking({
      booking: departed!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * The two creating transitions, which differ only in the state and the TTL.
   *
   * The order is deliberate. The stay is priced first, so a range the property
   * has not published rates for is refused before its rooms are taken; then the
   * nights are consumed, so a sold-out night is refused before a reference is
   * spent on it; then the row is written. A failure at any of the three rolls
   * back the whole transition — the caller's transaction is what guarantees no
   * booking row survives an inventory refusal, and no consumed night survives a
   * failed insert.
   */
  private async create(
    exec: DbExecutor,
    input: CreateBookingInput,
    state: BookingState,
  ): Promise<Booking> {
    // §2's *(new)* row, enforced rather than assumed. Creation straight into
    // `CHECKED_IN` is refused because a stay nobody booked has no inventory
    // behind it.
    applyTransition(null, state);

    // A stay cannot begin before the property's own day — `property-and-tariff.md`
    // §2 for what that day is, and `business-date.service.ts` for why it is not
    // the calendar date. The seeded calendar prices a year ahead and says nothing
    // about the past, so without this a request naming a date already gone would
    // price, consume inventory on nights that have happened and write a real
    // booking against them. Held, the sweep would clear it; confirmed, it would
    // sit in the property's numbers as a room it never sold.
    //
    // Both creating paths, and the same date for each. §4's arrival window
    // governs check-in and is a different guard on a different transition, so
    // nothing downstream would catch this one.
    //
    // Arriving *today* is the walk-in this system exists to take, so the
    // comparison is strictly-before and not before-or-equal. A back-dated
    // correction is `M6`'s audited path and not a side effect of taking a
    // booking.
    const today = this.businessDate.current();

    if (input.checkIn.compare(today) < 0) {
      throw new ORPCError("CONFLICT", {
        message: `A stay cannot arrive on ${input.checkIn.toString()}, which is before the business date ${today.toString()}`,
      });
    }

    const quote = await this.quotes.quote(exec, input);

    await this.inventory.reserve(exec, {
      roomType: input.roomType,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });

    const held = await retryOnCollision(
      async (reference) => {
        // `on conflict do nothing` rather than catching the `23505`, and the
        // reason is the transaction this runs inside. A constraint violation
        // aborts a Postgres transaction outright — every statement after it
        // fails with `25P02` — so an insert that threw on a taken reference
        // would take the inventory movement above down with it and leave
        // nothing to retry into. Not raising the error is what makes a second
        // attempt possible at all.
        const [inserted] = await exec
          .insert(booking)
          .values({
            reference,
            state,
            roomTypeId: quote.roomTypeId,
            checkInDate: input.checkIn.toString(),
            checkOutDate: input.checkOut.toString(),
            ratePlanCode: input.plan,
            adults: input.party.adults,
            childAges: input.party.children.map((child) => child.age),
            quotedStayTotalGross: quote.stayTotalGross,
            quotedPercentAdjustment: quote.percentAdjustment,
            quotedBreakfastPerPersonGross: quote.breakfastPerPersonGross,
            quotedExtraPersonPerNightGross: quote.extraPersonPerNightGross,
            holdExpiresAt: state === "HELD" ? this.holdExpiry() : null,
          })
          .onConflictDoNothing({ target: booking.reference })
          .returning();

        if (!inserted) throw new ReferenceTaken(reference);

        return inserted;
      },
      (error) => error instanceof ReferenceTaken,
    );

    // Written with the booking and in the same transaction, because §4's grid
    // charges "the first night" and refunds "the remaining nights at 50%", and
    // neither may be approximated by dividing a total by a count when a weekend
    // night costs more than a Tuesday. A booking without its nights is a stay
    // no cancellation could be priced from.
    await exec.insert(bookingNight).values(
      quote.nights.map((night) => ({
        bookingId: held.id,
        stayDate: night.stayDate.toString(),
        standardGross: night.standardGross,
      })),
    );

    return this.asBooking({ booking: held, roomTypeCode: input.roomType });
  }

  /**
   * The booking, locked for the rest of the transaction.
   *
   * `for update` and not a plain read. Two requests cancelling one booking would
   * otherwise both see it live, both pass the transition check and both release
   * the nights — the idempotency guard above only holds if the state it read
   * cannot change under it. `of booking` keeps the lock off `room_type`, which
   * is joined for its code and is not being decided about.
   */
  private async forUpdate(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<{ booking: BookingRow; roomTypeCode: RoomTypeCode }> {
    const [row] = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(eq(booking.id, bookingId))
      .limit(1)
      .for("update", { of: booking });

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking with that id",
      });
    }

    return row;
  }

  /** When a hold stops holding — `FR-BOOK-02`, at the configured length. */
  private holdExpiry(now: Date = new Date()): Date {
    return new Date(
      now.getTime() + this.env.BOOKING_HOLD_TTL_MINUTES * MS_PER_MINUTE,
    );
  }

  /** The stored row as the application's shape — ISO text back into `StayDate`. */
  private asBooking({
    booking: row,
    roomTypeCode,
  }: {
    booking: BookingRow;
    roomTypeCode: RoomTypeCode;
  }): Booking {
    return {
      id: row.id,
      reference: row.reference,
      state: row.state,
      cancellationReason: row.cancellationReason,
      roomType: roomTypeCode,
      checkIn: parseDate(row.checkInDate),
      checkOut: parseDate(row.checkOutDate),
      plan: row.ratePlanCode,
      adults: row.adults,
      childAges: row.childAges,
      stayTotalGross: row.quotedStayTotalGross,
      holdExpiresAt: row.holdExpiresAt,
    };
  }
}
