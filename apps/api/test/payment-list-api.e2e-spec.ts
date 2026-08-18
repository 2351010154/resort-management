// The payments themselves, read back over HTTP against a real Postgres, the
// real capability guard, and rows in the table the gateway's callbacks write.
//
// `payment-api.e2e-spec.ts` proves the attempt is opened and
// `payment-callbacks.e2e-spec.ts` proves what a gateway's report does to it.
// `payment-reconciliation-api.e2e-spec.ts` proves the two reads about a *night*.
// What none of them can assert is the read about the *row*, and that is what
// this file is for:
//
// 1. **The route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` rather than off a list written out here — `rbac-matrix.md`
//    §4's own instruction. It takes `payment.reconcile`, the row the two
//    reconciliation reads already hold, so the assertion is that a third route
//    joined that row rather than that a key was invented for it.
// 2. **The guest realm is refused, and refused by the guard.** The row reads
//    `denied` there, so a signed-in guest holding a real session is a 403 with
//    no scope check below it — which is the whole difference between this
//    collection and `GET /folios`, where the grant is conditional and the
//    handler owes the refusal. The session is real on purpose: a 403 against a
//    caller with no cookie would prove nothing about the realm.
// 3. **Every filter narrows on the row it claims to.** The stay, the method, the
//    state, and the trading day — the last of which no column holds, so it is
//    the one that could silently answer with the wrong day's money.
// 4. **The trading day is the day the money moved on**, decided by §2's rollover
//    hour and not by the row's own clock. The configuration is written by this
//    file so the boundary is known, and the payments are timed at midday in the
//    property's zone so that no assertion here is really about the hour.
// 5. **A payment that never moved money belongs to no day.** An attempt still
//    pending and one the gateway refused both carry no time of payment, so they
//    report a null business date and a day filter leaves them out — a filter
//    that dated them by `created_at` would put money the property never took on
//    a night an accountant is reconciling.
// 6. **Đồng survive the crossing.** The column is `bigint` and the wire carries
//    decimal text, so a route that let an amount through a `number` would round
//    somebody's payment. Asserted against the response body as it was sent, not
//    only against the parsed value, because the parse is where the evidence of a
//    JSON number would be lost.
// 7. **A disagreement is referenced and never restated.** The row carries the id
//    of the discrepancy filed against it and nothing else about it; the figures,
//    the classification and the instant are the reconciliation read's answer,
//    and this file asserts that the link is enough to get there.
// 8. **The total is counted under the filters and not off the page.** A page cut
//    to one row still reports how many the property has, which is what a pager
//    and a count card both read.
//
// The rows are inserted directly rather than paid through a gateway. What is
// being read back is the table, and driving it through a sandbox would make this
// a suite about VNPay's checkout — which is what the callback suite is for.
//
// The ledger, the payments and the discrepancies are truncated on the way in and
// on the way out. A posting cannot be deleted, and a payment left standing is a
// row the next file's counts would include.

import "reflect-metadata";

import type { VndAmount } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { systemConfig } from "../src/database/schema/config.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
import {
  paymentDiscrepancy,
  paymentReconciliationRun,
} from "../src/database/schema/reconciliation.js";
import {
  capability,
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

/** The night the gateway and this property disagreed about a figure. */
const DISPUTED_DAY = "2027-10-14";

/** An earlier day, so a filter on one day has another to leave out. */
const EARLIER_DAY = "2027-10-11";

/** A day the property took no money at all. */
const QUIET_DAY = "2027-10-12";

/**
 * A configuration nobody could mistake for a property's real one, written so
 * that the rollover hour these assertions turn on is a known one.
 *
 * Only that hour matters here — it is what maps an instant of payment onto a
 * trading day — and the tax figures are deliberately unreal because §8 forbids
 * the tree from carrying a real rate. Nothing below posts anything for them to
 * apply to. `payment-reconciliation-sweep.e2e-spec.ts` writes the row the same
 * way and says why replacing it is safe: `vitest.config.ts` runs one file at a
 * time.
 */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 4,
} satisfies typeof systemConfig.$inferInsert;

/** References in the shape `payment.service.ts` mints them. */
const DISPUTED = "8b2e6d4c0a91" + "1a2b3c4d5e6f7081".repeat(3);
const REFUSED = "4c1f7a3e8d9b" + "0f6e5a4b3c2d1e0f".repeat(3);
const ABANDONED = "2f9a1c7b5e30" + "9182736455647382".repeat(3);

/**
 * The figures, in whole đồng.
 *
 * `THE_GATEWAY_TOOK` and `WHAT_THE_REPORT_SAYS` are ten thousand đồng apart,
 * which is the gap somebody has to explain and the reason a discrepancy row
 * exists below.
 */
const THE_GATEWAY_TOOK: VndAmount = 1_450_000n;
const WHAT_THE_REPORT_SAYS: VndAmount = 1_460_000n;
const COUNTED_AT_THE_DESK: VndAmount = 320_000n;
const WIRED_FROM_A_BANK: VndAmount = 2_750_000n;
const NEVER_COMPLETED: VndAmount = 980_000n;
const THE_GATEWAY_REFUSED: VndAmount = 1_100_000n;

const ARRIVAL_DATE = "2027-10-10";
const DEPARTURE_DATE = "2027-10-15";

const GUEST_EMAIL = "khach.doc.thanh.toan@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

/** A route known to be guarded, so a 401 below is the guard running rather than
 *  a path that answers nobody. */
const A_GUARDED_PATH = "/housekeeping/board";

/** A stay id nothing holds, so "no payments for that booking" is a real
 *  absence rather than a malformed request. */
const NO_SUCH_BOOKING = "00000000-0000-4000-8000-000000000000";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the row is asserted against all five. */
const STAFF = {
  MANAGER: {
    email: "quan.ly.thanh.toan@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "le.tan.thanh.toan@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "buong.phong.thanh.toan@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ke.toan.thanh.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "quan.tri.thanh.toan@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

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

/** One payment on file, as this suite needs to name it afterwards. */
interface OnFile {
  readonly id: string;
  readonly folioId: string;
  readonly bookingId: string;
}

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
const tokens = new Map<StaffRole, string>();

/** The stay every gateway payment below was collected for. */
let payingStay: string;
/** A second stay, so a filter on the first has something to leave out. */
let otherStay: string;

/** The gateway payment the disputed night filed a disagreement against. */
let disputed: OnFile;
/** Money the desk counted itself, on an earlier day and under no gateway. */
let inCash: OnFile;
/** A transfer that landed on the disputed day against the other stay. */
let byTransfer: OnFile;
/** An attempt nobody finished — no time of payment, and so no trading day. */
let abandoned: OnFile;
/** An attempt the gateway refused, which is kept rather than deleted. */
let refused: OnFile;
/** The disagreement filed against {@link disputed}. */
let disagreementId: string;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheRecord();

  // Replaced rather than edited — the table holds one row, and the rollover
  // hour every business date below is derived through has to be one this file
  // chose rather than one the environment happened to seed.
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  // The five accounts are created by email and the column is unique, so they
  // have to be the only five — no seed owns this table. The guest realm is
  // emptied for the same reason.
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  await moneyOnFile();
}, 120_000);

afterAll(async () => {
  await clearTheRecord();
  await app?.close();
});

describe("the capability the payment list declares", () => {
  // §4's obligation for the row this route joins. It is a read, so the grant is
  // asked about as a read — a role holding 👁 over the row must reach it, and
  // the declaration is what decides that.
  for (const role of STAFF_ROLES) {
    const admitted = permits(staffGrant("payment.reconcile", role), "read");

    it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
      const response = await as(role).get(paymentsPath());

      expect(response.status).toBe(admitted ? 200 : 403);
    });
  }

  it("sits under the row the reconciliation reads already hold", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that no key
    // was added for this route, and that the row it took is the one governing
    // the property's money as the gateway's side reports it.
    expect(capability("payment.reconcile").row).toBe("Gateway reconciliation");
    expect(capability("payment.reconcile").section).toBe("Folio and money");
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused. The control case is the proof that the
    // guard is installed at all.
    expect((await http().get(A_GUARDED_PATH)).status).toBe(401);
    expect((await http().get(paymentsPath())).status).toBe(401);
  });

  it("refuses a guest holding a real session", async () => {
    // The realm the row denies outright, refused at the guard rather than below
    // it. A real session on purpose: a caller with no cookie is the 401 above,
    // and would prove nothing about the realm.
    const guest = await aSignedInGuest();

    expect((await guest.get(paymentsPath())).status).toBe(403);
  });
});

describe("what the property has been paid", () => {
  it("lists every payment newest first, whole", async () => {
    const response = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

    expect(response.body.total).toBe(5);
    expect(idsOf(response)).toEqual([
      refused.id,
      abandoned.id,
      byTransfer.id,
      inCash.id,
      disputed.id,
    ]);

    // The whole of what a row says about the gateway payment: the property's
    // own ids, the gateway's id for the money it took, the method, the state,
    // the figure and the trading day it moved on.
    expect(rowFor(response, disputed.id)).toEqual({
      id: disputed.id,
      bookingId: payingStay,
      folioId: disputed.folioId,
      method: "VNPAY",
      status: "SUCCESS",
      amount: THE_GATEWAY_TOOK.toString(),
      gatewayTransactionId: "14528901",
      paidAt: middayOn(DISPUTED_DAY).toISOString(),
      businessDate: DISPUTED_DAY,
      discrepancyId: disagreementId,
    });
  });

  it("says the desk's own money moved through no gateway", async () => {
    const response = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

    // Null on both gateway columns, and the method is what tells a reader which
    // case this is. Nothing here is a gateway's vocabulary.
    expect(rowFor(response, inCash.id)).toMatchObject({
      method: "CASH",
      status: "SUCCESS",
      gatewayTransactionId: null,
      amount: COUNTED_AT_THE_DESK.toString(),
      businessDate: EARLIER_DAY,
      discrepancyId: null,
    });
  });

  it("gives money that never moved no trading day at all", async () => {
    const response = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

    // An attempt nobody finished and one the gateway refused. Both are kept —
    // a guest asking why they were not charged is asking about the second — and
    // neither belongs to a night, because there is no instant of payment to
    // date them by.
    expect(rowFor(response, abandoned.id)).toMatchObject({
      status: "PENDING",
      paidAt: null,
      businessDate: null,
    });

    expect(rowFor(response, refused.id)).toMatchObject({
      status: "FAILED",
      paidAt: null,
      businessDate: null,
    });
  });

  it("carries đồng as decimal text rather than as a number", async () => {
    const response = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

    // Asserted against the body as it was sent. Parsing first is where the
    // evidence would be lost: a JSON number and a JSON string of the same
    // digits both come back as something that compares equal once a `Number`
    // has been through them, and the rounding this guards against happens in
    // the parse.
    expect(response.text).toContain(`"amount":"${THE_GATEWAY_TOOK}"`);
    expect(response.text).not.toContain(`"amount":${THE_GATEWAY_TOOK}`);

    for (const row of response.body.payments) {
      expect(typeof row.amount).toBe("string");
      expect(BigInt(row.amount)).toBeGreaterThan(0n);
    }
  });

  it("references the disagreement filed against a payment without restating it", async () => {
    const response = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

    const row = rowFor(response, disputed.id);

    // The id and nothing else about it. The figures, the classification and the
    // instant of the observation are the reconciliation read's answer, and a
    // second copy of them here would be a row that could disagree with the day
    // it came from.
    expect(row.discrepancyId).toBe(disagreementId);
    expect(row).not.toHaveProperty("kind");
    expect(row).not.toHaveProperty("gatewayAmount");
    expect(row).not.toHaveProperty("ledgerAmount");
    expect(row).not.toHaveProperty("observedAt");

    // And the link is enough to get to them: the same id is on the night the
    // sweep filed it against.
    const day = await as("ACCOUNTANT")
      .get(`/payments/reconciliations/${DISPUTED_DAY}`)
      .expect(200);

    expect(
      day.body.discrepancies.find(
        (found: { id: string }) => found.id === disagreementId,
      ),
    ).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      gatewayAmount: WHAT_THE_REPORT_SAYS.toString(),
      ledgerAmount: THE_GATEWAY_TOOK.toString(),
      paymentId: disputed.id,
    });
  });
});

describe("narrowing the list", () => {
  it("filters on the stay the money was collected for", async () => {
    const response = await as("ACCOUNTANT")
      .get(paymentsPath({ bookingId: payingStay }))
      .expect(200);

    expect(idsOf(response).sort()).toEqual(
      [disputed.id, inCash.id, refused.id].sort(),
    );

    // Counted under the same predicate the page was cut from, which is what a
    // count card reads.
    expect(response.body.total).toBe(3);
  });

  it("answers a stay nothing was collected for with an empty page", async () => {
    const response = await as("ACCOUNTANT")
      .get(paymentsPath({ bookingId: NO_SUCH_BOOKING }))
      .expect(200);

    expect(response.body.payments).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it("filters on how the money reached the property", async () => {
    const gateway = await as("ACCOUNTANT")
      .get(paymentsPath({ method: "VNPAY" }))
      .expect(200);

    expect(idsOf(gateway).sort()).toEqual(
      [disputed.id, abandoned.id, refused.id].sort(),
    );

    const desk = await as("ACCOUNTANT")
      .get(paymentsPath({ method: "CASH" }))
      .expect(200);

    expect(idsOf(desk)).toEqual([inCash.id]);
  });

  it("filters on what became of the money", async () => {
    const taken = await as("ACCOUNTANT")
      .get(paymentsPath({ status: "SUCCESS" }))
      .expect(200);

    expect(idsOf(taken).sort()).toEqual(
      [disputed.id, inCash.id, byTransfer.id].sort(),
    );

    const pending = await as("ACCOUNTANT")
      .get(paymentsPath({ status: "PENDING" }))
      .expect(200);

    expect(idsOf(pending)).toEqual([abandoned.id]);
  });

  it("narrows on the method and the state together", async () => {
    // The intersection is the list a person triaging a gateway payment asks
    // for, and it is the case that proves the two dimensions are separate
    // rather than one implying the other.
    const response = await as("ACCOUNTANT")
      .get(paymentsPath({ method: "VNPAY", status: "FAILED" }))
      .expect(200);

    expect(idsOf(response)).toEqual([refused.id]);
  });

  it("filters on the trading day the money moved on", async () => {
    const response = await as("ACCOUNTANT")
      .get(paymentsPath({ businessDate: DISPUTED_DAY }))
      .expect(200);

    // Both payments that moved that night, across two stays and two methods —
    // and nothing that moved on another night or has not moved at all.
    expect(idsOf(response).sort()).toEqual([disputed.id, byTransfer.id].sort());
    expect(response.body.total).toBe(2);

    const earlier = await as("ACCOUNTANT")
      .get(paymentsPath({ businessDate: EARLIER_DAY }))
      .expect(200);

    expect(idsOf(earlier)).toEqual([inCash.id]);
  });

  it("leaves the day's money where the rollover puts it", async () => {
    // Ten minutes before the property rolls over, which is the night audit's
    // own hour: the money belongs to the day that has not finished yet, and a
    // filter reading the calendar date off the instant would file it on the
    // next one. This is the only assertion here that turns on the configured
    // hour, and it is the one the filter exists for.
    const justBeforeRollover = new Date(
      `${QUIET_DAY}T0${CONFIGURED.businessDateRolloverHour - 1}:50:00+07:00`,
    );

    const late = await aPayment({
      folioId: byTransfer.folioId,
      method: "CASH",
      status: "SUCCESS",
      amount: 90_000n,
      paidAt: justBeforeRollover,
      createdAt: justBeforeRollover,
    });

    try {
      const stillYesterday = await as("ACCOUNTANT")
        .get(paymentsPath({ businessDate: EARLIER_DAY }))
        .expect(200);

      expect(idsOf(stillYesterday)).toContain(late.id);

      const notToday = await as("ACCOUNTANT")
        .get(paymentsPath({ businessDate: QUIET_DAY }))
        .expect(200);

      expect(idsOf(notToday)).toEqual([]);

      // And the row says which day it is on, so a screen filtering by one does
      // not have to re-derive the rollover to label what came back.
      const listed = await as("ACCOUNTANT").get(paymentsPath()).expect(200);

      expect(rowFor(listed, late.id).businessDate).toBe(EARLIER_DAY);
    } finally {
      // Removed whatever the assertions do. Every other case in this file
      // counts what the unfiltered list comes back with, and a failure that
      // left this row standing would be reported against the tests that ran
      // next rather than against this one.
      await db.delete(payment).where(eq(payment.id, late.id));
    }
  });

  it("pages without losing the count behind the page", async () => {
    const first = await as("ACCOUNTANT")
      .get(paymentsPath({ limit: 2 }))
      .expect(200);

    expect(idsOf(first)).toEqual([refused.id, abandoned.id]);
    // The figure is the property's payments and not the page's length — which
    // is the whole reason it is counted rather than inferred.
    expect(first.body.total).toBe(5);

    const second = await as("ACCOUNTANT")
      .get(paymentsPath({ limit: 2, offset: 2 }))
      .expect(200);

    expect(idsOf(second)).toEqual([byTransfer.id, inCash.id]);
  });

  it("keeps the count under a day filter about that day", async () => {
    // The filter that finishes its narrowing after the statement, so this is
    // where a page cut before the classification would show: the total would be
    // the coarse range's rather than the night's.
    const response = await as("ACCOUNTANT")
      .get(paymentsPath({ businessDate: DISPUTED_DAY, limit: 1 }))
      .expect(200);

    expect(response.body.payments).toHaveLength(1);
    expect(response.body.total).toBe(2);
  });

  it("refuses a filter that is not one", async () => {
    // Caught by the contract rather than by the query: an id that is not a
    // uuid, a date that does not exist, a page beyond the ceiling and a method
    // this property does not accept are all shapes, and none of them reaches
    // the database.
    expect(
      (await as("ACCOUNTANT").get(paymentsPath({ bookingId: "not-a-uuid" })))
        .status,
    ).toBe(400);

    expect(
      (await as("ACCOUNTANT").get(paymentsPath({ businessDate: "2027-02-31" })))
        .status,
    ).toBe(400);

    expect(
      (await as("ACCOUNTANT").get(paymentsPath({ method: "BITCOIN" }))).status,
    ).toBe(400);

    expect(
      (await as("ACCOUNTANT").get(paymentsPath({ limit: 5_000 }))).status,
    ).toBe(400);
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

/** The call as one member of staff. */
function as(role: StaffRole): request.Agent {
  return request
    .agent(app.getHttpServer())
    .set("Authorization", `Bearer ${tokens.get(role)!}`);
}

function paymentsPath(filters: Record<string, string | number> = {}): string {
  const query = new URLSearchParams(
    Object.entries(filters).map(
      ([key, value]) => [key, String(value)] as [string, string],
    ),
  ).toString();

  return `/payments${query ? `?${query}` : ""}`;
}

const idsOf = (response: { body: { payments: { id: string }[] } }) =>
  response.body.payments.map((row) => row.id);

function rowFor(
  response: { body: { payments: Record<string, unknown>[] } },
  id: string,
): Record<string, unknown> {
  const row = response.body.payments.find((found) => found.id === id);

  if (!row) {
    throw new Error(`No payment ${id} in the answer`);
  }

  return row;
}

/**
 * Midday in the property's own zone, which lands inside the business date it
 * names whatever hour the property rolls at.
 *
 * The rollover is configuration, and a fixture timed near it would be asserting
 * the rollover rather than the filter. The one case that does mean to assert it
 * says so and times itself accordingly.
 */
function middayOn(date: string): Date {
  return new Date(`${date}T12:00:00+07:00`);
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/**
 * A guest who signed up, followed the link out of their inbox and signed in —
 * a session as real as any guest holds.
 */
async function aSignedInGuest(): Promise<request.Agent> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: "Đỗ Thị Lan", email: GUEST_EMAIL, password: GUEST_PASSWORD })
    .expect(200);

  const link = new URL(mailer.linkTo(GUEST_EMAIL));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const guest = request.agent(app.getHttpServer());

  await guest
    .post("/api/auth/sign-in/email")
    .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
    .expect(200);

  const session = await guest.get("/api/auth/get-session").expect(200);

  expect(session.body.user.emailVerified).toBe(true);

  return guest;
}

/**
 * Two stays, an account on each, and the five payments this file reads back.
 *
 * Inserted rather than collected through a gateway: what is being asserted is
 * the read, and driving the rows through a sandbox checkout would make this a
 * suite about VNPay. Every instant is given rather than defaulted, so "newest
 * first" is asserted against times this file chose and not against insertion
 * order.
 */
async function moneyOnFile(): Promise<void> {
  const [type] = await db
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

  payingStay = await aStay(type!.id, "MRV-PAYLIST-0001");
  otherStay = await aStay(type!.id, "MRV-PAYLIST-0002");

  const payingAccount = await anAccount(payingStay);
  const otherAccount = await anAccount(otherStay);

  disputed = await aPayment({
    folioId: payingAccount,
    method: "VNPAY",
    status: "SUCCESS",
    amount: THE_GATEWAY_TOOK,
    attemptReference: DISPUTED,
    gatewayTransactionId: "14528901",
    paidAt: middayOn(DISPUTED_DAY),
    createdAt: middayOn(EARLIER_DAY),
  });

  inCash = await aPayment({
    folioId: payingAccount,
    method: "CASH",
    status: "SUCCESS",
    amount: COUNTED_AT_THE_DESK,
    paidAt: middayOn(EARLIER_DAY),
    createdAt: new Date(`${EARLIER_DAY}T13:00:00+07:00`),
  });

  byTransfer = await aPayment({
    folioId: otherAccount,
    method: "BANK_TRANSFER",
    status: "SUCCESS",
    amount: WIRED_FROM_A_BANK,
    paidAt: middayOn(DISPUTED_DAY),
    createdAt: new Date(`${EARLIER_DAY}T14:00:00+07:00`),
  });

  abandoned = await aPayment({
    folioId: otherAccount,
    method: "VNPAY",
    status: "PENDING",
    amount: NEVER_COMPLETED,
    attemptReference: ABANDONED,
    createdAt: new Date(`${EARLIER_DAY}T15:00:00+07:00`),
  });

  refused = await aPayment({
    folioId: payingAccount,
    method: "VNPAY",
    status: "FAILED",
    amount: THE_GATEWAY_REFUSED,
    attemptReference: REFUSED,
    createdAt: new Date(`${EARLIER_DAY}T16:00:00+07:00`),
  });

  // The night's own record of a figure the two sides did not agree on, and the
  // run row saying somebody looked. The run is here only so that the link a
  // payment carries can be followed to the day it came from — what a night with
  // no run means is `payment-reconciliation-api.e2e-spec.ts`'s assertion, not
  // this file's.
  await db.insert(paymentReconciliationRun).values({
    businessDate: DISPUTED_DAY,
    reconciledAt: new Date(`${DISPUTED_DAY}T21:05:00Z`),
  });

  const [filed] = await db
    .insert(paymentDiscrepancy)
    .values({
      businessDate: DISPUTED_DAY,
      attemptReference: DISPUTED,
      kind: "AMOUNT_MISMATCH",
      gatewayAmount: WHAT_THE_REPORT_SAYS,
      ledgerAmount: THE_GATEWAY_TOOK,
      paymentId: disputed.id,
      observedAt: new Date(`${DISPUTED_DAY}T21:05:00Z`),
    })
    .returning({ id: paymentDiscrepancy.id });

  disagreementId = filed!.id;
}

/** A stay to hang an account on. Nothing below depends on its rates. */
async function aStay(roomTypeId: string, reference: string): Promise<string> {
  const [stay] = await db
    .insert(booking)
    .values({
      reference,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 4_350_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

async function anAccount(bookingId: string): Promise<string> {
  const [account] = await db
    .insert(folio)
    .values({ bookingId })
    .returning({ id: folio.id });

  return account!.id;
}

async function aPayment(
  values: typeof payment.$inferInsert,
): Promise<OnFile> {
  const [written] = await db
    .insert(payment)
    .values(values)
    .returning({ id: payment.id, folioId: payment.folioId });

  const [stay] = await db
    .select({ bookingId: folio.bookingId })
    .from(folio)
    .where(eq(folio.id, written!.folioId));

  return { ...written!, bookingId: stay!.bookingId };
}

/** The payments, the disagreements filed against them and the ledger under
 *  both, emptied. A posting cannot be deleted, so `truncate` is the way back. */
async function clearTheRecord(): Promise<void> {
  await db.execute(
    sql`truncate payment_discrepancy, payment_reconciliation_run, payment, folio_posting, folio restart identity cascade`,
  );
}
