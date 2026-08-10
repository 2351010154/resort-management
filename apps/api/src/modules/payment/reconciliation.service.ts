// Holding the gateway's report for a trading day against the property's own
// record of it — `FR-PAY-05`.
//
// Two reports describe the same money and neither is checked against the other
// anywhere else. `payment.service.ts` records what a callback claimed, at the
// moment it claimed it, and its two notes about a disagreement say it "has to be
// reconciled by hand" — which, with no table and no comparison, means it is
// reconciled by nobody. The money that goes missing this way goes missing
// quietly: a callback that never arrived leaves a guest's account short and the
// gateway's statement long, and the property finds out when the bank
// reconciliation does, a month later, against a figure nobody can attribute.
//
// This file is the comparison, the writing-down, and the reading-back, and it is
// deliberately not the two things around them. It is not a job — `SweepJob`
// takes an executor and a business date and returns what it touched, and
// `reconcile` below is shaped to be called by exactly that without the job
// knowing anything about how the comparison works. It is not a route either:
// `payment.controller.ts` declares the two the matrix governs and turns what
// comes back into the wire's own spellings. And it does not page anybody:
// `FR-PAY-05` says a discrepancy pages a phone, the classification each one
// carries is what a pager would branch on, and who is on call is a question with
// its own answer somewhere else.
//
// ## Reading is the other half of writing it down, and lives here
//
// A discrepancy nobody can look at is a row that may as well not have been
// written — which is where `FR-PAY-05` stood until the two read methods below:
// the sweep filed the disagreement, `ops-alert.service.ts` woke the accountant,
// and the accountant had nowhere to go. So {@link ReconciliationService.runs}
// answers which days were held against the gateway's report and how much of each
// disagreed, and {@link ReconciliationService.reconciledDay} answers what the
// disagreements on one of them actually were.
//
// Both take an executor and neither writes, for the reason the whole table
// exists: what is on file is an observation of what a day looked like when it
// was looked at, and a reader that corrected, resolved or re-swept as it went
// would be erasing the evidence as it read it. Re-running a night is
// `jobs.ts`'s trigger, under the capability that governs a sweep.
//
// ## The report is handed in, and that is the seam
//
// `PaymentGateway` today asks about one attempt at a time — `queryTransaction`
// takes a `PaymentAttempt` — and there is no method that says "everything you
// took on the 14th". Adding one is adapter work: it is a different endpoint, a
// different pagination and a different set of credentials at every gateway, and
// `FR-PAY-01` means whatever it returns has to arrive in this property's
// vocabulary anyway.
//
// So the comparison takes the report as an argument, in the port's own
// `GatewayTransaction` terms. Nothing is lost by it and two things are gained:
// the caller that fetches the report — a nightly job today, a merchant statement
// somebody re-runs by hand next year — is not this file's business, and the
// classification can be exercised against a report written out in a test without
// a gateway, a network or a clock anywhere near it.
//
// ## Which money is on each side
//
// The gateway's side is the transactions in the report that say money moved.
// `GatewayTransaction` is a union precisely so that an attempt nobody paid
// carries no amount that could be mistaken for one, and the report's refusals
// and still-open attempts are not money — they are the absence of it, which is
// what the other side is then compared against.
//
// The ledger's side is every payment this property recorded as taken in that
// business date, under an attempt. "Under an attempt" is `attempt_reference is
// not null`, and that predicate is the definition rather than a filter that
// approximates one: `schema/payment.ts` states that the column is null on
// exactly the money the desk collected itself — the cash and the bank transfers
// — and non-null on exactly the money that went through a gateway. Testing the
// method instead would name `VNPAY` here, and `FR-PAY-06`'s second gateway would
// then be a change to this file as well as to the module that binds it.
//
// ## The business date, and the one implementation of it
//
// A trading day is not a calendar day — `property-and-tariff.md` §2 — and a
// reconciliation partitioned at midnight would report the same 01:30 payment
// missing on one day and unexplained on the next, every night. `payment` has no
// business date column, only the instant the gateway says it took the money, so
// the ledger's side is the payments whose `paid_at` falls in this business date.
//
// That mapping is `BusinessDateService`'s and is applied row by row, rather
// than being turned into a pair of timestamps here. The rollover hour is a row
// an `ADMIN` edits, that service is where the rule that reads it lives, and a
// window computed in this file would be the rule's second implementation —
// agreeing with the first until the morning somebody moved the hour. What the
// statement below does carry is a coarse range around the date, wide enough to
// contain the business date whatever that hour is: an index bound and not a
// definition, and every row it returns is then asked the real question.
//
// **The hour is read once and every row is classified against that one
// reading.** Asking the service per row looked free, on the grounds that the
// rows are read inside the caller's transaction and would all therefore see the
// same hour. They would not: the runner takes `read committed`, where every
// statement takes a fresh snapshot, so an `ADMIN` moving the hour part-way
// through is invisible to the reads before the edit and visible to the ones
// after it. A night classified half under one hour and half under another draws
// the gateway's side and the ledger's side of the same money on two different
// day boundaries, files discrepancies against payments that are exactly where
// they belong, pages somebody about them at four in the morning, and — because
// the sweep marks the date reconciled in the same transaction — leaves nothing
// that will ever look again.
//
// So the rule is an argument, and a required one. `reconciliation.job.ts` reads
// it once for a whole sweep, which is what puts the report it assembles and the
// ledger read here on the same boundary. Required rather than defaulted because
// a default is the same defect with a longer fuse: a caller that drew its report
// under one hour and left the argument out would get a second hour for the
// ledger, and nothing would say so. This class therefore reads no configuration
// at all — it is handed the boundary and applies it.
//
// ## Running it twice writes nothing twice
//
// `job-runner.service.ts` establishes idempotency by running a sweep a second
// time inside the same transaction and requiring the second pass to come back
// empty, and a manager re-running a night by hand is the same demand made
// slowly. So the insert is unguarded and `on conflict do nothing` over
// `(business_date, attempt_reference)`, and what comes back from `returning` is
// what this run actually wrote — nothing, on the second pass. A read followed by
// an insert would pass a sequential re-run and file the same discrepancy twice
// the first night two runs overlapped, which is the argument `payment.ts` makes
// about its own key and `schema/reconciliation.ts` repeats about this one.
//
// A discrepancy that has since been resolved — the missing callback finally
// arrived — reconciles as matched on the re-run and writes nothing, so the row
// already there stands. It is an observation of what the day looked like when it
// was looked at, and `schema/reconciliation.ts` says why nothing here goes back
// and edits one.
//
// ## Nothing here writes money
//
// It reads `payment` and writes `payment_discrepancy`. No payment row and no
// posting is inserted, updated or reversed, whatever the two reports say —
// a reconciliation that corrected what it found would be making the property's
// books agree with a gateway's by fiat, on no person's authority, and the
// disagreement it was written to surface would disappear as it recorded it.
//
// Every figure is `bigint` đồng end to end and the comparison is integer
// equality. There is no scaling, no rounding and no tolerance: `NFR-12` has no
// minor unit to be off by, and a discrepancy of one đồng is a real one.

import type { StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
  type SQL,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { payment } from "../../database/schema/payment.js";
import {
  type PaymentDiscrepancyKind,
  paymentDiscrepancy,
  paymentReconciliationRun,
} from "../../database/schema/reconciliation.js";
import type { BusinessDateRule } from "../booking/business-date.service.js";
import type { GatewayTransaction } from "./ports/payment-gateway.port.js";

/**
 * What holding one attempt's two reports together came to.
 *
 * `MATCHED` is here and is not a member of `PAYMENT_DISCREPANCY_KINDS`, which is
 * the asymmetry the table is built on: an agreement is an outcome and never a
 * row. Everything else is both.
 */
export type ReconciliationOutcome = "MATCHED" | PaymentDiscrepancyKind;

/** One attempt, as the two reports between them describe it. */
export interface ReconciledAttempt {
  /** The property's own name for the attempt — the only key both sides share. */
  readonly reference: string;

  readonly outcome: ReconciliationOutcome;

  /** đồng the gateway's report accounts for, or nothing where it names none. */
  readonly gatewayAmount: VndAmount | null;

  /** đồng this property recorded as taken, or nothing where it recorded none. */
  readonly ledgerAmount: VndAmount | null;

  /** The payment row, where there is one. Null is `MISSING_LOCALLY`. */
  readonly paymentId: string | null;
}

/**
 * A payment as the ledger's side of the comparison needs it.
 *
 * Three fields and not the row, because the comparison is about a reference and
 * a figure and must not be able to reach for anything else — a folio, a status,
 * a gateway id — which is also what makes it testable without a database.
 */
export interface LedgerPayment {
  readonly id: string;
  readonly reference: string;
  readonly amount: VndAmount;
}

/** A disagreement this run wrote down, and the row it now is. */
export interface RecordedDiscrepancy {
  readonly id: string;
  readonly reference: string;
  readonly kind: PaymentDiscrepancyKind;
}

/**
 * One business date reconciled.
 *
 * Two lists rather than one, because they answer different questions and a
 * single list could not say both. `compared` is every attempt either side
 * mentioned, classified — what a report or a screen reads. `recorded` is the
 * subset this run committed as new rows, which is empty on a re-run and is what
 * a caller with a phone number would page about; a discrepancy found again, and
 * already written down last night, is not a second thing to wake somebody for.
 */
export interface Reconciliation {
  readonly businessDate: StayDate;
  readonly compared: readonly ReconciledAttempt[];
  readonly recorded: readonly RecordedDiscrepancy[];
}

/**
 * The days one list may answer with.
 *
 * A property files one of these a night and never deletes one, so an unbounded
 * list is a response that grows for as long as the property trades. Rather over
 * a year, which is longer than any question anybody asks of a reconciliation
 * screen — and a day older than that is still reachable by naming the range it
 * falls in, which is what the two optional bounds are for.
 *
 * Exported so that a test asserting the ceiling asserts *this* ceiling. Written
 * out beside the assertion instead, it would be a second home for the number
 * and would go on passing against the old one the day somebody moved it.
 */
export const LONGEST_RUN_LIST = 400;

/** Which reconciled days to list. Both ends optional and both inclusive. */
export interface ReconciledDayRange {
  readonly from?: StayDate;
  readonly to?: StayDate;
}

/**
 * A day that was reconciled, and how much of it disagreed.
 *
 * The count is taken on every read. `schema/reconciliation.ts` refuses to store
 * it and gives the reason — a figure frozen at the moment of the sweep is the
 * same fact kept twice, on the one table whose purpose is to notice when two
 * copies of a fact have stopped agreeing.
 *
 * The date is the wire's own nine characters rather than a `CalendarDate`: it
 * comes straight out of a `date` column and goes straight onto the response, so
 * there is no crossing to make and nothing that would have to be made back.
 */
export interface ReconciliationRunSummary {
  readonly businessDate: string;
  readonly reconciledAt: Date;
  readonly discrepancyCount: number;
}

/**
 * The days that were looked at, and whether naming a narrower range would show
 * more of them.
 *
 * `hasMore` exists because {@link LONGEST_RUN_LIST} is a cap on the answer and
 * not on the question. A caller may name a range wider than the cap, and the
 * list it gets back is then the newest days in that range rather than the range
 * it asked about — a difference no amount of reading `runs` can recover, since
 * a list of exactly the ceiling is the same list either way. So the truncation
 * is stated rather than inferred, and a reader that has to be exact about a
 * long range knows to split it.
 */
export interface ReconciliationRunList {
  readonly runs: readonly ReconciliationRunSummary[];
  readonly hasMore: boolean;
}

/** One disagreement on file, as it was observed and never since edited. */
export interface ObservedDiscrepancy {
  readonly id: string;
  readonly attemptReference: string;
  readonly kind: PaymentDiscrepancyKind;
  readonly gatewayAmount: VndAmount | null;
  readonly ledgerAmount: VndAmount | null;
  readonly paymentId: string | null;
  readonly observedAt: Date;
}

/**
 * One reconciled day in full.
 *
 * The instant is carried beside the rows, and it is what makes an empty list
 * mean something: a day with no disagreements was looked at and found clean,
 * where a day nobody swept has no run at all and is not one of these.
 */
export interface ReconciledDay {
  readonly businessDate: string;
  readonly reconciledAt: Date;
  readonly discrepancies: readonly ObservedDiscrepancy[];
}

@Injectable()
export class ReconciliationService {
  /**
   * Compares the gateway's report for a business date against the payments this
   * property recorded in it, and writes down every disagreement.
   *
   * Takes an executor and opens no transaction, like every other write in the
   * tree: the caller knows what has to commit together, and a nightly job's
   * boundary is its whole run — `job-runner.service.ts` and
   * `transaction-runner.ts` between them make the argument.
   *
   * **`dates` is required, and it is required because a default is what the
   * defect was.** It is the day boundary this night is classified against, and
   * the caller supplies it because the caller is the one that drew the report
   * on the other side of the comparison. A parameter that could be left out
   * would read a second hour here — which is precisely the split the header
   * describes, still reachable by anybody who did not know to pass the first
   * one. Required, it is the compiler that says the two sides are the same
   * boundary, and there is nothing left for a later caller to remember.
   */
  async reconcile(
    exec: DbExecutor,
    businessDate: StayDate,
    report: readonly GatewayTransaction[],
    dates: BusinessDateRule,
  ): Promise<Reconciliation> {
    const compared = compare(
      report,
      await this.ledgerFor(exec, businessDate, dates),
    );

    // `flatMap` over a filter and a map, so that the narrowing is the compiler's
    // rather than a cast: inside the second branch `outcome` is one of the three
    // members the column has, and an outcome added later that is not a
    // discrepancy fails to compile here instead of reaching the enum.
    const rows = compared.flatMap((attempt) =>
      attempt.outcome === "MATCHED"
        ? []
        : [
            {
              businessDate: businessDate.toString(),
              attemptReference: attempt.reference,
              kind: attempt.outcome,
              gatewayAmount: attempt.gatewayAmount,
              ledgerAmount: attempt.ledgerAmount,
              paymentId: attempt.paymentId,
            },
          ],
    );

    if (rows.length === 0) {
      return { businessDate, compared, recorded: [] };
    }

    const recorded = await exec
      .insert(paymentDiscrepancy)
      .values(rows)
      // The unique key decides, not a look this method took first. On a re-run
      // every row collides and `returning` hands back none of them, which is
      // both the honest answer and the empty second pass the job runner
      // requires.
      .onConflictDoNothing({
        target: [
          paymentDiscrepancy.businessDate,
          paymentDiscrepancy.attemptReference,
        ],
      })
      .returning({
        id: paymentDiscrepancy.id,
        reference: paymentDiscrepancy.attemptReference,
        kind: paymentDiscrepancy.kind,
      });

    return { businessDate, compared, recorded };
  }

  /**
   * The days already held against the gateway's report, newest first, and how
   * much of each one disagreed.
   *
   * **A left join and not two queries**, because a clean day writes no
   * discrepancy at all: an inner join would drop exactly the days that went
   * right, and a screen showing only the days with exceptions on them cannot
   * tell "nothing went wrong on the 14th" from "nobody reconciled the 14th" —
   * which is the distinction the run table was added to make. `count` over the
   * joined id counts the rows and not the join's nulls, so a clean day comes
   * back as zero.
   *
   * Newest first and capped, which is the question this answers: an accountant
   * paged in the night is asking about last night. A day older than
   * {@link LONGEST_RUN_LIST} is reached by naming the range it falls in rather
   * than by paging back through every night the property has traded.
   *
   * **The cap is reported and not merely applied.** A range wider than the
   * ceiling comes back as the newest nights inside it, which is a different
   * answer from the one that was asked for and is indistinguishable from a
   * complete one — both are a list of exactly {@link LONGEST_RUN_LIST} days. So
   * one row beyond the ceiling is asked for, never returned, and its existence
   * becomes `hasMore`. That is the whole cost of letting a caller tell a full
   * answer from a truncated one, and the alternative is a screen that quietly
   * stops at a day the property went on trading past.
   *
   * The bounds are inclusive at both ends and either may be absent — the
   * contract says why — so the predicate is assembled from whichever arrived.
   */
  async runs(
    exec: DbExecutor,
    range: ReconciledDayRange,
  ): Promise<ReconciliationRunList> {
    const bounds: SQL[] = [];

    if (range.from) {
      bounds.push(
        gte(paymentReconciliationRun.businessDate, range.from.toString()),
      );
    }

    if (range.to) {
      bounds.push(
        lte(paymentReconciliationRun.businessDate, range.to.toString()),
      );
    }

    const listed = await exec
      .select({
        businessDate: paymentReconciliationRun.businessDate,
        reconciledAt: paymentReconciliationRun.reconciledAt,
        discrepancyCount: count(paymentDiscrepancy.id),
      })
      .from(paymentReconciliationRun)
      .leftJoin(
        paymentDiscrepancy,
        eq(
          paymentDiscrepancy.businessDate,
          paymentReconciliationRun.businessDate,
        ),
      )
      .where(bounds.length === 0 ? undefined : and(...bounds))
      .groupBy(
        paymentReconciliationRun.businessDate,
        paymentReconciliationRun.reconciledAt,
      )
      .orderBy(desc(paymentReconciliationRun.businessDate))
      // The extra row is the question "is there a day after these", asked as
      // part of the same statement rather than as a second count over the same
      // predicate. It is dropped below and never reaches a caller.
      .limit(LONGEST_RUN_LIST + 1);

    return {
      runs: listed.slice(0, LONGEST_RUN_LIST),
      hasMore: listed.length > LONGEST_RUN_LIST,
    };
  }

  /**
   * One day's disagreements, or nothing at all where the day was never
   * reconciled.
   *
   * **Two statements, and the first one is the whole point.** The run row is
   * asked for before the discrepancies, because an empty list is not an answer
   * on its own: a day that reconciled clean and a day the sweep never reached
   * both have no rows in `payment_discrepancy`, and only the run says which of
   * the two this is. `null` here is the second case, and the caller turns it
   * into a refusal rather than into an empty day.
   *
   * **The two of them agree without being one moment, and the sweep is what
   * makes that so.** They are read inside one transaction because
   * `transaction-runner.ts` puts every executor boundary at the controller and
   * a service opens none — not because a transaction fixes an instant to read
   * from. It does not: the runner takes Drizzle's default isolation, which is
   * `read committed`, so each statement below takes its own snapshot and a
   * commit landing between them is visible to the second.
   *
   * What rules out the answer that would matter — a day handed back as clean
   * that already had exceptions filed against it — is the order the sweep
   * writes in. `reconciliation.job.ts` inserts the run row *after* the
   * discrepancies for that date, inside the transaction that carries both, so
   * the run becomes visible only as part of a commit its rows are already in.
   * A reader that finds a run here is therefore reading after that commit, and
   * there is no interleaving where the first statement sees the run and the
   * second misses what it was committed alongside.
   *
   * Ordered by attempt reference, which is `compare`'s own order — so a day read
   * twice lists the same rows the same way, and a row's position does not move
   * when the same night is re-swept.
   */
  async reconciledDay(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<ReconciledDay | null> {
    const date = businessDate.toString();

    const [run] = await exec
      .select({ reconciledAt: paymentReconciliationRun.reconciledAt })
      .from(paymentReconciliationRun)
      .where(eq(paymentReconciliationRun.businessDate, date))
      .limit(1);

    if (!run) {
      return null;
    }

    const discrepancies = await exec
      .select({
        id: paymentDiscrepancy.id,
        attemptReference: paymentDiscrepancy.attemptReference,
        kind: paymentDiscrepancy.kind,
        gatewayAmount: paymentDiscrepancy.gatewayAmount,
        ledgerAmount: paymentDiscrepancy.ledgerAmount,
        paymentId: paymentDiscrepancy.paymentId,
        observedAt: paymentDiscrepancy.observedAt,
      })
      .from(paymentDiscrepancy)
      .where(eq(paymentDiscrepancy.businessDate, date))
      .orderBy(asc(paymentDiscrepancy.attemptReference));

    return {
      businessDate: date,
      reconciledAt: run.reconciledAt,
      discrepancies,
    };
  }

  /**
   * Every payment this property recorded as taken in this business date, under
   * an attempt.
   *
   * `paid_at` is the gateway's own clock — `schema/payment.ts` refuses to let
   * anything else fill it — so this is the money as the payer's side dated it,
   * which is the same basis the gateway's daily report is drawn on. The range in
   * the statement is a bound rather than the answer: it spans the day before to
   * the day after, which contains the business date whatever hour the property
   * rolls at, and `dates` is then asked the real question about each row. A null
   * `paid_at` fails the comparison on its own, so the money that never moved
   * needs no predicate of its own to exclude it.
   *
   * `dates` is applied and never re-read, so every row here is classified
   * against the one hour its caller settled on.
   */
  private async ledgerFor(
    exec: DbExecutor,
    businessDate: StayDate,
    dates: BusinessDateRule,
  ): Promise<readonly LedgerPayment[]> {
    const from = startOfDayUtc(businessDate.subtract({ days: 1 }));
    const until = startOfDayUtc(businessDate.add({ days: 2 }));

    const rows = await exec
      .select({
        id: payment.id,
        reference: payment.attemptReference,
        amount: payment.amount,
        paidAt: payment.paidAt,
      })
      .from(payment)
      .where(
        and(
          isNotNull(payment.attemptReference),
          gte(payment.paidAt, from),
          lt(payment.paidAt, until),
        ),
      );

    const taken: LedgerPayment[] = [];

    for (const row of rows) {
      // `reference` and `paid_at` are nullable columns whose nulls the
      // statement above has already excluded; the guard is what tells
      // TypeScript so.
      if (row.reference === null || row.paidAt === null) {
        continue;
      }

      const fellIn = dates.on(row.paidAt);

      if (fellIn.compare(businessDate) === 0) {
        taken.push({
          id: row.id,
          reference: row.reference,
          amount: row.amount,
        });
      }
    }

    return taken;
  }
}

/**
 * The whole of the classification: two reports in, one outcome per attempt out.
 *
 * Pure, and separated from the method above for that reason rather than for
 * tidiness. It reads no clock, opens no connection and knows no gateway, so
 * every case it can produce is reachable from a literal in a test — and the
 * cases are exactly the ones nobody can produce on demand against a real
 * gateway, which is money the property never heard about and two systems
 * disagreeing about a figure.
 *
 * Ordered by reference so that two runs over the same day produce the same list
 * in the same order, which is what makes the insert's row order stable and a
 * test's expectation writable. No two entries can share a reference: the ledger
 * side is unique on it by `payment_attempt_reference_unique_key`, the gateway
 * side by the refusal below, and an attempt on both sides is one entry.
 */
export function compare(
  report: readonly GatewayTransaction[],
  ledger: readonly LedgerPayment[],
): readonly ReconciledAttempt[] {
  const taken = moneyTaken(report);
  const compared: ReconciledAttempt[] = [];

  for (const recorded of ledger) {
    const gatewayAmount = taken.get(recorded.reference);

    // Consumed, so that what is left in the map afterwards is exactly the
    // gateway's side of the day that this property has no record of.
    taken.delete(recorded.reference);

    if (gatewayAmount === undefined) {
      // The report does not account for this money. Either the gateway never
      // took it and something here recorded that it did, or the report was
      // drawn before the transaction settled into it. A refusal or an
      // unfinished attempt in the report lands here too, and correctly: it says
      // the gateway holds no money under that reference, which is the same
      // claim as not mentioning it.
      compared.push({
        reference: recorded.reference,
        outcome: "MISSING_AT_GATEWAY",
        gatewayAmount: null,
        ledgerAmount: recorded.amount,
        paymentId: recorded.id,
      });

      continue;
    }

    compared.push({
      reference: recorded.reference,
      // Integer đồng on both sides, so this is equality and not a tolerance.
      outcome: gatewayAmount === recorded.amount ? "MATCHED" : "AMOUNT_MISMATCH",
      gatewayAmount,
      ledgerAmount: recorded.amount,
      paymentId: recorded.id,
    });
  }

  for (const [reference, gatewayAmount] of taken) {
    // Money the gateway says it holds, against an attempt this property has no
    // payment for. This is the direction that costs a guest: their card was
    // charged and their folio still shows the amount outstanding.
    compared.push({
      reference,
      outcome: "MISSING_LOCALLY",
      gatewayAmount,
      ledgerAmount: null,
      paymentId: null,
    });
  }

  return compared.sort((left, right) =>
    left.reference < right.reference ? -1 : 1,
  );
}

/**
 * What the report says the gateway actually took, by attempt.
 *
 * A report that names one attempt twice is refused rather than resolved. There
 * is no honest way to pick between two figures for one payment — taking the
 * later one would file a discrepancy against a number nobody can point at, and
 * summing them would invent a payment — and a gateway that sends a day's
 * transactions twice in one report has a problem this property cannot reconcile
 * around. `room-charge-sweep.ts` refuses an unpriced night the same way and for
 * the same reason: the alternative is inventing the figure.
 *
 * A non-positive amount is refused for the reason `payment_amount_is_positive`
 * exists — money of zero is not money, and a negative one is a ledger's sign
 * convention arriving in a report that does not carry one. Caught here rather
 * than at the insert, where it would surface as a check constraint naming a
 * column instead of as the unusable report it is.
 */
function moneyTaken(
  report: readonly GatewayTransaction[],
): Map<string, VndAmount> {
  const taken = new Map<string, VndAmount>();

  for (const transaction of report) {
    if (transaction.status !== "SUCCESS") {
      continue;
    }

    if (transaction.amount <= 0n) {
      throw new Error(
        `The gateway's report names ${transaction.amount} đồng taken under ` +
          `reference ${transaction.reference}, which is not an amount of money`,
      );
    }

    if (taken.has(transaction.reference)) {
      throw new Error(
        `The gateway's report names reference ${transaction.reference} more ` +
          "than once, so there is no single figure to reconcile it against",
      );
    }

    taken.set(transaction.reference, transaction.amount);
  }

  return taken;
}

/**
 * Midnight UTC on a calendar date, as the bound of a coarse range.
 *
 * Not a business-date boundary and not read as one anywhere. The property's day
 * starts at a configured hour in its own zone; this is a plain instant a
 * timestamp column can be compared against, chosen a day out on either side so
 * that the range contains the business date whatever that hour is.
 */
function startOfDayUtc(date: StayDate): Date {
  return new Date(`${date.toString()}T00:00:00Z`);
}
