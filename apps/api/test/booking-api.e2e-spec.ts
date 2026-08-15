// The booking API, end to end — the routes `booking-state-machine.md` §2 and §5
// describe, over HTTP, against a real Postgres and the real capability guard.
//
// What this suite is about is the half of the system no service test can reach.
// `booking-lifecycle.e2e-spec.ts`, `check-in-out.e2e-spec.ts`, `no-show.e2e-spec.ts`,
// `room-assignment.e2e-spec.ts` and `stay-length.e2e-spec.ts` already assert the
// transitions, the guards and the inventory effects by calling the services
// directly. None of them can assert that a receptionist is refused a waiver, that
// a `CalendarDate` leaves as nine characters, or that a refusal code survives the
// trip to a front-desk screen — those are facts about the routes, and they only
// become true when there are routes.
//
// So three things are asserted here and the business rules are not re-asserted:
//
// 1. **Every route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` itself rather than off a list written out here. `rbac-matrix.md`
//    §4 asks for exactly that — "make the test data-driven off a single exported
//    table so they cannot drift" — and it is the reason a role's grant is looked
//    up per route instead of being spelled beside it.
// 2. **The wire crossings hold.** A stay date is ISO text, a hold expiry is an
//    instant, an amount is decimal text, and a party survives the round trip.
// 3. **A refusal arrives as something the desk can branch on** — the code in
//    `data`, which is what `booking-refusal.ts` exists for and what the contract's
//    declared errors type. An illegal transition carries no code and must still
//    be a 409, because the two share the status.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { call } from "@orpc/server";
import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { guest } from "../src/database/schema/guest.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { BookingController } from "../src/modules/booking/booking.controller.js";
import {
  capability,
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import {
  type CapabilityAction,
  permits,
} from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";

const SEED_FROM = parseDate("2027-06-01");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";

// The property's day, and every stay below is placed against it. Arriving on the
// business date is the walk-in this system exists to take, which is what makes
// one narrative able to book, check in and check out without the clock moving.
const TODAY = parseDate("2027-06-10");
const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";
const LATER_DEPARTURE = "2027-06-15";

const A_GUEST = {
  fullName: "Đỗ Thị Lan",
  cccdNumber: "079301009876",
  nationality: "VN",
} as const;

/**
 * The stay itself, which is what both creating routes are about.
 *
 * Two adults and no child, because a `SUPERIOR` sleeps two — `property.ts` §1 —
 * and a party above the maximum is refused rather than priced. The room numbers
 * below are the ones that type takes, which is why the walk-through is booked
 * against it and the party that carries a child is booked against a `PREMIER`.
 */
const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL,
  checkOut: DEPARTURE,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

/**
 * The same stay as a funnel states it — with somebody to send the confirmation
 * to.
 *
 * The pair is required at the hold's door and absent from the desk's, which is
 * `contract/booking.ts`'s split rather than this fixture's convenience: a
 * walk-in is standing at the counter and has nowhere to be written to. So the
 * two bodies are two constants, and a test posting the wrong one to either route
 * fails on the shape rather than on something further in.
 */
const A_HELD_STAY = {
  ...A_STAY,
  contactEmail: "held-stay@example.test",
  contactName: "Held Stay",
} as const;

const GUEST_EMAIL = "booking-owner@example.test";
const GUEST_PASSWORD = "correct-horse-booking-owner";

/** Captures the verification link a guest follows before signing in. */
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

/**
 * The property's day, stopped — the device every booking suite here uses.
 *
 * The hour and the zone stay the real service's; only the instant it reads is
 * fixed. Without it the arrival window guard would be asked about a stay in 2027
 * from whatever day the suite happens to run on.
 */
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

/** One account per staff role, because the matrix is asserted against all five. */
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

/**
 * Every booking route, with the matrix row it declares.
 *
 * The row is what the assertion is driven off — never a list of roles written
 * beside it — so a route whose declaration is changed without the document
 * moving fails here rather than passing quietly.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post" | "put";
  readonly path: (bookingId: string) => string;
  readonly capability: CapabilityKey;
  /** What the route does with the row. Defaults to the decorator's own default,
   *  which is `write` — see `access.decorators.ts` for why that is the safe
   *  half of forgetting it. */
  readonly action?: CapabilityAction;
}[] = [
  {
    name: "createHold",
    method: "post",
    path: () => "/bookings/holds",
    capability: "booking.create-own",
  },
  {
    name: "createConfirmed",
    method: "post",
    path: () => "/bookings",
    capability: "booking.write",
  },
  {
    name: "confirm",
    method: "post",
    path: (id) => `/bookings/${id}/confirmation`,
    capability: "booking.write",
  },
  {
    name: "cancel",
    method: "post",
    path: (id) => `/bookings/${id}/cancellation`,
    capability: "booking.cancel-policy",
  },
  {
    name: "cancelWithWaiver",
    method: "post",
    path: (id) => `/bookings/${id}/cancellation-waiver`,
    capability: "booking.cancel-waiver",
  },
  {
    name: "checkIn",
    method: "post",
    path: (id) => `/bookings/${id}/check-in`,
    capability: "booking.check-in",
  },
  {
    name: "checkOut",
    method: "post",
    path: (id) => `/bookings/${id}/check-out`,
    capability: "booking.check-out",
  },
  {
    name: "markNoShow",
    method: "post",
    path: (id) => `/bookings/${id}/no-show`,
    capability: "booking.mark-no-show",
  },
  {
    name: "reinstate",
    method: "post",
    path: (id) => `/bookings/${id}/reinstatement`,
    capability: "booking.reinstate-no-show",
  },
  {
    name: "assignRoom",
    method: "put",
    path: (id) => `/bookings/${id}/room`,
    capability: "booking.assign-room",
  },
  {
    name: "moveRoom",
    method: "post",
    path: (id) => `/bookings/${id}/room-moves`,
    capability: "booking.assign-room",
  },
  {
    name: "changeRoomType",
    method: "put",
    path: (id) => `/bookings/${id}/room-type`,
    capability: "booking.write",
  },
  {
    name: "extendStay",
    method: "put",
    path: (id) => `/bookings/${id}/departure`,
    capability: "booking.extend-stay",
  },
  {
    name: "shortenStay",
    method: "post",
    path: (id) => `/bookings/${id}/early-departure`,
    capability: "booking.early-checkout",
  },
  {
    // The desk's resend. Not a transition and not a change to the stay — it
    // mails the account link to the address on the booking — but it is governed
    // by a row like everything else, and this is where that is asserted for
    // every role at once.
    name: "resendAccountLink",
    method: "post",
    path: (id) => `/bookings/${id}/account-links`,
    capability: "booking.resend-account-link",
  },
  // The guest's own. Every staff role is denied both rows, so what these lines
  // assert is the cross-realm direction `rbac-matrix.md` §4 calls
  // non-negotiable: a staff token on a guest route is refused, and refused by
  // the guard rather than by the handler's ownership check. `guest-own-booking.e2e-spec.ts`
  // asserts the other side, with a real session on each of two accounts.
  //
  // Two of them answer `501` to a caller the guard admits, because their shapes
  // are frozen ahead of the service work behind them. That is why the admitted
  // branch of the loop below asserts what a route is *not* rather than what it
  // is: the declaration is what is under test here, and a stub declares one.
  {
    name: "readOwn",
    method: "get",
    path: () => `/bookings/mine/${NO_SUCH_REFERENCE}`,
    capability: "booking.read-own",
    action: "read",
  },
  {
    name: "readOwnHold",
    method: "get",
    path: (id) => `/bookings/holds/${id}`,
    capability: "booking.read-own",
    action: "read",
  },
  {
    name: "listOwn",
    method: "get",
    path: () => "/bookings/mine",
    capability: "booking.read-own",
    action: "read",
  },
  {
    name: "cancellationQuote",
    method: "get",
    path: () => `/bookings/mine/${NO_SUCH_REFERENCE}/cancellation-quote`,
    capability: "booking.read-own",
    action: "read",
  },
  {
    name: "cancelOwn",
    method: "post",
    path: () => `/bookings/mine/${NO_SUCH_REFERENCE}/cancellation`,
    capability: "booking.cancel-own",
  },
];

/** A booking id nothing holds, so no route below can succeed by accident. */
const NO_SUCH_BOOKING = "00000000-0000-4000-8000-000000000000";

/** The same, for the routes a guest addresses by reference rather than by id. */
const NO_SUCH_REFERENCE = "ZZZZ-ZZZZ";

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let mailer: RecordingMailer;
const tokens = new Map<StaffRole, string>();

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays. Every room named below has to be free on the nights
  // named below, and five hundred random holds would decide otherwise.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // The one row the seed's wipe deliberately leaves behind. `seed.ts` says why —
  // "a person is not owned by one stay" — and it is right, but it makes a
  // check-in fixture carrying a CCCD run exactly once: `guest_cccd_number_key`
  // refuses the second, and `guest.service.ts` turns that into the 409 that
  // tells a desk to use the record the property already has. Cleared by the
  // number this suite owns rather than by emptying the table, and after the
  // wipe rather than before it, since the registrations naming this person go
  // in that step.
  await db.delete(guest).where(eq(guest.cccdNumber, A_GUEST.cccdNumber));

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
});

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A call as one member of staff. */
function as(
  role: StaffRole,
  method: "get" | "post" | "put",
  path: string,
  body: object = {},
): request.Test {
  return http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`)
    .send(body);
}

/** A guest whose cookie resolves through the real Better Auth session path. */
async function aVerifiedGuest(): Promise<{
  readonly agent: request.Agent;
  readonly userId: string;
}> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({
      name: "Anh Nguyễn",
      email: GUEST_EMAIL,
      password: GUEST_PASSWORD,
    })
    .expect(200);

  const link = new URL(mailer.linkTo(GUEST_EMAIL));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const agent = request.agent(app.getHttpServer());

  await agent
    .post("/api/auth/sign-in/email")
    .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
    .expect(200);

  const session = await agent.get("/api/auth/get-session").expect(200);

  return { agent, userId: session.body.user.id as string };
}

describe("account attribution at the booking controller boundary", () => {
  let guestSession: Awaited<ReturnType<typeof aVerifiedGuest>>;

  beforeAll(async () => {
    guestSession = await aVerifiedGuest();
  });

  it("files a guest's HTTP booking under the session account", async () => {
    const response = await guestSession.agent
      .post("/bookings/holds")
      .send({
        ...A_HELD_STAY,
        checkIn: "2028-05-01",
        checkOut: "2028-05-03",
      })
      .expect(201);

    const [stored] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, response.body.id as string));

    expect(stored?.userId).toBe(guestSession.userId);
  });

  it("does not file a staff HTTP booking under the staff account", async () => {
    const response = await as("RECEPTIONIST", "post", "/bookings/holds", {
      ...A_HELD_STAY,
      checkIn: "2028-05-08",
      checkOut: "2028-05-10",
    }).expect(201);

    const [stored] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, response.body.id as string));

    expect(stored?.userId).toBeNull();
  });

  it("keeps a null principal anonymous at the concrete handler", async () => {
    const controller = app.get(BookingController);
    // The request is the handler's second collaborator, and it is here for two
    // fields. The address is the one the hold is counted against — named rather
    // than left empty so this case cannot be the one that shares a caller key
    // with another, since the concurrent-hold cap counts by it. The headers are
    // where the handler looks for the booking cookie naming a hold this browser
    // is moving off; empty is the honest fixture for a caller that holds none.
    const request = {
      ip: "198.51.100.203",
      headers: {},
      socket: {},
    } as unknown as Request;
    // The response is the third: the hold issues the booking-scoped cookie on
    // it. Captured rather than stubbed away, so a handler that stopped issuing
    // one would show up here as well.
    const issued: [string, string, object][] = [];
    const response = {
      cookie: (name: string, value: string, options: object) => {
        issued.push([name, value, options]);
      },
    } as unknown as Response;

    const created = await call(controller.createHold(null, request, response), {
      ...A_HELD_STAY,
      checkIn: "2028-05-15",
      checkOut: "2028-05-17",
      childAges: [],
    });

    const [stored] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, created.id));

    expect(stored?.userId).toBeNull();

    // Anonymous on the row and still handed the credential for the stay: that
    // is the whole of the funnel's answer to a guest with no account.
    expect(issued).toHaveLength(1);
    expect(issued[0]?.[0]).toBe("mariva_booking");
  });
});

describe("the capability each booking route declares", () => {
  // §4's obligation, discharged for the rows M4's routes add: every role is put
  // to every route, and the expectation is read off the matrix rather than
  // written down twice. A body is deliberately not sent — the guard runs before
  // the handler, so an admitted caller answers 400 or 404 and a refused one
  // answers 403 either way, and no route can succeed and leave a booking behind.
  for (const route of ROUTES) {
    // A row marked public admits everybody, and its role columns describe what a
    // screen should offer rather than a wall — `rbac-matrix.md`'s own note, and
    // the reason the guard checks this before it compares any grant. Reading the
    // flag off the matrix rather than naming the route keeps this true when the
    // next row is opened.
    const isPublic = capability(route.capability).unauthenticated;

    for (const role of STAFF_ROLES) {
      // ⚠ satisfies a write and 👁 does not, which is `permits`' whole job —
      // asked here rather than spelled out, so the read route below is held to
      // the same rule as the writes without this file restating it.
      const admitted =
        isPublic ||
        permits(staffGrant(route.capability, role), route.action ?? "write");

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(
          role,
          route.method,
          route.path(NO_SUCH_BOOKING),
        );

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session, except on a public row", async () => {
    // 401 and not 403 — `rbac-matrix.md`'s own note on the implementation: a
    // guest session on a staff row is refused, and nobody at all is asked to
    // sign in.
    //
    // The hold is the exception, and it is the whole point of the row: a visitor
    // books before they have an account, so the guard admits them and the empty
    // body is refused by the schema instead. Asserting that it is *not* 401 is
    // the claim worth making here — the status it does get is a fact about the
    // body this loop deliberately does not send.
    for (const route of ROUTES) {
      const response = await http()
        [route.method](route.path(NO_SUCH_BOOKING))
        .send({});

      if (capability(route.capability).unauthenticated) {
        expect(response.status, route.name).not.toBe(401);
        continue;
      }

      expect(response.status, route.name).toBe(401);
    }
  });
});

describe("a stay taken at the desk and walked to check-out", () => {
  let bookingId: string;

  it("is created CONFIRMED, with the dates and the total on the wire", async () => {
    const response = await as(
      "RECEPTIONIST",
      "post",
      "/bookings",
      A_STAY,
    ).expect(201);

    bookingId = response.body.id;

    expect(response.body).toMatchObject({
      state: "CONFIRMED",
      roomType: "SUPERIOR",
      // Nine characters, not an object of loose numbers — the crossing
      // `stay-date.ts` declares and the controller performs.
      checkIn: ARRIVAL,
      checkOut: DEPARTURE,
      plan: "STANDARD",
      adults: 2,
      childAges: [],
      cancellationReason: null,
      // A walk-in is confirmed by the person taking it, so there is no TTL for a
      // sweep to act on — `booking_hold_expiry_exactly_when_held`.
      holdExpiresAt: null,
    });

    // A reference the desk can read out — `FR-BOOK-01`, and the key `M7` routes
    // a guest's own booking on.
    expect(response.body.reference).toMatch(/\S/);

    // Decimal text, per `money.ts`: a folio total in đồng need not fit in a
    // double, and a number that silently loses its last digits is worse than
    // one that never arrives.
    expect(BigInt(response.body.stayTotalGross)).toBeGreaterThan(0n);
  });

  it("takes a room", async () => {
    const response = await as("RECEPTIONIST", "put", `/bookings/${bookingId}/room`, {
      roomNumber: SUPERIOR,
    }).expect(200);

    expect(response.body).toMatchObject({
      bookingId,
      roomNumber: SUPERIOR,
      checkIn: ARRIVAL,
      checkOut: DEPARTURE,
    });
  });

  it("moves the guest into another room", async () => {
    // §5's second row, and the only reason it is exercised here rather than left
    // to `room-assignment.e2e-spec.ts`: a move and an assignment are two routes
    // behind one capability row, and a routing table that reached the wrong
    // service method would pass every test that never made the call.
    await as("RECEPTIONIST", "post", `/bookings/${bookingId}/check-in`, {
      guests: [A_GUEST],
    }).expect(200);

    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/room-moves`,
      { roomNumber: ANOTHER_SUPERIOR },
    ).expect(200);

    expect(response.body).toMatchObject({
      roomNumber: ANOTHER_SUPERIOR,
      checkIn: ARRIVAL,
      checkOut: DEPARTURE,
    });
  });

  it("extends the stay, and answers with the total the added nights are in", async () => {
    const response = await as(
      "RECEPTIONIST",
      "put",
      `/bookings/${bookingId}/departure`,
      { checkOut: LATER_DEPARTURE },
    ).expect(200);

    expect(response.body).toMatchObject({
      bookingId,
      checkOut: LATER_DEPARTURE,
      nightsAdded: 2,
    });

    expect(BigInt(response.body.stayTotalGross)).toBeGreaterThan(0n);
    expect(response.body.assignment.roomNumber).toBe(ANOTHER_SUPERIOR);
  });

  it("takes an early departure, and prices it without storing the number", async () => {
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/early-departure`,
      { checkOut: DEPARTURE },
    ).expect(200);

    expect(response.body).toMatchObject({
      bookingId,
      checkOut: DEPARTURE,
      nightsReleased: 2,
    });

    // §4's grid on a refundable plan: the remaining nights at 50%, and a basis
    // saying which row fired — the number alone cannot, since a free
    // cancellation and a departure on the final night are both zero.
    expect(response.body.charge.basis).toBe("REMAINING_NIGHTS_HALF");
    expect(BigInt(response.body.charge.amount)).toBeGreaterThanOrEqual(0n);
  });

  it("checks out, and answers the same way to a repeated request", async () => {
    const first = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/check-out`,
    ).expect(200);

    expect(first.body.state).toBe("CHECKED_OUT");

    // §4's idempotency row, over HTTP. A double-clicked button and a retried
    // request both arrive as the transition that already happened, and 409 here
    // would make a caller that did nothing wrong retry forever.
    const again = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/check-out`,
    ).expect(200);

    expect(again.body.state).toBe("CHECKED_OUT");
  });

  it("refuses an illegal transition as a 409 carrying no refusal code", async () => {
    // §2 closes `CHECKED_OUT → CONFIRMED`. The route declares no error for this
    // one, and it must still be a 409 rather than a fault — the declared
    // check-in refusals share the status, and a client switching on the code
    // simply finds none here.
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/confirmation`,
    ).expect(409);

    expect(response.body.data?.code).toBeUndefined();
  });
});

describe("a hold from the public funnel", () => {
  let holdId: string;

  it("carries the expiry a sweep acts on, and the party it was quoted for", async () => {
    // A `PREMIER`, because this is the party with a child in it and that type
    // sleeps three. The ages travel as ages and not as a head count, which is
    // `FR-PRC-04`'s three bands surviving the round trip — a count could only
    // ever have been quoted as an adult.
    const response = await as("RECEPTIONIST", "post", "/bookings/holds", {
      ...A_HELD_STAY,
      roomType: "PREMIER",
      checkIn: "2027-07-01",
      checkOut: "2027-07-03",
      childAges: [7],
    }).expect(201);

    holdId = response.body.id;

    expect(response.body).toMatchObject({
      state: "HELD",
      roomType: "PREMIER",
      adults: 2,
      childAges: [7],
    });

    // An instant and not a stay date: a TTL is a moment, and a hold taken at
    // 14:00 dies twenty minutes later — a question no calendar date answers.
    expect(Date.parse(response.body.holdExpiresAt)).not.toBeNaN();
  });

  it("drops the expiry when it is confirmed", async () => {
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${holdId}/confirmation`,
    ).expect(200);

    expect(response.body).toMatchObject({
      state: "CONFIRMED",
      holdExpiresAt: null,
    });
  });

  it("is cancelled with a reason, and refuses the sweep's own", async () => {
    // `HOLD_EXPIRED` is the TTL job's — a desk sending it would file a guest's
    // change of mind as an abandoned cart, and §4's grid prices the two
    // differently. Refused by the schema, so it is a 400 naming the field.
    await as("RECEPTIONIST", "post", `/bookings/${holdId}/cancellation`, {
      reason: "HOLD_EXPIRED",
    }).expect(400);

    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${holdId}/cancellation`,
      { reason: "GUEST_REQUEST" },
    ).expect(200);

    expect(response.body).toMatchObject({
      state: "CANCELLED",
      cancellationReason: "GUEST_REQUEST",
    });
  });
});

describe("a refusal the front desk branches on", () => {
  it("names the reason a check-in was refused in the error's data", async () => {
    // Arriving on the business date, so §4's arrival window passes and the
    // refusal below is the one being asked about. The order is not incidental:
    // §4 lists the window first because a stay that is a day early is refused
    // for being early rather than for a room nobody has picked yet.
    const created = await as("RECEPTIONIST", "post", "/bookings", A_STAY).expect(
      201,
    );

    // §4's room requirement. The booking holds no room, which is the one refusal
    // reachable without arranging a housekeeping status — and it is a refusal
    // the desk acts on by opening the room grid rather than by reading prose.
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${created.body.id}/check-in`,
      { guests: [{ fullName: "Bùi Quốc Việt" }] },
    ).expect(409);

    expect(response.body.data.code).toBe("ROOM_NOT_ASSIGNED");
  });

  it("still refuses an illegal transition on the same route, with no code", async () => {
    // The case the declared errors could have broken. `checkIn` types its
    // `CONFLICT` as carrying a `CheckInRefusal`, and §2 also refuses this
    // transition outright — from `CANCELLED`, where there is no guard to name a
    // refusal. That error has no `data` to match the declaration, and it has to
    // stay a 409 rather than become a fault on the way out.
    const created = await as("RECEPTIONIST", "post", "/bookings", {
      ...A_STAY,
      checkIn: "2027-10-01",
      checkOut: "2027-10-03",
    }).expect(201);

    await as("RECEPTIONIST", "post", `/bookings/${created.body.id}/cancellation`, {
      reason: "GUEST_REQUEST",
    }).expect(200);

    const response = await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${created.body.id}/check-in`,
      { guests: [{ fullName: "Ngô Thanh Hà" }] },
    ).expect(409);

    expect(response.body.data?.code).toBeUndefined();
  });

  it("refuses a stay that departs before it arrives, as a 400", async () => {
    // The schema's, not a service's: half-open [checkIn, checkOut) is what makes
    // two back-to-back stays in one room simply not overlap, and a reversed pair
    // is a request nothing downstream should have to interpret.
    await as("RECEPTIONIST", "post", "/bookings", {
      ...A_STAY,
      checkIn: DEPARTURE,
      checkOut: ARRIVAL,
    }).expect(400);
  });

  it("answers 404 for a booking nobody holds", async () => {
    await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${NO_SUCH_BOOKING}/check-out`,
    ).expect(404);
  });
});

describe("the waiver a receptionist may not grant", () => {
  it("cancels at the manager's authority and not the desk's", async () => {
    const created = await as("RECEPTIONIST", "post", "/bookings", {
      ...A_STAY,
      checkIn: "2027-09-01",
      checkOut: "2027-09-03",
    }).expect(201);

    const bookingId = created.body.id as string;

    // `rbac-matrix.md` §2: policy and override are separate endpoints with
    // separate roles, never one endpoint with an amount check. This is that
    // sentence as a status code.
    await as(
      "RECEPTIONIST",
      "post",
      `/bookings/${bookingId}/cancellation-waiver`,
      { reason: "STAFF_ERROR" },
    ).expect(403);

    await as("MANAGER", "post", `/bookings/${bookingId}/cancellation-waiver`, {
      reason: "STAFF_ERROR",
    }).expect(200);

    const [row] = await db
      .select({ state: booking.state, reason: booking.cancellationReason })
      .from(booking)
      .where(eq(booking.id, bookingId))
      .limit(1);

    expect(row).toEqual({ state: "CANCELLED", reason: "STAFF_ERROR" });
  });
});
