// The payment table, against a real Postgres.
//
// The claim under test is the one `FR-PAY-03` makes and no handler can keep:
// "one IPN replayed 10× posts exactly 1 payment". `infrastructure.md` §Payments
// says why it has to be the database's claim rather than a service's — "VNPay
// may send the same IPN more than once. A unique constraint on the gateway
// transaction id is mandatory, not defensive."
//
// **The replays below are concurrent, and that is the whole design of this
// file.** A handler that selects the gateway id and inserts when it finds
// nothing passes a sequential replay ten times out of ten: each read sees the
// row the previous write committed. Run the same ten as ten open transactions
// and every one of them reads an empty table before any of them writes, so a
// check-then-insert takes the money ten times. Ten `Promise`s over a pool wider
// than ten is what tells those two implementations apart, and a `for` loop is
// what fails to.
//
// So each replay opens its own transaction on its own connection, and the pool
// is this file's own and sized above the concurrency it drives — the
// application's pool is ten wide by design and borrowing it would quietly
// serialise the race into batches, which is a correct result and a test of
// nothing. `inventory-reservation.e2e-spec.ts` makes the identical argument for
// the identical reason.
//
// Rows that a test commits are cleaned up rather than rolled back, because a
// concurrent race cannot be run inside one transaction: ten savepoints on one
// connection are ten statements in sequence. Nothing here is append-only, so
// the cleanup is a delete — which is the difference between this table and
// `folio_posting`, whose spec rolls back for exactly the opposite reason.
//
// It applies the migrations rather than pushing the schema: the two partial
// indexes under test land in `0013_payment_core.sql` and
// `0014_payment_attempt_reference.sql`, and only migrating puts them there. No
// Nest application is booted — the subject is the storage layer itself.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { auditEntry } from "../src/database/schema/audit.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import { shift } from "../src/database/schema/shift.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** `FR-PAY-03`'s number, and the reason this file exists. */
const REPLAYS = 10;

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

const PAID_AT = new Date("2027-11-02T09:12:00Z");

/** A uuid no row has. Used where a test needs a key that resolves to nothing. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The account every test posts against, and the stay underneath it. */
let folioId: string;
let bookingId: string;

/** Somebody to have counted the cash. Removed with everything else. */
let receptionistId: string;

/**
 * The drawer the cash below was counted into.
 *
 * `payment_shift_binding` makes this the only way a cash row exists at all, so
 * it is fixture rather than subject: what these tests are about is the payment
 * table's own rules, and a shift is what the constraint requires before any of
 * them can be reached.
 */
let shiftId: string;

// References are unique and this file opens more than one stay. Counted rather
// than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString, max: REPLAYS + 10 });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  bookingId = await aBooking(db);
  folioId = await anOpenFolio(db, bookingId);
  receptionistId = await aReceptionist(db);
  shiftId = await anOpenShift(db, receptionistId);
});

afterAll(async () => {
  // In key order: the payments name the folio and the shift, the folio names
  // the booking, and the staff account is named by both the shift it belongs to
  // and whichever payments the desk took.
  if (db) {
    await db.delete(payment).where(eq(payment.folioId, folioId));
    await db.delete(folio).where(eq(folio.id, folioId));
    await db.delete(booking).where(eq(booking.id, bookingId));
    await db.delete(shift).where(eq(shift.id, shiftId));
    await db.delete(auditEntry);
    await db.delete(staffUser).where(eq(staffUser.id, receptionistId));
  }

  await pool?.end();
});

describe("one callback delivered ten times", () => {
  const GATEWAY_TRANSACTION_ID = "14528901";

  it("becomes exactly one payment", async () => {
    // Ten transactions open at once, each writing the same gateway id. The
    // first to reach the index holds it until it commits; the other nine block
    // there and are then told `23505`. Nothing above the database has to have
    // remembered anything.
    const outcomes = await Promise.allSettled(
      Array.from({ length: REPLAYS }, () =>
        db.transaction(async (tx) => {
          await tx.insert(payment).values(aGatewayPayment(GATEWAY_TRANSACTION_ID));
        }),
      ),
    );

    expect(outcomes.filter((each) => each.status === "fulfilled")).toHaveLength(
      1,
    );

    // Not merely "nine failed". Nine refusals is the right number whether they
    // are unique violations or a driver falling over, and only one of those two
    // is the property declining to take the money twice — the other is a
    // payment path that appears broken to VNPay, which will then retry.
    expect(
      outcomes
        .filter((each) => each.status === "rejected")
        .map((each) => refusalOf(each.reason).code),
    ).toEqual(Array.from({ length: REPLAYS - 1 }, () => UNIQUE_VIOLATION));

    // The assertion the requirement is actually about, read from the table
    // rather than inferred from the outcomes.
    expect(await paymentsOn(GATEWAY_TRANSACTION_ID)).toHaveLength(1);
  });

  it("is still one payment when the eleventh arrives an hour later", async () => {
    // The sequential replay, which the constraint also has to refuse. It is the
    // easy half and it is here because a partial index that had somehow been
    // built on the wrong column would still pass the concurrent test above by
    // accident of ordering.
    const refusal = await refused(() =>
      db.insert(payment).values(aGatewayPayment(GATEWAY_TRANSACTION_ID)),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(await paymentsOn(GATEWAY_TRANSACTION_ID)).toHaveLength(1);
  });

  it("keeps the amount the gateway reported, to the đồng", async () => {
    // `NFR-12`. The figure is one đồng above what a double can represent, so a
    // column or a driver routing money through `number` hands back an even
    // number — and a payment wrong by one đồng fails `NFR-02` in a way that is
    // unprovable rather than merely visible.
    const [stored] = await paymentsOn(GATEWAY_TRANSACTION_ID);

    expect(stored?.amount).toBe(1_200_000n);
    expect(typeof stored?.amount).toBe("bigint");
  });

  it("leaves the author unset, since no person authored it", async () => {
    // `folio_posting.posted_by` argues the same absence: the gateway's callback
    // writes a row on nobody's authority, and a placeholder account standing in
    // for it would make an automated payment indistinguishable from one a
    // receptionist took.
    const [stored] = await paymentsOn(GATEWAY_TRANSACTION_ID);

    expect(stored?.postedBy).toBeNull();
  });
});

describe("one attempt", () => {
  const A_REFERENCE = `${"0123456789abcdef".repeat(2)}${"fedcba9876543210".repeat(2)}`;

  it("is one row, whatever the gateway ends up saying about it", async () => {
    // The half the gateway id cannot cover. A refusal has no transaction id, so
    // the index above does not reach it and the gateway's second delivery of
    // one would write a second `FAILED` row — a guest asking why they were not
    // charged shown the same refusal twice, and `FR-PAY-05` reconciling against
    // a report that counts it once.
    const [opened] = await db
      .insert(payment)
      .values({
        folioId,
        method: "VNPAY",
        attemptReference: A_REFERENCE,
        amount: 1_200_000n,
        status: "PENDING",
      })
      .returning();

    const refusal = await refused(() =>
      db.insert(payment).values({
        folioId,
        method: "VNPAY",
        attemptReference: A_REFERENCE,
        amount: 1_200_000n,
        status: "FAILED",
      }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);

    await db.delete(payment).where(eq(payment.id, opened!.id));
  });

  it("resolves in place, which the ledger's own rule does not forbid", async () => {
    // `folio_posting` is append-only because `FR-FOL-01` corrects a guest's
    // account with a reversing entry. This table is the payer's side and not
    // that account: an attempt going from claimed to confirmed is one fact
    // finishing, and a `PENDING` row nothing could ever resolve would leave a
    // paid stay holding two.
    const [opened] = await db
      .insert(payment)
      .values({
        folioId,
        method: "VNPAY",
        attemptReference: A_REFERENCE,
        amount: 1_200_000n,
        status: "PENDING",
      })
      .returning();

    const [taken] = await db
      .update(payment)
      .set({
        status: "SUCCESS",
        gatewayTransactionId: "14528903",
        paidAt: PAID_AT,
      })
      .where(eq(payment.id, opened!.id))
      .returning();

    expect(taken).toMatchObject({
      id: opened!.id,
      attemptReference: A_REFERENCE,
      status: "SUCCESS",
      paidAt: PAID_AT,
    });

    await db.delete(payment).where(eq(payment.id, opened!.id));
  });
});

describe("the money the property collects itself", () => {
  it("takes as many cash and transfer payments as the desk takes", async () => {
    // The half the `where` clause on the index exists for. None of these has a
    // gateway id, and without the predicate the first one written would be the
    // only one the property could ever accept — a front desk that cannot take a
    // second payment, which is a worse outage than the one the index prevents.
    const written = await db
      .insert(payment)
      .values([
        aDeskPayment("CASH", 300_000n),
        aDeskPayment("CASH", 450_000n),
        aDeskPayment("BANK_TRANSFER", 1_000_000n),
        aDeskPayment("BANK_TRANSFER", 2_000_000n),
      ])
      .returning();

    expect(written).toHaveLength(4);
    expect(written.every((row) => row.gatewayTransactionId === null)).toBe(true);
    // And no attempt behind any of them, which is the other partial index's
    // `where` clause earning the same keep: four nulls that do not collide.
    expect(written.every((row) => row.attemptReference === null)).toBe(true);

    await db.delete(payment).where(sql`${payment.gatewayTransactionId} is null`);
  });

  it("names who took it", async () => {
    // `FR-AUD-01` asks who, and for cash there is an answer: somebody stood at
    // the desk and counted it.
    const [taken] = await db
      .insert(payment)
      .values(aDeskPayment("CASH", 300_000n))
      .returning();

    expect(taken?.postedBy).toBe(receptionistId);

    await db.delete(payment).where(eq(payment.id, taken!.id));
  });

  it("refuses an author who is not a staff account", async () => {
    const refusal = await refused(() =>
      db
        .insert(payment)
        .values({ ...aDeskPayment("CASH", 300_000n), postedBy: ABSENT_ID }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("what a payment has to say about itself", () => {
  it("refuses one that belongs to no account", async () => {
    const refusal = await refused(() =>
      db
        .insert(payment)
        .values({ ...aDeskPayment("CASH", 300_000n), folioId: ABSENT_ID }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("refuses a payment of nothing", async () => {
    const refusal = await refused(() =>
      db.insert(payment).values(aDeskPayment("CASH", 0n)),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("payment_amount_is_positive");
  });

  it("refuses a negative one, which is the ledger's convention and not this table's", async () => {
    // `folio_posting` stores a payment negative so the balance is a plain sum.
    // Repeating that here would put one convention in two places, and
    // `NFR-02`'s whole job is to compare the two tables.
    const refusal = await refused(() =>
      db.insert(payment).values(aDeskPayment("CASH", -300_000n)),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("payment_amount_is_positive");
  });

  it("refuses a payment that succeeded at no particular moment", async () => {
    const refusal = await refused(() =>
      db
        .insert(payment)
        .values({ ...aDeskPayment("CASH", 300_000n), paidAt: null }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("payment_paid_at_exactly_when_money_moved");
  });

  it("refuses a moment of payment on one nobody has paid", async () => {
    // The other direction. A pending transfer carrying a time of payment is
    // this process's clock standing in for a bank's, which is exactly the drift
    // `FR-PAY-05` reconciles for.
    const refusal = await refused(() =>
      db.insert(payment).values({
        ...aDeskPayment("BANK_TRANSFER", 300_000n),
        status: "PENDING",
      }),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("payment_paid_at_exactly_when_money_moved");
  });

  it("takes a transfer the desk has been told about and has not seen", async () => {
    const [claimed] = await db
      .insert(payment)
      .values({
        ...aDeskPayment("BANK_TRANSFER", 300_000n),
        status: "PENDING",
        paidAt: null,
      })
      .returning();

    expect(claimed?.status).toBe("PENDING");
    expect(claimed?.paidAt).toBeNull();

    await db.delete(payment).where(eq(payment.id, claimed!.id));
  });

  it("keeps a payment the gateway refused", async () => {
    // Deleting it would leave `FR-PAY-05` reconciling one report against a gap,
    // and a guest asking why they were not charged with nothing to be shown.
    const [refusedPayment] = await db
      .insert(payment)
      .values({
        folioId,
        method: "VNPAY",
        gatewayTransactionId: "14528902",
        amount: 1_200_000n,
        status: "FAILED",
      })
      .returning();

    expect(refusedPayment?.status).toBe("FAILED");
    expect(refusedPayment?.paidAt).toBeNull();

    await db.delete(payment).where(eq(payment.id, refusedPayment!.id));
  });
});

/** A payment as a verified callback would write it. */
function aGatewayPayment(
  gatewayTransactionId: string,
): typeof payment.$inferInsert {
  return {
    folioId,
    method: "VNPAY",
    gatewayTransactionId,
    amount: 1_200_000n,
    status: "SUCCESS",
    paidAt: PAID_AT,
  };
}

/** A payment somebody at the desk took, which has no gateway behind it. */
function aDeskPayment(
  method: "CASH" | "BANK_TRANSFER",
  amount: bigint,
): typeof payment.$inferInsert {
  return {
    folioId,
    method,
    amount,
    status: "SUCCESS",
    paidAt: PAID_AT,
    postedBy: receptionistId,
    // Cash only, which is `payment_shift_binding` in both directions: money the
    // desk counted belongs to a drawer, and a transfer that never reached one
    // may not name a shift.
    shiftId: method === "CASH" ? shiftId : null,
  };
}

/** A drawer somebody has open, for the cash above to belong to. */
async function anOpenShift(
  database: typeof db,
  operatorId: string,
): Promise<string> {
  const [opened] = await database
    .insert(shift)
    .values({
      operatorId,
      openingFloat: 0n,
      openingBusinessDate: "2027-11-02",
    })
    .returning({ id: shift.id });

  return opened!.id;
}

/** Every payment written under one gateway id. */
async function paymentsOn(
  gatewayTransactionId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return db
    .select()
    .from(payment)
    .where(eq(payment.gatewayTransactionId, gatewayTransactionId));
}

/** A stay to hang an account on. */
async function aBooking(executor: Tx | typeof db): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await executor
    .insert(booking)
    .values({
      reference: `MRV-PAY-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId: await someRoomType(executor),
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning();

  return stay!.id;
}

async function anOpenFolio(
  executor: Tx | typeof db,
  onBooking: string,
): Promise<string> {
  const [opened] = await executor
    .insert(folio)
    .values({ bookingId: onBooking })
    .returning();

  return opened!.id;
}

/** Whatever room type the database already holds, and one of its own only if it
 *  holds none. The five codes and the display orders are unique, so a file that
 *  is not the owner of the property cannot simply add a sixth. */
async function someRoomType(executor: Tx | typeof db): Promise<string> {
  const [existing] = await executor
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await executor
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
    .returning();

  return created!.id;
}

/** Somebody to have taken the cash. The email is this file's own, because the
 *  column is unique and the suite does not own the table. */
async function aReceptionist(executor: Tx | typeof db): Promise<string> {
  const [created] = await executor
    .insert(staffUser)
    .values({
      email: "le.tan.thu.ngan@mariva.test",
      fullName: "Nguyễn Thị Hoa",
      role: "RECEPTIONIST",
      // Never verified against — nothing here signs in. Argon2 is deliberately
      // slow and hashing a password the file will not use would be seconds
      // spent proving nothing.
      passwordHash: "not-a-hash-nothing-here-signs-in",
    })
    .returning();

  return created!.id;
}

type Refusal = { code: string; message: string; constraint?: string };

/** The refusal a write provoked. Fails the test if the write was accepted. */
async function refused(write: () => Promise<unknown>): Promise<Refusal> {
  try {
    await write();
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE, message and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed to
 * be one deep.
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
        message: current.message,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
