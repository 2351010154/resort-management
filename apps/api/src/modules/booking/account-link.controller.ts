// The one route the desk has into a guest's account link.
//
// A controller of its own, beside the two `booking.module.ts` already draws.
// `BookingController` owns §2's transitions and `AssignmentController` owns the
// operations that change what a stay is made of; this changes neither. It mints
// a credential and causes an email, which is a third kind of act, and hanging it
// off either of the other two would blur the line those files open by stating.
//
// **The transaction is opened here**, like every other write boundary in this
// module and for `database.module.ts`'s reason: the link row and the audit row
// that says who caused it are one commit, and only a caller can decide that.
//
// **Staff only, by the row it declares and by the check below.** The capability
// row denies every guest grant, so the guard refuses a guest session and the
// booking-scoped token before a handler runs — and the handler says so again,
// because what makes this route safe is that a human being at the property
// checked who was asking, and a caller who is not that person has no business
// reaching the service at all.

import { contract } from "@mariva/shared";
import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import { JsonRequestGuard } from "../../common/auth/json-request.guard.js";
import type { Principal } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { AccountLinkResendRateLimitGuard } from "./account-link-resend-rate-limit.guard.js";
import { AccountLinkResendService } from "./account-link-resend.service.js";

@Controller()
export class AccountLinkController {
  constructor(
    private readonly resends: AccountLinkResendService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * The account link, sent again to the address on the booking.
   *
   * `booking.resend-account-link` is the row: `RECEPTIONIST` and above, which is
   * where the desk work this exists for is done, and denied to every guest
   * credential. `rbac-matrix.md` argues the grant.
   *
   * **Nothing about the message comes off the request but which stay it is
   * about.** The address, the name and the reference are read off the booking
   * inside the service, which is what makes "the mail goes where the stay says"
   * a property of where the read happens rather than a check a handler could
   * forget. `account-link-resend.service.ts` sets out why a redirect is a
   * separate act with its own authority.
   *
   * `JsonRequestGuard` because this causes mail to be sent: a cross-site
   * `<form>` post cannot be read by the page that sent it, but it can be sent,
   * and this refuses the three content types one can use.
   *
   * Rate limited by the caller's address rather than by the account, and
   * `account-link-resend-rate-limit.guard.ts` argues both the axis and the
   * figure.
   */
  @UseGuards(JsonRequestGuard, AccountLinkResendRateLimitGuard)
  @RequiresCapability("booking.resend-account-link")
  @Implement(contract.booking.resendAccountLink)
  resendAccountLink(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.booking.resendAccountLink).handler(
      async ({ input }) => {
        staffOnly(principal);

        return await this.transactions.run((exec) =>
          this.resends.resend(exec, input.bookingId),
        );
      },
    );
  }
}

/**
 * The realm this route is for, asserted rather than assumed.
 *
 * Unreachable — the capability row is denied to the guest realm and to the
 * booking token, so the guard has already refused anyone this rejects — and
 * stated anyway, because the whole authority behind this act is that a member of
 * staff performed it in front of somebody they identified. A caller who is not
 * staff reaching the service would be mail sent on nobody's word, and
 * `audit.service.ts` would refuse to file it a moment later; failing here is the
 * same refusal made where it can be read.
 *
 * Declared here rather than imported, the way `booking.controller.ts`,
 * `folio.controller.ts` and `housekeeping.controller.ts` each own theirs: a
 * shared helper would be one module's session rule governing another's act.
 */
function staffOnly(principal: Principal | null): void {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message:
        "Only a signed-in member of staff may send a booking's account link again",
    });
  }
}
