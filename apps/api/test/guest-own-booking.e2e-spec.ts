// The two routes a guest reaches their own stay through — `FR-GST-01`'s read
// and the cancellation beside it — over HTTP, against a real Postgres, the real
// capability guard and a real Better Auth session.
//
// `guest-account-link.e2e-spec.ts` proves the column and the `where` clause by
// calling the service. What only exists once there are routes is the claim this
// file is for, and it is a security claim rather than a functional one: the two
// rows are `⚠` in `rbac-matrix.md`, which means the guard admits any signed-in
// guest and the handler is the only thing standing between one guest and
// another's booking. So the cases that matter are the refusals.
//
// 1. **A guest reaches their own stay by the handle they were given.** The
//    reference and not the uuid — a guest never sees the second one.
// 2. **A guest reaches nobody else's.** Another account's stay and a reference
//    nobody holds are one answer, deliberately: a reference is eight characters
//    a person can read down a phone, and a reply that told the two apart would
//    answer which ones the property has issued, one guess at a time.
// 3. **A walk-in belongs to nobody.** `user_id` is null on every stay the desk
//    takes, and this is the case a comparison written in TypeScript gets wrong —
//    `null` and `undefined` are both falsy, and one careless `==` hands a guest
//    a stranger's stay. Asserted against a booking read out of the table with
//    the null confirmed, so the fixture cannot pass by being the wrong shape.
// 4. **The guest's cancellation is priced exactly as the desk's is.** Two stays
//    over the same nights, one called off by its guest and one by a
//    receptionist, then `folio.refund-policy` applied to both: the charge and
//    the row of `property-and-tariff.md` §4 it names must match. Which row fires
//    is deliberately not pinned — it turns on the wall clock against §4's 18:00
//    deadline, and `folio-refunds.e2e-spec.ts` gives that argument — but
//    *whichever* fires, it has to fire the same way on both paths, and that is
//    the whole of "the guest pays the policy".
//
// Every stay below arrives on a Monday inside the seeded calendar. The seed
// writes minimum stays and closed arrivals on weekend nights only and the funnel
// obeys them, so a Friday arrival would make a refusal mean the restriction
// rather than the account.

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
import { booking } from "../src/database/schema/booking.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BookingController } from "../src/modules/booking/booking.controller.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped, and a Monday — so every fixture below can
 *  arrive on or after it without falling on a restricted weekend night. */
const TODAY = parseDate("2027-06-07");

/**
 * Mondays inside the seeded calendar, one stay each.
 *
 * Named rather than computed from an ordinal, so a date that drifts onto a
 * restricted night is visible here instead of surfacing as a refusal nobody
 * expected.
 */
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
];

/** A reference the generator's alphabet allows and no booking here holds. */
const NO_SUCH_REFERENCE = "ZZZZ-ZZZZ";

/** A uuid no stay has — well-formed, so the route refuses it on the lookup
 *  rather than on the shape. */
const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

const RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

const ANH = {
  name: "Anh Nguyễn",
  email: "anh@example.test",
  password: "correct-horse-battery",
} as const;

const BINH = {
  name: "Bình Trần",
  email: "binh@example.test",
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

/** One Monday per stay, handed out in order so a failing run reproduces. */
let mondayOrdinal = 0;

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

  // Before the seed as well as after this file, because `seed.ts`'s wipe deletes
  // bookings and cannot get past a folio that still names one. A previous run
  // that ended badly would otherwise fail here with a foreign key rather than
  // with anything about this suite.
  await emptyWhatThisFileWrites();

  // No synthetic stays: every claim here is about one booking answering to one
  // account, and five hundred random holds would put rooms in the way.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  const staff = app.get(StaffUserService);

  await staff.create({ ...RECEPTIONIST });
  deskToken = await signInAsDesk();

  anh = await signedInGuest(ANH);
  binh = await signedInGuest(BINH);
}, 120_000);

afterAll(async () => {
  // The next file to run seeds, and its wipe cannot delete a booking a folio
  // names or an account a booking names. Neither is that seed's to own.
  await emptyWhatThisFileWrites();
  await app?.close();
});

describe("the capability each of the guest's routes declares", () => {
  const reflector = new Reflector();

  it("names the read row, as a read", () => {
    // The action is the half worth pinning. `access.decorators.ts` defaults it to
    // `write` because that is the safe half of forgetting it, and forgetting it
    // here would refuse any role the matrix later hands a 👁 over a guest's own
    // record — a receptionist looking up the booking a caller is reading out.
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        BookingController.prototype.readOwn,
      ),
    ).toEqual({ key: "booking.read-own", action: "read" });
  });

  it("names the read row for the hold the funnel carries, as a read", () => {
    // The same row and the same action as the read above, because it is the
    // same act named a different way — the funnel's url carries the hold id
    // where a guest reading their stay back carries the reference.
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        BookingController.prototype.readOwnHold,
      ),
    ).toEqual({ key: "booking.read-own", action: "read" });
  });

  it("names the cancellation row, as a write", () => {
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        BookingController.prototype.cancelOwn,
      ),
    ).toEqual({ key: "booking.cancel-own", action: "write" });
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong authority is refused.
    await http().get(ownPath(NO_SUCH_REFERENCE)).expect(401);
    await http().get(holdPath(NO_SUCH_ID)).expect(401);
    await http().post(cancelPath(NO_SUCH_REFERENCE)).send({}).expect(401);
  });
});

describe("the hold the funnel is standing on", () => {
  it("answers to the id the funnel was given when it took the hold", async () => {
    // The address `/booking/<hold>/details` and the two steps after it carry —
    // `repository-structure.md` §`(booking)`. Without this the funnel could not
    // survive a refresh: the stay, its total and its state would be whatever
    // the tab was still holding.
    const stay = await aGuestStay(anh);

    const response = await anh.get(holdPath(stay.id)).expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      reference: stay.reference,
      state: "HELD",
    });

    // The figure the payment step opens its attempt for, and the reason the
    // screen reads the stay rather than trusting a number in the url.
    expect(response.body.stayTotalGross).toMatch(/^\d+$/);
  });

  it("is not another guest's to read, and says so the same way as an id nobody holds", async () => {
    const stay = await aGuestStay(anh);

    const refused = await binh.get(holdPath(stay.id));
    const missing = await binh.get(holdPath(NO_SUCH_ID));

    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);

    // Identical in every field, the sentence included — and here it is
    // identical outright rather than after a substitution, because the refusal
    // names no id back. There is nothing for a caller trying ids to read.
    expect(refused.body).toEqual(missing.body);
  });

  it("is unreachable when the desk took the stay, because a walk-in belongs to nobody", async () => {
    const walkIn = await aWalkIn();

    expect(await accountOn(walkIn.id)).toBeNull();

    await anh.get(holdPath(walkIn.id)).expect(404);
  });

  it("still answers once the stay has stopped being a hold", async () => {
    // The screen that reads this route is waiting for exactly that moment —
    // `confirming/` polls until the gateway's callback has confirmed the stay.
    // A route that answered only a `HELD` booking would refuse at the instant
    // its caller was waiting for.
    const stay = await aGuestStay(anh);

    await confirm(stay.id);

    const response = await anh.get(holdPath(stay.id)).expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      reference: stay.reference,
      state: "CONFIRMED",
    });
  });
});

describe("the stay a guest booked", () => {
  it("answers to the reference the guest was given", async () => {
    const stay = await aGuestStay(anh);

    const response = await anh.get(ownPath(stay.reference)).expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      reference: stay.reference,
      state: "HELD",
      roomType: "DELUXE",
      adults: 2,
      childAges: [],
    });

    // The account the funnel filed it under, back on the wire. This is the
    // column the ownership check compares against, so a route that answered
    // without it would be untestable from here.
    expect(response.body.userId).toMatch(/\S/);

    // Nine characters, not an object of loose numbers — the crossing
    // `stay-date.ts` declares and the controller performs.
    expect(response.body.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is not another guest's to read, and says so the same way as a reference nobody holds", async () => {
    const stay = await aGuestStay(anh);

    const refused = await binh.get(ownPath(stay.reference));
    const missing = await binh.get(ownPath(NO_SUCH_REFERENCE));

    // 404 rather than 403, and the same 404 for both. Telling "not yours" from
    // "no such stay" would hand a caller an oracle over which references the
    // property has issued, one guess at a time — `booking.service.ts` takes the
    // same line where it answers the ownership question.
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);

    // Identical in every field, the sentence included, once the reference each
    // caller sent is put back into it. Echoing what somebody asked for tells
    // them nothing they did not already know; anything else in the two replies
    // differing would be the oracle. Compared this way rather than against a
    // quoted sentence, so rewording the refusal does not fail this.
    expect(refused.body).toEqual({
      ...missing.body,
      message: (missing.body.message as string).replace(
        NO_SUCH_REFERENCE,
        stay.reference,
      ),
    });
  });

  it("is unreachable when the desk took it, because a walk-in belongs to nobody", async () => {
    const walkIn = await aWalkIn();

    // Read out of the table rather than assumed. The whole point of this case is
    // the null, so a fixture that quietly carried an account would pass the
    // assertion below while testing nothing.
    expect(await accountOn(walkIn.id)).toBeNull();

    await anh.get(ownPath(walkIn.reference)).expect(404);
    await binh.get(ownPath(walkIn.reference)).expect(404);
  });
});

describe("the stay a guest calls off", () => {
  it("cancels at the guest's own request, with no waiver behind it", async () => {
    const stay = await aGuestStay(anh);

    const response = await anh.post(cancelPath(stay.reference)).expect(200);

    expect(response.body).toMatchObject({
      id: stay.id,
      state: "CANCELLED",
      cancellationReason: "GUEST_REQUEST",
      holdExpiresAt: null,
    });

    // Setting §4's penalty aside is `booking.cancel-waiver`, `MANAGER` and
    // above, reached from the other door entirely. A guest route that wrote
    // these columns would be a guest waiving their own cancellation fee.
    const [row] = await db
      .select({
        waivedAt: booking.penaltyWaivedAt,
        waivedBy: booking.penaltyWaivedBy,
      })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(row).toEqual({ waivedAt: null, waivedBy: null });
  });

  it("answers the same way to a repeated request", async () => {
    // §4's idempotency rule, over HTTP. A double-tapped button and a retried
    // request both arrive as the transition that already happened, and the
    // second must not release the nights again.
    const stay = await aGuestStay(anh);

    await anh.post(cancelPath(stay.reference)).expect(200);

    const again = await anh.post(cancelPath(stay.reference)).expect(200);

    expect(again.body.state).toBe("CANCELLED");
  });

  it("leaves another guest's stay standing", async () => {
    const stay = await aGuestStay(anh);

    await binh.post(cancelPath(stay.reference)).expect(404);

    // The refusal is worth nothing if the transition ran first. `findOwn` is the
    // first statement in the service method for exactly this reason.
    expect(await stateOf(stay.id)).toBe("HELD");
  });

  it("leaves a stay the desk took standing", async () => {
    const walkIn = await aWalkIn();

    expect(await accountOn(walkIn.id)).toBeNull();

    await anh.post(cancelPath(walkIn.reference)).expect(404);

    expect(await stateOf(walkIn.id)).toBe("CONFIRMED");
  });
});

describe("what the guest's cancellation costs", () => {
  it("is priced by the same grid, to the same figure, as the desk's", async () => {
    // Two stays over the same nights and on the same plan, so the per-night
    // figures `property-and-tariff.md` §4 scales are identical and any
    // difference in the charge is a difference between the two paths.
    //
    // `NONREF`, and that is the whole reason the plan is named here. On a
    // refundable plan the row that fires turns on the wall clock against §4's
    // 18:00 deadline, and a stay booked far enough ahead to sit inside the
    // seeded calendar is always inside the free window too — so both paths
    // would come to nothing and the comparison would hold for a route that
    // computed nothing at all. §4 charges a non-refundable cancellation the
    // whole stay in every one of its rows, whenever it arrives, so this figure
    // is above zero on any day the suite runs.
    const nights = nextMonday();

    const guests = await aGuestStay(anh, nights, "NONREF");
    const desks = await aWalkIn(nights, "NONREF");

    await anh.post(cancelPath(guests.reference)).expect(200);
    await asDesk("post", `/bookings/${desks.id}/cancellation`, {
      reason: "GUEST_REQUEST",
    }).expect(200);

    const byGuest = await policyChargeOn(guests.id);
    const byDesk = await policyChargeOn(desks.id);

    expect(byGuest).toEqual(byDesk);
    expect(BigInt(byGuest.amount)).toBeGreaterThan(0n);
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

const ownPath = (reference: string) => `/bookings/mine/${reference}`;

const cancelPath = (reference: string) => `${ownPath(reference)}/cancellation`;

/** The funnel's own address for a hold — a member of the collection it posts to. */
const holdPath = (bookingId: string) => `/bookings/holds/${bookingId}`;

/** The desk confirming a stay, which is the only door that transition has. */
function confirm(bookingId: string): request.Test {
  return asDesk("post", `/bookings/${bookingId}/confirmation`).expect(200);
}

/** A call as the front desk. */
function asDesk(
  method: "get" | "post",
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

  const session = await agent.get("/api/auth/get-session").expect(200);

  expect(session.body.user.emailVerified).toBe(true);

  return agent;
}

/** The next unused Monday, so no two stays here compete for the same nights. */
function nextMonday(): string {
  const monday = MONDAYS[mondayOrdinal];

  if (!monday) {
    throw new Error("this file has booked more stays than it has Mondays for");
  }

  mondayOrdinal += 1;

  return monday;
}

/** Two nights of a Deluxe, mid-week, for a party the type sleeps. */
function aStayBody(arrival: string, plan = "STANDARD"): object {
  return {
    roomType: "DELUXE",
    checkIn: arrival,
    checkOut: parseDate(arrival).add({ days: 2 }).toString(),
    plan,
    adults: 2,
    childAges: [],
  };
}

/**
 * A stay the funnel took while this guest was signed in.
 *
 * Booked through the route rather than inserted, because the account on the row
 * is precisely what is under test: `booking.controller.ts` takes it off the
 * session, and a fixture that set the column itself would prove nothing about
 * the path that has to set it.
 */
async function aGuestStay(
  guest: request.Agent,
  arrival: string = nextMonday(),
  plan?: string,
): Promise<Stay> {
  const created = await guest
    .post("/bookings/holds")
    .send(aStayBody(arrival, plan));

  if (created.status !== 201) {
    throw new Error(`the hold was refused: ${JSON.stringify(created.body)}`);
  }

  return { id: created.body.id as string, reference: created.body.reference };
}

/** A stay the desk took. Nobody is signed in behind it, which is the case the
 *  nullable column exists for and the one the refusals above turn on. */
async function aWalkIn(
  arrival: string = nextMonday(),
  plan?: string,
): Promise<Stay> {
  const created = await asDesk("post", "/bookings", aStayBody(arrival, plan));

  if (created.status !== 201) {
    throw new Error(`the walk-in was refused: ${JSON.stringify(created.body)}`);
  }

  return { id: created.body.id as string, reference: created.body.reference };
}

async function accountOn(bookingId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: booking.userId })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.userId ?? null;
}

async function stateOf(bookingId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row?.state;
}

/**
 * §4's charge on one stay, as the desk's own route posts it.
 *
 * `folio.refund-policy` is a staff row on both paths — money leaving the
 * property is never the guest's to authorise — so the comparison runs the same
 * receptionist over both accounts and differs only in who cancelled.
 */
async function policyChargeOn(
  bookingId: string,
): Promise<{ amount: string; chargeBasis: string | null }> {
  const posted = await asDesk(
    "post",
    `/bookings/${bookingId}/folio/policy-refunds`,
  ).expect(200);

  const charge = posted.body.folio.postings.find(
    (line: { type: string }) => line.type === "POLICY_CHARGE",
  );

  if (!charge) {
    throw new Error("§4's charge is not on the account the route answered with");
  }

  return { amount: charge.amount, chargeBasis: charge.chargeBasis };
}

/**
 * The rows this file leaves behind, and only those.
 *
 * `truncate … cascade` rather than a delete: `folio_posting` refuses a `DELETE`
 * outright, the append-only trigger raising on it for every client. The cascade
 * reaches the bookings through the accounts they name and the payments through
 * the folios they hang off, which is exactly the set this file wrote.
 */
async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate loyalty_ledger, payment, folio_posting, folio, room_assignment, booking_night, booking, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );
}
