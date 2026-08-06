// The operational search, end to end — `FR-BOOK-05` over HTTP, against a real
// Postgres and the real capability guard.
//
// The route is the whole requirement, so unlike the other API suites there is no
// service test underneath it re-asserting the rules in a cheaper place. What is
// asserted here:
//
// 1. **The row governs the route**, driven off `CAPABILITIES` rather than off a
//    list of roles written out below — `rbac-matrix.md` §4's own instruction.
//    Every staff role holds `search.operational`, so the interesting refusal is
//    the caller holding no session at all, and the guest realm's `—` is read off
//    the matrix rather than acted out.
// 2. **The `⚠` grant is narrowed by the handler.** `HOUSEKEEPING` gets rooms and
//    the answer has no field a stay or a person could travel in — the claim is
//    made about the whole response body and not about the fields expected to
//    hold them, because the failure being guarded against is a field nobody
//    thought of.
// 3. **Each dimension `FR-BOOK-05` lists finds the right rows**, and a dimension
//    that is a fact about one kind of thing answers nothing about the others.
// 4. **The CCCD is masked and is not a criterion.** A search cannot return the
//    number and cannot be used to confirm one, which is the disclosure
//    `FR-GST-03`'s masking exists to stop.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import {
  capability,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import { permits } from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const SEED_FROM = parseDate("2027-06-01");

const ROLLOVER_HOUR = 4;

// The property's day. The in-house stay arrives on it, which is what makes one
// room genuinely occupied without the clock moving.
const TODAY = parseDate("2027-06-10");
const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";

// A window inside the in-house stay, and one entirely after it.
const WINDOW_OPENS = "2027-06-10";
const WINDOW_CLOSES = "2027-06-12";

// The upcoming stay, placed far enough away that no window below catches both.
const UPCOMING_ARRIVAL = "2027-07-01";
const UPCOMING_DEPARTURE = "2027-07-03";

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302. Two rooms, because the claims must not interfere — one is
// slept in and the other is dirtied.
const OCCUPIED_ROOM = "201";
const DIRTY_ROOM = "203";

// The prefix a desk actually types. `20` is 201 through 209 — nine rooms, not
// ten: 210 is on the same floor and does not contain the fragment, which is the
// honest behaviour of a substring match and not a rule about floors.
const A_FRAGMENT = "20";
const ROOMS_MATCHING_THE_FRAGMENT = 9;

// Junior suites, per the same rule: 501–506.
const SUITE_TYPE = "JUNIOR_SUITE";
const SUITES = 6;

const A_GUEST = {
  fullName: "Đỗ Thị Lan",
  phone: "0901234567",
  cccdNumber: "079301770101",
  nationality: "VN",
} as const;

// The second occupant of the same room, registered on the holder's word and
// with no card of their own — `schema/guest.ts`'s reason for a guest record
// requiring only a name.
const A_COMPANION = { fullName: "Trần Văn Sơn" } as const;

/** A fragment of the number, which must find nobody. */
const CCCD_FRAGMENT = A_GUEST.cccdNumber.slice(-6);

const MASKED = `${"*".repeat(A_GUEST.cccdNumber.length - 4)}${A_GUEST.cccdNumber.slice(-4)}`;

const A_STAY = {
  roomType: "SUPERIOR",
  checkIn: ARRIVAL,
  checkOut: DEPARTURE,
  plan: "STANDARD",
  adults: 2,
  childAges: [],
} as const;

const AN_UPCOMING_STAY = {
  ...A_STAY,
  roomType: "PREMIER",
  checkIn: UPCOMING_ARRIVAL,
  checkOut: UPCOMING_DEPARTURE,
} as const;

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

interface BookingHit {
  readonly id: string;
  readonly reference: string;
  readonly state: string;
  readonly roomType: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomNumber: string | null;
  readonly guestNames: string[];
}

interface RoomHit {
  readonly roomNumber: string;
  readonly roomType: string;
  readonly status: string;
  readonly isOccupied: boolean;
}

let app: INestApplication;
let http: () => request.Agent;
const tokens = new Map<StaffRole, string>();

/** The in-house stay, kept so the reference dimension has one to look for. */
let inHouse: { id: string; reference: string };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useClass(StoppedClock)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  const db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The people are emptied as well as the staff, and before the seed rather
  // than after it. `seed.ts` deliberately leaves `guest` rows alone — "a person
  // is not owned by one stay" — so a suite that checks a guest in by CCCD runs
  // exactly once otherwise: `guest_cccd_number_key` refuses the second, and the
  // desk is told to use the record the property already has.
  await db.execute(
    sql`truncate cccd_unmask_audit, registration, guest, staff_session, staff_user restart identity cascade`,
  );

  // No synthetic stays. Every claim below counts rows, and five hundred random
  // holds would decide how many there are.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  inHouse = await aStayInHouse();
  await anUpcomingStay();
  await dirty(DIRTY_ROOM);
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

/** A search, as the role that ran it. */
function search(role: StaffRole, query: string): request.Test {
  return as(role, "get", `/search?${query}`);
}

/**
 * A stay arriving today, in a room, with somebody registered in it.
 *
 * Walked through the real routes rather than written straight to the tables: a
 * registration row is written by the transition that reaches `CHECKED_IN`, and
 * arranging one by hand would assert the search against a state the state
 * machine cannot produce.
 */
async function aStayInHouse(): Promise<{ id: string; reference: string }> {
  const created = await as("RECEPTIONIST", "post", "/bookings", A_STAY).expect(
    201,
  );

  const id = created.body.id as string;

  await as("RECEPTIONIST", "put", `/bookings/${id}/room`, {
    roomNumber: OCCUPIED_ROOM,
  }).expect(200);

  // Two people, and the holder first — `checkInInput` takes the order the desk
  // entered them as which of the two the folio is addressed to.
  await as("RECEPTIONIST", "post", `/bookings/${id}/check-in`, {
    guests: [A_GUEST, A_COMPANION],
  }).expect(200);

  return { id, reference: created.body.reference as string };
}

/** A stay in July, holding no room and nobody registered on it. */
async function anUpcomingStay(): Promise<string> {
  const created = await as(
    "RECEPTIONIST",
    "post",
    "/bookings",
    AN_UPCOMING_STAY,
  ).expect(201);

  return created.body.id as string;
}

async function dirty(roomNumber: string): Promise<void> {
  await as("HOUSEKEEPING", "put", `/housekeeping/rooms/${roomNumber}/condition`, {
    status: "DIRTY",
  }).expect(200);
}

const numbersOf = (rooms: RoomHit[]) => rooms.map((tile) => tile.roomNumber);
const referencesOf = (bookings: BookingHit[]) =>
  bookings.map((hit) => hit.reference);

describe("the capability the search route declares", () => {
  // §4's obligation for this row: every role is put to the route and the
  // expectation is read off the matrix rather than written down twice. A room
  // number nobody has, so an admitted caller answers 200 with nothing in it and
  // a refused one answers 403.
  for (const role of STAFF_ROLES) {
    const admitted = permits(staffGrant("search.operational", role), "read");

    it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
      const response = await search(role, "roomNumber=999");

      if (admitted) {
        // 200 and not merely "not 403": a fault would also fail to be a
        // refusal, and a row that admits a role by answering 500 has not
        // admitted them to anything.
        expect(response.status).toBe(200);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it("is closed to the guest realm in the matrix", async () => {
    // The refusal a staff token cannot demonstrate, because every staff role
    // holds this row. Read off the document rather than acted out: a guest
    // session is a different realm with its own sign-in, and what matters here
    // is that the row the route declares denies it.
    expect(capability("search.operational").guest).toBe("denied");
  });

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in first.
    await http().get("/search?roomNumber=201").expect(401);
  });
});

describe("what a housekeeper is answered", () => {
  it("gets rooms, in an answer with no field a stay could travel in", async () => {
    const response = await search(
      "HOUSEKEEPING",
      `roomNumber=${OCCUPIED_ROOM}`,
    ).expect(200);

    expect(response.body.scope).toBe("rooms");
    expect(numbersOf(response.body.rooms)).toEqual([OCCUPIED_ROOM]);

    // The matrix's "HK: rooms only", as a shape. Not empty arrays that a
    // handler could later fill — the keys are absent.
    expect(response.body).not.toHaveProperty("bookings");
    expect(response.body).not.toHaveProperty("guests");

    // The claim is about the whole body rather than the fields expected to hold
    // them: the room is occupied by a named guest, and neither the name nor the
    // reference of their stay is anywhere in it. `screens.md` §Staff surfaces —
    // housekeeping sees no money and no guest names.
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(A_GUEST.fullName);
    expect(body).not.toContain(A_COMPANION.fullName);
    expect(body).not.toContain(A_GUEST.phone);
    expect(body).not.toContain(inHouse.reference);
  });

  it("still shows the room as occupied, without saying by whom", async () => {
    const response = await search(
      "HOUSEKEEPING",
      `roomNumber=${OCCUPIED_ROOM}`,
    ).expect(200);

    // `FR-HK-01` puts cleaning and occupancy on separate axes, and the tile a
    // search returns is the board's own — a housekeeper needs to know somebody
    // is in there without being told who.
    expect(response.body.rooms[0]).toMatchObject({
      roomNumber: OCCUPIED_ROOM,
      roomType: "SUPERIOR",
      isOccupied: true,
    });
  });

  it("is answered nothing when it asks about a person", async () => {
    // A guest name is not a fact about a room, so the narrowed scope has
    // nothing to answer with — rather than quietly widening to every room.
    const response = await search("HOUSEKEEPING", "guestName=Lan").expect(200);

    expect(response.body).toMatchObject({ scope: "rooms", rooms: [] });
  });
});

describe("what the desk is answered", () => {
  it("gets all three kinds of thing", async () => {
    for (const role of ["RECEPTIONIST", "MANAGER", "ADMIN"] as const) {
      const response = await search(role, `roomNumber=${OCCUPIED_ROOM}`).expect(
        200,
      );

      expect(response.body.scope).toBe("everything");
    }
  });

  it("is opened to a role holding the row read-only", async () => {
    // `ACCOUNTANT` holds 👁 on this row, and the route declares itself a read —
    // a route left at the strict write default would refuse them the search the
    // matrix grants.
    const response = await search(
      "ACCOUNTANT",
      `roomNumber=${OCCUPIED_ROOM}`,
    ).expect(200);

    expect(response.body.scope).toBe("everything");
  });

  it("carries no amount on any hit", async () => {
    // A search says which stay, never what it costs. The folio is `M6`'s and a
    // lookup has no use for a total, so there is no field for one to leak into.
    const response = await search(
      "RECEPTIONIST",
      `roomNumber=${OCCUPIED_ROOM}`,
    ).expect(200);

    expect(response.body.bookings[0]).not.toHaveProperty("stayTotalGross");
  });
});

describe("the dimensions FR-BOOK-05 lists", () => {
  it("finds a room by its number, and the stay that holds it", async () => {
    const response = await search(
      "RECEPTIONIST",
      `roomNumber=${OCCUPIED_ROOM}`,
    ).expect(200);

    expect(numbersOf(response.body.rooms)).toEqual([OCCUPIED_ROOM]);

    expect(response.body.bookings).toHaveLength(1);
    expect(response.body.bookings[0]).toMatchObject({
      reference: inHouse.reference,
      state: "CHECKED_IN",
      roomNumber: OCCUPIED_ROOM,
      // Nine characters, not an object of loose numbers — the crossing
      // `stay-date.ts` declares.
      checkIn: ARRIVAL,
      checkOut: DEPARTURE,
      // Everybody registered in the room, the holder first — which is what
      // makes "who is in 201" a question the search answers.
      guestNames: [A_GUEST.fullName, A_COMPANION.fullName],
    });

    // A room number says nothing about who a person is, so the guest set is not
    // answered — the people in that room are already named on the stay above.
    expect(response.body.guests).toEqual([]);
  });

  it("matches a room number as a fragment", async () => {
    // How the desk searches: two characters of a number, not a room nobody has.
    const response = await search(
      "RECEPTIONIST",
      `roomNumber=${A_FRAGMENT}`,
    ).expect(200);

    expect(response.body.rooms).toHaveLength(ROOMS_MATCHING_THE_FRAGMENT);
  });

  it("finds rooms by type", async () => {
    const response = await search(
      "RECEPTIONIST",
      `roomType=${SUITE_TYPE}`,
    ).expect(200);

    expect(response.body.rooms).toHaveLength(SUITES);
    expect(
      response.body.rooms.every((tile: RoomHit) => tile.roomType === SUITE_TYPE),
    ).toBe(true);

    // Neither stay was sold as a suite, so the type finds no booking either.
    expect(response.body.bookings).toEqual([]);
  });

  it("finds rooms by the state they are in, and no stays at all", async () => {
    const response = await search("RECEPTIONIST", "roomStatus=DIRTY").expect(
      200,
    );

    expect(numbersOf(response.body.rooms)).toEqual([DIRTY_ROOM]);

    // Whether a room has been cleaned this morning is not a fact about a stay
    // booked into it in July, so no booking is answered — rather than every
    // booking the property has taken.
    expect(response.body.bookings).toEqual([]);
    expect(response.body.guests).toEqual([]);
  });

  it("finds the stays a date range covers, and the rooms they were in", async () => {
    const response = await search(
      "RECEPTIONIST",
      `from=${WINDOW_OPENS}&to=${WINDOW_CLOSES}`,
    ).expect(200);

    expect(referencesOf(response.body.bookings)).toEqual([inHouse.reference]);
    expect(numbersOf(response.body.rooms)).toEqual([OCCUPIED_ROOM]);
  });

  it("leaves out a stay the window does not reach", async () => {
    const response = await search(
      "RECEPTIONIST",
      `from=${UPCOMING_ARRIVAL}&to=${UPCOMING_DEPARTURE}`,
    ).expect(200);

    expect(referencesOf(response.body.bookings)).not.toContain(
      inHouse.reference,
    );
    expect(response.body.bookings).toHaveLength(1);

    // The July stay holds no room, so nothing is occupied in that window.
    expect(response.body.rooms).toEqual([]);
  });

  it("finds a person by name, and the stay they are registered on", async () => {
    const response = await search("RECEPTIONIST", "guestName=Lan").expect(200);

    expect(response.body.guests).toHaveLength(1);
    expect(response.body.guests[0]).toMatchObject({
      fullName: A_GUEST.fullName,
      phone: A_GUEST.phone,
    });

    expect(referencesOf(response.body.bookings)).toEqual([inHouse.reference]);
  });

  it("finds a person by the last digits of their telephone number", async () => {
    const response = await search("RECEPTIONIST", "guestPhone=4567").expect(200);

    expect(response.body.guests).toHaveLength(1);
    expect(response.body.guests[0]!.fullName).toBe(A_GUEST.fullName);
  });

  it("finds stays by the state they are in", async () => {
    const confirmed = await search("RECEPTIONIST", "state=CONFIRMED").expect(
      200,
    );

    expect(referencesOf(confirmed.body.bookings)).not.toContain(
      inHouse.reference,
    );
    expect(confirmed.body.bookings).toHaveLength(1);

    const checkedIn = await search("RECEPTIONIST", "state=CHECKED_IN").expect(
      200,
    );

    expect(referencesOf(checkedIn.body.bookings)).toEqual([inHouse.reference]);
  });

  it("finds a stay by its reference", async () => {
    const response = await search(
      "RECEPTIONIST",
      `reference=${inHouse.reference}`,
    ).expect(200);

    expect(referencesOf(response.body.bookings)).toEqual([inHouse.reference]);
    expect(response.body.rooms).toEqual([]);
  });

  it("narrows rather than widens when two dimensions are given", async () => {
    // The type the in-house stay was not sold as, together with its own room
    // number: an `or` would answer with both, and the desk asking two questions
    // is asking for the rows that satisfy both.
    const response = await search(
      "RECEPTIONIST",
      `roomNumber=${OCCUPIED_ROOM}&roomType=${SUITE_TYPE}`,
    ).expect(200);

    expect(response.body.rooms).toEqual([]);
  });
});

describe("the wildcards a caller can type", () => {
  // A criterion is a fragment matched anywhere in a column, so the `like`
  // metacharacters are the one input that could widen a filter instead of
  // narrowing it. Escaped, they are ordinary characters and match the rows that
  // contain them — which is none of these. Left unescaped, each query below
  // answers with the row named beside it, so a regression here fails loudly
  // rather than by returning slightly too much.
  it("treats a per-cent sign as a character and not as every row", async () => {
    const response = await search(
      "RECEPTIONIST",
      `guestName=${encodeURIComponent("%")}`,
    ).expect(200);

    // Unescaped this is `ilike '%%%'`, which is every person the property has
    // on file and every stay one of them is registered on.
    expect(response.body.guests).toEqual([]);
    expect(response.body.bookings).toEqual([]);
  });

  it("treats an underscore as a character and not as any single one", async () => {
    const response = await search("RECEPTIONIST", "roomNumber=_").expect(200);

    // Unescaped this is `ilike '%_%'`, which every room number in the property
    // matches — the rooms by way of the board and the in-house stay by way of
    // the assignment it holds.
    expect(response.body.rooms).toEqual([]);
    expect(response.body.bookings).toEqual([]);
  });
});

describe("the number a search may not reach", () => {
  it("masks the CCCD on every hit it returns", async () => {
    const response = await search("RECEPTIONIST", "guestName=Lan").expect(200);

    expect(response.body.guests[0]!.cccdMasked).toBe(MASKED);

    // The claim is about the whole body, not the field that was expected to
    // hold it.
    expect(JSON.stringify(response.body)).not.toContain(A_GUEST.cccdNumber);
  });

  it("is not a criterion a caller can invent", async () => {
    // There is no CCCD filter, so a query carrying only one carries no
    // criterion at all — and a search with no criteria is refused rather than
    // answered with the property. This is the regression guard on that: adding
    // the filter would have to change the contract, which is a review somebody
    // gets to have.
    await search("RECEPTIONIST", `cccdNumber=${A_GUEST.cccdNumber}`).expect(400);
  });

  it("cannot be confirmed through a dimension that does exist", async () => {
    // The disclosure the masking exists to stop: a caller who has four digits
    // and wants the rest must not be able to test a guess against a name or a
    // phone filter and read the answer off the result count.
    const byName = await search(
      "RECEPTIONIST",
      `guestName=${CCCD_FRAGMENT}`,
    ).expect(200);

    expect(byName.body.guests).toEqual([]);

    const byPhone = await search(
      "RECEPTIONIST",
      `guestPhone=${CCCD_FRAGMENT}`,
    ).expect(200);

    expect(byPhone.body.guests).toEqual([]);
  });
});

describe("a query the route refuses", () => {
  it("refuses a search with no criteria", async () => {
    await search("RECEPTIONIST", "").expect(400);
  });

  it("refuses a date range with one end", async () => {
    await search("RECEPTIONIST", `from=${WINDOW_OPENS}`).expect(400);
    await search("RECEPTIONIST", `to=${WINDOW_CLOSES}`).expect(400);
  });

  it("refuses a range that closes before it opens", async () => {
    await search(
      "RECEPTIONIST",
      `from=${WINDOW_CLOSES}&to=${WINDOW_OPENS}`,
    ).expect(400);
  });

  it("refuses a room status that is not one", async () => {
    await search("RECEPTIONIST", "roomStatus=SPOTLESS").expect(400);
  });
});
