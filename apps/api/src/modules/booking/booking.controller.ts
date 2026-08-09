// The routes behind `booking-state-machine.md` §2 — every transition a booking
// makes, and nothing that does not change its state.
//
// The split from `assignment.controller.ts` is §5's own line, drawn through the
// two services rather than invented here: these change the state and each is a
// transition plus the effects §3 gives it; those change what the stay is made of
// and never consult the transition table. One controller per service is what
// keeps the boundary visible from the routing table.
//
// **The transaction is opened here, and only here.** `database.module.ts` says
// why a service takes its executor: a transition consumes or releases inventory,
// rewrites a room hold, writes a registration record and at `M6` will post a
// folio line beside them, and all of it is one commit. `closure.controller.ts`
// draws the same boundary for a much smaller write and gives the argument.
//
// **No logic lives in a handler.** Every one of these is a capability
// declaration, a transaction, one service call, and the wire crossing
// `stay-date.ts` asks for. The guards, the transition table and §4's idempotency
// rule are `booking.service.ts`'s — a handler that re-checked any of them would
// be a second opinion reachable only over HTTP, which is the half of the system
// no service test covers.
//
// **Eight capability rows govern nine routes**, and which row governs which is
// `rbac-matrix.md`'s §3, not this file's judgement. One row is read twice — a
// walk-in and the deposit that confirms a hold are both "create / modify
// booking" — and two of the eight are the policy/override pair §2 refuses to let
// collapse into one endpoint with a check inside it. The funnel's creation is a
// different row again, and the only one in this file a guest can reach.

import {
  contract,
  type CancellationReason,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
} from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import {
  type Booking,
  BookingService,
  type CreateBookingInput,
} from "./booking.service.js";

/** The stay as it arrived, in the shape the service takes. */
interface CreateBookingBody {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly adults: number;
  readonly childAges: readonly number[];
}

@Controller()
export class BookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * The public funnel's booking — §2's *(new)* → `HELD`.
   *
   * `booking.create-own` is the guest-realm row, and it is the only route in
   * this file a guest can reach. `FR-BOOK-02` gives the funnel this door alone,
   * which is why the walk-in below is a different path behind a different row
   * rather than a flag on this one.
   */
  @RequiresCapability("booking.create-own")
  @Implement(contract.booking.createHold)
  createHold() {
    return implement(contract.booking.createHold).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.createHold(exec, asCreateInput(input)),
        ),
      ),
    );
  }

  /**
   * The front desk's booking — §2's *(new)* → `CONFIRMED`, no TTL.
   *
   * `booking.write` is "Create / modify booking", which is `RECEPTIONIST` and
   * above and denied to a guest. That denial is the enforcement of §2's "only
   * the public funnel starts at `HELD`" read the other way round: a guest
   * cannot write themselves a confirmed stay with no deposit behind it.
   */
  @RequiresCapability("booking.write")
  @Implement(contract.booking.createConfirmed)
  createConfirmed() {
    return implement(contract.booking.createConfirmed).handler(
      async ({ input }) =>
        onWire(
          await this.transactions.run((exec) =>
            this.bookings.createConfirmed(exec, asCreateInput(input)),
          ),
        ),
    );
  }

  /** `HELD` → `CONFIRMED` — the deposit was taken. */
  @RequiresCapability("booking.write")
  @Implement(contract.booking.confirm)
  confirm() {
    return implement(contract.booking.confirm).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.confirm(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * Cancelling at the policy penalty — `booking.cancel-policy`, `RECEPTIONIST`
   * and above.
   *
   * The amount is not computed here and is not returned.
   * `cancellation-calculator.ts` prices `property-and-tariff.md` §4's grid and
   * persists nothing, and `M6` is the milestone that posts it; `plans/backlog.md`
   * §1 still records `D3`, which owes the grid's own numbers. What this route
   * settles is the transition and who authorised it.
   */
  @RequiresCapability("booking.cancel-policy")
  @Implement(contract.booking.cancel)
  cancel() {
    return implement(contract.booking.cancel).handler(async ({ input }) =>
      this.cancelled({
        bookingId: input.bookingId,
        reason: input.reason,
        waivedBy: null,
      }),
    );
  }

  /**
   * Cancelling with the penalty waived — `booking.cancel-waiver`, `MANAGER` and
   * `ADMIN`.
   *
   * Two endpoints and not one with a flag, which is `rbac-matrix.md` §2's own
   * shape: "policy vs override are separate endpoints, not one endpoint with an
   * amount check". What separates them below the guard is what this route
   * *writes* — the waiver's instant and the manager who granted it, onto the
   * booking. That is the correction this route needed: the capability admitted
   * the caller and then decided nothing, because a guard is an authorisation
   * event and the folio prices §4's grid later, on another request, under
   * `folio.refund-policy`. A receptionist reaching that route on a waived stay
   * was charged the grid's penalty in full and holds no capability to reverse
   * it. With the columns written here, `folio.service.ts` reads the waiver and
   * posts the charge at nothing.
   *
   * The manager comes off the session and never off the body — the same rule
   * `folio.controller.ts` keeps for a reversal and a discretionary refund, and
   * for the same reason: a waiver an invoice cannot attribute is an authority
   * nobody claimed.
   */
  @RequiresCapability("booking.cancel-waiver")
  @Implement(contract.booking.cancelWithWaiver)
  cancelWithWaiver(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.cancelWithWaiver).handler(
      async ({ input }) =>
        this.cancelled({
          bookingId: input.bookingId,
          reason: input.reason,
          waivedBy: attributedStaff(principal, "waive a cancellation penalty"),
        }),
    );
  }

  /** `CONFIRMED` → `CHECKED_IN` — the guest is in the building. */
  @RequiresCapability("booking.check-in")
  @Implement(contract.booking.checkIn)
  checkIn() {
    return implement(contract.booking.checkIn).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.checkIn(exec, {
            bookingId: input.bookingId,
            guests: input.guests,
          }),
        ),
      ),
    );
  }

  /** `CHECKED_IN` → `CHECKED_OUT` — the stay is over and the folio balances. */
  @RequiresCapability("booking.check-out")
  @Implement(contract.booking.checkOut)
  checkOut() {
    return implement(contract.booking.checkOut).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.checkOut(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * `CONFIRMED` → `NO_SHOW`, by hand — `booking.mark-no-show`, `MANAGER` and
   * `ADMIN`.
   *
   * The row's own note is "night audit does it automatically", and that sweep
   * reaches the same service method without passing through here. This route is
   * for the manager who knows before the audit runs, and the narrower grant is
   * the matrix's: writing a stay off is a commercial act, and the automatic path
   * has a business date behind it rather than an opinion.
   */
  @RequiresCapability("booking.mark-no-show")
  @Implement(contract.booking.markNoShow)
  markNoShow() {
    return implement(contract.booking.markNoShow).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.markNoShow(exec, input.bookingId),
        ),
      ),
    );
  }

  /**
   * `NO_SHOW` → `CHECKED_IN` — the guest landed at 02:00 after all.
   *
   * `booking.reinstate-no-show` is `MANAGER` and `ADMIN`, which is §2's "`MANAGER`
   * only" stated as a capability at last: until this route existed the rule was
   * a sentence in a document with nothing enforcing it, and `PR #15` carried it
   * as an open item for exactly that reason.
   */
  @RequiresCapability("booking.reinstate-no-show")
  @Implement(contract.booking.reinstate)
  reinstate() {
    return implement(contract.booking.reinstate).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.bookings.reinstate(exec, {
            bookingId: input.bookingId,
            guests: input.guests,
            roomNumber: input.roomNumber,
          }),
        ),
      ),
    );
  }

  /**
   * The transition both cancellation routes make.
   *
   * Shared because it is one transition — §3 gives `HELD → CANCELLED` and
   * `CONFIRMED → CANCELLED` one inventory effect, and the waiver changes what is
   * charged rather than what is released. What is not shared is the declaration
   * above each route and the manager carried through here, which is the whole
   * point of there being two.
   */
  private async cancelled(cancellation: {
    bookingId: string;
    reason: CancellationReason;
    /** The manager who set §4's penalty aside, or null on the policy route. */
    waivedBy: string | null;
  }) {
    return onWire(
      await this.transactions.run((exec) =>
        this.bookings.cancel(exec, cancellation),
      ),
    );
  }
}

/**
 * The member of staff a waiver is recorded against.
 *
 * `booking_names_a_waiver_authority_exactly_when_waived` makes the instant and
 * the name a pair, so there is no half a waiver to write: a caller the guard
 * admitted who is somehow not staff is refused here rather than met with a null
 * deeper in. Unreachable — `booking.cancel-waiver` is granted to `MANAGER` and
 * `ADMIN` and to nobody else — and stated anyway, because a penalty set aside
 * by nobody is precisely the record this whole route exists to leave.
 *
 * Declared here rather than imported: `folio.controller.ts` and
 * `housekeeping.controller.ts` each own their own, and a shared helper would be
 * one module's session rule governing another's columns.
 */
function attributedStaff(principal: Principal | null, act: string): string {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message: `Only a signed-in member of staff may ${act}`,
    });
  }

  return principal.userId;
}

/**
 * The party as the wire states it, in the shape `occupancy-pricing.ts` prices.
 *
 * Ages into `Child` objects and nothing else: `FR-PRC-04` bands a child by age,
 * so the array the funnel sent is already the fact the pricing path needs and
 * this only re-nests it. A shape crossing, exactly like the date one below —
 * neither decides anything.
 */
function asCreateInput(input: CreateBookingBody): CreateBookingInput {
  return {
    roomType: input.roomType,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    plan: input.plan,
    party: {
      adults: input.adults,
      children: input.childAges.map((age) => ({ age })),
    },
  };
}

/**
 * A booking as the wire carries it — `CalendarDate` into ISO text, and the hold
 * expiry into ISO-8601.
 *
 * The crossing `stayDateSchema`'s codec declares, performed where the two meet
 * and once for every route, because every route in this file answers with a
 * booking. The expiry crosses here too and is the one instant: a TTL is a moment
 * rather than a day, so it takes the full timestamp and not the nine characters
 * a stay boundary takes.
 */
function onWire(booking: Booking) {
  return {
    ...booking,
    checkIn: booking.checkIn.toString(),
    checkOut: booking.checkOut.toString(),
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    // Copied rather than passed through. The service holds the ages `readonly`,
    // which is right for a value nothing downstream may edit, and the schema's
    // array is not — so the copy is where the two meet instead of a cast that
    // would hand the caller's array to a serialiser that could sort it.
    childAges: [...booking.childAges],
  };
}
