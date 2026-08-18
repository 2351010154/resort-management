// The two routes a guest's word on a finished stay travels through.
//
// **One capability row governs both**, and that is the matrix's split rather
// than this file's: "Post-stay feedback" is a single row, `⚠` for the guest and
// 👁 for `MANAGER` and `ADMIN`. So the write takes the row at its default action
// and the read declares itself a read — without that second argument the read
// would refuse exactly the two staff roles the row grants an eye to, which is
// the cost `access.decorators.ts` describes for forgetting it.
//
// **The `⚠` is paid in the service, not here.** The guard admits any signed-in
// guest to this row, so the handler still owes two questions: is the stay this
// caller's, and is it over. Both are answered inside `FeedbackService`, against
// the booking, in the same transaction as the write — a check made out here
// would be a check the next route to be added could forget.
//
// **The transaction is opened here**, as every other controller in this
// application does and `database.module.ts` requires. The read is wrapped too:
// it needs an executor, and a controller holding the Drizzle client is a
// controller that can run a query of its own.

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
import type { BookingOwner } from "../booking/booking.service.js";
import { type Feedback, FeedbackService } from "./feedback.service.js";

@Controller()
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * What the guest already said about this stay, if anything.
   *
   * Declared as a read, so the two staff roles the matrix gives an eye to are
   * not refused by a default meant for writes.
   *
   * A stay that is not finished is refused rather than answered `null`, and the
   * screen depends on the difference: an answer is permission to write, and a
   * refusal is the reason there is nothing to offer. `contract/feedback.ts`
   * argues why that is one rule rather than a flag beside the answer.
   */
  @RequiresCapability("feedback.submit", "read")
  @Implement(contract.feedback.readOwn)
  readOwn(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.feedback.readOwn).handler(async ({ input }) => {
      const left = await this.transactions.run((exec) =>
        this.feedback.own(exec, {
          reference: input.reference,
          owner: ownerOf(principal, "read their own feedback"),
        }),
      );

      return left ? onWire(left) : null;
    });
  }

  /**
   * The rating, and whatever the guest wrote beside it.
   *
   * A write, so the declaration takes the default action.
   */
  // The credential on this route is a cookie, which means the browser presents
  // it whether or not the page that asked meant to. `json-request.guard.ts` is
  // the answer the guest's cancellation already uses: refuse the three content
  // types a `<form>` can send, so the only way in is a `fetch` that preflights
  // into the origin allowlist. Without it a cross-site page could file an
  // opinion in a signed-in guest's name.
  @UseGuards(JsonRequestGuard)
  @RequiresCapability("feedback.submit")
  @Implement(contract.feedback.submit)
  submit(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.feedback.submit).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.feedback.submit(exec, {
            reference: input.reference,
            rating: input.rating,
            comment: input.comment,
            owner: ownerOf(principal, "leave feedback on their own stay"),
          }),
        ),
      ),
    );
  }
}

/**
 * The account whose stay this is, taken from the session and never from a body.
 *
 * One branch where `booking.controller.ts` has two, and the missing one is the
 * point rather than an omission. That file serves rows a booking-scoped
 * credential opens, so it resolves a `proven` owner as well; `access.guard.ts`
 * keeps the list of rows that credential reaches closed, this row is not on it,
 * and a caller holding one is refused before any handler runs. Building an owner
 * for a realm that cannot arrive would be inventing a scope for a credential the
 * guard has already declined — and feedback is an account's statement about a
 * stay, not something a link forwarded out of a mailbox should be able to write.
 *
 * Declared here rather than imported, as each controller's own actor helper is:
 * a shared one would be one module's session rule governing another's columns.
 */
function ownerOf(principal: Principal | null, act: string): BookingOwner {
  if (principal?.realm !== "guest") {
    throw new ORPCError("FORBIDDEN", {
      message: `Only the guest who made a booking may ${act}`,
    });
  }

  return { kind: "account", userId: principal.userId };
}

/** Feedback as the wire carries it — the write's instant into ISO-8601. */
function onWire(left: Feedback) {
  return { ...left, submittedAt: left.submittedAt.toISOString() };
}
