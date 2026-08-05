// The routes behind `booking-state-machine.md` §5 — what a stay is made of, as
// against what state it is in.
//
// §5 opens by saying these are "where most real front-desk work happens" and
// that each "is a separate endpoint with its own `@RequiresCapability()`
// declaration". That sentence is this file: five routes, four capability rows,
// and no branch anywhere that decides which of them a caller meant.
//
// The two that would be tempting to fold together are the extension and the
// early departure. Both name a new departure date, and a single route reading
// which way the date moved would be one endpoint with a check inside it — the
// shape `rbac-matrix.md` §2 refuses — and would quietly hand a receptionist
// holding `booking.extend-stay` the early-departure charge as well.
//
// `booking.write` governs the room type change, and it is the row that fits
// rather than a near miss. §5 files an upgrade as changing what the guest is
// sold, which is "Create / modify booking"; it is not an assignment, because
// `assignment.service.ts` refuses to perform one under this operation's
// authority, and it is not a rate change, because that file also refuses to
// reprice — deliberately, so that charging for an upgrade stays the manager-only
// act `pricing.rate-override` covers.
//
// The transaction is opened here for the reason `booking.controller.ts` gives.
// A type change moves two inventory counters, rewrites an assignment row and
// hands a room back to housekeeping, and only the caller can draw a boundary
// that wide.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import {
  AssignmentService,
  type RoomAssignment,
} from "./assignment.service.js";

@Controller()
export class AssignmentController {
  constructor(
    private readonly assignments: AssignmentService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * §5's "assign / reassign room" — legal from `CONFIRMED` and `CHECKED_IN`.
   *
   * The same capability as the move below, because the matrix files them as one
   * row: "Assign room / room move". They are two routes because they are two
   * operations — a reassignment before arrival replaces the hold outright and a
   * move keeps the nights already slept — and §5 lists them on two lines.
   */
  @RequiresCapability("booking.assign-room")
  @Implement(contract.booking.assignRoom)
  assignRoom() {
    return implement(contract.booking.assignRoom).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.assignments.assign(exec, input),
        ),
      ),
    );
  }

  /** §5's "room move" — a checked-in guest changes rooms mid-stay. */
  @RequiresCapability("booking.assign-room")
  @Implement(contract.booking.moveRoom)
  moveRoom() {
    return implement(contract.booking.moveRoom).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.assignments.move(exec, input),
        ),
      ),
    );
  }

  /** §5's "change room type (upgrade)" — the counters move with the key. */
  @RequiresCapability("booking.write")
  @Implement(contract.booking.changeRoomType)
  changeRoomType() {
    return implement(contract.booking.changeRoomType).handler(
      async ({ input }) => {
        const changed = await this.transactions.run((exec) =>
          this.assignments.changeRoomType(exec, input),
        );

        return {
          ...changed,
          assignment: changed.assignment ? onWire(changed.assignment) : null,
        };
      },
    );
  }

  /** §5's "extend stay" — needs inventory for the added nights, fails cleanly. */
  @RequiresCapability("booking.extend-stay")
  @Implement(contract.booking.extendStay)
  extendStay() {
    return implement(contract.booking.extendStay).handler(async ({ input }) => {
      const extended = await this.transactions.run((exec) =>
        this.assignments.extendStay(exec, input),
      );

      return {
        ...extended,
        checkOut: extended.checkOut.toString(),
        assignment: extended.assignment ? onWire(extended.assignment) : null,
      };
    });
  }

  /**
   * §5's "shorten stay / early departure" — `booking.early-checkout`, whose row
   * is worded "Early checkout (policy charge)".
   *
   * The charge comes back on the response and is written nowhere.
   * `cancellation-calculator.ts` argues that at length: a charge is a folio
   * posting and the folio is `M6`. Telling the guest at the desk what leaving
   * early costs is the whole of the operation here.
   */
  @RequiresCapability("booking.early-checkout")
  @Implement(contract.booking.shortenStay)
  shortenStay() {
    return implement(contract.booking.shortenStay).handler(
      async ({ input }) => {
        const shortened = await this.transactions.run((exec) =>
          this.assignments.shortenStay(exec, input),
        );

        return {
          ...shortened,
          checkOut: shortened.checkOut.toString(),
          assignment: shortened.assignment
            ? onWire(shortened.assignment)
            : null,
        };
      },
    );
  }
}

/**
 * A room hold as the wire carries it — the `CalendarDate` crossing, once.
 *
 * Shared by five routes because four of them can answer with an assignment: a
 * type change moves the guest to a room of the new type, an extension lengthens
 * the hold, and an early departure cuts it back or gives it up entirely.
 */
function onWire(assignment: RoomAssignment) {
  return {
    ...assignment,
    checkIn: assignment.checkIn.toString(),
    checkOut: assignment.checkOut.toString(),
  };
}
