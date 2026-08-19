// What a stay earns when the desk agrees its account — `FR-GST-05`, and
// `property-and-tariff.md` §7, against a real Postgres.
//
// The ledger is append-only by a trigger and unique on the folio, so most of
// what this file claims is a claim about the database rather than about a
// branch. Six things, and each of them is a way the feature could be wrong
// without anything failing:
//
// - a closed stay earns points once, with §7's expiry on the row;
// - the figure is **net room revenue**: not the gross the guest paid, not the
//   minibar, not the tax. §7 chose net precisely so that a §8 answer cannot
//   move what a stay earns, and the case below closes a folio carrying a room
//   charge, a service item, a service charge and VAT so the exclusion is
//   asserted against all three rather than against a room-only account;
// - a night the property agreed did not happen earns nothing, which is how an
//   early departure and a corrected charge stay honest;
// - a second accrual writes nothing and raises nothing, because the unique key
//   on the folio settles it and not a read this code made;
// - a walk-in earns nothing at all, because there is no account to credit;
// - and an accrual that fails leaves the close standing and wakes somebody.
//
// **The rows are committed rather than rolled back.** The accrual runs on the
// far side of the close's commit, on a connection of its own, so a fixture held
// inside an open transaction would be invisible to the thing under test — which
// is the whole point of the arrangement. The ledger is therefore truncated
// between cases and on the way out.
//
// **The earn rate is one point per đồng.** It looks nothing like §7's proposal
// and that is deliberate: at that rate the number on the ledger row *is* the
// net room revenue, so the exclusion of VAT, service charge and service items
// can be read directly off the figure instead of through arithmetic this file
// would have to repeat from the service it is testing. One case sets a real
// unit instead, because rounding down is the other half of §7's rate and only a
// figure larger than a stay can prove it.
//
// The tax rates are deliberately unreal — 12.34% VAT over a 3.21% service
// charge. §8 forbids the tree from carrying a real rate, and what matters here
// is only that both are well above zero, so a net figure and a gross one cannot
// be confused for each other.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { staffUser } from "../src/database/schema/identity.js";
import { guestUser } from "../src/database/schema/index.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { loyaltyLedger } from "../src/database/schema/loyalty.js";
import { serviceCatalog } from "../src/database/schema/service.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { LoyaltyService } from "../src/modules/guest/loyalty.service.js";
import type {
  OpsAlert,
  OpsAlertService,
} from "../src/modules/notification/ops-alert.service.js";
import { CatalogService } from "../src/modules/operations/catalog.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/**
 * A configuration nobody could mistake for a property's real one, earning one
 * point per đồng of net room revenue.
 */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
  loyaltyPointsPerUnit: 1,
  loyaltyEarnUnitVnd: 1n,
} satisfies typeof systemConfig.$inferInsert;

const BUSINESS_DATE = parseDate("2027-09-02");
const DEPARTURE_DATE = parseDate("2027-09-05");

/** One night at the price the guest agreed to, gross. */
const A_NIGHT = 1_000_000n;

/** A minibar bill, gross. Never part of what a stay earns — §7. */
const A_MINIBAR = 250_000n;

/**
 * The catalog row the minibar line names, written by this file and removed
 * again on the way out.
 *
 * Unpriced, so the figure on the line is the one above rather than something
 * the catalog decided — `FR-FOL-03` requires an amount for an item nobody has
 * costed. Its own code rather than §6's `MINIBAR`, because whether the seeded
 * catalog is present depends on which suite ran last and a case that changed
 * shape with the run order would be no case at all.
 */
const A_SERVICE_ITEM = {
  code: "LOYALTY_SUITE_SUNDRIES",
  name: "Sundries",
  unitPriceGross: null,
  taxClass: "STANDARD",
} as const;

const A_RECEPTIONIST = {
  email: "le.tan.loyalty@mariva.test",
  fullName: "Trần Thị Mai",
} as const;

/** A uuid no folio has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

/** Pages this file collects instead of dispatching. */
const paged: OpsAlert[] = [];

const alerter = {
  page: async (alert: OpsAlert) => {
    paged.push(alert);

    return true;
  },
} as unknown as OpsAlertService;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let loyalty: LoyaltyService;
let catalog: CatalogService;
let roomTypeId: string;
let deskId: string;

// References and account addresses are unique and every case takes a stay of
// its own. Counted rather than drawn, so a failing run reproduces.
let stayOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await clearTheLedger();
  await configureThePropertyAs(CONFIGURED);

  const [existing] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  roomTypeId = existing?.id ?? (await someRoomType());

  await db
    .insert(serviceCatalog)
    .values(A_SERVICE_ITEM)
    .onConflictDoNothing({ target: serviceCatalog.code });

  await db.delete(staffUser).where(eq(staffUser.email, A_RECEPTIONIST.email));

  const [staff] = await db
    .insert(staffUser)
    .values({
      ...A_RECEPTIONIST,
      role: "RECEPTIONIST",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  deskId = staff!.id;

  loyalty = new LoyaltyService(
    new TransactionRunner(db),
    new SystemConfigService(),
    alerter,
  );
  folios = new FolioService(db, new SystemConfigService(), loyalty);
  catalog = new CatalogService();
});

beforeEach(async () => {
  paged.length = 0;
  await clearTheLedger();
  await configureThePropertyAs(CONFIGURED);
});

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking the next file's
  // fixtures cannot clear, and the failure would surface a file away from its
  // cause.
  await clearTheLedger();
  // The two rows this file added outside the ledger. The catalog item would
  // otherwise be a ninth entry in a list `seed.e2e-spec.ts` checks against §6's
  // eight, and the desk account would collide with the next run's insert.
  await db
    .delete(serviceCatalog)
    .where(eq(serviceCatalog.code, A_SERVICE_ITEM.code));
  await db.delete(staffUser).where(eq(staffUser.email, A_RECEPTIONIST.email));
  await pool?.end();
});

describe("agreeing an account earns the stay its points", () => {
  it("writes one row, and dates it to the end of the year after this one", async () => {
    const { bookingId, folioId, accountId } = await aSettledStay();

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);

    expect(earned?.userId).toBe(accountId);
    expect(earned?.pointsEarned).toBe(await netRoomRevenueOn(folioId));
    // §7's fixed calendar expiry, computed from the year the accrual happened
    // in rather than from a rolling window. Read off the property's own
    // calendar, which is what the row is written against.
    expect(earned?.expiresAt).toBe(`${theYearHere() + 1}-12-31`);
    expect(paged).toEqual([]);
  });

  it("counts the room charge net, and nothing levied on it or sold beside it", async () => {
    // The case §7 exists for. The account carries a night, a minibar, a service
    // charge on each and VAT on each, and the points are the room charge's
    // *net* line alone — so a §8 rate change moves the invoice and leaves what
    // the stay earned exactly where it was.
    const { bookingId, folioId } = await aStay();

    await charge(folioId);
    await sellAMinibar(folioId);
    await settle(folioId, A_NIGHT + A_MINIBAR);

    const lines = await postingsOn(folioId);

    // The account really does carry all four kinds, so what follows is an
    // exclusion rather than an absence.
    expect(new Set(lines.map((line) => line.type))).toEqual(
      new Set([
        "ROOM_CHARGE",
        "SERVICE_ITEM",
        "SERVICE_CHARGE_FEE",
        "VAT",
        "PAYMENT",
      ]),
    );

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);
    const net = await netRoomRevenueOn(folioId);

    expect(earned?.pointsEarned).toBe(net);
    // And the three figures it is not: the gross the guest agreed to, the whole
    // bill, and the two rooms-and-services net lines added together. Each is a
    // plausible mistake and each is larger than the answer.
    expect(net).toBeLessThan(A_NIGHT);
    expect(net).toBeLessThan(A_NIGHT + A_MINIBAR);
    expect(net).toBeLessThan(
      lines
        .filter((line) => line.amount > 0n)
        .reduce((total, line) => total + line.amount, 0n),
    );
  });

  it("earns nothing for the nights the property agreed did not happen", async () => {
    // `FR-GST-05` reads the settled account rather than the booking, so an
    // early departure — or a night charged in error and taken back — is a
    // reversal on the ledger and comes off what the stay earned. Nothing here
    // subtracts: the reversal carries the exact negation and the sum is one
    // query.
    const { bookingId, folioId } = await aStay();

    const first = await charge(folioId);
    await charge(folioId);
    await folios.reversePosting(db, {
      postingId: first,
      businessDate: BUSINESS_DATE,
      postedBy: deskId,
    });
    await settle(folioId, A_NIGHT);

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);
    const oneNight = await netRoomRevenueOn(folioId);

    expect(earned?.pointsEarned).toBe(oneNight);
    // Two nights were charged and one was undone, so what remains is a single
    // night's net — half of what a reader of the booking would have found.
    expect(oneNight).toBeGreaterThan(0n);
  });

  it("writes the row at nothing for a stay below one earn unit", async () => {
    // §7's unit is what decides the granularity, and `bigint` division
    // truncates rather than rounds, so a stay that did not reach one unit earns
    // no points and still occupies its folio's one row —
    // `loyalty_ledger_accrues_only` allows zero and refuses less.
    await configureThePropertyAs({
      ...CONFIGURED,
      loyaltyEarnUnitVnd: A_NIGHT * 10n,
    });

    const { bookingId, folioId } = await aSettledStay();

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);

    expect(earned?.pointsEarned).toBe(0n);
  });

  it("multiplies the units by what §7 says a unit is worth", async () => {
    await configureThePropertyAs({
      ...CONFIGURED,
      loyaltyPointsPerUnit: 7,
      loyaltyEarnUnitVnd: 100_000n,
    });

    const { bookingId, folioId } = await aSettledStay();

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);
    const net = await netRoomRevenueOn(folioId);

    expect(earned?.pointsEarned).toBe((net / 100_000n) * 7n);
  });

  it("writes the row at nothing for a stay nobody charged for a room", async () => {
    // A stay that ran up no charge settles at nothing and closes — the account
    // is agreed and the guest earned nothing, which is a real answer rather
    // than an absence. The row still goes in, so a guest's history says the
    // stay happened and came to no points instead of saying nothing at all.
    const { bookingId, folioId } = await aStay();

    await folios.close(db, bookingId);

    const [earned] = await ledgerOf(folioId);

    expect(earned?.pointsEarned).toBe(0n);
    expect(paged).toEqual([]);
  });

  it("earns nobody anything for a folio that is not there", async () => {
    // Not reachable from the close, which has just written the row it names.
    // It is the answer for a support script pointed at the wrong id, and the
    // point of asserting it is that it is *quiet*: nothing is written, and
    // nothing is paged about a folio that never existed to earn anything.
    await expect(loyalty.accruePoints(db, ABSENT_ID)).resolves.toBeUndefined();

    expect(await db.select().from(loyaltyLedger)).toEqual([]);
    expect(paged).toEqual([]);
  });

  it("earns a walk-in nothing, because there is no account to credit", async () => {
    // §7 and `FR-GST-05` both put the points on a guest account, and a person
    // the desk registered at the counter has none. `booking.user_id` is null,
    // so the accrual stops before it reads a rate it would have no use for.
    const { bookingId, folioId } = await aSettledStay({ registered: false });

    await folios.close(db, bookingId);

    expect(await ledgerOf(folioId)).toEqual([]);
    expect(paged).toEqual([]);
  });
});

describe("the seam between the close and the points", () => {
  it("writes the row after the close commits, and not inside it", async () => {
    // The production path, through the boundary `TransactionRunner` opens. The
    // ledger is read on this file's own connection from inside that
    // transaction, so what it sees is committed state — and it sees nothing,
    // because the accrual has not run yet. That is the ordering the whole
    // arrangement exists for.
    const transactions = new TransactionRunner(db);
    const { bookingId, folioId } = await aSettledStay();

    await transactions.run(async (exec) => {
      await folios.close(exec, bookingId);

      expect(await ledgerOf(folioId)).toEqual([]);
    });

    expect(await ledgerOf(folioId)).toHaveLength(1);
  });

  it("earns nothing when the close is rolled back", async () => {
    // A close that does not stand is a stay that was never agreed, and
    // `FR-GST-05` accrues at the close. `TransactionRunner` throws the
    // post-commit queue away unrun on a rollback, so this needs no rule of its
    // own — which is the point of registering the work there rather than
    // calling it.
    const transactions = new TransactionRunner(db);
    const { bookingId, folioId } = await aSettledStay();

    await expect(
      transactions.run(async (exec) => {
        await folios.close(exec, bookingId);

        throw new Error("something later in the checkout gave way");
      }),
    ).rejects.toThrow("gave way");

    const [account] = await db.select().from(folio).where(eq(folio.id, folioId));

    expect(account?.state).toBe("OPEN");
    expect(await ledgerOf(folioId)).toEqual([]);
    expect(paged).toEqual([]);
  });

  it("leaves one row behind a desk that closed the account twice", async () => {
    // The second close is refused by `FolioService` — an account is agreed once
    // and `FR-FOL-04` reads a closed folio as one invoice — so the accrual is
    // not reached a second time either. The claim asserted here is the one a
    // reader of the ledger cares about: whatever the desk did, the stay earned
    // its points once.
    const { bookingId, folioId } = await aSettledStay();

    await folios.close(db, bookingId);
    await expect(folios.close(db, bookingId)).rejects.toThrow();

    expect(await ledgerOf(folioId)).toHaveLength(1);
    expect(paged).toEqual([]);
  });
});

describe("running the accrual again", () => {
  it("writes one row and raises nothing", async () => {
    // The `FR-PAY-03` pattern applied to points: a retried close, a support
    // script and a double-fired job all arrive as the same accrual, and
    // `loyalty_ledger_folio_id_unique` is what refuses the second one. It is
    // refused as a no-op rather than as an exception, because a second attempt
    // at a stay that has already earned is the mechanism working.
    const { bookingId, folioId } = await aSettledStay();

    await folios.close(db, bookingId);

    const [first] = await ledgerOf(folioId);

    await expect(loyalty.accruePoints(db, folioId)).resolves.toBeUndefined();
    await expect(loyalty.accruePoints(db, folioId)).resolves.toBeUndefined();

    const rows = await ledgerOf(folioId);

    expect(rows).toHaveLength(1);
    expect(paged).toEqual([]);
    // The same row, untouched. Nothing here updates a ledger row and nothing
    // could — 0023's trigger raises `MV004` on an update or a delete — so an
    // identical id and an unmoved instant are the evidence that the second and
    // third attempts wrote nothing rather than rewrote the first.
    expect(rows[0]?.id).toBe(first?.id);
    expect(rows[0]?.earnedAt.getTime()).toBe(first?.earnedAt.getTime());
    expect(rows[0]?.pointsEarned).toBe(first?.pointsEarned);
  });

  it("still earns the points when the close is the second thing to run", async () => {
    // The other order, which is what a support script that accrued by hand
    // leaves behind. The close finds the row already there and the guest is not
    // credited twice.
    const { bookingId, folioId } = await aSettledStay();

    await loyalty.accruePoints(db, folioId);
    await folios.close(db, bookingId);

    expect(await ledgerOf(folioId)).toHaveLength(1);
  });
});

describe("when the accrual cannot be worked out", () => {
  it("leaves the account agreed and wakes somebody", async () => {
    // The failure this arrangement is built around. The close commits first and
    // the accrual runs after it, so nothing the accrual does can reach the
    // checkout — and the guest is short of points that no screen and no sweep
    // would notice were missing, which is why it pages instead of returning.
    //
    // The cause is a real one rather than a stubbed throw: an unconfigured
    // property has no earn rate, and `SystemConfigService` refuses rather than
    // assuming one. The close itself reads no configuration — the rates were
    // read when the night was posted — so it succeeds and the accrual is what
    // fails.
    const { bookingId, folioId } = await aSettledStay();

    await db.execute(sql`truncate system_config`);

    const closed = await folios.close(db, bookingId);

    expect(closed.closedAt).toBeInstanceOf(Date);

    const [account] = await db
      .select()
      .from(folio)
      .where(eq(folio.id, folioId));

    expect(account?.state).toBe("CLOSED");
    expect(await ledgerOf(folioId)).toEqual([]);

    expect(paged).toHaveLength(1);
    expect(paged[0]?.kind).toBe("loyalty-accrual-failed");
    expect(paged[0]?.details).toMatchObject({ folio: folioId });
    expect(String(paged[0]?.details.cause)).toContain("system_config");
  });
});

/** The calendar year the property is having, which is the one an accrual earns
 *  in. Read here rather than from `Date`'s UTC fields, because at UTC+7 the two
 *  disagree for the last seven hours of every 31 December. */
function theYearHere(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
    }).format(new Date()),
  );
}

/** What the account billed for rooms, net — read off the ledger the same way a
 *  reader would, so the expectation is the folio's own figure rather than this
 *  file's arithmetic. */
async function netRoomRevenueOn(folioId: string): Promise<bigint> {
  const lines = await postingsOn(folioId);
  const undone = new Set(
    lines.map((line) => line.reversesPostingId).filter((id) => id !== null),
  );

  return lines
    .filter((line) => line.type === "ROOM_CHARGE" && !undone.has(line.id))
    .reduce((total, line) => total + line.amount, 0n);
}

async function postingsOn(folioId: string) {
  return await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));
}

async function ledgerOf(folioId: string) {
  return await db
    .select()
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.folioId, folioId));
}

async function configureThePropertyAs(
  values: typeof systemConfig.$inferInsert,
): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(values);
}

/** A stay with an account opened against it, and a guest account behind it
 *  unless the case is about a walk-in. */
async function aStay(
  { registered = true }: { registered?: boolean } = {},
): Promise<{ bookingId: string; folioId: string; accountId: string | null }> {
  stayOrdinal += 1;

  const accountId = registered ? await aGuestAccount() : null;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-LOYAL-${String(stayOrdinal).padStart(4, "0")}`,
      state: "CHECKED_IN",
      roomTypeId,
      userId: accountId,
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

  return {
    bookingId,
    accountId,
    folioId: await folios.ensureFolio(db, bookingId),
  };
}

/** A stay charged for one night and paid for, so its account comes to nothing
 *  and can be agreed. */
async function aSettledStay(options: { registered?: boolean } = {}) {
  const stay = await aStay(options);

  await charge(stay.folioId);
  await settle(stay.folioId, A_NIGHT);

  return stay;
}

/** An account on the public site, by the id Better Auth would have minted. */
async function aGuestAccount(): Promise<string> {
  const id = `loyal-account-${String(stayOrdinal).padStart(4, "0")}`;

  await db.insert(guestUser).values({
    id,
    name: "Nguyễn Thị Hương",
    email: `${id}@mariva.test`,
  });

  return id;
}

/** One night, decomposed at the configured rates — `FR-FOL-02`. */
async function charge(folioId: string): Promise<string> {
  return await folios.postRoomCharge(db, {
    folioId,
    grossAmount: A_NIGHT,
    businessDate: BUSINESS_DATE,
    description: `Room charge, night of ${BUSINESS_DATE.toString()}`,
    postedBy: null,
  });
}

/** A catalog item sold to the stay — the line §7 excludes by name. */
async function sellAMinibar(folioId: string): Promise<string> {
  const item = await catalog.sellableItem(db, A_SERVICE_ITEM.code);

  return await folios.postServiceItem(db, {
    folioId,
    item,
    quantity: 1,
    grossAmount: A_MINIBAR,
    businessDate: BUSINESS_DATE,
    postedBy: null,
  });
}

/** Money the guest handed over. */
async function settle(folioId: string, amount: bigint): Promise<string> {
  return await folios.postPayment(db, {
    folioId,
    amount,
    businessDate: BUSINESS_DATE,
    description: "Card, ****4242",
    method: null,
    postedBy: null,
  });
}

async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate loyalty_ledger, folio_posting, folio, booking, guest_user restart identity cascade`,
  );
}

/** A room type to hang a booking on, and only if the database holds none. */
async function someRoomType(): Promise<string> {
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

  return created!.id;
}
