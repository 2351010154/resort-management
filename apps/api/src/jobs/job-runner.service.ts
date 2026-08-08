// The one door every sweep goes through, cron or human.
//
// Two callers reach a sweep: pg-boss's worker when the cron fires, and a manager
// holding `operations.night-audit-trigger` re-running a date by hand. They must
// not be two code paths. A manual run that skipped the locking the scheduled one
// takes, or a scheduled run that skipped the idempotency check, is a difference
// nobody discovers until the two meet on a night that mattered.
//
// ## Idempotency is established here, not promised by the sweep
//
// The requirement is that a second run over the same business date changes
// nothing. The usual way to buy that is a ledger — one row per job and business
// date behind a unique index, refusing the second run. There is no such table
// here, for two reasons.
//
// The first is that it would be wrong for half the sweeps. Hold expiry runs
// every few minutes, because a fifteen-minute TTL collected once at 04:00 would
// hold a room for a day; a ledger keyed on the business date would let it run
// once and then refuse for the next twenty-three hours. The distinction could be
// declared per job, but then the sweeps that need the guarantee least are the
// only ones that get it.
//
// The second is the real objection: a ledger prevents the second run without
// ever establishing that the sweep was idempotent. It answers "has this already
// happened?" when the question protecting inventory is "would doing it again
// change anything?" — and the two come apart precisely where it hurts, in a
// sweep that releases the same night twice inside one run.
//
// So this asks the second question directly. It runs the sweep; if the sweep
// touched anything, it runs it again inside the same transaction and requires
// the second pass to come back empty. A sweep that double-cancels, releases a
// night it already released or re-charges a stay announces itself on its first
// contact with real data, and is rolled back whole — rather than being inferred
// weeks later from a `sold_rooms` that drifted. The check is skipped when the
// first pass touched nothing, which is what most runs do: a pass that changed no
// row has already shown that this state produces no work, and re-asking would
// only spend a query to hear the same answer.
//
// What the second pass costs is one extra statement on the runs that did
// something. What it buys is that the property `prd-m4.md` asks for is a
// behaviour of the system rather than a line in a comment nobody re-reads.
//
// ## One run of a job at a time
//
// `pg_advisory_xact_lock` over the whole run, keyed on the job's name and
// released by the commit or the rollback — there is no unlock to forget. Two
// overlapping runs of the same sweep are otherwise entirely possible: a manager
// triggering the no-show sweep at 04:05 while the cron's own run is still in it.
// Both would read the same `CONFIRMED` bookings, and the loser would release
// nights the winner had already released. The lock makes the second wait and
// find nothing to do, which is the answer it should have had.
//
// ## Why the transaction is opened here
//
// `closure.controller.ts` states the rule this bends: the boundary belongs to
// the request, because the request knows what has to commit together. A job has
// no request. Its boundary is the run, and the run has two entry points, so the
// boundary lives at the thing they share. The rule the rest of the tree depends
// on is untouched — a sweep still takes an executor and still opens nothing.
//
// ## Which date "today" is, is resolved here too
//
// Both entry points can be asked to run over the day the property is currently
// having, and neither can answer that question itself: the rollover hour is a
// `system_config` row, so it is a read and it wants an executor. Resolving it
// here puts it inside the run's own transaction — one connection for the whole
// run, and the same snapshot the sweep works in — rather than making a
// controller open a transaction of its own to ask what day it is. A date the
// caller named is passed through untouched, which is what re-running a night
// that failed depends on.

import type { StayDate } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { PinoLogger } from "nestjs-pino";
import { TransactionRunner } from "../database/transaction-runner.js";
import { BusinessDateService } from "../modules/booking/business-date.service.js";
import {
  type JobRun,
  type JobTrigger,
  SWEEP_JOBS,
  type SweepJob,
} from "./sweep-job.js";

// Advisory locks are a single flat 64-bit space shared by everything in the
// database, so the key is namespaced by name rather than by a number somebody
// would have to keep a list of. `hashtext` is stable across sessions and
// versions, which is the only property required of it.
const LOCK_NAMESPACE = "mariva.job-runner";

/**
 * A sweep that did not settle. Thrown after the work is done and before it
 * commits, so nothing it did survives.
 */
export class NonIdempotentSweepError extends Error {
  constructor(job: string, residue: readonly string[]) {
    super(
      `Sweep ${job} is not idempotent: a second pass over the same transaction ` +
        `changed ${residue.length} further row(s) — ${residue.slice(0, 5).join(", ")}`,
    );
    this.name = "NonIdempotentSweepError";
  }
}

// The context is set on an injected `PinoLogger` rather than declared with
// `@InjectPinoLogger`, which is what the rest of the tree uses, and the reason
// is an evaluation order this module cannot rely on. That decorator only records
// the context in a set; the provider answering it is built when
// `LoggerModule.forRootAsync` is *called*, inside `app.module.ts`'s own
// decorator argument. Every class already loaded at that moment gets one, and
// any class loaded afterwards does not — so a module the root imports directly
// works, and the same module imported anywhere later is a provider Nest cannot
// resolve. `PinoLogger` itself is always registered, and setting the context
// here reads identically in the log.
@Injectable()
export class JobRunner {
  constructor(
    @Inject(SWEEP_JOBS) private readonly jobs: readonly SweepJob[],
    private readonly transactions: TransactionRunner,
    private readonly businessDates: BusinessDateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("JobRunner");
  }

  /** Every registered sweep, in registration order. */
  get all(): readonly SweepJob[] {
    return this.jobs;
  }

  /** The sweep answering to a name, or nothing. */
  find(name: string): SweepJob | undefined {
    return this.jobs.find((job) => job.name === name);
  }

  /**
   * Runs one sweep over one business date, and reports what it changed.
   *
   * Everything the sweep did is one commit with the lock that serialised it and
   * the pass that checked it. Anything thrown — the sweep's own refusal, a
   * deadlock, a sweep that failed to settle — rolls the whole run back, and the
   * caller decides whether that is a retry or a page.
   *
   * `null` for `on` is "the day the property is having", which is what the cron
   * always means and what a manual trigger means when nobody named a date. A
   * date given is the date used, so re-running last night is a re-run and not
   * another pass over today.
   */
  async run(
    job: SweepJob,
    on: StayDate | null,
    trigger: JobTrigger,
  ): Promise<JobRun> {
    const startedAt = Date.now();

    const { businessDate, affected } = await this.transactions.run(
      async (exec) => {
        await exec.execute(
          sql`select pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE}::text), hashtext(${job.name}::text))`,
        );

        // After the lock rather than before it. A run that waited behind another
        // one is asking what day it is *now*, and a sweep that fired at 03:59:59
        // and waited past the rollover should close the date it actually runs on
        // rather than the one it queued on.
        const businessDate = on ?? (await this.businessDates.current(exec));

        const touched = await job.run(exec, businessDate);

        if (touched.length > 0) {
          const residue = await job.run(exec, businessDate);

          if (residue.length > 0) {
            throw new NonIdempotentSweepError(job.name, residue);
          }
        }

        return { businessDate, affected: touched.length };
      },
    );

    // One line per run, including the empty ones. A sweep that quietly stopped
    // firing is the failure this log answers, and it cannot be seen in a log
    // that only records the runs that found work.
    this.logger.info(
      {
        job: job.name,
        businessDate: businessDate.toString(),
        trigger,
        affected,
        durationMs: Date.now() - startedAt,
      },
      "sweep completed",
    );

    return { job: job.name, businessDate, trigger, affected };
  }
}
