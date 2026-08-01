// The availability query, end to end — `FR-INV-03`.
//
// It runs against the seeded property rather than a hand-built fixture, because
// the requirement is about a twelve-month calendar and forty rooms and the
// numbers only mean something at that size. The seed is pinned to a fixed month
// (`SEED_FROM`), so "the Friday" and "the Tuesday" below are the same nights on
// every run and a price can be asserted rather than merely compared.
//
// Restrictions are the exception. The seed writes them sparsely and at random
// within its stream, which is right for a demo and useless for an assertion, so
// this suite clears them and writes the four rules itself — one test each, per
// `FR-PRC-02`'s acceptance.
//
// The perf assertion at the foot is `NFR-03`: p95 under 300 ms over the twelve
// months the seed opened.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { roomType, typeInventory } from "../src/database/schema/inventory.js";
import { stayRestriction } from "../src/database/schema/pricing.js";
import { ROOM_TYPES } from "../src/database/seed/property.js";
import { seedDatabase } from "../src/database/seed/seed.js";

// A pinned month, so a night named here is the same night on every run. March
// 2027 opens on a Monday: the 2nd is a Tuesday and the 5th and 6th are the
// Friday and Saturday §3 prices as weekend.
const SEED_FROM = parseDate("2027-03-01");
const TUESDAY = "2027-03-02";
const WEDNESDAY = "2027-03-03";
const FRIDAY = "2027-03-05";
const SATURDAY = "2027-03-06";
const SUNDAY = "2027-03-07";

const SUPERIOR = ROOM_TYPES.find((type) => type.code === "SUPERIOR")!;
const PANORAMA = ROOM_TYPES.find((type) => type.code === "PANORAMA_SUITE")!;

let app: INestApplication;
let db: Database;
let http: () => request.Agent;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // No synthetic stays. Every night starts empty, so a sold-out night in a test
  // below is one that test sold — otherwise an assertion would be reading five
  // hundred random holds and passing or failing by luck.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

// The seed writes its own sparse restrictions. They are cleared before each
// test so that a rule under test is the only rule in play.
beforeEach(async () => {
  await db.delete(stayRestriction);
});

/** The gross a night costs before any plan touches it. */
function weekendGross(base: bigint): bigint {
  return (base * 125n) / 100n;
}

async function typeIdOf(code: string): Promise<string> {
  const [row] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, code as "SUPERIOR"))
    .limit(1);

  return row!.id;
}

/** Sells every room of a type on one night, the way a full house looks. */
async function sellOut(code: string, night: string): Promise<void> {
  await db
    .update(typeInventory)
    .set({ soldRooms: sql`${typeInventory.totalRooms}` })
    .where(
      and(
        eq(typeInventory.roomTypeId, await typeIdOf(code)),
        eq(typeInventory.stayDate, night),
      ),
    );
}

/** Puts a type's inventory back the way the seed left it. */
async function restore(code: string, night: string): Promise<void> {
  await db
    .update(typeInventory)
    .set({ soldRooms: 0 })
    .where(
      and(
        eq(typeInventory.roomTypeId, await typeIdOf(code)),
        eq(typeInventory.stayDate, night),
      ),
    );
}

interface Offer {
  code: string;
  perNightGross: string;
  stayTotalGross: string;
  isAvailable: boolean;
  extraBedPerNightGross: string | null;
}

async function search(query: Record<string, string | number>): Promise<{
  plan: string;
  offers: Offer[];
}> {
  const response = await http().get("/availability").query(query).expect(200);

  return response.body;
}

describe("the availability search", () => {
  it("prices a weeknight at the calendar rate", async () => {
    const { offers } = await search({
      checkIn: TUESDAY,
      checkOut: WEDNESDAY,
      plan: "STANDARD",
    });

    const superior = offers.find((offer) => offer.code === "SUPERIOR")!;

    expect(BigInt(superior.stayTotalGross)).toBe(SUPERIOR.baseGrossPerNight);
    expect(superior.isAvailable).toBe(true);
  });

  it("prices a Friday and Saturday as weekend nights", async () => {
    // §3: "an arrival date of Fri or Sat prices as weekend". The uplift is
    // written into the rows by the seed, never derived by the query — which is
    // what lets a public holiday on a Tuesday be priced as a weekend later.
    const { offers } = await search({
      checkIn: FRIDAY,
      checkOut: SUNDAY,
      plan: "STANDARD",
    });

    const superior = offers.find((offer) => offer.code === "SUPERIOR")!;

    expect(BigInt(superior.stayTotalGross)).toBe(
      weekendGross(SUPERIOR.baseGrossPerNight) * 2n,
    );
  });

  it("returns every type in display order", async () => {
    const { offers } = await search({ checkIn: TUESDAY, checkOut: WEDNESDAY });

    expect(offers.map((offer) => offer.code)).toEqual([
      "SUPERIOR",
      "DELUXE",
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("sums the stay total un-rounded and averages the per-night figure", async () => {
    // `rate-calendar.ts`: the total is the authoritative number and the client
    // must not derive it, because a weekend and a weeknight in one range do not
    // average to either of them.
    const { offers } = await search({
      checkIn: WEDNESDAY,
      checkOut: SATURDAY,
      plan: "STANDARD",
    });

    const superior = offers.find((offer) => offer.code === "SUPERIOR")!;
    const expected =
      SUPERIOR.baseGrossPerNight * 2n + weekendGross(SUPERIOR.baseGrossPerNight);

    expect(BigInt(superior.stayTotalGross)).toBe(expected);
    expect(BigInt(superior.perNightGross)).toBe(expected / 3n);
  });

  it("takes ten percent off for NONREF", async () => {
    const { offers } = await search({
      checkIn: TUESDAY,
      checkOut: WEDNESDAY,
      plan: "NONREF",
    });

    const superior = offers.find((offer) => offer.code === "SUPERIOR")!;

    expect(BigInt(superior.stayTotalGross)).toBe(
      (SUPERIOR.baseGrossPerNight * 90n) / 100n,
    );
  });

  it("adds breakfast per head per night for BB", async () => {
    // §3: `BB` is `STANDARD` + breakfast "for the booked occupancy", so two
    // guests pay twice what one does for the meal and the same for the room.
    const single = await search({
      checkIn: TUESDAY,
      checkOut: WEDNESDAY,
      plan: "BB",
      occupancy: 1,
    });
    const double = await search({
      checkIn: TUESDAY,
      checkOut: WEDNESDAY,
      plan: "BB",
      occupancy: 2,
    });

    const one = BigInt(
      single.offers.find((offer) => offer.code === "SUPERIOR")!.stayTotalGross,
    );
    const two = BigInt(
      double.offers.find((offer) => offer.code === "SUPERIOR")!.stayTotalGross,
    );

    expect(one).toBe(SUPERIOR.baseGrossPerNight + 250_000n);
    expect(two - one).toBe(250_000n);
  });

  it("marks a sold-out type unavailable and still quotes its price", async () => {
    await sellOut("SUPERIOR", TUESDAY);

    try {
      const { offers } = await search({
        checkIn: TUESDAY,
        checkOut: WEDNESDAY,
      });

      const superior = offers.find((offer) => offer.code === "SUPERIOR")!;

      expect(superior.isAvailable).toBe(false);
      // The price stays on the card. A guest who can see what the room would
      // have cost knows to ask about a different date; a card that vanishes
      // teaches them the hotel has no Superior at all.
      expect(BigInt(superior.stayTotalGross)).toBe(SUPERIOR.baseGrossPerNight);

      // The other four are untouched — the constraint is per type per night.
      expect(offers.filter((offer) => offer.isAvailable)).toHaveLength(4);
    } finally {
      await restore("SUPERIOR", TUESDAY);
    }
  });

  it("refuses a party larger than the type takes", async () => {
    // §3: occupancy above the maximum is a rejection and not a price. Only the
    // Panorama Suite sleeps four.
    const { offers } = await search({
      checkIn: TUESDAY,
      checkOut: WEDNESDAY,
      occupancy: 4,
    });

    expect(
      offers.filter((offer) => offer.isAvailable).map((offer) => offer.code),
    ).toEqual([PANORAMA.code]);
  });

  it("quotes no extra-bed price, because nobody has decided when one is charged", async () => {
    // property-and-tariff.md §9 leaves the extra-bed rule with the owner and
    // says no pricing path may infer it from bed capacity. The Deluxe takes an
    // extra bed and still carries no price for one.
    const { offers } = await search({ checkIn: TUESDAY, checkOut: WEDNESDAY });

    expect(
      offers.every((offer) => offer.extraBedPerNightGross === null),
    ).toBe(true);
  });

  it("refuses a range that ends before it begins", async () => {
    await http()
      .get("/availability")
      .query({ checkIn: WEDNESDAY, checkOut: TUESDAY })
      .expect(400);
  });

  it("answers a stranger holding no session at all", async () => {
    // The one unauthenticated row in the matrix. Every other route in the
    // application 401s or 403s an anonymous caller.
    await http()
      .get("/availability")
      .query({ checkIn: TUESDAY, checkOut: WEDNESDAY })
      .expect(200);
  });
});

describe("stay restrictions", () => {
  it("refuses an arrival on a night closed to arrival", async () => {
    await db.insert(stayRestriction).values({
      roomTypeId: await typeIdOf("SUPERIOR"),
      stayDate: FRIDAY,
      closedToArrival: true,
    });

    const { offers } = await search({ checkIn: FRIDAY, checkOut: SUNDAY });

    expect(offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable).toBe(
      false,
    );

    // A stay that merely runs through the closed night is unaffected: the rule
    // is about where a stay may begin, not which nights it may cover.
    const throughIt = await search({ checkIn: WEDNESDAY, checkOut: SUNDAY });

    expect(
      throughIt.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(true);
  });

  it("refuses a departure on a night closed to departure", async () => {
    await db.insert(stayRestriction).values({
      roomTypeId: await typeIdOf("SUPERIOR"),
      stayDate: SUNDAY,
      closedToDeparture: true,
    });

    const leaving = await search({ checkIn: FRIDAY, checkOut: SUNDAY });

    expect(
      leaving.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(false);

    // Departing the day before is fine — the flag is on one date.
    const earlier = await search({ checkIn: FRIDAY, checkOut: SATURDAY });

    expect(
      earlier.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(true);
  });

  it("refuses a stay shorter than the minimum on the arrival night", async () => {
    await db.insert(stayRestriction).values({
      roomTypeId: await typeIdOf("SUPERIOR"),
      stayDate: FRIDAY,
      minimumStay: 2,
    });

    const oneNight = await search({ checkIn: FRIDAY, checkOut: SATURDAY });
    const twoNights = await search({ checkIn: FRIDAY, checkOut: SUNDAY });

    expect(
      oneNight.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(false);
    expect(
      twoNights.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(true);
  });

  it("refuses a stay longer than the maximum on the arrival night", async () => {
    await db.insert(stayRestriction).values({
      roomTypeId: await typeIdOf("SUPERIOR"),
      stayDate: WEDNESDAY,
      maximumStay: 2,
    });

    const twoNights = await search({ checkIn: WEDNESDAY, checkOut: FRIDAY });
    const threeNights = await search({ checkIn: WEDNESDAY, checkOut: SATURDAY });

    expect(
      twoNights.offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable,
    ).toBe(true);
    expect(
      threeNights.offers.find((offer) => offer.code === "SUPERIOR")!
        .isAvailable,
    ).toBe(false);
  });

  it("restricts one type without restricting the rest", async () => {
    await db.insert(stayRestriction).values({
      roomTypeId: await typeIdOf("SUPERIOR"),
      stayDate: FRIDAY,
      minimumStay: 3,
    });

    const { offers } = await search({ checkIn: FRIDAY, checkOut: SATURDAY });

    expect(offers.find((offer) => offer.code === "SUPERIOR")!.isAvailable).toBe(
      false,
    );
    expect(offers.filter((offer) => offer.isAvailable)).toHaveLength(4);
  });
});

describe("the rate calendar", () => {
  it("returns one cell per day of the month", async () => {
    const response = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3, plan: "STANDARD" })
      .expect(200);

    expect(response.body.nights).toHaveLength(31);
    expect(response.body.nights[0].date).toBe("2027-03-01");
    expect(response.body.nights.at(-1).date).toBe("2027-03-31");
  });

  it("carries the cheapest type still free", async () => {
    const response = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3 })
      .expect(200);

    const tuesday = response.body.nights.find(
      (night: { date: string }) => night.date === TUESDAY,
    );

    // The Superior is the cheapest of the five, so it is the from-price.
    expect(BigInt(tuesday.lowestGross)).toBe(SUPERIOR.baseGrossPerNight);
    expect(tuesday.isSoldOut).toBe(false);
  });

  it("drops the price and reports sold out when the whole house is gone", async () => {
    for (const type of ROOM_TYPES) {
      await sellOut(type.code, TUESDAY);
    }

    try {
      const response = await http()
        .get("/availability/calendar")
        .query({ year: 2027, month: 3 })
        .expect(200);

      const tuesday = response.body.nights.find(
        (night: { date: string }) => night.date === TUESDAY,
      );

      expect(tuesday.isSoldOut).toBe(true);
      expect(tuesday.lowestGross).toBeNull();
      // Sold out and closed-to-arrival are separate cell states. A night nobody
      // can book for want of a room has not taught the guest a rule.
      expect(tuesday.isClosedToArrival).toBe(false);
    } finally {
      for (const type of ROOM_TYPES) {
        await restore(type.code, TUESDAY);
      }
    }
  });

  it("re-prices the whole grid when the plan changes", async () => {
    const standard = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3, plan: "STANDARD" })
      .expect(200);

    const nonref = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3, plan: "NONREF" })
      .expect(200);

    expect(BigInt(nonref.body.nights[1].lowestGross)).toBe(
      (BigInt(standard.body.nights[1].lowestGross) * 90n) / 100n,
    );
  });

  it("reports a night closed to arrival for every free type", async () => {
    for (const type of ROOM_TYPES) {
      await db.insert(stayRestriction).values({
        roomTypeId: await typeIdOf(type.code),
        stayDate: FRIDAY,
        closedToArrival: true,
      });
    }

    const response = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3 })
      .expect(200);

    const friday = response.body.nights.find(
      (night: { date: string }) => night.date === FRIDAY,
    );

    expect(friday.isClosedToArrival).toBe(true);
    expect(friday.isSoldOut).toBe(false);
  });

  it("carries the shortest minimum stay any free type allows", async () => {
    await db.insert(stayRestriction).values([
      {
        roomTypeId: await typeIdOf("SUPERIOR"),
        stayDate: FRIDAY,
        minimumStay: 3,
      },
      {
        roomTypeId: await typeIdOf("DELUXE"),
        stayDate: FRIDAY,
        minimumStay: 2,
      },
    ]);

    const response = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 3 })
      .expect(200);

    const friday = response.body.nights.find(
      (night: { date: string }) => night.date === FRIDAY,
    );

    // Three other types carry no rule at all, so the cell says 1: the grid
    // reports the loosest rule a guest could satisfy, not the strictest.
    expect(friday.minimumStay).toBe(1);
  });
});

describe("NFR-03 — the availability budget", () => {
  it("answers a month of the calendar inside 300 ms at p95", async () => {
    // The data underneath is the seeded twelve months: 1,825 rate rows and
    // 1,825 inventory rows across five types. The budget is per answer, so the
    // measurement is a distribution and not a total.
    const samples: number[] = [];

    for (let month = 1; month <= 12; month += 1) {
      for (let repeat = 0; repeat < 5; repeat += 1) {
        const started = performance.now();

        await http()
          .get("/availability/calendar")
          .query({ year: month >= 3 ? 2027 : 2028, month, plan: "BB" })
          .expect(200);

        samples.push(performance.now() - started);
      }
    }

    samples.sort((left, right) => left - right);

    const p95 = samples[Math.floor(samples.length * 0.95)]!;

    expect(p95).toBeLessThan(300);
  });

  it("answers a stay search inside 300 ms at p95", async () => {
    const samples: number[] = [];

    for (let offset = 0; offset < 60; offset += 1) {
      const checkIn = SEED_FROM.add({ days: offset });
      const started = performance.now();

      await http()
        .get("/availability")
        .query({
          checkIn: checkIn.toString(),
          checkOut: checkIn.add({ days: 3 }).toString(),
          plan: "BB",
          occupancy: 2,
        })
        .expect(200);

      samples.push(performance.now() - started);
    }

    samples.sort((left, right) => left - right);

    expect(samples[Math.floor(samples.length * 0.95)]!).toBeLessThan(300);
  });
});
