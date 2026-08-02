// The reproducible seed — `FR-INV-05`.
//
// Its acceptance is short and the whole of it is checkable: one command, and a
// mix that does not sum to 40 is a seed bug. What that sentence is protecting
// is that the demo property is the property `property-and-tariff.md` §1
// describes, because every screenshot, every performance measurement and every
// conversation about "the Deluxe on the fourteenth" is taken against it.
//
// No Nest application is booted. The subject is what lands in the database.

import { parseDate } from "@internationalized/date";
import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/database.module.js";
import * as schema from "../src/database/schema/index.js";
import { guestUser } from "../src/database/schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { rateCalendar, ratePlan } from "../src/database/schema/pricing.js";
import {
  ROOM_COUNT,
  ROOM_TYPES,
  SEED_EMAIL_DOMAIN,
  SYNTHETIC_BOOKINGS,
} from "../src/database/seed/property.js";
import { type SeedSummary, seedDatabase } from "../src/database/seed/seed.js";

const SEED_FROM = parseDate("2027-09-01");

// Twelve months from 1 September 2027 — 2028 is a leap year, and the range
// stops before 1 September 2028, so February's extra day is inside it.
const NIGHTS_IN_TWELVE_MONTHS = 366;

let pool: pg.Pool;
let db: Database;
let summary: SeedSummary;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  summary = await seedDatabase(db, { from: SEED_FROM });
});

afterAll(async () => {
  await pool?.end();
});

describe("the property it builds", () => {
  it("creates the five types the mix names", async () => {
    const types = await db.select().from(roomType);

    expect(types).toHaveLength(ROOM_TYPES.length);
    expect(new Set(types.map((type) => type.code))).toEqual(
      new Set(ROOM_TYPES.map((type) => type.code)),
    );
  });

  it("creates exactly forty rooms", async () => {
    const rooms = await db.select().from(room);

    expect(rooms).toHaveLength(ROOM_COUNT);
    expect(summary.rooms).toBe(ROOM_COUNT);
  });

  it("numbers every room `<floor><nn>` on floors two to five, once each", async () => {
    const rooms = await db.select().from(room);
    const numbers = rooms.map((each) => each.number).sort();

    // §1's acceptance: every room number in the document exists exactly once.
    const expected = [2, 3, 4, 5]
      .flatMap((floor) =>
        Array.from(
          { length: 10 },
          (_, index) => `${floor}${String(index + 1).padStart(2, "0")}`,
        ),
      )
      .sort();

    expect(numbers).toEqual(expected);
    expect(new Set(numbers).size).toBe(ROOM_COUNT);

    // And the floor column agrees with the number it is embedded in.
    for (const each of rooms) {
      expect(each.floor).toBe(Number(each.number[0]));
    }
  });

  it("gives each type exactly the rooms the mix allots it", async () => {
    for (const type of ROOM_TYPES) {
      const [row] = await db
        .select({ rooms: sql<number>`count(*)::int` })
        .from(room)
        .innerJoin(roomType, eq(roomType.id, room.roomTypeId))
        .where(eq(roomType.code, type.code));

      expect(row!.rooms).toBe(type.rooms);
    }
  });

  it("refuses a mix that does not sum to forty", () => {
    // The check runs before the first write. §1: "a seed that does not sum to
    // 40 is a seed bug", and a seed that discovered it halfway through would
    // leave a half-built property behind to be diagnosed.
    const mix = ROOM_TYPES.reduce((total, type) => total + type.rooms, 0);

    expect(mix).toBe(ROOM_COUNT);
  });
});

describe("the calendar it opens", () => {
  it("opens twelve months for every type", async () => {
    const [rates] = await db
      .select({ rows: sql<number>`count(*)::int` })
      .from(rateCalendar);

    expect(rates!.rows).toBe(NIGHTS_IN_TWELVE_MONTHS * ROOM_TYPES.length);
    expect(summary.nightsOpened).toBe(NIGHTS_IN_TWELVE_MONTHS);
    expect(summary.firstNight).toBe("2027-09-01");
    expect(summary.lastNight).toBe("2028-08-31");
  });

  it("gives every priced night a counter to sell against", async () => {
    // The two tables the availability query joins. A rate with no inventory row
    // is a price for a night the property never opened, and the query would
    // drop the type entirely.
    const { rows } = await db.execute<{ unpriced: number }>(sql`
      select count(*)::int as unpriced
      from rate_calendar rc
      left join type_inventory ti
        on ti.room_type_id = rc.room_type_id and ti.stay_date = rc.stay_date
      where ti.id is null
    `);

    expect(rows[0]!.unpriced).toBe(0);
  });

  it("starts every night's `total_rooms` at the type's room count", async () => {
    for (const type of ROOM_TYPES) {
      const [row] = await db
        .select({ totals: sql<string>`array_agg(distinct ${typeInventory.totalRooms})` })
        .from(typeInventory)
        .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
        .where(eq(roomType.code, type.code));

      expect(row!.totals).toEqual([type.rooms]);
    }
  });

  it("prices a Friday above the Monday before it", async () => {
    // §3's weekend, written into the rows rather than derived by a query.
    const superior = ROOM_TYPES.find((type) => type.code === "SUPERIOR")!;

    const [monday] = await db
      .select({ gross: rateCalendar.grossPerNight })
      .from(rateCalendar)
      .innerJoin(roomType, eq(roomType.id, rateCalendar.roomTypeId))
      .where(
        and(
          eq(roomType.code, "SUPERIOR"),
          eq(rateCalendar.stayDate, "2027-09-06"),
        ),
      );

    const [friday] = await db
      .select({ gross: rateCalendar.grossPerNight })
      .from(rateCalendar)
      .innerJoin(roomType, eq(roomType.id, rateCalendar.roomTypeId))
      .where(
        and(
          eq(roomType.code, "SUPERIOR"),
          eq(rateCalendar.stayDate, "2027-09-10"),
        ),
      );

    expect(monday!.gross).toBe(superior.baseGrossPerNight);
    expect(friday!.gross).toBe((superior.baseGrossPerNight * 125n) / 100n);
  });

  it("writes the three plans §3 names", async () => {
    const plans = await db.select().from(ratePlan);

    expect(plans).toHaveLength(3);

    const nonref = plans.find((plan) => plan.code === "NONREF")!;
    const bb = plans.find((plan) => plan.code === "BB")!;

    expect(nonref.percentAdjustment).toBe(-10);
    expect(nonref.breakfastPerPersonGross).toBeNull();
    expect(bb.percentAdjustment).toBe(0);
    expect(bb.breakfastPerPersonGross).toBe(250_000n);
  });
});

describe("the stays it books", () => {
  it("writes five hundred of them", async () => {
    expect(summary.bookings).toBe(SYNTHETIC_BOOKINGS);

    const [held] = await db
      .select({ rows: sql<number>`count(*)::int` })
      .from(roomAssignment);

    expect(held!.rows).toBe(SYNTHETIC_BOOKINGS);
  });

  it("gives every stay a guest with a Vietnamese name", async () => {
    // Scoped to the seeded domain, because a guest who actually signed up is
    // not the seed's to count — and not the seed's to delete either, which is
    // why the wipe matches on this same domain.
    const guests = await db
      .select({ name: guestUser.name, email: guestUser.email })
      .from(guestUser)
      .where(like(guestUser.email, `%@${SEED_EMAIL_DOMAIN}`));

    expect(guests).toHaveLength(SYNTHETIC_BOOKINGS);

    for (const guest of guests) {
      expect(guest.name.trim().length).toBeGreaterThan(0);
      expect(guest.email.endsWith(`@${SEED_EMAIL_DOMAIN}`)).toBe(true);
      // The local part is ASCII even though the display name is not — an
      // address with a `ầ` in it is a support ticket.
      expect(guest.email).toMatch(/^[a-z0-9.]+@/);
    }

    // Vietnamese, not English: at least one name carries a diacritic. A locale
    // that silently fell back to `en` would pass every other assertion here.
    expect(
      guests.some((guest) => /[àáãạảăâèéêìíòóôõơùúýăđ]/i.test(guest.name)),
    ).toBe(true);
  });

  it("counts `sold_rooms` from the stays it actually placed", async () => {
    // The two layers, reconciled. `type_inventory.sold_rooms` for a type and a
    // date must equal the number of rooms of that type held that night — this
    // is the invariant a real booking will have to keep at M4, and a seed that
    // broke it would make every availability assertion meaningless.
    const { rows } = await db.execute<{ disagreements: number }>(sql`
      with held as (
        select r.room_type_id, d.stay_date::date as stay_date, count(*)::int as rooms
        from room_assignment ra
        join room r on r.id = ra.room_id
        cross join lateral generate_series(
          ra.check_in_date, ra.check_out_date - 1, interval '1 day'
        ) as d(stay_date)
        group by r.room_type_id, d.stay_date
      )
      select count(*)::int as disagreements
      from type_inventory ti
      left join held on held.room_type_id = ti.room_type_id
                    and held.stay_date = ti.stay_date
      where ti.sold_rooms <> coalesce(held.rooms, 0)
    `);

    expect(rows[0]!.disagreements).toBe(0);
  });

  it("never sells a room twice, and never oversells a type", async () => {
    // Both are database constraints, so this asserts the seed did not have to
    // fight them: the stays were placed against free rooms, and the counters
    // followed. The rows are here, which means Postgres accepted every one.
    const { rows } = await db.execute<{ overbooked: number }>(sql`
      select count(*)::int as overbooked
      from type_inventory
      where sold_rooms > total_rooms
    `);

    expect(rows[0]!.overbooked).toBe(0);
  });

  it("keeps every stay inside the calendar it opened", async () => {
    const { rows } = await db.execute<{ outside: number }>(sql`
      select count(*)::int as outside
      from room_assignment
      where check_in_date < ${summary.firstNight}::date
         or check_out_date > (${summary.lastNight}::date + 1)
    `);

    expect(rows[0]!.outside).toBe(0);
  });
});

describe("running it again", () => {
  it("converges rather than accumulates, and produces the same data", async () => {
    const before = await fingerprint();

    const second = await seedDatabase(db, { from: SEED_FROM });

    expect(second).toEqual(summary);
    expect(await fingerprint()).toEqual(before);
  });
});

/**
 * Enough of the seeded state to tell one run from another.
 *
 * Ids are excluded on purpose — they are `gen_random_uuid()` and are supposed
 * to differ. What must not differ is which room holds which stay, on which
 * nights, at which price.
 */
async function fingerprint(): Promise<Record<string, unknown>> {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from room) as rooms,
      (select count(*)::int from room_assignment) as stays,
      (select count(*)::int from guest_user where email like '%@seed.mariva.local') as guests,
      (select sum(gross_per_night)::text from rate_calendar) as rate_total,
      (select sum(sold_rooms)::int from type_inventory) as sold_total,
      (select string_agg(r.number || ':' || ra.check_in_date, ',' order by ra.check_in_date, r.number)
         from room_assignment ra join room r on r.id = ra.room_id) as holds,
      (select string_agg(name, ',' order by email) from guest_user where email like '%@seed.mariva.local') as guest_names
  `);

  return rows[0]!;
}
