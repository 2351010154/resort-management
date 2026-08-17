// The system configuration table, against a real Postgres.
//
// `src/database/schema/config.spec.ts` asserts what the declarations say. This
// file asserts what the database does with them, and it exists for one claim in
// particular: the figures `property-and-tariff.md` §8 forbids the tree from
// knowing are held to their scale by Postgres and not by the service that
// writes them. A rate of 80000 basis points and a rollover hour of 24 are both
// values a form could send; neither is storable.
//
// It also states the two things a key/value config table cannot: a
// configuration key this system does not have is refused structurally rather
// than by a constraint somebody could drop, and the reduced-VAT window is
// refused when it closes before it opens — an invariant across two values that
// only exists because both live in the same row.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the SQL under test is the SQL that
// will run in production. No Nest application is booted — the subject is the
// storage layer itself.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { systemConfig } from "../src/database/schema/config.js";
import * as schema from "../src/database/schema/index.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";
const UNDEFINED_COLUMN = "42703";

// What a boot seed would write from the environment. Provisional to the last
// digit — `ASM-01` is answered from published sources and not by a practising
// accountant — which is why they are values in a test fixture and a row in a
// table rather than anything the tree carries.
const SEEDED = {
  standardVatRateBps: 1_000,
  reducedVatRateBps: 800,
  reducedVatFrom: "2026-01-01",
  reducedVatTo: "2026-12-31",
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 500,
  businessDateRolloverHour: 4,
} as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
});

// The table holds at most one row by construction, so every test starts from
// none rather than from whatever the previous one left.
beforeEach(async () => {
  await db.execute(sql`truncate system_config`);
});

afterAll(async () => {
  await pool?.end();
});

describe("the seeded configuration", () => {
  it("comes back exactly as it was written", async () => {
    // The round trip is the point: a rate written as 800 is read as 800 and
    // not as 8, 0.08 or "800". A posting path multiplies whatever this
    // returns, so a type that shifted in storage would move every folio line
    // by two orders of magnitude and still look like a number.
    await db.insert(systemConfig).values(SEEDED);

    const [stored] = await db.select().from(systemConfig);

    expect(stored).toEqual({
      isTheConfiguration: true,
      standardVatRateBps: 1_000,
      reducedVatRateBps: 800,
      reducedVatFrom: "2026-01-01",
      reducedVatTo: "2026-12-31",
      vatIncludesServiceCharge: true,
      serviceChargeRateBps: 500,
      businessDateRolloverHour: 4,
      // Written by the columns rather than by `SEEDED`, which names none of
      // them. These are §7's own figures, and they are values in this
      // repository rather than values from an environment because §7 says they
      // are the developer's proposal until the owner tunes them. Đồng come back
      // as `bigint` for `money.ts`'s reason: an amount that arrived as a
      // `number` could be added to a count of stays and would compile.
      loyaltyPointsPerUnit: 1,
      loyaltyEarnUnitVnd: 10_000n,
      tierSilverStays: 2,
      tierSilverRevenueVnd: 15_000_000n,
      tierGoldStays: 4,
      tierGoldRevenueVnd: 40_000_000n,
      pointsExpireYearEnd: true,
    });
  });

  it("keeps the window open at either end", async () => {
    // Both ends nullable, because a relief period can genuinely be half-open and
    // because a property may claim none at all. What the *absence* of a window
    // then means for a rate is the service's question, not the column's:
    // `system-config.e2e-spec.ts` asserts that it resolves to the standard rate.
    await db
      .insert(systemConfig)
      .values({ ...SEEDED, reducedVatFrom: null, reducedVatTo: null });

    const [stored] = await db.select().from(systemConfig);

    expect(stored?.reducedVatFrom).toBeNull();
    expect(stored?.reducedVatTo).toBeNull();
  });

  it("refuses a row that leaves a rate for somebody else to supply", async () => {
    // No column here has a default, so a half-written configuration is not a
    // row with a rate nobody chose — it is not a row at all. This is the
    // database half of §8: a posting cannot read a tax rate the tree invented,
    // because the tree has none to invent and the table will not stand in for
    // it.
    const refusal = await refused(
      db.execute(sql`
        insert into system_config
          (vat_includes_service_charge, service_charge_rate_bps, business_date_rollover_hour)
        values (true, 500, 4)
      `),
    );

    expect(refusal.code).toBe(NOT_NULL_VIOLATION);
    // Which of the two rates Postgres names first is its physical column order
    // and not a decision this file makes, so the claim is that a VAT rate is
    // what stopped the write. The case below pins one column exactly.
    expect(refusal.column).toMatch(/vat_rate_bps$/);
  });

  it("refuses a row that supplies the reduced rate and not the standard one", async () => {
    // The half-configured shape the second column exists to make impossible.
    // Relief lapses back into the standard rate, so a row carrying only the
    // reduced one has no answer for any date outside the window — and, with no
    // window set, no answer for any date at all. Refused by the column rather
    // than discovered at a posting.
    const refusal = await refused(
      db.execute(sql`
        insert into system_config
          (reduced_vat_rate_bps, vat_includes_service_charge,
           service_charge_rate_bps, business_date_rollover_hour)
        values (800, true, 500, 4)
      `),
    );

    expect(refusal.code).toBe(NOT_NULL_VIOLATION);
    expect(refusal.column).toBe("standard_vat_rate_bps");
  });
});

describe("a configuration key this system does not have", () => {
  it("is refused by Postgres and not only by TypeScript", async () => {
    // The reason this table has typed columns rather than `(key, value)` rows.
    // An unknown key is not a `CHECK` a migration could drop or a list somebody
    // forgot to extend — there is nowhere for it to go, and Postgres says so
    // before any value is parsed.
    const refusal = await refused(
      db.execute(sql`
        insert into system_config
          (standard_vat_rate_bps, reduced_vat_rate_bps,
           vat_includes_service_charge, service_charge_rate_bps,
           business_date_rollover_hour, loyalty_earn_rate)
        values (1000, 800, true, 500, 4, 10000)
      `),
    );

    expect(refusal.code).toBe(UNDEFINED_COLUMN);
  });
});

describe("a figure outside its scale", () => {
  it("refuses a VAT rate above 100%", async () => {
    // 80000 is what 8% looks like when somebody enters it as basis points of a
    // percent instead of of the whole. It would multiply every tax line by
    // eight rather than by 0.08.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, reducedVatRateBps: 20_000 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_reduced_vat_rate_within_bounds",
    );
  });

  it("bounds the standard rate by a constraint of its own", async () => {
    // Two rates, two constraints. One `CHECK` naming both columns would refuse
    // the row without saying which figure was the typo, and the person reading
    // that message typed one of the two.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, standardVatRateBps: 20_000 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_standard_vat_rate_within_bounds",
    );
  });

  it("refuses a negative VAT rate", async () => {
    // A negative rate credits tax back to the guest on every line, which
    // balances and is wrong.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, reducedVatRateBps: -800 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_reduced_vat_rate_within_bounds",
    );
  });

  it("refuses a service charge above 100%", async () => {
    const refusal = await refused(
      db
        .insert(systemConfig)
        .values({ ...SEEDED, serviceChargeRateBps: 10_001 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_service_charge_rate_within_bounds",
    );
  });

  it("accepts a rate of zero at either", async () => {
    // Zero is a coherent configuration and not a typo: a zero-rated supply and
    // a property that levies no service charge are both real. Refusing them
    // would make the constraint a policy nobody wrote down.
    await db.insert(systemConfig).values({
      ...SEEDED,
      standardVatRateBps: 0,
      reducedVatRateBps: 0,
      serviceChargeRateBps: 0,
    });

    const [stored] = await db.select().from(systemConfig);

    expect(stored?.standardVatRateBps).toBe(0);
    expect(stored?.reducedVatRateBps).toBe(0);
    expect(stored?.serviceChargeRateBps).toBe(0);
  });

  it("refuses an hour that is not one", async () => {
    // 24 is what somebody means as midnight and writes as a count. It would
    // roll the business date on no hour at all — §2's clock stopping in a way
    // nothing reports.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, businessDateRolloverHour: 24 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("system_config_rollover_hour_is_an_hour");
  });
});

describe("the reduced-VAT window", () => {
  it("is refused when it closes before it opens", async () => {
    // An invariant across two values, which is only statable because both live
    // in one row. Split across two key/value rows it would need a trigger, or
    // it would need nobody to transpose the dates.
    const refusal = await refused(
      db.insert(systemConfig).values({
        ...SEEDED,
        reducedVatFrom: "2026-12-31",
        reducedVatTo: "2026-01-01",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_reduced_vat_window_opens_before_it_closes",
    );
  });

  it("accepts a window of one day", async () => {
    await db
      .insert(systemConfig)
      .values({ ...SEEDED, reducedVatFrom: "2026-07-01", reducedVatTo: "2026-07-01" });

    const [stored] = await db.select().from(systemConfig);

    expect(stored?.reducedVatFrom).toBe("2026-07-01");
  });
});

describe("§7's loyalty figures", () => {
  it("survives an edit the way the tax figures do, because nothing rewrites them", async () => {
    // The property that matters most about a default: it supplies the row that
    // did not have the column and then never speaks again. A figure the property
    // tuned is a plain `UPDATE`, and a default cannot reach back over it.
    await db.insert(systemConfig).values(SEEDED);
    await db
      .update(systemConfig)
      .set({ loyaltyEarnUnitVnd: 25_000n, tierGoldStays: 9 });

    const [stored] = await db.select().from(systemConfig);

    expect(stored?.loyaltyEarnUnitVnd).toBe(25_000n);
    expect(stored?.tierGoldStays).toBe(9);
  });

  it("refuses an earn unit of nothing, which no revenue can be divided by", async () => {
    // Zero đồng per point is not a program that earns nothing — it is a
    // division by zero at whatever accrues, which is a failure at the folio
    // close of a stay that has already happened.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, loyaltyEarnUnitVnd: 0n }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("system_config_loyalty_earn_unit_is_money");
  });

  it("refuses an earn rate that awards no points", async () => {
    // A program that runs, writes a ledger row per stay and awards nothing is
    // an outage that looks exactly like a working feature. §7 offers no way to
    // switch the program off, so there is no off value to express.
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, loyaltyPointsPerUnit: 0 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_loyalty_earns_at_least_a_point",
    );
  });

  it("refuses a first rung every guest is already standing on", async () => {
    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, tierSilverStays: 0 }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe(
      "system_config_silver_takes_at_least_one_stay",
    );
  });

  it("refuses a Gold rung below the Silver one, on either axis", async () => {
    // A ladder that collapses does not fail — every Silver guest is simply
    // already Gold, and the tier beneath stops existing while the configuration
    // still reads like a three-level program. Two constraints, because the
    // property correcting this typed one of the two figures.
    const stays = await refused(
      db
        .insert(systemConfig)
        .values({ ...SEEDED, tierSilverStays: 5, tierGoldStays: 3 }),
    );

    expect(stays.constraint).toBe("system_config_gold_stays_not_below_silver");

    const revenue = await refused(
      db.insert(systemConfig).values({
        ...SEEDED,
        tierSilverRevenueVnd: 40_000_000n,
        tierGoldRevenueVnd: 15_000_000n,
      }),
    );

    expect(revenue.constraint).toBe(
      "system_config_gold_revenue_not_below_silver",
    );
  });

  it("accepts a rung equal to the one below it on one axis", async () => {
    // A rung is reached by stays **or** by revenue, so each axis is compared
    // with its own. A property that raises the money bar and leaves the nights
    // alone still has a Silver tier: the guest who reaches the revenue and not
    // the nights stands on it.
    await db.insert(systemConfig).values({
      ...SEEDED,
      tierSilverStays: 3,
      tierGoldStays: 3,
      tierGoldRevenueVnd: 90_000_000n,
    });

    const [stored] = await db.select().from(systemConfig);

    expect(stored?.tierGoldStays).toBe(3);
    expect(stored?.tierGoldRevenueVnd).toBe(90_000_000n);
  });
});

describe("a second configuration", () => {
  it("collides with the first", async () => {
    // `FR-FOL-02` reads the rate, the window and the base rule together to
    // decompose one gross figure into three lines that sum back to it. Two rows
    // would make "the VAT rate" a question about which one a query read first,
    // and unlike the rate calendar there is no date or type to tell them apart.
    await db.insert(systemConfig).values(SEEDED);

    const refusal = await refused(
      db.insert(systemConfig).values({ ...SEEDED, reducedVatRateBps: 900 }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });

  it("cannot hide behind a different key", async () => {
    // The primary key is a boolean pinned to `true`, so the only value that
    // would not collide is one the `CHECK` refuses. Without the check, `false`
    // would be a second complete-looking configuration.
    const refusal = await refused(
      db.execute(sql`
        insert into system_config
          (is_the_configuration, standard_vat_rate_bps, reduced_vat_rate_bps,
           vat_includes_service_charge, service_charge_rate_bps,
           business_date_rollover_hour)
        values (false, 1000, 800, true, 500, 4)
      `),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("system_config_holds_exactly_one_row");
  });
});

type Refusal = { code: string; constraint?: string; column?: string };

/** The refusal a write provoked. Fails the test if the database accepted it. */
async function refused(write: Promise<unknown>): Promise<Refusal> {
  try {
    await write;
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE, constraint name and column out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed
 * to be one deep.
 */
function refusalOf(error: unknown): Refusal {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code, constraint, column } = current as Error & {
      code?: unknown;
      constraint?: unknown;
      column?: unknown;
    };

    if (typeof code === "string") {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
        column: typeof column === "string" ? column : undefined,
      };
    }
  }

  throw error;
}
