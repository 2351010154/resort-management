// The eight folio routes the RBAC matrix already governs — reading the account,
// posting a charge, selling a catalog item, posting a payment, correcting a
// line, handing money back the way §4's grid prices it, handing money back at a
// manager's discretion, and agreeing the whole of it.
//
// Eight routes over seven rows, and no route here names a key the matrix does
// not have. The two postings share `folio.post-charge`, whose row reads "Post
// charge (room, service, minibar)" and names both acts; what §2 forbids is one
// route whose authority turns on its body, not two routes under an authority
// that was always theirs. The invoice adjustment sits in the same section and is
// deliberately
// absent: it has service work of its own, and a route with no capability behind
// it is unreachable for everyone, which is the intended failure mode rather than
// a gap to be worked around.
//
// **The two refunds are two declarations, and that is the requirement rather
// than a stylistic choice.** `rbac-matrix.md` §2 forbids "one endpoint with an
// amount check", and `FR-PAY-04` names the two rows. The guard reads the
// declaration on the method, so the only way a receptionist is admitted to §4's
// figure and refused a manager's is for the two to be two methods — a single
// handler branching on whether an amount arrived would run under whichever key
// it declared, and the branch would be a permission check written by hand in a
// place nothing tests against the matrix.
//
// **The transaction is opened here**, as `housekeeping.controller.ts` and
// `closure.controller.ts` argue and `database.module.ts` requires. The read is
// wrapped too: it is two statements whose answers are printed side by side, and
// on two connections they would be two different moments. The writes need the
// boundary for a sharper reason — the property's day is a `system_config` row,
// so `BusinessDateService` is asked inside the transaction the posting was going
// to open anyway, and the line is dated from the same snapshot it is written in.
//
// **Who posted the line is taken from the session, never from the body.** An
// attribution a caller could state is an attribution a caller could choose, and
// a reversal filed in somebody else's name is the one entry on an append-only
// ledger that can never be corrected — only compensated.
//
// **The guest realm is refused, and the refusal is the ownership check.**
// `matrix.ts` grants `folio.read` to a guest as `conditional` — "own, settled
// view" — and `roles.ts` is explicit that `conditional` passes the guard, so a
// signed-in guest reaches this handler and the scope the guard could not see is
// owed here. Today no folio can be theirs: `schema/guest.ts` says the join
// between `guest_user` and a stay is M7's, and the funnel that would create a
// booking attributed to an account is M7's too. So the predicate is not
// unanswerable, it answers no for every folio, and {@link ledgerOpenTo} says so
// by refusing. Read off the grant rather than off the realm, the way
// `search.controller.ts` reads its own narrowing: a branch on
// `principal.realm === "guest"` is a copy of the matrix in a handler, and it
// would hand the full ledger to whichever realm the matrix conditions next.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  Access,
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type {
  AccessDecision,
  Principal,
} from "../../common/auth/principal.js";
import type { DbExecutor } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import { CatalogService } from "../operations/catalog.service.js";
import type { FolioAccount, FolioLine } from "./folio.service.js";
import { FolioService } from "./folio.service.js";

@Controller()
export class FolioController {
  constructor(
    private readonly folios: FolioService,
    private readonly transactions: TransactionRunner,
    private readonly businessDates: BusinessDateService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * The account, its lines and what they come to.
   *
   * Declared as a read, because it is one. The row grants `full` to the four
   * staff roles that hold it, so the strict write default would refuse nobody
   * today — it is declared anyway, because the day the matrix hands a role a 👁
   * over this row the route must not be the thing that refuses them.
   */
  @RequiresCapability("folio.read", "read")
  @Implement(contract.folio.read)
  read(@Access() access: AccessDecision | undefined) {
    return implement(contract.folio.read).handler(async ({ input }) => {
      if (!ledgerOpenTo(access)) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "A guest may read only their own folio, and no folio is linked to " +
            "a guest account yet — ask the desk for the account",
        });
      }

      return onWire(
        await this.transactions.run((exec) =>
          this.account(exec, input.bookingId),
        ),
      );
    });
  }

  /**
   * A night, or anything else the guest owes — `FR-FOL-02`'s three lines.
   *
   * The account is opened if this is the first thing the stay needs one for,
   * inside the same transaction: a folio created by a posting that then failed
   * would be an empty account nobody asked for.
   */
  @RequiresCapability("folio.post-charge")
  @Implement(contract.folio.postCharge)
  postCharge(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.postCharge).handler(async ({ input }) =>
      this.transactions.run(async (exec) => {
        const folioId = await this.folios.ensureFolio(exec, input.bookingId);

        const charge = await this.folios.postRoomCharge(exec, {
          folioId,
          businessDate: await this.businessDates.current(exec),
          description: input.description,
          grossAmount: input.grossAmount,
          postedBy: staffId(principal),
        });

        return {
          posted: [charge],
          folio: onWire(await this.account(exec, input.bookingId)),
        };
      }),
    );
  }

  /**
   * A catalog item sold to the stay — `FR-FOL-03`.
   *
   * The same capability as the charge above, and the matrix row is the one that
   * decides it: "Post charge (room, service, minibar)" names this act. Two
   * routes under one key is not what `rbac-matrix.md` §2 forbids — what it
   * forbids is one route whose authority depends on what arrived in the body,
   * and neither of these lets a caller reach a figure the other could not.
   *
   * **The item is resolved inside the posting's own transaction**, before
   * anything is written and after the folio is opened. That ordering is what
   * makes the price the line is computed from the price that was on the row at
   * the moment the line went in — a catalog read on another connection could be
   * a repricing old by a request.
   *
   * A code nobody sells is a `NOT_FOUND` from the catalog and nothing is
   * written, because the resolve comes first and the transaction has posted
   * nothing yet. A folio opened for a stay whose item then failed to resolve is
   * rolled back with it.
   */
  @RequiresCapability("folio.post-charge")
  @Implement(contract.folio.postServiceItem)
  postServiceItem(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.postServiceItem).handler(async ({ input }) =>
      this.transactions.run(async (exec) => {
        const folioId = await this.folios.ensureFolio(exec, input.bookingId);

        const sale = await this.folios.postServiceItem(exec, {
          folioId,
          businessDate: await this.businessDates.current(exec),
          item: await this.catalog.sellableItem(exec, input.code),
          quantity: input.quantity,
          grossAmount: input.grossAmount,
          postedBy: staffId(principal),
        });

        return {
          posted: [sale],
          folio: onWire(await this.account(exec, input.bookingId)),
        };
      }),
    );
  }

  /** Money in, stored as the negation of what the guest handed over. */
  @RequiresCapability("folio.post-payment")
  @Implement(contract.folio.postPayment)
  postPayment(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.postPayment).handler(async ({ input }) =>
      this.transactions.run(async (exec) => {
        const folioId = await this.folios.ensureFolio(exec, input.bookingId);

        const payment = await this.folios.postPayment(exec, {
          folioId,
          businessDate: await this.businessDates.current(exec),
          description: input.description,
          amount: input.amount,
          postedBy: staffId(principal),
        });

        return {
          posted: [payment],
          folio: onWire(await this.account(exec, input.bookingId)),
        };
      }),
    );
  }

  /**
   * `FR-FOL-01`'s correction: a new line, never a delete.
   *
   * The account is read before the reversal so the line named can be shown to
   * be on it. The service resolves the folio from the posting itself, so without
   * this a caller naming one stay and a posting belonging to another would
   * credit the second guest and be handed the first one's account back — a
   * correction that appears not to have happened. The comparison costs a read
   * this route was going to make anyway.
   *
   * The reverser is required rather than optional, and the guard has already
   * refused every caller who is not staff: deciding a line was a mistake is
   * somebody's judgement and an invoice cannot say whose if the column is null.
   */
  @RequiresCapability("folio.reverse-posting")
  @Implement(contract.folio.reversePosting)
  reversePosting(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.reversePosting).handler(async ({ input }) =>
      this.transactions.run(async (exec) => {
        const account = await this.account(exec, input.bookingId);

        if (!account.lines.some((line) => line.id === input.postingId)) {
          throw new ORPCError("NOT_FOUND", {
            message:
              "That line is not on this stay's account, so there is nothing " +
              "here to correct",
          });
        }

        const posted = await this.folios.reversePosting(exec, {
          postingId: input.postingId,
          businessDate: await this.businessDates.current(exec),
          postedBy: attributedStaff(principal, "reverse a posting"),
        });

        return {
          posted: [...posted],
          folio: onWire(await this.account(exec, input.bookingId)),
        };
      }),
    );
  }

  /**
   * §4's grid, posted — `FR-PAY-04` under the cheaper of its two capabilities.
   *
   * **Nothing about the figure comes off the request.** The input is the stay
   * and nothing else, so this handler has nothing to pass on that a caller could
   * have chosen: the service reads the plan, the nights the booking froze and
   * the state that says what ended the stay, and `cancellation-calculator.ts`
   * prices them. That is what makes this row safe to grant a receptionist —
   * `rbac-matrix.md` §2 splits money authority from operational authority, and
   * the split holds here because the operational role cannot move the number.
   *
   * The account is opened if the stay has none, as the charge and the payment
   * routes do. A cancellation that was never paid for still owes §4's penalty,
   * and an account opened to carry it is the honest record — the alternative is
   * a stay that quietly escaped the grid for having no folio yet.
   *
   * One or two lines come back, which {@link contract.folio.postPolicyRefund}
   * explains: the charge always, and the money going back when the account is
   * over-paid once that charge stands against it.
   */
  @RequiresCapability("folio.refund-policy")
  @Implement(contract.folio.postPolicyRefund)
  postPolicyRefund(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.postPolicyRefund).handler(
      async ({ input }) =>
        this.transactions.run(async (exec) => {
          const folioId = await this.folios.ensureFolio(exec, input.bookingId);

          const posted = await this.folios.postPolicyRefund(exec, {
            folioId,
            bookingId: input.bookingId,
            businessDate: await this.businessDates.current(exec),
            postedBy: attributedStaff(
              principal,
              "apply the cancellation policy",
            ),
          });

          return {
            posted: [...posted],
            folio: onWire(await this.account(exec, input.bookingId)),
          };
        }),
    );
  }

  /**
   * Money handed back outside §4 — the same requirement, the other capability.
   *
   * The declaration above this method is the entire enforcement of "only
   * `MANAGER`+ may refund outside policy". There is no amount check in the
   * handler and there is deliberately none: a route that admitted a receptionist
   * and then compared their figure against the grid would be the one endpoint
   * `rbac-matrix.md` §2 forbids, and the comparison would have to be right
   * forever for the permission to hold.
   *
   * The account is opened if absent, as every other posting route does. Handing
   * money back on a stay that has taken none is a manager's mistake rather than
   * an impossible act, and the ledger answers it plainly — the balance goes
   * positive, and `close` refuses the account until the line is reversed.
   */
  @RequiresCapability("folio.refund-override")
  @Implement(contract.folio.postOverrideRefund)
  postOverrideRefund(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.folio.postOverrideRefund).handler(
      async ({ input }) =>
        this.transactions.run(async (exec) => {
          const folioId = await this.folios.ensureFolio(exec, input.bookingId);

          const refund = await this.folios.postOverrideRefund(exec, {
            folioId,
            businessDate: await this.businessDates.current(exec),
            amount: input.amount,
            reason: input.reason,
            postedBy: attributedStaff(principal, "refund outside policy"),
          });

          return {
            posted: [refund],
            folio: onWire(await this.account(exec, input.bookingId)),
          };
        }),
    );
  }

  /**
   * `FR-FOL-01`'s close, and — by the same commit — `FR-FOL-04`'s request for
   * an invoice.
   *
   * **Nothing here waits on the provider, and there is nothing here that
   * could.** `FR-FOL-04` requires that a provider timeout never roll back a
   * checkout, and this route honours it by having no way to reach a provider:
   * `E_INVOICE_PORT` is not injected, so the only thing this transaction does is
   * write the state. `e-invoice.job.ts` argues why that commit *is* the enqueue
   * — a folio standing at `CLOSED` with no reference is the request, written by
   * the transaction that decided to close it — and the sweep that drains it runs
   * on a connection this request never touches. A close that awaited a number
   * would be a checkout an issuer could refuse.
   *
   * **The account is read back inside the same transaction that closed it**, so
   * the state, the instant and the lines the invoice will be drawn from are the
   * ones the close committed. Read afterwards on another connection they would
   * be a later moment, and on a closed folio that is a meaningful difference:
   * the sweep may have written the reference by then, and the desk would be
   * shown an account it did not agree.
   *
   * **The refusals are the service's, unaltered.** An account that is short, one
   * that is over-paid, one already agreed and one that was never opened are four
   * different sentences and each names the figure or the instant a receptionist
   * needs; a second wording composed here would be a second answer to keep level
   * with the ledger. So this handler adds no check of its own — in particular it
   * does not read the account first to decide whether the close will be allowed,
   * because the balance is only true under the row lock the service takes, and a
   * check made before it is a check made in the wrong moment.
   *
   * **Nobody is attributed.** Every other write here takes the principal off the
   * session, because it authors a line and `folio_posting.posted_by` names who.
   * The close authors no line and `schema/folio.ts` gives the folio no column
   * for who agreed it, so there is nothing this handler could honestly record —
   * and a principal accepted and dropped would read as an attribution that is
   * being made somewhere.
   */
  @RequiresCapability("folio.close-invoice")
  @Implement(contract.folio.close)
  close() {
    return implement(contract.folio.close).handler(async ({ input }) =>
      this.transactions.run(async (exec) => {
        await this.folios.close(exec, input.bookingId);

        return onWire(await this.account(exec, input.bookingId));
      }),
    );
  }

  /**
   * The stay's account, or the refusal a reader can act on.
   *
   * One sentence for both absences — a booking that does not exist and a stay
   * nothing has been posted to — because from the folio table they are the same
   * answer, and a route that told them apart would confirm which booking ids
   * exist to a caller guessing at them.
   */
  private async account(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<FolioAccount> {
    const found = await this.folios.read(exec, bookingId);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message:
          "No account has been opened for that stay — either the booking does " +
          "not exist or nothing has been posted to it yet",
      });
    }

    return found;
  }
}

/**
 * Whether this caller gets the ledger.
 *
 * Written as "only a grant that is unambiguously full opens it" rather than as
 * "conditional is refused", which is `search.controller.ts`'s arrangement and
 * its reason: a decision that never arrived is a guard that did not run, and the
 * honest answer to that is the refusal rather than a stranger's financial
 * record. This row grants no 👁 to anybody, so `full` is exact — a role the
 * matrix later hands `read` reaches this line and is refused until somebody
 * decides what a read-only folio looks like, which is a 403 in a review rather
 * than a leak in production.
 */
function ledgerOpenTo(access: AccessDecision | undefined): boolean {
  return access?.grant === "full";
}

/** The staff member the line is attributed to. Null for anyone who is not
 *  staff — a caller no route here admits, since every row denies the guest
 *  realm the writes. */
function staffId(principal: Principal | null): string | null {
  return principal?.realm === "staff" ? principal.userId : null;
}

/**
 * The same person, where the column will not take a null.
 *
 * `folio_posting.posted_by` is nullable and a correction's or a refund's is not,
 * by `folio.service.ts`'s rule rather than the schema's: the two writers with
 * nobody behind them post charges and payments, and neither takes a line back
 * nor hands money out. Unreachable — the matrix grants these three rows to staff
 * roles and to no one else — and here because an unattributable credit deserves
 * a refusal that says so rather than a type error deeper in.
 *
 * The act is named by the caller so the refusal says which one was refused,
 * which is the only thing that differs between the three.
 */
function attributedStaff(principal: Principal | null, act: string): string {
  const staff = staffId(principal);

  if (!staff) {
    throw new ORPCError("UNAUTHORIZED", {
      message: `Only a signed-in member of staff may ${act}`,
    });
  }

  return staff;
}

/** The account as the wire carries it — the instants into ISO-8601. The
 *  business date is already the nine characters the column holds. */
function onWire(account: FolioAccount) {
  return {
    id: account.id,
    bookingId: account.bookingId,
    state: account.state,
    openedAt: account.openedAt.toISOString(),
    closedAt: account.closedAt?.toISOString() ?? null,
    summary: account.summary,
    postings: account.lines.map(lineOnWire),
  };
}

function lineOnWire(line: FolioLine) {
  return { ...line, postedAt: line.postedAt.toISOString() };
}
