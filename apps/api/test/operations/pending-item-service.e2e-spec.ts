// What one shift could not finish and the next one inherits — `FR-OPS-01`.
//
// The claim this file exists for is the one the table was shaped around: an item
// raised on one drawer is still there for the drawer that comes after it, and
// goes on being there until somebody clears it. That is a statement about two
// shifts and a partial index, so it is made against a real Postgres rather than
// against a stub that would only report what the test author arranged.
//
// The resolution is the other half. `pending_item_resolved_exactly_when_a_shift_cleared_it`
// makes the instant and the shift one fact in two columns, and the service sets
// them in a single conditional statement so that a second attempt updates
// nothing rather than overwriting which shift actually dealt with it — the half
// of the row the audit trail reads.
//
// It applies the migrations rather than pushing the schema, and boots no Nest
// application: the service takes its executor as an argument, so the subject is
// reachable with a `new`.

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ORPCError } from "@orpc/nest";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { systemConfig } from "../../src/database/schema/config.js";
import { staffUser } from "../../src/database/schema/identity.js";
import * as schema from "../../src/database/schema/index.js";
import { pendingItem } from "../../src/database/schema/shift.js";
import { BusinessDateService } from "../../src/modules/booking/business-date.service.js";
import { ShiftService } from "../../src/modules/operations/shift.service.js";
import { SystemConfigService } from "../../src/modules/system-config/system-config.service.js";

/** The property's row, present because opening a drawer reads its rollover. */
const CONFIGURED = {
  standardVatRateBps: 1_000,
  reducedVatRateBps: 500,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 500,
  businessDateRolloverHour: 0,
} satisfies typeof systemConfig.$inferInsert;

const OPENING_FLOAT = 1_500_000n;

const A_DEPOSIT_UNRECEIPTED = "Đặt cọc phòng 305 chưa xuất biên nhận.";
const A_KEY_NOT_BACK = "Chìa khoá dự phòng đang ở chỗ quản lý.";

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let shifts: ShiftService;

/** The shift that finds things, and the one that takes the desk over. */
let morningId: string;
let nightId: string;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheBacklog();
  await db.execute(
    sql`truncate staff_session, staff_user restart identity cascade`,
  );
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  morningId = await aReceptionist("ca.sang@mariva.test", "Trần Thị Mai");
  nightId = await aReceptionist("ca.dem@mariva.test", "Lê Văn Bình");

  shifts = new ShiftService(new BusinessDateService(new SystemConfigService()));
});

beforeEach(async () => {
  // The drawers go with the items: `shift_one_open_per_operator` holds each
  // operator to one open drawer, so a case cannot open theirs while the case
  // before still has one standing.
  await clearTheBacklog();
});

afterAll(async () => {
  await clearTheBacklog();
  await pool?.end();
});

describe("raising an item", () => {
  it("files it against the drawer the caller is on", async () => {
    // The raising shift never travels in the request: naming another would file
    // the finding against a drawer that never saw it.
    const drawer = await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    expect(raised).toMatchObject({
      raisedByShiftId: drawer.id,
      description: A_DEPOSIT_UNRECEIPTED,
      resolvedAt: null,
      resolvedByShiftId: null,
    });
  });

  it("refuses a caller who is on no drawer at all", async () => {
    // The coupling `screens.md` describes for cash, applied to the rest of the
    // desk's work: an item raised by nobody's drawer has no handover to appear
    // in.
    const refusal = await refused(
      shifts.raisePendingItem(db, {
        operatorId: morningId,
        description: A_DEPOSIT_UNRECEIPTED,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");
    expect(await everyItem()).toHaveLength(0);
  });

  it("refuses a caller whose drawer has been counted out", async () => {
    const drawer = await anOpenDrawer(morningId);

    await shifts.close(db, {
      shiftId: drawer.id,
      closingCount: OPENING_FLOAT,
      closedBy: morningId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    const refusal = await refused(
      shifts.raisePendingItem(db, {
        operatorId: morningId,
        description: A_DEPOSIT_UNRECEIPTED,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");
  });

  it("makes two items of the same thing noticed twice", async () => {
    // An item is a finding rather than a state, so two presses honestly make
    // two, and the desk resolves them twice.
    await anOpenDrawer(morningId);

    await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });
    await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    expect(await everyItem()).toHaveLength(2);
  });
});

describe("the backlog a shift inherits", () => {
  it("still holds what the shift before raised, once that shift has gone home", async () => {
    // The whole point of the table. An item outlives the drawer that found it:
    // raised by one, inherited by the next, and listed by a query that names no
    // shift at all.
    const morning = await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    await shifts.close(db, {
      shiftId: morning.id,
      closingCount: OPENING_FLOAT,
      handoverNote: "Còn một việc chưa xong.",
      closedBy: morningId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    await anOpenDrawer(nightId);

    const outstanding = await theBacklog();

    expect(outstanding.items.map((one) => one.id)).toEqual([raised.id]);
    expect(outstanding.total).toBe(1);
    // It is still the morning's finding. Who inherits it is not recorded,
    // because every later shift inherits it.
    expect(outstanding.items[0]?.raisedByShiftId).toBe(morning.id);
  });

  it("drops an item out of the backlog once a shift has cleared it", async () => {
    await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_KEY_NOT_BACK,
    });

    await shifts.resolvePendingItem(db, {
      operatorId: morningId,
      pendingItemId: raised.id,
    });

    expect((await theBacklog()).items).toHaveLength(0);

    const everything = await shifts.listPendingItems(db, {
      state: "ANY",
      limit: 50,
      offset: 0,
    });

    expect(everything.items.map((one) => one.id)).toEqual([raised.id]);
    expect(everything.total).toBe(1);
  });

  it("narrows to one shift's findings when asked about provenance", async () => {
    // "What did this shift raise" — the closing screen's own list. It is not
    // ownership: the items it does not name are still everybody's problem.
    const morning = await anOpenDrawer(morningId);

    const theirs = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    await shifts.close(db, {
      shiftId: morning.id,
      closingCount: OPENING_FLOAT,
      closedBy: morningId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    await anOpenDrawer(nightId);
    await shifts.raisePendingItem(db, {
      operatorId: nightId,
      description: A_KEY_NOT_BACK,
    });

    const morningsOwn = await shifts.listPendingItems(db, {
      state: "ANY",
      raisedByShiftId: morning.id,
      limit: 50,
      offset: 0,
    });

    expect(morningsOwn.items.map((one) => one.id)).toEqual([theirs.id]);
    expect(morningsOwn.total).toBe(1);
    expect((await theBacklog()).total).toBe(2);
  });

  it("answers oldest first, and pages by rows rather than by page number", async () => {
    // The order the unresolved index is built in, and the order a backlog is
    // worked in.
    await anOpenDrawer(morningId);

    const first = await raisedAt("Việc thứ nhất.", "2027-12-01T08:00:00Z");
    const second = await raisedAt("Việc thứ hai.", "2027-12-01T12:00:00Z");
    const third = await raisedAt("Việc thứ ba.", "2027-12-01T20:00:00Z");

    const whole = await theBacklog();

    expect(whole.items.map((one) => one.id)).toEqual([first, second, third]);

    const tail = await shifts.listPendingItems(db, {
      state: "OUTSTANDING",
      limit: 2,
      offset: 2,
    });

    expect(tail.items.map((one) => one.id)).toEqual([third]);
    // Counted under the predicate the page was cut from, so a handover badge
    // reads "three outstanding" from a page that drew one.
    expect(tail.total).toBe(3);
  });
});

describe("clearing an item", () => {
  it("credits the drawer that dealt with it and stamps both halves together", async () => {
    // `pending_item_resolved_exactly_when_a_shift_cleared_it` refuses a row
    // where the instant and the shift disagree, and the two are written in one
    // statement so no reader can see one without the other.
    const morning = await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    await shifts.close(db, {
      shiftId: morning.id,
      closingCount: OPENING_FLOAT,
      closedBy: morningId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    const night = await anOpenDrawer(nightId);

    const cleared = await shifts.resolvePendingItem(db, {
      operatorId: nightId,
      pendingItemId: raised.id,
    });

    expect(cleared.resolvedByShiftId).toBe(night.id);
    expect(cleared.resolvedAt).toBeInstanceOf(Date);
    // Provenance is untouched: the morning found it and the night dealt with
    // it, which is why there are two keys and not one.
    expect(cleared.raisedByShiftId).toBe(morning.id);
  });

  it("lets the shift that raised it clear it, which is the ordinary case", async () => {
    const drawer = await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_KEY_NOT_BACK,
    });

    const cleared = await shifts.resolvePendingItem(db, {
      operatorId: morningId,
      pendingItemId: raised.id,
    });

    expect(cleared.resolvedByShiftId).toBe(drawer.id);
    expect(cleared.raisedByShiftId).toBe(drawer.id);
  });

  it("refuses a second clearing rather than rewriting who did it", async () => {
    const morning = await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_DEPOSIT_UNRECEIPTED,
    });

    await shifts.resolvePendingItem(db, {
      operatorId: morningId,
      pendingItemId: raised.id,
    });

    await shifts.close(db, {
      shiftId: morning.id,
      closingCount: OPENING_FLOAT,
      closedBy: morningId,
      mayCloseAnotherOperatorsDrawer: false,
    });

    await anOpenDrawer(nightId);

    const refusal = await refused(
      shifts.resolvePendingItem(db, {
        operatorId: nightId,
        pendingItemId: raised.id,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");

    const [stored] = await db
      .select()
      .from(pendingItem)
      .where(eq(pendingItem.id, raised.id));

    // The shift credited with the work is the one that did it, still.
    expect(stored?.resolvedByShiftId).toBe(morning.id);
  });

  it("refuses an item nothing answers to", async () => {
    await anOpenDrawer(morningId);

    const refusal = await refused(
      shifts.resolvePendingItem(db, {
        operatorId: morningId,
        pendingItemId: ABSENT_ID,
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("refuses a caller who is on no drawer, so nothing is credited to nobody", async () => {
    await anOpenDrawer(morningId);

    const raised = await shifts.raisePendingItem(db, {
      operatorId: morningId,
      description: A_KEY_NOT_BACK,
    });

    const refusal = await refused(
      shifts.resolvePendingItem(db, {
        operatorId: nightId,
        pendingItemId: raised.id,
      }),
    );

    expect(refusal.code).toBe("CONFLICT");

    const [stored] = await db
      .select()
      .from(pendingItem)
      .where(eq(pendingItem.id, raised.id));

    expect(stored?.resolvedAt).toBeNull();
    expect(stored?.resolvedByShiftId).toBeNull();
  });
});

async function anOpenDrawer(operatorId: string) {
  return shifts.open(db, { operatorId, openingFloat: OPENING_FLOAT });
}

/** Whatever is still outstanding, a whole page of it. */
async function theBacklog() {
  return shifts.listPendingItems(db, {
    state: "OUTSTANDING",
    limit: 50,
    offset: 0,
  });
}

/**
 * An item raised through the service, then dated.
 *
 * The service takes the clock's instant, which is right and leaves three items
 * raised in one millisecond in an order only the id tie-break decides. A case
 * about the order of a backlog needs the items to have been found at different
 * times, so the moment is written afterwards.
 */
async function raisedAt(
  description: string,
  createdAt: string,
): Promise<string> {
  const raised = await shifts.raisePendingItem(db, {
    operatorId: morningId,
    description,
  });

  await db
    .update(pendingItem)
    .set({ createdAt: new Date(createdAt) })
    .where(eq(pendingItem.id, raised.id));

  return raised.id;
}

async function everyItem() {
  return db.select().from(pendingItem);
}

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

  return created!.id;
}

/**
 * The items and the drawers that raised them.
 *
 * The payer's side goes with the drawers because a shift cannot be removed
 * while cash names it, and nothing in this file takes any — a payment standing
 * here is one another file left behind.
 */
async function clearTheBacklog(): Promise<void> {
  await db.execute(
    sql`truncate pending_item, payment, shift restart identity cascade`,
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
