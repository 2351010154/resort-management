// pg-boss, and the four things this file exists to get right.
//
// The queue lives in Postgres — `tech-stack.md` rejects Redis and BullMQ because
// an enqueue there cannot join the transaction that decided to enqueue, and
// rejects a bare timer because "two instances close the books twice". What is
// left is a queue that is a table, which brings its own obligations.
//
// ## It borrows the pool
//
// `database.module.ts` says it outright: there is one `pg.Pool` in the process
// and pg-boss takes its workers from it. A second pool would mean two connection
// limits against a Neon compute that caps them, two idle-client failure modes to
// notice, and a job that cannot see the transaction that created it. pg-boss
// accepts any object with `executeSql`, so it is handed one that forwards to the
// pool, and it never learns how to open or close a connection of its own.
//
// ## It stops before the pool it borrowed is closed
//
// `beforeApplicationShutdown` rather than `onApplicationShutdown`, and that is
// the whole reason for the choice: Nest runs every `beforeApplicationShutdown`
// hook in the application before the first `onApplicationShutdown`, and
// `DatabaseModule` ends the pool in the latter. Leaving it to module ordering
// would work until somebody reordered `app.module.ts`, and the symptom would be
// a deploy whose last log lines are "Cannot use a pool after calling end" from a
// worker still polling a socket that is gone.
//
// ## pg-boss owns its own schema, deliberately
//
// This repository's position is that migrations emit real `.sql` and the SQL
// under test is the SQL that runs in production. That position is about *our*
// invariants — the exclusion constraint and the check constraints that make
// overselling unrepresentable — and none of them live in a queue table. pg-boss
// ships its schema as an internally versioned artefact it checks and migrates at
// `start()`; pinning that DDL into a repo migration would mean hand-copying
// vendor SQL, keeping its version row honest at every upgrade, and discovering a
// mismatch as a refusal to boot. It is created in its own `pgboss` schema, where
// `drizzle-kit` never looks and no migration of ours can collide with it.
//
// The test suite is unaffected, and that is not a coincidence: the manual
// trigger runs a sweep inline through `JobRunner` rather than by enqueuing one,
// so a spec never needs a queue to exist. `migrate()` over the committed
// migrations stays the whole story for every spec, which is also why the
// scheduler is off under `NODE_ENV=test` — see `JOBS_SCHEDULER_ENABLED`.
//
// If that decision is ever revisited, pg-boss exports `getConstructionPlans()`,
// which emits exactly the DDL it would otherwise run.
//
// ## Outbound mail rides on the same queue
//
// A sweep is not the only thing that must not happen inside a request.
// `mail-queue.service.ts` argues why a verification email is delivered from a
// worker rather than awaited by the sign-up that composed it; what belongs
// here is that it gets the *same* pg-boss, handed over once this file has
// started one. A second instance would mean a second supervisor maintaining
// the same tables, and a second lifetime to get right against the pool both
// borrow. `MailQueue` is told when the queue arrives and when it is taken
// away, and delivers messages from this process in between — so a build with
// no scheduler still sends mail, without the retry a queue would have given it.
//
// ## One sweep failing leaves the others alone
//
// Each sweep gets its own queue and its own worker, so a throw inside one is a
// failed job on that queue and nothing more. The same has to hold at
// registration, which is why the loop below registers each sweep in its own
// `try` — a cron expression the parser rejects must not take hold expiry down
// with it, because hold expiry is the one that is holding rooms hostage. A
// queue that cannot be started at all is not caught: no sweep runs then, and
// continuing quietly is exactly the silent failure the configuration comment on
// `JOBS_SCHEDULER_ENABLED` refuses to allow.

import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
// `pg` is CommonJS in an ESM package: the default import is the module object.
import type pg from "pg";
import { type Db, PgBoss } from "pg-boss";
import { ENV, type Env } from "../config/env.js";
import { PG_POOL } from "../database/database.module.js";
import { MailQueue } from "../modules/notification/mail-queue.service.js";
import { JobRunner } from "./job-runner.service.js";
import type { SweepJob } from "./sweep-job.js";

/** Where pg-boss keeps its tables. Ours are in `public`; these are not ours. */
const QUEUE_SCHEMA = "pgboss";

// A sweep fires on a cron, so the delay between the tick and the work is the
// only thing this interval decides — and a sweep is never in a hurry. Thirty
// seconds keeps the workers off a pool sized at ten for request traffic.
const POLLING_INTERVAL_SECONDS = 30;

// No retry. The next tick is the retry, and it is minutes away rather than
// seconds, which is the right pace for a sweep that failed because the database
// was busy. The failed job stays on the queue for a week, so what happened is
// still answerable afterwards.
const RETRY_LIMIT = 0;

// Long enough for the workers to finish the job in hand, short enough that a
// deploy is not held up by one. Anything still running is failed and picked up
// by the next process, which is safe precisely because a sweep is idempotent.
const STOP_TIMEOUT_MS = 10_000;

/**
 * pg-boss talking to the pool it was lent, and to nothing else.
 *
 * Without the private marker pg-boss puts on the database object it builds for
 * itself, `start()` and `stop()` both leave this alone — it is never opened and,
 * more importantly, never closed underneath `DatabaseModule`.
 */
function borrowedPool(pool: pg.Pool): Db {
  return {
    executeSql: (text, values) => pool.query(text, values as unknown[]),
  };
}

@Injectable()
export class JobScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private boss: PgBoss | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly runner: JobRunner,
    private readonly mail: MailQueue,
    // Contextualised here rather than declared with `@InjectPinoLogger` —
    // `job-runner.service.ts` says which evaluation order that decorator
    // depends on and why this module cannot assume it.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("JobScheduler");
  }

  /** Whether this process is running the sweeps. */
  get running(): boolean {
    return this.boss !== null;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_SCHEDULER_ENABLED) {
      this.logger.info(
        "scheduler disabled — no sweep runs in this process, and the manual trigger still does",
      );
      return;
    }

    // Nothing to schedule is not the same as a scheduler that failed to start,
    // and starting pg-boss anyway would install a schema to run an empty loop
    // against. Said out loud rather than passed over: a deployment whose sweeps
    // all failed to register would otherwise look identical to this.
    if (this.runner.all.length === 0) {
      this.logger.warn(
        "no sweeps registered — the scheduler has nothing to run",
      );
      return;
    }

    const boss = new PgBoss({
      db: borrowedPool(this.pool),
      schema: QUEUE_SCHEMA,
      // Stated rather than left to the default, because this is the decision
      // the header argues for: pg-boss brings its own schema up to date.
      migrate: true,
      supervise: true,
      schedule: true,
    });

    // pg-boss is an EventEmitter, and an unhandled `error` event takes the
    // process down — the same hazard `DatabaseModule` guards on the pool. A
    // queue that cannot reach the database must be a log line, not a restart
    // loop that also drops in-flight HTTP requests.
    boss.on("error", (error) => {
      this.logger.error({ err: error }, "job queue errored");
    });

    await boss.start();
    this.boss = boss;

    try {
      await this.mail.attach(boss);
    } catch (error) {
      // Caught for the same reason a sweep's registration is: the sweeps must
      // still run. Mail is not lost by this — `MailQueue` goes on delivering
      // from this process — so the cost is the retry, and that is worth a log
      // line rather than a boot that fails.
      this.logger.error(
        { err: error },
        "outbound mail has no worker — it will be delivered from this process, without retries",
      );
    }

    for (const job of this.runner.all) {
      try {
        await this.register(boss, job);
      } catch (error) {
        this.logger.error(
          { err: error, job: job.name },
          "sweep failed to register — the others are unaffected",
        );
      }
    }

    await this.forgetUnregisteredSchedules(boss);
  }

  async beforeApplicationShutdown(): Promise<void> {
    const boss = this.boss;

    if (!boss) return;

    this.boss = null;

    // Before the queue is stopped rather than after: a message put on a queue
    // whose workers are draining would sit there until the next process polls
    // it, and `MailQueue` delivers it here instead.
    this.mail.detach();

    try {
      // `close: false` is already pg-boss's behaviour for a borrowed database,
      // and saying it is how the next reader learns that this service does not
      // own the pool it handed over.
      await boss.stop({
        close: false,
        graceful: true,
        timeout: STOP_TIMEOUT_MS,
      });
    } catch (error) {
      // Swallowed on purpose. Everything after this hook still has to run —
      // the pool has yet to be drained — and a queue that could not be stopped
      // cleanly is not a reason to leave connections open behind it.
      this.logger.error({ err: error }, "job queue did not stop cleanly");
    }
  }

  private async register(boss: PgBoss, job: SweepJob): Promise<void> {
    // Created once and then left alone: pg-boss inserts the queue row on
    // conflict-do-nothing, so these options describe a queue the first time this
    // name is seen and are ignored on every boot after. Changing one later is
    // `updateQueue`, deliberately, and worth knowing before wondering why an
    // edit here did nothing.
    await boss.createQueue(job.name, {
      // One run of a sweep at a time. `JobRunner` takes an advisory lock that
      // would make a second run harmless anyway; this stops it being created.
      policy: "singleton",
      retryLimit: RETRY_LIMIT,
    });

    // Re-declared on every boot, and pg-boss upserts it, so the cron in the
    // code is the cron that runs. The timezone is the property's rather than
    // the container's: a sweep that keys off the business date has to fire
    // relative to the 04:00 rollover, and a host that came up in UTC would
    // otherwise run it seven hours into the previous night.
    await boss.schedule(job.name, job.schedule, null, {
      tz: PROPERTY_TIME_ZONE,
    });

    await boss.work(
      job.name,
      { pollingIntervalSeconds: POLLING_INTERVAL_SECONDS },
      async () => {
        // The scheduled run always asks what day it is now, which is what `null`
        // says — the runner resolves it inside the run's own transaction. A date
        // is only named explicitly by the person re-running one that failed.
        const run = await this.runner.run(job, null, "SCHEDULE");

        // Returned, not just logged: pg-boss stores it on the completed job,
        // which is where "what did last night's sweep actually do" is answered
        // a week later.
        return {
          affected: run.affected,
          businessDate: run.businessDate.toString(),
        };
      },
    );

    this.logger.info(
      { job: job.name, schedule: job.schedule, tz: PROPERTY_TIME_ZONE },
      "sweep scheduled",
    );
  }

  /**
   * Drops cron entries for sweeps this build no longer has.
   *
   * A schedule outlives the code that created it. Renaming a sweep, or dropping
   * one, otherwise leaves pg-boss faithfully creating a job every night on a
   * queue no worker reads — a table that grows until somebody goes looking for
   * why.
   */
  private async forgetUnregisteredSchedules(boss: PgBoss): Promise<void> {
    const registered = new Set(this.runner.all.map((job) => job.name));

    for (const schedule of await boss.getSchedules()) {
      if (registered.has(schedule.name)) continue;

      await boss.unschedule(schedule.name, schedule.key);
      this.logger.warn(
        { job: schedule.name },
        "removed the schedule of a sweep this build does not have",
      );
    }
  }
}
