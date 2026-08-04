// The four transitions a booking can make before anybody arrives —
// `FR-BOOK-01`, `FR-BOOK-02`, and `booking-state-machine.md` §2 and §3.
//
// The claims under test are not about a service remembering to check something.
// They are about what the database holds afterwards: a booking that consumed a
// room on every night of its stay and none on the departure date, a cancellation
// that gave exactly those nights back, and a second cancellation that gave back
// nothing. None of that can be asserted against a mocked inventory, because a
// mock has no counter — so this runs the real services against the migrated,
// seeded database `.env.test` names.
//
// No Nest application is booted, for `inventory-reservation.e2e-spec.ts`'s
// reason: the subject is three services and the rows underneath them, and an
// HTTP stack around them would only add ways for a failure to mean something
// else. The transaction is opened here, once per call, the way the controller
// that owns these routes will open it.
//
// Two states are set up with a direct `update` rather than through a service.
// `CHECKED_IN` and `CHECKED_OUT` are reached by transitions this milestone has
// not built yet, and the assertions about them are about §2 refusing a move
// *out* of those states — which needs a booking in one, not a check-in path.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode } from "@mariva/shared";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import * as schema from "../src/database/schema/index.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import {
  BookingService,
  type Booking,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { isBookingReference } from "../src/modules/booking/reference-generator.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";

const SEED_FROM = parseDate("2027-06-01");

/** The mix from `seed/property.ts`, named so selling a type out reads as "every
 *  Premier the property has" rather than as the number eight. */
const PREMIER_ROOMS = 8;

/** `seed/property.ts`: `NONREF` is `STANDARD` − 10%. */
const NONREF_ADJUSTMENT = -10;
const EXTRA_PERSON_PER_NIGHT = 600_000n;

const HOLD_TTL_MINUTES = 15;
const MS_PER_MINUTE = 60_000;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bookings: BookingService;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The real property and no synthetic stays against it. Every assertion below
  // counts rooms, and five hundred seeded bookings would make "one Deluxe left"
  // a number nobody can predict.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // Only the TTL is read, and it is read once. The rest of the environment is
  // not this service's to hold an opinion about.
  bookings = new BookingService(
    new InventoryService(),
    new StayQuoteService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
  );
});

afterAll(async () => {
  await pool?.end();
});

describe("a stay the front desk takes", () => {
  const CHECK_IN = "2028-01-10";
  const CHECK_OUT = "2028-01-13";
  const NIGHTS = [CHECK_IN, "2028-01-11", "2028-01-12"];

  let sold: Booking;

  it("consumes one room on each night of the stay and none after it", async () => {
    sold = await createConfirmed(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(sold.state).toBe("CONFIRMED");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1, 1]);

    // The departure date is not a night sold. An off-by-one night is the failure
    // the half-open convention exists to prevent, and it is invisible in every
    // number except this one.
    expect(await soldOn("DELUXE", [CHECK_OUT])).toEqual([0]);
  });

  it("carries a reference a guest could read down a phone line", async () => {
    expect(isBookingReference(sold.reference)).toBe(true);
  });

  it("holds no expiry, because nothing is going to expire it", async () => {
    // `booking_hold_expiry_exactly_when_held` refuses the row that kept one, so
    // this is the constraint agreeing rather than the service being careful.
    expect(sold.holdExpiresAt).toBeNull();
  });

  it("freezes a total its stored nights add back up to", async () => {
    // The invariant `schema/booking.ts` puts across two tables: the calendar
    // prices as they stood, summed, with the plan's percentage applied once over
    // the whole stay. A folio at M6 explains its line by doing exactly this.
    const [row] = await db
      .select()
      .from(booking)
      .where(eq(booking.id, sold.id));

    const nights = await db
      .select({
        stayDate: bookingNight.stayDate,
        standardGross: bookingNight.standardGross,
      })
      .from(bookingNight)
      .where(eq(bookingNight.bookingId, sold.id))
      .orderBy(bookingNight.stayDate);

    expect(nights.map((night) => night.stayDate)).toEqual(NIGHTS);

    const standardTotal = nights.reduce(
      (total, night) => total + night.standardGross,
      0n,
    );

    expect(row!.quotedPercentAdjustment).toBe(0);
    expect(row!.quotedStayTotalGross).toBe(standardTotal);
    expect(sold.stayTotalGross).toBe(standardTotal);
  });

  it("freezes the extra-person rate even for a party that owes none of it", async () => {
    // `booking_quoted_extra_person_positive` refuses a zero, and the reason is
    // M6: a folio explaining a later added guest needs the figure as it stood on
    // the day, not as it stands when the charge is posted.
    const [row] = await db
      .select({ gross: booking.quotedExtraPersonPerNightGross })
      .from(booking)
      .where(eq(booking.id, sold.id));

    expect(row!.gross).toBe(EXTRA_PERSON_PER_NIGHT);
  });
});

describe("a stay priced under a plan that is not the calendar's", () => {
  const CHECK_IN = "2028-01-20";
  const CHECK_OUT = "2028-01-22";

  it("stores NONREF's ten percent, and the calendar price beneath it", async () => {
    const sold = await createConfirmed({
      ...stay("DELUXE", CHECK_IN, CHECK_OUT),
      plan: "NONREF",
    });

    const nights = await db
      .select({ standardGross: bookingNight.standardGross })
      .from(bookingNight)
      .where(eq(bookingNight.bookingId, sold.id));

    const standardTotal = nights.reduce(
      (total, night) => total + night.standardGross,
      0n,
    );

    // The nights hold the calendar price, before the percentage — §5 forbids
    // rounding inside a calculation, so the division happens once over the whole
    // stay and the stored nights sum back to the stored total by that same
    // arithmetic.
    expect(sold.stayTotalGross).toBe(
      (standardTotal * BigInt(100 + NONREF_ADJUSTMENT)) / 100n,
    );
  });

  it("charges the party beyond the rate, undiscounted", async () => {
    const sold = await createConfirmed({
      ...stay("PANORAMA_SUITE", "2028-01-25", "2028-01-27"),
      plan: "NONREF",
      party: { adults: 3, children: [] },
    });

    const nights = await db
      .select({ standardGross: bookingNight.standardGross })
      .from(bookingNight)
      .where(eq(bookingNight.bookingId, sold.id));

    const standardTotal = nights.reduce(
      (total, night) => total + night.standardGross,
      0n,
    );

    expect(sold.stayTotalGross).toBe(
      (standardTotal * BigInt(100 + NONREF_ADJUSTMENT)) / 100n +
        EXTRA_PERSON_PER_NIGHT * 2n,
    );
    expect(sold.adults).toBe(3);
  });
});

describe("a stay the funnel holds", () => {
  const CHECK_IN = "2028-02-05";
  const CHECK_OUT = "2028-02-07";
  const NIGHTS = [CHECK_IN, "2028-02-06"];

  let held: Booking;

  it("consumes the nights at the moment of the hold, not at payment", async () => {
    // A hold that did not consume them would be a room two guests could both
    // reach the payment step for.
    const before = Date.now();
    held = await createHold(stay("DELUXE", CHECK_IN, CHECK_OUT));

    expect(held.state).toBe("HELD");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1]);

    const expiry = held.holdExpiresAt!.getTime();
    expect(expiry).toBeGreaterThanOrEqual(
      before + HOLD_TTL_MINUTES * MS_PER_MINUTE,
    );
    expect(expiry).toBeLessThanOrEqual(
      Date.now() + HOLD_TTL_MINUTES * MS_PER_MINUTE,
    );
  });

  it("moves no inventory when the deposit lands", async () => {
    // §3: `HELD` → `CONFIRMED` is the one transition with no inventory effect.
    // Reserving again here would sell the stay twice to the guest already
    // holding it.
    const confirmed = await confirm(held.id);

    expect(confirmed.state).toBe("CONFIRMED");
    expect(confirmed.holdExpiresAt).toBeNull();
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1]);
  });

  it("answers a second confirmation with the state it is already in", async () => {
    // §4's idempotency guard. A retried request and a double-clicked button both
    // arrive as the transition that already happened, and a 409 would make a
    // caller that did nothing wrong retry forever.
    const again = await confirm(held.id);

    expect(again.state).toBe("CONFIRMED");
    expect(await soldOn("DELUXE", NIGHTS)).toEqual([1, 1]);
  });
});

describe("a booking that is cancelled", () => {
  const CHECK_IN = "2028-02-14";
  const CHECK_OUT = "2028-02-17";
  const NIGHTS = [CHECK_IN, "2028-02-15", "2028-02-16"];

  let sold: Booking;

  it("gives every night back and records why", async () => {
    sold = await createConfirmed(stay("PREMIER", CHECK_IN, CHECK_OUT));
    expect(await soldOn("PREMIER", NIGHTS)).toEqual([1, 1, 1]);

    const cancelled = await cancel(sold.id, "GUEST_REQUEST");

    expect(cancelled.state).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toBe("GUEST_REQUEST");
    expect(await soldOn("PREMIER", NIGHTS)).toEqual([0, 0, 0]);
  });

  it("does not give them back a second time", async () => {
    // The assertion the idempotency guard is actually for. A second cancellation
    // that answered politely and released the nights again would credit the
    // property with inventory it never sold, and the counter would then read as
    // availability that does not exist.
    const again = await cancel(sold.id, "STAFF_ERROR");

    expect(again.state).toBe("CANCELLED");
    // The first reason stands. A cancellation is one event, and re-answering it
    // must not rewrite what §4's grid would price it by.
    expect(again.cancellationReason).toBe("GUEST_REQUEST");
    expect(await soldOn("PREMIER", NIGHTS)).toEqual([0, 0, 0]);
  });

  it("releases an unpaid hold on the same terms", async () => {
    // §3 gives an expired hold and a guest cancellation one inventory effect and
    // different reason codes, which is why there is one method and not two.
    const held = await createHold(stay("PREMIER", "2028-03-01", "2028-03-03"));
    const nights = ["2028-03-01", "2028-03-02"];

    expect(await soldOn("PREMIER", nights)).toEqual([1, 1]);

    const cancelled = await cancel(held.id, "HOLD_EXPIRED");

    expect(cancelled.cancellationReason).toBe("HOLD_EXPIRED");
    expect(cancelled.holdExpiresAt).toBeNull();
    expect(await soldOn("PREMIER", nights)).toEqual([0, 0]);
  });
});

describe("moves the transition table refuses", () => {
  it("will not cancel a stay that already happened", async () => {
    // §2's deliberate gap. The guest is in the building; shortening the stay is
    // an early departure, which posts a policy charge and settles a folio.
    const sold = await createConfirmed(
      stay("DELUXE", "2028-03-10", "2028-03-12"),
    );
    const nights = ["2028-03-10", "2028-03-11"];

    await forceState(sold.id, "CHECKED_IN");

    await expect(cancel(sold.id, "GUEST_REQUEST")).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    // And the room is still consumed. A refusal that had released the nights on
    // its way out would be worse than the move it refused.
    expect(await soldOn("DELUXE", nights)).toEqual([1, 1]);
  });

  it("will not confirm a booking that has ended", async () => {
    const sold = await createConfirmed(
      stay("DELUXE", "2028-03-20", "2028-03-22"),
    );

    await cancel(sold.id, "PAYMENT_FAILED");

    await expect(confirm(sold.id)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("will not act on a booking that does not exist", async () => {
    await expect(confirm(crypto.randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("a stay the property cannot sell", () => {
  const CHECK_IN = "2028-04-05";
  const SOLD_OUT = "2028-04-06";
  const CHECK_OUT = "2028-04-08";
  const NIGHTS = [CHECK_IN, SOLD_OUT, "2028-04-07"];

  it("leaves no booking row and no consumed night behind it", async () => {
    // The middle night only, so a path that walked the range would consume the
    // first, fail on the second, and leave a room sold to a booking that does
    // not exist. The transaction is what makes the whole transition undo.
    await sellOut("PREMIER", [SOLD_OUT], PREMIER_ROOMS);

    const before = await soldOn("PREMIER", NIGHTS);

    await expect(
      createConfirmed(stay("PREMIER", CHECK_IN, CHECK_OUT)),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await soldOn("PREMIER", NIGHTS)).toEqual(before);
    expect(await bookingsStartingOn(CHECK_IN)).toBe(0);
  });

  it("refuses a range the property has published no price for", async () => {
    // The seed opens and prices twelve months from 2027-06-01. A stay running
    // off the end is refused before its rooms are taken, because a partly-priced
    // stay quoted anyway would sell a range for less than it covers.
    await expect(
      createConfirmed(stay("DELUXE", "2028-05-30", "2028-06-03")),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await bookingsStartingOn("2028-05-30")).toBe(0);
  });

  it("refuses a party the room cannot sleep", async () => {
    // `type_inventory` counts rooms and not heads, so nothing in storage would
    // refuse a party of three sold into a room that sleeps two.
    await expect(
      createConfirmed({
        ...stay("DELUXE", "2028-04-20", "2028-04-22"),
        party: { adults: 2, children: [{ age: 8 }] },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await bookingsStartingOn("2028-04-20")).toBe(0);
  });

  it("refuses a stay of no nights", async () => {
    await expect(
      createConfirmed(stay("DELUXE", "2028-04-25", "2028-04-25")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  // Not here: the 404 for a type the property has not laid down.
  // `room_type_code` is a Postgres enum, so a code outside the five is refused
  // as a bad parameter before the lookup runs — the same branch
  // `inventory-reservation.e2e-spec.ts` leaves untested, for the same reason.
});

/** One transition, in its own transaction — the boundary a controller draws. */
async function createConfirmed(input: CreateBookingInput): Promise<Booking> {
  return await db.transaction((exec) => bookings.createConfirmed(exec, input));
}

async function createHold(input: CreateBookingInput): Promise<Booking> {
  return await db.transaction((exec) => bookings.createHold(exec, input));
}

async function confirm(bookingId: string): Promise<Booking> {
  return await db.transaction((exec) => bookings.confirm(exec, bookingId));
}

async function cancel(
  bookingId: string,
  reason: Parameters<BookingService["cancel"]>[2],
): Promise<Booking> {
  return await db.transaction((exec) =>
    bookings.cancel(exec, bookingId, reason),
  );
}

/** The request shape, from the two strings a date is written as. */
function stay(
  code: RoomTypeCode,
  checkIn: string,
  checkOut: string,
): CreateBookingInput {
  return {
    roomType: code,
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
    plan: "STANDARD",
    party: { adults: 2, children: [] },
  };
}

/**
 * Puts a booking into a state this milestone has no transition into.
 *
 * The subject of the tests that use it is §2 refusing a move *out* of
 * `CHECKED_IN`, and reaching that state properly needs a business date, a room
 * assignment and a housekeeping status — none of which the refusal depends on.
 */
async function forceState(bookingId: string, state: "CHECKED_IN"): Promise<void> {
  await db.update(booking).set({ state }).where(eq(booking.id, bookingId));
}

/** How many of a type are gone on each of the given nights, in that order. */
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
    const soldRooms = byDate.get(night);

    if (soldRooms === undefined) {
      throw new Error(`${code} has no counter on ${night}`);
    }

    return soldRooms;
  });
}

/** Sets how many of a type are already gone on each of the given nights. */
async function sellOut(
  code: RoomTypeCode,
  nights: readonly string[],
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
        inArray(typeInventory.stayDate, [...nights]),
      ),
    );
}

/** Bookings arriving on a date — zero is what a rolled-back transition leaves. */
async function bookingsStartingOn(checkInDate: string): Promise<number> {
  const rows = await db
    .select({ id: booking.id })
    .from(booking)
    .where(eq(booking.checkInDate, checkInDate));

  return rows.length;
}
