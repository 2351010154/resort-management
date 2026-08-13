// What bounds the one unauthenticated write that takes rooms off the shelf.
//
// `booking.create-own` is public — `rbac-matrix.md` §3's second row — and it
// consumes every night of a stay at the moment a stranger asks for it.
// `hold-rate-limit.guard.spec.ts` and `guest-booking-token.e2e-spec.ts` already
// prove the rate in front of it: how often one address may ask. This file is
// about the two things a rate cannot say, and both of them are claims about
// rooms rather than about requests.
//
// 1. **How many rooms one caller may be holding at once.** A rate resets, lives
//    in one process and is forgotten on a restart; a caller who paces themselves
//    under it can still stand on an arbitrary number of rooms. The cap counts
//    live rows instead, so it forgets nothing.
// 2. **How much of a night may be held by people the property cannot contact.**
//    A hold behind an account is a booking that can be chased. A hold behind
//    nothing is a room withdrawn from sale by somebody the property will never
//    hear from again, and a night must not be mostly that.
//
// Both are asserted over HTTP and against `type_inventory.sold_rooms`, because
// the failure worth catching is a refusal that arrives *after* the nights were
// consumed — an answer of 429 to a request that took a room anyway is a way to
// empty the property one polite refusal at a time. The caller is set with
// `X-Forwarded-For` against a `trust proxy` of one hop, which is `main.ts`'s own
// configuration and the only reason two requests here are two callers.
//
// The third claim is about what the cap is allowed to remember. `held_by` holds
// a digest and never an address, and it is cleared everywhere the hold expiry is
// — so a caller is not charged for a room they paid for or gave back.
//
// Every stay arrives on a Monday inside the seeded calendar, for the reason
// `guest-booking-token.e2e-spec.ts` gives: the seed closes some weekend arrivals
// and the funnel obeys them, so a Friday would make a refusal mean the
// restriction rather than the cap.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { ENV, type Env } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { HoldExpirySweep } from "../src/modules/booking/hold-expiry-sweep.js";
import { HOLD_RATE_LIMIT_POLICY } from "../src/modules/booking/hold-rate-limit.guard.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped, and a Monday. */
const TODAY = parseDate("2027-06-07");

/**
 * One arrival per hold within a case, so a stay never meets the *other* cap by
 * accident: the concurrent cap counts a caller's rows whatever nights they
 * cover, and the share cap counts a night's rows whoever took them. Separating
 * the two is what makes each refusal below attributable.
 *
 * Every case starts from an empty `booking` table and a property with nothing
 * sold, so the same eight Mondays serve all of them.
 */
const ARRIVALS = [
  "2027-06-07",
  "2027-06-14",
  "2027-06-21",
  "2027-06-28",
  "2027-07-05",
  "2027-07-12",
  "2027-07-19",
  "2027-07-26",
] as const;

/** Two nights, so a stay covers a Monday and a Tuesday and no weekend rule. */
const NIGHTS_PER_STAY = 2;

/** The type every hold below is taken against — ten rooms, per `property.ts`. */
const TYPE: RoomTypeCode = "DELUXE";
const ROOMS_OF_TYPE = 10;

/**
 * What `booking.service.ts` refuses the fourth of.
 *
 * Written out rather than imported: the figure is a policy the property owns
 * and not an injected knob, and a test that read it off the implementation would
 * pass whatever the implementation was changed to.
 */
const CONCURRENT_HOLDS = 3;

/**
 * The rate, stated small for the reason `booking.module.ts` provides it at all —
 * proving the limiter still refuses should not take thirty rooms off the shelf.
 *
 * Above {@link CONCURRENT_HOLDS} on purpose, and by enough that the concurrent
 * cap is reached first: the two refusals share a status, so the only way to
 * prove they are two is to reach each one while the other is not the reason.
 */
const RATE_LIMIT = 6;

/**
 * The window that rate is spent over, and the wait the limiter's refusal quotes.
 *
 * The deployed figure rather than a small one, because the sentence names it: a
 * window measured in seconds would prove the refusal without proving that what
 * it tells the guest to wait is what the property actually makes them wait.
 */
const RATE_WINDOW_MINUTES = 10;

class StoppedClock extends BusinessDateService {
  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return TODAY;
  }
}

/** Captures the verification link the signed-in fixture follows. */
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

const A_GUEST = {
  name: "Trần Minh Quân",
  email: "hold-caps-guest@example.test",
  password: "correct-horse-hold-caps",
} as const;

let app: INestApplication;
let db: Database;
let bookings: BookingService;
let sweep: HoldExpirySweep;
let mailer: RecordingMailer;
/** A browser with a real guest session, for the one cap that exempts one. */
let signedIn: request.Agent;
/**
 * How long a hold lasts, read off the running application.
 *
 * Unlike {@link CONCURRENT_HOLDS} this is not written out: the TTL is
 * configuration a property tunes — `env.ts` says so outright — and both refusals
 * below quote it as the wait they ask the guest for. A figure copied here would
 * be a second opinion about a knob, and the assertion worth making is that the
 * sentence names *the* wait rather than that it names ten minutes.
 */
let holdTtl: number;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .overrideProvider(HOLD_RATE_LIMIT_POLICY)
    .useValue({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MINUTES * 60_000 })
    .compile();

  app = moduleRef.createNestApplication();

  // What `main.ts` sets on the deployed process. Without it every agent here
  // shares the loopback address, and this whole file would be one caller.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  await app.init();

  db = app.get<Database>(DRIZZLE);
  bookings = app.get(BookingService);
  // Built by hand rather than resolved, because this file boots `AppModule`
  // without the jobs registry that provides it — and handed the running app's
  // own configuration, so the two clocks it reads are the property's.
  sweep = new HoldExpirySweep(bookings, app.get<Env>(ENV));
  holdTtl = app.get<Env>(ENV).BOOKING_HOLD_TTL_MINUTES;

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification restart identity cascade`,
  );
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  signedIn = await aVerifiedGuest();
}, 120_000);

// Every case counts rooms, so each starts against the property as the seed laid
// it down — the idiom `hold-expiry.e2e-spec.ts` keeps, and for its reason: a
// case reading a counter another one left behind is reading a number nobody
// chose. The limiter's windows are *not* reset, which is why callers are drawn
// from a sequence rather than written down.
beforeEach(async () => {
  await db.execute(sql`truncate booking restart identity cascade`);
  await db.update(typeInventory).set({ soldRooms: 0 });
});

afterAll(async () => {
  await db.execute(sql`truncate booking restart identity cascade`);
  await app?.close();
});

describe("the rooms one caller may be holding at once", () => {
  it("lets a caller take three and refuses the fourth", async () => {
    const caller = nextCaller();

    for (let taken = 0; taken < CONCURRENT_HOLDS; taken += 1) {
      await hold(caller, ARRIVALS[taken]!).expect(201);
    }

    const refused = await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);

    // The wait, in the sentence, as a figure. A refusal that says "not yet"
    // without saying how long is one a guest can only answer by pressing again.
    expect(refused.body.message).toContain(`${holdTtl} minutes`);

    // And nothing about rooms the reader is supposed to be holding. Since a
    // room pick releases the room the browser was on, one browser holds one room
    // however many types it compares — so the caller who reaches this cap is
    // several strangers behind one router, and "you are already holding three
    // rooms" is a claim none of them can check or act on.
    expect(refused.body.message).not.toMatch(
      new RegExp(`${CONCURRENT_HOLDS} rooms?`, "i"),
    );

    // The refusal ran before anything priced the stay or moved a counter, which
    // is the property `hold-rate-limit.guard.ts` argues a limit on this door
    // must have: a refusal that consumed the nights first would be the attack
    // rather than the answer to it.
    expect(await soldOn(ARRIVALS[CONCURRENT_HOLDS]!)).toBe(0);
    expect(await bookingsTaken()).toBe(CONCURRENT_HOLDS);
  });

  it("counts live holds and not holds ever taken", async () => {
    // The cap is about rooms outstanding. A hold whose TTL has run out is
    // holding nothing anybody should be charged for, whether or not the sweep
    // has reached the row — otherwise the sweep's cadence would be part of the
    // policy.
    const caller = nextCaller();

    for (let taken = 0; taken < CONCURRENT_HOLDS; taken += 1) {
      await hold(caller, ARRIVALS[taken]!).expect(201);
    }

    await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);

    await expireEveryHold();

    await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(201);
  });

  it("counts each caller separately", async () => {
    const caller = nextCaller();

    for (let taken = 0; taken < CONCURRENT_HOLDS; taken += 1) {
      await hold(caller, ARRIVALS[taken]!).expect(201);
    }

    await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);

    // Not a switch that closes the funnel. The next guest along is unaffected,
    // which is the difference between a cap and an outage.
    await hold(nextCaller(), ARRIVALS[CONCURRENT_HOLDS]!).expect(201);
  });
});

describe("the caller a hold is counted against", () => {
  it("is stored as a digest and never as the address", async () => {
    const caller = nextCaller();
    const created = await hold(caller, ARRIVALS[0]!).expect(201);

    const heldBy = await callerKeyOf(created.body.id as string);

    expect(heldBy).toMatch(/^[0-9a-f]{64}$/);
    // The claim is about what the column may hold, not about the encoding: an
    // address the property never wrote down cannot be read back out of it, and
    // `guest_user` is the only place a person's details belong.
    expect(heldBy).not.toContain(caller);
  });

  it("is cleared when the deposit confirms the hold", async () => {
    const created = await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    const id = created.body.id as string;

    expect(await callerKeyOf(id)).not.toBeNull();

    await db.transaction((exec) => bookings.confirm(exec, id));

    // The stay is sold, so the room is no longer one its caller is *holding*.
    // Left behind, the key would count against that caller's three until the
    // guest checked out — a guest punished by the limit that exists for the
    // guest who never pays.
    expect(await callerKeyOf(id)).toBeNull();
  });

  it("is cleared when the sweep cancels an expired hold", async () => {
    const created = await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    const id = created.body.id as string;

    await expireEveryHold();

    expect(await db.transaction((exec) => sweep.run(exec))).toEqual([id]);

    const [row] = await db.select().from(booking).where(eq(booking.id, id));

    expect(row!.state).toBe("CANCELLED");
    expect(row!.heldBy).toBeNull();
  });

  it("frees the caller's allowance as soon as one hold is confirmed", async () => {
    const caller = nextCaller();
    const first = await hold(caller, ARRIVALS[0]!).expect(201);

    for (let taken = 1; taken < CONCURRENT_HOLDS; taken += 1) {
      await hold(caller, ARRIVALS[taken]!).expect(201);
    }

    await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);

    await db.transaction((exec) =>
      bookings.confirm(exec, first.body.id as string),
    );

    // The guest who is furthest along is the one this matters for: they have
    // paid for one room and are choosing a second, and a cap that counted the
    // paid one would refuse the sale.
    await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(201);
  });
});

describe("the share of a night guests without an account may hold", () => {
  it("refuses a further anonymous hold while the night still has rooms", async () => {
    // Six of ten free. Half of what is left is three, so the third anonymous
    // hold is the one refused — with four rooms still on the shelf, which is
    // what makes this the cap answering rather than the inventory.
    await sellDown(ARRIVALS[0]!, 4);

    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(201);

    const refused = await hold(nextCaller(), ARRIVALS[0]!).expect(429);

    expect(refused.body.message).toContain(ARRIVALS[0]!);
    // The sentence has to steer the guest rather than report a sell-out, since
    // the property is not sold out and signing in takes the room.
    expect(refused.body.message).toMatch(/sign(ed)? in/i);
    // And the guest who would rather not sign in is owed the same figure the
    // concurrent cap quotes: every hold in the count is a live one, so all of
    // them are gone within a TTL of now.
    expect(refused.body.message).toContain(`${holdTtl} minutes`);

    // Refused before the counter moved, again — two anonymous holds and no more.
    expect(await soldOn(ARRIVALS[0]!)).toBe(6);
  });

  it("admits two on a nearly-full night, where half of what is left is one", async () => {
    // The floor, and the reason there is one. A plain half-of-remaining rule
    // would let a single guest hold the second-to-last room and turn the next
    // one away — on the busiest and most valuable night the property has.
    await sellDown(ARRIVALS[0]!, ROOMS_OF_TYPE - 2);

    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(201);

    expect(await soldOn(ARRIVALS[0]!)).toBe(ROOMS_OF_TYPE);
  });

  it("does not bind a guest who has signed in", async () => {
    await sellDown(ARRIVALS[0]!, 4);

    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(429);

    // The same night, the same moment, the same rooms — and an account behind
    // the request. A hold the property can chase is not the thing the cap is
    // rationing, which is the whole content of the refusal above.
    const taken = await signedIn
      .post("/bookings/holds")
      .set("X-Forwarded-For", nextCaller())
      .send(aHoldBody(ARRIVALS[0]!))
      .expect(201);

    expect(taken.body.userId).not.toBeNull();
  });

  it("counts a night and not a stay, so a later night is unaffected", async () => {
    // The cap is per night and per type, which is the unit inventory is sold
    // in. A stay refused on its arrival night says nothing about the Monday
    // after it.
    await sellDown(ARRIVALS[0]!, 4);

    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(201);
    await hold(nextCaller(), ARRIVALS[0]!).expect(429);

    await hold(nextCaller(), ARRIVALS[1]!).expect(201);
  });
});

describe("the rate in front of the door", () => {
  it("still refuses a caller past its window, and refuses only that caller", async () => {
    const caller = nextCaller();

    for (let taken = 0; taken < CONCURRENT_HOLDS; taken += 1) {
      await hold(caller, ARRIVALS[taken]!).expect(201);
    }

    // Every request counts against the window, including the ones the hold cap
    // refuses — a limiter that treated its own refusals as allowances would let
    // every second call through, which is `hold-rate-limit.guard.spec.ts`'s own
    // case stated over HTTP.
    const byTheCap = await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);

    expect(byTheCap.body.message).toContain(`${holdTtl} minutes`);

    for (let asked = CONCURRENT_HOLDS + 1; asked < RATE_LIMIT; asked += 1) {
      await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(429);
    }

    // Past the window now, and the sentence is the limiter's rather than the
    // cap's. Two refusals share a status and are not the same refusal.
    const byTheRate = await hold(caller, ARRIVALS[CONCURRENT_HOLDS]!).expect(
      429,
    );

    expect(byTheRate.body.message).toContain("attempts to hold a room");

    // **This caller held nothing, and the sentence must not say they did.**
    // Every hold they took is still live, so the four requests that reached the
    // limiter were all refused by the cap first — a limiter that reported
    // "too many rooms held from here" would be describing rooms that were never
    // taken. It names the window instead, in the same words the cap names the
    // TTL, so waiting the stated time actually works.
    expect(byTheRate.body.message).not.toMatch(/rooms held/i);
    expect(byTheRate.body.message).toContain(`${RATE_WINDOW_MINUTES} minutes`);

    await hold(nextCaller(), ARRIVALS[CONCURRENT_HOLDS]!).expect(201);
  });
});

/** One anonymous hold, from a named caller. */
function hold(caller: string, arrival: string): request.Test {
  return request(app.getHttpServer())
    .post("/bookings/holds")
    .set("X-Forwarded-For", caller)
    .send(aHoldBody(arrival));
}

/** Two nights of a Deluxe with somebody to write to — the funnel's own body. */
function aHoldBody(arrival: string): object {
  return {
    roomType: TYPE,
    checkIn: arrival,
    checkOut: parseDate(arrival).add({ days: NIGHTS_PER_STAY }).toString(),
    plan: "STANDARD",
    adults: 2,
    childAges: [],
    contactEmail: "funnel-guest@example.test",
    contactName: "Funnel Guest",
  };
}

/** One address per caller, so no case inherits another's window. */
let callerOrdinal = 0;

function nextCaller(): string {
  callerOrdinal += 1;

  return `203.0.113.${callerOrdinal}`;
}

/** What the property has sold on one night of the type under test. */
async function soldOn(night: string): Promise<number> {
  const [row] = await db
    .select({ soldRooms: typeInventory.soldRooms })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(and(eq(roomType.code, TYPE), eq(typeInventory.stayDate, night)));

  if (!row) {
    throw new Error(`${TYPE} has no counter on ${night}`);
  }

  return row.soldRooms;
}

/**
 * Puts the property's own bookings on the nights of one stay.
 *
 * The counter is moved directly rather than through holds, because what the
 * share cap reads is how many rooms are left — and manufacturing that with a
 * dozen funnel requests would spend the very allowance under test.
 */
async function sellDown(arrival: string, sold: number): Promise<void> {
  const [type] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, TYPE));

  await db
    .update(typeInventory)
    .set({ soldRooms: sold })
    .where(
      and(
        eq(typeInventory.roomTypeId, type!.id),
        inArray(typeInventory.stayDate, nightsOf(arrival)),
      ),
    );
}

/** The nights a stay arriving that day sells — never the departure date. */
function nightsOf(arrival: string): string[] {
  const first = parseDate(arrival);

  return Array.from({ length: NIGHTS_PER_STAY }, (_, offset) =>
    first.add({ days: offset }).toString(),
  );
}

/** The digest a hold is counted against, read straight off the row. */
async function callerKeyOf(bookingId: string): Promise<string | null> {
  const [row] = await db
    .select({ heldBy: booking.heldBy })
    .from(booking)
    .where(eq(booking.id, bookingId));

  if (!row) {
    throw new Error(`no booking ${bookingId}`);
  }

  return row.heldBy;
}

async function bookingsTaken(): Promise<number> {
  return (await db.select({ id: booking.id }).from(booking)).length;
}

/**
 * Moves every live hold's expiry into the past.
 *
 * The column is what both the cap and the sweep read, so writing it is the same
 * event as a clock reaching it — the argument `hold-expiry.e2e-spec.ts` makes
 * for not waiting out a real TTL.
 */
async function expireEveryHold(): Promise<void> {
  await db
    .update(booking)
    .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
    .where(eq(booking.state, "HELD"));
}

/** A guest whose cookie resolves through the real Better Auth session path. */
async function aVerifiedGuest(): Promise<request.Agent> {
  const http = () => request(app.getHttpServer());

  await http()
    .post("/api/auth/sign-up/email")
    .send({
      name: A_GUEST.name,
      email: A_GUEST.email,
      password: A_GUEST.password,
    })
    .expect(200);

  const link = new URL(mailer.linkTo(A_GUEST.email));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const agent = request.agent(app.getHttpServer());

  await agent
    .post("/api/auth/sign-in/email")
    .send({ email: A_GUEST.email, password: A_GUEST.password })
    .expect(200);

  return agent;
}
