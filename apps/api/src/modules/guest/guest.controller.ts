// The two routes `FR-GST-03` asks for — the record with the number masked, and
// the separate, audited call that reveals it.
//
// **Two capabilities, two routes, and no branch between them.**
// `guest.read-record` is every staff role but housekeeping; `guest.unmask-cccd`
// is `MANAGER`, `ADMIN` and a conditional `RECEPTIONIST`. The service already
// refuses to hand the plain number to the first path — `GuestRecord` has no
// field to carry it — so the split here is not a second line of defence but the
// same line stated where a routing table can be read: which authority a call
// used is the route it reached, not an argument inside it.
//
// **The condition a `⚠` grant leaves owing is the audit row.** The matrix's
// note on the unmask row is "Audit-logged per call" and nothing else — no
// in-house window, no shift, no ownership — so what the handler still owes is
// that the reading is attributed, and `guest.service.ts` writes the entry in
// the same statement sequence that reads the number. There is no path through
// this file that reveals a number without one.
//
// **The transaction is opened here, including for the read.** That is
// `database.module.ts`'s boundary — a service takes the caller's executor —
// and `transaction-runner.ts` is what a controller injects instead of the
// Drizzle client, so that a controller cannot quietly run a query of its own.
// The reveal genuinely needs the boundary: the number and the entry accounting
// for it commit together or neither does.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { CccdReveal, GuestRecord } from "./guest.service.js";
import { GuestService } from "./guest.service.js";

@Controller()
export class GuestController {
  constructor(
    private readonly guests: GuestService,
    private readonly transactions: TransactionRunner,
  ) {}

  /** The record, masked — and masked with no way to ask otherwise. */
  @RequiresCapability("guest.read-record", "read")
  @Implement(contract.guest.readRecord)
  readRecord() {
    return implement(contract.guest.readRecord).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.guests.getGuest(exec, input.guestId),
        ),
      ),
    );
  }

  /**
   * The number itself, and the row that says who read it.
   *
   * The acting member of staff is taken from the guard's decision and never
   * from the body. An id a caller could state is an attribution a caller could
   * choose, and an audit trail that records the name it was handed accuses
   * whoever the reader typed.
   */
  @RequiresCapability("guest.unmask-cccd")
  @Implement(contract.guest.unmaskCccd)
  unmaskCccd(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.guest.unmaskCccd).handler(async ({ input }) => {
      const reveal = await this.transactions.run((exec) =>
        this.guests.unmaskCccd(exec, {
          guestId: input.guestId,
          unmaskedBy: actingStaff(principal),
          reason: input.reason,
        }),
      );

      return revealOnWire(reveal);
    });
  }
}

/**
 * The member of staff the audit row will name.
 *
 * The guard has already refused every caller who is not staff — the matrix
 * denies the guest realm this row outright — so this narrowing is unreachable
 * in practice. It is here because `cccd_unmask_audit.unmasked_by` is `NOT NULL`
 * and references a `staff_user`: an unattributable reveal has no row to write,
 * and the honest answer to one is a refusal rather than a foreign key violation
 * from inside the transaction.
 */
function actingStaff(principal: Principal | null): string {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Only a signed-in member of staff may reveal a CCCD",
    });
  }

  return principal.userId;
}

/**
 * A guest record as the wire carries it — the birthday as ISO text, the two
 * timestamps as instants.
 *
 * `stay-date.ts` argues the first: a response carries the encoded form, and the
 * crossing happens at the controller where it can be seen. The last two are
 * moments rather than days and take the full ISO-8601 form.
 */
function onWire(record: GuestRecord) {
  return {
    ...record,
    dateOfBirth: record.dateOfBirth?.toString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** A reading as the wire carries it. The moment it happened is an instant. */
function revealOnWire(reveal: CccdReveal) {
  return {
    ...reveal,
    unmaskedAt: reveal.unmaskedAt.toISOString(),
  };
}
