// The credential a guest who never signed up carries, over HTTP, against a real
// Postgres and the real capability guard.
//
// `guest-own-booking.e2e-spec.ts` is the same two routes reached with a session.
// This file is the other credential, and every claim here is a security claim:
// the token is a bearer credential that lives in a browser for a week after a
// stay ends, so what matters is the set of things it must not do.
//
// 1. **It opens the stay it was issued for, by either address.** The reference a
//    guest is given and the hold id the funnel's own url carries — the second is
//    what makes `/booking/<hold>/confirming` poll successfully with nothing but
//    the url and the cookie, which is a success criterion of the plan behind
//    this phase.
// 2. **It opens nothing else.** Another guest's stay is refused from the token
//    alone, before any lookup — so the refusal cannot say whether the reference
//    named exists.
// 3. **It is not a session.** Presented on a row it was not minted for — the
//    desk's confirmation, and the stay list that names no booking — it is
//    refused, and the refusal is the guard's rather than a handler's opinion.
// 4. **A session outranks it.** A browser holding both resolves to the session,
//    deterministically, because the session is the wider claim and a credential
//    that could override it would let a signed-in guest act as somebody else.
// 5. **An expired one is refused and names nothing.** The whole point of the
//    refusal being anonymous is that a caller cannot read a booking out of it.
// 6. **The hold is rate-limited, and a refused call reserves nothing.** Asserted
//    against `type_inventory.sold_rooms`, which is the number the property sells
//    from — a limiter that refused after the nights were consumed would be a way
//    to empty the property with requests that all answered 429.
// 7. **No door answers differently for an address that has an account.** Sign-up,
//    password reset and the funnel's hold, all put to an address the property
//    knows and to one it does not.
//
// Every stay arrives on a Monday inside the seeded calendar, for the reason
// `guest-own-booking.e2e-spec.ts` gives: the seed closes weekend arrivals and
// the funnel obeys them, so a Friday would make a refusal mean the restriction.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  CAPABILITY_KEY,
  type CapabilityRequirement,
  SESSION_ONLY_KEY,
} from "../src/common/auth/access.decorators.js";
import { BookingController } from "../src/modules/booking/booking.controller.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { payment } from "../src/database/schema/payment.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { PAYMENT_GATEWAY } from "../src/modules/payment/ports/payment-gateway.port.js";
import { VnpayAdapter } from "../src/modules/payment/vnpay.adapter.js";
import { BookingTokenService } from "../src/modules/auth/booking-token/booking-token.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { HOLD_RATE_LIMIT_POLICY } from "../src/modules/booking/hold-rate-limit.guard.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { ENV, type Env, parseEnv } from "../src/config/env.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped, and a Monday. */
const TODAY = parseDate("2027-06-07");

const MONDAYS = [
  "2027-06-07",
  "2027-06-14",
  "2027-06-21",
  "2027-06-28",
  "2027-07-05",
  "2027-07-12",
  "2027-07-19",
  "2027-07-26",
  "2027-08-02",
  "2027-08-09",
  "2027-08-16",
  "2027-08-23",
  "2027-08-30",
  "2027-09-06",
  "2027-09-13",
  "2027-09-20",
  "2027-09-27",
  "2027-10-04",
  "2027-10-11",
  "2027-10-18",
  "2027-10-25",
  "2027-11-01",
  "2027-11-08",
  "2027-11-15",
  "2027-11-22",
  "2027-11-29",
];

/** Small enough to prove the refusal without taking thirty rooms off the shelf,
 *  and the reason `booking.module.ts` provides the figure rather than hiding it
 *  inside the guard. */
const HOLD_LIMIT = 2;

/** An account the property knows, for the enumeration assertions. */
const REGISTERED = {
  name: "Anh Nguyễn",
  email: "anh@example.test",
  password: "correct-horse-battery",
} as const;

const UNKNOWN_ADDRESS = "nobody-here@example.test";

/** A merchant that does not exist, so building a payment url stays local
 *  computation — the terminal `payment-api.e2e-spec.ts` owns, for its reason. */
const TERMINAL = "MRVTOKEN";
const HASH_SECRET = "a-hash-secret-this-file-owns-and-vnpay-has-never-seen";

const NO_SUCH_REFERENCE = "ZZZZ-ZZZZ";

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

class StoppedClock extends BusinessDateService {
  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return TODAY;
  }
}

interface Stay {
  readonly id: string;
  readonly reference: string;
  /** The browser that took it, cookie jar and all. */
  readonly browser: request.Agent;
}

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let tokens: BookingTokenService;

let mondayOrdinal = 0;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .overrideProvider(HOLD_RATE_LIMIT_POLICY)
    .useValue({ limit: HOLD_LIMIT, windowMs: 10 * 60_000 })
    // The payment door is one of the three rows the credential opens, and a
    // suite that only ran where a real VNPay account is configured would run
    // nowhere.
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(new VnpayAdapter(merchantEnv()))
    .compile();

  app = moduleRef.createNestApplication();

  // What `main.ts` sets on the deployed process, set here for the same reason:
  // the limiter counts callers, and without it every agent in this file shares
  // the loopback address and the first refusal would land on an unrelated case.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  await app.init();

  db = app.get<Database>(DRIZZLE);
  tokens = app.get(BookingTokenService);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await emptyWhatThisFileWrites();
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  await signUp(REGISTERED);
}, 120_000);

afterAll(async () => {
  await emptyWhatThisFileWrites();
  await app?.close();
});

describe("the credential a hold issues", () => {
  it("is an httpOnly cookie scoped to the booking routes", async () => {
    const held = await anAnonymousHold();

    const issued = held.setCookie;

    expect(issued).toMatch(/^mariva_booking=/);
    expect(issued).toContain("HttpOnly");
    expect(issued).toContain("Path=/bookings");

    // Not a session and not readable by page code: the two properties that keep
    // it from being something an injected script can lift and replay.
    expect(issued).not.toContain("mariva_staff_refresh");
  });

  it("opens the stay it names, by the reference the guest was given", async () => {
    const stay = await aStay();

    const response = await stay.browser.get(ownPath(stay.reference)).expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      reference: stay.reference,
      state: "HELD",
      // Nobody signed in behind it, which is the case the whole credential
      // exists for.
      userId: null,
    });
  });

  it("opens the same stay by the hold id the funnel's url carries", async () => {
    // The confirming screen's poll, with nothing but the url and the cookie.
    const stay = await aStay();

    const response = await stay.browser.get(holdPath(stay.id)).expect(200);

    expect(response.body).toMatchObject({ id: stay.id, state: "HELD" });
    expect(response.body.stayTotalGross).toMatch(/^\d+$/);
  });

  it("prices calling off the stay it names, before calling it off", async () => {
    // The quote is under the same row as the read, and it names a stay — so
    // the credential scoped to that stay is proof enough, exactly as it is for
    // the two either side of it. A funnel guest with no account is the caller
    // this route mostly has: they prepaid in full, and what they are asking is
    // how much comes back.
    const stay = await aStay();

    const response = await stay.browser
      .get(`${ownPath(stay.reference)}/cancellation-quote`)
      .expect(200);

    // The figure is `cancellation-calculator.ts`'s and
    // `guest-cancellation-quote.e2e-spec.ts` pins which row fires for which
    // stay. What matters here is that the credential opened it and that both
    // halves of §4's answer came back — the amount alone cannot say what it is.
    expect(response.body).toEqual({
      amount: expect.stringMatching(/^\d+$/),
      basis: expect.any(String),
    });

    // Priced and not applied. A quote that moved the stay would be a
    // cancellation behind a `GET`.
    expect(await stateOf(stay.id)).toBe("HELD");
  });

  it("cancels the stay it names", async () => {
    const stay = await aStay();

    const response = await stay.browser
      .post(cancelPath(stay.reference)).send({})
      .expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      state: "CANCELLED",
      cancellationReason: "GUEST_REQUEST",
    });
  });

  it("records the contact pair the funnel collected", async () => {
    // The address the confirmation goes to, on the booking rather than in a
    // `registration` row — `schema/booking.ts` argues the difference.
    const stay = await aStay();

    const [stored] = await db
      .select({
        contactEmail: booking.contactEmail,
        contactName: booking.contactName,
      })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(stored).toEqual({
      contactEmail: "funnel-guest@example.test",
      contactName: "Funnel Guest",
    });
  });
});

describe("the routes the credential's two rows govern", () => {
  // The guard's ceiling is per row, and a row governs more than one route: five
  // handlers declare these two. Four name a stay and are scoped by it; `listOwn`
  // names none and closes itself to the realm with `@SessionOnly`, which the
  // guard enforces. A sixth added later would be admitted without anyone
  // deciding that, which is the failure the allowlist in `access.guard.ts`
  // prevents one level up and cannot prevent here. So the set is pinned: adding
  // a route under either row fails this until somebody says which of the two
  // kinds it is.
  const STAY_SCOPED = ["readOwn", "readOwnHold", "cancellationQuote", "cancelOwn"];
  const REFUSES_THE_REALM = ["listOwn"];

  it("is exactly the handlers that have been thought about", () => {
    const reflector = new Reflector();
    const handlers = BookingController.prototype as unknown as Record<
      string,
      () => unknown
    >;

    const governed = Object.getOwnPropertyNames(handlers)
      .filter((name) => typeof handlers[name] === "function")
      .filter((name) => {
        const required: CapabilityRequirement | undefined = reflector.get(
          CAPABILITY_KEY,
          handlers[name]!,
        );

        return (
          required?.key === "booking.read-own" ||
          required?.key === "booking.cancel-own"
        );
      })
      .sort();

    expect(governed).toEqual([...STAY_SCOPED, ...REFUSES_THE_REALM].sort());
  });

  it("closes exactly one of them to the realm, and says so on the route", () => {
    // The refusal is a declaration the guard reads, not a comparison inside a
    // handler — so it is visible here, next to the set it narrows. A route that
    // grew a `@SessionOnly` without a reason to fails this, and so does one
    // that lost the one it has.
    const reflector = new Reflector();
    const handlers = BookingController.prototype as unknown as Record<
      string,
      () => unknown
    >;

    const closed = Object.getOwnPropertyNames(handlers)
      .filter((name) => typeof handlers[name] === "function")
      .filter((name) => reflector.get(SESSION_ONLY_KEY, handlers[name]!))
      .sort();

    expect(closed).toEqual(REFUSES_THE_REALM);
  });
});

describe("what the credential will not open", () => {
  it("refuses another stay, by reference and by id alike", async () => {
    const mine = await aStay();
    const theirs = await aStay();

    await mine.browser.get(ownPath(theirs.reference)).expect(403);
    await mine.browser.get(holdPath(theirs.id)).expect(403);
    await mine.browser.post(cancelPath(theirs.reference)).send({}).expect(403);

    // The refusal is worth nothing if the transition ran first.
    expect(await stateOf(theirs.id)).toBe("HELD");
  });

  it("tells a stay that exists from one that does not in the same words", async () => {
    // The refusal comes off the token, before any query — so there is no lookup
    // whose outcome could differ, and a caller walking the reference space
    // learns nothing from either reply.
    const mine = await aStay();
    const theirs = await aStay();

    const real = await mine.browser.get(ownPath(theirs.reference));
    const imaginary = await mine.browser.get(ownPath(NO_SUCH_REFERENCE));

    expect(real.status).toBe(403);
    expect(imaginary.status).toBe(403);
    expect(real.body).toEqual(imaginary.body);
  });

  it("is refused on every row but the two it was minted for", async () => {
    const stay = await aStay();

    // `booking.write` — the desk's confirmation. A guest realm credential on a
    // staff row, which the matrix fixes at 403.
    await stay.browser
      .post(`/bookings/${stay.id}/confirmation`)
      .send({})
      .expect(403);

    // The same row as the two it does open, and still refused: a list that
    // names no stay cannot be answered by a credential scoped to one.
    await stay.browser.get("/bookings/mine").expect(403);
  });

  it("refuses a cancellation a cross-site form could have sent", async () => {
    // The cookie is `sameSite: none` in production — `booking-token.service.ts`
    // says why it has to be — so the browser attaches it to a cross-site form
    // post, and this route's whole input is in the path. `json-request.guard.ts`
    // is the answer the codebase already had for the staff refresh cookie: the
    // three content types a `<form>` can send are refused, so the only way here
    // is a `fetch` that preflights and meets the origin allowlist.
    const stay = await aStay();

    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      await stay.browser
        .post(cancelPath(stay.reference)).send({})
        .set("Content-Type", contentType)
        .send("")
        .expect(401);
    }

    expect(await stateOf(stay.id)).toBe("HELD");

    // And the funnel's own call, which is JSON, still works.
    await stay.browser.post(cancelPath(stay.reference)).send({}).expect(200);
  });

  it("refuses an expired one, and the refusal names no booking", async () => {
    const stay = await aStay();

    const stale = tokens.mint({
      bookingId: stay.id,
      reference: stay.reference,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const refused = await http()
      .get(ownPath(stay.reference))
      .set("Cookie", `mariva_booking=${stale}`)
      .expect(401);

    const said = JSON.stringify(refused.body);

    expect(said).not.toContain(stay.reference);
    expect(said).not.toContain(stay.id);
  });

  it("refuses one whose payload was swapped for another stay's", async () => {
    // The signature of a credential this guest holds, over a payload naming the
    // stay they want. The two do not match, so the guard resolves nobody and
    // the request is anonymous — a 401 on a row that admits no strangers.
    const mine = await aStay();
    const theirs = await aStay();

    const expiresAt = new Date(Date.now() + 60_000);
    const [, signature] = tokens
      .mint({ bookingId: mine.id, reference: mine.reference, expiresAt })
      .split(".");
    const [payload] = tokens
      .mint({ bookingId: theirs.id, reference: theirs.reference, expiresAt })
      .split(".");

    await http()
      .get(ownPath(theirs.reference))
      .set("Cookie", `mariva_booking=${payload}.${signature}`)
      .expect(401);
  });
});

describe("paying for the stay the credential names", () => {
  it("opens a gateway attempt for its own booking", async () => {
    // The funnel is passwordless end to end or it is not passwordless. This is
    // the row that decides which — `rbac-matrix.md` §3's payment attempt — and
    // the scope is the booking rather than an account, because there is no
    // account.
    const stay = await aStay();

    const opened = await stay.browser
      .post(attemptPath(stay.id))
      .send({ amount: "100000", description: `Stay ${stay.reference}` })
      .expect(200);

    expect(opened.body.paymentUrl).toMatch(/^https?:\/\//);
    expect(opened.body.reference).toMatch(/\S/);
  });

  it("refuses an attempt against another stay", async () => {
    const mine = await aStay();
    const theirs = await aStay();

    const before = await attemptsOnFile();

    await mine.browser
      .post(attemptPath(theirs.id))
      .send({ amount: "100000", description: "Not mine to pay for" })
      .expect(403);

    // Refused before anything was written: `mayCollectFor` runs ahead of the
    // folio the attempt would hang off, so there is no pending row for somebody
    // to reconcile later.
    expect(await attemptsOnFile()).toBe(before);
  });
});

describe("a browser carrying both credentials", () => {
  it("is the session, not the token", async () => {
    // Deterministic and written down: the session is the wider claim and names
    // an account the ownership query can be scoped by, so it wins. A token that
    // could override it would let a signed-in guest act as somebody else.
    const stay = await aStay();

    await stay.browser
      .post("/api/auth/sign-in/email")
      .send({ email: REGISTERED.email, password: REGISTERED.password })
      .expect(200);

    // The account has taken no bookings, and the stay in this browser's cookie
    // jar belongs to nobody. Resolved as the session, it is not this account's.
    await stay.browser.get(ownPath(stay.reference)).expect(404);
  });
});

describe("the rate limit in front of the public door", () => {
  it("refuses a caller past its limit and reserves nothing", async () => {
    const arrival = nextMonday();
    const caller = nextCaller();

    for (let taken = 0; taken < HOLD_LIMIT; taken += 1) {
      await http()
        .post("/bookings/holds")
        .set("X-Forwarded-For", caller)
        .send(aHoldBody(nextMonday()))
        .expect(201);
    }

    const before = await soldOn(arrival);

    // Twice, because a limiter that counted its own refusals as allowances
    // would let every second call through.
    await refusedHold(caller, arrival);
    await refusedHold(caller, arrival);

    // The guard runs before the transaction, so a refused call has priced
    // nothing, consumed no night and spent no reference.
    expect(await soldOn(arrival)).toBe(before);

    // Another address is unaffected — the limit is per caller and not a switch
    // that closes the funnel.
    await http()
      .post("/bookings/holds")
      .set("X-Forwarded-For", nextCaller())
      .send(aHoldBody(arrival))
      .expect(201);
  });
});

describe("no door tells a caller which addresses have accounts", () => {
  it("answers sign-up the same for a known address and an unknown one", async () => {
    const known = await http()
      .post("/api/auth/sign-up/email")
      .send({
        name: "Someone Else",
        email: REGISTERED.email,
        password: "another-password-entirely",
      });

    const unknown = await http().post("/api/auth/sign-up/email").send({
      name: "Someone Else",
      email: `fresh-${Date.now()}@example.test`,
      password: "another-password-entirely",
    });

    expect(known.status).toBe(unknown.status);
  });

  it("answers a password reset the same either way", async () => {
    const known = await http()
      .post("/api/auth/request-password-reset")
      .send({ email: REGISTERED.email, redirectTo: "/reset" });

    const unknown = await http()
      .post("/api/auth/request-password-reset")
      .send({ email: UNKNOWN_ADDRESS, redirectTo: "/reset" });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it("answers the hold the same either way", async () => {
    // The new door, held to the rule the other two already keep. A funnel that
    // said "you have an account, sign in" would be the property's first
    // enumeration oracle, and it would be on the one page every stranger reaches.
    const known = await http()
      .post("/bookings/holds")
      .set("X-Forwarded-For", nextCaller())
      .send({ ...aHoldBody(nextMonday()), contactEmail: REGISTERED.email });

    const unknown = await http()
      .post("/bookings/holds")
      .set("X-Forwarded-For", nextCaller())
      .send({ ...aHoldBody(nextMonday()), contactEmail: UNKNOWN_ADDRESS });

    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);

    // The stay is filed under nobody in both cases: a typed address is not a
    // sign-in, and attaching the booking to an account whose owner did not
    // authenticate would hand it to whoever typed the address.
    expect(known.body.userId).toBeNull();
    expect(unknown.body.userId).toBeNull();
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

const ownPath = (reference: string) => `/bookings/mine/${reference}`;

const cancelPath = (reference: string) => `${ownPath(reference)}/cancellation`;

const holdPath = (bookingId: string) => `/bookings/holds/${bookingId}`;

const attemptPath = (bookingId: string) =>
  `/bookings/${bookingId}/payment-attempts`;

/** This file's own terminal, and the two secrets the realms already require. */
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

function nextMonday(): string {
  const monday = MONDAYS[mondayOrdinal];

  if (!monday) {
    throw new Error("this file has booked more stays than it has Mondays for");
  }

  mondayOrdinal += 1;

  return monday;
}

/** Two nights of a Deluxe with somebody to write to — the funnel's own body. */
function aHoldBody(arrival: string): object {
  return {
    roomType: "DELUXE",
    checkIn: arrival,
    checkOut: parseDate(arrival).add({ days: 2 }).toString(),
    plan: "STANDARD",
    adults: 2,
    childAges: [],
    contactEmail: "funnel-guest@example.test",
    contactName: "Funnel Guest",
  };
}

/**
 * A hold taken by a browser nobody is signed in on, keeping the jar it was
 * handed.
 *
 * Each stay gets its own agent, and its own address: the limiter is per caller,
 * and one agent taking every stay in this file would meet it part-way through.
 */
async function anAnonymousHold(): Promise<
  Stay & { readonly setCookie: string }
> {
  const browser = request.agent(app.getHttpServer());
  const created = await browser
    .post("/bookings/holds")
    .set("X-Forwarded-For", nextCaller())
    .send(aHoldBody(nextMonday()));

  if (created.status !== 201) {
    throw new Error(`the hold was refused: ${JSON.stringify(created.body)}`);
  }

  const setCookie = created.headers["set-cookie"]?.[0];

  if (!setCookie) {
    throw new Error("the hold issued no credential");
  }

  return {
    id: created.body.id as string,
    reference: created.body.reference as string,
    browser,
    setCookie,
  };
}

const aStay = anAnonymousHold;

/** One address per hold, so this file never meets its own limiter. */
let callerOrdinal = 0;

function nextCaller(): string {
  callerOrdinal += 1;

  return `198.51.100.${callerOrdinal}`;
}

/** A hold this caller is past their allowance for. */
async function refusedHold(caller: string, arrival: string): Promise<void> {
  await http()
    .post("/bookings/holds")
    .set("X-Forwarded-For", caller)
    .send(aHoldBody(arrival))
    .expect(429);
}

/** An account the property knows, verified — the fixture the enumeration
 *  assertions compare against. */
async function signUp(who: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: who.name, email: who.email, password: who.password })
    .expect(200);

  const link = new URL(mailer.linkTo(who.email));

  await http().get(`${link.pathname}${link.search}`).expect(302);
}

/** Every gateway attempt on file — the number a refused call must not move. */
async function attemptsOnFile(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(payment);

  return row?.count ?? 0;
}

async function stateOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.state;
}

/** What the property has sold of the Deluxe on one night — the number a refused
 *  call must leave alone. */
async function soldOn(stayDate: string): Promise<number> {
  const [row] = await db
    .select({ sold: typeInventory.soldRooms })
    .from(typeInventory)
    .innerJoin(roomType, eq(typeInventory.roomTypeId, roomType.id))
    .where(and(eq(roomType.code, "DELUXE"), eq(typeInventory.stayDate, stayDate)));

  if (!row) {
    throw new Error(`the calendar has no Deluxe inventory for ${stayDate}`);
  }

  return row.sold;
}

async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate loyalty_ledger, payment, folio_posting, folio, room_assignment, booking_night, booking, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );
}
