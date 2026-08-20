// The property's own cash book over HTTP — `FR-OPS-02`'s three routes, against
// a real Postgres, the real capability guard and real sessions.
//
// What this file is for, in the order it asserts it:
//
//  1. **Every route is governed by the matrix row it declares**, driven off
//     `CAPABILITIES` rather than off a list written here — `rbac-matrix.md` §4's
//     own instruction. *Income / expense (thu chi)* is `full` for `ACCOUNTANT`,
//     `MANAGER` and `ADMIN` and names nobody else, so the two roles that work
//     the desk are refused on all three routes. That is a deliberate product
//     decision rather than an oversight: the person holding the till does not
//     book what left it.
//  2. **A cash entry moves the drawer's expected figure and a bank transfer
//     does not.** This is the whole reason a cash entry names a shift. A manager
//     records money out of a receptionist's till; the receptionist, who may not
//     see this book at all, watches their own drawer's figure move — and the
//     count they sign is square against it. A salary paid by transfer moves
//     nothing.
//  3. **A drawer that has been counted out takes no further cash.** The trigger
//     in `migrations/0042` reporting itself through the route, in the sentence
//     `shift.service.ts` already throws at a second close: a counted drawer's
//     variance stands on the count that closed it.
//  4. **The book cannot be edited or deleted, only corrected.** The append-only
//     trigger refuses both for every client, and a correction is a row of its
//     own that names the row it undoes and binds to whichever drawer is open
//     *now* — which is what leaves the closed shift's arithmetic reproducible.
//  5. **The change log has the entry**, filed against the member of staff the
//     guard resolved. `every-change-is-recorded.e2e-spec.ts` asserts that this
//     table carries the trigger at all; what is asserted here is that a row
//     written through the route arrives in the log with the right actor on it.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `operations.module.ts` ever stops carrying the controller —
// which is the point of booting the real graph rather than a hand-built one.
//
// No stay and no folio anywhere in this file, and that absence is the feature
// under test as much as anything asserted: `screens.md` puts this book strictly
// outside the money a folio captures. What a drawer's figure does when guests
// pay cash into it is `shift-api.e2e-spec.ts`'s subject, and the shifts here
// take no payments at all — so the variance below is the float against the count
// with exactly one other term in it, which is the term this file adds.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { type SQL, and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { type Database, DRIZZLE } from "../../src/database/database.module.js";
import { auditEntry } from "../../src/database/schema/audit.js";
import { cashBookEntry } from "../../src/database/schema/cash-book.js";
import { systemConfig } from "../../src/database/schema/config.js";
import { staffUser } from "../../src/database/schema/identity.js";
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

/** The property's day, stopped — so the trading day an entry is filed under is a
 *  constant rather than whatever the calendar says while the suite runs. */
const TODAY = parseDate("2027-11-04");
const BUSINESS_DATE = "2027-11-04";

/** A day the property has already traded, which an accountant may still file
 *  against, and one it has not, which nobody may. */
const A_DAY_ALREADY_TRADED = "2027-11-01";
const A_DAY_THAT_HAS_NOT_HAPPENED = "2027-11-05";

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

/** Đồng handed to a supplier out of the day shift's till. */
const SUPPLIES_IN_CASH = 300_000n;

/** Wages sent from the bank, which never touch a drawer. */
const SALARIES_BY_TRANSFER = 8_000_000n;

/** What the function room was let for, in notes, into the night shift's till. */
const VENUE_HIRE_IN_CASH = 1_500_000n;

/** Last month's electricity, sent from the bank and filed under the day it was
 *  paid rather than the day it was typed in. */
const AN_ELECTRICITY_BILL = 1_200_000n;

/** What the day drawer should hold once the supplier has been paid out of it:
 *  the float, no cash taken from guests, and the entry against it. */
const COUNTED_OUT_SQUARE = OPENING_FLOAT - SUPPLIES_IN_CASH;

/** Raised by `cash_book_entry_refuse_rewrite()` — `migrations/0042`. */
const APPEND_ONLY_VIOLATION = "MV007";

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

const TWO_CRATES_OF_WATER = "Hai thùng nước suối, cửa hàng Minh Phát.";
const WAGES_FOR_THE_MONTH = "Lương tháng 11, ca buồng phòng.";
const THE_FUNCTION_ROOM = "Cho thuê hội trường, tiệc cưới nhà anh Bình.";
const RECORDED_TWICE = "Ghi trùng — bản này là bản thừa.";

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

/** One account per staff role, because the matrix row is asserted against all
 *  five. */
const STAFF = {
  MANAGER: {
    email: "so.quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "so.ca.sang@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "so.buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "so.ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "so.quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

/**
 * The receptionist who takes the desk over.
 *
 * A second account under a role the map above already holds, because the
 * correction needs two drawers: the money comes back through the till that is
 * open *now*, and the whole point is that it is not the one the mistake went out
 * of. One receptionist cannot demonstrate it — `shift_one_open_per_operator`
 * refuses them a second drawer, correctly.
 */
const NIGHT: StaffAccount = {
  email: "so.ca.dem@mariva.test",
  fullName: "Trần Thị Mai",
  role: "RECEPTIONIST",
  password: "night-password-42",
};

/** The accounts this file owns, so what it removes afterwards is exactly what it
 *  made — `staff_user` is not the suite's to truncate. */
const EMAILS = [
  ...Object.values(STAFF).map((account) => account.email),
  NIGHT.email,
] as const;

/** An entry as the wire carries it. Every đồng figure is text, per `money.ts`:
 *  a JSON number would round a figure the currency has no minor unit to round
 *  into. */
interface Entry {
  readonly id: string;
  readonly direction: "INCOME" | "EXPENSE";
  readonly category: string;
  readonly method: "CASH" | "BANK_TRANSFER";
  readonly amount: string;
  readonly businessDate: string;
  readonly shiftId: string | null;
  readonly note: string;
  readonly recordedById: string;
  readonly recordedByName: string;
  readonly recordedAt: string;
  readonly reversesEntryId: string | null;
  readonly reversedByEntryId: string | null;
}

interface Page {
  readonly entries: readonly Entry[];
  readonly total: number;
  readonly incomeTotal: string;
  readonly expenseTotal: string;
}

interface Shift {
  readonly id: string;
  readonly operatorId: string;
  readonly openingFloat: string;
  readonly cashTaken: string;
  readonly cashBookNet: string;
  readonly closingCount: string | null;
  readonly variance: string | null;
  readonly closedAt: string | null;
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;

const tokens = new Map<string, string>();

let managerId: string;

/** The two drawers the cases below open, kept so the assertions can name them. */
let dayDrawerId: string;
let nightDrawerId: string;

/** The entry the correction cases undo, and the correction itself. */
let suppliesEntryId: string;
let correctionId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheBook();

  // After the boot provider, which writes this row. The rollover is read per
  // entry through the caller's executor, so the update is in force for
  // everything below it.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of [...Object.values(STAFF), NIGHT]) {
    await staff.create({ ...account });
    tokens.set(account.email, await signIn(account.email, account.password));
  }

  managerId = await staffIdOf(STAFF.MANAGER.email);
}, 120_000);

afterAll(async () => {
  await clearTheBook();
  await app?.close();
});

/**
 * Everything this file wrote, in key order.
 *
 * The book goes by `truncate` and not by `delete`, and that is the append-only
 * trigger being real rather than a convenience: a row-level `DELETE` raises
 * `MV007` for every client, this suite included. `TRUNCATE` fires no row
 * triggers, which is the same door `folio_posting` is emptied through. It goes
 * first, because every cash entry names a drawer.
 */
async function clearTheBook(): Promise<void> {
  await db.execute(sql`truncate cash_book_entry`);
  await db.delete(pendingItem);
  await db.delete(shift);
  await db.delete(auditEntry);
  await db.delete(staffUser).where(inArray(staffUser.email, [...EMAILS]));
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

/** The drawer this operator is on, as they see it themselves. */
async function drawerOf(account: StaffAccount): Promise<Shift> {
  const response = await asAccount(
    account.email,
    "get",
    "/shifts/current",
  ).expect(200);

  return response.body as Shift;
}

/**
 * The SQLSTATE and message out of a statement the database was meant to refuse.
 *
 * Drizzle wraps the driver's error in one of its own, so the fields that matter
 * sit on a cause one or more levels down; the chain is walked rather than
 * assumed to be one deep. Thrown rather than returned when nothing was refused,
 * so a case that meant to assert a refusal cannot pass by getting a success.
 */
async function refusedByTheBook(
  statement: SQL,
): Promise<{ code: string | undefined; message: string }> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(statement);
    });
  } catch (error) {
    for (let current = error; current instanceof Error; current = current.cause) {
      const { code } = current as Error & { code?: unknown };

      if (typeof code === "string") {
        return { code, message: current.message };
      }
    }

    return { code: undefined, message: String(error) };
  }

  throw new Error("the cash book accepted a statement it should have refused");
}

/**
 * Every cash book route, with the matrix row it declares and what it does with
 * it.
 *
 * `action` is part of the data rather than assumed, so the read and the two
 * writes are asked the question each of them actually poses of the grant. All
 * three hold the same row today and all three of its holders are `full`, so
 * every role lands the same way on all three — which is the answer, and is worth
 * asserting rather than assuming.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post";
  readonly path: string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "recordCashBookEntry",
    method: "post",
    path: "/finance/entries",
    capability: "operations.income-expense",
    action: "write",
  },
  {
    name: "reverseCashBookEntry",
    method: "post",
    path: `/finance/entries/${ABSENT_ID}/reversal`,
    capability: "operations.income-expense",
    action: "write",
  },
  {
    name: "listCashBookEntries",
    method: "get",
    path: "/finance/entries",
    capability: "operations.income-expense",
    action: "read",
  },
];

describe("the capability each cash book route declares", () => {
  // §4's obligation for the row these routes add. No body is sent to the
  // writes — the guard runs before the handler, so an admitted caller answers
  // 400 and a refused one answers 403 either way, and nothing is recorded while
  // the matrix is being asserted.
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

  it("refuses the desk outright, on the read as well as the writes", async () => {
    // Stated on its own rather than left to fall out of the loop, because it is
    // the product decision this feature is most likely to be questioned on: a
    // receptionist may not so much as read what came out of their own till.
    // `rbac-matrix.md` is where that would be changed, and nothing in the API
    // is.
    for (const route of ROUTES) {
      await as("RECEPTIONIST", route.method, route.path).expect(403);
      await as("HOUSEKEEPING", route.method, route.path).expect(403);
    }
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http()[route.method](route.path).send().expect(401);
    }
  });

  it("names only a row the matrix already has", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that the row
    // is the one the routes are meant to be under, and that it is not a key some
    // future edit renamed out from under a route that still answers.
    for (const route of ROUTES) {
      expect(capability(route.capability).section).toBe("Folio and money");
      expect(capability(route.capability).row).toBe(
        "Income / expense (thu chi)",
      );
    }
  });
});

describe("recording what the property took and spent", () => {
  it("opens a drawer for the day shift to spend out of", async () => {
    const response = await as("RECEPTIONIST", "post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
    }).expect(200);

    dayDrawerId = (response.body as Shift).id;

    // Nothing has been paid in and nothing recorded against it. Both figures are
    // sums over no rows rather than zeros written when the drawer was opened.
    expect(BigInt((response.body as Shift).cashTaken)).toBe(0n);
    expect(BigInt((response.body as Shift).cashBookNet)).toBe(0n);
  });

  it("records cash out of that drawer in the manager's name", async () => {
    const response = await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SUPPLIES",
      method: "CASH",
      amount: SUPPLIES_IN_CASH.toString(),
      shiftId: dayDrawerId,
      note: TWO_CRATES_OF_WATER,
    }).expect(200);

    const recorded = response.body as Entry;
    suppliesEntryId = recorded.id;

    expect(BigInt(recorded.amount)).toBe(SUPPLIES_IN_CASH);
    expect(recorded.shiftId).toBe(dayDrawerId);
    // The recorder comes off the session, and the contract carries no field for
    // one — an entry cannot be attributed to somebody who did not make it.
    expect(recorded.recordedById).toBe(managerId);
    expect(recorded.recordedByName).toBe(STAFF.MANAGER.fullName);
    // The property's rollover applied to the clock, resolved on the server
    // because the caller named no day.
    expect(recorded.businessDate).toBe(BUSINESS_DATE);
    expect(recorded.reversesEntryId).toBeNull();
    expect(recorded.reversedByEntryId).toBeNull();
  });

  it("moves the drawer's expected figure, in the operator's own view of it", async () => {
    // The point of decision one, asserted from the side that matters: the
    // receptionist may not read the cash book at all, and this is the only place
    // the money shows up for them.
    const drawer = await drawerOf(STAFF.RECEPTIONIST);

    expect(drawer.id).toBe(dayDrawerId);
    expect(BigInt(drawer.cashTaken)).toBe(0n);
    expect(BigInt(drawer.cashBookNet)).toBe(-SUPPLIES_IN_CASH);
  });

  it("records a salary paid from the bank against no drawer at all", async () => {
    const response = await as("ACCOUNTANT", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SALARIES",
      method: "BANK_TRANSFER",
      amount: SALARIES_BY_TRANSFER.toString(),
      note: WAGES_FOR_THE_MONTH,
    }).expect(200);

    expect((response.body as Entry).shiftId).toBeNull();
  });

  it("leaves every drawer where it was when the money never touched one", async () => {
    // The other half of the biconditional, and the reason a method travels on
    // the entry at all: eight million đồng of wages left the property and the
    // till is not a đồng different for it.
    const drawer = await drawerOf(STAFF.RECEPTIONIST);

    expect(BigInt(drawer.cashBookNet)).toBe(-SUPPLIES_IN_CASH);
  });

  it("refuses cash that names no drawer", async () => {
    // The contract's own refinement: money out of a till has to be in that
    // shift's count, or the operator signing for it is short by the whole of it.
    await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SUPPLIES",
      method: "CASH",
      amount: "50000",
      note: "Tiền taxi.",
    }).expect(400);
  });

  it("refuses a bank transfer that names one", async () => {
    await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SALARIES",
      method: "BANK_TRANSFER",
      amount: "50000",
      shiftId: dayDrawerId,
      note: "Lương.",
    }).expect(400);
  });

  it("refuses a category booked on the wrong side of the book", async () => {
    // Wages counted as money the property took would be wrong in the one column
    // an accountant reads a month by, and it is a typo rather than a rare event.
    await as("MANAGER", "post", "/finance/entries", {
      direction: "INCOME",
      category: "SALARIES",
      method: "BANK_TRANSFER",
      amount: "50000",
      note: "Lương.",
    }).expect(400);
  });

  it("refuses an amount that is not a quantity of đồng", async () => {
    // The direction carries the sign, so a negative expense is an income spelled
    // the other way round — and a movement of nothing is not a movement.
    for (const amount of ["0", "-300000"]) {
      await as("MANAGER", "post", "/finance/entries", {
        direction: "EXPENSE",
        category: "SUPPLIES",
        method: "BANK_TRANSFER",
        amount,
        note: TWO_CRATES_OF_WATER,
      }).expect(400);
    }
  });

  it("refuses an entry that says nothing about itself", async () => {
    await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SUPPLIES",
      method: "BANK_TRANSFER",
      amount: "50000",
      note: "   ",
    }).expect(400);
  });

  it("takes a day the property has already traded", async () => {
    // The reason the column is stored rather than derived from the instant: an
    // accountant recording Friday's transfer on Monday is filing it under
    // Friday, and a month cut on the instant would report it in the wrong one.
    const response = await as("ACCOUNTANT", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "UTILITIES",
      method: "BANK_TRANSFER",
      amount: AN_ELECTRICITY_BILL.toString(),
      businessDate: A_DAY_ALREADY_TRADED,
      note: "Tiền điện tháng 10.",
    }).expect(200);

    expect((response.body as Entry).businessDate).toBe(A_DAY_ALREADY_TRADED);
  });

  it("refuses a day that has not happened", async () => {
    const refusal = await as("ACCOUNTANT", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "UTILITIES",
      method: "BANK_TRANSFER",
      amount: AN_ELECTRICITY_BILL.toString(),
      businessDate: A_DAY_THAT_HAS_NOT_HAPPENED,
      note: "Tiền điện tháng 12.",
    }).expect(400);

    expect(refusal.body.message).toContain("has not happened");
  });
});

describe("the change log behind an entry", () => {
  it("names the member of staff the guard resolved", async () => {
    // The table carries `0041`'s trigger like every other protected one —
    // `every-change-is-recorded.e2e-spec.ts` asserts that it does at all. What
    // is asserted here is the half a coverage test cannot: the row written
    // through this route arrives in the log attributed to the account that
    // presented the credential, on a request whose body never mentions an actor.
    const filed = await db
      .select({ actorId: auditEntry.actorId, action: auditEntry.action })
      .from(auditEntry)
      .where(
        and(
          eq(auditEntry.tableName, "cash_book_entry"),
          eq(auditEntry.rowId, suppliesEntryId),
        ),
      );

    expect(filed).toHaveLength(1);
    expect(filed[0]?.action).toBe("INSERT");
    expect(filed[0]?.actorId).toBe(managerId);
  });
});

describe("counting the drawer out", () => {
  it("is square against the float less what was spent from it", async () => {
    // The whole of decision one in one figure. The drawer took no guest cash, so
    // what it should hold is the float less the supplier's đồng — and a count of
    // exactly that is a drawer with nothing to explain. Without the cash book in
    // the sum this same count would report the receptionist three hundred
    // thousand short, for money a manager took out of the till in front of them.
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/shifts/${dayDrawerId}/closure`,
      { closingCount: COUNTED_OUT_SQUARE.toString() },
    ).expect(200);

    const closed = response.body as Shift;

    expect(BigInt(closed.closingCount!)).toBe(COUNTED_OUT_SQUARE);
    expect(BigInt(closed.cashBookNet)).toBe(-SUPPLIES_IN_CASH);
    expect(BigInt(closed.variance!)).toBe(0n);
  });

  it("refuses cash recorded against a drawer already counted out", async () => {
    // `migrations/0042`'s trigger reporting itself through the route, in the
    // terms `shift.service.ts` already throws at a second close.
    const refusal = await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SUPPLIES",
      method: "CASH",
      amount: "50000",
      shiftId: dayDrawerId,
      note: "Muộn mất rồi.",
    }).expect(409);

    expect(refusal.body.message).toContain("counted out");
  });

  it("refuses a drawer that is not there at all", async () => {
    await as("MANAGER", "post", "/finance/entries", {
      direction: "EXPENSE",
      category: "SUPPLIES",
      method: "CASH",
      amount: "50000",
      shiftId: ABSENT_ID,
      note: "Ngăn kéo không có thật.",
    }).expect(404);
  });
});

describe("the book as a record", () => {
  it("refuses an edit to an entry, for every client", async () => {
    // A rule in a service holds for its own callers and for nobody else. This
    // statement goes round the service, round the contract and round the guard,
    // straight at the table — and is refused, because a drawer's expected figure
    // is computed from these rows and this one has already been counted against.
    const refusal = await refusedByTheBook(
      sql`update cash_book_entry set amount = amount - 1 where id = ${suppliesEntryId}::uuid`,
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("append-only");
    expect(refusal.message).toContain("update");

    // The half a raised exception alone does not prove: the row is as it was.
    const [stored] = await db
      .select({ amount: cashBookEntry.amount })
      .from(cashBookEntry)
      .where(eq(cashBookEntry.id, suppliesEntryId));

    expect(stored?.amount).toBe(SUPPLIES_IN_CASH);
  });

  it("refuses a deletion the same way", async () => {
    const refusal = await refusedByTheBook(
      sql`delete from cash_book_entry where id = ${suppliesEntryId}::uuid`,
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("delete");
  });
});

describe("correcting a mistake", () => {
  it("opens the night shift's drawer, which is where the đồng go back", async () => {
    const response = await asNight("post", "/shifts", {
      openingFloat: OPENING_FLOAT.toString(),
    }).expect(200);

    nightDrawerId = (response.body as Shift).id;
  });

  it("records the opposite against the drawer that is open now", async () => {
    const response = await as(
      "MANAGER",
      "post",
      `/finance/entries/${suppliesEntryId}/reversal`,
      { shiftId: nightDrawerId, note: RECORDED_TWICE },
    ).expect(200);

    const correction = response.body as Entry;
    correctionId = correction.id;

    // Everything but the drawer and the reason is the original's, read off the
    // row: a caller able to send an amount would be recording a second,
    // unrelated movement while calling it a correction.
    //
    // `SUPPLIES` as income is the pairing the table refuses of anything a person
    // chose, and takes here — `cash_book_entry_direction_suits_its_category`
    // exempts a row that names a reversed entry. Without that exemption the
    // correction would either be refused outright or have to be filed under some
    // neutral category, and the column an accountant reads a month by would show
    // supplies that were never bought with the money coming back elsewhere.
    expect(correction.direction).toBe("INCOME");
    expect(correction.category).toBe("SUPPLIES");
    expect(correction.method).toBe("CASH");
    expect(BigInt(correction.amount)).toBe(SUPPLIES_IN_CASH);
    expect(correction.reversesEntryId).toBe(suppliesEntryId);
    expect(correction.shiftId).toBe(nightDrawerId);
    expect(correction.note).toBe(RECORDED_TWICE);
  });

  it("puts the money into the drawer it actually came back through", async () => {
    const drawer = await drawerOf(NIGHT);

    expect(drawer.id).toBe(nightDrawerId);
    expect(BigInt(drawer.cashBookNet)).toBe(SUPPLIES_IN_CASH);
  });

  it("leaves the counted drawer exactly as it was signed for", async () => {
    // The reason a correction names a drawer instead of inheriting one, and the
    // whole of what "reproducible" means here. The day shift's variance stands
    // on the count that closed it, and no act taken afterwards moves it.
    const [closed] = await db
      .select({
        closingCount: shift.closingCount,
        closedAt: shift.closedAt,
      })
      .from(shift)
      .where(eq(shift.id, dayDrawerId));

    expect(closed?.closingCount).toBe(COUNTED_OUT_SQUARE);

    const history = await as("MANAGER", "get", "/shifts", {}).expect(200);
    const day = (history.body.shifts as Shift[]).find(
      (one) => one.id === dayDrawerId,
    );

    expect(BigInt(day!.cashBookNet)).toBe(-SUPPLIES_IN_CASH);
    expect(BigInt(day!.variance!)).toBe(0n);
  });

  it("refuses a second correction of the same entry", async () => {
    // `cash_book_entry_reversal_unique_key` refusing. Twice would take the same
    // money back out of the book twice, and — because a correction is an insert
    // rather than an edit — nothing else would refuse the second row.
    await as(
      "MANAGER",
      "post",
      `/finance/entries/${suppliesEntryId}/reversal`,
      { shiftId: nightDrawerId, note: "Lại ghi trùng." },
    ).expect(409);
  });

  it("refuses a correction of a correction", async () => {
    const refusal = await as(
      "MANAGER",
      "post",
      `/finance/entries/${correctionId}/reversal`,
      { shiftId: nightDrawerId, note: "Lộn nữa." },
    ).expect(409);

    expect(refusal.body.message).toContain("itself a correction");
  });

  it("refuses a correction with no account of why", async () => {
    await as("MANAGER", "post", `/finance/entries/${ABSENT_ID}/reversal`, {
      note: "  ",
    }).expect(400);
  });

  it("refuses a correction of an entry that is not there", async () => {
    await as("MANAGER", "post", `/finance/entries/${ABSENT_ID}/reversal`, {
      note: "Không có gì để sửa.",
    }).expect(404);
  });
});

describe("reading the book back", () => {
  it("records what the function room was let for, into the night till", async () => {
    await as("ACCOUNTANT", "post", "/finance/entries", {
      direction: "INCOME",
      category: "VENUE_HIRE",
      method: "CASH",
      amount: VENUE_HIRE_IN_CASH.toString(),
      shiftId: nightDrawerId,
      note: THE_FUNCTION_ROOM,
    }).expect(200);
  });

  it("answers with both sides counted under the filters, not over the page", async () => {
    const response = await as("ACCOUNTANT", "get", "/finance/entries").expect(
      200,
    );

    const page = response.body as Page;

    // Five rows: supplies, its correction, salaries, the electricity bill and
    // the venue hire — and nothing else, because every refusal above wrote no
    // row. The correction is counted like any other entry, which is what the
    // book says and what a reader checking it against a bank statement needs.
    expect(page.total).toBe(5);
    expect(page.entries).toHaveLength(5);
    expect(BigInt(page.incomeTotal)).toBe(
      SUPPLIES_IN_CASH + VENUE_HIRE_IN_CASH,
    );
    expect(BigInt(page.expenseTotal)).toBe(
      SUPPLIES_IN_CASH + SALARIES_BY_TRANSFER + AN_ELECTRICITY_BILL,
    );
  });

  it("narrows to one side without changing what the totals are counted over", async () => {
    const response = await as("ACCOUNTANT", "get", "/finance/entries", {
      direction: "INCOME",
    }).expect(200);

    const page = response.body as Page;

    expect(page.entries.every((one) => one.direction === "INCOME")).toBe(true);
    expect(BigInt(page.expenseTotal)).toBe(0n);
    expect(BigInt(page.incomeTotal)).toBe(
      SUPPLIES_IN_CASH + VENUE_HIRE_IN_CASH,
    );
  });

  it("narrows to a category and to a way the money moved", async () => {
    const response = await as("ACCOUNTANT", "get", "/finance/entries", {
      category: "SALARIES",
      method: "BANK_TRANSFER",
    }).expect(200);

    const page = response.body as Page;

    expect(page.total).toBe(1);
    expect(BigInt(page.expenseTotal)).toBe(SALARIES_BY_TRANSFER);
  });

  it("narrows to a stretch of trading days, on the day the money moved", async () => {
    // The electricity bill was recorded today and filed under the first, so a
    // range that ends before today finds it and nothing else — which is the
    // difference between `business_date` and `recorded_at` in one assertion.
    const response = await as("ACCOUNTANT", "get", "/finance/entries", {
      from: A_DAY_ALREADY_TRADED,
      to: A_DAY_ALREADY_TRADED,
    }).expect(200);

    const page = response.body as Page;

    expect(page.total).toBe(1);
    expect(page.entries[0]?.category).toBe("UTILITIES");
  });

  it("says which entry was corrected without being asked a second question", async () => {
    const response = await as("ACCOUNTANT", "get", "/finance/entries", {
      category: "SUPPLIES",
    }).expect(200);

    const page = response.body as Page;
    const mistake = page.entries.find((one) => one.id === suppliesEntryId);

    expect(mistake?.reversedByEntryId).toBe(correctionId);
    // A correction is not itself corrected, and the column says so rather than
    // leaving a screen to work it out.
    expect(
      page.entries.find((one) => one.id === correctionId)?.reversedByEntryId,
    ).toBeNull();
  });

  it("refuses a range that ends before it begins", async () => {
    await as("ACCOUNTANT", "get", "/finance/entries", {
      from: BUSINESS_DATE,
      to: A_DAY_ALREADY_TRADED,
    }).expect(400);
  });
});
