// The identity the ledger exists to hold — `NFR-02`, against a real Postgres.
//
// `NFR-02` is one sentence: Σ postings = Σ payments + outstanding. Every other
// folio suite proves a piece of it. `tax-decomposition.spec.ts` proves that one
// gross figure splits into three that sum back to it, in memory and without a
// database. `folio-service.e2e-spec.ts` proves what each posting method writes.
// `folio-storage.e2e-spec.ts` proves what the tables refuse. `folio-close.e2e-spec.ts`
// proves the account cannot be agreed until it comes to nothing.
//
// What none of them does is walk one stay from the desk taking it to the desk
// agreeing it and ask the identity after *every* step. That is this file, and
// the "every step" is the whole of the point: an identity that holds at the end
// of a stay and not in the middle of one is an identity that a night audit
// reports as true while the account it summed was wrong for six hours. So the
// lifecycle case below asserts it after the check-in, after the sweep's night,
// after a service item, after a payment, after the departure is brought
// forward, after §4's grid, after a correction, after the settling payment and
// after the close — nine assertions of one sentence over rows that were really
// written.
//
// **Summed three ways, and the three have to agree.** The identity is taken
// over signs and never over posting types, because a reversal carries whichever
// sign undoes the line it names — `folio.service.ts` argues that where it
// summarises. So each check adds the positive lines, adds the negative ones,
// asks Postgres for `sum(amount)` over the same rows, and asks
// `FolioPort.getBalance` — the method the check-out guard actually calls, on the
// pool, by booking id. A defect that moved one of those three and not the others
// is exactly the defect `NFR-02` is written against.
//
// **The rows are committed rather than rolled back**, for the reason
// `folio-service.e2e-spec.ts` gives about the same tables: `getBalance` takes a
// booking id and no executor, so a fixture inside an open transaction would be
// invisible to the method under test. The ledger is therefore truncated on the
// way in and on the way out.
//
// **The write-once refusals are re-asserted here on a line the service wrote.**
// `folio-storage.e2e-spec.ts` asserts them on rows it inserted by hand, which is
// the right place for the constraint's own proof. What this file adds is the
// case the requirement is actually about: a posting that a real charge produced,
// on an account with a real balance, cannot be edited or removed by anybody
// holding a `psql` prompt — so the balance a night audit sums today is the
// balance it sums next year, and `NFR-02` is a claim about history rather than
// about the last write.
//
// The tax figures are deliberately unreal — 12.34% VAT over a 3.21% service
// charge. §8 forbids the tree from carrying a real rate, and a fixture that read
// like the property's would be that defect wearing a test's clothes.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { room, roomType } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { RoomChargeSweep } from "../src/modules/folio/room-charge-sweep.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { CatalogService } from "../src/modules/operations/catalog.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { accrualOn } from "./accrual.js";
import { noConfirmations, noStayLinks } from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

/** Raised by `folio_posting_refuse_rewrite()` — `migrations/0011`. */
const APPEND_ONLY_VIOLATION = "MV001";

const SEED_FROM = parseDate("2027-06-01");

/** The day the desk takes the stay — before it arrives. */
const BOOKED_ON = SEED_FROM;

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";

/** The night the guest sleeps before deciding to leave early. */
const FIRST_NIGHT = parseDate(ARRIVAL);

/** Where the early departure leaves the stay: one night slept, two given back. */
const DEPARTS_AFTER_ONE_NIGHT = parseDate("2027-06-11");

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

/** Money the guest hands over on arrival, short of what the stay will come to. */
const A_PART_PAYMENT = 500_000n;

/** Two of a catalog item the property has published a price for. */
const BEDS_SOLD = 2;

/**
 * Gross figures a sale is posted at, chosen so the odd đồng has somewhere to go.
 *
 * `tax-decomposition.spec.ts` sweeps the same property over the pure function.
 * These are the figures driven through the whole path instead — the rate read,
 * the three-row insert, the `bigint` columns and the `numeric` the driver hands
 * a sum back as — because that is where a đồng would actually be lost, and the
 * function cannot be asked about a column.
 *
 * Nothing, one đồng, and figures that divide by neither rate; then one above
 * what a double can represent, so a `number` anywhere on the path comes back
 * even and the sum misses by one.
 */
const GROSS_FIGURES: readonly VndAmount[] = [
  0n,
  1n,
  7n,
  999n,
  100_003n,
  1_000_000n,
  12_345_679n,
  999_999_999n,
  9_007_199_254_740_993n,
];

const A_RECEPTIONIST = {
  email: "le.tan.integrity@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
} as const;

const HOLD_TTL_MINUTES = 20;

/** The property's day, stopped — the device every sweep suite here uses. */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

// The sweep says something when a night goes uncharged. Nothing below asserts
// it — `room-charge-sweep.e2e-spec.ts` owns that claim — but a sweep handed no
// logger throws, and a real one would print over the run.
const log = {
  setContext: () => {},
  warn: () => {},
  error: () => {},
} as unknown as PinoLogger;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let catalog: CatalogService;
let sweep: RoomChargeSweep;
let deskId: string;

// A CCCD identifies one person, so a stay cannot share one. Counted rather than
// drawn, so a failing run reproduces.
let guestOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Before the seed, not after: `seed.ts` clears the bookings, and a folio left
  // standing from an earlier file references one of them.
  await clearTheLedger();
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  // Removed first rather than upserted: the uniqueness on this table is over
  // `lower(email)`, which is an index `on conflict` cannot name.
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

  folios = new FolioService(db, new SystemConfigService(), accrualOn(db));
  catalog = new CatalogService();
  sweep = new RoomChargeSweep(folios, log);
});

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking the next file's
  // fixtures cannot clear, and the failure would surface a file away from its
  // cause.
  await clearTheLedger();
  await db.execute(
    sql`truncate registration, room_assignment, booking, guest restart identity cascade`,
  );
  await pool?.end();
});

describe("one stay, from the desk taking it to the desk agreeing it", () => {
  it("adds up after every single thing that happens to the account", async () => {
    // `NFR-02` asserted nine times over one account. Each step below is a real
    // act by the service that performs it in production — the sweep charges the
    // night, the catalog prices the item, §4's grid prices the departure — and
    // the identity is checked against the rows immediately afterwards, so a step
    // that broke it is named by the assertion that follows it rather than by the
    // total at the end.
    const bookingId = await aCheckedInStay();
    const folioId = await folios.ensureFolio(db, bookingId);

    // Nothing has happened yet, and nothing is the right answer: the check-out
    // guard reads `!== 0n`, so a stay nobody has charged must not read as
    // unsettled.
    await addsUp(bookingId, folioId, 0n);

    // The night audit's line, posted by the sweep rather than by this file.
    // What a night costs is the sweep's claim and `room-charge-sweep.e2e-spec.ts`
    // asserts it; what matters here is that the account moved by exactly the
    // figure the booking froze for that night and by nothing else.
    const night = await priceOf(bookingId, ARRIVAL);

    expect(await db.transaction((tx) => sweep.run(tx, FIRST_NIGHT))).toHaveLength(1);

    let owed = night;
    await addsUp(bookingId, folioId, owed);

    // A catalog item sold to the stay — `FR-FOL-03`. The price is the published
    // one, read inside the same executor the line is written from, because a
    // price that moved between the read and the posting is the defect
    // `catalog.service.ts` is arranged against.
    const bed = await catalog.sellableItem(db, "EXTRA_BED");

    expect(bed.unitPriceGross).not.toBeNull();

    await folios.postServiceItem(db, {
      folioId,
      item: bed,
      quantity: BEDS_SOLD,
      businessDate: FIRST_NIGHT,
      postedBy: deskId,
    });

    owed += bed.unitPriceGross! * BigInt(BEDS_SOLD);
    await addsUp(bookingId, folioId, owed);

    // Money in, stored as its negation so the balance stays a plain sum. Short
    // of the total on purpose: the identity has to hold on a part-settled
    // account, which is the state a stay spends most of its life in.
    await folios.postPayment(db, {
      folioId,
      amount: A_PART_PAYMENT,
      businessDate: FIRST_NIGHT,
      description: "Card, ****4242",
      postedBy: deskId,
    });

    owed -= A_PART_PAYMENT;
    await addsUp(bookingId, folioId, owed);

    // The guest decides to leave. Shortening the stay writes no folio line at
    // all — `assignment.service.ts` returns the charge and refuses to store it,
    // because a service that stored it would be a second place for a balance to
    // live. So the account must not move here, and an assertion that it did not
    // is the only thing that can say so.
    await db.transaction((tx) =>
      roomsAt(FIRST_NIGHT).shortenStay(tx, {
        bookingId,
        checkOut: DEPARTS_AFTER_ONE_NIGHT,
      }),
    );

    await addsUp(bookingId, folioId, owed);

    // §4's grid, applied to the nights the departure gave back. Worked here from
    // the stored per-night prices rather than from the calculator: "the
    // remaining nights at 50%" is a selection over what each night was sold at,
    // and an expectation that called the code would agree with it however wrong
    // both were.
    const released =
      (await priceOf(bookingId, "2027-06-11")) +
      (await priceOf(bookingId, "2027-06-12"));

    await folios.postPolicyRefund(db, {
      folioId,
      bookingId,
      businessDate: FIRST_NIGHT,
      postedBy: deskId,
    });

    const penalty = await oneLineOf(folioId, "POLICY_CHARGE");

    expect(penalty.chargeBasis).toBe("REMAINING_NIGHTS_HALF");
    expect(penalty.amount).toBe(released / 2n);

    // The account still owes, so the grid posted its charge and no money went
    // back — a `REFUND` of nothing would read as money that moved.
    expect(await linesOfType(folioId, "REFUND")).toHaveLength(0);

    owed += penalty.amount;
    await addsUp(bookingId, folioId, owed);

    // `FR-FOL-01`'s correction. The beds were never delivered, so the sale comes
    // off as three reversing entries — the charge and the two lines levied on
    // it — and the mistake stays on the account beside them.
    const sold = await oneLineOf(folioId, "SERVICE_ITEM");
    const corrections = await folios.reversePosting(db, {
      postingId: sold.id,
      businessDate: FIRST_NIGHT,
      postedBy: deskId,
    });

    expect(corrections).toHaveLength(3);

    owed -= bed.unitPriceGross! * BigInt(BEDS_SOLD);
    await addsUp(bookingId, folioId, owed);

    // What is left, handed over. The figure comes from the ledger because that
    // is what a receptionist reads off the screen — and if it were wrong, every
    // assertion above would already have failed.
    expect(owed).toBeGreaterThan(0n);

    await folios.postPayment(db, {
      folioId,
      amount: owed,
      businessDate: FIRST_NIGHT,
      description: "Card, ****4242, settling the account",
      postedBy: deskId,
    });

    await addsUp(bookingId, folioId, 0n);

    // The account comes to nothing, so the desk may agree it — and the close
    // sums under its own row lock, which is a fourth reading of the same
    // identity and the one that decides whether a guest can leave.
    const closed = await folios.close(db, bookingId);

    expect(closed.closedAt).toBeInstanceOf(Date);

    const [account] = await db
      .select()
      .from(folio)
      .where(eq(folio.id, folioId));

    expect(account?.state).toBe("CLOSED");

    // And it still adds up afterwards. The close writes to `folio` and to
    // nothing else — no total, no stored balance — so an account that read
    // differently once agreed would mean the close had invented a figure.
    await addsUp(bookingId, folioId, 0n);
  });
});

describe("a line nobody can rewrite, however they reach the database", () => {
  // `FR-FOL-01`: a mistake is corrected by a reversing entry, "never an `UPDATE`
  // or `DELETE`". `folio-storage.e2e-spec.ts` proves the trigger against rows it
  // wrote by hand; these two go the other way round — a posting a real charge
  // produced, on an account carrying a real balance, reached by the statements a
  // support script or a `psql` session would actually type.
  //
  // Why it belongs beside the identity above: `NFR-02` is a claim about the
  // account's whole history, not about its last write. An `UPDATE` that changed
  // one đồng would leave the sum internally consistent and quietly wrong, with
  // nothing anywhere recording that it had happened.

  it("refuses an update to the amount, and leaves the amount alone", async () => {
    const { bookingId, folioId, posting } = await anAccountWithACharge();
    const before = await sumOf(folioId);

    const refusal = await refusedByTheLedger(
      sql`update folio_posting set amount = amount - 1 where id = ${posting.id}::uuid`,
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("append-only");
    expect(refusal.message).toContain("update");

    // The half a raised exception alone does not prove: the row is as it was,
    // and so is the balance summed over it.
    const [stored] = await db
      .select()
      .from(folioPosting)
      .where(eq(folioPosting.id, posting.id));

    expect(stored?.amount).toBe(posting.amount);
    expect(await sumOf(folioId)).toBe(before);
    expect(await folios.getBalance(bookingId)).toBe(before);
  });

  it("refuses an update to a column that carries no money", async () => {
    // The rule is about the row, not about the amount. A description edited
    // after the fact rewrites what the guest was told they were charged for, on
    // an invoice a third party cannot quietly reissue.
    const { posting } = await anAccountWithACharge();

    const refusal = await refusedByTheLedger(
      sql`update folio_posting set description = 'Something else entirely' where id = ${posting.id}::uuid`,
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);

    const [stored] = await db
      .select()
      .from(folioPosting)
      .where(eq(folioPosting.id, posting.id));

    expect(stored?.description).toBe(posting.description);
  });

  it("refuses a delete, and leaves the balance where it was", async () => {
    const { bookingId, folioId, posting } = await anAccountWithACharge();
    const before = await sumOf(folioId);

    const refusal = await refusedByTheLedger(
      sql`delete from folio_posting where id = ${posting.id}::uuid`,
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("delete");

    expect(await sumOf(folioId)).toBe(before);
    expect(await folios.getBalance(bookingId)).toBe(before);
  });

  it("refuses a delete that names no row in particular", async () => {
    // The statement somebody types at the end of a long evening. An unqualified
    // `DELETE` would take the whole ledger, and the trigger fires per row rather
    // than per statement, so the first row it reaches stops it.
    const { folioId } = await anAccountWithACharge();

    const refusal = await refusedByTheLedger(sql`delete from folio_posting`);

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(await linesOf(folioId)).toHaveLength(3);
  });
});

describe("three lines that sum to the figure the guest agreed to", () => {
  it("comes back to the gross for every figure it is handed", async () => {
    // §5 quotes gross and shows net, so the three lines are derived from the
    // figure the guest accepted and never added on top of it. Asserted here over
    // rows rather than over the return of `decomposeGross` — a decomposition
    // that was exact in memory and lost a đồng on the way into a column would
    // pass the unit spec and fail every night audit.
    const folioId = await folios.ensureFolio(db, await aStayNobodyChecksIn());

    let charged = 0n;

    for (const gross of GROSS_FIGURES) {
      const chargeId = await folios.postRoomCharge(db, {
        folioId,
        grossAmount: gross,
        businessDate: FIRST_NIGHT,
        description: `A night agreed at ${gross}`,
        postedBy: deskId,
      });

      // The sale and the two lines levied on it — the set `schema/folio.ts`
      // names as `id = $1 or parent_posting_id = $1`, which is the same set a
      // correction would undo.
      const sale = (await linesOf(folioId)).filter(
        (line) => line.id === chargeId || line.parentPostingId === chargeId,
      );

      expect(sale).toHaveLength(3);
      expect(sale.reduce((total, line) => total + line.amount, 0n)).toBe(gross);

      // Both derived lines are written even at nothing, so a folio never shows
      // two lines on one night and one on the next.
      expect(sale.filter((line) => line.type === "SERVICE_CHARGE_FEE")).toHaveLength(1);
      expect(sale.filter((line) => line.type === "VAT")).toHaveLength(1);

      // Neither percentage is ever overstated: the residual lands on the net
      // charge, because that is the only one of the three that is not a stated
      // percentage of a stated base.
      expect(sale.find((line) => line.type === "ROOM_CHARGE")?.amount).toBe(
        gross -
          sale.find((line) => line.type === "SERVICE_CHARGE_FEE")!.amount -
          sale.find((line) => line.type === "VAT")!.amount,
      );

      charged += gross;

      // And the account, over every figure posted so far. A per-sale check that
      // passed while the running total drifted would be the failure `NFR-02`
      // reports weeks later as a ledger that does not add up.
      expect(await sumOf(folioId)).toBe(charged);
    }
  });

  it("keeps a figure a double could not hold, to the đồng", async () => {
    // `NFR-12`. The amount is one above what a `number` can represent exactly,
    // so a column, a driver or a decomposition that routed money through a
    // double would hand back an even figure — and a folio wrong by one đồng
    // fails `NFR-02` in a way that is unprovable rather than merely visible.
    const bookingId = await aStayNobodyChecksIn();
    const folioId = await folios.ensureFolio(db, bookingId);
    const gross = 9_007_199_254_740_993n;

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: gross,
      businessDate: FIRST_NIGHT,
      description: "A figure beyond a double",
      postedBy: deskId,
    });

    for (const line of await linesOf(folioId)) {
      expect(typeof line.amount).toBe("bigint");
    }

    // Three readings, and all three have to be exact. `sum(bigint)` widens to
    // `numeric` and the driver hands a numeric over as text, which is the one
    // route back out that cannot lose a đồng.
    expect(await sumOf(folioId)).toBe(gross);
    expect(await folios.getBalance(bookingId)).toBe(gross);

    // Settled by a payment of the same size, which is the other direction the
    // arithmetic runs and the one that leaves zero rather than approaching it.
    await folios.postPayment(db, {
      folioId,
      amount: gross,
      businessDate: FIRST_NIGHT,
      description: "Settled in full",
      postedBy: deskId,
    });

    expect(await folios.getBalance(bookingId)).toBe(0n);
    await addsUp(bookingId, folioId, 0n);
  });
});

/**
 * `NFR-02`, over the rows and against every reading of them.
 *
 * Four claims, and each would fail differently. What the guest owes equals what
 * has been settled plus what is outstanding — the identity itself, taken over
 * signs rather than over posting types, because a reversal joins whichever side
 * the line it corrects was on. Postgres' own `sum` agrees with that addition.
 * `FolioPort.getBalance` — the method the check-out guard calls, on the pool, by
 * booking id — agrees with both. And all three come to the figure the stay is at
 * this point in its life.
 */
async function addsUp(
  bookingId: string,
  folioId: string,
  expected: VndAmount,
): Promise<void> {
  const lines = await linesOf(folioId);

  const postings = lines
    .filter((line) => line.amount > 0n)
    .reduce<VndAmount>((total, line) => total + line.amount, 0n);
  const payments = lines
    .filter((line) => line.amount < 0n)
    .reduce<VndAmount>((total, line) => total - line.amount, 0n);

  const outstanding = await folios.getBalance(bookingId);

  expect(postings).toBe(payments + outstanding);
  expect(outstanding).toBe(await sumOf(folioId));
  expect(outstanding).toBe(expected);
}

/**
 * The balance the long way round: summed in SQL from the rows themselves.
 *
 * Written here rather than reusing the service's own query, so the identity is
 * checked against the database and not against the reading of it.
 */
async function sumOf(folioId: string): Promise<VndAmount> {
  const [summed] = await db
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  return BigInt(summed?.balance ?? "0");
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

async function linesOfType(
  folioId: string,
  type: (typeof folioPosting.$inferSelect)["type"],
): Promise<readonly (typeof folioPosting.$inferSelect)[]> {
  return (await linesOf(folioId)).filter((line) => line.type === type);
}

/** The one line of a type the step under test posted. */
async function oneLineOf(
  folioId: string,
  type: (typeof folioPosting.$inferSelect)["type"],
): Promise<typeof folioPosting.$inferSelect> {
  const found = await linesOfType(folioId, type);

  if (found.length !== 1) {
    throw new Error(`expected one ${type} line, found ${found.length}`);
  }

  return found[0]!;
}

/**
 * The refusal a statement provoked, run inside a boundary of its own.
 *
 * The transaction rolls back when the trigger raises, so a refused statement
 * cannot leave this file's committed rows in a state the next case reads.
 */
async function refusedByTheLedger(
  statement: SQL,
): Promise<{ code: string | undefined; message: string }> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(statement);
    });
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the ledger accepted a statement it should have refused");
}

/**
 * The SQLSTATE and message out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed to
 * be one deep.
 */
function refusalOf(error: unknown): { code: string | undefined; message: string } {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code } = current as Error & { code?: unknown };

    if (typeof code === "string") {
      return { code, message: current.message };
    }
  }

  throw error;
}

/** A stay with a night on its account, for the cases about what cannot be
 *  rewritten. The charge is the sweep's kind, posted through the service. */
async function anAccountWithACharge(): Promise<{
  bookingId: string;
  folioId: string;
  posting: typeof folioPosting.$inferSelect;
}> {
  const bookingId = await aStayNobodyChecksIn();
  const folioId = await folios.ensureFolio(db, bookingId);

  const chargeId = await folios.postRoomCharge(db, {
    folioId,
    grossAmount: 1_000_000n,
    businessDate: FIRST_NIGHT,
    description: "Room charge, one night",
    postedBy: deskId,
  });

  const [posting] = await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.id, chargeId));

  return { bookingId, folioId, posting: posting! };
}

/** The desk, on a given day. */
function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(
      inventory,
      clock,
      new StayQuoteService(),
      new HousekeepingService(),
    ),
    new GuestService(),
    new HousekeepingService(),
    // The check-out guard is not exercised through this service here — the
    // account is agreed by `FolioService.close` directly — so the port's
    // simplest implementation is the honest one.
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    // Stubs that say so if they are, rather than casts that say nothing.
    noStayLinks,
    noConfirmations,
    // §7's ladder, reached only where a stay is sold to a signed-in guest.
    tiersAt(clock),
  );
}

/** The rooms service, on a given day. */
function roomsAt(today: StayDate): AssignmentService {
  return new AssignmentService(
    new InventoryService(),
    new StoppedClock(today),
    new StayQuoteService(),
    new HousekeepingService(),
  );
}

/**
 * A stay the desk took and nobody admitted.
 *
 * Enough for the cases about arithmetic and about what the table refuses: those
 * post through the service directly and never need a guest in a room.
 */
async function aStayNobodyChecksIn(
  type: RoomTypeCode = "SUPERIOR",
): Promise<string> {
  const made = await db.transaction((tx) =>
    deskAt(BOOKED_ON).createConfirmed(tx, {
      roomType: type,
      checkIn: parseDate(ARRIVAL),
      checkOut: parseDate(DEPARTURE),
      plan: "STANDARD",
      party: { adults: 2, children: [] },
    }),
  );

  return made.id;
}

/**
 * A stay holding a room, with its guest registered and in it.
 *
 * Two stopped clocks, because the property's own day is what makes both acts
 * legal: a booking cannot be taken into the past and a guest cannot be admitted
 * before the day they are due. It is also the only thing that puts a stay in
 * front of the sweep.
 */
async function aCheckedInStay(): Promise<string> {
  const bookingId = await aStayNobodyChecksIn("DELUXE");
  const roomNumber = await aFreeRoom("DELUXE");

  await db.transaction((tx) =>
    roomsAt(BOOKED_ON).assign(tx, { bookingId, roomNumber }),
  );

  guestOrdinal += 1;

  await db.transaction((tx) =>
    deskAt(FIRST_NIGHT).checkIn(tx, {
      bookingId,
      guests: [
        {
          fullName: "Trần Thị Mai",
          cccdNumber: `0793011${String(50_000 + guestOrdinal)}`,
          nationality: "VN",
        },
      ],
    }),
  );

  return bookingId;
}

/**
 * A room of that type nothing is holding.
 *
 * Looked up rather than written down: the numbering is `seed.ts`'s display-order
 * rule, and a suite that hard-coded it would fail on a property whose mix
 * changed rather than on a ledger that broke.
 */
async function aFreeRoom(code: RoomTypeCode): Promise<string> {
  const [found] = await db
    .select({ number: room.number })
    .from(room)
    .innerJoin(roomType, eq(roomType.id, room.roomTypeId))
    .where(eq(roomType.code, code))
    .orderBy(room.number)
    .limit(1);

  if (!found) throw new Error(`the property owns no ${code} room`);

  return found.number;
}

/** The price one night was sold at, as the booking froze it — never the
 *  calendar, which a manager may have edited since. */
async function priceOf(bookingId: string, night: string): Promise<VndAmount> {
  const [priced] = await db
    .select({ standardGross: bookingNight.standardGross })
    .from(bookingNight)
    .where(
      and(
        eq(bookingNight.bookingId, bookingId),
        eq(bookingNight.stayDate, night),
      ),
    );

  if (!priced) throw new Error(`booking ${bookingId} has no night on ${night}`);

  return priced.standardGross;
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back — it needs rights over the table rather than over its rows,
 *  which is the distinction `schema/folio.ts` draws. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}
