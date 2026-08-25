// The folio collection, end to end — `GET /folios` over a real Postgres, the
// real capability guard and both realms.
//
// `folio-api.e2e-spec.ts` proves what happens to one stay's account. This file
// is about the question that has no stay in it: which of the property's
// accounts are still short. Five claims, and each one is a way the route could
// be wrong without looking wrong:
//
// 1. **The balance is derived, and derived from the whole account.** No column
//    holds it, so the filter and the three figures are both aggregates over the
//    ledger. The sharpest form of that is the account below with a charge on one
//    trading day and a payment on the next: asked for by naming the first day,
//    it must still report the payment, because a summary computed from the
//    window would print a fraction of what the guest owes under the word
//    outstanding.
// 2. **Unsettled means "does not balance", not "owes".** An over-paid stay is
//    money the property owes the guest, and a desk chasing exceptions at the end
//    of a shift needs it in the same list. The narrower filter beside it is the
//    other half of that: a guest owed a refund has to be reachable *without*
//    every guest who owes the property standing in the answer, because §4's
//    penalty against a prepaid stay leaves accounts there and nothing hands the
//    money back on its own. The two filters are asserted against the same
//    fixture so that widening one cannot be mistaken for narrowing the other.
// 3. **The page bounds the answer and the total does not.** A count card asks
//    this route for one row and reads the figure, so the figure has to be about
//    the filter rather than about the page.
// 4. **The guest realm is refused.** The matrix grants `folio.read` to a guest
//    as `conditional` — "own, settled view" — and `roles.ts` lets that past the
//    guard, so a real signed-in guest reaches the handler. There is no stay
//    named in this request for an ownership check to be about, so what the
//    handler owes is a refusal, and the body must carry no figure off any
//    account.
// 5. **The row shape discloses the summary and nothing that stores it.** The
//    field list is asserted whole rather than field by field, because the
//    failure being guarded against is a field nobody thought of.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `folio.module.ts` ever stops carrying the controller.
//
// The ledger is emptied before and after. The list is property-wide, so an
// account another suite left behind is not background noise here — it is a row
// in the answer.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { LONGEST_FOLIO_PAGE, type StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import {
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import { permits } from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** Two trading days, so "which accounts moved on the 9th" is a question with a
 *  wrong answer available. The property's day is stopped at one or the other
 *  for the whole of a posting, so a line's business date is a constant. */
const DAY_ONE = parseDate("2027-06-09");
const DAY_TWO = parseDate("2027-06-10");

/** What the desk posts. Neither divides evenly by any plausible tax rate, so a
 *  decomposition that lost a đồng would show in the summary. */
const A_CHARGE = 1_111_111n;
const A_LARGER_PAYMENT = A_CHARGE + 1n;

/** The charge and the payment on the account whose two lines fall on different
 *  trading days — deliberately unequal, so the account is still short. */
const EARLY_CHARGE = 1_000_000n;
const LATE_PAYMENT = 300_000n;

const GUEST_EMAIL = "khach.danh.sach@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

const LIST_PATH = "/folios";

/** The fields one listed account may carry. A stored balance would have to
 *  arrive as one of these, and there is deliberately no room for it. */
const LISTED_FIELDS = [
  "id",
  "bookingId",
  "state",
  "openedAt",
  "closedAt",
  "summary",
] as const;

const SUMMARY_FIELDS = ["charged", "credited", "outstanding"] as const;

/**
 * The property's day, stopped and movable.
 *
 * Movable because a business-date filter cannot be asserted against a single
 * day: with one day in the ledger every predicate that reads the column at all
 * returns everything, including one that ignores it.
 */
class MovableClock extends BusinessDateService {
  static day: StayDate = DAY_TWO;

  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return MovableClock.day;
  }
}

/** Captures what would have been sent, so the guest's verification link can be
 *  followed the way a guest follows it out of an inbox. */
class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  linkTo(address: string): string {
    const email = [...this.sent].reverse().find((sent) => sent.to === address);

    if (!email) {
      throw new Error(`No email was sent to ${address}`);
    }

    const link = /https?:\/\/\S+/.exec(email.text)?.[0];

    if (!link) {
      throw new Error(`No link in the email to ${address}`);
    }

    return link;
  }
}

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

const STAFF = {
  MANAGER: {
    email: "quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "le.tan@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

interface ListedFolio {
  readonly id: string;
  readonly bookingId: string;
  readonly state: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly summary: {
    readonly charged: string;
    readonly credited: string;
    readonly outstanding: string;
  };
}

interface FolioPage {
  readonly folios: readonly ListedFolio[];
  readonly total: number;
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let mailer: RecordingMailer;
const tokens = new Map<StaffRole, string>();

/**
 * Five accounts, each one a row of the answer.
 *
 * `settled` is open and balances, which is the account every filter below must
 * be able to leave out; `closed` balances and has been agreed; `overpaid` is the
 * one the property owes; `straddling` is the account whose two lines fall on
 * different trading days.
 */
let owing: string;
let settled: string;
let overpaid: string;
let closed: string;
let straddling: string;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(BusinessDateService)
    .useClass(MovableClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();

  // The five staff accounts are created by email and the column is unique, so
  // they have to be the only five. The guest realm is emptied for the same
  // reason.
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays: every claim here counts accounts, and five hundred
  // random holds would put folios in the answer that nothing here posted to.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  // The order the accounts are opened in is the order the list answers in,
  // reversed — newest first — so they are created one at a time rather than in
  // parallel, and the sequence below is what the paging claims are asserted
  // against.
  MovableClock.day = DAY_ONE;

  straddling = await aStay("2027-06-10");
  await postCharge(straddling, EARLY_CHARGE, "A night, charged on the 9th");

  MovableClock.day = DAY_TWO;

  owing = await aStay("2027-06-11");
  await postCharge(owing, A_CHARGE, "A night nobody has paid for");

  settled = await aStay("2027-06-12");
  await postCharge(settled, A_CHARGE, "A night, to be paid in full");
  await postPayment(settled, A_CHARGE, "Bank transfer, in full");

  overpaid = await aStay("2027-06-13");
  await postCharge(overpaid, A_CHARGE, "A night, about to be over-paid");
  await postPayment(overpaid, A_LARGER_PAYMENT, "Transfer, one đồng too many");

  closed = await aStay("2027-06-14");
  await postCharge(closed, A_CHARGE, "A night, to be settled and agreed");
  await postPayment(closed, A_CHARGE, "Bank transfer, settling the account");
  await as("RECEPTIONIST", "post", `/bookings/${closed}/folio/closure`).expect(
    200,
  );

  // The payment that lands the day after the charge it is against. This is the
  // account the window claim turns on: named by the 9th, it must still report
  // this figure.
  await postPayment(straddling, LATE_PAYMENT, "Part payment, the next morning");
}, 180_000);

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, they would be rows in the next suite's answers.
  await clearTheLedger();
  await app?.close();
});

async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A call as one member of staff. A `GET` carries its arguments in the query
 *  string and everything else in the body. */
function as(
  role: StaffRole,
  method: "get" | "post",
  path: string,
  body: object = {},
): request.Test {
  const call = http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`);

  return method === "get" ? call.query(body) : call.send(body);
}

/** A stay the desk has taken, through the real route. */
async function aStay(checkIn: string): Promise<string> {
  const created = await as("RECEPTIONIST", "post", "/bookings", {
    roomType: "SUPERIOR",
    checkIn,
    checkOut: parseDate(checkIn).add({ days: 2 }).toString(),
    plan: "STANDARD",
    adults: 2,
    childAges: [],
  });

  if (created.status !== 201) {
    throw new Error(`the stay was refused: ${JSON.stringify(created.body)}`);
  }

  return created.body.id as string;
}

async function postCharge(
  bookingId: string,
  grossAmount: bigint,
  description: string,
): Promise<void> {
  await as("RECEPTIONIST", "post", `/bookings/${bookingId}/folio/charges`, {
    grossAmount: grossAmount.toString(),
    description,
  }).expect(200);
}

async function postPayment(
  bookingId: string,
  amount: bigint,
  description: string,
): Promise<void> {
  await as("RECEPTIONIST", "post", `/bookings/${bookingId}/folio/payments`, {
    amount: amount.toString(),
    description,
    // The one method this route carries on its own: cash belongs to an open
    // shift, and no handler here has one to name.
    method: "BANK_TRANSFER",
  }).expect(200);
}

/** The collection as one role reads it, under whatever filters. */
async function list(
  query: Record<string, string | number> = {},
  role: StaffRole = "RECEPTIONIST",
): Promise<FolioPage> {
  const response = await as(role, "get", LIST_PATH, query).expect(200);

  return response.body;
}

const staysOn = (page: FolioPage) => page.folios.map((each) => each.bookingId);

describe("the capability the folio collection declares", () => {
  // §4's obligation for the row this route adds. Driven off `staffGrant` rather
  // than off a list written out here, and asked with `permits(grant, "read")`
  // because the route declares itself a read.
  for (const role of STAFF_ROLES) {
    const admitted = permits(staffGrant("folio.read", role), "read");

    it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
      const response = await as(role, "get", LIST_PATH);

      if (admitted) {
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    await http().get(LIST_PATH).expect(401);
  });
});

describe("a guest holding a real session", () => {
  let guest: request.Agent;

  beforeAll(async () => {
    await http()
      .post("/api/auth/sign-up/email")
      .send({
        name: "Đỗ Thị Lan",
        email: GUEST_EMAIL,
        password: GUEST_PASSWORD,
      })
      .expect(200);

    const link = new URL(mailer.linkTo(GUEST_EMAIL));

    await http().get(`${link.pathname}${link.search}`).expect(302);

    guest = request.agent(app.getHttpServer());

    await guest
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(200);

    // The session is real, which is what makes the refusal below mean
    // something: it is about authority and not about the cookie.
    const session = await guest.get("/api/auth/get-session").expect(200);

    expect(session.body.user.emailVerified).toBe(true);
  });

  it("is refused the property's accounts with 403 rather than 401", async () => {
    // The matrix grants this row `conditional` and `roles.ts` lets that past the
    // guard, so the refusal comes from the handler. There is no stay named in
    // this request, so there is nothing an ownership check could be about.
    const response = await guest.get(LIST_PATH);

    expect(response.status).toBe(403);
  });

  it("is refused the filter that names the money as well", async () => {
    // The same refusal under the narrowing a screen would actually send. A
    // guard that only covered the bare path would be a door left open behind a
    // query string.
    await guest
      .get(LIST_PATH)
      .query({ state: "OPEN", balance: "OUTSTANDING" })
      .expect(403);
  });

  it("is told nothing about the accounts it was refused", async () => {
    const response = await guest.get(LIST_PATH).expect(403);
    const body = JSON.stringify(response.body);

    // The claim is about the whole body rather than the fields expected to
    // carry the money, because the failure being guarded against is a field
    // nobody thought of.
    expect(body).not.toContain(A_CHARGE.toString());
    expect(body).not.toContain(EARLY_CHARGE.toString());
    expect(body).not.toContain("summary");
    expect(body).not.toContain("folios");
  });
});

describe("the accounts the desk lists", () => {
  it("answers every account, newest first", async () => {
    const page = await list();

    expect(page.total).toBe(5);
    expect(staysOn(page)).toEqual([
      closed,
      overpaid,
      settled,
      owing,
      straddling,
    ]);
  });

  it("carries the summary and nothing that could store it", async () => {
    const [account] = (await list()).folios;

    expect(Object.keys(account).sort()).toEqual([...LISTED_FIELDS].sort());
    expect(Object.keys(account.summary).sort()).toEqual(
      [...SUMMARY_FIELDS].sort(),
    );
  });

  it("carries money as decimal text, negatives included", async () => {
    const page = await list();
    const account = page.folios.find((each) => each.bookingId === overpaid)!;

    // `money.ts` fixes the wire form, and an over-paid stay is the only shape
    // on this route that can show the balance in the negative.
    expect(account.summary.charged).toBe(A_CHARGE.toString());
    expect(account.summary.credited).toBe(A_LARGER_PAYMENT.toString());
    expect(account.summary.outstanding).toBe(
      (A_CHARGE - A_LARGER_PAYMENT).toString(),
    );
  });

  it("derives the balance from the lines rather than from a column", async () => {
    const page = await list();

    for (const account of page.folios) {
      // The identity `NFR-02` states, checked on every row: the outstanding
      // figure is the difference of the other two and never a third number.
      expect(BigInt(account.summary.outstanding)).toBe(
        BigInt(account.summary.charged) - BigInt(account.summary.credited),
      );
    }
  });
});

describe("the unsettled filter", () => {
  it("answers exactly the accounts that do not balance", async () => {
    const page = await list({ balance: "OUTSTANDING" });

    // The over-paid stay is in the set and the settled ones are not. Both
    // halves matter: an account the property owes money on is an exception, and
    // a filter written as `> 0` would quietly drop it.
    expect(staysOn(page).sort()).toEqual([overpaid, owing, straddling].sort());
    expect(page.total).toBe(3);
  });

  it("leaves out an account that balances, open or agreed", async () => {
    const stays = staysOn(await list({ balance: "OUTSTANDING" }));

    expect(stays).not.toContain(settled);
    expect(stays).not.toContain(closed);
  });

  it("answers every account when the balance is not asked about", async () => {
    expect((await list({ balance: "ANY" })).total).toBe(5);
  });
});

describe("the over-paid filter", () => {
  it("answers only the accounts the property owes money back on", async () => {
    const page = await list({ balance: "OVERPAID" });

    expect(staysOn(page)).toEqual([overpaid]);
    // Counted under the same predicate the page was cut from. A count card
    // reading this figure is asking how many guests are owed a refund, and the
    // wider filter's three would be the wrong answer to that question.
    expect(page.total).toBe(1);
  });

  it("leaves out the accounts that still owe the property", async () => {
    const stays = staysOn(await list({ balance: "OVERPAID" }));

    // Both of these fail to balance and both are in `OUTSTANDING`. They are the
    // whole reason the narrow filter exists: a predicate written as `<> 0` here
    // would answer with a worklist of guests to refund that mostly owes money.
    expect(stays).not.toContain(owing);
    expect(stays).not.toContain(straddling);
  });

  it("leaves out an account that balances, open or agreed", async () => {
    const stays = staysOn(await list({ balance: "OVERPAID" }));

    // `< 0` and never `<= 0`. A settled account is not money to hand back, and
    // the agreed one would drag every closed stay in the property's history onto
    // the list behind it.
    expect(stays).not.toContain(settled);
    expect(stays).not.toContain(closed);
  });

  it("narrows the unsettled set rather than asking beside it", async () => {
    const unsettled = staysOn(await list({ balance: "OUTSTANDING" }));
    const owed = staysOn(await list({ balance: "OVERPAID" }));

    // The narrow member is a subset of the wide one by construction — `< 0`
    // implies `<> 0` — and asserting it holds the two predicates to one sign
    // convention rather than to two independently plausible ones.
    expect(unsettled).toEqual(expect.arrayContaining(owed));
    expect(owed.length).toBeLessThan(unsettled.length);
  });

  it("narrows with the state and the window like the other members", async () => {
    // The account is open and its lines fall on the 10th, so each of these is
    // the same one row — what would break them is a predicate pushed into the
    // `where` beside the state, or one that replaced the window's `having`
    // rather than joining it.
    expect(staysOn(await list({ balance: "OVERPAID", state: "OPEN" }))).toEqual([
      overpaid,
    ]);
    expect(
      staysOn(await list({ balance: "OVERPAID", state: "CLOSED" })),
    ).toEqual([]);
    expect(
      staysOn(
        await list({
          balance: "OVERPAID",
          from: DAY_ONE.toString(),
          to: DAY_ONE.toString(),
        }),
      ),
    ).toEqual([]);
  });

  it("reports the whole account under the negative balance it matched on", async () => {
    const [account] = (await list({ balance: "OVERPAID" })).folios;

    // The figure the filter selected on, printed. `money.ts` fixes the wire
    // form, and this is the one shape on the route that shows it in the
    // negative — the amount the desk owes is its magnitude.
    expect(account.summary.outstanding).toBe(
      (A_CHARGE - A_LARGER_PAYMENT).toString(),
    );
    expect(BigInt(account.summary.outstanding)).toBeLessThan(0n);
  });

  it("refuses a balance filter that is not one of the three", async () => {
    await as("RECEPTIONIST", "get", LIST_PATH, { balance: "OWED" }).expect(400);
  });
});

describe("the state filter", () => {
  it("separates the accounts still taking lines from the agreed one", async () => {
    const open = await list({ state: "OPEN" });
    const agreed = await list({ state: "CLOSED" });

    expect(staysOn(open).sort()).toEqual(
      [owing, settled, overpaid, straddling].sort(),
    );
    expect(staysOn(agreed)).toEqual([closed]);
  });

  it("narrows with the balance rather than instead of it", async () => {
    const page = await list({ state: "OPEN", balance: "OUTSTANDING" });

    // The dashboard's question, exactly: which accounts still taking lines are
    // short. The agreed account balances, so it would be absent either way —
    // what this asserts is that both predicates are applied.
    expect(staysOn(page).sort()).toEqual([overpaid, owing, straddling].sort());
  });
});

describe("the trading-day window", () => {
  it("answers the accounts that moved on the day named", async () => {
    const page = await list({
      from: DAY_ONE.toString(),
      to: DAY_ONE.toString(),
    });

    // One account has a line on the 9th. Every other line in the ledger was
    // written on the 10th, so a predicate that ignored the column would answer
    // with five.
    expect(staysOn(page)).toEqual([straddling]);
    expect(page.total).toBe(1);
  });

  it("reports the whole account, not the part inside the window", async () => {
    const [account] = (
      await list({ from: DAY_ONE.toString(), to: DAY_ONE.toString() })
    ).folios;

    // The payment fell on the 10th and the window names the 9th. It is in the
    // summary because the summary is the account's, and a figure computed from
    // the window would understate what has been paid.
    expect(account.summary.charged).toBe(EARLY_CHARGE.toString());
    expect(account.summary.credited).toBe(LATE_PAYMENT.toString());
    expect(account.summary.outstanding).toBe(
      (EARLY_CHARGE - LATE_PAYMENT).toString(),
    );
  });

  it("takes each end on its own, and both inclusive", async () => {
    expect((await list({ from: DAY_TWO.toString() })).total).toBe(5);
    expect((await list({ to: DAY_ONE.toString() })).total).toBe(1);
    expect(
      (await list({ from: DAY_ONE.toString(), to: DAY_TWO.toString() })).total,
    ).toBe(5);
  });

  it("refuses a window that ends before it starts", async () => {
    await as("RECEPTIONIST", "get", LIST_PATH, {
      from: DAY_TWO.toString(),
      to: DAY_ONE.toString(),
    }).expect(400);
  });
});

describe("the page", () => {
  it("bounds the answer without bounding the count", async () => {
    const page = await list({ limit: 2 });

    expect(page.folios).toHaveLength(2);
    // The figure a count card reads. It is about the filter and not about the
    // page, which is the whole reason a card does not have to pull rows.
    expect(page.total).toBe(5);
  });

  it("walks the whole collection without repeating an account", async () => {
    const walked: string[] = [];

    for (let offset = 0; offset < 6; offset += 2) {
      walked.push(...staysOn(await list({ limit: 2, offset })));
    }

    expect(walked).toHaveLength(5);
    expect(new Set(walked).size).toBe(5);
    expect(walked.sort()).toEqual(
      [owing, settled, overpaid, closed, straddling].sort(),
    );
  });

  it("answers an offset past the end with no rows and the true count", async () => {
    const page = await list({ limit: 2, offset: 50 });

    expect(page.folios).toEqual([]);
    // The count is not inferred from the rows. A page that ran off the end
    // would otherwise report a property with no accounts on it.
    expect(page.total).toBe(5);
  });

  it("refuses a page larger than the ceiling", async () => {
    await as("RECEPTIONIST", "get", LIST_PATH, {
      limit: LONGEST_FOLIO_PAGE + 1,
    }).expect(400);
  });

  it("refuses a page of nothing and an offset below nothing", async () => {
    await as("RECEPTIONIST", "get", LIST_PATH, { limit: 0 }).expect(400);
    await as("RECEPTIONIST", "get", LIST_PATH, { offset: -1 }).expect(400);
  });
});

describe("the account's own route", () => {
  it("still answers one stay with its lines", async () => {
    // The collection is a second route and not a replacement. A regression
    // here would mean the list had been built by changing the read.
    const response = await as(
      "RECEPTIONIST",
      "get",
      `/bookings/${owing}/folio`,
    ).expect(200);

    expect(response.body.bookingId).toBe(owing);
    expect(response.body.postings.length).toBeGreaterThan(0);
    expect(response.body.summary.outstanding).toBe(A_CHARGE.toString());
  });
});
