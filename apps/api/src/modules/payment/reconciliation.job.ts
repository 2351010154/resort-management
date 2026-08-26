// The scheduled half of `FR-PAY-05`: fetching the gateway's side of a closed day,
// handing it to the comparison, and waking somebody when the two disagree.
//
// `reconciliation.service.ts` is the comparison and deliberately neither of the
// two things around it — it takes the report as an argument and it pages nobody.
// This is both of those, and it is a separate file for the reason that one gives:
// how a report is obtained is one gateway's problem, and who is on call is the
// property's, while what a disagreement *is* belongs to neither.
//
// ## One night, every gateway the property collects through
//
// The property has two providers and a night holds money from both, so this
// fetches a report from each of them and hands the comparison one list. That is
// the whole of what a second gateway costs here: `reconciliation.service.ts`
// takes the report as an argument and names no gateway, a discrepancy names the
// payment, and the payment already names its method — so nothing downstream of
// this file needs a column it did not have, and no screen or page has to learn
// that there are two of them.
//
// Which providers those are is `GatewayRegistry`'s answer and never a list
// written here. `FR-PAY-01` puts every implementation behind one port, and a
// sweep naming one would be the leak the port exists to prevent — it asks for
// what is bound rather than for a provider, and a deployment that has finished
// only one merchant onboarding reconciles what it can reach. Sequentially, in
// the registry's own order, so a night is fetched the same way every run.
//
// ## One of the two reports is assembled, because there is none to fetch
//
// VNPay's merchant API has no "everything you took on the 14th". It answers
// about one attempt at a time — `queryDr`, which `vnpay.adapter.ts` implements
// as `queryTransaction` — and the day's totals live in a settlement file drawn
// from the merchant portal by hand. So that report is reconstructed rather than
// received, and the thing that makes that sound is that this property mints
// every reference itself: `payment.service.ts` writes a `PENDING` row before the
// payer is sent anywhere, so every attempt that could possibly exist at the
// gateway has a row here naming it. Asking about each of them in turn produces
// exactly the report `reconcile` wants, in the port's own vocabulary.
//
// What that costs is one round trip per attempt per night, on a background
// connection, for a property whose trading day is counted in tens of gateway
// payments — the cost `e-invoice.job.ts` accepts in the same position and argues
// at length. What it buys is the case that matters: an attempt whose callback
// never arrived is a `PENDING` row here and money at the gateway, and it is
// found by asking about the row rather than by waiting for a file.
//
// A gateway that *can* answer about a window says so by implementing
// `settledBetween`, and then it is asked once for the whole night instead. That
// is not merely the cheaper call: a reconstruction can only ever find attempts
// this property already recorded, so money settled against a reference no row
// here names — `MISSING_LOCALLY`, the direction that leaves a guest charged with
// their folio still outstanding — is inside a fetched report and outside the
// reach of an assembled one. Both arrive as `GatewayTransaction` and both are
// then narrowed to the trading day the same way, so which of the two a provider
// gave is invisible from the comparison onwards.
//
// The attempts a gateway is asked about are its own, matched on the method the
// row records. A method is the property's word for how money reached the desk —
// `ports/gateway-registry.ts` argues that at length — and it is the same value
// the registry is keyed on, so nothing here has to invent an identifier to say
// which provider an attempt belongs to. Without it every gateway would be asked
// about every other gateway's attempts, which is a round trip spent to be told
// about a reference the provider has never seen.
//
// A failure to reach a gateway is not caught. It rolls the run back whole —
// `JobRunner`'s contract — which leaves the day with no `payment_reconciliation_
// run` row and therefore still outstanding, so the next tick simply does it
// again. Catching per attempt and carrying on would file a `MISSING_AT_GATEWAY`
// against every payment the gateway was too busy to answer about, which is a
// page about the property's own network.
//
// ## Only a closed day can be reconciled
//
// A trading day still being traded has payments in flight through it. A callback
// that is four seconds from arriving is, at the moment the report is read, money
// the gateway holds and this property does not — `MISSING_LOCALLY`, a row that
// `schema/reconciliation.ts` never edits, and a phone ringing at four in the
// morning about a payment that lands before anybody picks up.
//
// So this sweep never touches the date it is handed. It treats that date as the
// day the property is currently having — which is what `JobRunner` passes on the
// cron — and works on the closed days behind it, taking each one that has no
// `payment_reconciliation_run` row yet. A manual trigger naming a date shifts
// that window rather than breaking it: "reconcile whatever had closed as of the
// 8th" is a coherent request and is how a manager drains a backlog after an
// outage.
//
// The predicate is what makes the cron ordinary. `no-show-sweep.ts` refuses to
// compile the 04:00 rollover into a daily cron — the hour is configuration, and
// a pinned cron would be its second home — and the same argument applies here
// with more force, because this sweep is about the boundary itself. Hourly, and
// whichever tick first finds yesterday closed does the work; the other
// twenty-three find the row already written and do nothing.
//
// ## One sweep classifies against one rollover hour
//
// The hour is read once, at the top of the run, and the rule it defines is what
// dates every instant on both sides of every night this sweep looks at. It used
// to be asked of `BusinessDateService` per transaction here and per payment row
// in the comparison, which is a series of reads of a row an `ADMIN` may edit
// while the sweep is running — and the runner takes `read committed`, so the
// reads before that edit and the reads after it answer differently inside one
// transaction.
//
// What that costs is specific and silent. The gateway's side of a night is
// filtered by one boundary and the ledger's side by another, so a payment near
// the old hour lands in the report and not in the ledger; the comparison reports
// it as money the gateway holds that this property never recorded, a phone rings
// about a payment that is exactly where it should be, and the run row committed
// alongside it means no later sweep will look at that date again. Reading the
// hour once is the whole of the fix: the sweep may be drawn on an hour that was
// edited a second later, which is merely last night's boundary and is what the
// night actually traded under, and the next sweep reads the row again.
//
// ## Idempotency, and the two passes
//
// `JobRunner` runs a sweep that touched anything a second time inside the same
// transaction and requires the second pass to come back empty. This satisfies
// that in the strongest available form rather than by promising it: the first
// pass writes a run row per date it reconciled, and the second pass finds those
// dates no longer outstanding and returns nothing. The discrepancy rows
// underneath are held by their own unique key, so even a caller that reached
// past the predicate would write no duplicate — `reconciliation.service.ts`
// designed its insert for exactly this.
//
// The dates reconciled are what is returned, and not the discrepancies found. A
// clean day is work — somebody looked — and a sweep that reported nothing for it
// would be logged as having done nothing on the night it confirmed the money was
// right.

import type { GatewayPaymentMethod, StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import type { DbExecutor } from "../../database/database.module.js";
import { payment } from "../../database/schema/payment.js";
import { paymentReconciliationRun } from "../../database/schema/reconciliation.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import {
  type BusinessDateRule,
  BusinessDateService,
} from "../booking/business-date.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import type {
  GatewayTransaction,
  PaymentAttempt,
  PaymentGateway,
} from "./ports/payment-gateway.port.js";
import {
  type ReconciledAttempt,
  ReconciliationService,
} from "./reconciliation.service.js";

// Hourly, and `no-show-sweep.ts` makes the argument this inherits: the rollover
// hour is configuration, so a daily cron pinned a few minutes past it would be
// that number's second home and would reconcile the wrong day the morning after
// somebody moved it. Fifty past keeps it off the hour boundary, off the no-show
// sweep's twenty past and off the room charge's thirty-five.
const HOURLY = "50 * * * *";

// How far back an outstanding day is still picked up automatically.
//
// A bound is needed because "every closed day with no run row" is, on the
// morning this first deploys, every day since the property opened. A week
// absorbs an outage nobody noticed over a weekend and stops well short of
// re-querying a gateway about attempts whose records it may no longer hold.
// Older than this is a person's decision — the rows are still there to be
// compared, and nothing here decides on its own to go back a month.
const LOOK_BACK_DAYS = 7;

/**
 * Reconciles every closed business date the property has not yet looked at, and
 * pages about what it finds.
 *
 * Registered in `jobs.module.ts` and owned here, the split that file describes:
 * the scheduler is machinery, and a job belongs to the requirement that asked
 * for it.
 */
@Injectable()
export class ReconciliationJob implements SweepJob {
  readonly name = "payment-reconciliation";
  readonly schedule = HOURLY;

  constructor(
    private readonly registry: GatewayRegistry,
    private readonly reconciliation: ReconciliationService,
    private readonly businessDates: BusinessDateService,
    private readonly alerts: OpsAlertService,
    // The context is set on an injected `PinoLogger` rather than declared with
    // `@InjectPinoLogger`, for the evaluation-order reason
    // `job-runner.service.ts` sets out where it does the same thing.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ReconciliationJob");
  }

  /**
   * Answers with the business dates it reconciled, oldest first.
   *
   * `today` is the day the property is currently having and is never itself
   * reconciled — the header says why a day still being traded cannot be.
   */
  async run(
    exec: DbExecutor,
    today: StayDate,
  ): Promise<readonly string[]> {
    const outstanding = await this.outstanding(exec, today);
    const reconciled: string[] = [];

    // Read here and passed down, so that the report and the comparison it is
    // held against are drawn on one day boundary. The header says what a sweep
    // that read the hour again half-way through would file, page about, and
    // then mark as looked at.
    const dates = await this.businessDates.rule(exec);

    // Sequential, and for two reasons at once: every statement is on the
    // runner's one connection inside its one transaction, and each date is also
    // a series of round trips to the gateway.
    for (const businessDate of outstanding) {
      const report = await this.report(exec, businessDate, dates);

      const { compared, recorded } = await this.reconciliation.reconcile(
        exec,
        businessDate,
        report,
        dates,
      );

      // Written before the pages go out, so that a day is marked looked-at by
      // the same transaction that recorded what looking found. The alternative
      // — page first, mark after — buys nothing: both are inside one commit,
      // and a rollback takes the row and the discrepancies together.
      await exec
        .insert(paymentReconciliationRun)
        .values({ businessDate: businessDate.toString() });

      await this.pageFor(businessDate, compared, recorded);

      reconciled.push(businessDate.toString());
    }

    return reconciled;
  }

  /**
   * Every closed business date inside the look-back window that has no run row.
   *
   * Oldest first, so a backlog is worked through in the order the days happened
   * rather than in whatever order the index hands them back.
   */
  private async outstanding(
    exec: DbExecutor,
    today: StayDate,
  ): Promise<readonly StayDate[]> {
    const candidates: StayDate[] = [];

    for (let back = LOOK_BACK_DAYS; back >= 1; back--) {
      candidates.push(today.subtract({ days: back }));
    }

    const done = await exec
      .select({ businessDate: paymentReconciliationRun.businessDate })
      .from(paymentReconciliationRun)
      .where(
        inArray(
          paymentReconciliationRun.businessDate,
          candidates.map((date) => date.toString()),
        ),
      );

    const looked = new Set(done.map((row) => row.businessDate));

    return candidates.filter((date) => !looked.has(date.toString()));
  }

  /**
   * Every bound gateway's side of one business date, concatenated into one
   * list.
   *
   * Sequential over `registry.all()`, in the registry's own order — the header
   * says why: one round trip per attempt per night is a cost this sweep already
   * accepts, and a second gateway is a second pass over the same loop rather
   * than a second file. Which of the two ways a gateway answers is
   * {@link PaymentGateway.settledBetween}'s presence, decided once per gateway
   * and not per attempt.
   */
  private async report(
    exec: DbExecutor,
    businessDate: StayDate,
    dates: BusinessDateRule,
  ): Promise<readonly GatewayTransaction[]> {
    const taken: GatewayTransaction[] = [];

    for (const [method, gateway] of this.registry.all()) {
      // Bound to the adapter it came off, and the bind is load-bearing rather
      // than a style choice. An adapter reaches for its own client to answer a
      // window — `paypal.adapter.ts` opens with `this.paypal()` — and a method
      // lifted off the object and called on its own has no receiver to reach
      // through, so the call throws before a single transaction is fetched.
      // Nothing catches it per gateway, deliberately, so the whole run rolls
      // back and the night is never reconciled at all. A gateway written as a
      // closure would survive the lift and is exactly what makes this cheap to
      // miss in a fixture, which is why it is said here.
      const settledBetween = gateway.settledBetween?.bind(gateway);

      const settled = settledBetween
        ? await this.windowed(settledBetween, businessDate, dates)
        : await this.reconstructed(exec, method, gateway, businessDate, dates);

      taken.push(...settled);
    }

    return taken;
  }

  /**
   * A gateway's whole night, asked for in one answer and then narrowed to this
   * business date.
   *
   * The window handed to the gateway is coarse on purpose — a day out on either
   * side of the business date, the same range {@link
   * ReconciliationJob.attempts} bounds a reconstruction by — because what hour
   * the property actually rolls at is `dates`'s question and not the gateway's
   * to be told. The gateway's own answer is dated by its own clock, so the
   * narrowing below is the identical `dates.on(...).compare(businessDate)` the
   * reconstruction applies, over transactions instead of attempts.
   *
   * A refused or still-open transaction carries no time of payment and is
   * dropped here for the reason the reconstruction drops one too: `compare`
   * reads a refusal and an absence as the same claim, so keeping it changes no
   * outcome and only costs a date it cannot be dated by.
   */
  private async windowed(
    settledBetween: NonNullable<PaymentGateway["settledBetween"]>,
    businessDate: StayDate,
    dates: BusinessDateRule,
  ): Promise<readonly GatewayTransaction[]> {
    const settled = await settledBetween({
      from: startOfDayUtc(businessDate.subtract({ days: 1 })),
      until: startOfDayUtc(businessDate.add({ days: 2 })),
    });

    return settled.filter((transaction) => {
      if (transaction.status !== "SUCCESS") {
        return false;
      }

      return dates.on(transaction.paidAt).compare(businessDate) === 0;
    });
  }

  /**
   * One gateway's side of one business date, assembled one attempt at a time —
   * for a gateway that cannot answer about a window at all. The header argues
   * why this reconstruction is sound and what it costs.
   *
   * Only over this method's own attempts, so that a gateway is never asked
   * about a reference it has never seen — the header's argument about what that
   * would cost. The rest is `report`'s single-gateway ancestor unchanged: only
   * what the gateway says it *took*, dated into this business date by the
   * gateway's own clock, and a refused or still-open attempt dropped for
   * {@link ReconciliationJob.windowed}'s reason.
   */
  private async reconstructed(
    exec: DbExecutor,
    method: GatewayPaymentMethod,
    gateway: PaymentGateway,
    businessDate: StayDate,
    dates: BusinessDateRule,
  ): Promise<readonly GatewayTransaction[]> {
    const taken: GatewayTransaction[] = [];

    for (const attempt of await this.attempts(exec, method, businessDate)) {
      const transaction = await gateway.queryTransaction(attempt);

      if (transaction.status !== "SUCCESS") {
        continue;
      }

      const fellIn = dates.on(transaction.paidAt);

      if (fellIn.compare(businessDate) === 0) {
        taken.push(transaction);
      }
    }

    return taken;
  }

  /**
   * Every attempt this property opened under one method that could have been
   * paid on this date.
   *
   * The range is a bound and not a definition, exactly as
   * `reconciliation.service.ts` uses one on the other side: an attempt is opened
   * minutes before it is paid, so a window spanning the day before to the day
   * after contains every attempt whose payment could fall in this business date,
   * whatever hour the property rolls at. Which of them actually did is the
   * gateway's answer, filtered above.
   *
   * `method` narrows the same statement rather than being a second query,
   * because the two-gateway header's argument is precisely that a gateway is
   * asked about its own attempts and none of another's.
   *
   * `created_at` is the instant the gateway was handed, not this row's own —
   * `payment.service.ts` mints one value for both precisely so that the pair
   * below is the pair a reconstructing gateway will match a query on.
   */
  private async attempts(
    exec: DbExecutor,
    method: GatewayPaymentMethod,
    businessDate: StayDate,
  ): Promise<readonly PaymentAttempt[]> {
    const rows = await exec
      .select({
        reference: payment.attemptReference,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .where(
        and(
          eq(payment.method, method),
          isNotNull(payment.attemptReference),
          gte(payment.createdAt, startOfDayUtc(businessDate.subtract({ days: 1 }))),
          lt(payment.createdAt, startOfDayUtc(businessDate.add({ days: 2 }))),
        ),
      );

    // The guard is what tells TypeScript what the statement's predicate already
    // guaranteed — `reconciliation.service.ts` does the same on the same column.
    return rows.flatMap((row) =>
      row.reference === null
        ? []
        : [{ reference: row.reference, createdAt: row.createdAt }],
    );
  }

  /**
   * Wakes somebody about what this run wrote down, and only about that.
   *
   * `recorded` and not `compared`: a disagreement found again, already written
   * down last night, is not a second thing to wake anybody for, and
   * `reconciliation.service.ts` shapes its two lists around exactly this caller.
   * The amounts come from `compared`, which is where they are.
   *
   * Sequential and awaited rather than dispatched and forgotten. The pages are
   * few — a night with more than a handful of discrepancies is a night whose
   * first page is already the right one — and a floating promise inside a
   * transaction that is about to commit is a request nobody is left to observe.
   */
  private async pageFor(
    businessDate: StayDate,
    compared: readonly ReconciledAttempt[],
    recorded: readonly { readonly reference: string }[],
  ): Promise<void> {
    const byReference = new Map(
      compared.map((attempt) => [attempt.reference, attempt]),
    );

    for (const { reference } of recorded) {
      const attempt = byReference.get(reference);

      if (!attempt || attempt.outcome === "MATCHED") {
        // Unreachable by construction — every recorded row came from this same
        // comparison and a matched attempt is never written down. Logged rather
        // than thrown, because failing the run here would roll back the
        // discrepancies over a page that could not be composed.
        this.logger.error(
          { businessDate: businessDate.toString(), reference },
          "a recorded discrepancy has no comparison behind it, so nobody was paged about it",
        );

        continue;
      }

      await this.alerts.page({
        kind: "payment-discrepancy",
        text: sentenceFor(attempt, businessDate),
        details: {
          businessDate: businessDate.toString(),
          reference: attempt.reference,
          discrepancy: attempt.outcome,
          // đồng as strings: these are `bigint`, and a page is JSON. Passing the
          // value through `Number` is the loss `money.ts` refuses, and on the
          // one message whose entire purpose is to state a figure somebody will
          // go looking for.
          gatewayAmount:
            attempt.gatewayAmount === null
              ? null
              : attempt.gatewayAmount.toString(),
          ledgerAmount:
            attempt.ledgerAmount === null
              ? null
              : attempt.ledgerAmount.toString(),
          paymentId: attempt.paymentId,
        },
      });
    }
  }
}

/**
 * What the page says, in one sentence, before anybody opens a console.
 *
 * One per kind, because the three are different jobs for whoever is woken. Money
 * the gateway took that never reached an account is a guest owed a receipt and a
 * folio short by that amount; money this property recorded that the gateway does
 * not report is either a payment written against a gateway that never took it or
 * a report drawn early; and two figures that disagree is a terminal, a currency
 * scale or a merchant account pointed at a different property.
 *
 * Named "the gateway" throughout and never a provider — `ReconciledAttempt`
 * carries no method, because a discrepancy is a fact about a reference and an
 * amount and must not be able to reach for anything else, and this file's own
 * header says why a property with two providers cannot state which one a page is
 * about without asking the row it already names. `attempt.reference` is the key
 * a responder opens the payment on, and the payment's own record says which
 * gateway it was.
 */
export function sentenceFor(
  attempt: ReconciledAttempt,
  businessDate: StayDate,
): string {
  const day = businessDate.toString();

  switch (attempt.outcome) {
    case "MISSING_LOCALLY":
      return `The gateway took ${attempt.gatewayAmount} đồng on ${day} under ${attempt.reference} and this property has no payment for it — a guest has been charged and their folio still shows it outstanding`;

    case "MISSING_AT_GATEWAY":
      return `This property recorded ${attempt.ledgerAmount} đồng taken on ${day} under ${attempt.reference} and the gateway does not report it`;

    case "AMOUNT_MISMATCH":
      return `The gateway reports ${attempt.gatewayAmount} đồng under ${attempt.reference} on ${day} and this property recorded ${attempt.ledgerAmount}`;

    // `MATCHED` is excluded by the caller, and the exhaustive switch is what
    // makes an outcome added later fail to compile here rather than page a
    // sentence nobody wrote.
    case "MATCHED":
      return `${attempt.reference} on ${day} matched`;
  }
}

/**
 * Midnight UTC on a calendar date, as the bound of a coarse range.
 *
 * Not a business-date boundary and not read as one. `reconciliation.service.ts`
 * says the whole of it where it does the same thing on the other side of the
 * comparison.
 */
function startOfDayUtc(date: StayDate): Date {
  return new Date(`${date.toString()}T00:00:00Z`);
}
