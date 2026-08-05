// The guest who never came, and the one who came anyway —
// `booking-state-machine.md` §2's `CONFIRMED → NO_SHOW` and `NO_SHOW →
// CHECKED_IN`, with §3's inventory effects.
//
// Almost everything asserted below is a number on `type_inventory`, because §3
// states both transitions as arithmetic on it: "release nights **after** the
// arrival night" and "re-consume remaining nights, fail if unavailable". A suite
// that checked the state column would prove the enum was written and nothing at
// all about the rooms the property can still sell that week, which is the only
// reason either transition exists.
//
// The two ways a reinstatement fails are both the database's and are asserted
// against a real one. `type_inventory_sold_at_most_total` refuses the stay whose
// type sold out while the guest was missing; `room_assignment_no_double_booking`
// refuses the one whose actual room was given away. Neither can be proved
// against a stand-in, and the difference between them is what the desk acts on —
// the first needs different dates, the second a different key.
//
// No Nest application is booted and the property's day is stopped, both for the
// reason `check-in-out.e2e-spec.ts` gives: the routes are a later task's, and a
// late arrival is defined entirely by where today falls against the stay.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking } from "../src/database/schema/booking.js";
import { registration } from "../src/database/schema/guest.js";
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
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";

const SEED_FROM = parseDate("2027-06-01");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-15";

/** The nights a five-night stay is sold, arrival first. */
const NIGHTS = [
  "2027-06-10",
  "2027-06-11",
  "2027-06-12",
  "2027-06-13",
  "2027-06-14",
] as const;

const A_GUEST = {
  fullName: "Trần Thị Mai",
  cccdNumber: "079301004321",
  nationality: "VN",
} as const;

const ROLLOVER_HOUR = 4;
const HOLD_TTL_MINUTES = 20;

/**
 * The property's day, stopped — the same device `check-in-out.e2e-spec.ts` uses
 * and for the same reason. The hour and the zone stay the real service's; only
 * the instant it reads is fixed.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super({ BUSINESS_DATE_ROLLOVER_HOUR: ROLLOVER_HOUR } as Env);
  }

  override current(): StayDate {
    return this.today;
  }
}

/** The `M4` binding's answer — every folio settled. */
class FolioSettled implements FolioPort {
  async getBalance(): Promise<VndAmount> {
    return 0n;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let reference = 8_000;

/** The desk, on a given day. */
function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(inventory, clock, new StayQuoteService()),
    new GuestService(),
    new HousekeepingService(),
    new FolioSettled(),
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

// Every case starts against the property as the seed laid it down. The counters
// are what this file asserts on, so a case that inherited another one's holds
// would be reading a number nobody chose.
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
  options: { checkIn?: string; checkOut?: string } = {},
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

/** A stay that is confirmed and holds a room. */
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

/** A stay the night audit has written off, room and all. */
async function noShow(
  roomNumber = SUPERIOR,
  options: { checkIn?: string; checkOut?: string } = {},
): Promise<string> {
  const id = await stayHolding(roomNumber, options);

  await db.transaction(
    async (tx) => await deskAt(parseDate(ARRIVAL)).markNoShow(tx, id),
  );

  return id;
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

/** `sold_rooms` across the whole stay, arrival first. */
async function soldAcrossTheStay(): Promise<number[]> {
  return await Promise.all(
    NIGHTS.map(async (night) => await soldOn("SUPERIOR", night)),
  );
}

/** Every assignment row a booking holds, oldest first. */
async function heldBy(
  bookingId: string,
): Promise<{ number: string; checkInDate: string; checkOutDate: string }[]> {
  return await db
    .select({
      number: room.number,
      checkInDate: roomAssignment.checkInDate,
      checkOutDate: roomAssignment.checkOutDate,
    })
    .from(roomAssignment)
    .innerJoin(room, eq(room.id, roomAssignment.roomId))
    .where(eq(roomAssignment.bookingId, bookingId))
    .orderBy(roomAssignment.checkInDate);
}

/** The state one booking is in. */
async function stateOf(bookingId: string): Promise<string> {
  const [row] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row!.state;
}

/** Sells out a type across a range, so the counter has nothing left to give. */
async function sellOut(
  code: RoomTypeCode,
  from: string,
  to: string,
): Promise<void> {
  await db
    .update(typeInventory)
    .set({ soldRooms: typeInventory.totalRooms })
    .where(
      and(
        eq(typeInventory.roomTypeId, await typeId(code)),
        gte(typeInventory.stayDate, from),
        lt(typeInventory.stayDate, to),
      ),
    );
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

describe("writing off a guest who never came", () => {
  it("keeps the arrival night sold and puts the rest back", async () => {
    // §3's inventory effect, and the split is not arbitrary: the no-show charge
    // is levied against the arrival night, and a night the property is charging
    // for is a night it has not resold.
    const id = await noShow();

    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
    expect(await stateOf(id)).toBe("NO_SHOW");
  });

  it("cuts the room's hold back to the night that was charged for", async () => {
    // Left running to the original departure date, the hold would keep the room
    // against `room_assignment_no_double_booking` across nights the counter now
    // reads as free — the room unsellable and the type reading available.
    const id = await noShow();

    expect(await heldBy(id)).toEqual([
      { number: SUPERIOR, checkInDate: ARRIVAL, checkOutDate: "2027-06-11" },
    ]);
  });

  it("lets the freed room be given to somebody else from the next night", async () => {
    // The point of the two assertions above, as the outcome the desk cares
    // about: the room is on sale again from the night nobody is paying for.
    await noShow();

    const walkIn = await confirmedStay({
      checkIn: "2027-06-11",
      checkOut: DEPARTURE,
    });

    const held = await db.transaction(
      async (tx) =>
        await roomsAt(parseDate("2027-06-11")).assign(tx, {
          bookingId: walkIn,
          roomNumber: SUPERIOR,
        }),
    );

    expect(held.roomNumber).toBe(SUPERIOR);
  });

  it("releases nothing at all on a stay of one night", async () => {
    // There is nothing after the arrival night, so the release is skipped rather
    // than asked for an empty range — `inventory.service.ts` refuses a movement
    // of no nights, and rightly.
    const id = await noShow(ANOTHER_SUPERIOR, {
      checkIn: ARRIVAL,
      checkOut: "2027-06-11",
    });

    expect(await soldOn("SUPERIOR", ARRIVAL)).toBe(1);
    expect(await stateOf(id)).toBe("NO_SHOW");

    // And the hold already covered exactly that night, so it is left alone.
    expect(await heldBy(id)).toEqual([
      {
        number: ANOTHER_SUPERIOR,
        checkInDate: ARRIVAL,
        checkOutDate: "2027-06-11",
      },
    ]);
  });

  it("does not release the nights twice when the audit runs twice", async () => {
    // §4's idempotency row, and the release is what makes it matter: a sweep
    // that ran twice and released again would credit the property with inventory
    // it never sold, which `type_inventory_sold_not_negative` catches only once
    // the counter has already lied.
    const id = await noShow();

    const again = await db.transaction(
      async (tx) => await deskAt(parseDate(ARRIVAL)).markNoShow(tx, id),
    );

    expect(again.state).toBe("NO_SHOW");
    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
  });

  it("refuses to write off a guest who is in the building", async () => {
    // `CHECKED_IN → NO_SHOW` is not a cell §2 draws. The guest is standing
    // there; whatever the audit thinks it found, it did not find an absence.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).checkIn(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) => await deskAt(parseDate(ARRIVAL)).markNoShow(tx, id),
          ),
        )
      ).status,
    ).toBe("CONFLICT");

    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("reinstating a guest who turned up after all", () => {
  it("buys back every night but the one the no-show kept", async () => {
    // §3's effect, and §2's reading of it: a guest landing at 02:00 after the
    // night audit ran is an ordinary event. The arrival night is not bought a
    // second time — the property already holds it.
    const id = await noShow();

    const arrived = await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(arrived.state).toBe("CHECKED_IN");
    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
  });

  it("writes the registration record the state requires", async () => {
    // §1 files the record as a property of `CHECKED_IN` rather than of the route
    // that reached it. A guest admitted at 02:00 is as much in the building as
    // one admitted at 14:00, and a residence record with a hole in it is the
    // same hole either way.
    const id = await noShow();

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(
      await db
        .select({ isPrimary: registration.isPrimary })
        .from(registration)
        .where(eq(registration.bookingId, id)),
    ).toEqual([{ isPrimary: true }]);
  });

  it("holds the room again for the nights it bought back", async () => {
    // A second row rather than the first one stretched back out, which is the
    // shape a room move takes and for the same reason: the arrival night the
    // property charged for stays a night this room was held.
    const id = await noShow();

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(await heldBy(id)).toEqual([
      { number: SUPERIOR, checkInDate: ARRIVAL, checkOutDate: "2027-06-11" },
      { number: SUPERIOR, checkInDate: "2027-06-11", checkOutDate: DEPARTURE },
    ]);
  });

  it("resumes from today when the guest turns up two days late", async () => {
    // The nights in between were never slept and nobody is charging for them, so
    // they are not bought back. Buying them would have the property sell itself
    // rooms it stood empty on.
    const id = await noShow();

    await db.transaction(
      async (tx) =>
        await deskAt(parseDate("2027-06-12")).reinstate(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(await soldAcrossTheStay()).toEqual([1, 0, 1, 1, 1]);
    expect(await heldBy(id)).toEqual([
      { number: SUPERIOR, checkInDate: ARRIVAL, checkOutDate: "2027-06-11" },
      { number: SUPERIOR, checkInDate: "2027-06-12", checkOutDate: DEPARTURE },
    ]);
  });

  it("refuses the stay whose type sold out while the guest was missing", async () => {
    // §3's "fail if unavailable", and the honest answer: the nights went back on
    // sale the moment the audit ran, somebody else took them, and the counter
    // must not go past what the property owns.
    // `type_inventory_sold_at_most_total` is what says so.
    const id = await noShow();

    await sellOut("SUPERIOR", "2027-06-11", DEPARTURE);

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) =>
              await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
                bookingId: id,
                guests: [A_GUEST],
              }),
          ),
        )
      ).status,
    ).toBe("CONFLICT");

    expect(await stateOf(id)).toBe("NO_SHOW");
  });

  it("refuses the stay whose own room was given away", async () => {
    // §2's "it fails if the room was resold", and it is a different refusal from
    // the one above: the type still has stock, so the desk resolves this one by
    // finding the guest another key rather than other dates.
    // `room_assignment_no_double_booking` is what refuses it.
    const id = await noShow();

    const resold = await confirmedStay({
      checkIn: "2027-06-11",
      checkOut: DEPARTURE,
    });

    await db.transaction(
      async (tx) =>
        await roomsAt(parseDate("2027-06-11")).assign(tx, {
          bookingId: resold,
          roomNumber: SUPERIOR,
        }),
    );

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) =>
              await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
                bookingId: id,
                guests: [A_GUEST],
              }),
          ),
        )
      ).status,
    ).toBe("CONFLICT");

    // The refusal took the whole transition with it, so the nights it had
    // already bought back are the other guest's alone.
    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
    expect(await stateOf(id)).toBe("NO_SHOW");
  });

  it("refuses a room that is not ready before it moves a counter", async () => {
    // §4's guards run before the effects, so a refusal costs the property
    // nothing — the transaction would undo the nights either way, and this way
    // they are never bought.
    const id = await noShow();

    await db.transaction(
      async (tx) =>
        await new HousekeepingService().setCondition(tx, {
          roomNumber: SUPERIOR,
          status: "DIRTY",
        }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
              bookingId: id,
              guests: [A_GUEST],
            }),
        ),
      ),
    ).toEqual({ status: "CONFLICT", code: "ROOM_NOT_READY" });

    expect(await soldAcrossTheStay()).toEqual([1, 0, 0, 0, 0]);
  });

  it("refuses a stay that never no-showed", async () => {
    // §2 lets `CONFIRMED` reach `CHECKED_IN` too, and that path is the ordinary
    // check-in. Arriving here it would re-consume nights the booking already
    // holds, which is the property selling itself the same room twice.
    const id = await stayHolding(SUPERIOR);

    expect(
      (
        await refusalOf(
          db.transaction(
            async (tx) =>
              await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
                bookingId: id,
                guests: [A_GUEST],
              }),
          ),
        )
      ).status,
    ).toBe("CONFLICT");

    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
  });

  it("buys nothing back a second time when the button is pressed twice", async () => {
    // §4's idempotency row. The unique index would refuse the second party as a
    // constraint violation; this returns the state instead, and the counters do
    // not move again.
    const id = await noShow();
    const desk = deskAt(parseDate(ARRIVAL));

    await db.transaction(
      async (tx) =>
        await desk.reinstate(tx, { bookingId: id, guests: [A_GUEST] }),
    );

    const again = await db.transaction(
      async (tx) =>
        await desk.reinstate(tx, { bookingId: id, guests: [A_GUEST] }),
    );

    expect(again.state).toBe("CHECKED_IN");
    expect(await soldAcrossTheStay()).toEqual([1, 1, 1, 1, 1]);
    expect(
      await db
        .select({ id: registration.id })
        .from(registration)
        .where(eq(registration.bookingId, id)),
    ).toHaveLength(1);
  });

  it("admits the late guest of a one-night stay with nothing to buy back", async () => {
    // The arrival night is the whole stay and the no-show kept it, so there is
    // no range left to reserve and no second hold to write.
    const id = await noShow(ANOTHER_SUPERIOR, {
      checkIn: ARRIVAL,
      checkOut: "2027-06-11",
    });

    const arrived = await db.transaction(
      async (tx) =>
        await deskAt(parseDate(ARRIVAL)).reinstate(tx, {
          bookingId: id,
          guests: [A_GUEST],
        }),
    );

    expect(arrived.state).toBe("CHECKED_IN");
    expect(await soldOn("SUPERIOR", ARRIVAL)).toBe(1);
    expect(await heldBy(id)).toEqual([
      {
        number: ANOTHER_SUPERIOR,
        checkInDate: ARRIVAL,
        checkOutDate: "2027-06-11",
      },
    ]);
  });
});

describe("cancelling a booking that holds a room", () => {
  it("stops holding the room, so somebody else can have it", async () => {
    // The second row a cancellation has to close. Left behind, the assignment
    // holds its room against `room_assignment_no_double_booking` for a stay that
    // is not happening — the counter saying the room is free and the exclusion
    // constraint saying it is taken.
    const id = await stayHolding(SUPERIOR);

    await db.transaction(
      async (tx) =>
        await deskAt(SEED_FROM).cancel(tx, id, "GUEST_REQUEST"),
    );

    expect(await heldBy(id)).toHaveLength(0);
    expect(await soldAcrossTheStay()).toEqual([0, 0, 0, 0, 0]);

    const replacement = await confirmedStay();

    const held = await db.transaction(
      async (tx) =>
        await roomsAt(SEED_FROM).assign(tx, {
          bookingId: replacement,
          roomNumber: SUPERIOR,
        }),
    );

    expect(held.roomNumber).toBe(SUPERIOR);
  });
});
