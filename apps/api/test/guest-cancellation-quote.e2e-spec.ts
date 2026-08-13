// What calling a stay off would cost, asked before calling it off —
// `property-and-tariff.md` §4's grid as a question rather than as a posting.
//
// `folio-refund-service.e2e-spec.ts` proves the same grid on the way *out*, when
// the charge becomes a folio line. This proves it on the way in, and the two
// files are deliberately shaped alike: the stays are inserted rather than booked
// through the routes, because every row of §4 turns on a fact about the stay —
// the plan it was sold on, the state it is in, and the arrival the deadline is
// measured back from — and a suite that reached those through the funnel would
// be asserting the grid against whatever the seeded calendar happened to allow.
//
// **The clock is real and the arrivals move instead.** The quote prices the
// cancellation at the instant it is asked, which is `new Date()` and not a value
// any caller may send — `booking.service.ts` says why: a quote a caller could
// date is a guest choosing which side of 18:00 they are on. So the two sides of
// §4's deadline are reached by booking one stay a month out and another
// tomorrow, and each case stays on its own side of the line however long the
// suite takes to run.
//
// The claims:
//
// 1. **The figure is the calculator's, off the nights the booking froze.** The
//    three nights below are unequal and none is a multiple of another, so a
//    quote that divided the stay total by its length would agree with a fixture
//    of equal nights and with nothing here.
// 2. **`basis` travels with the amount**, because a free cancellation and a
//    charge of nothing are the same number and different facts — and the screen
//    reading this has to say which one happened.
// 3. **A state no cancellation could reach is refused rather than priced.** A
//    guest already in the building has nothing to call off, and a figure they
//    cannot act on would read as an offer.
// 4. **Nothing is written.** No folio is opened, no line is posted and the
//    booking row is untouched — a quote is a question, and the one asked twice
//    has to be answerable a third time.
// 5. **The scope is the credential's.** A stay the caller cannot prove is the
//    same `NOT_FOUND` the read of it gets.

import "reflect-metadata";

import { parseDate, today } from "@internationalized/date";
import {
  PROPERTY_TIME_ZONE,
  type BookingState,
  type RatePlanCode,
  type VndAmount,
} from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio } from "../src/database/schema/folio.js";
import { roomType } from "../src/database/schema/inventory.js";
import {
  type BookingOwner,
  BookingService,
} from "../src/modules/booking/booking.service.js";

/** A configuration nobody could mistake for a property's real one. §8 forbids
 *  the tree from carrying a real rate, and nothing here reads these anyway. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

/** The property's day, as the deadline is measured against it. */
const TODAY = today(PROPERTY_TIME_ZONE);

/**
 * An arrival far enough out that §4's free window is still open, and one close
 * enough that it has closed.
 *
 * Three days and 18:00 is the deadline, so a stay arriving tomorrow has a
 * deadline two days behind it and a stay arriving in a month has one four weeks
 * ahead. Neither is within a day of the line, which is what keeps a slow run
 * from changing which row fires.
 */
const WELL_AHEAD = TODAY.add({ days: 30 }).toString();
const IMMINENT = TODAY.add({ days: 1 }).toString();

/**
 * Three nights, no two alike and none a multiple of another.
 *
 * §4 charges "the first night", and that is a selection over these amounts
 * rather than a fraction of their total — `cancellation-calculator.ts` says so
 * in as many words, because a weekend night costs more than a Tuesday.
 */
const NIGHTS: readonly VndAmount[] = [1_200_000n, 1_000_000n, 1_500_000n];

const FIRST_NIGHT = 1_200_000n;
const FULL_STAY = 3_700_000n;

/** The two refundable plans. §4 gives them one column, and a quote that read
 *  only the one the funnel defaults to would leave the other untested. */
const REFUNDABLE: readonly RatePlanCode[] = ["STANDARD", "BB"];

let app: INestApplication;
let db: Database;
let bookings: BookingService;
let roomTypeId: string;

// References are unique and every case opens a stay of its own. Counted rather
// than drawn, so a failing run reproduces.
let bookingOrdinal = 0;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);
  bookings = app.get(BookingService);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await emptyWhatThisFileWrites();

  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(CONFIGURED);

  const [created] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  roomTypeId = created!.id;
}, 120_000);

afterAll(async () => {
  await emptyWhatThisFileWrites();
  await app?.close();
});

describe("§4's grid, as the figure a guest is shown before deciding", () => {
  it.each(REFUNDABLE)(
    "charges a %s stay nothing inside the free window, and names the row",
    async (plan) => {
      // `NONE` is a row of the grid and not the absence of one. A screen given
      // the number alone could not tell this from a departure on the final
      // night, and what it has to say is "this cancellation is free".
      const stay = await aStay({ arrival: WELL_AHEAD, plan });

      expect(await quote(stay)).toEqual({ amount: 0n, basis: "NONE" });
    },
  );

  it.each(REFUNDABLE)(
    "charges a %s stay its first night once the deadline has passed",
    async (plan) => {
      // The first night as it was sold — 1,200,000 — and not the stay total
      // over its length, which would be 1,233,333 and wrong on every stay whose
      // nights are not all priced alike.
      const stay = await aStay({ arrival: IMMINENT, plan });

      expect(await quote(stay)).toEqual({
        amount: FIRST_NIGHT,
        basis: "FIRST_NIGHT",
      });
    },
  );

  it("charges a NONREF stay the whole of it, deadline or not", async () => {
    // The plan's column has one answer for every row of the grid, which is what
    // makes the quote worth showing: a guest on this plan gets nothing back,
    // and finding that out after cancelling is the surprise this route exists
    // to prevent.
    const inside = await aStay({ arrival: WELL_AHEAD, plan: "NONREF" });
    const outside = await aStay({ arrival: IMMINENT, plan: "NONREF" });

    const whole = { amount: FULL_STAY, basis: "FULL_STAY" };

    expect(await quote(inside)).toEqual(whole);
    expect(await quote(outside)).toEqual(whole);
  });

  it("prices a hold the same way it prices a confirmed stay", async () => {
    // The funnel's guest reaches this before paying as well as after, and §4
    // charges the event against the plan — it does not read how far along the
    // booking is.
    const held = await aStay({ arrival: IMMINENT, state: "HELD" });
    const confirmed = await aStay({ arrival: IMMINENT, state: "CONFIRMED" });

    expect(await quote(held)).toEqual(await quote(confirmed));
  });
});

describe("what the quote will not answer", () => {
  // Every state §2 gives no `→ CANCELLED` from. The list is the transition
  // table's and is asked rather than restated — `state-machine.ts` walks the
  // whole grid in its own spec, and this is the wiring between the two.
  //
  // `CANCELLED` is the one that catches the easy mistake. §4's idempotency rule
  // makes a state legal to re-apply, so a quote written against
  // `isLegalTransition` prices a stay that was already called off — a figure on
  // a screen beside a button with nothing left to do.
  const UNCANCELLABLE: readonly BookingState[] = [
    "CHECKED_IN",
    "CHECKED_OUT",
    "CANCELLED",
    "NO_SHOW",
  ];

  it.each(UNCANCELLABLE)(
    "refuses a stay that is %s, rather than pricing one",
    async (state) => {
      const stay = await aStay({ arrival: IMMINENT, state });

      const refusal = await refused(quote(stay));

      expect(refusal.code).toBe("CONFLICT");
      expect(refusal.message).toContain(state);
    },
  );

  it("refuses a stay whose night prices are missing", async () => {
    // The grid scales stored nights and cannot invent them. Answered as a
    // refusal naming the stay rather than as the calculator's `RangeError`
    // reaching a route as a 500.
    const stay = await aStay({ arrival: IMMINENT, nights: [] });

    expect((await refused(quote(stay))).code).toBe("CONFLICT");
  });

  it("refuses a stay the caller cannot prove is theirs, in the words a read of it uses", async () => {
    const mine = await aStay({ arrival: IMMINENT });
    const theirs = await aStay({ arrival: IMMINENT });

    const refusal = await refused(
      bookings.cancellationQuote(db, {
        reference: theirs.reference,
        owner: { kind: "proven", bookingId: mine.id },
      }),
    );

    expect(refusal.code).toBe("NOT_FOUND");
  });
});

describe("a quote is a question", () => {
  it("moves nothing, opens no account and can be asked again", async () => {
    const stay = await aStay({ arrival: IMMINENT });
    const before = await rowOf(stay.id);

    const first = await quote(stay);
    const second = await quote(stay);

    expect(second).toEqual(first);
    // The row exactly as it was. `updated_at` is the one column a write of any
    // kind would move, so it is the cheapest proof that none happened.
    expect(await rowOf(stay.id)).toEqual(before);
    // And no folio, which is where the charge would have to land if this route
    // had priced anything for real — `M6` owns that, on another request, under
    // a capability no guest holds.
    expect(
      await db.select().from(folio).where(eq(folio.bookingId, stay.id)),
    ).toHaveLength(0);
  });
});

interface Stay {
  readonly id: string;
  readonly reference: string;
}

/** The quote as its own guest asks for it — by the reference they were given,
 *  scoped by the one stay their credential proves. */
function quote(stay: Stay) {
  return bookings.cancellationQuote(db, {
    reference: stay.reference,
    owner: { kind: "proven", bookingId: stay.id } satisfies BookingOwner,
  });
}

/**
 * A stay in a stated state, over three unequal nights from a stated arrival.
 *
 * Inserted rather than booked, for the reason at the top of this file: the
 * arrival is what puts the case on one side of §4's deadline, and the funnel
 * would only sell a night the seeded calendar has a price for.
 */
async function aStay(stay: {
  arrival: string;
  plan?: RatePlanCode;
  state?: BookingState;
  nights?: readonly VndAmount[];
}): Promise<Stay> {
  bookingOrdinal += 1;

  const state = stay.state ?? "CONFIRMED";
  const cancelled = state === "CANCELLED";
  const arrival = parseDate(stay.arrival);
  const nights = stay.nights ?? NIGHTS;

  const [created] = await db
    .insert(booking)
    .values({
      reference: `MRV-QUOTE-${String(bookingOrdinal).padStart(4, "0")}`,
      state,
      // `booking_reason_exactly_when_cancelled` and
      // `booking_records_a_cancellation_instant_exactly_when_cancelled` make
      // both a biconditional with the state.
      cancellationReason: cancelled ? "GUEST_REQUEST" : null,
      cancelledAt: cancelled ? new Date() : null,
      // `booking_hold_expiry_exactly_when_held` refuses one on anything else.
      holdExpiresAt: state === "HELD" ? new Date(Date.now() + 900_000) : null,
      roomTypeId,
      checkInDate: stay.arrival,
      checkOutDate: arrival.add({ days: NIGHTS.length }).toString(),
      ratePlanCode: stay.plan ?? "STANDARD",
      adults: 2,
      quotedStayTotalGross: FULL_STAY,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id, reference: booking.reference });

  if (nights.length > 0) {
    await db.insert(bookingNight).values(
      nights.map((standardGross, offset) => ({
        bookingId: created!.id,
        stayDate: arrival.add({ days: offset }).toString(),
        standardGross,
      })),
    );
  }

  return { id: created!.id, reference: created!.reference };
}

async function rowOf(bookingId: string) {
  const [row] = await db.select().from(booking).where(eq(booking.id, bookingId));

  return row;
}

async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the service priced a stay it should have refused");
}

/**
 * The rows this file leaves behind, and only those.
 *
 * `truncate … cascade` rather than a delete: `folio_posting` refuses a `DELETE`
 * outright, the append-only trigger raising on it for every client.
 */
async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate folio_posting, folio, room_assignment, booking_night, booking, type_inventory, room, room_type restart identity cascade`,
  );
}
