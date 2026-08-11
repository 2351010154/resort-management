// The route the desk calls to open a payment attempt — `FR-PAY-02`, over HTTP
// against a real Postgres, the real capability guard and both realms.
//
// `payment-service.e2e-spec.ts` proves what `createPaymentRequest` does to the
// tables and `payment.controller.spec.ts` proves what the handler hands it.
// Neither can assert what only exists once the route is mounted in the real
// application, and those are what this file is for:
//
// 1. **The route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` rather than off a list written out here — `rbac-matrix.md`
//    §4's own instruction. Anonymous is refused with a 401, which is the
//    difference between "who are you" and "not you". A guest holding a real
//    session is not refused by the guard: the row grants the guest realm `⚠`,
//    so the scope the guard cannot see is left to the handler, and what is
//    asserted here is only that the guard hands the request on.
// 2. **The url the payer is sent to is the gateway's own, and it carries this
//    property's return address.** `vnp_ReturnUrl` is read back out of the
//    signed url, which is the only place the two ends of that string can be
//    compared — the controller builds it from `API_URL`, the adapter signs it,
//    and VNPay is the one who will use it.
// 3. **An attempt is a row before it is an answer.** The `PENDING` payment and
//    the folio it hangs off are read from the tables, because a route that
//    returned a payment url without committing the row would leave every
//    callback about it with nothing to resolve — which is the failure
//    `payment.service.ts` opens with.
// 4. **The service's own refusals reach the caller as refusals.** An amount of
//    nothing or less is a 400 with the sentence the service wrote, not a 500 and
//    not a payment page. The controller adds no check of its own, so this is the
//    assertion that the one in the service is reachable from outside.
//
// The terminal is this file's own and is not a credential: `TERMINAL` and
// `HASH_SECRET` name a merchant that does not exist. `PAYMENT_GATEWAY` is
// rebound to an adapter carrying them the way `payment-callbacks.e2e-spec.ts`
// does, and for the same reason — a suite that ran only where a real VNPay
// account is configured would run nowhere. Building a payment url is local
// computation and nothing here reaches the network.
//
// The ledger and the payments hanging off it are truncated on the way in and on
// the way out. A posting cannot be deleted, and a folio left standing holds a
// booking the next file's fixtures cannot clear.

import "reflect-metadata";

import { createHmac } from "node:crypto";
import type { VndAmount } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ENV, type Env, parseEnv } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import { payment } from "../src/database/schema/payment.js";
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
import { PAYMENT_GATEWAY } from "../src/modules/payment/ports/payment-gateway.port.js";
import { VnpayAdapter } from "../src/modules/payment/vnpay.adapter.js";

const TERMINAL = "MRVTEST2";
const HASH_SECRET = "a-hash-secret-this-file-owns-and-vnpay-has-never-seen";

/** Where the payer comes back to, and the string the answer below is compared
 *  against. The controller builds it; nothing here is told what it is. */
const RETURN_PATH = "/payments/vnpay/return";

/** A route that declares a capability the guard is already known to enforce, so
 *  a 401 below is the guard running rather than a route that does not exist. */
const A_GUARDED_PATH = "/housekeeping/board";

const AMOUNT: VndAmount = 1_200_000n;

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

const GUEST_EMAIL = "khach.thanh.toan@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the row is asserted against all five. */
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

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let apiUrl: string;
let roomTypeId: string;
const tokens = new Map<StaffRole, string>();

// Every case opens a stay of its own, and the reference on it is unique.
// Counted rather than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(new VnpayAdapter(merchantEnv()))
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  apiUrl = app.get<Env>(ENV).API_URL;

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLedger();

  // The five accounts are created by email and the column is unique, so they
  // have to be the only five — no seed owns this table. The guest realm is
  // emptied for the same reason.
  await db.execute(
    sql`truncate room_assignment, booking_night, booking, type_inventory, room, room_type, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

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

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }
}, 120_000);

afterAll(async () => {
  await clearTheLedger();
  await app?.close();
});

describe("the capability the attempt route declares", () => {
  // §4's obligation for the row this route adds. No body is sent — the guard
  // runs before the handler, so an admitted caller answers 400 and a refused one
  // answers 403 either way, and no attempt is opened while the matrix is being
  // asserted.
  for (const role of STAFF_ROLES) {
    const admitted = permits(staffGrant("payment.open-attempt", role), "write");

    it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
      const response = await as(role, await aBooking());

      if (admitted) {
        expect(response.status).not.toBe(403);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it("sits under the section the folio rows sit under", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that the row
    // is the one the route is meant to be under, and not a key some future edit
    // renamed out from under a route that still answers.
    expect(capability("payment.open-attempt").section).toBe("Folio and money");
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused. The control case above it is the proof
    // that the guard is installed at all.
    expect((await http().get(A_GUARDED_PATH)).status).toBe(401);

    const response = await http()
      .post(attemptPath(await aBooking()))
      .send(anAttempt());

    expect(response.status).toBe(401);
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

  it("is handed on by the guard, because the row conditions the realm rather than denying it", async () => {
    // `conditional`, not `denied` — the row grants the guest realm the funnel's
    // payment step subject to the stay being theirs, and `roles.ts` is explicit
    // that a condition the guard cannot see is passed to the handler rather than
    // resolved here. So the assertion is the guard's decision and nothing more.
    //
    // No body, for the reason the role probes above send none: the guard runs
    // first, so an admitted caller is answered by the shape of what arrived and a
    // refused one answers 403 either way — and no attempt is opened while the
    // matrix is being asserted. **The ownership check the grant owes is the
    // guest funnel's own, on the route that sends a payer to the gateway, and it
    // is not written yet**; until it is, this asserts what the matrix says and
    // deliberately does not assert that a stay which is not the caller's is
    // refused, because nothing refuses it.
    const stayId = await aBooking();

    const response = await guest.post(attemptPath(stayId)).send({});

    expect(response.status).not.toBe(403);
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });
});

describe("the attempt the desk opens", () => {
  it("answers with the gateway's url and the property's name for the attempt", async () => {
    const stayId = await aBooking();

    const response = await as("RECEPTIONIST", stayId, anAttempt()).expect(200);

    expect(Object.keys(response.body).sort()).toEqual([
      "paymentUrl",
      "reference",
    ]);

    const url = new URL(response.body.paymentUrl);

    // The gateway's own address, signed by the real adapter with the terminal
    // this file owns — not a string this property composed.
    expect(url.searchParams.get("vnp_TmnCode")).toBe(TERMINAL);
    expect(url.searchParams.get("vnp_SecureHash")).toBeTruthy();

    // The reference is what every callback about this attempt will echo back,
    // which is the whole reason it comes back to the caller.
    expect(url.searchParams.get("vnp_TxnRef")).toBe(response.body.reference);

    // VNPay counts in hundredths of a đồng, and the scaling is the adapter's.
    expect(url.searchParams.get("vnp_Amount")).toBe(String(AMOUNT * 100n));
  });

  it("tells the gateway to send the payer back to the route that receives them", async () => {
    // The one place the two halves of that string can be compared: the
    // controller builds it from `API_URL`, and this reads it back out of the url
    // VNPay will actually use.
    const response = await as(
      "RECEPTIONIST",
      await aBooking(),
      anAttempt(),
    ).expect(200);

    const url = new URL(response.body.paymentUrl);

    expect(url.searchParams.get("vnp_ReturnUrl")).toBe(`${apiUrl}${RETURN_PATH}`);

    // The payer's address, which the gateway screens on. Read off the
    // connection, so over loopback it is loopback — what matters here is that
    // the adapter was given one at all.
    expect(url.searchParams.get("vnp_IpAddr")).toBeTruthy();
  });

  it("commits the attempt before it answers, so a callback has a row to resolve", async () => {
    const stayId = await aBooking();

    const response = await as("RECEPTIONIST", stayId, anAttempt()).expect(200);

    const rows = await attemptsOn(stayId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "PENDING",
      method: "VNPAY",
      amount: AMOUNT,
      attemptReference: response.body.reference,
      // Nothing has been paid, so there is no gateway id and no moment to date.
      gatewayTransactionId: null,
      paidAt: null,
    });
  });

  it("gives one stay as many attempts as it takes", async () => {
    // A payer who abandoned checkout, a card that was declined, a deposit and
    // then the balance. Each is its own row under its own reference, which is
    // what lets a replayed callback resolve to exactly one of them.
    const stayId = await aBooking();

    const first = await as("RECEPTIONIST", stayId, anAttempt()).expect(200);
    const second = await as("ACCOUNTANT", stayId, anAttempt()).expect(200);

    expect(second.body.reference).not.toBe(first.body.reference);
    expect(await attemptsOn(stayId)).toHaveLength(2);
  });

  it("puts nothing on the account, because nobody has paid yet", async () => {
    // The folio is opened — the attempt hangs off it — and it holds no line.
    // A balance that fell when a payment page was opened would be a receipt
    // issued on an intention.
    const stayId = await aBooking();

    await as("RECEPTIONIST", stayId, anAttempt()).expect(200);

    const account = await http()
      .get(`/bookings/${stayId}/folio`)
      .set("Authorization", `Bearer ${tokens.get("RECEPTIONIST")!}`)
      .expect(200);

    expect(account.body.postings).toHaveLength(0);
    expect(account.body.summary.outstanding).toBe("0");
  });
});

describe("what the route will not open an attempt for", () => {
  it("refuses an amount of nothing, in the words the service wrote", async () => {
    // The service's own refusal, reaching the caller. The controller repeats no
    // part of it, so this is what proves the check is reachable from outside —
    // and that it arrives as a 400 somebody can act on rather than as a fault.
    const stayId = await aBooking();

    const response = await as("RECEPTIONIST", stayId, anAttempt({ amount: "0" }));

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("more than nothing");
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });

  it("refuses an amount below nothing", async () => {
    // Handing money back is a refund, and `FR-PAY-04` gives it a route and a
    // capability of its own.
    const stayId = await aBooking();

    const response = await as(
      "RECEPTIONIST",
      stayId,
      anAttempt({ amount: "-1200000" }),
    );

    expect(response.status).toBe(400);
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });

  it("refuses a stay id that is not one", async () => {
    // Caught by the contract rather than by the service, which is the right
    // order: a malformed id is a shape, and the shape is checked at the edge.
    // The service keeps its own refusal for the callers that do not arrive
    // through a contract.
    const response = await as("RECEPTIONIST", "not-a-booking", anAttempt());

    expect(response.status).toBe(400);
  });

  it("refuses an amount that is not a whole number of đồng", async () => {
    const response = await as(
      "RECEPTIONIST",
      await aBooking(),
      anAttempt({ amount: "1200000.50" }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses an attempt with nothing to tell the payer it is for", async () => {
    // The sentence is printed on the gateway's own checkout page, and an empty
    // one is a payment screen that does not say what is being paid.
    const response = await as(
      "RECEPTIONIST",
      await aBooking(),
      anAttempt({ description: "   " }),
    );

    expect(response.status).toBe(400);
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

const attemptPath = (bookingId: string) =>
  `/bookings/${bookingId}/payment-attempts`;

/** The call as one member of staff. */
function as(
  role: StaffRole,
  bookingId: string,
  body: object = {},
): request.Test {
  return http()
    .post(attemptPath(bookingId))
    .set("Authorization", `Bearer ${tokens.get(role)!}`)
    .send(body);
}

/** What the desk sends. The amount travels as decimal text, which is the only
 *  way `money.ts` lets a đồng cross the wire. */
function anAttempt(overrides: Record<string, unknown> = {}): object {
  return {
    amount: AMOUNT.toString(),
    description: "Deposit against the stay",
    ...overrides,
  };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** Every payment row on one stay's account, oldest first. */
async function attemptsOn(
  bookingId: string,
): Promise<(typeof payment.$inferSelect)[]> {
  return await db
    .select(getTableColumns(payment))
    .from(payment)
    .innerJoin(folio, eq(folio.id, payment.folioId))
    .where(eq(folio.bookingId, bookingId))
    .orderBy(payment.createdAt, payment.id);
}

/** A stay to collect against. Inserted rather than booked through the funnel:
 *  nothing here depends on rates, inventory or a hold, and five hundred seeded
 *  stays would put rooms in the way of the rows this file counts. */
async function aBooking(): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYAPI-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** A terminal this file owns, for an adapter that signs for real. */
function merchantEnv(): Env {
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
    STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
    VNPAY_TMN_CODE: TERMINAL,
    VNPAY_SECRET_KEY: HASH_SECRET,
  });
}

/** Both ledger tables and the payments hanging off them, emptied. A posting
 *  cannot be deleted, so `truncate` is the only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(
    sql`truncate payment, folio_posting, folio restart identity cascade`,
  );
}
