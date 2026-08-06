// The configuration a posting reads, and the two refusals it makes — against a
// real Postgres.
//
// `config-storage.e2e-spec.ts` asserts what the table will and will not hold.
// This file asserts what is done with the row: which rate applies on which
// business date, what happens on a date the configuration does not cover, and
// that a value an `ADMIN` changed is read by the very next posting rather than
// by the one after a restart.
//
// The refusals are the reason it exists. `property-and-tariff.md` §8 files the
// VAT rate and the period the reduced rate covers as two separate answers the
// accountant still owes (`ASM-01`), so there is exactly one rate behind the
// window and nothing to fall back to outside it. A posting on a date the window
// has left behind therefore stops. That is a decision with a cost — the desk
// cannot charge until an `ADMIN` edits a row — and it is only defensible if it
// cannot be reached by accident and cannot be reached silently, which is what
// the cases below hold it to.
//
// The boot seed is exercised by booting the application, because "at boot" is
// the claim. Everything after that constructs the seeder directly: idempotence
// across restarts, a production environment and a database that cannot be
// written are three states a second `app.init()` cannot arrange.
//
// The figures here are deliberately unreal — 12.34% VAT, 3.21% service charge, a
// day rolling at 11:00, a relief window in 2077. §8 forbids the tree from
// carrying a rate, and a fixture that read like a plausible one would be the
// same defect wearing a test's clothes.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
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
import { SystemConfigSeeder } from "../src/modules/system-config/system-config.seeder.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

type SystemConfigValues = typeof systemConfig.$inferInsert;

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED: SystemConfigValues = {
  vatRateBps: 1_234,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  // Not §2's 04:00, precisely so a reader cannot take this for the property's.
  businessDateRolloverHour: 11,
};

/** What an `ADMIN` edits a rate to, mid-stay, in the cases that watch for it. */
const EDITED_RATE_BPS = 4_321;

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
      vatRateBps: fromEnvironment.VAT_RATE_BPS,
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
    expect(await config.taxRules(db, SOME_DATE)).toEqual({
      vatRateBps: CONFIGURED.vatRateBps,
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
  it("covers every business date", async () => {
    // Null is unbounded, not missing. It is how a property runs until the
    // accountant answers: one configured rate, applying to every date, with no
    // relief period asserted — and so nothing refused.
    await store({ ...CONFIGURED, reducedVatFrom: null, reducedVatTo: null });

    for (const date of [parseDate("2001-01-01"), parseDate("2099-12-31")]) {
      expect((await config.taxRules(db, date)).vatRateBps).toBe(
        CONFIGURED.vatRateBps,
      );
    }
  });
});

describe("a reduced-VAT window that is set", () => {
  it("applies the rate on the dates it covers, its own ends included", async () => {
    await storeWindow();

    for (const date of [
      parseDate(WINDOW_OPENS),
      INSIDE_IT,
      parseDate(WINDOW_CLOSES),
    ]) {
      expect((await config.taxRules(db, date)).vatRateBps).toBe(
        CONFIGURED.vatRateBps,
      );
    }
  });

  it("refuses to post on a date before it opens", async () => {
    await storeWindow();

    const refusal = await refused(config.taxRules(db, DAY_BEFORE_IT_OPENS));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain(DAY_BEFORE_IT_OPENS.toString());
    expect(refusal.message).toContain(WINDOW_OPENS);
  });

  it("refuses to post on a date after it closes", async () => {
    // The case the property will actually meet: relief lapses on a stated date,
    // and the rate that replaces it is the accountant's unanswered question.
    // There is nothing behind the window, and a posting that quietly reused the
    // reduced rate would put a wrong tax figure on an invoice a third party
    // issued and cannot reissue.
    await storeWindow();

    const refusal = await refused(config.taxRules(db, DAY_AFTER_IT_CLOSES));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain(DAY_AFTER_IT_CLOSES.toString());
    expect(refusal.message).toContain(WINDOW_CLOSES);
  });

  it("says what somebody has to do about it", async () => {
    // A refusal nobody can act on is an outage. This one names the row and the
    // role that may edit it, because the person who reads it is at a front desk
    // and the person who can fix it is not.
    await storeWindow();

    const refusal = await refused(config.taxRules(db, DAY_AFTER_IT_CLOSES));

    expect(refusal.message).toContain("ADMIN");
    expect(refusal.message).toContain("system configuration");
  });

  it("refuses the clock nothing, because the clock has no window", async () => {
    // The rollover hour is read off the same row and is not a rate, so a lapsed
    // relief period must not stop the property knowing what day it is. A refusal
    // that spread from the tax figures to the business date would take down the
    // night audit as well as the posting.
    await storeWindow();

    expect(await config.businessDateRolloverHour(db)).toBe(
      CONFIGURED.businessDateRolloverHour,
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

describe("a configuration edited under a posting", () => {
  it("is read by the next posting and not by the next restart", async () => {
    await store(CONFIGURED);

    await db.transaction(async (tx) => {
      expect((await config.taxRules(tx, SOME_DATE)).vatRateBps).toBe(
        CONFIGURED.vatRateBps,
      );

      await tx.update(systemConfig).set({ vatRateBps: EDITED_RATE_BPS });

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
        await tx.update(systemConfig).set({ vatRateBps: EDITED_RATE_BPS });

        expect((await config.taxRules(tx, SOME_DATE)).vatRateBps).toBe(
          EDITED_RATE_BPS,
        );

        // Uncommitted, so a read on any other connection still sees the row as
        // it was — which is what an executor the caller did not supply gives.
        expect((await config.taxRules(db, SOME_DATE)).vatRateBps).toBe(
          CONFIGURED.vatRateBps,
        );

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect((await stored())?.vatRateBps).toBe(CONFIGURED.vatRateBps);
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
    VAT_RATE_BPS: String(CONFIGURED.vatRateBps),
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

/** The refusal a call provoked. Fails the test if the service accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the service posted on a date it should have refused");
}
