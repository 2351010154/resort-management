// Nights added to a stay and nights given back — `booking-state-machine.md`
// §5's third and fourth rows, against a real database.
//
// Both operations are three layers that have to agree, and only two of them are
// this service's. `type_inventory` says how many rooms of the type are sold on
// each night, `room_assignment` says which physical room is held across which
// nights, and `booking_night` says what each night was sold for. A suite that
// asserted the departure date had changed would prove none of them: the failure
// worth catching is a stay that runs to the 17th while the counter stops at the
// 15th, or a room held for nights the property has just put back on sale.
//
// The prices are the third layer and they are asserted the same way. §4 charges
// "the remaining nights at 50%", and the only way to show that the right nights
// were selected is to read the rows the booking stored and add up the ones that
// should have been in the sum — a charge compared against a re-run of the
// calculator would assert nothing at all.
//
// The stays are created through `BookingService` rather than inserted, because
// the nights are the subject here and only that path writes them. No Nest
// application is booted and the property's day is stopped, for the reasons
// `check-in-out.e2e-spec.ts` gives.

import { parseDate } from "@internationalized/date";
import type {
  RatePlanCode,
  RoomTypeCode,
  StayDate,
  VndAmount,
} from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
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
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";

const SEED_FROM = parseDate("2027-06-01");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302.
const SUPERIOR = "201";
const ANOTHER_SUPERIOR = "202";
const A_THIRD_SUPERIOR = "203";

const ARRIVAL = parseDate("2027-06-10");
const DEPARTURE = parseDate("2027-06-15");

/** Mid-stay: two nights slept, three still to come. */
const TODAY = parseDate("2027-06-12");

const A_GUEST = {
  fullName: "Trần Thị Mai",
  cccdNumber: "079301004321",
  nationality: "VN",
} as const;

const A_PARTY = { adults: 2, children: [] } as const;

const ROLLOVER_HOUR = 4;
const HOLD_TTL_MINUTES = 20;

/** The property's day, stopped — the same device the other suites use. */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super({ BUSINESS_DATE_ROLLOVER_HOUR: ROLLOVER_HOUR } as Env);
  }

  override current(): StayDate {
    return this.today;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** The desk, on a given day. */
function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(
      inventory,
      clock,
      new StayQuoteService(),
      new HousekeepingService(),
    ),
    new GuestService(),
    new HousekeepingService(),
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
  );
}

/** The stay-shape service, on a given day. */
function staysAt(today: StayDate): AssignmentService {
  return new AssignmentService(
    new InventoryService(),
    new StoppedClock(today),
    new StayQuoteService(),
    new HousekeepingService(),
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
// the same Superior on the same night, and the counters are what most of the
// assertions below read.
beforeEach(async () => {
  await db.execute(
    sql`truncate registration, room_assignment, booking_night, booking, guest restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

/** A confirmed stay, priced and consumed the way the front desk takes one. */
async function stay(
  options: {
    checkOut?: StayDate;
    plan?: RatePlanCode;
  } = {},
): Promise<{ id: string; total: VndAmount }> {
  const made = await db.transaction(
    async (tx) =>
      await deskAt(SEED_FROM).createConfirmed(tx, {
        roomType: "SUPERIOR",
        checkIn: ARRIVAL,
        checkOut: options.checkOut ?? DEPARTURE,
        plan: options.plan ?? "STANDARD",
        party: A_PARTY,
      }),
  );

  return { id: made.id, total: made.stayTotalGross };
}

/** A confirmed stay that holds a room. */
async function stayHolding(
  roomNumber: string,
  options: { checkOut?: StayDate; plan?: RatePlanCode } = {},
): Promise<{ id: string; total: VndAmount }> {
  const made = await stay(options);

  await db.transaction(
    async (tx) =>
      await staysAt(SEED_FROM).assign(tx, {
        bookingId: made.id,
        roomNumber,
      }),
  );

  return made;
}

/** A stay whose guest is in the building, arrived on the arrival date. */
async function inTheBuilding(
  roomNumber = SUPERIOR,
  options: { checkOut?: StayDate; plan?: RatePlanCode } = {},
): Promise<{ id: string; total: VndAmount }> {
  const made = await stayHolding(roomNumber, options);

  await db.transaction(
    async (tx) =>
      await deskAt(ARRIVAL).checkIn(tx, {
        bookingId: made.id,
        guests: [A_GUEST],
      }),
  );

  return made;
}

/**
 * A stay written off overnight, whose guest turned up two days late.
 *
 * The one shape where the nights behind the guest and the nights the folio has
 * posted for them part company — see the case at the foot of this file.
 */
async function reinstated(): Promise<{ id: string; total: VndAmount }> {
  const made = await stayHolding(SUPERIOR);

  await db.transaction(
    async (tx) => await deskAt(ARRIVAL).markNoShow(tx, made.id),
  );

  await db.transaction(
    async (tx) =>
      await deskAt(TODAY).reinstate(tx, {
        bookingId: made.id,
        guests: [A_GUEST],
      }),
  );

  return made;
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

/** `sold_rooms` for the Superiors across a run of nights. */
async function soldAcross(from: string, to: string): Promise<number[]> {
  const nights: string[] = [];

  for (
    let night = parseDate(from);
    night.compare(parseDate(to)) < 0;
    night = night.add({ days: 1 })
  ) {
    nights.push(night.toString());
  }

  return await Promise.all(
    nights.map(async (night) => await soldOn("SUPERIOR", night)),
  );
}

/** The prices a booking has stored, in stay order. */
async function nightsOf(
  bookingId: string,
): Promise<{ stayDate: string; standardGross: VndAmount }[]> {
  return await db
    .select({
      stayDate: bookingNight.stayDate,
      standardGross: bookingNight.standardGross,
    })
    .from(bookingNight)
    .where(eq(bookingNight.bookingId, bookingId))
    .orderBy(asc(bookingNight.stayDate));
}

/** What a booking stored for a run of its nights, added up. */
async function priceOf(
  bookingId: string,
  from: string,
  to: string,
): Promise<VndAmount> {
  const nights = await db
    .select({ standardGross: bookingNight.standardGross })
    .from(bookingNight)
    .where(
      and(
        eq(bookingNight.bookingId, bookingId),
        gte(bookingNight.stayDate, from),
        lt(bookingNight.stayDate, to),
      ),
    );

  return nights.reduce<VndAmount>(
    (total, night) => total + night.standardGross,
    0n,
  );
}

/** The stay as the booking row holds it. */
async function storedStay(
  bookingId: string,
): Promise<{ checkOutDate: string; total: VndAmount }> {
  const [row] = await db
    .select({
      checkOutDate: booking.checkOutDate,
      total: booking.quotedStayTotalGross,
    })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row!;
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

/** Sells out a type across a range, so the counter has nothing left to give. */
async function sellOut(from: string, to: string): Promise<void> {
  const [superior] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, "SUPERIOR"))
    .limit(1);

  await db
    .update(typeInventory)
    .set({ soldRooms: typeInventory.totalRooms })
    .where(
      and(
        eq(typeInventory.roomTypeId, superior!.id),
        gte(typeInventory.stayDate, from),
        lt(typeInventory.stayDate, to),
      ),
    );
}

/** The status of a refusal, or a failure naming what came back instead. */
async function refusalOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error.code;
    }

    throw error;
  }

  throw new Error("The operation was expected to be refused and was not");
}

describe("extending a stay", () => {
  const LONGER = parseDate("2027-06-17");

  it("buys the added nights and leaves the ones already sold alone", async () => {
    // §5's note on the row — "needs inventory for the added nights" — and §4
    // lists this operation in the inventory-available guard beside the two
    // creating transitions.
    const made = await stay();

    const extended = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: LONGER,
        }),
    );

    expect(extended).toMatchObject({ bookingId: made.id, nightsAdded: 2 });
    expect(extended.checkOut.toString()).toBe("2027-06-17");

    expect(await soldAcross("2027-06-10", "2027-06-18")).toEqual([
      1, 1, 1, 1, 1, 1, 1, 0,
    ]);
    expect((await storedStay(made.id)).checkOutDate).toBe("2027-06-17");
  });

  it("stores a price for every night it added", async () => {
    // §8: a booking holds one row per night it was sold, and the nights added
    // here were never sold — so they take the calendar price of the day the
    // guest asked for them. Without the rows the stay would have nights nothing
    // could price, which is what §4's grid is made of.
    const made = await stay();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: LONGER,
        }),
    );

    expect((await nightsOf(made.id)).map((night) => night.stayDate)).toEqual([
      "2027-06-10",
      "2027-06-11",
      "2027-06-12",
      "2027-06-13",
      "2027-06-14",
      "2027-06-15",
      "2027-06-16",
    ]);
  });

  it("totals the extended stay exactly as it would have been sold outright", async () => {
    // The claim `property-and-tariff.md` §5 makes: the plan's percentage is
    // applied once over the whole stay. A total assembled by adjusting the
    // extension on its own and adding it to the original would be a đồng or two
    // out — unprovably rather than merely wrongly, which is the failure
    // `schema/booking.ts` says the stored nights exist to make impossible.
    const extendedBooking = await stay();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: extendedBooking.id,
          checkOut: LONGER,
        }),
    );

    const soldOutright = await stay({ checkOut: LONGER });

    expect((await storedStay(extendedBooking.id)).total).toBe(
      soldOutright.total,
    );
  });

  it("holds the room for the nights it just bought", async () => {
    const made = await stayHolding(SUPERIOR);

    const extended = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: LONGER,
        }),
    );

    expect(extended.assignment?.roomNumber).toBe(SUPERIOR);
    expect(await heldBy(made.id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-17",
      },
    ]);
  });

  it("keeps a guest who is in the building longer", async () => {
    // §5 gives this operation both states, and this is the one the desk actually
    // uses: a guest asks at breakfast to stay two more nights.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: LONGER,
        }),
    );

    expect((await storedStay(made.id)).checkOutDate).toBe("2027-06-17");
    expect(await heldBy(made.id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-17",
      },
    ]);
  });

  it("fails cleanly when the property is full on an added night", async () => {
    // "Fails cleanly" is §5's own word, and the caller's transaction is what
    // makes it true: the price rows, the counter and the stay all go back
    // together, so a refused extension leaves a stay nobody can tell was asked
    // about.
    const made = await stayHolding(SUPERIOR);

    await sellOut("2027-06-16", "2027-06-17");

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).extendStay(tx, {
              bookingId: made.id,
              checkOut: LONGER,
            }),
        ),
      ),
    ).toBe("CONFLICT");

    const stored = await storedStay(made.id);

    expect(stored.checkOutDate).toBe("2027-06-15");
    expect(stored.total).toBe(made.total);
    expect(await nightsOf(made.id)).toHaveLength(5);
    expect(await soldOn("SUPERIOR", "2027-06-15")).toBe(0);
  });

  it("refuses to hold a room the next arrival already has", async () => {
    // `room_assignment_no_double_booking`, reached by an `update` rather than by
    // an insert — the constraint does not care which, and the desk resolves it
    // by moving the guest before extending rather than by the property quietly
    // dropping their key.
    const staying = await stayHolding(SUPERIOR);

    const nextArrival = await db.transaction(
      async (tx) =>
        await deskAt(SEED_FROM).createConfirmed(tx, {
          roomType: "SUPERIOR",
          checkIn: DEPARTURE,
          checkOut: parseDate("2027-06-18"),
          plan: "STANDARD",
          party: A_PARTY,
        }),
    );

    await db.transaction(
      async (tx) =>
        await staysAt(SEED_FROM).assign(tx, {
          bookingId: nextArrival.id,
          roomNumber: SUPERIOR,
        }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).extendStay(tx, {
              bookingId: staying.id,
              checkOut: LONGER,
            }),
        ),
      ),
    ).toBe("CONFLICT");

    // Nothing of the extension survived: the nights the refusal rolled back are
    // the next arrival's alone, and the guest still departs when they did.
    expect((await storedStay(staying.id)).checkOutDate).toBe("2027-06-15");
    expect(await soldOn("SUPERIOR", "2027-06-15")).toBe(1);
    expect(await heldBy(staying.id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-15",
      },
    ]);
  });

  it("buys nothing a second time when the button is pressed twice", async () => {
    // Idempotent for the reason every transition in `booking.service.ts` is: a
    // retried request must not reserve the added nights again, which would have
    // the booking hold two rooms of its type and neither of them for anybody who
    // could sleep in one.
    const made = await stayHolding(SUPERIOR);

    const unchanged = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: DEPARTURE,
        }),
    );

    expect(unchanged).toMatchObject({
      nightsAdded: 0,
      stayTotalGross: made.total,
    });
    expect(unchanged.assignment?.roomNumber).toBe(SUPERIOR);
    expect(await soldAcross("2027-06-10", "2027-06-16")).toEqual([
      1, 1, 1, 1, 1, 0,
    ]);
    expect(await nightsOf(made.id)).toHaveLength(5);
  });

  it("refuses an earlier departure, which is the other operation", async () => {
    const made = await stay();

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).extendStay(tx, {
              bookingId: made.id,
              checkOut: parseDate("2027-06-13"),
            }),
        ),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("refuses a booking that is still held", async () => {
    // §5 gives this operation `CONFIRMED` and `CHECKED_IN` only. A hold is a
    // stranger's cart, and lengthening it would freeze nights onto a booking
    // nobody has paid a deposit against.
    const held = await db.transaction(
      async (tx) =>
        await deskAt(SEED_FROM).createHold(tx, {
          roomType: "SUPERIOR",
          checkIn: ARRIVAL,
          checkOut: DEPARTURE,
          plan: "STANDARD",
          party: A_PARTY,
        }),
    );

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).extendStay(tx, {
              bookingId: held.id,
              checkOut: LONGER,
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });
});

describe("shortening a stay", () => {
  const LEAVING = parseDate("2027-06-13");

  it("puts the nights the guest will not sleep back on sale", async () => {
    // §5's note on the row: "releases nights, posts the early-departure charge".
    // The nights already slept stay sold — the property housed somebody in them.
    const made = await inTheBuilding();

    const shortened = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    expect(shortened.nightsReleased).toBe(2);
    expect(await soldAcross("2027-06-10", "2027-06-15")).toEqual([
      1, 1, 1, 0, 0,
    ]);
    expect((await storedStay(made.id)).checkOutDate).toBe("2027-06-13");
  });

  it("stops holding the room for nights it has just put back on sale", async () => {
    // Left running to the original departure date, the hold would keep the room
    // against `room_assignment_no_double_booking` across nights the counter now
    // reads as free — the two layers disagreeing, with the room unsellable.
    const made = await inTheBuilding();

    const shortened = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    expect(shortened.assignment?.checkOut.toString()).toBe("2027-06-13");
    expect(await heldBy(made.id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-13",
      },
    ]);
  });

  it("lets the freed room be given to somebody else that night", async () => {
    // The outcome the desk cares about, and the point of the two assertions
    // above: a walk-in can have the room from the night the guest gave up.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    const walkIn = await db.transaction(
      async (tx) =>
        await deskAt(LEAVING).createConfirmed(tx, {
          roomType: "SUPERIOR",
          checkIn: LEAVING,
          checkOut: DEPARTURE,
          plan: "STANDARD",
          party: A_PARTY,
        }),
    );

    const held = await db.transaction(
      async (tx) =>
        await staysAt(LEAVING).assign(tx, {
          bookingId: walkIn.id,
          roomNumber: SUPERIOR,
        }),
    );

    expect(held.roomNumber).toBe(SUPERIOR);
  });

  it("charges the nights nobody will sleep at half, on a refundable plan", async () => {
    // §4's grid, early-departure row. Half of the *remaining* nights and not of
    // the stay: the nights already spent were posted as ordinary room charges,
    // and charging the whole stay again would bill them twice.
    const made = await inTheBuilding();

    const shortened = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    const remaining = await priceOf(made.id, "2027-06-13", "2027-06-15");

    expect(shortened.charge).toEqual({
      amount: remaining / 2n,
      basis: "REMAINING_NIGHTS_HALF",
    });
  });

  it("charges them in full on a non-refundable plan", async () => {
    // Remaining-at-100% plus the nights already posted is 100% of the stay,
    // which is what `NONREF` promised — not "the whole stay again".
    const made = await inTheBuilding(ANOTHER_SUPERIOR, { plan: "NONREF" });

    const shortened = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    const remaining = await priceOf(made.id, "2027-06-13", "2027-06-15");

    expect(shortened.charge).toEqual({
      amount: remaining,
      basis: "REMAINING_NIGHTS_FULL",
    });
  });

  it("keeps the released nights' prices and the total the stay was sold at", async () => {
    // The charge above is computed *from* those rows, so deleting them would
    // destroy the number `M6`'s folio has to post and later explain. The frozen
    // total stays what it was for the same reason a cancellation leaves it: it
    // records what was sold, and the difference between that and what is owed is
    // the charge rather than a renegotiated price.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    expect((await nightsOf(made.id)).map((night) => night.stayDate)).toEqual([
      "2027-06-10",
      "2027-06-11",
      "2027-06-12",
      "2027-06-13",
      "2027-06-14",
    ]);
    expect((await storedStay(made.id)).total).toBe(made.total);
  });

  it("charges only the nights it has just released, the second time round", async () => {
    // The rows outlast the range, so a second early departure that priced every
    // row would charge again for nights the first one already put on the folio.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: parseDate("2027-06-14"),
        }),
    );

    const again = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: LEAVING,
        }),
    );

    expect(again.charge).toEqual({
      amount: (await priceOf(made.id, "2027-06-13", "2027-06-14")) / 2n,
      basis: "REMAINING_NIGHTS_HALF",
    });
  });

  it("leaves the guest holding nothing when they go the day they moved rooms", async () => {
    // The room they moved into holds no night at all, which is the row
    // `room_assignment_covers_at_least_one_night` refuses — so it is dropped
    // rather than closed at its own start date. The room they slept in keeps its
    // nights, because they slept them.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).move(tx, {
          bookingId: made.id,
          roomNumber: A_THIRD_SUPERIOR,
        }),
    );

    const shortened = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: TODAY,
        }),
    );

    expect(shortened.assignment).toBeNull();
    expect(await heldBy(made.id)).toEqual([
      {
        number: SUPERIOR,
        checkInDate: "2027-06-10",
        checkOutDate: "2027-06-12",
      },
    ]);
  });

  it("releases nothing when asked for the departure the stay already has", async () => {
    const made = await inTheBuilding();

    const unchanged = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: DEPARTURE,
        }),
    );

    expect(unchanged.nightsReleased).toBe(0);
    expect(unchanged.charge.amount).toBe(0n);
    expect(await soldAcross("2027-06-10", "2027-06-15")).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });

  it("refuses a guest who is not in the building", async () => {
    // §5 gives this row `CHECKED_IN` alone, and §2 says why: a booking that
    // never arrived gives its nights back by being cancelled, which is a
    // different act with a different charge.
    const made = await stayHolding(SUPERIOR);

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).shortenStay(tx, {
              bookingId: made.id,
              checkOut: LEAVING,
            }),
        ),
      ),
    ).toBe("CONFLICT");
  });

  it("refuses a later departure, which is the other operation", async () => {
    const made = await inTheBuilding();

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).shortenStay(tx, {
              bookingId: made.id,
              checkOut: parseDate("2027-06-17"),
            }),
        ),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("refuses to take back a night the guest has already slept", async () => {
    // The counter would take it — `type_inventory` knows nothing about who was
    // in the room — and the property would then be showing a night for sale that
    // has already happened.
    const made = await inTheBuilding();

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(TODAY).shortenStay(tx, {
              bookingId: made.id,
              checkOut: parseDate("2027-06-11"),
            }),
        ),
      ),
    ).toBe("CONFLICT");

    expect(await soldAcross("2027-06-10", "2027-06-15")).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });

  it("refuses a stay that would cover no night", async () => {
    // `booking_covers_at_least_one_night` would refuse the row, but as a
    // constraint naming itself rather than as the answer: a guest who is in the
    // building slept the night they arrived.
    const made = await inTheBuilding();

    expect(
      await refusalOf(
        db.transaction(
          async (tx) =>
            await staysAt(ARRIVAL).shortenStay(tx, {
              bookingId: made.id,
              checkOut: ARRIVAL,
            }),
        ),
      ),
    ).toBe("BAD_REQUEST");
  });
});

describe("a stay shortened and then lengthened again", () => {
  it("gives the nights back at the price they were sold at", async () => {
    // The rows the early departure kept are the ones the extension finds, so the
    // guest who changes their mind is on the stay they bought rather than on a
    // resale at whatever the calendar says this morning.
    const made = await inTheBuilding();

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: parseDate("2027-06-13"),
        }),
    );

    await db.transaction(
      async (tx) =>
        await staysAt(TODAY).extendStay(tx, {
          bookingId: made.id,
          checkOut: DEPARTURE,
        }),
    );

    const stored = await storedStay(made.id);

    expect(stored.checkOutDate).toBe("2027-06-15");
    expect(stored.total).toBe(made.total);
    expect(await nightsOf(made.id)).toHaveLength(5);
    expect(await soldAcross("2027-06-10", "2027-06-15")).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });
});

describe("a stay written off, reinstated, then cut short", () => {
  it("charges the nights the new departure date leaves unslept", async () => {
    // The `M4` answer, pinned so that `M6` changing it is a visible change
    // rather than a silent one.
    //
    // `cancellation-calculator.ts` asks for `nightsSpent` as a count of nights
    // the night audit has already *posted*, and says outright that it is "never
    // a date subtraction" — the two agree on an ordinary stay and part on
    // exactly this one. This guest has the 10th behind them as a no-show charge
    // and the 11th behind them as a night nobody sold, so the folio has one
    // posting where the calendar has two. `assignment.service.ts` passes the
    // date subtraction because at `M4` there are no postings to count; when the
    // ledger arrives, the count comes from it and this figure moves.
    const made = await reinstated();

    const cut = await db.transaction(
      async (tx) =>
        await staysAt(TODAY).shortenStay(tx, {
          bookingId: made.id,
          checkOut: parseDate("2027-06-13"),
        }),
    );

    expect(cut.charge).toEqual({
      amount: (await priceOf(made.id, "2027-06-13", "2027-06-15")) / 2n,
      basis: "REMAINING_NIGHTS_HALF",
    });

    // Only the nights this stay actually held are given back. The 11th went
    // back on sale when the audit ran and was never bought again, so the
    // release covers the 13th and the 14th and nothing else.
    expect(cut.nightsReleased).toBe(2);
    expect(await soldAcross("2027-06-10", "2027-06-15")).toEqual([
      1, 0, 1, 0, 0,
    ]);

    // The room follows, from the night the guest actually walked into it.
    expect(await heldBy(made.id)).toEqual([
      { number: SUPERIOR, checkInDate: "2027-06-10", checkOutDate: "2027-06-11" },
      { number: SUPERIOR, checkInDate: "2027-06-12", checkOutDate: "2027-06-13" },
    ]);
  });
});
