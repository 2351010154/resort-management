// The desk's working day over HTTP — `FR-OPS-01`'s seven routes and the cash
// route that depends on them, against a real Postgres, the real capability
// guard and real sessions.
//
// `shift-service.e2e-spec.ts` proves what the drawer's arithmetic comes to and
// `pending-item-service.e2e-spec.ts` proves what an item outlives; neither can
// assert anything that only exists once there are routes, and that is what this
// file is for:
//
// 1. **Every route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` rather than off a list written here — `rbac-matrix.md` §4's
//    own instruction, and the reason the two reads are asked with
//    `permits(grant, "read")` while the five writes are asked as writes.
// 2. **"RCP: own shift" is enforced in three different shapes**, because the
//    note means something different on each act. A drawer is opened in the
//    caller's name whatever the body says; a receptionist may not count out a
//    colleague's and a manager may; and the history a receptionist reads is
//    their own however they filter it. The one read that is deliberately *not*
//    narrowed is the backlog, and that is asserted too — an item raised by one
//    shift has to be visible to the next, or the handover is the handover with
//    the handover taken out.
// 3. **The desk can take cash.** A `CASH` payment binds to the operator's own
//    open drawer, shows up in what that drawer is expected to hold, and is
//    refused with a code the console has an action behind when the operator is
//    on no drawer. A transfer from the same person on the same drawer names no
//    shift, which is the other half of the biconditional `schema/payment.ts`
//    holds. Cash arriving while that drawer is being counted out is refused
//    with the same code — the trigger in `migrations/0040` reporting itself
//    through the route, which is the one path into the refusal a sequential
//    test cannot reach and the reason a close is held open on a second
//    connection at the foot of this file.
// 4. **The variance is the property's arithmetic and never the caller's.** The
//    close sends a count and gets back the difference between it and what the
//    day put in the drawer.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `operations.module.ts` ever stops carrying the controller
// or `folio.module.ts` stops reaching the service — which is the point of
// booting the real graph rather than a hand-built one.
//
// The stays are inserted directly rather than booked through the funnel. What
// is under test is the drawer, and a stay here is only somewhere for a payment
// to land: seeding a year of rates and inventory to reach that would put the
// availability rules in the way of every assertion below.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { type Database, DRIZZLE } from "../../src/database/database.module.js";
import { booking } from "../../src/database/schema/booking.js";
import { systemConfig } from "../../src/database/schema/config.js";
import { folio } from "../../src/database/schema/folio.js";
import { staffUser } from "../../src/database/schema/identity.js";
import { roomType } from "../../src/database/schema/inventory.js";
import { payment as paymentTable } from "../../src/database/schema/payment.js";
import { pendingItem, shift } from "../../src/database/schema/shift.js";
import { BusinessDateService } from "../../src/modules/booking/business-date.service.js";
import {
  capability,
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../../src/modules/identity/rbac/matrix.js";
import {
  type CapabilityAction,
  permits,
} from "../../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../../src/modules/identity/staff-user.service.js";
import { SystemConfigService } from "../../src/modules/system-config/system-config.service.js";

/** The property's day, stopped — so the trading day a drawer opens on is a
 *  constant rather than whatever the calendar says while the suite runs. */
const TODAY = parseDate("2027-09-15");
const BUSINESS_DATE = "2027-09-15";

/** A configuration nobody could mistake for a property's real one. The rollover
 *  is the only field anything here reads. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

const OPENING_FLOAT = 2_000_000n;

/** What the guest hands over in notes, and what they send from a bank. Only the
 *  first reaches the drawer. */
const CASH_TAKEN = 300_000n;
const TRANSFERRED = 450_000n;

/** A drawer fifty thousand short of what the day put in it — a variance with a
 *  sign, rather than the nought a square drawer cannot tell apart from a
 *  figure nobody computed. */
const SHORT_BY = 50_000n;

/**
 * Long enough for a statement to have reached the lock it is going to wait on,
 * and well inside the pool's own statement timeout. Only the ordering is
 * asserted, never the delay itself.
 */
const SETTLE_MS = 250;

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

const A_DEPOSIT_UNRECEIPTED = "Đặt cọc phòng 305 chưa xuất biên nhận.";

/** The property's day, stopped — the device every suite here uses. */
class StoppedClock extends BusinessDateService {
  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return TODAY;
  }
}

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because both matrix rows are asserted against
 *  all five. */
const STAFF = {
  MANAGER: {
    email: "ca.quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "ca.sang@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "ca.buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ca.ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "ca.quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

/**
 * The receptionist who takes the desk over.
 *
 * A second account under a role the map above already holds, because half of
 * what this file asserts is about two people: whose drawer a payment lands in,
 * whose day a history shows, and which shift is credited with clearing an item
 * the other one raised. One receptionist can demonstrate none of it.
 */
const NIGHT: StaffAccount = {
  email: "ca.dem@mariva.test",
  fullName: "Trần Thị Mai",
  role: "RECEPTIONIST",
  password: "night-password-42",
};

/** The accounts and the stays this file owns, so what it removes afterwards is
 *  exactly what it made — neither table is the suite's to truncate. */
const EMAILS = [
  ...Object.values(STAFF).map((account) => account.email),
  NIGHT.email,
] as const;

const STAY_REFERENCES = [
  "MRV-DESK-0001",
  "MRV-DESK-0002",
  "MRV-DESK-0003",
] as const;

interface Shift {
  readonly id: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly openingFloat: string;
  readonly openedAt: string;
  readonly openingBusinessDate: string;
  readonly cashTaken: string;
  readonly closingCount: string | null;
  readonly variance: string | null;
  readonly closedAt: string | null;
  readonly handoverNote: string | null;
}

interface PendingItem {
  readonly id: string;
  readonly raisedByShiftId: string;
  readonly description: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedByShiftId: string | null;
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;

const tokens = new Map<string, string>();

let dayStayId: string;
let nightStayId: string;

/** A stay of its own for the concurrent case, so the drawer closing underneath
 *  a payment cannot disturb an account the cases above have already asserted. */
let contestedStayId: string;

/** The two receptionists' staff ids, which is what a shift's `operatorId` is. */
let dayOperatorId: string;
let nightOperatorId: string;

/** The drawers the cases below open, kept so the assertions can name them. */
let dayDrawerId: string;
let nightDrawerId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheDesk();

  // After the boot provider, which writes this row. The rollover is read per
  // opened drawer through the caller's executor, so the update is in force for
  // everything below it.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of [...Object.values(STAFF), NIGHT]) {
    await staff.create({ ...account });
    tokens.set(account.email, await signIn(account.email, account.password));
  }

  dayOperatorId = await staffIdOf(STAFF.RECEPTIONIST.email);
  nightOperatorId = await staffIdOf(NIGHT.email);

  dayStayId = await aStay(STAY_REFERENCES[0]);
  nightStayId = await aStay(STAY_REFERENCES[1]);
  contestedStayId = await aStay(STAY_REFERENCES[2]);
}, 120_000);

afterAll(async () => {
  await clearTheDesk();
  await app?.close();
});

/**
 * Everything this file wrote, in key order.
 *
 * The ledger goes by `truncate`, because a posting cannot be deleted; that
 * cascades to the payer's side, which is what frees the drawers to be deleted
 * underneath it. The staff accounts go last, since every shift names one.
 */
async function clearTheDesk(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
  await db.delete(pendingItem);
  await db.delete(shift);
  await db
    .delete(booking)
    .where(inArray(booking.reference, [...STAY_REFERENCES]));
  await db
    .delete(staffUser)
    .where(inArray(staffUser.email, [...EMAILS]));
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A call as one member of staff, addressed by the account rather than by the
 *  role — two of the accounts here are receptionists. A `GET` carries its
 *  arguments in the query string and everything else in the body. */
function asAccount(
  email: string,
  method: "get" | "post",
  path: string,
  body: object = {},
): request.Test {
  const call = http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(email)!}`);

  return method === "get" ? call.query(body) : call.send(body);
}

const as = (
  role: StaffRole,
  method: "get" | "post",
  path: string,
  body: object = {},
) => asAccount(STAFF[role].email, method, path, body);

const asNight = (method: "get" | "post", path: string, body: object = {}) =>
  asAccount(NIGHT.email, method, path, body);

async function staffIdOf(email: string): Promise<string> {
  const [row] = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(eq(staffUser.email, email));

  return row!.id;
}

/** A stay to hang an account on. Inserted rather than booked — the header says
 *  why the funnel is not in the way of a drawer. */
async function aStay(reference: string): Promise<string> {
  const [stay] = await db
    .insert(booking)
    .values({
      reference,
      state: "CONFIRMED",
      roomTypeId: await someRoomType(),
      checkInDate: "2027-09-15",
      checkOutDate: "2027-09-17",
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 3_600_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** Whatever room type the database already holds, and one of its own only if it
 *  holds none. The codes and display orders are unique, so a file that is not
 *  the owner of the property cannot simply add another. */
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

const paymentsPath = (bookingId: string) =>
  `/bookings/${bookingId}/folio/payments`;

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What the property recorded as taken against one stay, as the payer's side of
 * the ledger holds it.
 *
 * Read off the table rather than off the route, because `shift_id` is the whole
 * point of these cases and no folio shape carries it — which drawer took the
 * money is a fact about the desk's day and not about the guest's account.
 *
 * An empty list for a stay with no account, which is the honest answer to "what
 * has been paid" on a booking nothing was ever posted to.
 */
async function paymentsOn(bookingId: string) {
  const [account] = await db
    .select({ id: folio.id })
    .from(folio)
    .where(eq(folio.bookingId, bookingId));

  if (!account) {
    return [];
  }

  return db
    .select({
      method: paymentTable.method,
      amount: paymentTable.amount,
      shiftId: paymentTable.shiftId,
      postedBy: paymentTable.postedBy,
    })
    .from(paymentTable)
    .where(eq(paymentTable.folioId, account.id));
}

/**
 * Every shift route, with the matrix row it declares and what it does with it.
 *
 * `action` is part of the data rather than assumed: both rows hand `ACCOUNTANT`
 * a 👁, so the two reads and the five writes have to be asked different
 * questions or the table would assert the wrong expectation for half of them.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post";
  readonly path: string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "openShift",
    method: "post",
    path: "/shifts",
    capability: "operations.cash-drawer",
    action: "write",
  },
  {
    name: "closeShift",
    method: "post",
    path: `/shifts/${ABSENT_ID}/closure`,
    capability: "operations.cash-drawer",
    action: "write",
  },
  {
    name: "currentShift",
    method: "get",
    path: "/shifts/current",
    capability: "operations.cash-drawer",
    action: "read",
  },
  {
    name: "listShiftHistory",
    method: "get",
    path: "/shifts",
    capability: "operations.cash-drawer",
    action: "read",
  },
  {
    name: "raisePendingItem",
    method: "post",
    path: "/pending-items",
    capability: "operations.shift-handover",
    action: "write",
  },
  {
    name: "resolvePendingItem",
    method: "post",
    path: `/pending-items/${ABSENT_ID}/resolution`,
    capability: "operations.shift-handover",
    action: "write",
  },
  {
    name: "listPendingItems",
    method: "get",
    path: "/pending-items",
    capability: "operations.shift-handover",
    action: "read",
  },
];

describe("the capability each shift route declares", () => {
  // §4's obligation for the two rows these routes add. No body is sent to the
  // writes — the guard runs before the handler, so an admitted caller answers
  // 400 or 409 and a refused one answers 403 either way, and no drawer is
  // opened while the matrix is being asserted. The two routes that do reach a
  // handler with a valid input name a uuid no row has, so the furthest an
  // admitted caller gets is a refusal about a shift they are not on.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.method, route.path);

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http()[route.method](route.path).send().expect(401);
    }
  });

  it("names only rows the matrix already has", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that each
    // row is the one the route is meant to be under, and that none of them is a
    // key some future edit renamed out from under a route that still answers.
    for (const route of ROUTES) {
      expect(capability(route.capability).section).toBe("Folio and money");
    }
  });
});

describe("opening a drawer", () => {
  it("answers with no drawer for somebody who is not on one", async () => {
    // Null is the ordinary state of a receptionist who has not opened a drawer
    // yet and not a refusal — the console renders "no shift" from it and the
    // palette offers to open one.
    const response = await as("RECEPTIONIST", "get", "/shifts/current").expect(
      200,
    );

    expect(response.body).toBeNull();
  });

  it("opens it in the caller's own name, whatever the body says", async () => {
    // The operator comes off the session and the contract carries no field for
    // one, so a body naming a colleague changes nothing. Without that, every
    // đồng taken on this drawer would be attributed to the wrong person for the
    // rest of the day.
    const response = await as("RECEPTIONIST", "post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
      operatorId: nightOperatorId,
    }).expect(200);

    const opened = response.body as Shift;
    dayDrawerId = opened.id;

    expect(opened.operatorId).toBe(dayOperatorId);
    expect(opened.operatorName).toBe(STAFF.RECEPTIONIST.fullName);
    expect(BigInt(opened.openingFloat)).toBe(OPENING_FLOAT);
    // The property's rollover applied to the clock, resolved on the server.
    expect(opened.openingBusinessDate).toBe(BUSINESS_DATE);
    // Nothing has been paid in yet, and the figure is answered by the same
    // query that will answer it at the handover rather than by a zero written
    // when the drawer was opened.
    expect(BigInt(opened.cashTaken)).toBe(0n);
    expect(opened.closingCount).toBeNull();
    expect(opened.variance).toBeNull();
    expect(opened.closedAt).toBeNull();
  });

  it("refuses a second drawer for the same operator", async () => {
    // `shift_one_open_per_operator` reporting itself. Two drawers open under
    // one name is cash landing in whichever the handler saw first.
    const refusal = await as("RECEPTIONIST", "post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
    }).expect(409);

    expect(refusal.body.message).toContain("already have a shift open");
  });

  it("answers with the drawer once there is one", async () => {
    const response = await as("RECEPTIONIST", "get", "/shifts/current").expect(
      200,
    );

    expect((response.body as Shift).id).toBe(dayDrawerId);
  });
});

describe("the cash the desk takes", () => {
  it("binds a cash payment to the operator's own open drawer", async () => {
    await as("RECEPTIONIST", "post", paymentsPath(dayStayId), {
      amount: CASH_TAKEN.toString(),
      description: "Tiền mặt tại quầy",
      method: "CASH",
    }).expect(200);

    const [taken] = await paymentsOn(dayStayId);

    expect(taken?.method).toBe("CASH");
    expect(taken?.shiftId).toBe(dayDrawerId);
    // The same account the shift was read for, which is what keeps the trigger
    // in `migrations/0040` out of the ordinary path.
    expect(taken?.postedBy).toBe(dayOperatorId);
  });

  it("counts it into what the drawer is expected to hold", async () => {
    const response = await as("RECEPTIONIST", "get", "/shifts/current").expect(
      200,
    );

    expect(BigInt((response.body as Shift).cashTaken)).toBe(CASH_TAKEN);
  });

  it("leaves a transfer naming no drawer at all", async () => {
    // The other half of `payment_shift_binding`. The same receptionist is on
    // the same open drawer, and money that never reached it may not be counted
    // into it — counted in, it would leave the handover short by the whole of
    // the transfer.
    await as("RECEPTIONIST", "post", paymentsPath(dayStayId), {
      amount: TRANSFERRED.toString(),
      description: "Chuyển khoản",
      method: "BANK_TRANSFER",
    }).expect(200);

    const transfer = (await paymentsOn(dayStayId)).find(
      (row) => row.method === "BANK_TRANSFER",
    );

    expect(transfer?.shiftId).toBeNull();

    const drawer = await as("RECEPTIONIST", "get", "/shifts/current").expect(
      200,
    );

    expect(BigInt((drawer.body as Shift).cashTaken)).toBe(CASH_TAKEN);
  });

  it("refuses cash from an operator on no drawer, with a code the console acts on", async () => {
    // The server cannot invent an opening float — the figure every variance is
    // held against is one somebody counted — so the desk is told to open a
    // drawer rather than being given one. A conflict and not a bad request: the
    // body is a perfectly good payment, and what refuses it is the state of the
    // desk.
    const refusal = await asNight("post", paymentsPath(nightStayId), {
      amount: CASH_TAKEN.toString(),
      description: "Tiền mặt, chưa mở ca",
      method: "CASH",
    }).expect(409);

    expect(refusal.body.data.code).toBe("NO_OPEN_SHIFT");

    // Nothing moved. The refusal comes before the account is opened, so the
    // stay does not even gain an empty folio on the way to being told.
    expect(await paymentsOn(nightStayId)).toHaveLength(0);
  });
});

describe("the handover", () => {
  let itemId: string;

  it("records an item against the drawer the caller is on", async () => {
    const response = await as("RECEPTIONIST", "post", "/pending-items", {
      description: A_DEPOSIT_UNRECEIPTED,
    }).expect(200);

    const raised = response.body as PendingItem;
    itemId = raised.id;

    expect(raised.raisedByShiftId).toBe(dayDrawerId);
    expect(raised.description).toBe(A_DEPOSIT_UNRECEIPTED);
    expect(raised.resolvedAt).toBeNull();
    expect(raised.resolvedByShiftId).toBeNull();
  });

  it("refuses an item from somebody on no drawer", async () => {
    const refusal = await asNight("post", "/pending-items", {
      description: "Chưa mở ca mà đã ghi việc.",
    }).expect(409);

    expect(refusal.body.message).toContain("not on a shift");
  });

  it("shows the backlog to a shift that did not raise it", async () => {
    // The claim the whole table is shaped around, and the one read in the
    // contract that no grant narrows: an item outlives the drawer that found
    // it, so the shift taking the desk over has to see work it did not do.
    const response = await asNight("get", "/pending-items").expect(200);

    expect(response.body.total).toBeGreaterThanOrEqual(1);
    expect(
      response.body.items.some((item: PendingItem) => item.id === itemId),
    ).toBe(true);
  });

  it("credits the shift that actually cleared it", async () => {
    const opened = await asNight("post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
    }).expect(200);

    nightDrawerId = (opened.body as Shift).id;

    const response = await asNight(
      "post",
      `/pending-items/${itemId}/resolution`,
    ).expect(200);

    const resolved = response.body as PendingItem;

    // Raised by one drawer and cleared by another, which is the ordinary case
    // rather than a fault: the two columns say who found it and who dealt with
    // it, and neither is the other.
    expect(resolved.raisedByShiftId).toBe(dayDrawerId);
    expect(resolved.resolvedByShiftId).toBe(nightDrawerId);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it("refuses to clear it a second time", async () => {
    // A second resolution would overwrite which shift dealt with it, and that
    // column is the half of the row the audit trail reads.
    const refusal = await as(
      "RECEPTIONIST",
      "post",
      `/pending-items/${itemId}/resolution`,
    ).expect(409);

    expect(refusal.body.message).toContain("already cleared");
  });

  it("drops the cleared item out of the outstanding list", async () => {
    const response = await as("RECEPTIONIST", "get", "/pending-items").expect(
      200,
    );

    expect(
      response.body.items.some((item: PendingItem) => item.id === itemId),
    ).toBe(false);
  });
});

describe("counting the drawer out", () => {
  it("refuses a receptionist counting out a colleague's", async () => {
    // The matrix's `⚠` on the cash drawer row, resolved by the handler: a
    // receptionist closes their own, and the grant that closes somebody else's
    // is one they do not hold.
    const refusal = await asNight(
      "post",
      `/shifts/${dayDrawerId}/closure`,
      { closingCount: OPENING_FLOAT.toString() },
    ).expect(403);

    expect(refusal.body.message).toContain("belongs to somebody else");
  });

  it("works the variance out from what the day actually put in the drawer", async () => {
    // Counted less expected, expected being the opening float plus the cash
    // bound to the shift. The transfer is not in it, which is the whole reason
    // only one of the two payments named this drawer.
    const counted = OPENING_FLOAT + CASH_TAKEN - SHORT_BY;

    const response = await as(
      "RECEPTIONIST",
      "post",
      `/shifts/${dayDrawerId}/closure`,
      {
        closingCount: counted.toString(),
        handoverNote: "Két thiếu 50.000₫, đã báo quản lý.",
      },
    ).expect(200);

    const closed = response.body as Shift;

    expect(BigInt(closed.closingCount!)).toBe(counted);
    expect(BigInt(closed.variance!)).toBe(-SHORT_BY);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.handoverNote).toBe("Két thiếu 50.000₫, đã báo quản lý.");
  });

  it("refuses a second count on the same drawer", async () => {
    // The count already stored was signed for by whoever took it, and the
    // variance the property reports stands on that figure.
    const refusal = await as(
      "RECEPTIONIST",
      "post",
      `/shifts/${dayDrawerId}/closure`,
      { closingCount: OPENING_FLOAT.toString() },
    ).expect(409);

    expect(refusal.body.message).toContain("already counted out");
  });

  it("lets a manager close the drawer somebody went home without closing", async () => {
    // The case `full` on this row exists for. An address meaning "my own open
    // shift" would leave that drawer open forever.
    const response = await as(
      "MANAGER",
      "post",
      `/shifts/${nightDrawerId}/closure`,
      { closingCount: OPENING_FLOAT.toString() },
    ).expect(200);

    const closed = response.body as Shift;

    expect(closed.operatorId).toBe(nightOperatorId);
    expect(BigInt(closed.variance!)).toBe(0n);
  });
});

describe("reading the history back", () => {
  it("narrows a receptionist to their own shifts, whatever operator they name", async () => {
    // Overwritten rather than refused. The operator picker is a manager's
    // control, and a receptionist who reaches it is asking to read a history
    // they are entitled to exactly one of — answering with their own day is
    // what the matrix's note means.
    const response = await as("RECEPTIONIST", "get", "/shifts", {
      operatorId: nightOperatorId,
    }).expect(200);

    expect(response.body.shifts.length).toBeGreaterThanOrEqual(1);
    expect(
      response.body.shifts.every(
        (found: Shift) => found.operatorId === dayOperatorId,
      ),
    ).toBe(true);
  });

  it("lets a manager read every operator", async () => {
    const response = await as("MANAGER", "get", "/shifts").expect(200);

    const operators = response.body.shifts.map(
      (found: Shift) => found.operatorId,
    );

    expect(operators).toContain(dayOperatorId);
    expect(operators).toContain(nightOperatorId);
  });

  it("lets the accountant read every operator too", async () => {
    // The 👁 the matrix hands the accountant is on the row, not on one person's
    // day: reconciling the property's takings across the desk is exactly what a
    // read-only grant over the drawer is for.
    const response = await as("ACCOUNTANT", "get", "/shifts").expect(200);

    const operators = response.body.shifts.map(
      (found: Shift) => found.operatorId,
    );

    expect(operators).toContain(dayOperatorId);
    expect(operators).toContain(nightOperatorId);
  });

  it("lets a manager filter to one operator", async () => {
    const response = await as("MANAGER", "get", "/shifts", {
      operatorId: nightOperatorId,
    }).expect(200);

    expect(response.body.total).toBe(1);
    expect(response.body.shifts[0].operatorId).toBe(nightOperatorId);
  });
});

describe("a close and a cash payment arriving together", () => {
  it("refuses the cash rather than counting it into a drawer already counted", async () => {
    // The one way into the route's `MV006` branch, and it needs two connections:
    // the drawer has to still be open when the handler reads it and closed by
    // the time the payment is written. `payment-shift-trigger.e2e-spec.ts` makes
    // the same arrangement against the table; this asserts what the desk is
    // told when the trigger fires under a real request — a sentence and the
    // code the palette acts on, rather than the SQLSTATE surfacing as a 500 to
    // a receptionist still holding the đồng.
    const opened = await as("RECEPTIONIST", "post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
    }).expect(200);

    const contestedDrawerId = (opened.body as Shift).id;

    let releaseClose: () => void = () => undefined;
    const closeHeld = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    // The count written straight to the row and held uncommitted, because a
    // close through the route would commit before the payment could meet it.
    const closing = db.transaction(async (tx) => {
      await tx
        .update(shift)
        .set({ closingCount: OPENING_FLOAT, closedAt: new Date() })
        .where(eq(shift.id, contestedDrawerId));

      await closeHeld;
    });

    await pause(SETTLE_MS);

    // Sent while the close still holds the row: the handler reads a drawer that
    // is open in its own snapshot, and the insert then blocks on the `FOR SHARE`
    // the trigger takes.
    const attempt = as("RECEPTIONIST", "post", paymentsPath(contestedStayId), {
      amount: CASH_TAKEN.toString(),
      description: "Tiền mặt trong lúc chốt ca",
      method: "CASH",
    }).then((response) => response);

    await pause(SETTLE_MS);

    releaseClose();
    await closing;

    const refusal = await attempt;

    expect(refusal.status).toBe(409);
    expect(refusal.body.data.code).toBe("NO_OPEN_SHIFT");
    expect(refusal.body.message).toContain("counted out while");

    // The handler's transaction rolled back with the refusal, so the stay did
    // not even gain the account the payment was on its way into.
    expect(await paymentsOn(contestedStayId)).toHaveLength(0);
  });
});
