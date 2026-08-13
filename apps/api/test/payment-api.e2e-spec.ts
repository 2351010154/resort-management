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
//    difference between "who are you" and "not you".
// 1b. **The guest realm's `⚠` is finished below the guard, and both halves of it
//    are asserted.** The row grants a guest the funnel's payment step subject to
//    the stay being theirs, so the guard admits any signed-in guest and the scope
//    is owed in the service. A guest opens an attempt against their own booking
//    and a row lands; a guest naming another account's stay, a walk-in carrying a
//    null `user_id`, or an id nobody holds is refused with the same 404 and
//    leaves nothing behind. That last part is not decoration — a `PENDING` row
//    behind a rejected call is money the property appears to be waiting for, and
//    `FR-PAY-05`'s sweep would go looking for it at the gateway.
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
import { guestUser } from "../src/database/schema/index.js";
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

/**
 * What every stay below was quoted, and therefore what a guest may open an
 * attempt for.
 *
 * One figure for the fixtures and the requests both, because the guest door
 * takes exactly one: `payment.service.ts` refuses a guest any amount but the
 * stay's frozen total, so a suite whose fixture priced a stay at one number and
 * whose requests sent another would prove only that the refusal fires. The desk
 * is the realm that may send something else, and the case below that does it
 * says so.
 */
const AMOUNT: VndAmount = 1_200_000n;

const ARRIVAL_DATE = "2027-11-02";
const DEPARTURE_DATE = "2027-11-05";

const GUEST_EMAIL = "khach.thanh.toan@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

/**
 * A second guest account, with no session of its own — it exists to own a stay
 * the signed-in guest must not reach.
 *
 * Better Auth's own shape for an id: 32 base-62 characters, not a uuid.
 * `schema/booking.ts` takes `text` for exactly this, and a fixture using a uuid
 * here would pass against a column that could not hold a real account id.
 */
const ANOTHER_ACCOUNT = "7Qw9Lm2Xk4pR8tV1sN6cB3dF5hJ0zY2a";

/** A booking id nothing holds, so "no such stay" is a real absence. */
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
  let guestAccountId: string;

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

    // The session is real, which is what makes both halves below mean
    // something: what separates them is whose stay it is, not whose cookie.
    const session = await guest.get("/api/auth/get-session").expect(200);

    expect(session.body.user.emailVerified).toBe(true);

    guestAccountId = session.body.user.id as string;

    // A second account, with no session of its own. It exists only to own a
    // stay, which is the whole of what "not yours" needs on the other side.
    await db
      .insert(guestUser)
      .values({ id: ANOTHER_ACCOUNT, name: "Bùi Quốc Việt", email: "viet@example.test" });
  });

  it("opens an attempt against the stay they booked", async () => {
    // The half the matrix moved for, and the half that never existed while the
    // row read `denied`: `⚠` is a grant, and a guest paying for their own stay
    // is what it grants. Without this the suite would prove only that guests are
    // refused, which the old denial already did.
    const stayId = await aBooking(guestAccountId);

    const response = await guest.post(attemptPath(stayId)).send(anAttempt());

    expect(response.status).toBe(200);
    expect(new URL(response.body.paymentUrl).searchParams.get("vnp_TmnCode")).toBe(
      TERMINAL,
    );

    // Committed before the answer, exactly as it is for the desk — the guest
    // path reaches the same service method and leaves the same row behind.
    const rows = await attemptsOn(stayId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "PENDING",
      amount: AMOUNT,
      attemptReference: response.body.reference,
    });
  });

  it("is refused a stay that belongs to another account, and opens nothing", async () => {
    // The condition the `⚠` owes, paid. 404 rather than 403 and the same answer
    // a stay that does not exist gets — `payment.service.ts` says why, and it is
    // the line `booking.service.ts` already takes on the routes a guest reaches
    // their own stay by.
    const stayId = await aBooking(ANOTHER_ACCOUNT);

    const response = await guest.post(attemptPath(stayId)).send(anAttempt());

    expect(response.status).toBe(404);

    // Refused before the folio is opened, so nothing is left standing. A
    // `PENDING` row behind a rejected call is money the property would appear to
    // be waiting for, and it would go to the gateway's reconciliation as one.
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });

  it("is refused a stay the desk took, because a walk-in belongs to nobody", async () => {
    // `user_id` is null on every stay the front desk takes, and the scope is a
    // `where` clause — SQL equality never matches a null, so there is no account
    // that could claim one. This is the case a comparison written in TypeScript
    // gets wrong.
    const stayId = await aBooking();

    expect(await accountOn(stayId)).toBeNull();

    const response = await guest.post(attemptPath(stayId)).send(anAttempt());

    expect(response.status).toBe(404);
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });

  it("is refused a stay that does not exist, in the same words", async () => {
    // The other absence, and it has to read the same. A reply that separated
    // "not yours" from "no such stay" would confirm which ids name real stays to
    // a caller holding one they should not have.
    const notMine = await guest
      .post(attemptPath(await aBooking(ANOTHER_ACCOUNT)))
      .send(anAttempt());

    const noSuchStay = await guest
      .post(attemptPath(NO_SUCH_BOOKING))
      .send(anAttempt());

    expect(noSuchStay.status).toBe(404);
    expect(noSuchStay.body).toEqual(notMine.body);
  });

  it("is refused an amount that is not the whole stay, and opens nothing", async () => {
    // The property collects the stay in full before arrival, so there is exactly
    // one figure this door may be opened for. Nothing downstream would catch a
    // smaller one: the callback confirms a paid hold from its *status* and never
    // from its amount, so a guest who could name the figure could pay a thousand
    // đồng and come back holding a gateway success against a confirmed stay.
    const stayId = await aBooking(guestAccountId);

    const response = await guest
      .post(attemptPath(stayId))
      .send(anAttempt({ amount: (AMOUNT / 1000n).toString() }));

    expect(response.status).toBe(400);

    // Refused before the folio is opened, like every other refusal on this door
    // — a `PENDING` row behind a rejected call is money the property would
    // appear to be waiting for.
    expect(await attemptsOn(stayId)).toHaveLength(0);
  });

  describe("paying for the stay they are holding", () => {
    it("is confirmed by the gateway's own callback, over the wire", async () => {
      // The whole journey, through the two routes VNPay actually touches and the
      // one the funnel does. Every other case in this file stops at the attempt;
      // this one carries it through to the money, because the transition it
      // proves has no other door — `booking.confirm` is behind `booking.write`,
      // which no guest holds, so if the callback does not confirm the stay then
      // nothing does and `hold-expiry-sweep.ts` cancels a room that has been
      // paid for.
      //
      // The callback is signed with this file's own terminal secret and verified
      // by the real adapter. Nothing is stubbed between the request and the row.
      const stayId = await aHold(guestAccountId);

      const opened = await guest
        .post(attemptPath(stayId))
        .send(anAttempt())
        .expect(200);

      const reference = opened.body.reference as string;

      // Still a hold, and still owing the money, at the moment the payer leaves.
      expect(await stateOf(stayId)).toBe("HELD");

      const acknowledgement = await http()
        .get("/payments/vnpay/ipn")
        .query(signedCallback(reference, AMOUNT, "77315012"))
        .expect(200);

      // `00` is "received and acted on" — not a verdict on the money, which is
      // what the two rows below are.
      expect(acknowledgement.body).toMatchObject({ RspCode: "00" });

      expect(await stateOf(stayId)).toBe("CONFIRMED");

      // And the TTL is gone with it. A confirmed stay still carrying an expiry is
      // a date the sweep can act on, and what it would do with it is release a
      // room the property has sold.
      expect(await expiryOf(stayId)).toBeNull();

      const account = await http()
        .get(`/bookings/${stayId}/folio`)
        .set("Authorization", `Bearer ${tokens.get("RECEPTIONIST")!}`)
        .expect(200);

      expect(account.body.postings).toHaveLength(1);
      expect(account.body.summary.outstanding).toBe((-AMOUNT).toString());
    });

    it("is confirmed once, however many times the gateway delivers", async () => {
      // `FR-PAY-03`'s idempotency, read through the stay rather than through the
      // payment table. The second delivery must not post a second line, and it
      // must not try the transition again either — `CONFIRMED → CONFIRMED` is
      // legal and idempotent, but a handler reaching it would mean the callback
      // had got past the row that already resolved it.
      const stayId = await aHold(guestAccountId);

      const opened = await guest
        .post(attemptPath(stayId))
        .send(anAttempt())
        .expect(200);

      const callback = signedCallback(
        opened.body.reference as string,
        AMOUNT,
        "77315013",
      );

      await http().get("/payments/vnpay/ipn").query(callback).expect(200);

      const again = await http()
        .get("/payments/vnpay/ipn")
        .query(callback)
        .expect(200);

      // `02` and not `00`: both end the conversation, and `02` is the protocol's
      // own word for a notification about an order already confirmed.
      expect(again.body).toMatchObject({ RspCode: "02" });

      expect(await stateOf(stayId)).toBe("CONFIRMED");

      const account = await http()
        .get(`/bookings/${stayId}/folio`)
        .set("Authorization", `Bearer ${tokens.get("RECEPTIONIST")!}`)
        .expect(200);

      expect(account.body.postings).toHaveLength(1);
    });

    it("leaves the stay where it stands when the gateway refused", async () => {
      // A refusal is filed rather than dropped — a guest asking why they were not
      // charged is asking about that row — and it moves nothing. The hold is
      // still a hold, and its clock is still running.
      const stayId = await aHold(guestAccountId);

      const opened = await guest
        .post(attemptPath(stayId))
        .send(anAttempt())
        .expect(200);

      await http()
        .get("/payments/vnpay/ipn")
        .query(
          signedCallback(
            opened.body.reference as string,
            AMOUNT,
            "77315014",
            "24",
          ),
        )
        .expect(200);

      expect(await stateOf(stayId)).toBe("HELD");
      expect(await expiryOf(stayId)).not.toBeNull();
    });
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

  it("takes an amount that is not the whole stay, which a guest may not", async () => {
    // The other half of the guest refusal above, and the reason it is a realm
    // rule rather than a rule about the number. A desk collects deposits, part
    // payments and balances against one stay — every staff role holds this row
    // `full` — so the figure is the caller's, and scoping it would refuse the
    // ordinary use of the route.
    const stayId = await aBooking();
    const deposit = AMOUNT / 2n;

    const response = await as(
      "RECEPTIONIST",
      stayId,
      anAttempt({ amount: deposit.toString() }),
    ).expect(200);

    const rows = await attemptsOn(stayId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: deposit,
      attemptReference: response.body.reference,
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

/**
 * A stay to collect against. Inserted rather than booked through the funnel:
 * nothing here depends on rates, inventory or a hold, and five hundred seeded
 * stays would put rooms in the way of the rows this file counts.
 *
 * `userId` is the account the stay belongs to, and its default is the ordinary
 * case rather than a convenience — a walk-in carries no account, which is what
 * `schema/booking.ts` keeps the column nullable for and what the guest cases
 * above turn on.
 */
async function aBooking(userId: string | null = null): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYAPI-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      userId,
      roomTypeId,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: AMOUNT,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/**
 * A stay the funnel is still holding, which is what a guest pays for.
 *
 * {@link aBooking} opens a `CONFIRMED` one — the desk's walk-in, and the right
 * fixture for every case about who may open an attempt. The journey cases need
 * the state the transition starts from, and the expiry that goes with it: a
 * `HELD` row without one would violate
 * `booking_hold_expiry_exactly_when_held`, and one already past would be a stay
 * the sweep is entitled to cancel underneath the test.
 */
async function aHold(userId: string): Promise<string> {
  bookingOrdinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PAYHLD-${String(bookingOrdinal).padStart(4, "0")}`,
      state: "HELD",
      holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId,
      roomTypeId,
      checkInDate: ARRIVAL_DATE,
      checkOutDate: DEPARTURE_DATE,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: AMOUNT,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** What state a stay is in now, read out of the table rather than off a reply. */
async function stateOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.state;
}

/** Whether the stay is still counting down, and to when. */
async function expiryOf(bookingId: string): Promise<Date | null> {
  const [row] = await db
    .select({ holdExpiresAt: booking.holdExpiresAt })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.holdExpiresAt ?? null;
}

/**
 * A callback as VNPay sends one, about an attempt this property opened.
 *
 * Signed to the specification rather than by the code under test — the same
 * computation `payment-callbacks.e2e-spec.ts` and `vnpay.adapter.spec.ts` each
 * write out, and repeated here for the reason they both give: a fixture signed
 * by the adapter would prove only that the adapter agrees with itself.
 *
 * `vnp_ResponseCode` and `vnp_TransactionStatus` are set together because only
 * the pair reading `00` is money that moved, and the adapter reads both.
 */
function signedCallback(
  reference: string,
  amount: VndAmount,
  transactionNo: string,
  status = "00",
): Record<string, string> {
  const parameters: Record<string, string> = {
    // VNPay counts in hundredths of a đồng, which is what travels on the wire.
    vnp_Amount: String(amount * 100n),
    vnp_BankCode: "NCB",
    vnp_CardType: "ATM",
    vnp_OrderInfo: "Thanh toan dat phong",
    // 09:10 in Ho Chi Minh City, which is the zone VNPay stamps in.
    vnp_PayDate: "20271102091000",
    vnp_ResponseCode: status,
    vnp_TmnCode: TERMINAL,
    vnp_TransactionNo: transactionNo,
    vnp_TransactionStatus: status,
    vnp_TxnRef: reference,
  };

  const encoded = new URLSearchParams();

  for (const name of Object.keys(parameters).sort()) {
    encoded.append(name, parameters[name]!);
  }

  return {
    ...parameters,
    vnp_SecureHash: createHmac("sha512", HASH_SECRET)
      .update(Buffer.from(encoded.toString(), "utf-8"))
      .digest("hex"),
  };
}

/** The account a stay is filed under, read back out of the table. */
async function accountOn(bookingId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: booking.userId })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.userId ?? null;
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
