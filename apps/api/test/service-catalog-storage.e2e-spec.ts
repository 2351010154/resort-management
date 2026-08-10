// The service catalog table, against a real Postgres.
//
// `src/database/schema/service.spec.ts` asserts what the declarations say. This
// file asserts what the database does with them, and it exists for one claim
// above the others: an item with no price and an item that costs nothing are
// different rows, and the difference survives storage.
// `property-and-tariff.md` §6 prices two of its eight items and leaves the
// other six to the owner, so a catalog that turned an unset price into zero
// would post a folio line for nothing and look like a comp nobody granted.
//
// It also states what §6 means by "the catalog grows without a migration": the
// eight seeded rows are data and a ninth is an insert. What is *not* data is
// the tax class — §5 gives every item one, and Postgres refuses a class the
// type does not have rather than storing a word a posting cannot resolve.
//
// The rows come from `SERVICE_CATALOG` — the same constant the seed writes —
// inserted here rather than by running the seed, because `seedDatabase` empties
// the property and the calendar before it writes, and a spec that did that
// halfway through the suite would pull the fixtures out from under the files
// that run after it. So this proves the eight items are §6's and that the
// database keeps them; the line in `seed.ts` that writes them belongs to the
// seed's own spec, which already runs `seedDatabase` once for every other claim
// it makes about the seeded property.
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
import * as schema from "../src/database/schema/index.js";
import { serviceCatalog } from "../src/database/schema/service.js";
import { SERVICE_CATALOG } from "../src/database/seed/property.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INVALID_TEXT_REPRESENTATION = "22P02";

// §6's eight, in §6's own words. Spelled out here rather than derived from the
// seed constant, because the assertion is that the seed says what the document
// says — a list computed from the thing under test would agree with itself.
const SECTION_SIX_ITEMS = [
  "Breakfast",
  "Laundry",
  "Minibar",
  "Airport transfer",
  "Late checkout",
  "Extra bed",
  "Spa treatment",
  "Local tour",
] as const;

// The two §6 prices today, both ⚑ proposed and both gross. Breakfast is per
// person per night and the extra bed is per night; the other six are unset and
// §6 says they block nothing.
const SECTION_SIX_PRICES = new Map<string, bigint>([
  ["Breakfast", 250_000n],
  ["Extra bed", 350_000n],
]);

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

// Emptied and rewritten per test, so each one starts from the eight rows the
// seed writes rather than from what the previous one left behind.
beforeEach(async () => {
  await db.execute(sql`delete from ${serviceCatalog}`);
  await db.insert(serviceCatalog).values([...SERVICE_CATALOG]);
});

afterAll(async () => {
  await pool?.end();
});

describe("the seeded catalog", () => {
  it("holds every item §6 names, exactly once", async () => {
    const stored = await db.select().from(serviceCatalog);
    const names = stored.map((item) => item.name).sort();

    expect(names).toEqual([...SECTION_SIX_ITEMS].sort());
    expect(new Set(names).size).toBe(SECTION_SIX_ITEMS.length);
  });

  it("prices the two §6 prices and leaves the other six unset", async () => {
    // Not "prices six at zero". §6 files them under §9 as the owner's, and the
    // difference between a price of nothing and no price at all is the whole
    // reason the column is nullable: one posts a line, the other refuses to.
    const stored = await db.select().from(serviceCatalog);

    for (const item of stored) {
      const quoted = SECTION_SIX_PRICES.get(item.name) ?? null;

      expect(item.unitPriceGross).toBe(quoted);
    }

    expect(
      stored.filter((item) => item.unitPriceGross !== null),
    ).toHaveLength(SECTION_SIX_PRICES.size);
  });

  it("returns a price as the same integer it was given", async () => {
    // The round trip §5 and `NFR-12` are about. A price that came back as
    // 250000.0, "250000" or 250 would still look like a number to whatever
    // multiplied it by a night count.
    const [breakfast] = await db
      .select()
      .from(serviceCatalog)
      .where(sql`${serviceCatalog.code} = 'BREAKFAST'`);

    expect(breakfast?.unitPriceGross).toBe(250_000n);
    expect(typeof breakfast?.unitPriceGross).toBe("bigint");
  });

  it("classes every item, so a posting has a rate to look up", async () => {
    // §5: every service item carries a tax class. An item without one would be
    // a charge `FR-FOL-02` could not decompose, and the column being `NOT NULL`
    // is what makes that unrepresentable rather than unlikely.
    const stored = await db.select().from(serviceCatalog);

    for (const item of stored) {
      expect(item.taxClass).toBe("STANDARD");
    }
  });

  it("offers every seeded item for sale", async () => {
    const stored = await db.select().from(serviceCatalog);

    expect(stored.every((item) => item.isActive)).toBe(true);
  });
});

describe("a price the catalog will not hold", () => {
  it("refuses a price of zero", async () => {
    // Zero is not a cheap service and it is not an unset one. A free service is
    // a comp, which is a folio adjustment — `rate_calendar` makes the same
    // argument about a free night — and stored here it would be a line the
    // folio prints for no money.
    const refusal = await refused(
      db.insert(serviceCatalog).values({
        code: "WELCOME_DRINK",
        name: "Welcome drink",
        unitPriceGross: 0n,
        taxClass: "STANDARD",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("service_catalog_price_positive_when_set");
  });

  it("refuses a negative price", async () => {
    // A negative charge is a credit, and a credit is a reversing entry on the
    // ledger rather than an item in the catalog. Sold as a service it would
    // reduce a folio every time somebody added it.
    const refusal = await refused(
      db.insert(serviceCatalog).values({
        code: "GOODWILL",
        name: "Goodwill",
        unitPriceGross: -50_000n,
        taxClass: "STANDARD",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("service_catalog_price_positive_when_set");
  });

  it("accepts an item nobody has costed yet", async () => {
    // The state six of §6's eight are in, and the one the constraint above must
    // not catch. `is null or > 0` reads as two rules and is one: a price, when
    // there is one, is money.
    await db.insert(serviceCatalog).values({
      code: "COOKING_CLASS",
      name: "Cooking class",
      unitPriceGross: null,
      taxClass: "STANDARD",
    });

    const [stored] = await db
      .select()
      .from(serviceCatalog)
      .where(sql`${serviceCatalog.code} = 'COOKING_CLASS'`);

    expect(stored?.unitPriceGross).toBeNull();
  });
});

describe("a code the catalog will not hold", () => {
  // The catalog is data and nothing edits it over HTTP, so a new item is a row
  // somebody writes by hand. `serviceCodeSchema` says what a code is and the
  // list endpoint parses every row it returns against it — so a row outside
  // that shape is not one item the desk cannot see, it is the whole list
  // failing to answer. These are the constraint that keeps the two agreeing.

  it("refuses a code that is not the handle the contract publishes", async () => {
    for (const code of ["cooking_class", "Cooking Class", "9_LIVES", "_LEAD"]) {
      const refusal = await refused(
        db.insert(serviceCatalog).values({
          code,
          name: "Cooking class",
          taxClass: "STANDARD",
        }),
      );

      expect(refusal.code).toBe(CHECK_VIOLATION);
      expect(refusal.constraint).toBe("service_catalog_code_is_a_handle");
    }
  });

  it("refuses a code longer than the wire will carry", async () => {
    const refusal = await refused(
      db.insert(serviceCatalog).values({
        code: "A".repeat(65),
        name: "A very long handle",
        taxClass: "STANDARD",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("service_catalog_code_is_a_handle");
  });

  it("takes the shapes §6's own items are written in", async () => {
    // The rule has to admit the seed it is imposed on: one word, and one with
    // the underscore `AIRPORT_TRANSFER` and `LATE_CHECKOUT` carry.
    await db.insert(serviceCatalog).values([
      { code: "SPA2", name: "Spa, second room", taxClass: "STANDARD" },
      { code: "BICYCLE_HIRE_2H", name: "Bicycle hire", taxClass: "STANDARD" },
    ]);

    const stored = await db.select().from(serviceCatalog);

    expect(stored).toHaveLength(SECTION_SIX_ITEMS.length + 2);
  });

  it("refuses an item with no name to print", async () => {
    // A blank name is a folio line the guest reads as an empty row, and the
    // wire says an item has a name. Whitespace is the same absence typed.
    const refusal = await refused(
      db.insert(serviceCatalog).values({
        code: "NAMELESS",
        name: "   ",
        taxClass: "STANDARD",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("service_catalog_name_is_not_blank");
  });
});

describe("a tax class this property cannot price", () => {
  it("is refused by Postgres and not only by TypeScript", async () => {
    // §5 makes the class structure and §8 makes the rate configuration. The
    // classes that mean anything are the ones `system_config` can price, and it
    // prices one. A row claiming `REDUCED` would be a charge whose rate nothing
    // can resolve, and the type refuses it before a posting ever looks.
    const refusal = await refused(
      db.execute(sql`
        insert into service_catalog (code, name, tax_class)
        values ('SPA_PACKAGE', 'Spa package', 'REDUCED')
      `),
    );

    expect(refusal.code).toBe(INVALID_TEXT_REPRESENTATION);
  });

  it("cannot be a rate written into the class instead", async () => {
    // The shape the class exists to prevent: a number where a name belongs,
    // which would freeze whatever the statutory rate was on the day the row was
    // written and outlive the day it changed.
    const refusal = await refused(
      db.execute(sql`
        insert into service_catalog (code, name, tax_class)
        values ('SPA_PACKAGE', 'Spa package', '800')
      `),
    );

    expect(refusal.code).toBe(INVALID_TEXT_REPRESENTATION);
  });
});

describe("the catalog as data", () => {
  it("takes a ninth item without a migration", async () => {
    // §6's closing claim, asserted rather than trusted: "Items are data, so the
    // catalog grows without a migration."
    await db.insert(serviceCatalog).values({
      code: "BICYCLE_HIRE",
      name: "Bicycle hire",
      unitPriceGross: 150_000n,
      taxClass: "STANDARD",
    });

    const stored = await db.select().from(serviceCatalog);

    expect(stored).toHaveLength(SECTION_SIX_ITEMS.length + 1);
  });

  it("refuses a second item under one code", async () => {
    // A posting names an item by its code. Two rows under `BREAKFAST` would
    // make "the breakfast item" a question about which the query read first,
    // and the two could carry different prices.
    const refusal = await refused(
      db.insert(serviceCatalog).values({
        code: "BREAKFAST",
        name: "Breakfast buffet",
        unitPriceGross: 300_000n,
        taxClass: "STANDARD",
      }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });

  it("withdraws an item without losing it", async () => {
    // The alternative to deleting. A folio line names the row it charged for,
    // so a delete either fails against the key or takes the account of what a
    // past guest was charged for with it.
    await db.execute(
      sql`update service_catalog set is_active = false where code = 'MINIBAR'`,
    );

    const [minibar] = await db
      .select()
      .from(serviceCatalog)
      .where(sql`${serviceCatalog.code} = 'MINIBAR'`);

    expect(minibar?.isActive).toBe(false);
    expect(minibar?.name).toBe("Minibar");
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
