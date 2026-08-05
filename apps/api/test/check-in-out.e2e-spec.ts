// Arrival and departure — `booking-state-machine.md` §2's `CONFIRMED →
// CHECKED_IN` and `CHECKED_IN → CHECKED_OUT`, with §3's effects and §4's guards.
//
// Four of the things asserted below are not this service's logic but the
// database's or another module's, and that is why they are asserted against a
// real one: the registration record has a unique index that makes registering a
// party twice unrepresentable, the room comes back `DIRTY` through
// `HousekeepingService`, the released nights land on `type_inventory`, and the
// folio balance arrives through `folio.port.ts` from whatever is bound to it. A
// suite built on stand-ins would prove that this file calls four collaborators,
// which is not the claim §3 makes.
//
// No Nest application is booted — the routes these transitions answer are a
// later task's, so this opens the transaction the way a controller will. The
// property's day is stopped, for the reason `booking-lifecycle.e2e-spec.ts`
// gives: every stay here is a 2027 date inside the seeded calendar, and the
// whole meaning of an arrival window is where today falls against it.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking } from "../src/database/schema/booking.js";
import { guest, registration } from "../src/database/schema/guest.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import * as schema from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import type { FolioPort } from "../src/modules/booking/ports/folio.port.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";

const SEED_FROM = parseDate("2027-06-01");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-15";
const NIGHTS = 5;

const A_GUEST = {
  fullName: "Trần Thị Mai",
  cccdNumber: "079301004321",
  nationality: "VN",
} as const;

const ROLLOVER_HOUR = 4;
const HOLD_TTL_MINUTES = 20;

/**
 * The property's day, stopped — the same device
 * `booking-lifecycle.e2e-spec.ts` uses and for the same reason. The hour and the
 * zone stay the real service's; only the instant it reads is fixed.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super({ BUSINESS_DATE_ROLLOVER_HOUR: ROLLOVER_HOUR } as Env);
  }

  override current(): StayDate {
    return this.today;
  }
}

/**
 * A folio reporting whatever the case needs.
 *
 * The real binding at `M4` is `folio-stub.service.ts`, which reports every folio
 * settled — so the guard would never refuse and the assertion that it runs at
 * all would be vacuous. This is the same port with the other answer, which is
 * exactly what `M6` will hand the transition once there is a ledger.
 */
class FolioOwing implements FolioPort {
  constructor(private readonly balance: VndAmount) {}

  async getBalance(): Promise<VndAmount> {
    return this.balance;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let reference = 7_000;

/** The desk, on a given day, against a folio with a given balance. */
function deskAt(today: StayDate, balance: VndAmount = 0n): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(inventory, clock, new StayQuoteService()),
    new GuestService(),
    new HousekeepingService(),
    new FolioOwing(balance),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
  );
}

/** The rooms service, on a given day. */
function roomsAt(today: StayDate): AssignmentService {
  return new AssignmentService(
    new InventoryService(),
    new StoppedClock(today),
    new StayQuoteService(),
  );
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });
});

// Every case starts against the property as the seed laid it down. Several want
// the same Superior on the same night, and the twelve the property owns are not
// a budget a suite should have to plan around.
beforeEach(async () => {
  await db.execute(
    sql`truncate registration, room_assignment, booking, guest restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

async function typeId(code: RoomTypeCode): Promise<string> {
  const [found] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code))
    .limit(1);

  return found!.id;
}

/** A confirmed stay with its nights consumed, as the funnel would leave it. */
async function confirmedStay(
  options: { checkIn?: string; checkOut?: string; state?: "CONFIRMED" } = {},
): Promise<string> {
  const checkIn = options.checkIn ?? ARRIVAL;
  const checkOut = options.checkOut ?? DEPARTURE;

  reference += 1;

  await new InventoryService().reserve(db, {
    roomType: "SUPERIOR",
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
  });

  const [made] = await db
    .insert(booking)
    .values({
      reference: `MRV-20270610-${reference}`,
      state: "CONFIRMED",
      roomTypeId: await typeId("SUPERIOR"),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_000_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return made!.id;
}

/** A stay that is confirmed and holds a room, ready to be checked in. */
async function stayHolding(
  roomNumber: string,
  options: { checkIn?: string; checkOut?: string } = {},
): Promise<string> {
  const id = await confirmedStay(options);

  await db.transaction(
    async (tx) =>
      await roomsAt(SEED_FROM).assign(tx, { bookingId: id, roomNumber }),
  );

  return id;
}

/** The status one room is in. */
async function conditionOf(roomNumber: string): Promise<string | null> {
  const [found] = await db
    .select({ status: roomCondition.status })
    .from(roomCondition)
    .innerJoin(room, eq(room.id, roomCondition.roomId))
    .where(eq(room.number, roomNumber))
    .limit(1);

  return found?.status ?? null;
}

/** `sold_rooms` for a type on one night. */
async function soldOn(code: RoomTypeCode, night: string): Promise<number> {
  const [row] = await db
    .select({ soldRooms: typeInventory.soldRooms })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(and(eq(roomType.code, code), eq(typeInventory.stayDate, night)))
    .limit(1);

  return row!.soldRooms;
}

/** The refusal code, and the `data.code` the desk branches on. */
async function refusalOf(
  operation: Promise<unknown>,
): Promise<{ status: string; code: unknown }> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof ORPCError) {
      return {
        status: error.code,
        code: (error.data as { code?: unknown } | undefined)?.code,
      };
    }

    throw error;
  }

  throw new Error("The operation was expected to be refused and was not");
}

describe("checking a guest in", () => {
  it("moves a confirmed stay into the building on its arrival date", async () => {
    const id = await stayHolding(SUPERIOR);

    const arrived = await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(arrived.state).toBe("CHECKED_IN");
  });

  it("writes the registration record §3 requires", async () => {
    // §1 files the record as a property of the state rather than as a later
    // step, and the timing is the point: a booking can be cancelled, expire or
    // no-show without anybody ever being identified.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST, { fullName: "Lê Văn Hùng" }],
        }),
    );

    const registered = await db
      .select({
        fullName: guest.fullName,
        isPrimary: registration.isPrimary,
      })
      .from(registration)
      .innerJoin(guest, eq(guest.id, registration.guestId))
      .where(eq(registration.bookingId, id))
      .orderBy(registration.registeredAt);

    expect(registered).toHaveLength(2);

    // The booking holder is the one the folio is addressed to, and exactly one
    // row may claim it — `registration_one_primary_per_booking_key`.
    expect(registered.filter((each) => each.isPrimary)).toEqual([
      { fullName: A_GUEST.fullName, isPrimary: true },
    ]);
  });

  it("registers a guest the property has met before without duplicating them", async () => {
    // A second row carrying the same CCCD is refused by `guest_cccd_key`, so a
    // check-in that could only create would turn every repeat visit into a
    // conflict at the desk.
    const [returning] = await db
      .insert(guest)
      .values({ fullName: A_GUEST.fullName, cccdNumber: A_GUEST.cccdNumber })
      .returning({ id: guest.id });

    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [{ guestId: returning!.id }],
        }),
    );

    expect(await db.select({ id: guest.id }).from(guest)).toHaveLength(1);
  });

  it("refuses a stay that arrives tomorrow", async () => {
    // §4's arrival window, early half. §7's first ⚑ is off by default, which is
    // what this asserts against.
    const id = await stayHolding(SUPERIOR);

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate("2027-06-09")).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal).toEqual({
      status: "CONFLICT",
      code: "ARRIVAL_WINDOW_EARLY",
    });
  });

  it("refuses a stay whose departure date has passed", async () => {
    const id = await stayHolding(SUPERIOR);

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate("2027-06-16")).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal).toEqual({
      status: "CONFLICT",
      code: "ARRIVAL_WINDOW_LATE",
    });
  });

  it("refuses a stay holding no room", async () => {
    // §4's room requirement, and §1's table states it as a property of the
    // state: `CHECKED_IN` is the one row whose "room assigned" column reads Yes.
    const id = await confirmedStay();

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal).toEqual({ status: "CONFLICT", code: "ROOM_NOT_ASSIGNED" });
  });

  it("refuses a room that has not been cleaned", async () => {
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await new HousekeepingService().setCondition(tx, {
          roomNumber: SUPERIOR,
          status: "DIRTY",
        }),
    );

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal).toEqual({ status: "CONFLICT", code: "ROOM_NOT_READY" });
  });

  it("refuses a room with a fault in it, with its own code", async () => {
    // §7: the dirty-room flag relaxes `DIRTY` and only `DIRTY`. The desk calls
    // housekeeping about the first and moves the guest out of the second, which
    // is why they are two values rather than one.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await new HousekeepingService().setOutOfOrder(tx, {
          roomNumber: SUPERIOR,
          outOfOrder: true,
          reason: "Shower mixer leaking",
        }),
    );

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal).toEqual({ status: "CONFLICT", code: "ROOM_OUT_OF_ORDER" });
  });

  it("admits a guest into an inspected room", async () => {
    // `INSPECTED` beside `CLEAN` rather than above it — the supervisor pass is
    // optional, and requiring it would stop check-in at every property that does
    // not run one.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await new HousekeepingService().setCondition(tx, {
          roomNumber: SUPERIOR,
          status: "INSPECTED",
        }),
    );

    const arrived = await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(arrived.state).toBe("CHECKED_IN");
  });

  it("refuses the arrival window before it asks about the room", async () => {
    // The order §4 lists the guards in, and it is the order the desk can act on:
    // sending a housekeeper to a room the guest may not have yet is work nobody
    // needed. The stay below is early *and* holds no room, and only the first
    // refusal is the answer.
    const id = await confirmedStay();

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate("2027-06-01")).checkIn(tx, {
            bookingId: id,
            guests: [A_GUEST],
          }),
      ),
    );

    expect(refusal.code).toBe("ARRIVAL_WINDOW_EARLY");
  });

  it("registers nobody twice when the button is pressed twice", async () => {
    // §4's idempotency row. The unique index would refuse the second party as a
    // constraint violation; this returns the state instead, which is the polite
    // answer §4 asks for.
    const id = await stayHolding(SUPERIOR);
    const desk = deskAt(parseDate(ARRIVAL));

    await db.transaction(
      async (tx) =>
        await desk.checkIn(tx, { bookingId: id, guests: [A_GUEST] }),
    );

    const again = await db.transaction(
      async (tx) =>
        await desk.checkIn(tx, { bookingId: id, guests: [A_GUEST] }),
    );

    expect(again.state).toBe("CHECKED_IN");
    expect(
      await db
        .select({ id: registration.id })
        .from(registration)
        .where(eq(registration.bookingId, id)),
    ).toHaveLength(1);
  });

  it("refuses a check-in that registers nobody", async () => {
    const id = await stayHolding(SUPERIOR);

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) =>
              await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
                bookingId: id,
                guests: [],
              }),
          ),
        )
      ).status,
    ).toBe("BAD_REQUEST");
  });

  it("leaves the room's condition alone", async () => {
    // §3 gives check-in no housekeeping effect: the room was clean before the
    // guest walked in and it is clean after.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(await conditionOf(SUPERIOR)).toBeNull();
  });
});

describe("checking a guest out", () => {
  /** A stay in the building, arrived on its arrival date. */
  async function inTheBuilding(
    roomNumber = SUPERIOR,
    options: { checkIn?: string; checkOut?: string } = {},
  ): Promise<string> {
    const id = await stayHolding(roomNumber, options);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(options.checkIn ?? ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    return id;
  }

  it("closes the stay on the departure date", async () => {
    const id = await inTheBuilding();

    const departed = await db.transaction(
      async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
    );

    expect(departed.state).toBe("CHECKED_OUT");
  });

  it("hands the room back to housekeeping as dirty", async () => {
    // §3's "Other" column, and `FR-HK-01`. Attributed to nobody, because the
    // property is not making a cleaning judgement — it is stating that somebody
    // has been in the room.
    const id = await inTheBuilding();

    await db.transaction(
      async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
    );

    expect(await conditionOf(SUPERIOR)).toBe("DIRTY");
  });

  it("releases no night when the guest leaves on the day they were due to", async () => {
    // There was never an unspent night to give back, and the range is empty.
    const id = await inTheBuilding();

    const before = await soldOn("SUPERIOR", "2027-06-14");

    await db.transaction(
      async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
    );

    expect(await soldOn("SUPERIOR", "2027-06-14")).toBe(before);
  });

  it("puts the unspent nights back when the guest leaves early", async () => {
    // §3's inventory effect. A guest leaving on the 12th slept the 10th and the
    // 11th; the 12th, 13th and 14th are nights the property can still sell, and
    // the night of the 12th runs from the 12th into the 13th — at any hour of
    // the property's day it has not happened yet.
    const id = await inTheBuilding();

    const soldBefore = await Promise.all(
      ["2027-06-10", "2027-06-11", "2027-06-12", "2027-06-13", "2027-06-14"].map(
        async (night) => await soldOn("SUPERIOR", night),
      ),
    );

    await db.transaction(
      async (tx) => await deskAt(parseDate("2027-06-12")).checkOut(tx, id),
    );

    const soldAfter = await Promise.all(
      ["2027-06-10", "2027-06-11", "2027-06-12", "2027-06-13", "2027-06-14"].map(
        async (night) => await soldOn("SUPERIOR", night),
      ),
    );

    // The nights slept stay sold; the rest come back.
    expect(soldAfter).toEqual([
      soldBefore[0],
      soldBefore[1],
      soldBefore[2]! - 1,
      soldBefore[3]! - 1,
      soldBefore[4]! - 1,
    ]);
  });

  it("stops holding the room for nights it has just put back on sale", async () => {
    // Left running to the original departure date, the hold would keep the room
    // against `room_assignment_no_double_booking` for nights the counter now
    // reads as free — the two layers disagreeing, with the room unsellable.
    const id = await inTheBuilding();

    await db.transaction(
      async (tx) => await deskAt(parseDate("2027-06-12")).checkOut(tx, id),
    );

    const [held] = await db
      .select({ checkOutDate: roomAssignment.checkOutDate })
      .from(roomAssignment)
      .where(eq(roomAssignment.bookingId, id));

    expect(held!.checkOutDate).toBe("2027-06-12");
  });

  it("lets the freed room be given to somebody else that night", async () => {
    // The point of the two assertions above, stated as the outcome the desk
    // cares about: a walk-in can have the room tonight.
    const leaving = await inTheBuilding();

    await db.transaction(
      async (tx) => await deskAt(parseDate("2027-06-12")).checkOut(tx, leaving),
    );

    const walkIn = await confirmedStay({
      checkIn: "2027-06-12",
      checkOut: "2027-06-14",
    });

    const held = await db.transaction(
      async (tx) =>
        await roomsAt(parseDate("2027-06-12")).assign(tx, {
          bookingId: walkIn,
          roomNumber: SUPERIOR,
        }),
    );

    expect(held.roomNumber).toBe(SUPERIOR);
  });

  it("refuses a check-out over a folio that does not balance", async () => {
    // §4's one guard against this transition, asked through the port. `M6` binds
    // the ledger behind the same interface and this transition does not change.
    const id = await inTheBuilding();

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate(DEPARTURE), 250_000n).checkOut(tx, id),
      ),
    );

    expect(refusal).toEqual({ status: "CONFLICT", code: "FOLIO_NOT_SETTLED" });
  });

  it("refuses a check-out over a folio the property owes the guest", async () => {
    // "Balance ≠ 0", not "> 0". A guest owed a refund at the desk is as
    // unsettled as one who owes.
    const id = await inTheBuilding();

    const refusal = await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate(DEPARTURE), -100_000n).checkOut(tx, id),
      ),
    );

    expect(refusal.code).toBe("FOLIO_NOT_SETTLED");
  });

  it("leaves the room occupied when the folio refuses the departure", async () => {
    // The transaction is the caller's, so a refusal rolls the whole departure
    // back — the room is not dirtied and the nights are not released for a stay
    // that is still going on.
    const id = await inTheBuilding();

    await refusalOf(
      db.transaction(
        async (tx) =>
          await deskAt(parseDate("2027-06-12"), 250_000n).checkOut(tx, id),
      ),
    );

    expect(await conditionOf(SUPERIOR)).toBeNull();

    const [state] = await db
      .select({ state: booking.state })
      .from(booking)
      .where(eq(booking.id, id));

    expect(state!.state).toBe("CHECKED_IN");
  });

  it("does not release the nights twice when the button is pressed twice", async () => {
    // §4's idempotency row, and the release is what makes it matter: a second
    // check-out that answered politely and released again would credit the
    // property with inventory it never sold.
    const id = await inTheBuilding();
    const desk = deskAt(parseDate("2027-06-12"));

    await db.transaction(async (tx) => await desk.checkOut(tx, id));

    const afterFirst = await soldOn("SUPERIOR", "2027-06-13");

    const again = await db.transaction(
      async (tx) => await desk.checkOut(tx, id),
    );

    expect(again.state).toBe("CHECKED_OUT");
    expect(await soldOn("SUPERIOR", "2027-06-13")).toBe(afterFirst);
  });

  it("refuses to check out a booking that never arrived", async () => {
    // `CONFIRMED → CHECKED_OUT` is not a cell §2 draws, so the table refuses it
    // before any guard is consulted.
    const id = await stayHolding(ANOTHER_SUPERIOR);

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
          ),
        )
      ).status,
    ).toBe("CONFLICT");
  });

  it("releases every night when a guest leaves the day they arrived", async () => {
    // The whole stay is unspent, and the assignment covers no night at all — so
    // it is dropped rather than closed at its own start date, which
    // `room_assignment_covers_at_least_one_night` refuses.
    const id = await inTheBuilding();

    const before = await soldOn("SUPERIOR", ARRIVAL);

    await db.transaction(
      async (tx) => await deskAt(parseDate(ARRIVAL)).checkOut(tx, id),
    );

    expect(await soldOn("SUPERIOR", ARRIVAL)).toBe(before - 1);
    expect(
      await db
        .select({ id: roomAssignment.id })
        .from(roomAssignment)
        .where(eq(roomAssignment.bookingId, id)),
    ).toHaveLength(0);

    // The room still comes back dirty. Somebody was in it, however briefly.
    expect(await conditionOf(SUPERIOR)).toBe("DIRTY");
  });

  it("keeps every night sold for a stay that ran its course", async () => {
    const id = await inTheBuilding();

    const before = await Promise.all(
      ["2027-06-10", "2027-06-14"].map(
        async (night) => await soldOn("SUPERIOR", night),
      ),
    );

    await db.transaction(
      async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
    );

    expect(
      await Promise.all(
        ["2027-06-10", "2027-06-14"].map(
          async (night) => await soldOn("SUPERIOR", night),
        ),
      ),
    ).toEqual(before);

    // And the hold ends where it always did — the stay was not shortened.
    const [held] = await db
      .select({ checkOutDate: roomAssignment.checkOutDate })
      .from(roomAssignment)
      .where(eq(roomAssignment.bookingId, id));

    expect(held!.checkOutDate).toBe(DEPARTURE);
  });
});

describe("the stay as a whole", () => {
  it("consumes exactly the nights it was sold, arrival to departure", async () => {
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );
    await db.transaction(
      async (tx) => await deskAt(parseDate(DEPARTURE)).checkOut(tx, id),
    );

    const nights = await Promise.all(
      Array.from({ length: NIGHTS }, async (_unused, offset) =>
        soldOn("SUPERIOR", parseDate(ARRIVAL).add({ days: offset }).toString()),
      ),
    );

    expect(nights).toEqual(Array.from({ length: NIGHTS }, () => 1));

    // And the departure date was never one of them — `[)`, like every range in
    // the system.
    expect(await soldOn("SUPERIOR", DEPARTURE)).toBe(0);
  });
});
