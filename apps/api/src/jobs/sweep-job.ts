// What a job is in this system, and why the shape is this narrow.
//
// A sweep is one question asked of the database on a schedule — "which holds
// have expired?", "which arrivals never arrived?" — and the answer written back
// by the same statement that asked it. Every part of the interface below exists
// to keep a sweep that and nothing else.
//
// **It takes an executor, like every other write in the tree.** A sweep never
// opens a transaction. `database.module.ts` makes the general argument; here
// there is a sharper one on top of it. The runner needs the sweep's work and its
// own proof that the work settled to be a single commit, so a sweep that opened
// a transaction of its own would commit half of what the runner has not finished
// deciding about.
//
// **It takes a business date and never reads a clock.** `FR-BOOK-04` says the
// no-show is driven by the business date and "never by a wall clock", and a
// sweep that called `new Date()` could not be re-run over a night that failed —
// not by a test, and not by the manager re-running it the next morning. Work
// that is genuinely about *now*, such as a hold's TTL, asks Postgres for `now()`
// instead: inside a transaction that is the transaction's own start time, so it
// is fixed for the whole run and identical on every connection.
//
// **It returns what it touched, not how many.** The runner establishes
// idempotency by running the sweep a second time and requiring an empty answer —
// `job-runner.service.ts` argues that at length. A count can be produced without
// doing the work; a list of ids falls out of the `returning` clause a set-based
// sweep already has to write, so the honest implementation is also the cheapest
// one to write.

import type { StayDate } from "@mariva/shared";
import type { DbExecutor } from "../database/database.module.js";

/**
 * DI token for every sweep the scheduler knows about.
 *
 * A token holding an array rather than each sweep discovered by decorator scan:
 * the registry is then a list in `jobs.module.ts` that can be read in one
 * glance, and a sweep that exists but was never registered is a missing line in
 * a file rather than a decorator somebody forgot on a class nothing points at.
 */
export const SWEEP_JOBS = Symbol("SWEEP_JOBS");

export interface SweepJob {
  /**
   * Stable identifier. It is also the pg-boss queue name and the key the
   * advisory lock is derived from, so it is a slug chosen once and never
   * renamed casually — a rename orphans the queue holding that job's history.
   */
  readonly name: string;

  /**
   * Standard five-field cron, read in the property's own zone rather than the
   * server's. A sweep tied to the business date has to fire relative to the
   * 04:00 rollover, and a container that moved to UTC would otherwise silently
   * run the previous night's sweep seven hours early.
   */
  readonly schedule: string;

  /**
   * Does the work, and answers with the id of every row it changed.
   *
   * Called inside the runner's transaction, possibly twice — see
   * `job-runner.service.ts`. An empty array means the sweep found nothing to do,
   * which is what most runs report.
   */
  run(exec: DbExecutor, businessDate: StayDate): Promise<readonly string[]>;
}

/** Which of the two doors a run came through. */
export type JobTrigger = "SCHEDULE" | "MANUAL";

/** What one completed run of a sweep amounted to. */
export interface JobRun {
  readonly job: string;
  readonly businessDate: StayDate;
  readonly trigger: JobTrigger;
  /** Rows the sweep changed. Zero is the ordinary answer. */
  readonly affected: number;
}
