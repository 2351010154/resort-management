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
// What is deliberately NOT here: check-in, check-out, no-show and the operations
// of §5. They need a business date, a room assignment, a housekeeping status and
// a folio balance, and each is a guard this file cannot answer from two strings.

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
import { eq } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import {
  booking,
  type BookingRow,
  bookingNight,
} from "../../database/schema/booking.js";
import { roomType } from "../../database/schema/inventory.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { applyTransition } from "./state-machine.js";
import { retryOnCollision } from "./reference-generator.js";
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

@Injectable()
export class BookingService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly quotes: StayQuoteService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The public funnel's booking — §2's *(new)* → `HELD`, with a TTL running.
   *
   * `FR-BOOK-02` gives only the funnel this door. The nights are consumed in
   * full at this point and not at payment, because a hold that did not consume
   * them would be a room two guests could reach the payment step for.
   */
  async createHold(
    exec: DbExecutor,
    input: CreateBookingInput,
  ): Promise<Booking> {
    return await this.create(exec, input, "HELD");
  }

  /**
   * The front desk's booking — §2's *(new)* → `CONFIRMED`, no TTL.
   *
   * A walk-in or a phone reservation is confirmed by the person taking it, so
   * there is nothing for a sweep to expire and
   * `booking_hold_expiry_exactly_when_held` refuses an expiry on it.
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
