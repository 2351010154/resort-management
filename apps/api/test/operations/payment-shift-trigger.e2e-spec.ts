// The drawer a cash payment is counted into, against a real Postgres.
//
// `payment_shift_binding` makes a cash payment name a shift. It cannot say
// *which*: a check constraint sees the row being written and this rule is about
// the row it points at — whether that drawer is still open, and whether it
// belongs to the person who took the money. The trigger in
// `0040_a_payment_is_counted_into_an_open_shift_of_its_own.sql` reads both, and
// no assertion over a schema object can prove it, so the claims are made here
// against a database with the migrations applied.
//
// What is at stake is money rather than tidiness. Cash bound to a shift that
// was counted out an hour ago leaves the operator who signed for that count
// short by the whole of it; cash bound to a colleague's drawer moves the same
// variance onto somebody else's handover. Neither throws anywhere else, and
// both surface as a receptionist being asked to explain a figure nobody can
// trace.
//
// The last case is the one a sequential test cannot reach. A close and a
// payment running side by side both read a shift that is open in their own
// snapshot, and without the row lock the trigger takes, both commit — which is
// exactly the row it exists to refuse. Two connections and a held transaction
// are what tell those two implementations apart.
//
// Rows are committed and deleted afterwards rather than rolled back, because
// the concurrent case cannot run inside one transaction. It applies the
// migrations rather than pushing the schema: a trigger has no Drizzle
// expression, so only migrating puts it there. No Nest application is booted —
// the subject is the database itself.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../../src/database/schema/booking.js";
import { folio } from "../../src/database/schema/folio.js";
import { staffUser } from "../../src/database/schema/identity.js";
import * as schema from "../../src/database/schema/index.js";
import { roomType } from "../../src/database/schema/inventory.js";
import { payment } from "../../src/database/schema/payment.js";
import { shift } from "../../src/database/schema/shift.js";

/** The SQLSTATE the drawer's own refusals carry. */
const SHIFT_VIOLATION = "MV006";
const FOREIGN_KEY_VIOLATION = "23503";

const ARRIVAL_DATE = "2027-12-01";
const DEPARTURE_DATE = "2027-12-03";
const BUSINESS_DATE = "2027-12-01";

const PAID_AT = new Date("2027-12-01T10:30:00Z");

/** A uuid no staff account has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Long enough for a statement to have reached the lock it is going to wait on.
 * Only the ordering is asserted, never the delay itself.
 */
const SETTLE_MS = 250;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

let bookingId: string;
let folioId: string;

/** The receptionist whose drawer it is, and a colleague with one of their own. */
let receptionistId: string;
let colleagueId: string;

let openDrawerId: string;
let colleaguesDrawerId: string;
let countedOutDrawerId: string;

/** Closed by the concurrent case, so it is that case's own and not shared. */
let contestedDrawerId: string;

/** Every staff account this file opened, removed in the order they were made. */
const staffOpened: string[] = [];

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  // Two connections at once is the whole of the concurrency below; the rest is
  // headroom, so that a held transaction never starves the reads around it.
  pool = new pg.Pool({ connectionString, max: 5 });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  receptionistId = await aReceptionist(
    "ca.truc.som@mariva.test",
    "Trần Thị Mai",
  );
  colleagueId = await aReceptionist("ca.truc.dem@mariva.test", "Lê Văn Bình");

  const thirdOperatorId = await aReceptionist(
    "ca.truc.chieu@mariva.test",
    "Phạm Thị Lan",
  );

  bookingId = await aBooking();
  folioId = await anOpenFolio(bookingId);

  // The counted-out drawer first, and the order is what makes the two fixtures
  // able to share an operator at all: `shift_one_open_per_operator` is partial
  // on the open ones, so the closed drawer has to be opened and closed before
  // the one that stays open — the other way round is two open drawers for one
  // person, which is exactly the row that index refuses.
  countedOutDrawerId = await aCountedOutShift(receptionistId);
  openDrawerId = await anOpenShift(receptionistId);
  colleaguesDrawerId = await anOpenShift(colleagueId);
  contestedDrawerId = await anOpenShift(thirdOperatorId);
});

afterAll(async () => {
  // In key order: the payments name the folio and the shifts, the folio names
  // the booking, and every shift names the staff account it belongs to.
  if (db) {
    await db.delete(payment).where(eq(payment.folioId, folioId));
    await db.delete(folio).where(eq(folio.id, folioId));
    await db.delete(booking).where(eq(booking.id, bookingId));

    for (const drawer of [
      openDrawerId,
      colleaguesDrawerId,
      countedOutDrawerId,
      contestedDrawerId,
    ]) {
      await db.delete(shift).where(eq(shift.id, drawer));
    }

    for (const member of staffOpened) {
      await db.delete(staffUser).where(eq(staffUser.id, member));
    }
  }

  await pool?.end();
});

describe("cash counted into a drawer", () => {
  it("is taken when the drawer is open and it is the poster's own", async () => {
    const [taken] = await db
      .insert(payment)
      .values(cashInto(openDrawerId, receptionistId))
      .returning();

    expect(taken).toMatchObject({
      method: "CASH",
      status: "SUCCESS",
      shiftId: openDrawerId,
      postedBy: receptionistId,
    });

    await db.delete(payment).where(eq(payment.id, taken!.id));
  });

  it("is refused when the drawer has already been counted out", async () => {
    // A handover is the count plus what the shift took. Money arriving after
    // the count leaves the operator who signed for it short by the whole of it,
    // with no line anywhere saying why.
    const refusal = await refused(() =>
      db.insert(payment).values(cashInto(countedOutDrawerId, receptionistId)),
    );

    expect(refusal.code).toBe(SHIFT_VIOLATION);
    expect(await cashOn(countedOutDrawerId)).toHaveLength(0);
  });

  it("is refused when the drawer belongs to somebody else", async () => {
    // The same đồng, moved onto a colleague's variance — and the colleague is
    // the one asked to explain it at their own handover.
    const refusal = await refused(() =>
      db.insert(payment).values(cashInto(colleaguesDrawerId, receptionistId)),
    );

    expect(refusal.code).toBe(SHIFT_VIOLATION);
    expect(await cashOn(colleaguesDrawerId)).toHaveLength(0);
  });

  it("is taken when nobody is named, which is a question about the payment and not the drawer", async () => {
    // `posted_by` is nullable by design, and what the trigger refuses is a
    // *named* poster who is not the drawer's operator. Whether cash may go
    // unattributed at all is a rule about the `payment` row; refusing it here
    // would be this trigger answering a question it was not asked.
    const [taken] = await db
      .insert(payment)
      .values(cashInto(openDrawerId, null))
      .returning();

    expect(taken?.postedBy).toBeNull();
    expect(taken?.shiftId).toBe(openDrawerId);

    await db.delete(payment).where(eq(payment.id, taken!.id));
  });

  it("is refused by the key, not by the drawer, when the poster is no staff account", async () => {
    // Two different mistakes. "That author does not exist" is the more precise
    // answer, and a `BEFORE` trigger raising first would hide it behind "this
    // drawer is not yours".
    const refusal = await refused(() =>
      db.insert(payment).values({
        ...cashInto(openDrawerId, receptionistId),
        postedBy: ABSENT_ID,
      }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("a close and a payment arriving together", () => {
  it("leaves the cash refused rather than counted into a drawer already closed", async () => {
    // The case a sequential test cannot reach. Both statements read a shift
    // that is open in their own snapshot, and the foreign key's `FOR KEY SHARE`
    // does not conflict with the close's `FOR NO KEY UPDATE` — so without the
    // row lock the trigger takes, both commit and the count is short by this
    // payment.
    let releaseClose: () => void = () => undefined;
    const closeHeld = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    const closing = db.transaction(async (tx) => {
      await tx
        .update(shift)
        .set({ closingCount: 2_000_000n, closedAt: new Date() })
        .where(eq(shift.id, contestedDrawerId));

      // Held open so that the payment below meets a lock rather than a
      // committed row, which is the arrangement being tested.
      await closeHeld;
    });

    await pause(SETTLE_MS);

    // Started while the close still holds the row: it blocks on the lock the
    // trigger takes and settles only once the close has committed.
    const attempt = refused(() =>
      db.insert(payment).values(cashInto(contestedDrawerId, null)),
    );

    await pause(SETTLE_MS);

    releaseClose();
    await closing;

    expect((await attempt).code).toBe(SHIFT_VIOLATION);
    expect(await cashOn(contestedDrawerId)).toHaveLength(0);
  });
});

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cash as the desk would write it: `SUCCESS`, dated, and naming a drawer. */
function cashInto(
  drawerId: string,
  postedBy: string | null,
): typeof payment.$inferInsert {
  return {
    folioId,
    method: "CASH",
    amount: 300_000n,
    status: "SUCCESS",
    paidAt: PAID_AT,
    postedBy,
    shiftId: drawerId,
  };
}

/** Every payment bound to one drawer. */
async function cashOn(
  drawerId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return db.select().from(payment).where(eq(payment.shiftId, drawerId));
}

async function anOpenShift(operatorId: string): Promise<string> {
  const [opened] = await db
    .insert(shift)
    .values({
      operatorId,
      openingFloat: 2_000_000n,
      openingBusinessDate: BUSINESS_DATE,
    })
    .returning({ id: shift.id });

  return opened!.id;
}

/**
 * A drawer somebody has counted out.
 *
 * Opened and then closed in two statements, because
 * `shift_one_open_per_operator` is partial on the open ones: an operator may
 * have any number of closed shifts behind them and one open drawer now, which
 * is what lets this fixture and the open one share an operator.
 */
async function aCountedOutShift(operatorId: string): Promise<string> {
  const drawerId = await anOpenShift(operatorId);

  await db
    .update(shift)
    .set({
      closingCount: 2_300_000n,
      closedAt: new Date("2027-12-01T14:00:00Z"),
    })
    .where(eq(shift.id, drawerId));

  return drawerId;
}

/** A stay to hang an account on. */
async function aBooking(): Promise<string> {
  const [stay] = await db
    .insert(booking)
    .values({
      reference: "MRV-SHIFT-0001",
      state: "CONFIRMED",
      roomTypeId: await someRoomType(),
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_600_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

async function anOpenFolio(onBooking: string): Promise<string> {
  const [opened] = await db
    .insert(folio)
    .values({ bookingId: onBooking })
    .returning({ id: folio.id });

  return opened!.id;
}

/**
 * Whatever room type the database already holds, and one of its own only if it
 * holds none. The codes and display orders are unique, so a file that is not
 * the owner of the property cannot simply add another.
 */
async function someRoomType(): Promise<string> {
  const [existing] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  if (existing) {
    return existing.id;
  }

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

/**
 * Somebody to have counted the cash. The email is unique and the suite does not
 * own the table, so each account here is this file's own and is removed again.
 */
async function aReceptionist(
  email: string,
  fullName: string,
): Promise<string> {
  const [created] = await db
    .insert(staffUser)
    .values({
      email,
      fullName,
      role: "RECEPTIONIST",
      // Never verified against — nothing here signs in, and Argon2 is
      // deliberately slow.
      passwordHash: "not-a-hash-nothing-here-signs-in",
    })
    .returning({ id: staffUser.id });

  staffOpened.push(created!.id);

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
