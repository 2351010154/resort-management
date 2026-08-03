// The promotion constraints, against a real Postgres.
//
// `src/database/schema/pricing.spec.ts` asserts what the declarations say. This
// file asserts what the database does with them, because the claim being made
// is not that a service remembers to check — it is that a promotion which
// raises a price, or one whose window closes before it opens, cannot be stored.
// Only a database can answer that, so this suite applies the committed
// migrations and then tries to write rows the property could not honour.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the SQL under test is the SQL that
// will run in production.
//
// No Nest application is booted. Promotions carry no route yet — FR-PRC-03 asks
// for the modifier, and the surface that edits it rides `pricing.rate-plans`
// when it lands — so the storage layer is the whole subject here.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/database/schema/index.js";
import { promotion } from "../src/database/schema/pricing.js";

// The SQLSTATE codes Postgres answers with. Asserted by code rather than by
// message, because a message is localised and a code is the contract.
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

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

  // A clean slate, and only ever in the test database — `.env.test` is the
  // single place that decides which one that is. `promotion` hangs off nothing,
  // so it truncates alone.
  await db.execute(sql`truncate promotion restart identity cascade`);
});

afterAll(async () => {
  await pool?.end();
});

describe("a promotion's value", () => {
  it("stores §7's Silver discount as five points off", async () => {
    // The row §7 fixes at 5%. Written as a negative, the same sign
    // `rate_plan.percent_adjustment` uses for NONREF's ten — one direction
    // across both pricing tables rather than one per table.
    const [silver] = await db
      .insert(promotion)
      .values({
        code: "LOYALTY_SILVER",
        name: "Silver member discount",
        type: "PERCENTAGE",
        value: -5n,
        requiresLoyaltyTier: "SILVER",
      })
      .returning();

    expect(silver?.value).toBe(-5n);
    expect(silver?.requiresLoyaltyTier).toBe("SILVER");
    // Neither end of the window set: §7's discount runs until it is withdrawn.
    expect(silver?.validFrom).toBeNull();
    expect(silver?.validTo).toBeNull();
    expect(silver?.isActive).toBe(true);
  });

  it("stores §7's Gold discount as ten points off", async () => {
    const [gold] = await db
      .insert(promotion)
      .values({
        code: "LOYALTY_GOLD",
        name: "Gold member discount",
        type: "PERCENTAGE",
        value: -10n,
        requiresLoyaltyTier: "GOLD",
      })
      .returning();

    expect(gold?.value).toBe(-10n);
    expect(gold?.requiresLoyaltyTier).toBe("GOLD");
  });

  it("refuses a percentage that raises the price", async () => {
    // A modifier that added would be a surcharge, and a surcharge arriving
    // through the promotions path would quote a guest more than the calendar
    // they were shown.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "PEAK_UPLIFT",
        name: "Peak uplift",
        type: "PERCENTAGE",
        value: 15n,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_value_reduces_within_its_scale");
  });

  it("refuses a percentage of zero", async () => {
    // A promotion that changes nothing still shows in a quote as a line the
    // guest was offered. Stored, it is a campaign nobody can explain.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "NO_OP",
        name: "Nothing off",
        type: "PERCENTAGE",
        value: 0n,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_value_reduces_within_its_scale");
  });

  it("refuses a hundred percent off, because a free night is a comp", async () => {
    // `rate_calendar` already argues this for its own column: a night that
    // costs nothing is a folio adjustment, not a price. Discounting one to zero
    // through the pricing path would put it beyond the reach of that argument.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "FREE_NIGHT",
        name: "A night on the house",
        type: "PERCENTAGE",
        value: -100n,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_value_reduces_within_its_scale");
  });

  it("stores a fixed discount on the đồng scale, not the percent one", async () => {
    // 200,000 ₫ off. The same column the percentage rows use, bounded by the
    // other arm of the constraint — a figure the percent arm would have
    // refused outright.
    const [campaign] = await db
      .insert(promotion)
      .values({
        code: "EARLY_BIRD",
        name: "Early bird",
        type: "FIXED_AMOUNT",
        value: -200_000n,
        minNights: 3,
      })
      .returning();

    expect(campaign?.value).toBe(-200_000n);
    expect(campaign?.minNights).toBe(3);
  });

  it("refuses a fixed amount that raises the price", async () => {
    const refusal = await refused(
      db.insert(promotion).values({
        code: "SURCHARGE",
        name: "A surcharge wearing a promotion's name",
        type: "FIXED_AMOUNT",
        value: 200_000n,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_value_reduces_within_its_scale");
  });
});

describe("a promotion's validity window", () => {
  it("stores a campaign bounded at both ends", async () => {
    const [summer] = await db
      .insert(promotion)
      .values({
        code: "SUMMER_2026",
        name: "Summer 2026",
        type: "PERCENTAGE",
        value: -15n,
        validFrom: "2026-06-01",
        validTo: "2026-08-31",
      })
      .returning();

    expect(summer?.validFrom).toBe("2026-06-01");
    expect(summer?.validTo).toBe("2026-08-31");
  });

  it("accepts a window open at one end only", async () => {
    // "From the first of September, until further notice" is a campaign a
    // property runs. A constraint demanding both ends would refuse it.
    const [openEnded] = await db
      .insert(promotion)
      .values({
        code: "AUTUMN_ONWARDS",
        name: "Autumn onwards",
        type: "PERCENTAGE",
        value: -8n,
        validFrom: "2026-09-01",
      })
      .returning();

    expect(openEnded?.validFrom).toBe("2026-09-01");
    expect(openEnded?.validTo).toBeNull();
  });

  it("accepts a window open and closing on the same day", async () => {
    // A one-day flash sale. A constraint written with `>` instead of `>=`
    // would make the shortest campaign the property can run unstorable.
    const [flash] = await db
      .insert(promotion)
      .values({
        code: "FLASH_ONE_DAY",
        name: "One day only",
        type: "PERCENTAGE",
        value: -20n,
        validFrom: "2026-10-10",
        validTo: "2026-10-10",
      })
      .returning();

    expect(flash?.validFrom).toBe("2026-10-10");
    expect(flash?.validTo).toBe("2026-10-10");
  });

  it("refuses a window that closes before it opens", async () => {
    // Such a row applies on no date at all, and reads in a report as a
    // campaign nobody took up rather than as the typo it is.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "BACKWARDS",
        name: "Backwards window",
        type: "PERCENTAGE",
        value: -10n,
        validFrom: "2026-08-31",
        validTo: "2026-06-01",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_window_opens_before_it_closes");
  });
});

describe("a promotion's minimum stay", () => {
  it("refuses a minimum of zero nights", async () => {
    // Not a condition. It would apply to every stay while reading like a rule
    // that restricts one.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "ZERO_NIGHTS",
        name: "Stay no nights",
        type: "PERCENTAGE",
        value: -10n,
        minNights: 0,
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("promotion_minimum_at_least_one_night");
  });
});

describe("a promotion's code", () => {
  it("refuses a second row reusing one", async () => {
    // `LOYALTY_SILVER` was written at the top of this file. A duplicate would
    // make "the Silver discount" a question about which row a query read first.
    const refusal = await refused(
      db.insert(promotion).values({
        code: "LOYALTY_SILVER",
        name: "Silver, again",
        type: "PERCENTAGE",
        value: -7n,
      }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });
});

describe("withdrawing a promotion", () => {
  it("switches it off without taking the row with it", async () => {
    // A stay quoted under a campaign still has to be explicable after the
    // campaign ends, which a deleted row cannot do.
    const [pulled] = await db
      .update(promotion)
      .set({ isActive: false })
      .where(eq(promotion.code, "SUMMER_2026"))
      .returning();

    expect(pulled?.isActive).toBe(false);
    expect(pulled?.value).toBe(-15n);
  });
});

interface Refusal {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
}

/**
 * Runs a write that must fail and returns the refusal.
 *
 * A write that succeeds fails the test here rather than at a later assertion
 * reading an absent error, so "the database accepted it" is what the report
 * says instead of "cannot read properties of undefined".
 */
async function refused(write: Promise<unknown>): Promise<Refusal> {
  try {
    await write;
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE code and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed
 * to be one deep, because the day Drizzle adds a layer the assertions should
 * still describe the constraint rather than start reading `undefined`.
 */
function refusalOf(error: unknown): Refusal {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code, constraint } = current as Error & {
      code?: unknown;
      constraint?: unknown;
    };

    if (typeof code === "string") {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
