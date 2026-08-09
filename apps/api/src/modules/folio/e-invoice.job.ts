// The invoice `FR-FOL-04` asks for, drawn after the checkout rather than during
// it.
//
// ## The queue is the ledger
//
// The requirement says closing a folio "enqueues an idempotent e-invoice job
// keyed on folio id", and the strongest available form of that enqueue is the
// close's own commit. A folio standing at `CLOSED` with no `invoice_reference`
// *is* the job, written by the transaction that decided to close it. Nothing
// can separate a close from its enqueue, because they are one row; nothing can
// enqueue twice, because `FolioService.close` refuses a second close and the
// account has one row rather than a growing list of requests against it.
//
// A queue table beside the folio was the obvious alternative and it is a second
// home for a fact the ledger already states. `schema/folio.ts` refuses a stored
// balance on exactly that ground, and a pending-invoice row is the same mistake
// wearing a different name: two places that have to agree about whether this
// stay has been invoiced, and a reconciliation job for the day they do not.
// `room-charge-sweep.ts` states the principle this inherits — idempotency is the
// predicate, not a flag written afterwards — and here the predicate is the
// column the answer lands in, so the row this writes is the row that stops it
// writing again.
//
// Enqueuing onto pg-boss from inside the close was the other alternative and is
// worse in two ways at once. The send goes over the pool rather than the
// caller's transaction, so a close can commit with no job behind it or a job can
// outlive a close that rolled back — the defect `tech-stack.md` rejects Redis
// for, arriving through our own door. And pg-boss builds its schema at `start()`
// and is off under `NODE_ENV=test`, so the claim that matters most here — one
// invoice per stay, however often anything runs — would be the one claim no spec
// in this repository could make.
//
// ## Why it is an ordinary sweep, and what that costs
//
// A sweep is one question asked of the database on a schedule, and this is one:
// which agreed accounts are still owed an invoice? It takes no business date —
// `hold-expiry-sweep.ts` has the same shape and the same reason, a stay being
// checked out whenever the desk gets to it rather than at a rollover — and it
// returns the folios it wrote, so `JobRunner`'s second pass over the same
// transaction proves what would otherwise be a promise: run it again and the
// predicate is empty, so nobody is invoiced twice.
//
// What it costs is a provider round trip inside the runner's transaction, which
// `payment.service.ts` forbids in the words "ten transactions waiting on a
// gateway is an API that has stopped answering anything else". That prohibition
// is about request handlers, and it holds: nothing here is on a request path.
// This is one background connection of ten, working through a small property's
// checkouts against an issuer that is today `LocalEInvoiceService` — which
// returns a reference derived from the folio id and cannot fail.
//
// The window that arrangement leaves open is real and is not closed by any
// arrangement of tables. A provider that issued a number and a transaction that
// then failed to commit leaves the property re-issuing against a document the
// tax authority already holds. An outbox with its own boundary would narrow that
// window to one folio rather than a batch; it would not close it, because the
// process can die between the provider's answer and the write either way.
// `ports/e-invoice.port.ts` says where it is closed — the folio id crosses the
// port so an adapter can refuse to issue twice for one stay — and the milestone
// that brings a provider with a round trip that can genuinely fail is the
// milestone that decides whether this job then earns a boundary of its own. The
// predicate it drains survives that move untouched.
//
// ## What is caught, and what is emphatically not
//
// A provider failure is not caught. It rolls the run back whole, which is
// `JobRunner`'s contract, and it leaves every folio in the batch closed and
// still awaiting an invoice — the close is a transaction that committed hours
// or seconds earlier, and no failure here can reach it. That is `FR-FOL-04`'s
// "a provider timeout never rolls back a checkout", and it holds because
// issuance was never in the checkout's transaction to begin with.
//
// Catching per folio and carrying on would be worse than it looks. The runner
// runs this a second time to check it settled; a folio that failed on the first
// pass and succeeded on the second would come back as residue, and the run would
// be declared non-idempotent and rolled back *after* its invoice had been
// issued. The catch meant to contain a double issue is what would cause one.
//
// One condition is skipped rather than raised, and the difference is that it
// cannot change between the two passes: a stay with no primary registration has
// nobody to address the invoice to. `ports/e-invoice.port.ts` refuses to invent
// a buyer — "a name is all the property stores" — and raising would stop every
// other folio's invoice behind one stay somebody forgot to register. So it is
// logged with the stay named, deterministically on every pass, and the account
// waits.

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import type { DbExecutor } from "../../database/database.module.js";
import { folio, folioPosting } from "../../database/schema/folio.js";
import { guest, registration } from "../../database/schema/guest.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import {
  E_INVOICE_PORT,
  type EInvoicePort,
  type InvoiceLine,
} from "./ports/e-invoice.port.js";

// Every five minutes, on an offset that is nobody else's. A guest should have
// their invoice before they have found the car, so this is not the hourly pace a
// night's rent is charged at; and it is not tied to an hour at all, because a
// checkout happens whenever the desk gets to it. The offset keeps it clear of
// the no-show sweep's twenty past and the room charge's thirty-five.
const EVERY_FIVE_MINUTES = "3-58/5 * * * *";

/** A posting as the invoice reads it, less everything the invoice ignores. */
export interface LedgerLine {
  readonly id: string;
  readonly type: (typeof folioPosting.$inferSelect)["type"];
  readonly amount: bigint;
  readonly description: string;
  readonly reversesPostingId: string | null;
  readonly parentPostingId: string | null;
}

/**
 * Issues the invoice for every account the desk has agreed and nobody has
 * invoiced.
 *
 * Registered in `jobs.module.ts` and owned here, the split that file describes:
 * the scheduler is machinery, and a job belongs to the requirement that asked
 * for it.
 */
@Injectable()
export class EInvoiceJob implements SweepJob {
  readonly name = "e-invoice";
  readonly schedule = EVERY_FIVE_MINUTES;

  constructor(
    @Inject(E_INVOICE_PORT) private readonly invoices: EInvoicePort,
    // The context is set on an injected `PinoLogger` rather than declared with
    // `@InjectPinoLogger`, for the evaluation-order reason `job-runner.service.ts`
    // sets out where it does the same thing.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("EInvoiceJob");
  }

  /**
   * Answers with the folios whose reference it wrote.
   *
   * Oldest close first, so a backlog is worked through in the order the property
   * agreed the accounts rather than in whatever order the index hands them back.
   */
  async run(exec: DbExecutor): Promise<readonly string[]> {
    const awaiting = await exec
      .select({
        id: folio.id,
        bookingId: folio.bookingId,
        closedAt: folio.closedAt,
      })
      .from(folio)
      .where(and(eq(folio.state, "CLOSED"), isNull(folio.invoiceReference)))
      .orderBy(asc(folio.closedAt), asc(folio.id));

    const issued: string[] = [];

    // Sequential rather than `Promise.all`: every statement below is on the
    // runner's one connection inside its one transaction, and each of them is
    // also a round trip to whoever issues the property's invoices.
    for (const account of awaiting) {
      const buyerName = await this.buyer(exec, account.bookingId);

      if (!buyerName) {
        this.logger.warn(
          { folio: account.id, booking: account.bookingId },
          "a closed account has no primary registration, so there is nobody to address its invoice to — it stays uninvoiced until the stay is registered",
        );
        continue;
      }

      const invoice = await this.invoices.issue({
        folioId: account.id,
        buyerName,
        // Not null: `folio_closed_at_exactly_when_closed` makes the two
        // inseparable, and the predicate above selected on the state.
        closedAt: account.closedAt!,
        lines: invoiceLines(await this.ledger(exec, account.id)),
      });

      // Conditional, and it is the second half of the idempotency. The
      // predicate that selected this folio is re-asserted at the moment of the
      // write, so a reference that landed between the two — a run this one
      // raced, a person writing one by hand — is left standing rather than
      // overwritten, and the id is not reported as work this pass did. The
      // trigger `migrations/0016` puts on the table refuses the overwrite
      // outright for the caller that does not write conditionally; this is why
      // the ordinary path never reaches it.
      const [written] = await exec
        .update(folio)
        .set({ invoiceReference: invoice.reference })
        .where(and(eq(folio.id, account.id), isNull(folio.invoiceReference)))
        .returning({ id: folio.id });

      if (written) {
        issued.push(written.id);
      }
    }

    return issued;
  }

  /**
   * Who the invoice is addressed to, or nothing.
   *
   * The booking holder by name — `schema/guest.ts` calls that registration "the
   * one the folio is addressed to" — and a stay may have several occupants, so
   * this is the one flagged primary and not the first row that came back.
   */
  private async buyer(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<string | null> {
    const [holder] = await exec
      .select({ name: guest.fullName })
      .from(registration)
      .innerJoin(guest, eq(guest.id, registration.guestId))
      .where(
        and(
          eq(registration.bookingId, bookingId),
          eq(registration.isPrimary, true),
        ),
      )
      .limit(1);

    return holder?.name ?? null;
  }

  /** Every line of the account, in the order a reader of it sees them. */
  private async ledger(
    exec: DbExecutor,
    folioId: string,
  ): Promise<readonly LedgerLine[]> {
    return await exec
      .select({
        id: folioPosting.id,
        type: folioPosting.type,
        amount: folioPosting.amount,
        description: folioPosting.description,
        reversesPostingId: folioPosting.reversesPostingId,
        parentPostingId: folioPosting.parentPostingId,
      })
      .from(folioPosting)
      .where(eq(folioPosting.folioId, folioId))
      .orderBy(
        asc(folioPosting.businessDate),
        asc(folioPosting.postedAt),
        asc(folioPosting.id),
      );
  }
}

/**
 * The account as an invoice states it: what was sold, and the tax on each sale.
 *
 * Three groups of rows never reach the document, and each for its own reason.
 *
 * **A corrected line and the correction that undid it.** Both are dropped, as a
 * pair, and the pair sums to nothing so the total is unchanged. The alternative
 * — printing a charge and its cancellation on the guest's invoice — states the
 * desk's typing as though it were something the guest bought. There is no
 * ambiguity about which reversals these are: `migrations/0016` refuses a posting
 * on a closed folio, so every correction on this account was made before the
 * account was agreed, and `FR-FOL-04`'s *điều chỉnh* — a reversal after the
 * invoice exists — cannot be one of them.
 *
 * **Money.** A payment and a refund are how the account was settled, not what
 * was billed. `FR-FOL-01`'s sign convention makes them the negative half of a
 * sum that comes to zero, and an invoice that listed them would total nothing.
 * What is left therefore totals exactly what the guest paid, which is the check
 * worth making on this function.
 *
 * **A tax line, as a line.** `FR-FOL-02` posts VAT as a row of its own because
 * §5 refuses to fold it into the charge, and the port asks for the same figure
 * the other way round — a charge together with the tax levied on it. So a VAT
 * row is added to its principal's `taxAmount` instead of standing alone.
 * `SERVICE_CHARGE_FEE` is not treated that way and stays a line: §5 has the
 * guest paying it, `system_config` can have VAT levied on top of it, and folding
 * it into the room would hide a charge the guest is entitled to see named.
 */
export function invoiceLines(
  postings: readonly LedgerLine[],
): readonly InvoiceLine[] {
  const corrected = new Set(
    postings.flatMap((line) =>
      line.reversesPostingId ? [line.reversesPostingId] : [],
    ),
  );

  const standing = postings.filter(
    (line) => line.type !== "REVERSAL" && !corrected.has(line.id),
  );

  const taxOn = new Map<string, bigint>();

  for (const line of standing) {
    if (line.type !== "VAT" || !line.parentPostingId) continue;

    taxOn.set(
      line.parentPostingId,
      (taxOn.get(line.parentPostingId) ?? 0n) + line.amount,
    );
  }

  return standing
    .filter(
      (line) =>
        line.type !== "VAT" &&
        line.type !== "PAYMENT" &&
        line.type !== "REFUND",
    )
    .map((line) => ({
      description: line.description,
      netAmount: line.amount,
      // Zero is a real answer and is written as one — §8 zero-rates some
      // supplies, and a service charge carries no tax of its own.
      taxAmount: taxOn.get(line.id) ?? 0n,
    }));
}
