// The drawer's own service against a real Postgres — `FR-OPS-01`.
//
// Nothing here could be proved against a stubbed executor, because every claim
// this service makes is a claim about the database. One open drawer per operator
// is a partial unique index and the service's part in it is reading `23505` off
// a refusal it did not pre-empt — a stub would only show that the code calls a
// method the test author remembered to spy on. The cash a drawer took is a
// correlated sum with a left join in it, and SQL is only right where it runs.
// The close's lock is the sharpest of the three: the ordering it guarantees
// exists only between two connections, and one process cannot pretend to it.
//
// It applies the migrations rather than pushing the schema, because the trigger
// in `0040` is what refuses a payment into a drawer this file has closed, and no
// Drizzle expression puts a trigger there.
//
// No Nest application is booted. The service takes its executor as an argument
// and injects one collaborator that itself takes an executor, so the subject is
// reachable with a `new` — and this file stays independent of where the module
// is registered.

import { fromDate, parseDate, toCalendarDate } from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { booking } from "../../src/database/schema/booking.js";
import { systemConfig } from "../../src/database/schema/config.js";
import { folio, folioPosting } from "../../src/database/schema/folio.js";
import { staffUser } from "../../src/database/schema/identity.js";
import * as schema from "../../src/database/schema/index.js";
import { roomType } from "../../src/database/schema/inventory.js";
import { payment } from "../../src/database/schema/payment.js";
import { shift } from "../../src/database/schema/shift.js";
import { BusinessDateService } from "../../src/modules/booking/business-date.service.js";
import { ShiftService } from "../../src/modules/operations/shift.service.js";
import { SystemConfigService } from "../../src/modules/system-config/system-config.service.js";

/**
 * The property, configured to roll its day at midnight.
 *
 * That hour is the one choice here that a case reads: with it, the property's
 * trading day is its own calendar date in `PROPERTY_TIME_ZONE`, which is a date
 * this file can work out without restating `businessDateAt`. The tax figures are
 * present because the row demands them and no case below posts anything.
 */
const CONFIGURED = {
  standardVatRateBps: 1_000,
  reducedVatRateBps: 500,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 500,
  businessDateRolloverHour: 0,
} satisfies typeof systemConfig.$inferInsert;

const OPENING_FLOAT = 2_000_000n;

/** Two guests paying cash on one shift, so the sum has something to add. */
const FIRST_CASH = 300_000n;
const SECOND_CASH = 450_000n;
const CASH_TAKEN = FIRST_CASH + SECOND_CASH;

/** A drawer counted out with every đồng the day put in it. */
const SQUARE_COUNT = OPENING_FLOAT + CASH_TAKEN;

/** Long enough for a statement to have reached the lock it will wait on. Only
 *  the ordering is ever asserted, never the delay. */
const SETTLE_MS = 250;

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let shifts: ShiftService;

let roomTypeId: string;
let folioId: string;

/** The receptionist whose day this is, a colleague, and somebody senior. */
let deskId: string;
let colleagueId: string;
let managerId: string;

let bookingOrdinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  // Three connections at once is the whole of the concurrency below — a held
  // payment, a blocked close, and the reads around them.
  pool = new pg.Pool({ connectionString, max: 5 });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheDesk();
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
  );
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

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

  deskId = await aReceptionist("ca.sang@mariva.test", "Trần Thị Mai");
  colleagueId = await aReceptionist("ca.chieu@mariva.test", "Lê Văn Bình");
  managerId = await aManager("quan.ly@mariva.test", "Phạm Thị Lan");

  folioId = await anAccount();

  shifts = new ShiftService(new BusinessDateService(new SystemConfigService()));
});

beforeEach(async () => {
  // Every case opens the drawers it needs, and `shift_one_open_per_operator`
  // holds the operators to one apiece — so the drawers of the case before have
  // to be gone rather than merely closed.
  await clearTheDesk();
});

afterAll(async () => {
  await clearTheDesk();
  await pool?.end();
});

describe("opening a drawer", () => {
  it("stamps it with the property's trading day and nothing counted yet", async () => {
    // The rollover is seeded at midnight, so the property's day is its own
    // calendar date in Ho Chi Minh City. Both readings are taken because a run
    // that straddled local midnight would otherwise fail for being correct.
    const before = todayAtTheProperty();
    const opened = await shifts.open(db, {
      operatorId: deskId,
      openingFloat: OPENING_FLOAT,
    });
    const after = todayAtTheProperty();

    expect([before, after]).toContain(opened.openingBusinessDate);
    expect(opened).toMatchObject({
      operatorId: deskId,
      operatorName: "Trần Thị Mai",
      openingFloat: OPENING_FLOAT,
      // Nothing has been paid into it, and that is a sum over no rows rather
      // than a zero this service wrote down.
      cashTaken: 0n,
      closingCount: null,
      closedAt: null,
      handoverNote: null,
    });
    // A drawer nobody has counted has nothing to be out by.
    expect(opened.variance).toBeNull();
  });

  it("refuses a second drawer to the same operator", async () => {
    // The refusal comes from `shift_one_open_per_operator` and not from a look
    // this service took first: between a read and the insert after it there is
    // nothing holding the key, and one person answerable for two drawers is
    // cash landing in whichever the handler saw first.
    await shifts.open(db, { operatorId: deskId, openingFloat: OPENING_FLOAT });

    const refusal = await refused(
      shifts.open(db, { operatorId: deskId, openingFloat: OPENING_FLOAT }),
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("already have a shift open");
    expect(await drawersOf(deskId)).toHaveLength(1);
  });

  it("lets an operator open another once the first has been counted out", async () => {
    // The index is partial on the open rows, so a receptionist may work every
    // day of the year and still be refused a second drawer today.
    const first = await shifts.open(db, {
      operatorId: deskId,
      openingFloat: OPENING_FLOAT,
    });

    await shifts.close(db, {
      shiftId: first.id,
      closingCount: OPENING_FLOAT,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    const second = await shifts.open(db, {
      operatorId: deskId,
      openingFloat: OPENING_FLOAT,
    });

    expect(second.id).not.toBe(first.id);
    expect(await drawersOf(deskId)).toHaveLength(2);
  });

  it("refuses an operator no staff account answers to", async () => {
    const refusal = await refused(
      shifts.open(db, { operatorId: ABSENT_ID, openingFloat: OPENING_FLOAT }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("what the drawer took", () => {
  it("sums the cash bound to it while it is still open", async () => {
    // The figure exists before the count because a shift is counted *then*
    // closed: a `cashTaken` that only appeared afterwards would arrive one act
    // too late for the person standing at the drawer.
    const drawer = await anOpenDrawer(deskId);

    await cashInto(drawer.id, deskId, FIRST_CASH);
    await cashInto(drawer.id, deskId, SECOND_CASH);

    const current = await shifts.current(db, deskId);

    expect(current?.cashTaken).toBe(CASH_TAKEN);
    expect(current?.variance).toBeNull();
  });

  it("leaves the variance at nothing when the count matches the float and the cash", async () => {
    const drawer = await anOpenDrawer(deskId);

    await cashInto(drawer.id, deskId, FIRST_CASH);
    await cashInto(drawer.id, deskId, SECOND_CASH);

    const closed = await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: SQUARE_COUNT,
      handoverNote: "Két đủ tiền.",
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(closed.cashTaken).toBe(CASH_TAKEN);
    expect(closed.closingCount).toBe(SQUARE_COUNT);
    expect(closed.variance).toBe(0n);
    expect(closed.handoverNote).toBe("Két đủ tiền.");
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it("reports a drawer that is short as a negative figure and one that is over as a positive", async () => {
    // The sign is the first thing a manager asks, and both directions are
    // wrong: more đồng than the property can account for is not a windfall.
    const short = await anOpenDrawer(deskId);
    await cashInto(short.id, deskId, FIRST_CASH);

    const counted = await shifts.close(db, {
      shiftId: short.id,
      closingCount: OPENING_FLOAT + FIRST_CASH - 50_000n,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(counted.variance).toBe(-50_000n);

    const over = await anOpenDrawer(colleagueId);
    await cashInto(over.id, colleagueId, SECOND_CASH);

    const overCounted = await shifts.close(db, {
      shiftId: over.id,
      closingCount: OPENING_FLOAT + SECOND_CASH + 20_000n,
      closedBy: colleagueId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(overCounted.variance).toBe(20_000n);
  });

  it("counts no cash that another drawer took", async () => {
    const mine = await anOpenDrawer(deskId);
    const theirs = await anOpenDrawer(colleagueId);

    await cashInto(theirs.id, colleagueId, SECOND_CASH);

    expect((await shifts.current(db, deskId))?.cashTaken).toBe(0n);
    expect((await shifts.current(db, colleagueId))?.cashTaken).toBe(
      SECOND_CASH,
    );
    expect(mine.id).not.toBe(theirs.id);
  });

  it("leaves out money handed back before the drawer was counted", async () => {
    // A card payment keyed as cash and corrected minutes later never reached
    // the drawer. Counting it in would hand the receptionist a shortfall for
    // đồng the count rightly did not find.
    const drawer = await anOpenDrawer(deskId);

    await cashInto(drawer.id, deskId, FIRST_CASH);
    const misKeyed = await cashInto(drawer.id, deskId, SECOND_CASH);

    await handBack(misKeyed, SECOND_CASH, new Date());

    expect((await shifts.current(db, deskId))?.cashTaken).toBe(FIRST_CASH);

    const closed = await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT + FIRST_CASH,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(closed.variance).toBe(0n);
  });

  it("keeps money handed back after the count inside the figure that was signed for", async () => {
    // The đồng were in the drawer when it was counted, and the closing figure
    // attests to them. A reversal days later is an act of its own day: letting
    // it rewrite this shift would put a shortfall on a drawer that was square
    // when somebody signed for it, while the drawer that actually paid the
    // money out already shows the loss in its own count.
    const drawer = await anOpenDrawer(deskId);
    const taken = await cashInto(drawer.id, deskId, FIRST_CASH);

    const closed = await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT + FIRST_CASH,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(closed.variance).toBe(0n);

    await handBack(taken, FIRST_CASH, laterThan(closed.closedAt!));

    const readBack = await onePageOfHistory({ operatorId: deskId });

    expect(readBack.shifts[0]?.cashTaken).toBe(FIRST_CASH);
    expect(readBack.shifts[0]?.variance).toBe(0n);
  });
});

describe("counting the drawer out", () => {
  it("refuses a drawer that has already been counted", async () => {
    // Not made idempotent: the stored count was signed for by whoever took it,
    // and overwriting it would replace the figure the variance stands on with
    // one taken at another moment.
    const drawer = await anOpenDrawer(deskId);

    await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    const refusal = await refused(
      shifts.close(db, {
        shiftId: drawer.id,
        closingCount: 999_999n,
        closedBy: deskId,
        mayCloseAnotherOperatorsDrawer: false,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");

    const [stored] = await db
      .select({ closingCount: shift.closingCount })
      .from(shift)
      .where(eq(shift.id, drawer.id));

    expect(stored?.closingCount).toBe(OPENING_FLOAT);
  });

  it("refuses a receptionist the drawer of a colleague", async () => {
    const theirs = await anOpenDrawer(colleagueId);

    const refusal = await refused(
      shifts.close(db, {
        shiftId: theirs.id,
        closingCount: OPENING_FLOAT,
        closedBy: deskId,
        mayCloseAnotherOperatorsDrawer: false,
      }),
    );

    expect(refusal.code).toBe("FORBIDDEN");
    expect((await shifts.current(db, colleagueId))?.id).toBe(theirs.id);
  });

  it("lets somebody senior close the drawer a colleague went home without closing", async () => {
    // The grant the matrix gives `MANAGER` on the cash drawer, and the case it
    // is for. Without it that drawer stays open forever and every cash payment
    // after it belongs to a day nobody closed.
    const abandoned = await anOpenDrawer(colleagueId);

    const closed = await shifts.close(db, {
      shiftId: abandoned.id,
      closingCount: OPENING_FLOAT,
      handoverNote: "Ca trước về sớm, quản lý kiểm két.",
      closedBy: managerId,
      mayCloseAnotherOperatorsDrawer: true,
    });

    expect(closed.closedAt).toBeInstanceOf(Date);
    // Whose drawer it was does not change for having been closed by somebody
    // else — the variance is still the colleague's to explain.
    expect(closed.operatorId).toBe(colleagueId);
    expect(await shifts.current(db, colleagueId)).toBeNull();
  });

  it("refuses a shift id nothing answers to", async () => {
    const refusal = await refused(
      shifts.close(db, {
        shiftId: ABSENT_ID,
        closingCount: OPENING_FLOAT,
        closedBy: deskId,
        mayCloseAnotherOperatorsDrawer: false,
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("stores no note for a quiet shift rather than an empty one", async () => {
    const drawer = await anOpenDrawer(deskId);

    const closed = await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(closed.handoverNote).toBeNull();
  });
});

describe("a close and a payment arriving together", () => {
  it("counts the drawer with the payment in flight inside it", async () => {
    // The claim `migrations/0040` makes and no sequential case can reach. The
    // trigger takes `FOR SHARE` on the drawer when cash is written into it, and
    // the close takes `FOR UPDATE` before it sums — so the close waits for the
    // payment rather than counting a drawer the đồng are about to land in. Read
    // the other way round, the shift would be closed on a figure that was true
    // a moment ago and the receptionist would be asked to explain it.
    const drawer = await anOpenDrawer(deskId);

    let releasePayment: () => void = () => undefined;
    const paymentHeld = new Promise<void>((resolve) => {
      releasePayment = resolve;
    });

    const takingCash = db.transaction(async (tx) => {
      await tx.insert(payment).values(cash(drawer.id, deskId, FIRST_CASH));

      // Held open so the close below meets a lock rather than a committed row,
      // which is the arrangement being tested.
      await paymentHeld;
    });

    await pause(SETTLE_MS);

    // Started while the payment still holds the drawer: it blocks on the row
    // lock and settles only once that transaction has committed.
    const closing = db.transaction((tx) =>
      shifts.close(tx, {
        shiftId: drawer.id,
        closingCount: OPENING_FLOAT + FIRST_CASH,
        closedBy: deskId,
        mayCloseAnotherOperatorsDrawer: false,
      }),
    );

    await pause(SETTLE_MS);

    releasePayment();
    await takingCash;

    const closed = await closing;

    expect(closed.cashTaken).toBe(FIRST_CASH);
    expect(closed.variance).toBe(0n);
  });
});

describe("the drawer a receptionist is on", () => {
  it("is null for somebody who has not opened one", async () => {
    // Not a refusal: nothing is wrong with not being on a shift, and the shell
    // renders "no shift" from this and offers to open one.
    expect(await shifts.current(db, deskId)).toBeNull();
  });

  it("is not a drawer that has been counted out", async () => {
    const drawer = await anOpenDrawer(deskId);

    await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT,
      closedBy: deskId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    expect(await shifts.current(db, deskId)).toBeNull();
  });
});

describe("the history of the desk", () => {
  it("ranges over the trading day a shift belongs to and not the clock it opened on", async () => {
    // The night shift is why `opening_business_date` is stored at all: opened
    // at 01:00 on the second, answerable for the first. A history filtered on
    // the instant would file its variance under a day already reported.
    const night = await aShiftOn(deskId, "2027-12-01", "2027-12-02T01:00:00Z");
    const morning = await aShiftOn(
      colleagueId,
      "2027-12-02",
      "2027-12-02T09:00:00Z",
    );

    const secondOfDecember = await onePageOfHistory({
      from: parseDate("2027-12-02"),
      to: parseDate("2027-12-02"),
    });

    expect(secondOfDecember.shifts.map((one) => one.id)).toEqual([morning]);
    expect(secondOfDecember.total).toBe(1);

    const firstOfDecember = await onePageOfHistory({
      from: parseDate("2027-12-01"),
      to: parseDate("2027-12-01"),
    });

    expect(firstOfDecember.shifts.map((one) => one.id)).toEqual([night]);
  });

  it("narrows to one person when a manager asks about their day", async () => {
    const theirs = await aShiftOn(deskId, "2027-12-01", "2027-12-01T08:00:00Z");
    await aShiftOn(colleagueId, "2027-12-01", "2027-12-01T16:00:00Z");

    const page = await onePageOfHistory({ operatorId: deskId });

    expect(page.shifts.map((one) => one.id)).toEqual([theirs]);
    expect(page.total).toBe(1);
    expect(page.shifts[0]?.operatorName).toBe("Trần Thị Mai");
  });

  it("answers newest opening first, and pages by rows rather than by page number", async () => {
    const first = await aShiftOn(deskId, "2027-12-01", "2027-12-01T06:00:00Z");
    const second = await aShiftOn(
      colleagueId,
      "2027-12-01",
      "2027-12-01T14:00:00Z",
    );
    const third = await aShiftOn(
      managerId,
      "2027-12-01",
      "2027-12-01T22:00:00Z",
    );

    const wholeDay = await onePageOfHistory({});

    expect(wholeDay.shifts.map((one) => one.id)).toEqual([
      third,
      second,
      first,
    ]);

    // `total` is counted under the predicate the page was cut from, so a pager
    // can offer a last page rather than only a next one.
    const tail = await shifts.history(db, { limit: 2, offset: 2 });

    expect(tail.shifts.map((one) => one.id)).toEqual([first]);
    expect(tail.total).toBe(3);
  });

  it("shows the open drawer beside the closed ones, with nothing to be out by", async () => {
    // It is history the moment it is a row. Dropping it would mean a manager
    // looking at today could not see who is on the desk.
    const open = await shifts.open(db, {
      operatorId: deskId,
      openingFloat: OPENING_FLOAT,
    });

    const page = await onePageOfHistory({ operatorId: deskId });

    expect(page.shifts.map((one) => one.id)).toEqual([open.id]);
    expect(page.shifts[0]?.closedAt).toBeNull();
    expect(page.shifts[0]?.variance).toBeNull();
  });
});

/** The calendar date the property is on, over a rollover seeded at midnight. */
function todayAtTheProperty(): string {
  return toCalendarDate(fromDate(new Date(), PROPERTY_TIME_ZONE)).toString();
}

/** An instant safely after the given one, for a correction made later. */
function laterThan(moment: Date): Date {
  return new Date(moment.getTime() + 60_000);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A whole page of whatever the filters match, so a case asserts on the rows. */
async function onePageOfHistory(query: {
  operatorId?: string;
  from?: StayDate;
  to?: StayDate;
}) {
  return shifts.history(db, { ...query, limit: 50, offset: 0 });
}

async function anOpenDrawer(operatorId: string) {
  return shifts.open(db, { operatorId, openingFloat: OPENING_FLOAT });
}

/** Every drawer one operator has been answerable for. */
async function drawersOf(operatorId: string) {
  return db.select().from(shift).where(eq(shift.operatorId, operatorId));
}

/**
 * A shift on a chosen trading day, written directly.
 *
 * The service always stamps today, which is the whole of its part in the
 * business date — so a history that ranges over days needs rows the service
 * could not have produced in one run.
 */
async function aShiftOn(
  operatorId: string,
  businessDate: string,
  openedAt: string,
): Promise<string> {
  const [opened] = await db
    .insert(shift)
    .values({
      operatorId,
      openingFloat: OPENING_FLOAT,
      openingBusinessDate: businessDate,
      openedAt: new Date(openedAt),
      closingCount: OPENING_FLOAT,
      closedAt: new Date(openedAt),
    })
    .returning({ id: shift.id });

  return opened!.id;
}

/** Cash as the desk writes it: `SUCCESS`, dated, and naming a drawer. */
function cash(
  drawerId: string,
  operatorId: string,
  amount: bigint,
): typeof payment.$inferInsert {
  return {
    folioId,
    method: "CASH",
    amount,
    status: "SUCCESS",
    paidAt: new Date(),
    postedBy: operatorId,
    shiftId: drawerId,
  };
}

/**
 * Money counted into a drawer, with the ledger line it is the payer's side of.
 *
 * The line is written because a reversal is addressed through it — the payment
 * row records no moment of its own for a correction to be dated by.
 */
async function cashInto(
  drawerId: string,
  operatorId: string,
  amount: bigint,
): Promise<{ paymentId: string; postingId: string }> {
  const [line] = await db
    .insert(folioPosting)
    .values({
      folioId,
      type: "PAYMENT",
      // The ledger's sign convention: money in reduces what is owed.
      amount: -amount,
      description: "Tiền mặt tại quầy",
      businessDate: "2027-12-01",
    })
    .returning({ id: folioPosting.id });

  const [taken] = await db
    .insert(payment)
    .values({ ...cash(drawerId, operatorId, amount), folioPostingId: line!.id })
    .returning({ id: payment.id });

  return { paymentId: taken!.id, postingId: line!.id };
}

/**
 * The money given back, written the way `FolioService.reversePosting` writes it:
 * a `REVERSAL` line against the payment's own, and the payer's side settled to
 * `REFUNDED`.
 */
async function handBack(
  collected: { paymentId: string; postingId: string },
  amount: bigint,
  at: Date,
): Promise<void> {
  await db.insert(folioPosting).values({
    folioId,
    type: "REVERSAL",
    // The exact negation of the payment line, which is what makes the pair sum
    // to nothing: undoing money in is money out.
    amount,
    description: "Reverses Tiền mặt tại quầy",
    reversesPostingId: collected.postingId,
    businessDate: "2027-12-01",
    postedAt: at,
  });

  await db
    .update(payment)
    .set({ status: "REFUNDED" })
    .where(eq(payment.id, collected.paymentId));
}

/** A stay to hang the account on, so cash has a folio to be paid into. */
async function anAccount(): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-DRAWER-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: "2027-12-01",
      checkOutDate: "2027-12-03",
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_600_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const [opened] = await db
    .insert(folio)
    .values({ bookingId: stay!.id })
    .returning({ id: folio.id });

  return opened!.id;
}

async function aReceptionist(
  email: string,
  fullName: string,
): Promise<string> {
  return aStaffAccount(email, fullName, "RECEPTIONIST");
}

async function aManager(email: string, fullName: string): Promise<string> {
  return aStaffAccount(email, fullName, "MANAGER");
}

async function aStaffAccount(
  email: string,
  fullName: string,
  role: "RECEPTIONIST" | "MANAGER",
): Promise<string> {
  const [created] = await db
    .insert(staffUser)
    .values({
      email,
      fullName,
      role,
      // Never verified against — nothing here signs in, and Argon2 is
      // deliberately slow.
      passwordHash: "not-a-hash-nothing-here-signs-in",
    })
    .returning({ id: staffUser.id });

  return created!.id;
}

/**
 * The drawers and the money in them, emptied.
 *
 * `folio_posting` is append-only, so `truncate` is the only way back — it needs
 * rights over the table rather than over its rows. The account itself stands:
 * it holds nothing once its lines are gone, and every case here pays into the
 * same stay.
 */
async function clearTheDesk(): Promise<void> {
  await db.execute(
    sql`truncate pending_item, payment, folio_posting, shift restart identity cascade`,
  );
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
