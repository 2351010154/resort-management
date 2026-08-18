// A guest's word on a finished stay, over HTTP, against a real Postgres, the
// real capability guard and a real Better Auth session.
//
// The unit specs beside the service prove the two refusals it makes before any
// SQL does, against a stub of the booking lookup. What only exists once there
// are routes and a database is the claim this file is for, and it is a security
// claim as much as a functional one: the matrix marks this row `⚠`, which means
// the guard admits any signed-in guest and the handler is the only thing
// standing between one guest and another's stay. So the refusals are the cases
// that matter.
//
// 1. **A guest rates the stay they took, once it is over.** Written, and read
//    back at the same address — which is what the screen uses to show what was
//    left rather than offering the form a second time.
// 2. **A guest rates nobody else's.** Another account's finished stay is the
//    same `NOT_FOUND` as a reference nobody holds: a reference is eight
//    characters a person can read down a telephone, and a reply that told the
//    two apart would answer which ones the property has issued, one guess at a
//    time. Asserted with the table read afterwards, because a refusal that
//    wrote a row first is not a refusal.
// 3. **A stay that is not over cannot be rated.** A conflict rather than a
//    404 — the stay is the caller's and they can see it, and the same body will
//    be accepted the day after they leave.
// 4. **A stay is rated once.** The second submission is refused and the first
//    survives unchanged, rating and comment both. This is the case a check
//    written in application code gets wrong under a double-tap, and the one the
//    unique index exists for.
//
// Every stay below arrives on the property's own day, which is stopped on a
// Monday inside the seeded calendar: the seed writes minimum stays and closed
// arrivals on weekend nights only, so a Friday arrival would make a refusal mean
// the restriction rather than the state. Arriving today is also what lets the
// desk walk a stay all the way to `CHECKED_OUT` without the clock moving —
// check-in admits a guest on their arrival date, and check-out releases the
// nights they did not sleep.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  CAPABILITY_KEY,
  type CapabilityRequirement,
} from "../src/common/auth/access.decorators.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { feedback } from "../src/database/schema/feedback.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FeedbackController } from "../src/modules/feedback/feedback.controller.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped, and a Monday — so every stay here arrives and
 *  departs on unrestricted nights. */
const TODAY = parseDate("2027-06-07");

/** Two nights of a Deluxe, arriving today. */
const DEPARTURE = TODAY.add({ days: 2 });

/**
 * The Deluxe rooms, in the order `seed.ts` deals them.
 *
 * Named rather than computed: the ten Deluxes follow the twelve Superiors
 * across the four floors, and a room number worked out here from that rule
 * would be a second copy of the seeder's arithmetic that fails as "no such
 * room" the day either changes.
 */
const DELUXE_ROOMS = [
  "303",
  "304",
  "305",
  "306",
  "307",
  "308",
  "309",
  "310",
  "401",
  "402",
];

/** A reference the generator's alphabet allows and no booking here holds. */
const NO_SUCH_REFERENCE = "ZZZZ-ZZZZ";

const RECEPTIONIST = {
  email: "le.tan.feedback@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

const ANH = {
  name: "Anh Nguyễn",
  email: "anh.feedback@example.test",
  password: "correct-horse-battery",
} as const;

const BINH = {
  name: "Bình Trần",
  email: "binh.feedback@example.test",
  password: "battery-horse-correct",
} as const;

/** Captures what would have been sent, so a verification link can be followed
 *  in a test the way a guest follows it out of an inbox. */
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

/** The property's day, stopped — the device every booking suite here uses. */
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
}

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let deskToken: string;
let anh: request.Agent;
let binh: request.Agent;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();

  // What `main.ts` sets on the deployed process, and what makes the holds below
  // separable callers. A cap on how many rooms one caller may hold at once
  // would otherwise count every request in this file as the loopback address.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Before the seed as well as after this file, because `seed.ts`'s wipe deletes
  // bookings and cannot get past a folio — or a piece of feedback — that still
  // names one. A previous run that ended badly would otherwise fail here with a
  // foreign key rather than with anything about this suite.
  await emptyWhatThisFileWrites();

  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  await app.get(StaffUserService).create({ ...RECEPTIONIST });

  deskToken = await signInAsDesk();
  anh = await signedInGuest(ANH);
  binh = await signedInGuest(BINH);
}, 180_000);

afterAll(async () => {
  await emptyWhatThisFileWrites();
  await app?.close();
});

describe("the capability each feedback route declares", () => {
  const reflector = new Reflector();

  it("names the row as a read on the way in", () => {
    // The action is the half worth pinning. Left at the default meant for
    // writes, this route would refuse the two staff roles the matrix hands a 👁
    // over the same row.
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        FeedbackController.prototype.readOwn,
      ),
    ).toEqual({ key: "feedback.submit", action: "read" });
  });

  it("names the row as a write on the way out", () => {
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        FeedbackController.prototype.submit,
      ),
    ).toEqual({ key: "feedback.submit", action: "write" });
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong authority is refused.
    await http().get(feedbackPath(NO_SUCH_REFERENCE)).expect(401);
    await http()
      .post(feedbackPath(NO_SUCH_REFERENCE))
      .send({ rating: 5 })
      .expect(401);
  });
});

describe("the word a guest leaves on their own stay", () => {
  it("is taken once the stay is complete, and reads back at the same address", async () => {
    const stay = await aCheckedOutStay(anh);

    // Nothing left yet, and the screen is told so plainly: a finished stay with
    // no row against it is the one case the form is offered for.
    const before = await anh.get(feedbackPath(stay.reference)).expect(200);

    expect(before.body).toBeNull();

    const written = await anh
      .post(feedbackPath(stay.reference))
      .send({ rating: 5, comment: "The garden room was quiet and the bath was already drawn." })
      .expect(200);

    expect(written.body).toMatchObject({
      reference: stay.reference,
      rating: 5,
      comment: "The garden room was quiet and the bath was already drawn.",
    });

    // A full instant and not a stay date — this is the moment somebody pressed
    // a button, not a day in a place.
    expect(written.body.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const after = await anh.get(feedbackPath(stay.reference)).expect(200);

    expect(after.body).toEqual(written.body);

    // The author is the account the session resolved to, taken off the row
    // rather than off the answer: nothing on the wire carries it, which is what
    // makes filing an opinion in somebody else's name unrepresentable.
    expect(await authorOf(stay.id)).toBe(await accountOf(anh));
  });

  it("takes a rating with nothing written beside it", async () => {
    // The ordinary case rather than a half-filled one. A guest who scores the
    // stay and says nothing has given a complete answer.
    const stay = await aCheckedOutStay(anh);

    const written = await anh
      .post(feedbackPath(stay.reference))
      .send({ rating: 4 })
      .expect(200);

    expect(written.body).toMatchObject({ rating: 4, comment: null });
  });
});

describe("the word a guest tries to leave on somebody else's stay", () => {
  it("is refused the way a reference nobody holds is refused, and writes nothing", async () => {
    const stay = await aCheckedOutStay(anh);

    const refused = await binh
      .post(feedbackPath(stay.reference))
      .send({ rating: 1, comment: "Not my stay at all." });
    const missing = await binh
      .post(feedbackPath(NO_SUCH_REFERENCE))
      .send({ rating: 1, comment: "Not my stay at all." });

    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);

    // Identical in every field, the sentence included, once the reference each
    // caller sent is put back into it. Anything else differing between the two
    // replies would be an oracle over which references the property has issued.
    expect(refused.body).toEqual({
      ...missing.body,
      message: (missing.body.message as string).replace(
        NO_SUCH_REFERENCE,
        stay.reference,
      ),
    });

    // The refusal is worth nothing if the row went in first.
    expect(await rowsOn(stay.id)).toBe(0);

    // And the stay is still open to the guest it belongs to.
    await anh.post(feedbackPath(stay.reference)).send({ rating: 5 }).expect(200);
  });

  it("is refused as a read, so the screen offers a stranger nothing", async () => {
    const stay = await aCheckedOutStay(anh);

    await anh.post(feedbackPath(stay.reference)).send({ rating: 3 }).expect(200);

    await binh.get(feedbackPath(stay.reference)).expect(404);
  });
});

describe("the word a guest tries to leave before the stay has ended", () => {
  it("is refused as a conflict, and writes nothing", async () => {
    const stay = await aConfirmedStay(anh);

    const refused = await anh
      .post(feedbackPath(stay.reference))
      .send({ rating: 5, comment: "Looking forward to it." });

    // A conflict and not a 404: the stay is this guest's and they are looking
    // at it, so hiding the reason would read as the property losing a booking.
    expect(refused.status).toBe(409);

    expect(await rowsOn(stay.id)).toBe(0);
  });

  it("is refused as a read too, which is how the screen knows not to ask", async () => {
    const stay = await aConfirmedStay(anh);

    await anh.get(feedbackPath(stay.reference)).expect(409);
  });
});

describe("a stay somebody has already rated", () => {
  it("refuses the second submission and keeps the first word unchanged", async () => {
    const stay = await aCheckedOutStay(anh);

    const first = await anh
      .post(feedbackPath(stay.reference))
      .send({ rating: 2, comment: "The lift was out on the second morning." })
      .expect(200);

    const again = await anh
      .post(feedbackPath(stay.reference))
      .send({ rating: 5, comment: "On reflection it was fine." });

    expect(again.status).toBe(409);

    // Not "the second was ignored" but "the first still stands": an opinion the
    // property may already have read is not something a later press rewrites.
    expect(await anh.get(feedbackPath(stay.reference)).expect(200)).toMatchObject({
      body: first.body,
    });

    expect(await rowsOn(stay.id)).toBe(1);
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

const feedbackPath = (reference: string) =>
  `/bookings/mine/${reference}/feedback`;

/** A call as the front desk. */
function asDesk(
  method: "get" | "post" | "put",
  path: string,
  body: object = {},
): request.Test {
  return http()
    [method](path)
    .set("Authorization", `Bearer ${deskToken}`)
    .send(body);
}

async function signInAsDesk(): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email: RECEPTIONIST.email, password: RECEPTIONIST.password })
    .expect(200);

  return response.body.accessToken as string;
}

/**
 * A guest realm account with a live session on it.
 *
 * Signed up, verified through the link the mailer captured and signed in — the
 * whole of what a guest does, because the session cookie is what the guard
 * resolves the account from and a fixture that inserted a `guest_user` row would
 * have nothing to send.
 */
async function signedInGuest(who: {
  name: string;
  email: string;
  password: string;
}): Promise<request.Agent> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: who.name, email: who.email, password: who.password })
    .expect(200);

  const link = new URL(mailer.linkTo(who.email));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const agent = request.agent(app.getHttpServer());

  await agent
    .post("/api/auth/sign-in/email")
    .send({ email: who.email, password: who.password })
    .expect(200);

  return agent;
}

/** The account id behind a session, as Better Auth reports it. */
async function accountOf(guest: request.Agent): Promise<string> {
  const session = await guest.get("/api/auth/get-session").expect(200);

  return session.body.user.id as string;
}

/**
 * One address per hold, so this file never meets the cap on how many rooms one
 * caller may hold at once. A browser is a caller, and a suite is not.
 */
let callerOrdinal = 0;

function nextCaller(): string {
  callerOrdinal += 1;

  return `192.0.2.${callerOrdinal}`;
}

/** One Deluxe per stay, handed out in order so a failing run reproduces. */
let roomOrdinal = 0;

function nextRoom(): string {
  const room = DELUXE_ROOMS[roomOrdinal];

  if (!room) {
    throw new Error("this file has taken more stays than it has Deluxes for");
  }

  roomOrdinal += 1;

  return room;
}

/**
 * A stay the funnel took while this guest was signed in, confirmed by the desk.
 *
 * Booked through the route rather than inserted, because the account on the row
 * is precisely what the ownership check reads: a fixture that set the column
 * itself would prove nothing about the path that has to set it.
 */
async function aConfirmedStay(guest: request.Agent): Promise<Stay> {
  const created = await guest
    .post("/bookings/holds")
    .set("X-Forwarded-For", nextCaller())
    .send({
      roomType: "DELUXE",
      checkIn: TODAY.toString(),
      checkOut: DEPARTURE.toString(),
      plan: "STANDARD",
      adults: 2,
      childAges: [],
      contactEmail: "funnel-guest@example.test",
      contactName: "Funnel Guest",
    });

  if (created.status !== 201) {
    throw new Error(`the hold was refused: ${JSON.stringify(created.body)}`);
  }

  const stay: Stay = {
    id: created.body.id as string,
    reference: created.body.reference as string,
  };

  await asDesk("post", `/bookings/${stay.id}/confirmation`).expect(200);

  return stay;
}

/**
 * The same stay, walked to its end by the desk.
 *
 * A room, an arrival and a departure, all on the property's stopped day —
 * check-in admits a guest on their arrival date and check-out gives back the
 * nights they did not sleep, so no clock has to move for a stay to be over.
 *
 * The guest registered is a name and nothing else. A document number here would
 * be one the `guest` table refuses a second stay under, and who slept in the
 * room is not what any of these cases is about.
 */
async function aCheckedOutStay(guest: request.Agent): Promise<Stay> {
  const stay = await aConfirmedStay(guest);

  await asDesk("put", `/bookings/${stay.id}/room`, {
    roomNumber: nextRoom(),
  }).expect(200);

  await asDesk("post", `/bookings/${stay.id}/check-in`, {
    guests: [{ fullName: "Ngô Thị Bích" }],
  }).expect(200);

  const left = await asDesk("post", `/bookings/${stay.id}/check-out`).expect(
    200,
  );

  expect(left.body.state).toBe("CHECKED_OUT");

  return stay;
}

/** How many rows this stay has against it — 0 or 1, and the index allows no
 *  more. Read from the table, because a refusal that wrote first is not one. */
async function rowsOn(bookingId: string): Promise<number> {
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(eq(feedback.bookingId, bookingId));

  return rows.length;
}

/** The account the row is filed under. */
async function authorOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: feedback.userId })
    .from(feedback)
    .where(eq(feedback.bookingId, bookingId));

  return row?.userId;
}

/**
 * The rows this file leaves behind, and only those.
 *
 * `truncate … cascade` rather than a delete: `folio_posting` refuses a `DELETE`
 * outright, the append-only trigger raising on it for every client. Feedback is
 * named first among the tables it reaches, because a booking cannot be truncated
 * while a row here points at it.
 */
async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate feedback, loyalty_ledger, payment, folio_posting, folio, room_assignment, registration, guest, booking_night, booking, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );
}
