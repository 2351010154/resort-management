// One stay, from the funnel's hold to the housekeeper's trolley, over HTTP.
//
// Every transition below is already asserted against the services that perform
// them — `booking-lifecycle.e2e-spec.ts` for the table and the hold,
// `room-assignment.e2e-spec.ts` for the two ways a guest gets a room,
// `check-in-out.e2e-spec.ts` for the arrival guards, the registration record and
// the nights a departure gives back. None of those files boots an application,
// and each drives one service across a boundary it opens itself.
//
// What is not asserted anywhere else is that the six operations compose. A stay
// is created by one module, priced by a second, given a room by a third and
// handed back to a fourth, and between each pair sits a controller that opens a
// transaction, crosses a `CalendarDate` onto the wire and crosses the answer
// back. So this file books one stay and walks it through in order, asserting
// only what the composition adds:
//
// - **The state machine holds across the route boundary.** Each response carries
//   the state the previous route left the booking in, read back from the
//   database rather than from anything this file remembers.
// - **The inventory effects survive the trip.** The nights are consumed once by
//   the hold, not again by the confirmation, not again by the room move, and are
//   still sold after a departure on the date the stay was sold to.
// - **Housekeeping receives the room the guest left**, on the board it is walked
//   with, through the housekeeping routes rather than by reading the table the
//   booking module wrote. Two modules agreeing about one room is the claim, and
//   a query written here would be this file agreeing with itself.
//
// The property's day moves, because a stay is not something that happens on one
// day: the guest arrives on the tenth, is moved to another room on the eleventh
// and leaves on the thirteenth. It moves by the test setting it, never by the
// clock running — the business date is the service's answer and every operation
// below reads it from there.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { guest } from "../src/database/schema/guest.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const SEED_FROM = parseDate("2027-06-01");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const FIRST_ROOM = "201";
const SECOND_ROOM = "202";

const ARRIVAL = parseDate("2027-06-10");
const MOVE_DAY = parseDate("2027-06-11");
const DEPARTURE = parseDate("2027-06-13");

/** The three nights the stay is sold, half-open — the departure is not one. */
const NIGHTS = ["2027-06-10", "2027-06-11", "2027-06-12"];

// A Thursday arrival and a Sunday departure, so the funnel's own restrictions
// have nothing to say: `seed.ts` writes a minimum stay or a closed date only
// onto Friday and Saturday nights, and this stay begins and ends on neither.
// The point of the hold below is the inventory it consumes, not a rule
// `stay-restriction-guard.ts` already has its own tests for.
const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL.toString(),
  checkOut: DEPARTURE.toString(),
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

/** The same stay through the funnel's door, which asks who to write to. */
const A_HELD_STAY = {
  ...A_STAY,
  contactEmail: "journey-guest@example.test",
  contactName: "Journey Guest",
} as const;

const A_GUEST = {
  fullName: "Ngô Thị Bích",
  cccdNumber: "079301007788",
  nationality: "VN",
} as const;

const RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

/**
 * The property's day, stopped and moved by hand.
 *
 * The hour and the zone stay the real service's; only the instant it reads is
 * fixed. Settable rather than constant, because this file is one stay across
 * four days and the arrival window, the move date and the released nights are
 * each an answer about where today falls against the stay.
 */
class PropertyDay extends BusinessDateService {
  private today: StayDate = ARRIVAL;

  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }

  advanceTo(date: StayDate): void {
    this.today = date;
  }
}

interface BoardTile {
  readonly roomNumber: string;
  readonly status: string;
  readonly isReady: boolean;
  readonly isOccupied: boolean;
  readonly updatedBy: string | null;
}

const day = new PropertyDay();

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let token: string;
let bookingId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useValue(day)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The account below is created by email and the column is unique, so it has
  // to be the only one — the seed does not own this table and leaves whatever
  // the last suite signed in with.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays. Both rooms named above have to be free on all three
  // nights, and five hundred random holds would decide otherwise.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // The one row the seed's wipe deliberately leaves behind — a person is not
  // owned by one stay. `guest_cccd_number_key` refuses a second row carrying
  // this number, so the check-in below would run exactly once against a
  // database this suite had already been run on.
  await db.delete(guest).where(eq(guest.cccdNumber, A_GUEST.cccdNumber));

  http = () => request(app.getHttpServer());

  await app.get(StaffUserService).create({ ...RECEPTIONIST });

  const signedIn = await http()
    .post("/auth/staff/sign-in")
    .send({ email: RECEPTIONIST.email, password: RECEPTIONIST.password })
    .expect(200);

  token = signedIn.body.accessToken as string;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

/**
 * A call as the receptionist working the desk.
 *
 * A `GET` carries its arguments in the query string and everything else carries
 * them in the body, which is the one thing this helper knows that the callers
 * below would otherwise each have to.
 */
function as(
  method: "get" | "post" | "put",
  path: string,
  body: object = {},
): request.Test {
  const call = http()[method](path).set("Authorization", `Bearer ${token}`);

  return method === "get" ? call.query(body) : call.send(body);
}

describe("a stay taken at the funnel and walked to the trolley", () => {
  it("is created as a hold that consumes every night of it", async () => {
    const response = await as("post", "/bookings/holds", A_HELD_STAY).expect(201);

    bookingId = response.body.id;

    expect(response.body).toMatchObject({
      state: "HELD",
      roomType: "SUPERIOR",
      checkIn: ARRIVAL.toString(),
      checkOut: DEPARTURE.toString(),
    });

    // A hold consumes the nights in full rather than at payment — otherwise it
    // is a room two guests can reach the payment step for.
    expect(await soldOn("SUPERIOR", NIGHTS)).toEqual([1, 1, 1]);

    // And never the departure date. The off-by-one night is invisible in every
    // number except this one.
    expect(await soldOn("SUPERIOR", [DEPARTURE.toString()])).toEqual([0]);
  });

  it("confirms without selling the same nights a second time", async () => {
    const response = await as(
      "post",
      `/bookings/${bookingId}/confirmation`,
    ).expect(200);

    expect(response.body).toMatchObject({
      state: "CONFIRMED",
      // A confirmed stay carrying a stale TTL is a date the sweep could act on,
      // and what it would do with it is cancel a room the property has sold.
      holdExpiresAt: null,
    });

    // The one transition that moves no inventory: the nights were bought when
    // the hold was taken, and reserving them again would sell the stay twice to
    // the guest who was already holding it.
    expect(await soldOn("SUPERIOR", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("takes a room for the whole of the stay", async () => {
    const response = await as("put", `/bookings/${bookingId}/room`, {
      roomNumber: FIRST_ROOM,
    }).expect(200);

    expect(response.body).toMatchObject({
      bookingId,
      roomNumber: FIRST_ROOM,
      checkIn: ARRIVAL.toString(),
      checkOut: DEPARTURE.toString(),
    });
  });

  it("admits the guest on the arrival date, leaving the room clean", async () => {
    const response = await as("post", `/bookings/${bookingId}/check-in`, {
      guests: [A_GUEST],
    }).expect(200);

    expect(response.body.state).toBe("CHECKED_IN");

    // Check-in has no housekeeping effect: the room was ready before the guest
    // walked in and it is ready after. What has changed on the board is that
    // somebody is in it.
    expect(await tile(FIRST_ROOM, ARRIVAL)).toMatchObject({
      status: "CLEAN",
      isReady: true,
      isOccupied: true,
    });
  });

  it("moves the guest mid-stay and hands the room they left back as dirty", async () => {
    day.advanceTo(MOVE_DAY);

    const response = await as("post", `/bookings/${bookingId}/room-moves`, {
      roomNumber: SECOND_ROOM,
    }).expect(200);

    // The new hold starts today and runs to the departure. The nights already
    // slept stay with the old room — the guest was in 201 on the tenth, and a
    // single row rewritten to say 202 would claim nobody ever was.
    expect(response.body).toMatchObject({
      bookingId,
      roomNumber: SECOND_ROOM,
      checkIn: MOVE_DAY.toString(),
      checkOut: DEPARTURE.toString(),
    });

    // The claim this file exists for: the room the guest walked out of reaches
    // housekeeping, on the board housekeeping actually reads, without anybody
    // telling it. Attributed to nobody — the desk clerk who moved the guest
    // made no cleaning judgement.
    expect(await tile(FIRST_ROOM, MOVE_DAY)).toMatchObject({
      status: "DIRTY",
      isReady: false,
      isOccupied: false,
      updatedBy: null,
    });

    expect(await tile(SECOND_ROOM, MOVE_DAY)).toMatchObject({
      isOccupied: true,
    });

    // A move changes which key the guest holds and nothing the property sold.
    expect(await soldOn("SUPERIOR", NIGHTS)).toEqual([1, 1, 1]);
  });

  it("checks out on the departure date, keeping every night it slept", async () => {
    day.advanceTo(DEPARTURE);

    const response = await as(
      "post",
      `/bookings/${bookingId}/check-out`,
    ).expect(200);

    expect(response.body.state).toBe("CHECKED_OUT");

    // A stay that ran its course releases nothing: on the departure date there
    // is no unspent night left to give back, and the three the guest slept stay
    // sold. A counter that dropped here would be the property crediting itself
    // with inventory it never had.
    expect(await soldOn("SUPERIOR", NIGHTS)).toEqual([1, 1, 1]);

    // The second room follows the first. The board now shows the whole stay
    // gone: nobody in either room, and both waiting on a cleaning round.
    expect(await tile(SECOND_ROOM, DEPARTURE)).toMatchObject({
      status: "DIRTY",
      isReady: false,
      isOccupied: false,
      updatedBy: null,
    });
  });
});

/** One room's tile on the board for a given day of the property's. */
async function tile(roomNumber: string, businessDate: StayDate): Promise<BoardTile> {
  const response = await as("get", "/housekeeping/board", {
    businessDate: businessDate.toString(),
  }).expect(200);

  const found = (response.body.rooms as BoardTile[]).find(
    (each) => each.roomNumber === roomNumber,
  );

  if (!found) {
    throw new Error(`room ${roomNumber} is missing from the board`);
  }

  return found;
}

/** `sold_rooms` for a type on each of the given nights, in the order asked. */
async function soldOn(
  code: RoomTypeCode,
  nights: readonly string[],
): Promise<number[]> {
  const rows = await db
    .select({
      stayDate: typeInventory.stayDate,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(
      and(eq(roomType.code, code), inArray(typeInventory.stayDate, [...nights])),
    );

  const byDate = new Map(rows.map((row) => [row.stayDate, row.soldRooms]));

  return nights.map((night) => {
    const sold = byDate.get(night);

    if (sold === undefined) {
      throw new Error(`${code} has no counter on ${night}`);
    }

    return sold;
  });
}
