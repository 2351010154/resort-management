// The housekeeping API, end to end — `FR-HK-01`'s readiness states, `FR-HK-02`'s
// out-of-order flag and the board, over HTTP against a real Postgres and the
// real capability guard.
//
// `housekeeping-service.e2e-spec.ts` already asserts the upsert, the coalesce,
// the half-open occupancy range and the walking order by calling the service
// directly. None of it can assert what only exists once there are routes, and
// that is what this file is for:
//
// 1. **Every route is governed by the matrix row it declares**, driven off
//    `CAPABILITIES` rather than off a list written out here — `rbac-matrix.md`
//    §4's own instruction, and the reason the board's row is read with
//    `permits(grant, "read")` while the two writes are read as writes.
// 2. **The board carries what `screens.md` says it carries and nothing more.**
//    The tile's keys are asserted exactly, and a guest is checked into one of
//    the rooms first so that "no guest names" is a claim about a board that had
//    a name to leak rather than about an empty property.
// 3. **The wire crossings hold** — an instant leaves as ISO-8601, the business
//    date the tiles were answered against travels back resolved, and the day
//    named in the query is the day the occupancy column is computed for.
// 4. **`OUT_OF_ORDER` moves no counter.** `type_inventory` is read before the
//    status change and after it, which is `FR-HK-02`'s one hard requirement and
//    the reason it is asserted again here: the service test proves the method
//    does not touch the table, this proves the route does not reach anything
//    else that would.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { guest } from "../src/database/schema/guest.js";
import {
  room,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import {
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

const SEED_FROM = parseDate("2027-06-01");

// The property's day. The stay below arrives on it, which is what lets one
// booking make a room genuinely occupied without the clock moving.
const TODAY = parseDate("2027-06-10");
const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";

// A day the stay above does not cover, for the query that asks the board about
// a different date than today.
const AFTER_THE_STAY = "2027-06-20";

const ROLLOVER_HOUR = 4;

// Superiors, per `seed.ts`'s numbering: the twelve take 201–210 and then 301,
// 302. Three rooms, because the three claims below must not interfere — the
// occupied one is checked into, the cleaned one is walked through its states,
// and the closed one is taken out of order.
const OCCUPIED_ROOM = "201";
const CLEANED_ROOM = "203";
const REPAIRED_ROOM = "204";

const A_GUEST = {
  fullName: "Đỗ Thị Lan",
  cccdNumber: "079301009876",
  nationality: "VN",
} as const;

const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL,
  checkOut: DEPARTURE,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

/** What a board tile may say — `screens.md` §Staff surfaces, as a list. */
const TILE_FIELDS = [
  "roomNumber",
  "floor",
  "roomType",
  "status",
  "isReady",
  "isOccupied",
  "note",
  "updatedAt",
  "updatedBy",
] as const;

/** The property's day, stopped — the device every booking suite here uses. */
class StoppedClock extends BusinessDateService {
  constructor() {
    super({ BUSINESS_DATE_ROLLOVER_HOUR: ROLLOVER_HOUR } as Env);
  }

  override current(): StayDate {
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
 * Every housekeeping route, with the matrix row it declares and what it does
 * with it.
 *
 * `action` is part of the data rather than assumed, because the board is the
 * one read here: a role holding 👁 over a row may open the board and may not
 * write a status, and a table that assumed "write" would assert the wrong
 * expectation for it the day the matrix grants one.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "put";
  readonly path: string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "setCondition",
    method: "put",
    path: `/housekeeping/rooms/${CLEANED_ROOM}/condition`,
    capability: "housekeeping.set-condition",
    action: "write",
  },
  {
    name: "setOutOfOrder",
    method: "put",
    path: `/housekeeping/rooms/${CLEANED_ROOM}/out-of-order`,
    capability: "housekeeping.set-out-of-order",
    action: "write",
  },
  {
    name: "board",
    method: "get",
    path: "/housekeeping/board",
    capability: "housekeeping.board",
    action: "read",
  },
];

interface BoardTile {
  readonly roomNumber: string;
  readonly floor: number;
  readonly roomType: string;
  readonly status: string;
  readonly isReady: boolean;
  readonly isOccupied: boolean;
  readonly note: string | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
const tokens = new Map<StaffRole, string>();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The accounts below are created by email and the column is unique, so the
  // five have to be the only five — the seed does not own this table and leaves
  // whatever the last suite signed in with.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  // No synthetic stays: the rooms named above have to be free tonight, and five
  // hundred random holds would decide otherwise.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // The row the seed's wipe leaves behind — `guest_cccd_number_key` refuses a
  // second person carrying the same number, and the check-in below carries one.
  await db.delete(guest).where(eq(guest.cccdNumber, A_GUEST.cccdNumber));

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  await checkAGuestInto(OCCUPIED_ROOM);
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

/**
 * A call as one member of staff.
 *
 * A `GET` carries its arguments in the query string and everything else carries
 * them in the body, which is the one thing this helper knows that the callers
 * below would otherwise each have to.
 */
function as(
  role: StaffRole,
  method: "get" | "post" | "put",
  path: string,
  body: object = {},
): request.Test {
  const call = http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`);

  return method === "get" ? call.query(body) : call.send(body);
}

/**
 * A real stay in a real room, taken through the booking routes.
 *
 * Through HTTP rather than by inserting rows, because what the board's
 * occupancy column is being asked here is whether it agrees with the way a room
 * actually becomes occupied.
 */
async function checkAGuestInto(roomNumber: string): Promise<void> {
  const created = await as("RECEPTIONIST", "post", "/bookings", A_STAY);

  if (created.status !== 201) {
    throw new Error(`the stay was refused: ${JSON.stringify(created.body)}`);
  }

  const bookingId = created.body.id as string;

  await as("RECEPTIONIST", "put", `/bookings/${bookingId}/room`, {
    roomNumber,
  }).expect(200);

  await as("RECEPTIONIST", "post", `/bookings/${bookingId}/check-in`, {
    guests: [A_GUEST],
  }).expect(200);
}

/** The board as one role sees it, for a day named or for the property's own. */
async function board(
  role: StaffRole = "HOUSEKEEPING",
  businessDate?: string,
): Promise<{ businessDate: string; rooms: readonly BoardTile[] }> {
  const response = await as(
    role,
    "get",
    "/housekeeping/board",
    businessDate ? { businessDate } : {},
  ).expect(200);

  return response.body;
}

/** One room's tile, or a failure that names the room rather than a null. */
function tileFor(
  rooms: readonly BoardTile[],
  roomNumber: string,
): BoardTile {
  const tile = rooms.find((each) => each.roomNumber === roomNumber);

  if (!tile) {
    throw new Error(`room ${roomNumber} is missing from the board`);
  }

  return tile;
}

/** Every sellable figure the given room's type has, in date order. */
async function sellable(
  roomNumber: string,
): Promise<readonly { stayDate: string; totalRooms: number }[]> {
  const [held] = await db
    .select({ roomTypeId: room.roomTypeId })
    .from(room)
    .where(eq(room.number, roomNumber))
    .limit(1);

  return await db
    .select({
      stayDate: typeInventory.stayDate,
      totalRooms: typeInventory.totalRooms,
    })
    .from(typeInventory)
    .where(eq(typeInventory.roomTypeId, held!.roomTypeId))
    .orderBy(asc(typeInventory.stayDate));
}

describe("the capability each housekeeping route declares", () => {
  // §4's obligation for the three rows M4's housekeeping routes add. A body is
  // deliberately not sent to the writes — the guard runs before the handler, so
  // an admitted caller answers 400 and a refused one answers 403 either way,
  // and no room changes state while the matrix is being asserted.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.method, route.path);

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http()[route.method](route.path).send().expect(401);
    }
  });
});

describe("a room walked through its readiness states", () => {
  it("records who set the condition, and when", async () => {
    const response = await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${CLEANED_ROOM}/condition`,
      { status: "DIRTY" },
    ).expect(200);

    expect(response.body).toMatchObject({
      roomNumber: CLEANED_ROOM,
      status: "DIRTY",
      note: null,
    });

    // An instant, in full — a room cleaned twice in one day is two answers, so
    // this is the one field here that is a moment rather than a date.
    expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(0);

    const tile = tileFor((await board()).rooms, CLEANED_ROOM);

    expect(tile).toMatchObject({
      status: "DIRTY",
      isReady: false,
      // Taken from the session, never from the body: the board is read to find
      // out who last touched the room.
      updatedBy: STAFF.HOUSEKEEPING.fullName,
    });
    expect(tile.updatedAt).not.toBeNull();
  });

  it("admits a guest again once the room is inspected", async () => {
    await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${CLEANED_ROOM}/condition`,
      { status: "INSPECTED" },
    ).expect(200);

    // `INSPECTED` sits above `CLEAN` rather than beside it — §4 admits a guest
    // into either, which is what the board's own column has to say.
    expect(tileFor((await board()).rooms, CLEANED_ROOM).isReady).toBe(true);
  });

  it("refuses to take a room out of order through the cleaning route", async () => {
    // The capability that admits this call is not the one that governs
    // `OUT_OF_ORDER`, so the status is not in the schema it accepts.
    await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${CLEANED_ROOM}/condition`,
      { status: "OUT_OF_ORDER" },
    ).expect(400);

    expect(tileFor((await board()).rooms, CLEANED_ROOM).status).toBe(
      "INSPECTED",
    );
  });
});

describe("a room taken out of order", () => {
  const REASON = "Shower mixer leaking";

  it("needs a reason", async () => {
    await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${REPAIRED_ROOM}/out-of-order`,
      { outOfOrder: true },
    ).expect(400);
  });

  it("leaves the type's sellable inventory exactly where it was", async () => {
    const before = await sellable(REPAIRED_ROOM);

    const response = await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${REPAIRED_ROOM}/out-of-order`,
      { outOfOrder: true, reason: REASON },
    ).expect(200);

    expect(response.body).toMatchObject({
      roomNumber: REPAIRED_ROOM,
      status: "OUT_OF_ORDER",
      note: REASON,
    });

    // `FR-HK-02`, and the whole reason the closure that *does* move these
    // numbers is a manager's capability on another route: a room nobody may
    // walk into tonight is still a room the property has to sell.
    expect(await sellable(REPAIRED_ROOM)).toEqual(before);

    const tile = tileFor((await board()).rooms, REPAIRED_ROOM);

    expect(tile).toMatchObject({
      status: "OUT_OF_ORDER",
      isReady: false,
      note: REASON,
    });
  });

  it("hands the room back dirty when it is put back", async () => {
    const response = await as(
      "HOUSEKEEPING",
      "put",
      `/housekeeping/rooms/${REPAIRED_ROOM}/out-of-order`,
      { outOfOrder: false },
    ).expect(200);

    // Not `CLEAN`: somebody has been working in there, and guessing the other
    // way would open the room to a guest before a housekeeper has seen it.
    expect(response.body).toMatchObject({ status: "DIRTY", note: null });
  });
});

describe("the board", () => {
  it("answers for every room, floor by floor", async () => {
    const rooms = (await board()).rooms;

    const numbers = await db
      .select({ number: room.number })
      .from(room)
      .orderBy(asc(room.floor), asc(room.number));

    expect(rooms.map((tile) => tile.roomNumber)).toEqual(
      numbers.map((each) => each.number),
    );
  });

  it("carries the room, and no money and no guest", async () => {
    const response = await as("HOUSEKEEPING", "get", "/housekeeping/board")
      .expect(200);
    const tile = tileFor(response.body.rooms, OCCUPIED_ROOM);

    // Asserted as the whole key set rather than as a handful of expectations,
    // because what `screens.md` requires is the absence of fields — a rate, a
    // folio balance, the name of whoever is in the room — and only an exact
    // list can fail when one is added.
    expect(Object.keys(tile).sort()).toEqual([...TILE_FIELDS].sort());

    const [type] = await db
      .select({ code: roomType.code, floor: room.floor })
      .from(room)
      .innerJoin(roomType, eq(roomType.id, room.roomTypeId))
      .where(eq(room.number, OCCUPIED_ROOM))
      .limit(1);

    expect(tile).toMatchObject({ roomType: type!.code, floor: type!.floor });

    // The guest is in the building and named on the registration, so this is a
    // board that had a name available to leak.
    expect(JSON.stringify(response.body)).not.toContain(A_GUEST.fullName);
  });

  it("shows the room the guest is in as occupied, and the others as vacant", async () => {
    const rooms = (await board()).rooms;

    expect(tileFor(rooms, OCCUPIED_ROOM).isOccupied).toBe(true);
    expect(tileFor(rooms, CLEANED_ROOM).isOccupied).toBe(false);
  });

  it("answers against the property's own day, and says which day that was", async () => {
    expect((await board()).businessDate).toBe(TODAY.toString());
  });

  it("answers against the day the caller names", async () => {
    const answered = await board("RECEPTIONIST", AFTER_THE_STAY);

    expect(answered.businessDate).toBe(AFTER_THE_STAY);
    // The stay has ended by then, so the room the guest is in tonight is vacant
    // on that date — the occupancy column is computed for the day asked about.
    expect(tileFor(answered.rooms, OCCUPIED_ROOM).isOccupied).toBe(false);
  });
});
