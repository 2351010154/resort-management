// Fifty guests reaching for the last room, through the route the desk uses.
//
// `inventory-reservation.e2e-spec.ts` already proves the claim at the layer it
// is about: fifty transactions against the real counter produce one sale and
// forty-nine refusals, because `type_inventory_sold_at_most_total` refuses the
// fiftieth. That file drives `InventoryService` directly and says why — the
// subject there is one service and the database underneath it.
//
// This is the same claim one layer up, and what it adds is everything between
// the counter and a front-desk screen. A booking creation is a transaction the
// controller opens, a quote, an inventory movement, a reference and two inserts;
// a check constraint refused in the middle of that aborts the whole Postgres
// transaction, and every layer above has to turn the refusal into a status a
// caller can act on. So the count that matters here is not only "one success" —
// it is that the other forty-nine arrive as `409`, because a constraint
// violation that escapes as a `500` is the property telling fifty guests its
// booking system is broken when what actually happened is that it sold its last
// room.
//
// The application's pool is ten connections wide by design, so these fifty
// requests are not fifty simultaneous transactions — they are fifty requests
// queueing through ten. That is deliberately not corrected. True simultaneity at
// the row lock is what the reservation suite exists to prove and it has its own
// pool for it; what is under test here is the answer each of the fifty gets, and
// the arrangement below is the one a deployed API actually runs.

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
import { booking } from "../src/database/schema/booking.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day. Every stay below arrives well after it. */
const TODAY = parseDate("2027-06-10");

/** `FR-INV-02`'s number, and the reason this file exists. */
const SIMULTANEOUS_GUESTS = 50;

/** The mix from `seed/property.ts` — every Deluxe the property owns. */
const DELUXE_ROOMS = 10;

// A single night, far from the dates every other suite books against. One night
// keeps the transaction to one counter row, so a refusal below can only be the
// one this file is about.
const NIGHT = "2027-09-14";
const NEXT_DAY = "2027-09-15";

const A_STAY = {
  roomType: "DELUXE",
  checkIn: NIGHT,
  checkOut: NEXT_DAY,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

/**
 * What the counter refuses a sale with, as the desk reads it.
 *
 * Written out rather than matched loosely, because the point of asserting it is
 * to tell this refusal apart from every other 409 the route can answer: a night
 * the calendar never opened and a reference that could not be issued are both
 * conflicts, and neither would prove anything about an oversell.
 */
const SOLD_OUT =
  "Every room of that type is sold on at least one night of that stay";

const RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

/**
 * The property's day, stopped — the device every booking suite here uses.
 *
 * The hour and the zone stay the real service's; only the instant it reads is
 * fixed. Without it the creating guard would be asked about a stay in 2027 from
 * whatever day the suite happens to run on.
 */
class StoppedClock extends BusinessDateService {
  constructor() {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return TODAY;
  }
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let token: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  // Listening is opened here rather than left to the first request. Supertest
  // starts the server itself when it finds no address and closes it again after
  // the response — which is fine for a suite that calls one route at a time, and
  // is fifty concurrent `listen(0)` calls on one server for this one.
  await new Promise<void>((resolve) => {
    app.getHttpServer().listen(0, resolve);
  });

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The account below is created by email and the column is unique, so it has
  // to be the only one — the seed does not own this table and leaves whatever
  // the last suite signed in with.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays. The night below has to hold exactly the number of sold
  // rooms this file puts on it, and five hundred random holds would decide
  // otherwise.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

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

/** One guest asking for the stay every other guest is asking for. */
function createBooking(): request.Test {
  return http()
    .post("/bookings")
    .set("Authorization", `Bearer ${token}`)
    .send(A_STAY);
}

describe("the last Deluxe of a night, over HTTP", () => {
  let sold: request.Response[];

  it("goes to exactly one of fifty simultaneous requests", async () => {
    // Nine of the ten gone, which is the state the fiftieth guest and the first
    // are both looking at.
    await sell("DELUXE", NIGHT, DELUXE_ROOMS - 1);

    sold = await Promise.all(
      Array.from({ length: SIMULTANEOUS_GUESTS }, () => createBooking()),
    );

    expect(statusesOf(sold, 201)).toHaveLength(1);

    // The half of the claim a success count cannot make. Forty-nine refusals is
    // the right number whether they are conflicts or faults, and only one of
    // those two is the property saying "that night is sold out" — the other is
    // a booking system that appears broken to forty-nine people at once.
    expect(statusesOf(sold, 409)).toHaveLength(SIMULTANEOUS_GUESTS - 1);

    // Asserted as its own line, and by body rather than by count, because this
    // is the failure the file exists to catch: a `23514` that reached the wire
    // untranslated arrives here with whatever the framework says about an
    // unhandled error, and that text is the evidence.
    expect(
      sold
        .filter((response) => response.status >= 500)
        .map((response) => response.body),
    ).toEqual([]);

    // Every refusal is the counter's, and not some other conflict that happens
    // to share the status — a reference that could not be issued, or a night the
    // calendar never opened, would both be 409s and neither would be a proof of
    // anything about overselling.
    expect(
      new Set(
        sold
          .filter((response) => response.status === 409)
          .map((response) => response.body.message as string),
      ),
    ).toEqual(new Set([SOLD_OUT]));
  });

  it("leaves the property's books reading exactly what it owns", async () => {
    // Not "at most ten sold" — exactly ten, because a race that loses an
    // increment is as wrong as one that gains one and is far harder to notice.
    expect(await counterOn("DELUXE", NIGHT)).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: DELUXE_ROOMS,
    });

    // And one booking row behind that last increment. The forty-nine that were
    // refused each rolled back a transaction that had already priced the stay
    // and taken a reference, so a second row here would be a booking the
    // property never sold sitting against a counter that cannot see it.
    const written = await db
      .select({ id: booking.id })
      .from(booking)
      .where(eq(booking.checkInDate, NIGHT));

    expect(written.map((row) => row.id)).toEqual([
      statusesOf(sold, 201)[0]!.body.id,
    ]);
  });

  it("leaves the night after it alone", async () => {
    // Half-open: the departure date is not a night sold, so fifty requests for
    // the fourteenth touched nothing on the fifteenth.
    expect(await counterOn("DELUXE", NEXT_DAY)).toEqual({
      totalRooms: DELUXE_ROOMS,
      soldRooms: 0,
    });
  });
});

/** The responses that answered with one status. */
function statusesOf(
  responses: readonly request.Response[],
  status: number,
): request.Response[] {
  return responses.filter((response) => response.status === status);
}

/** Sets how many rooms of a type are already gone on one night. */
async function sell(
  code: RoomTypeCode,
  night: string,
  soldRooms: number,
): Promise<void> {
  const [type] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code))
    .limit(1);

  await db
    .update(typeInventory)
    .set({ soldRooms })
    .where(
      and(
        eq(typeInventory.roomTypeId, type!.id),
        inArray(typeInventory.stayDate, [night]),
      ),
    );
}

/** The two numbers a type's counter holds on one night. */
async function counterOn(
  code: RoomTypeCode,
  night: string,
): Promise<{ totalRooms: number; soldRooms: number }> {
  const [row] = await db
    .select({
      totalRooms: typeInventory.totalRooms,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(and(eq(roomType.code, code), eq(typeInventory.stayDate, night)))
    .limit(1);

  if (!row) {
    throw new Error(`${code} has no counter on ${night}`);
  }

  return row;
}
