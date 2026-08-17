// The catalog and the path that sells from it — `FR-FOL-03`, and
// `property-and-tariff.md` §6, against a real Postgres.
//
// `folio-service.e2e-spec.ts` asserts what one agreed figure becomes; this
// asserts where the figure comes from and what the line it lands on says about
// the item. Three claims carry the requirement:
//
// - a sold item posts with its catalog row named, which is what makes the class
//   on that row mean anything to `M8` and what the schema's biconditional
//   refuses to let a caller skip;
// - a **priced** item posts the catalog's figure and refuses the caller's, so
//   the published price cannot be edged by whoever reached the route;
// - an **unpriced** item requires one, because §6 leaves six of the eight unset
//   and a minibar is what was consumed rather than a list price.
//
// The fourth claim is the one that makes the catalog data rather than code: an
// item this file inserts at run time — a row no migration and no seed knows —
// posts exactly like the seeded ones. That is §6's "items are data, so the
// catalog grows without a migration", stated as a test rather than as a comment.
//
// Committed rather than rolled back, and cleaned on both edges, for the reason
// `folio-service.e2e-spec.ts` gives: `folio_posting` cannot be deleted, so the
// ledger is truncated in and out and no later file's seed finds a folio standing
// in front of the bookings it clears. The catalog is truncated with it — this
// file writes its own items and must not leave them for a suite that counts §6's
// eight.
//
// No Nest application is booted. Both services take their executor as an
// argument, so the subjects are reachable with a `new`.
//
// The rates are deliberately unreal, and are this file's own rather than a
// figure borrowed from the property: §8 forbids the tree from carrying a rate,
// and a fixture that read like a real one would be that defect wearing a test's
// clothes.

import { noAccrual } from "./accrual.js";
import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folioPosting } from "../src/database/schema/folio.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { serviceCatalog } from "../src/database/schema/service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { CatalogService } from "../src/modules/operations/catalog.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED = {
  standardVatRateBps: 1_000,
  reducedVatRateBps: 2_000,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 500,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

const BUSINESS_DATE = parseDate("2027-09-02");
const DEPARTURE_DATE = parseDate("2027-09-05");

/** An item the property has costed — the priced half of §6. */
const PRICED = {
  code: "BREAKFAST",
  name: "Breakfast",
  unitPriceGross: 250_000n,
  taxClass: "STANDARD",
} as const;

/** An item nobody has costed — the six §9 leaves to the owner. */
const UNPRICED = {
  code: "MINIBAR",
  name: "Minibar",
  unitPriceGross: null,
  taxClass: "STANDARD",
} as const;

/** Pulled from sale, and still nameable by every line that ever sold it. */
const WITHDRAWN = {
  code: "LOCAL_TOUR",
  name: "Local tour",
  unitPriceGross: 900_000n,
  taxClass: "STANDARD",
  isActive: false,
} as const;

/**
 * An item no migration and no seed knows — §6's "items are data".
 *
 * Its price is not a multiple of anything else here, so a line carrying it
 * cannot have been produced by any other row in this file.
 */
const ADDED_AFTER_DEPLOY = {
  code: "COOKING_CLASS",
  name: "Cooking class",
  unitPriceGross: 777_000n,
  taxClass: "STANDARD",
} as const;

const A_RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Trần Thị Mai",
} as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let catalog: CatalogService;
let deskId: string;
let roomTypeId: string;

// References are unique and every case here opens an account of its own.
// Counted rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );

  await store(CONFIGURED);

  // The catalog is emptied before this file writes its own, and the truncate is
  // the point rather than housekeeping: the cases below assert the *whole* list
  // the desk is offered, so §6's eight — left behind by whichever suite last
  // ran `seedDatabase` — would be seven items this file never wrote and one
  // colliding `BREAKFAST`. `folio_posting` names these rows, so the ledger goes
  // first; `clearTheLedger` above has already done it.
  await db.execute(sql`truncate service_catalog restart identity cascade`);
  await db
    .insert(serviceCatalog)
    .values([PRICED, UNPRICED, WITHDRAWN, ADDED_AFTER_DEPLOY]);

  const [created] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  roomTypeId = created!.id;

  const [staff] = await db
    .insert(staffUser)
    .values({
      ...A_RECEPTIONIST,
      role: "RECEPTIONIST",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  deskId = staff!.id;

  folios = new FolioService(db, new SystemConfigService(), noAccrual);
  catalog = new CatalogService();
});

afterAll(async () => {
  await clearTheLedger();
  await db.execute(sql`truncate service_catalog restart identity cascade`);
  await pool.end();
});

describe("what the desk may sell", () => {
  it("lists the active items by code", async () => {
    const items = await catalog.sellable(db);

    expect(items.map((item) => item.code)).toEqual([
      PRICED.code,
      ADDED_AFTER_DEPLOY.code,
      UNPRICED.code,
    ]);
  });

  it("carries the price a client needs to know it must supply one", async () => {
    const items = await catalog.sellable(db);
    const unpriced = items.find((item) => item.code === UNPRICED.code);

    // Null and not zero. The difference is what tells the desk which of the two
    // requests it owes, and `schema/service.ts` is emphatic that a zero here
    // would be a line saying something happened for nothing.
    expect(unpriced?.unitPriceGross).toBeNull();
    expect(
      items.find((item) => item.code === PRICED.code)?.unitPriceGross,
    ).toBe(PRICED.unitPriceGross);
  });

  it("withholds a withdrawn item without losing it", async () => {
    const items = await catalog.sellable(db);

    expect(items.map((item) => item.code)).not.toContain(WITHDRAWN.code);

    // Still in the table, which is the half that matters to a past guest's
    // invoice: withdrawing is a column and never a delete.
    const [row] = await db
      .select({ code: serviceCatalog.code })
      .from(serviceCatalog)
      .where(eq(serviceCatalog.code, WITHDRAWN.code));

    expect(row?.code).toBe(WITHDRAWN.code);
  });

  it("refuses a withdrawn item the same way it refuses one nobody sells", async () => {
    const withdrawn = await refused(catalog.sellableItem(db, WITHDRAWN.code));
    const invented = await refused(catalog.sellableItem(db, "NO_SUCH_ITEM"));

    expect(withdrawn.code).toBe("NOT_FOUND");
    expect(invented.code).toBe("NOT_FOUND");
  });
});

describe("a catalog item sold to a stay", () => {
  it("posts at the catalog's price, times the count", async () => {
    const { folioId } = await anAccount();
    const item = await catalog.sellableItem(db, PRICED.code);

    await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item,
      quantity: 2,
      postedBy: deskId,
    });

    // Two breakfasts at the published figure, decomposed into §5's three lines.
    // The sum is asserted rather than the split — `folio-service.e2e-spec.ts`
    // owns the decomposition, and what is on trial here is the figure that went
    // into it.
    expect(await sumOf(folioId)).toBe(PRICED.unitPriceGross * 2n);
  });

  it("names the catalog row on the line it sells", async () => {
    const { folioId } = await anAccount();
    const item = await catalog.sellableItem(db, PRICED.code);

    const saleId = await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item,
      quantity: 1,
      postedBy: deskId,
    });

    const sale = byId(await linesOf(folioId), saleId);

    expect(sale.type).toBe("SERVICE_ITEM");
    expect(sale.serviceCatalogId).toBe(item.id);
  });

  it("leaves the derived lines unattached to the catalog", async () => {
    const { folioId } = await anAccount();

    const saleId = await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item: await catalog.sellableItem(db, PRICED.code),
      quantity: 1,
      postedBy: deskId,
    });

    // The biconditional runs both ways: a service charge is a percentage levied
    // on a sale, not a second sale of the item, and a row naming the catalog
    // under any other type is one the database refuses. What ties the three
    // together is the parent, which is what a reversal walks.
    const derived = (await linesOf(folioId)).filter(
      (line) => line.id !== saleId,
    );

    expect(derived).toHaveLength(2);

    for (const line of derived) {
      expect(line.serviceCatalogId).toBeNull();
      expect(line.parentPostingId).toBe(saleId);
    }
  });

  it("writes what the item was called, so a later rename cannot rewrite it", async () => {
    const { folioId } = await anAccount();

    const saleId = await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item: await catalog.sellableItem(db, PRICED.code),
      quantity: 3,
      postedBy: deskId,
    });

    const sale = byId(await linesOf(folioId), saleId);

    expect(sale.description).toBe(`3 × ${PRICED.name}`);
  });

  it("refuses a figure for an item the property has priced", async () => {
    const { folioId } = await anAccount();

    const refusal = await refused(
      folios.postServiceItem(db, {
        folioId,
        businessDate: BUSINESS_DATE,
        item: await catalog.sellableItem(db, PRICED.code),
        quantity: 1,
        grossAmount: 1n,
        postedBy: deskId,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");

    // Refused rather than ignored, and the account says so: a caller told
    // nothing would believe they had charged their own figure.
    expect(await sumOf(folioId)).toBe(0n);
  });

  it("takes the desk's figure for an item nobody has priced", async () => {
    const { folioId } = await anAccount();
    const consumed = 415_000n;

    await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item: await catalog.sellableItem(db, UNPRICED.code),
      quantity: 3,
      grossAmount: consumed,
      postedBy: deskId,
    });

    // The count did not scale it. Three minibar items came to one agreed total,
    // which is what an unpriced item means.
    expect(await sumOf(folioId)).toBe(consumed);
  });

  it("refuses to invent one when the catalog has none", async () => {
    const { folioId } = await anAccount();

    const refusal = await refused(
      folios.postServiceItem(db, {
        folioId,
        businessDate: BUSINESS_DATE,
        item: await catalog.sellableItem(db, UNPRICED.code),
        quantity: 1,
        postedBy: deskId,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
    expect(await sumOf(folioId)).toBe(0n);
  });

  it("sells an item added after the deploy, with no migration behind it", async () => {
    const { folioId } = await anAccount();
    const item = await catalog.sellableItem(db, ADDED_AFTER_DEPLOY.code);

    const saleId = await folios.postServiceItem(db, {
      folioId,
      businessDate: BUSINESS_DATE,
      item,
      quantity: 1,
      postedBy: deskId,
    });

    const sale = byId(await linesOf(folioId), saleId);

    expect(sale.serviceCatalogId).toBe(item.id);
    expect(await sumOf(folioId)).toBe(ADDED_AFTER_DEPLOY.unitPriceGross);
  });
});

/** A stay with an account already open on it. */
async function anAccount(): Promise<{ bookingId: string; folioId: string }> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-SVCCAT-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: BUSINESS_DATE.toString(),
      checkOutDate: DEPARTURE_DATE.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_000_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const bookingId = stay!.id;

  return { bookingId, folioId: await folios.ensureFolio(db, bookingId) };
}

/** Every line on one account, oldest first. */
async function linesOf(
  folioId: string,
): Promise<readonly (typeof folioPosting.$inferSelect)[]> {
  return await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId))
    .orderBy(folioPosting.postedAt, folioPosting.id);
}

/** The line a posting returned the id of. */
function byId(
  lines: readonly (typeof folioPosting.$inferSelect)[],
  id: string,
): typeof folioPosting.$inferSelect {
  const found = lines.find((line) => line.id === id);

  if (!found) {
    throw new Error(`no line was written under ${id}`);
  }

  return found;
}

/** The balance summed in SQL from the rows themselves — `sum(bigint)` widens to
 *  `numeric` and comes back as text, which is the one route that cannot lose a
 *  đồng. */
async function sumOf(folioId: string): Promise<VndAmount> {
  const [summed] = await db
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  return BigInt(summed?.balance ?? "0");
}

/** The one configuration row, replaced. */
async function store(values: typeof systemConfig.$inferInsert): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(values);
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

/** The refusal a call provoked. Fails the case if the service accepted it. */
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

  throw new Error("the service accepted a call it should have refused");
}
