// The machinery the sweeps mount on, end to end — `prd-m4.md`'s third scope
// decision.
//
// The sweeps here are the spec's own even though the tree now has a real one in
// `hold-expiry-sweep.ts`, and they stay that way: what is under test is the
// machinery, and two of these exist to be wrong on purpose — one that never
// settles, and one whose cron the parser refuses. Neither defect can be staged
// on a sweep the property depends on. They are still real sweeps, set-based
// statements against a probe table this file creates and drops, running through
// the same runner, transaction and lock that `booking`'s does.
//
// The real registry is asserted where the real sweep is: `hold-expiry.e2e-spec.ts`
// boots the container and requires the sweep to be in it.
//
// The claims worth holding are all properties of the infrastructure rather than
// of any sweep:
//
// - the queue borrows the one pool, and stops before it is closed;
// - a run is idempotent, and a run that is not is refused rather than committed;
// - two runs of one sweep cannot process the same row twice;
// - a sweep that fails to register does not take the others with it;
// - the manual trigger is `MANAGER`+, takes an explicit business date, and runs
//   the sweep in the request so a test can assert on the outcome;
// - the scheduler does not run in a test process unless it is asked to.
//
// That last one is why this file turns it on deliberately: everything below it
// depends on a queue actually being installed, and no other spec should pay for
// that.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PinoLogger } from "nestjs-pino";
import type pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ENV, type Env, parseEnv } from "../src/config/env.js";
import {
  type Database,
  DRIZZLE,
  PG_POOL,
} from "../src/database/database.module.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import {
  JobRunner,
  NonIdempotentSweepError,
} from "../src/jobs/job-runner.service.js";
import { JobScheduler } from "../src/jobs/job-scheduler.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { SWEEP_JOBS, type SweepJob } from "../src/jobs/sweep-job.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const BUSINESS_DATE = parseDate("2027-06-10");

// 04:00 is the rollover hour, so nothing here fires during the run. The sweeps
// are reached by hand; the cron exists to be read back out of pg-boss.
const NEVER_DURING_THIS_RUN = "0 4 * * *";

/** Business dates the settling sweep was handed, oldest first. */
const datesSwept: string[] = [];

/**
 * A sweep that settles: it claims every unclaimed row and, run again, finds
 * none. The shape both real sweeps have — a predicate that excludes what the
 * last pass already did.
 */
const settling: SweepJob = {
  name: "probe-settling",
  schedule: NEVER_DURING_THIS_RUN,
  async run(exec, businessDate) {
    datesSwept.push(businessDate.toString());

    const claimed = await exec.execute(sql`
      update job_runner_probe
         set swept = true
       where not swept
      returning id::text as id
    `);

    return claimed.rows.map((row) => String(row.id));
  },
};

/**
 * A sweep that never settles, because it creates work instead of consuming it.
 * The exact defect the runner's second pass exists to catch: it looks like a
 * working sweep, reports plausible numbers, and quietly does its work twice.
 */
const unsettling: SweepJob = {
  name: "probe-unsettling",
  schedule: NEVER_DURING_THIS_RUN,
  async run(exec) {
    const inserted = await exec.execute(sql`
      insert into job_runner_probe (swept) values (true) returning id::text as id
    `);

    return inserted.rows.map((row) => String(row.id));
  },
};

/** A sweep whose schedule names a minute and an hour that do not exist. */
const misconfigured: SweepJob = {
  name: "probe-misconfigured",
  schedule: "99 99 99 99 99",
  async run() {
    return [];
  },
};

const MANAGER = {
  email: "quan.ly@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
  role: "MANAGER",
  password: "manager-password-42",
} as const;

const RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

let app: INestApplication;
let db: Database;
let pool: pg.Pool;
let runner: JobRunner;
let scheduler: JobScheduler;
let http: () => request.Agent;
let managerToken: string;
let receptionistToken: string;
let closed = false;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    // `JobsModule` alongside `AppModule` rather than inside it: the root module
    // registers domain modules as they are wired, and importing it twice is
    // deduplicated once it is.
    imports: [AppModule, JobsModule],
  })
    .overrideProvider(ENV)
    .useValue({ ...parseEnv(), JOBS_SCHEDULER_ENABLED: true })
    .overrideProvider(SWEEP_JOBS)
    .useValue([settling, unsettling, misconfigured])
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  pool = app.get<pg.Pool>(PG_POOL);
  runner = app.get(JobRunner);
  scheduler = app.get(JobScheduler);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  // The sweeps' table. Created here rather than in a migration because it is
  // this file's fixture and nothing in the product knows it exists.
  await db.execute(sql`
    create table if not exists job_runner_probe (
      id uuid primary key default gen_random_uuid(),
      swept boolean not null default false
    )
  `);
  await db.execute(sql`truncate job_runner_probe`);

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);
  await staff.create({ ...MANAGER });
  await staff.create({ ...RECEPTIONIST });

  managerToken = await signIn(MANAGER.email, MANAGER.password);
  receptionistToken = await signIn(RECEPTIONIST.email, RECEPTIONIST.password);
});

afterAll(async () => {
  if (!closed) await app?.close();
});

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

async function addProbeRows(count: number): Promise<void> {
  await db.execute(
    sql`insert into job_runner_probe (swept) select false from generate_series(1, ${count}::int)`,
  );
}

async function probeRowCount(): Promise<number> {
  const counted = await db.execute(
    sql`select count(*)::int as total from job_runner_probe`,
  );

  return Number(counted.rows[0]?.total);
}

async function scheduledCrons(): Promise<
  { name: string; cron: string; timezone: string }[]
> {
  const schedules = await db.execute(
    sql`select name, cron, timezone from pgboss.schedule order by name`,
  );

  return schedules.rows as { name: string; cron: string; timezone: string }[];
}

/** A scheduler built by hand, so a spec can boot one over a different registry. */
async function schedulerOver(
  jobs: readonly SweepJob[],
  enabled: boolean,
): Promise<JobScheduler> {
  // `PinoLogger` is transient, so each of these is its own instance — which is
  // what the container hands the real ones too.
  const [runnerLogger, schedulerLogger] = await Promise.all([
    app.resolve(PinoLogger),
    app.resolve(PinoLogger),
  ]);

  return new JobScheduler(
    { ...app.get<Env>(ENV), JOBS_SCHEDULER_ENABLED: enabled },
    pool,
    new JobRunner(
      jobs,
      app.get(TransactionRunner),
      app.get(BusinessDateService),
      runnerLogger,
    ),
    schedulerLogger,
  );
}

describe("the scheduler", () => {
  it("keeps its own tables out of the schema the migrations own", async () => {
    // The decision `job-scheduler.service.ts` argues for: pg-boss installs and
    // versions its own storage, in a schema `drizzle-kit` never diffs.
    const installed = await db.execute(sql`
      select 1 from information_schema.schemata where schema_name = 'pgboss'
    `);

    expect(installed.rows).toHaveLength(1);

    const queues = await db.execute(sql`select name from pgboss.queue`);
    const names = queues.rows.map((row) => String(row.name));

    expect(names).toEqual(
      expect.arrayContaining([settling.name, unsettling.name]),
    );
  });

  it("schedules each sweep in the property's zone, and one that fails to register takes nothing with it", async () => {
    const crons = await scheduledCrons();

    expect(crons).toEqual([
      {
        name: settling.name,
        cron: NEVER_DURING_THIS_RUN,
        timezone: PROPERTY_TIME_ZONE,
      },
      {
        name: unsettling.name,
        cron: NEVER_DURING_THIS_RUN,
        timezone: PROPERTY_TIME_ZONE,
      },
    ]);

    // The misconfigured one is absent, the other two are there, and the
    // application booted — which is the whole claim. A cron the parser rejects
    // must not take hold expiry down with it, because hold expiry is the sweep
    // holding rooms hostage while it is off.
    expect(scheduler.running).toBe(true);
  });

  it("stays off in a test process unless it is asked for", () => {
    const secrets = {
      DATABASE_URL: "postgres://postgres@localhost:5433/mariva_test",
      BETTER_AUTH_SECRET: "0".repeat(32),
      STAFF_JWT_SECRET: "1".repeat(32),
    };

    expect(
      parseEnv({ ...secrets, NODE_ENV: "test" }).JOBS_SCHEDULER_ENABLED,
    ).toBe(false);

    // Anywhere else it is on, because the cost of it being off is a hold that
    // never expires and nothing that reports it.
    expect(parseEnv({ ...secrets }).JOBS_SCHEDULER_ENABLED).toBe(true);

    // And it is still a switch: a test that wants the workers says so.
    expect(
      parseEnv({
        ...secrets,
        NODE_ENV: "test",
        JOBS_SCHEDULER_ENABLED: "true",
      }).JOBS_SCHEDULER_ENABLED,
    ).toBe(true);
  });

  it("does nothing at all when it is switched off", async () => {
    const off = await schedulerOver([settling], false);

    await off.onApplicationBootstrap();
    expect(off.running).toBe(false);

    // And stopping something that was never started is not an error.
    await expect(off.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  it("does not install a queue for an empty registry", async () => {
    const empty = await schedulerOver([], true);

    await empty.onApplicationBootstrap();
    expect(empty.running).toBe(false);
  });

  it("drops the cron of a sweep this build no longer has", async () => {
    // A schedule outlives the code that created it. A build that dropped a
    // sweep would otherwise leave pg-boss creating a job every night on a queue
    // no worker reads.
    const reduced = await schedulerOver([settling], true);

    await reduced.onApplicationBootstrap();
    expect(reduced.running).toBe(true);

    const crons = await scheduledCrons();
    expect(crons.map((each) => each.name)).toEqual([settling.name]);

    await reduced.beforeApplicationShutdown();
    expect(reduced.running).toBe(false);
  });
});

describe("running a sweep", () => {
  it("reports what it changed, and changes nothing the second time", async () => {
    await addProbeRows(4);

    const first = await runner.run(settling, BUSINESS_DATE, "MANUAL");
    expect(first.affected).toBe(4);

    // The property `prd-m4.md` asks for in one line: a second run over the same
    // business date changes nothing.
    const second = await runner.run(settling, BUSINESS_DATE, "MANUAL");
    expect(second.affected).toBe(0);

    expect(datesSwept.at(-1)).toBe(BUSINESS_DATE.toString());
  });

  it("refuses a sweep that does not settle, and keeps none of its work", async () => {
    const before = await probeRowCount();

    await expect(
      runner.run(unsettling, BUSINESS_DATE, "MANUAL"),
    ).rejects.toBeInstanceOf(NonIdempotentSweepError);

    // Rolled back whole. The sweep did insert rows — twice — and none of them
    // survived the refusal, which is the difference between a defect that is
    // reported and one that is absorbed into the data.
    expect(await probeRowCount()).toBe(before);
  });

  it("cannot process the same row twice when two runs overlap", async () => {
    await addProbeRows(6);

    const [left, right] = await Promise.all([
      runner.run(settling, BUSINESS_DATE, "MANUAL"),
      runner.run(settling, BUSINESS_DATE, "MANUAL"),
    ]);

    // Six rows, two runs, six claims. The advisory lock makes the second wait
    // and then find the work already done, rather than both reading the same
    // six rows and releasing six nights twice.
    expect(left.affected + right.affected).toBe(6);
  });
});

describe("triggering a sweep by hand", () => {
  async function trigger(
    token: string | null,
    job: string,
    body: Record<string, string> = {},
  ): Promise<request.Response> {
    const call = http().post(`/jobs/${job}/runs`);

    if (token) call.set("Authorization", `Bearer ${token}`);

    return await call.send(body);
  }

  it("is refused to a stranger holding no session", async () => {
    const response = await trigger(null, settling.name);

    expect(response.status).toBe(401);
  });

  it("is refused to a receptionist", async () => {
    // `operations.night-audit-trigger` is MANAGER and ADMIN. Re-running a night
    // is a decision about what the books say, not a front-desk act.
    const response = await trigger(receptionistToken, settling.name);

    expect(response.status).toBe(403);
  });

  it("answers a name nobody registered with the ones that are", async () => {
    const response = await trigger(managerToken, "probe-nonexistent");

    expect(response.status).toBe(404);
    // Whatever shape the refusal takes on the wire, it names the sweeps that
    // do exist — a 404 that leaves the operator guessing at a slug is worse
    // than no route at all.
    expect(JSON.stringify(response.body)).toContain(settling.name);
  });

  it("refuses a business date that is not one", async () => {
    const response = await trigger(managerToken, settling.name, {
      businessDate: "10-06-2027",
    });

    expect(response.status).toBe(400);
  });

  it("runs the sweep over the date it was given, and again over nothing", async () => {
    await addProbeRows(3);

    const first = await trigger(managerToken, settling.name, {
      businessDate: "2027-06-10",
    });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      job: settling.name,
      businessDate: "2027-06-10",
      affected: 3,
    });

    const second = await trigger(managerToken, settling.name, {
      businessDate: "2027-06-10",
    });

    expect(second.body.affected).toBe(0);
  });

  it("falls back to the property's own business date", async () => {
    const today = (await app.get(BusinessDateService).current(db)).toString();

    const response = await trigger(managerToken, settling.name);

    expect(response.status).toBe(200);
    expect(response.body.businessDate).toBe(today);
    expect(datesSwept.at(-1)).toBe(today);
  });
});

describe("shutting down", () => {
  it("stops the queue before the pool it borrowed is closed", async () => {
    await db.execute(sql`drop table if exists job_runner_probe`);

    // `DatabaseModule` ends the pool in `onApplicationShutdown`, and the
    // scheduler stops in `beforeApplicationShutdown` — every hook of the second
    // kind runs before the first of the first kind. If that ordering were left
    // to the order modules were registered in, this would be a shutdown log
    // full of workers polling a pool that is already gone.
    await app.close();
    closed = true;

    expect(scheduler.running).toBe(false);
    await expect(pool.query("select 1")).rejects.toThrow();
  });
});
