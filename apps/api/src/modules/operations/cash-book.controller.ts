// The property's own cash book over HTTP — `FR-OPS-02`'s three routes.
//
// **One row of the matrix and no key invented.** `operations.income-expense` —
// "Income / expense (thu chi)" — governs all three, and `rbac-matrix.md`
// §"Folio and money" is the authority for it. The row reads `ACCOUNTANT: full`,
// `MANAGER: full`, `ADMIN: full` and lists nobody else, so a receptionist and a
// housekeeper are refused at the guard. Three routes under one key is what
// `rbac-matrix.md` §2 permits and `audit.controller.ts` already does — what §2
// forbids is a single route whose authority turns on its body, and none of these
// carries one.
//
// **The read declares itself a read** and the two writes do not, which is the
// declaration `shift.controller.ts` makes for the same reason: a route left at
// the strict default demands `full`, and the day the matrix hands somebody a 👁
// on this row the book should open for them without anybody remembering to come
// back here. Today all three holders are `full`, so nothing behaves differently;
// the declaration is about what the route claims to need rather than about who
// currently holds it.
//
// **Nothing here narrows a read, and there is no grant to resolve.** That is the
// whole difference from the two controllers this one sits beside.
// `shift.controller.ts` spends most of its length on "RCP: own shift" and
// `audit.controller.ts` on "ACC: financial entries only"; this row carries no
// note at all, and its three holders each see the same book. A helper reading
// the grant here would be a decision with one outcome — and the honest way to
// write "everybody who reaches this sees everything" is to write nothing.
//
// **Who is refused, and the consequence worth stating.** A receptionist may not
// record what came out of their own till. That is deliberate and it is the
// matrix's decision rather than this file's: the person counting the drawer is
// not the person who books what left it, which is the ordinary separation
// between holding money and accounting for it. What the receptionist sees is
// their drawer's expected figure moving — `shift.service.ts` adds the entries
// bound to their shift into the sum their count is held against — and the
// handover they sign is the one the property's own book agrees with.
//
// **The transaction is opened here**, as every other controller in the tree does
// and `database.module.ts` requires. The read takes one for the reason
// `shift.controller.ts` gives about its own: a page, the count printed beside it
// and the two sums under it are two statements, and on two connections they are
// two different moments — fifty entries under totals taken from a book that has
// moved since. The writes need the boundary for a sharper reason: the trigger
// `migrations/0042` installs takes a share lock on the drawer being recorded
// into, and a lock only lasts as long as the transaction it was taken in.

import { contract } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import type { CashBookEntry } from "./cash-book.service.js";
import { CashBookService } from "./cash-book.service.js";

@Controller()
export class CashBookController {
  constructor(
    private readonly cashBook: CashBookService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Money the property took or spent, recorded against a category and — where
   * đồng moved through a till — against the drawer whose count has to find them.
   *
   * The recorder comes off the session and the contract carries no field for
   * one, so an entry cannot be attributed to somebody who did not make it. Which
   * drawer, by contrast, is the caller's to name and has to be: nobody who may
   * reach this route is standing at a drawer of their own, so "the caller's own
   * open shift" would name nothing on every call.
   */
  @RequiresCapability("operations.income-expense")
  @Implement(contract.finance.recordCashBookEntry)
  recordCashBookEntry(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.finance.recordCashBookEntry).handler(
      async ({ input }) => {
        const recordedBy = recorderOf(principal, "record income or expense");

        return onWire(
          await this.transactions.run((exec) =>
            this.cashBook.record(exec, {
              direction: input.direction,
              category: input.category,
              method: input.method,
              amount: input.amount,
              businessDate: input.businessDate,
              shiftId: input.shiftId,
              note: input.note,
              recordedBy,
            }),
          ),
        );
      },
    );
  }

  /**
   * A mistake undone by its opposite, which is the only correction this book
   * has.
   *
   * There is no edit route and no delete route to sit beside this one, and the
   * absence is the design: `migrations/0042` refuses both at the table, because
   * a shift's expected cash is computed from these rows and an entry edited
   * after the drawer was counted would move a variance somebody has already
   * signed for. What comes back is the correcting entry — the row that was
   * created, not the row that was corrected, which has not changed and by design
   * cannot.
   */
  @RequiresCapability("operations.income-expense")
  @Implement(contract.finance.reverseCashBookEntry)
  reverseCashBookEntry(@CurrentPrincipal() principal: Principal | null) {
    return implement(contract.finance.reverseCashBookEntry).handler(
      async ({ input }) => {
        const recordedBy = recorderOf(principal, "correct a cash book entry");

        return onWire(
          await this.transactions.run((exec) =>
            this.cashBook.reverse(exec, {
              entryId: input.entryId,
              shiftId: input.shiftId,
              note: input.note,
              recordedBy,
            }),
          ),
        );
      },
    );
  }

  /**
   * A stretch of the book, with what it came to on each side.
   *
   * Unnarrowed for every caller who reaches it, which is not a gap in the
   * scoping: the row grants `full` to its three holders and carries no note, so
   * there is no second scope for a filter to be confused with. The two totals
   * travel with the page because the question an accountant opens this screen
   * with is what the property took and spent over a stretch of days, and a total
   * assembled from the rows on screen would answer it for the first fifty.
   */
  @RequiresCapability("operations.income-expense", "read")
  @Implement(contract.finance.listCashBookEntries)
  listCashBookEntries() {
    return implement(contract.finance.listCashBookEntries).handler(
      async ({ input }) => {
        const page = await this.transactions.run((exec) =>
          this.cashBook.list(exec, {
            from: input.from,
            to: input.to,
            direction: input.direction,
            category: input.category,
            method: input.method,
            limit: input.limit,
            offset: input.offset,
          }),
        );

        return {
          entries: page.entries.map(onWire),
          total: page.total,
          incomeTotal: page.incomeTotal,
          expenseTotal: page.expenseTotal,
        };
      },
    );
  }
}

/**
 * The staff member the property holds answerable for the entry.
 *
 * The row denies the guest realm outright, so no caller this can refuse reaches
 * it today. It is here because `cash_book_entry.recorded_by` is `NOT NULL`
 * behind a foreign key — a principal accepted and then found to name nobody
 * would be a type error deep inside a write rather than a sentence saying who
 * was refused. The act is named by the caller, so the refusal says which one was
 * refused; `shift.controller.ts` states the same argument for the same shape.
 */
function recorderOf(principal: Principal | null, act: string): string {
  if (principal?.realm !== "staff") {
    throw new ORPCError("UNAUTHORIZED", {
      message: `Only a signed-in member of staff may ${act}`,
    });
  }

  return principal.userId;
}

/** An entry as the wire carries it — the instant into ISO-8601. The trading day
 *  is already the ten characters the column holds, and the amount is a `bigint`,
 *  which the serialiser writes out as text. */
function onWire(entry: CashBookEntry) {
  return { ...entry, recordedAt: entry.recordedAt.toISOString() };
}
