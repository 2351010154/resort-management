// The configuration a posting reads, and which of the two VAT rates it resolves
// on a business date — against a real Postgres.
//
// `config-storage.e2e-spec.ts` asserts what the table will and will not hold.
// This file asserts what is done with the row: which rate applies on which
// business date, that no date is left without one, and that a value an `ADMIN`
// changed is read by the very next posting rather than by the one after a
// restart.
//
// The clock is here for the same reason the rates are. §2 promises that "a
// property that runs its audit at 06:00 changes one row, not a deploy", and the
// only way to hold `BusinessDateService` to that is to edit the row underneath a
// service that is already running and ask it again — which is what the cases
// under "the day the property is on" do, with the instant held fixed so that
// nothing but the row can have moved the answer.
//
// **Resolution is the reason it exists, and it used to be refusal.** The row
// once held one VAT rate, and a posting on a date outside a window that was set
// was stopped rather than charged a rate nobody had chosen. The column that
// would have been guessed now exists, so nothing is guessed — and the refusal
// was the worse shape anyway, because statutory relief lapses back into a
// standard rate rather than into no rate. Under the old arrangement, setting a
// window correctly guaranteed a stopped desk on the day the window closed. The
// cases below hold the replacement to both halves of the claim: the reduced rate
// on the dates the window covers, the standard rate on every other date, and
// neither call throwing on a date either side of an end.
//
// The boot seed is exercised by booting the application, because "at boot" is
// the claim. Everything after that constructs the seeder directly: idempotence
// across restarts, a production environment and a database that cannot be
// written are three states a second `app.init()` cannot arrange.
//
// The figures here are deliberately unreal — 12.34% reduced VAT against 24.68%
// standard, 3.21% service charge, a day rolling at 11:00, a relief window in
// 2077. §8 forbids the tree from carrying a rate, and a fixture that read like a
// plausible one would be the same defect wearing a test's clothes. The two rates
// are far apart on purpose: an assertion that a date resolved to one of them
// must be unable to pass by accident on the other.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Env, parseEnv } from "../src/config/env.js";
import type { Database } from "../src/database/database.module.js";
import {
  systemConfig,
  type SystemConfigRow,
} from "../src/database/schema/config.js";
import * as schema from "../src/database/schema/index.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { SystemConfigSeeder } from "../src/modules/system-config/system-config.seeder.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

type SystemConfigValues = typeof systemConfig.$inferInsert;

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED: SystemConfigValues = {
  standardVatRateBps: 2_468,
  reducedVatRateBps: 1_234,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  // Not §2's 04:00, precisely so a reader cannot take this for the property's.
  businessDateRolloverHour: 11,
};

/**
 * What an `ADMIN` edits a rate to, mid-stay, in the cases that watch for it.
 *
 * Distinct from both configured rates, so a case that expected the edit to be
 * read back cannot pass by resolving to the standard rate instead.
 */
const EDITED_RATE_BPS = 4_321;

/**
 * The audit hour a property moves to, and the reason it is earlier rather than
 * later: with one instant asked about across the edit, an hour on either side of
 * it is what makes the two answers different dates rather than the same one.
 */
const EARLIER_ROLLOVER_HOUR = 9;

/** A relief period, and a date on either side of each of its ends. */
const WINDOW_OPENS = "2077-03-01";
const WINDOW_CLOSES = "2077-09-30";
const DAY_BEFORE_IT_OPENS = parseDate("2077-02-28");
const DAY_AFTER_IT_CLOSES = parseDate("2077-10-01");
const INSIDE_IT = parseDate("2077-06-15");

/** Any date at all, for the cases where the window is not the subject. */
const SOME_DATE = parseDate("2077-05-05");

/** Thrown to roll a fixture transaction back without failing the case. */
class Rollback extends Error {}

const config = new SystemConfigService();

let pool: pg.Pool;
let db: Database;
let app: INestApplication;
let logger: PinoLogger;
let seededAtBoot: SystemConfigRow | undefined;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  // Migrated and emptied *before* the application starts, so the row observed
  // below is the one this boot wrote and not one a previous file left behind.
  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(sql`truncate system_config`);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  [seededAtBoot] = await db.select().from(systemConfig);

  // `PinoLogger` is transient, so this is an instance of its own — which is what
  // the container hands the real seeder too.
  logger = await app.resolve(PinoLogger);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe("the boot seed", () => {
  it("writes the row from the environment", () => {
    // Compared against `parseEnv` rather than against figures written out here:
    // a literal in this expectation would be a tax rate in the tree, which is
    // the one thing §8 forbids, and it would pass while disagreeing with the
    // environment the API actually booted with.
    const fromEnvironment = parseEnv();

    expect(seededAtBoot).toEqual({
      isTheConfiguration: true,
      standardVatRateBps: fromEnvironment.STANDARD_VAT_RATE_BPS,
      reducedVatRateBps: fromEnvironment.REDUCED_VAT_RATE_BPS,
      reducedVatFrom: fromEnvironment.REDUCED_VAT_FROM ?? null,
      reducedVatTo: fromEnvironment.REDUCED_VAT_TO ?? null,
      vatIncludesServiceCharge: fromEnvironment.VAT_INCLUDES_SERVICE_CHARGE,
      serviceChargeRateBps: fromEnvironment.SERVICE_CHARGE_RATE_BPS,
      businessDateRolloverHour: fromEnvironment.BUSINESS_DATE_ROLLOVER_HOUR,
    });
  });

  it("leaves an edited row alone on the next restart", async () => {
    // The property this turns on. The environment supplies the figures a
    // property starts with; the row is the authority from then on. A seed that
    // wrote on every boot would roll back every configuration change at the next
    // deploy — §8's mis-invoice, arriving through a restart.
    await store(CONFIGURED);

    await seederOver(db, parseEnv()).onApplicationBootstrap();

    expect(await stored()).toMatchObject(CONFIGURED);
  });

  it("seeds a production database, which the demo seed refuses to touch", async () => {
    // `seed.script.ts` will not run against `NODE_ENV=production`, because it
    // empties the property and every stay standing against it. This row is the
    // opposite case: it destroys nothing, and production is the environment it
    // matters most in.
    await db.execute(sql`truncate system_config`);
    await seederOver(db, productionEnvironment()).onApplicationBootstrap();

    expect(await stored()).toMatchObject({
      ...CONFIGURED,
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: WINDOW_CLOSES,
    });
  });

  it("does not take the boot down when it cannot write", async () => {
    // Unseeded, every posting refuses loudly and an `ADMIN` can still set the
    // row. Dead, the API answers nothing at all — including the health endpoint
    // and every route that has nothing to do with money. So the failure is an
    // `error` line rather than an exit, and this is the case that holds it there.
    const unreachable = new pg.Pool({
      connectionString: "postgres://nobody@127.0.0.1:1/nothing",
      connectionTimeoutMillis: 2_000,
    });

    try {
      const seeder = seederOver(
        drizzle({ client: unreachable, schema }),
        parseEnv(),
      );

      await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
    } finally {
      await unreachable.end();
    }
  });
});

describe("the figures a posting reads", () => {
  it("hands back the rate, the service charge and the tax base together", async () => {
    await store(CONFIGURED);

    // One call and one row, not three getters. Two reads can straddle a
    // committed `ADMIN` edit even inside one transaction — `READ COMMITTED`
    // takes a fresh snapshot per statement — and a decomposition computed half
    // under each configuration would not sum back to the gross figure it split.
    // One VAT rate comes back, not two. Which of the row's two it is has
    // already been settled by the date — no window here, so the standard one —
    // and a posting path handed both would be one that could pick the wrong one.
    expect(await config.taxRules(db, SOME_DATE)).toEqual({
      vatRateBps: CONFIGURED.standardVatRateBps,
      serviceChargeRateBps: CONFIGURED.serviceChargeRateBps,
      vatIncludesServiceCharge: CONFIGURED.vatIncludesServiceCharge,
    });
  });

  it("reads the property's clock off the same row", async () => {
    await store(CONFIGURED);

    expect(await config.businessDateRolloverHour(db)).toBe(
      CONFIGURED.businessDateRolloverHour,
    );
  });
});

describe("a reduced-VAT window nobody has set", () => {
  it("puts every business date on the standard rate", async () => {
    // Both ends null is a property stating it has no relief period — not one
    // whose relief is unbounded. Reading the absent window as covering
    // everything would charge a reduced rate to a property that never claimed
    // relief, which is the same mis-invoice as guessing, pointed the other way.
    await store({ ...CONFIGURED, reducedVatFrom: null, reducedVatTo: null });

    for (const date of [parseDate("2001-01-01"), parseDate("2099-12-31")]) {
      expect((await config.taxRules(db, date)).vatRateBps).toBe(
        CONFIGURED.standardVatRateBps,
      );
    }
  });
});

describe("a reduced-VAT window that is set", () => {
  it("applies the reduced rate on the dates it covers, its own ends included", async () => {
    await storeWindow();

    for (const date of [
      parseDate(WINDOW_OPENS),
      INSIDE_IT,
      parseDate(WINDOW_CLOSES),
    ]) {
      expect((await config.taxRules(db, date)).vatRateBps).toBe(
        CONFIGURED.reducedVatRateBps,
      );
    }
  });

  it("applies the standard rate on a date before it opens", async () => {
    // Relief that has not started yet is the standard rate, which is what the
    // property was charging the day before. Nothing here has to be invented and
    // nothing has to stop.
    await storeWindow();

    expect((await config.taxRules(db, DAY_BEFORE_IT_OPENS)).vatRateBps).toBe(
      CONFIGURED.standardVatRateBps,
    );
  });

  it("applies the standard rate on a date after it closes", async () => {
    // The case the property will actually meet: relief lapses on a stated date
    // and the rate reverts. This used to be a refusal, on the grounds that there
    // was no rate behind the window — which made a correctly configured window a
    // scheduled outage at the front desk. The rate behind it is now configured
    // beside it, so the lapse is a rate change and the desk keeps working.
    await storeWindow();

    expect((await config.taxRules(db, DAY_AFTER_IT_CLOSES)).vatRateBps).toBe(
      CONFIGURED.standardVatRateBps,
    );
  });

  it("changes rate across the closing date without throwing on either side", async () => {
    // The transition itself, asserted as one act. Two adjacent business dates,
    // two different rates, and neither call refused — a night audit that runs
    // across the boundary must not find one of its two dates unpriceable.
    await storeWindow();

    const lastDayOfRelief = await config.taxRules(db, parseDate(WINDOW_CLOSES));
    const firstDayAfter = await config.taxRules(db, DAY_AFTER_IT_CLOSES);

    expect(lastDayOfRelief.vatRateBps).toBe(CONFIGURED.reducedVatRateBps);
    expect(firstDayAfter.vatRateBps).toBe(CONFIGURED.standardVatRateBps);
    expect(lastDayOfRelief.vatRateBps).not.toBe(firstDayAfter.vatRateBps);
  });

  it("leaves no date without a rate, including far outside the window", async () => {
    // The property `taxRules` now holds absolutely: a date always resolves. The
    // service charge and the tax base come back untouched either way, because
    // neither has a window and only the VAT rate was ever the question.
    await storeWindow();

    for (const date of [
      parseDate("2001-01-01"),
      DAY_BEFORE_IT_OPENS,
      INSIDE_IT,
      DAY_AFTER_IT_CLOSES,
      parseDate("2099-12-31"),
    ]) {
      const rules = await config.taxRules(db, date);

      expect(rules.vatRateBps).toBeTypeOf("number");
      expect(rules.serviceChargeRateBps).toBe(CONFIGURED.serviceChargeRateBps);
      expect(rules.vatIncludesServiceCharge).toBe(
        CONFIGURED.vatIncludesServiceCharge,
      );
    }
  });

  it("answers the clock the same whichever side of the window a date is on", async () => {
    // The rollover hour is read off the same row and is not a rate, so a lapsed
    // relief period must never reach it. It has no window and takes no date.
    await storeWindow();

    expect(await config.businessDateRolloverHour(db)).toBe(
      CONFIGURED.businessDateRolloverHour,
    );
  });
});

describe("a reduced-VAT window with one end open", () => {
  it("runs the reduced rate from its opening date onwards", async () => {
    // Relief that has started with no announced end — the state a property is in
    // between an extension and the resolution that names its expiry.
    await store({
      ...CONFIGURED,
      reducedVatFrom: WINDOW_OPENS,
      reducedVatTo: null,
    });

    expect((await config.taxRules(db, DAY_BEFORE_IT_OPENS)).vatRateBps).toBe(
      CONFIGURED.standardVatRateBps,
    );
    expect((await config.taxRules(db, DAY_AFTER_IT_CLOSES)).vatRateBps).toBe(
      CONFIGURED.reducedVatRateBps,
    );
  });

  it("runs the reduced rate up to its closing date", async () => {
    // The mirror: an end that is known and a start that predates the system.
    await store({
      ...CONFIGURED,
      reducedVatFrom: null,
      reducedVatTo: WINDOW_CLOSES,
    });

    expect((await config.taxRules(db, DAY_BEFORE_IT_OPENS)).vatRateBps).toBe(
      CONFIGURED.reducedVatRateBps,
    );
    expect((await config.taxRules(db, DAY_AFTER_IT_CLOSES)).vatRateBps).toBe(
      CONFIGURED.standardVatRateBps,
    );
  });
});

describe("a database nobody has configured", () => {
  it("refuses to hand a posting any tax figures", async () => {
    // No row is what a table with no defaults produces from a half-supplied
    // configuration: not a row carrying a rate nobody chose, but no row at all.
    // A plain `Error` rather than a refusal a client could act on — this is not
    // a request anybody could have made differently.
    await db.execute(sql`truncate system_config`);

    await expect(config.taxRules(db, SOME_DATE)).rejects.toThrow(
      /system_config holds no row/,
    );
  });

  it("refuses to answer what day it is either", async () => {
    await db.execute(sql`truncate system_config`);

    await expect(config.businessDateRolloverHour(db)).rejects.toThrow(
      /system_config holds no row/,
    );
  });
});

describe("the day the property is on", () => {
  // §2's promise, and the one this file exists to hold the row to: "a property
  // that runs its audit at 06:00 changes one row, not a deploy". The instant is
  // fixed and only the row moves, so a service that had kept the hour anywhere —
  // in the environment it was seeded from, or in a field it read once at boot —
  // answers the same date twice and fails here.
  const DURING_THE_ARGUMENT = new Date("2077-05-05T03:30:00Z");

  it("moves when an ADMIN edits the hour, with nothing redeployed", async () => {
    const businessDates = new BusinessDateService(config);

    // 03:30Z is 10:30 in Ho Chi Minh City: before an 11:00 rollover, so the
    // property is still working the previous date.
    await store(CONFIGURED);

    expect((await businessDates.current(db, DURING_THE_ARGUMENT)).toString()).toBe(
      "2077-05-04",
    );

    // The edit an `ADMIN` makes, and nothing else. No restart, no new instance,
    // no second construction of the service — the same object is asked again.
    await db
      .update(systemConfig)
      .set({ businessDateRolloverHour: EARLIER_ROLLOVER_HOUR });

    expect((await businessDates.current(db, DURING_THE_ARGUMENT)).toString()).toBe(
      "2077-05-05",
    );
  });

  it("is read through the executor the caller is inside", async () => {
    // The same argument the tax figures make, and it lands harder here: a stay
    // is written with the business date stamped on it, so an hour read on
    // another connection could date a booking from a row the transaction that
    // writes it cannot see.
    const businessDates = new BusinessDateService(config);

    await store(CONFIGURED);

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(systemConfig)
          .set({ businessDateRolloverHour: EARLIER_ROLLOVER_HOUR });

        expect(
          (await businessDates.current(tx, DURING_THE_ARGUMENT)).toString(),
        ).toBe("2077-05-05");

        // Uncommitted, so the pool still sees the hour as it was.
        expect(
          (await businessDates.current(db, DURING_THE_ARGUMENT)).toString(),
        ).toBe("2077-05-04");

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });

  it("stops rather than guesses when nobody has configured the property", async () => {
    // The same refusal a posting gets, and for the same reason: an assumed
    // rollover hour is a business date nobody chose, stamped on every stay
    // taken until somebody noticed.
    await db.execute(sql`truncate system_config`);

    await expect(
      new BusinessDateService(config).current(db, DURING_THE_ARGUMENT),
    ).rejects.toThrow(/system_config holds no row/);
  });
});

describe("a configuration edited under a posting", () => {
  it("is read by the next posting and not by the next restart", async () => {
    await store(CONFIGURED);

    // No window is configured, so `SOME_DATE` resolves to the standard rate and
    // that is the column an `ADMIN` correcting "the VAT rate" would move.
    await db.transaction(async (tx) => {
      expect((await config.taxRules(tx, SOME_DATE)).vatRateBps).toBe(
        CONFIGURED.standardVatRateBps,
      );

      await tx
        .update(systemConfig)
        .set({ standardVatRateBps: EDITED_RATE_BPS });

      // Nothing is cached, so the change is visible immediately — `FR-FOL-02`
      // reads the rates "at posting time", and a value held between postings is
      // a rate an `ADMIN` changed and an invoice that did not notice.
      expect((await config.taxRules(tx, SOME_DATE)).vatRateBps).toBe(
        EDITED_RATE_BPS,
      );
    });

    expect((await config.taxRules(db, SOME_DATE)).vatRateBps).toBe(
      EDITED_RATE_BPS,
    );
  });

  it("is read through the caller's executor and not through a second one", async () => {
    // The reason every method takes a `DbExecutor`. A posting decomposes one
    // gross figure into charge, service charge and tax inside one transaction,
    // so the rate has to come from that transaction's snapshot, beside the rows
    // it is applied to. Read through the pool instead, it would arrive from
    // another connection's view of a row somebody is part-way through editing.
    await store(CONFIGURED);

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(systemConfig)
          .set({ standardVatRateBps: EDITED_RATE_BPS });

        expect((await config.taxRules(tx, SOME_DATE)).vatRateBps).toBe(
          EDITED_RATE_BPS,
        );

        // Uncommitted, so a read on any other connection still sees the row as
        // it was — which is what an executor the caller did not supply gives.
        expect((await config.taxRules(db, SOME_DATE)).vatRateBps).toBe(
          CONFIGURED.standardVatRateBps,
        );

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect((await stored())?.standardVatRateBps).toBe(
      CONFIGURED.standardVatRateBps,
    );
  });
});

/** The configuration, replacing whatever the last case left. */
async function store(values: SystemConfigValues): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(values);
}

/** The same configuration, with the relief period actually asserted. */
async function storeWindow(): Promise<void> {
  await store({
    ...CONFIGURED,
    reducedVatFrom: WINDOW_OPENS,
    reducedVatTo: WINDOW_CLOSES,
  });
}

async function stored(): Promise<SystemConfigRow | undefined> {
  const [row] = await db.select().from(systemConfig);
  return row;
}

/**
 * A deployed environment, built through the real schema.
 *
 * `parseEnv` rather than an object literal cast to `Env`, so the production
 * refusals in `config/env.ts` are satisfied here the way a deploy satisfies
 * them. The credentials are obvious placeholders: the seeder opens no gateway
 * and no mailbox, and it takes its database from the client it is handed rather
 * than from `DATABASE_URL`.
 */
function productionEnvironment(): Env {
  return parseEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://the-seeder-uses-the-client-it-is-given",
    BETTER_AUTH_SECRET: "placeholder-guest-realm-key-for-this-test",
    STAFF_JWT_SECRET: "placeholder-staff-realm-key-for-this-test",
    RESEND_API_KEY: "placeholder",
    GOOGLE_CLIENT_ID: "placeholder",
    GOOGLE_CLIENT_SECRET: "placeholder",
    STANDARD_VAT_RATE_BPS: String(CONFIGURED.standardVatRateBps),
    REDUCED_VAT_RATE_BPS: String(CONFIGURED.reducedVatRateBps),
    SERVICE_CHARGE_RATE_BPS: String(CONFIGURED.serviceChargeRateBps),
    VAT_INCLUDES_SERVICE_CHARGE: "true",
    BUSINESS_DATE_ROLLOVER_HOUR: String(CONFIGURED.businessDateRolloverHour),
    REDUCED_VAT_FROM: WINDOW_OPENS,
    REDUCED_VAT_TO: WINDOW_CLOSES,
  });
}

function seederOver(over: Database, env: Env): SystemConfigSeeder {
  return new SystemConfigSeeder(over, env, logger);
}
