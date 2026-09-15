// Attaching a stay to an account, over HTTP, against a real Postgres and the
// real capability guard.
//
// `guest-attach.spec.ts` is the same flow at the service boundary. This file is
// the half that only exists over the wire — a browser, its cookie jar, and what
// each door leaves in it. Five claims:
//
// 1. **The stay page is neutral.** The same booking, read before and after its
//    contact address gains an account, answers byte for byte the same thing.
//    This is a security property rather than a nicety: a hold is unauthenticated
//    and only rate-limited, so anyone can create one naming a victim's address,
//    receive a booking cookie **without paying**, and read the answer off the
//    page. The branch belongs in the mail, which reaches only the address being
//    asked about.
// 2. **The account-creating door is rate limited.** Better Auth's own limiter
//    lives in its router and never runs for a Nest route, so this one carries
//    its own — and a door that creates accounts without a limit is a door that
//    creates accounts without a limit.
// 3. **The mailed link signs the browser in — and only when it made the
//    account.** A new account holds nothing but the booking that same link just
//    attached, so a session over it opens nothing the link did not. An account
//    that already existed holds a great deal more, and still asks for a sign-in.
// 4. **A signed-in guest attaches by holding both credentials.** The session
//    proves the account and the booking cookie proves the stay. Neither alone is
//    enough, and afterwards the cookie opens nothing — including the one door
//    that reads it without opening a stay at all, where naming a hold is how a
//    guest comparing rooms puts the last one back.
// 5. **The mailed stay link re-issues the cookie**, once.
//
// Every stay arrives on a Monday inside the seeded calendar, for the reason the
// other funnel suites give: the seed closes weekend arrivals and the funnel
// obeys them, so a Friday would make a refusal mean the restriction.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BookingTokenService } from "../src/modules/auth/booking-token/booking-token.service.js";
import { ACCOUNT_LINK_RATE_LIMIT_POLICY } from "../src/modules/auth/guest/account-link-rate-limit.guard.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { HOLD_RATE_LIMIT_POLICY } from "../src/modules/booking/hold-rate-limit.guard.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

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
];

/** How many account-link redemptions one caller gets here. Small, so the
 *  refusal is provable without creating five accounts. */
const ACCOUNT_LINK_LIMIT = 2;

const PASSWORD = "correct-horse-battery-staple";

/** Distinguishes this run's accounts from whatever an earlier one left: the
 *  guest tables are Better Auth's and this file does not truncate them. */
const RUN = Date.now().toString(36);

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
  readonly browser: request.Agent;
}

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let tokens: BookingTokenService;

let mondayOrdinal = 0;
let callerOrdinal = 0;
let addressOrdinal = 0;

function http() {
  return request(app.getHttpServer());
}

function nextMonday(): StayDate {
  mondayOrdinal += 1;

  const monday = MONDAYS[mondayOrdinal % MONDAYS.length];

  return parseDate(monday!);
}

/** One address per hold, so this file never meets the funnel's own limiter. */
function nextCaller(): string {
  callerOrdinal += 1;

  return `203.0.113.${callerOrdinal}`;
}

function nextAddress(): string {
  addressOrdinal += 1;

  return `attach-${addressOrdinal}-${RUN}@example.test`;
}

function aHoldBody(arrival: StayDate) {
  return {
    roomType: "DELUXE" satisfies RoomTypeCode,
    checkIn: arrival.toString(),
    checkOut: arrival.add({ days: 2 }).toString(),
    plan: "STANDARD",
    adults: 2,
    childAges: [] as number[],
  };
}

/** A hold taken by a browser nobody is signed in on, keeping its cookie jar. */
async function anAnonymousHold(): Promise<Stay> {
  const browser = request.agent(app.getHttpServer());
  const created = await browser
    .post("/bookings/holds")
    .set("X-Forwarded-For", nextCaller())
    .send(aHoldBody(nextMonday()));

  if (created.status !== 201) {
    throw new Error(`the hold was refused: ${JSON.stringify(created.body)}`);
  }

  return {
    id: created.body.id as string,
    reference: created.body.reference as string,
    browser,
  };
}

/** The hold, with somebody named to write to about it. */
async function aHoldFor(address: string): Promise<Stay> {
  const stay = await anAnonymousHold();

  await stay.browser
    .put(`/bookings/holds/${stay.id}/contact`)
    .send({ contactEmail: address, contactName: "Nguyễn An" })
    .expect(200);

  return stay;
}

/** An account, verified the ordinary way — through the mail Better Auth sends. */
async function signUp(address: string): Promise<void> {
  await http()
    .post("/api/auth/sign-up/email")
    .set("X-Forwarded-For", nextCaller())
    .send({ name: "Nguyễn An", email: address, password: PASSWORD })
    .expect(200);

  const link = new URL(mailer.linkTo(address));

  await http().get(`${link.pathname}${link.search}`).expect(302);
}

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .overrideProvider(HOLD_RATE_LIMIT_POLICY)
    .useValue({ limit: 30, windowMs: 10 * 60_000 })
    .overrideProvider(ACCOUNT_LINK_RATE_LIMIT_POLICY)
    .useValue({ limit: ACCOUNT_LINK_LIMIT, windowMs: 60_000 })
    .compile();

  app = moduleRef.createNestApplication();

  // What `main.ts` sets on the deployed process, and what both limiters here
  // read the caller off. Without it every agent shares the loopback address.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  await app.init();

  db = app.get<Database>(DRIZZLE);
  tokens = app.get(BookingTokenService);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking restart identity cascade`,
  );
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });
}, 120_000);

afterAll(async () => {
  await db?.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking restart identity cascade`,
  );
  await app?.close();
});

describe("the stay page and the address it was booked with", () => {
  it("answers identically before and after that address has an account", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);

    const beforeAccount = await stay.browser.get(`/bookings/holds/${stay.id}`);
    const beforeByReference = await stay.browser.get(
      `/bookings/mine/${stay.reference}`,
    );

    await signUp(address);

    const afterAccount = await stay.browser.get(`/bookings/holds/${stay.id}`);
    const afterByReference = await stay.browser.get(
      `/bookings/mine/${stay.reference}`,
    );

    const oracle =
      "The stay page branches on whether the contact address has an account. " +
      "A hold is unauthenticated and only rate-limited, so anyone can take one " +
      "naming somebody else's address, get a booking cookie without paying, " +
      "and read the answer off this page. The branch belongs in the mail.";

    expect(afterAccount.status, oracle).toBe(beforeAccount.status);
    expect(JSON.stringify(afterAccount.body), oracle).toBe(
      JSON.stringify(beforeAccount.body),
    );

    expect(afterByReference.status, oracle).toBe(beforeByReference.status);
    expect(JSON.stringify(afterByReference.body), oracle).toBe(
      JSON.stringify(beforeByReference.body),
    );

    // And the account did not quietly take the booking either: signing up is
    // not attaching, and a stay filed under an account nobody asked to file it
    // under would be a guest's history rewritten by somebody else's sign-up.
    expect(afterAccount.body.userId).toBeNull();
  });
});

describe("the door that creates an account from a mailed link", () => {
  it("creates the account, verified, and hands the stay to it", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);
    const link = await tokens.mintAccountLink(db, { bookingId: stay.id });

    const redeemed = await http()
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", nextCaller())
      .send({ link, password: PASSWORD })
      .expect(201);

    expect(redeemed.body).toEqual({
      bookingId: stay.id,
      reference: stay.reference,
      // The session this same response set the cookies for, named in the body
      // so the page that follows the link knows whether it may carry the guest
      // on to a profile only a session opens.
      signedIn: true,
    });

    // The account it created can sign in at once, which is the whole of what
    // `emailVerified` buys: `requireEmailVerification` is on, so an unverified
    // account would be refused here.
    await http()
      .post("/api/auth/sign-in/email")
      .set("X-Forwarded-For", nextCaller())
      .send({ email: address, password: PASSWORD })
      .expect(200);

    // No second verification mail. The confirmation was the verification.
    expect(mailer.sent.filter((sent) => sent.to === address)).toHaveLength(0);
  });

  it("signs the browser in, so a guest who set no password reaches the stay", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);
    const link = await tokens.mintAccountLink(db, { bookingId: stay.id });

    await stay.browser
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", nextCaller())
      .send({ link })
      .expect(201);

    const session = await stay.browser.get("/api/auth/get-session").expect(200);

    expect(
      session.body?.user?.email,
      "The link made this account and it holds one booking — the one the same " +
        "link has just attached to it, so a session over it opens nothing the " +
        "link did not. Without one, a guest who declined the optional password " +
        "is locked out of the stay they claimed a second ago.",
    ).toBe(address);

    const own = await stay.browser
      .get(`/bookings/mine/${stay.reference}`)
      .expect(200);

    expect(own.body.reference).toBe(stay.reference);

    // And it is the session doing that reading. The anonymous credential still
    // in this jar was given up by the attach, and signing the guest in did not
    // hand it back — the case that redeems on a browser nobody signed in is
    // what shows the same cookie opening nothing.
    const [row] = await db
      .select({ anonAccessRevokedAt: booking.anonAccessRevokedAt })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(row!.anonAccessRevokedAt).not.toBeNull();
  });

  it("leaves an address that already had an account to prove itself", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);

    // Registered between the confirmation being sent and its link being
    // followed. The stay still attaches — but to an account holding history,
    // personal details and whatever else has accrued to it, none of which this
    // link proved anything about.
    await signUp(address);

    const link = await tokens.mintAccountLink(db, { bookingId: stay.id });

    const redeemed = await stay.browser
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", nextCaller())
      .send({ link })
      .expect(201);

    expect(
      redeemed.headers["set-cookie"],
      "A mailed link has signed a browser into an account that existed before " +
        "it. Only a sign-in speaks for what that account already holds.",
    ).toBeUndefined();

    expect(
      redeemed.body.signedIn,
      "And the reply has to say so. A page told nothing sends this guest on " +
        "to a profile their browser cannot open, past the sentence offering " +
        "them the log-in the older account needs.",
    ).toBe(false);
  });

  it("refuses the cookie that used to open the stay it just attached", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);
    const link = await tokens.mintAccountLink(db, { bookingId: stay.id });

    await http()
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", nextCaller())
      .send({ link })
      .expect(201);

    // The browser still holds the credential the hold issued. It opens nothing
    // now: the stay has an owner, and a loose copy of an anonymous cookie is a
    // second key to a door that has one.
    await stay.browser.get(`/bookings/holds/${stay.id}`).expect(404);
  });

  it("refuses a caller past its own rate limit", async () => {
    const caller = nextCaller();

    for (let spent = 0; spent < ACCOUNT_LINK_LIMIT; spent += 1) {
      // A link this deployment never signed: refused by the handler, and
      // counted by the guard in front of it, which is the point.
      await http()
        .post("/bookings/account-links/redemption")
        .set("X-Forwarded-For", caller)
        .send({ link: "not-a-link.not-a-signature" })
        .expect(401);
    }

    const refused = await http()
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", caller)
      .send({ link: "not-a-link.not-a-signature" });

    expect(
      refused.status,
      "Better Auth's rate limiter runs in its own router's request hook and " +
        "never sees a Nest route, so this door has to carry its own. Without " +
        "one it creates accounts without limit.",
    ).toBe(429);
  });

  it("is refused a second time on the same link", async () => {
    const stay = await aHoldFor(nextAddress());
    const link = await tokens.mintAccountLink(db, { bookingId: stay.id });
    const caller = nextCaller();

    await http()
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", caller)
      .send({ link })
      .expect(201);

    await http()
      .post("/bookings/account-links/redemption")
      .set("X-Forwarded-For", caller)
      .send({ link })
      .expect(401);
  });
});

describe("the signed-in guest holding their own booking", () => {
  it("attaches the stay their cookie names, and no other", async () => {
    const address = nextAddress();
    const stay = await aHoldFor(address);
    const somebodyElse = await anAnonymousHold();

    await signUp(address);

    await stay.browser
      .post("/api/auth/sign-in/email")
      .set("X-Forwarded-For", nextCaller())
      .send({ email: address, password: PASSWORD })
      .expect(200);

    // The stay this browser's credential does not name, asked for first: a
    // route that trusted the path would attach any booking whose id a
    // signed-in guest could guess.
    await stay.browser
      .post(`/bookings/${somebodyElse.id}/attachment`)
      .send({})
      .expect(403);

    const attached = await stay.browser
      .post(`/bookings/${stay.id}/attachment`)
      .send({})
      .expect(200);

    expect(attached.body.id).toBe(stay.id);
    expect(attached.body.userId).not.toBeNull();

    const [row] = await db
      .select({
        userId: booking.userId,
        anonAccessRevokedAt: booking.anonAccessRevokedAt,
      })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(row!.userId).toBe(attached.body.userId);
    expect(row!.anonAccessRevokedAt).not.toBeNull();

    // The stay is still the guest's — through the session now, which is the
    // half revocation must not touch.
    await stay.browser.get(`/bookings/mine/${stay.reference}`).expect(200);
  });

  it("leaves the attached stay alone when the surrendered cookie takes a new hold", async () => {
    // Attaching a stay does not pay for it, so the room is still `HELD` — and
    // the funnel releases a `HELD` room whose id the caller's cookie names and
    // whose caller digest matches. The digest is of the address, so a household,
    // an office or a hotel lobby behind one router satisfies it. What must not
    // satisfy it is a credential the guest gave up when the stay gained an
    // owner: otherwise the next person on that wifi, holding the copy left in a
    // shared browser, takes any room at all and the guest's stay is released.
    const address = nextAddress();
    const caller = nextCaller();
    const browser = request.agent(app.getHttpServer());

    const created = await browser
      .post("/bookings/holds")
      .set("X-Forwarded-For", caller)
      .send(aHoldBody(nextMonday()))
      .expect(201);

    const claimed = created.body.id as string;
    const surrendered = created.headers["set-cookie"]![0]!.split(";")[0]!;

    await browser
      .put(`/bookings/holds/${claimed}/contact`)
      .send({ contactEmail: address, contactName: "Nguyễn An" })
      .expect(200);

    await signUp(address);

    await browser
      .post("/api/auth/sign-in/email")
      .set("X-Forwarded-For", nextCaller())
      .send({ email: address, password: PASSWORD })
      .expect(200);

    await browser.post(`/bookings/${claimed}/attachment`).send({}).expect(200);

    const lifted = request.agent(app.getHttpServer());

    const theirs = await lifted
      .post("/bookings/holds")
      .set("X-Forwarded-For", caller)
      .set("Cookie", surrendered)
      .send(aHoldBody(nextMonday()))
      .expect(201);

    expect(theirs.body.id).not.toBe(claimed);

    const [row] = await db
      .select({
        state: booking.state,
        cancellationReason: booking.cancellationReason,
      })
      .from(booking)
      .where(eq(booking.id, claimed));

    expect(
      row,
      "A stay somebody had just added to their account was released by the " +
        "credential they gave up to add it, on the strength of a shared " +
        "address and a cookie left in a browser.",
    ).toEqual({ state: "HELD", cancellationReason: null });
  });

  it("is refused when only the booking cookie arrives", async () => {
    const stay = await aHoldFor(nextAddress());

    // No session. `guest.profile` is not a row a booking token opens, so the
    // guard refuses before the handler runs — both credentials are required and
    // a guard can only insist on one.
    await stay.browser
      .post(`/bookings/${stay.id}/attachment`)
      .send({})
      .expect(403);
  });
});

describe("the mailed stay link", () => {
  it("hands a browser holding nothing the credential for one stay, once", async () => {
    const stay = await aHoldFor(nextAddress());
    const link = await tokens.mintStayLink(db, {
      bookingId: stay.id,
      checkOut: new Date("2028-01-01T00:00:00+07:00"),
    });

    const elsewhere = request.agent(app.getHttpServer());

    const opened = await elsewhere
      .post("/bookings/stay-links/redemption")
      .send({ link })
      .expect(200);

    expect(opened.body).toEqual({
      bookingId: stay.id,
      reference: stay.reference,
    });
    expect(opened.headers["set-cookie"]?.[0]).toMatch(/^mariva_booking=/);

    // The browser that never took the hold now reads the stay.
    await elsewhere.get(`/bookings/holds/${stay.id}`).expect(200);

    // And the link is spent. A mailbox is copied, forwarded and left open.
    await request(app.getHttpServer())
      .post("/bookings/stay-links/redemption")
      .send({ link })
      .expect(401);
  });
});
