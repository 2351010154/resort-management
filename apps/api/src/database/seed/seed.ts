// `FR-INV-05` — the property, twelve months of rates, and five hundred stays,
// from one command and the same every time.
//
// Reproducible means two things here and they are worth separating. The first
// is that the *content* is deterministic: `faker` is seeded with a constant and
// every draw comes off that one stream in a fixed order, so a stay booked on
// the third run is the stay booked on the first. The second is that re-running
// converges rather than accumulates — the tables this owns are emptied before
// they are filled, so the seed is a statement about what the database should
// contain and not a set of rows appended to whatever was there.
//
// The mix is checked before anything is written. §1 says a mix that does not
// sum to forty is a seed bug, and a seed that discovered that halfway through
// would leave a half-built property behind to be diagnosed.
//
// **There is no booking table.** The six-state machine is `M4`, and
// `room_assignment.booking_id` is deliberately foreign-key-less until there is
// something for it to point at — `schema/inventory.ts` says so. So a synthetic
// stay is written as what a stay *is* to this milestone: a hold on a physical
// room that the exclusion constraint can see, and a matching increment of the
// type's counter. That is exactly the pair a real booking will write at `M4`,
// which is what makes the seeded data able to exercise the availability query
// rather than merely occupy space in it.
//
// The two layers are written consistently by construction rather than by
// arithmetic afterwards: a stay is only generated for a room that is free for
// every one of its nights, and `sold_rooms` is counted from the stays that were
// actually placed. There is no path here that can increment a counter for a key
// nobody holds.

import { randomUUID } from "node:crypto";
import { type CalendarDate, parseDate, today } from "@internationalized/date";
import { faker } from "@faker-js/faker/locale/vi";
import { PROPERTY_TIME_ZONE, type VndAmount } from "@mariva/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../database.module.js";
import { guestUser } from "../schema/index.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../schema/inventory.js";
import {
  rateCalendar,
  ratePlan,
  stayRestriction,
} from "../schema/pricing.js";
import {
  CALENDAR_MONTHS,
  RATE_PLANS,
  ROOM_COUNT,
  ROOM_TYPES,
  roomNumbers,
  SEED_EMAIL_DOMAIN,
  SYNTHETIC_BOOKINGS,
  WEEKEND_UPLIFT_PERCENT,
} from "./property.js";

// The constant behind "the same every time". Any value would do; what matters
// is that it is fixed and that nothing else reseeds the stream.
const FAKER_SEED = 20_260_801;

// Longest synthetic stay. Five nights covers a week-long leisure booking and
// keeps the seeded occupancy spread across the calendar rather than banked in a
// few long holds — the availability query is more interesting to test against
// a calendar with holes in it.
const MAX_STAY_NIGHTS = 5;

// A stay is placed by picking a type and an arrival and looking for a free
// room. When the property is genuinely full for that combination the draw is
// retried with a different one, and after this many failures the seed reports
// what it managed rather than looping. At the occupancy five hundred stays
// produce across forty rooms and a year, it does not get near this.
const PLACEMENT_ATTEMPTS = 40;

export interface SeedSummary {
  readonly roomTypes: number;
  readonly rooms: number;
  readonly nightsOpened: number;
  readonly ratesWritten: number;
  readonly restrictions: number;
  readonly bookings: number;
  readonly firstNight: string;
  readonly lastNight: string;
}

export interface SeedOptions {
  /**
   * First night opened for sale. Defaults to the first of the current month in
   * the property's own zone — never the machine's, which in UTC would open the
   * calendar a day early for seven months of the year.
   */
  readonly from?: CalendarDate;
  readonly bookings?: number;
}

/**
 * Empties what this seed owns and writes it again.
 *
 * Deliberately not a `TRUNCATE … CASCADE`: cascade would take out whatever
 * unrelated table someone later points at these, and the list below is the
 * statement of what this seed considers its own. Guests are deleted by their
 * seeded email domain, so a database holding both demo data and a real sign-in
 * keeps the second.
 */
async function wipe(db: Database): Promise<void> {
  await db.execute(sql`delete from ${roomAssignment}`);
  await db.execute(sql`delete from ${typeInventory}`);
  await db.execute(sql`delete from ${stayRestriction}`);
  await db.execute(sql`delete from ${rateCalendar}`);
  await db.execute(sql`delete from ${room}`);
  await db.execute(sql`delete from ${roomType}`);
  await db.execute(sql`delete from ${ratePlan}`);
  await db.execute(
    sql`delete from ${guestUser} where ${guestUser.email} like ${`%@${SEED_EMAIL_DOMAIN}`}`,
  );
}

export async function seedDatabase(
  db: Database,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const mix = ROOM_TYPES.reduce((total, type) => total + type.rooms, 0);

  // §1's acceptance, and it runs before the first write rather than after the
  // last: "a seed that does not sum to 40 is a seed bug".
  if (mix !== ROOM_COUNT) {
    throw new Error(
      `The type mix sums to ${mix} rooms, not ${ROOM_COUNT} — property.ts and property-and-tariff.md §1 disagree`,
    );
  }

  faker.seed(FAKER_SEED);

  const first = options.from ?? startOfPropertyMonth();
  const nights = calendarNights(first);
  const bookingCount = options.bookings ?? SYNTHETIC_BOOKINGS;

  await wipe(db);

  const typeIds = await insertRoomTypes(db);
  const rooms = await insertRooms(db, typeIds);

  await db.insert(ratePlan).values(
    RATE_PLANS.map((plan) => ({
      code: plan.code,
      name: plan.name,
      percentAdjustment: plan.percentAdjustment,
      breakfastPerPersonGross: plan.breakfastPerPersonGross,
      displayOrder: plan.displayOrder,
    })),
  );

  const rates = ROOM_TYPES.flatMap((type) =>
    nights.map((night) => ({
      roomTypeId: typeIds.get(type.code)!,
      stayDate: night.toString(),
      grossPerNight: nightlyGross(type.baseGrossPerNight, night),
    })),
  );

  await insertInChunks(db, rateCalendar, rates);

  const stays = placeStays(rooms, nights, bookingCount);

  // Counted from the stays that were actually placed, never assumed. A counter
  // written from an intended number rather than a placed one is the two layers
  // disagreeing, which is the state this milestone exists to make impossible.
  const soldByTypeAndDate = new Map<string, number>();

  for (const stay of stays) {
    for (const night of stay.nights) {
      const key = `${stay.roomTypeCode}|${night}`;
      soldByTypeAndDate.set(key, (soldByTypeAndDate.get(key) ?? 0) + 1);
    }
  }

  const inventory = ROOM_TYPES.flatMap((type) =>
    nights.map((night) => ({
      roomTypeId: typeIds.get(type.code)!,
      stayDate: night.toString(),
      totalRooms: type.rooms,
      soldRooms: soldByTypeAndDate.get(`${type.code}|${night.toString()}`) ?? 0,
    })),
  );

  await insertInChunks(db, typeInventory, inventory);

  const restrictions = buildRestrictions(typeIds, nights);
  await insertInChunks(db, stayRestriction, restrictions);

  await insertGuestsAndStays(db, stays);

  return {
    roomTypes: ROOM_TYPES.length,
    rooms: rooms.length,
    nightsOpened: nights.length,
    ratesWritten: rates.length,
    restrictions: restrictions.length,
    bookings: stays.length,
    firstNight: nights[0]!.toString(),
    lastNight: nights.at(-1)!.toString(),
  };
}

async function insertRoomTypes(
  db: Database,
): Promise<Map<string, string>> {
  const inserted = await db
    .insert(roomType)
    .values(
      ROOM_TYPES.map((type) => ({
        code: type.code,
        name: type.name,
        maxOccupancy: type.maxOccupancy,
        beddingSleeps: type.beddingSleeps,
        takesExtraBed: type.takesExtraBed,
        squareMetres: type.squareMetres,
        bedding: type.bedding,
        aspect: type.aspect,
        description: type.description,
        displayOrder: type.displayOrder,
      })),
    )
    .returning({ id: roomType.id, code: roomType.code });

  return new Map(inserted.map((row) => [row.code, row.id]));
}

interface SeededRoom {
  readonly id: string;
  readonly number: string;
  readonly roomTypeCode: string;
}

/**
 * The forty rooms, dealt across the four floors in type order.
 *
 * §1 fixes the numbering and the mix but not which room is which type, so the
 * types are laid down in display order and the numbers taken in ascending
 * order: the twelve Superiors are 201–210 and 301–302, and so on up. Any
 * assignment satisfies §1; a deterministic one means a demo screenshot of room
 * 405 shows the same type tomorrow.
 */
async function insertRooms(
  db: Database,
  typeIds: Map<string, string>,
): Promise<readonly SeededRoom[]> {
  const numbers = roomNumbers();
  const rows: {
    number: string;
    floor: number;
    roomTypeId: string;
    roomTypeCode: string;
  }[] = [];

  let next = 0;

  for (const type of ROOM_TYPES) {
    for (let taken = 0; taken < type.rooms; taken += 1) {
      const slot = numbers[next]!;
      next += 1;

      rows.push({
        number: slot.number,
        floor: slot.floor,
        roomTypeId: typeIds.get(type.code)!,
        roomTypeCode: type.code,
      });
    }
  }

  const inserted = await db
    .insert(room)
    .values(rows.map(({ roomTypeCode: _ignored, ...values }) => values))
    .returning({ id: room.id, number: room.number });

  const byNumber = new Map(inserted.map((row) => [row.number, row.id]));

  return rows.map((row) => ({
    id: byNumber.get(row.number)!,
    number: row.number,
    roomTypeCode: row.roomTypeCode,
  }));
}

interface SyntheticStay {
  readonly bookingId: string;
  readonly roomId: string;
  readonly roomTypeCode: string;
  readonly checkIn: string;
  readonly checkOut: string;
  /** Every night sold — the half-open range expanded, departure excluded. */
  readonly nights: readonly string[];
  readonly guestName: string;
  readonly guestEmail: string;
}

/**
 * Five hundred stays that no two of which collide in one room.
 *
 * Placement is checked against an in-memory record of which nights each room
 * already holds, so nothing here relies on the database refusing a bad write.
 * That is not distrust of `room_assignment_no_overlap` — it is that a seed
 * which discovered its collisions by catching exclusion violations would be
 * non-deterministic in the order it recovered from them, and reproducibility is
 * the requirement.
 */
function placeStays(
  rooms: readonly SeededRoom[],
  nights: readonly CalendarDate[],
  wanted: number,
): readonly SyntheticStay[] {
  const held = new Map<string, Set<string>>(
    rooms.map((each) => [each.id, new Set<string>()]),
  );
  const stays: SyntheticStay[] = [];

  for (let placed = 0; placed < wanted; placed += 1) {
    const stay = placeOne(rooms, nights, held, placed);

    if (!stay) {
      break;
    }

    for (const night of stay.nights) {
      held.get(stay.roomId)!.add(night);
    }

    stays.push(stay);
  }

  return stays;
}

function placeOne(
  rooms: readonly SeededRoom[],
  nights: readonly CalendarDate[],
  held: Map<string, Set<string>>,
  ordinal: number,
): SyntheticStay | null {
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
    const length = faker.number.int({ min: 1, max: MAX_STAY_NIGHTS });
    const start = faker.number.int({ min: 0, max: nights.length - length });
    const wanted = nights
      .slice(start, start + length)
      .map((night) => night.toString());

    // A room drawn at random rather than the first free one: always taking the
    // lowest-numbered free room would fill 201 every night of the year and
    // leave 510 empty, which is a calendar no front-desk screen ever looks like.
    const candidates = faker.helpers.shuffle(
      rooms.filter((each) =>
        wanted.every((night) => !held.get(each.id)!.has(night)),
      ),
    );

    const chosen = candidates[0];

    if (!chosen) {
      continue;
    }

    const name = faker.person.fullName();

    return {
      // The id a booking row will carry at `M4`. Generated rather than left
      // null, because a null there means "this hold is a closure" — and a
      // synthetic guest's stay is not a closure.
      bookingId: randomUUID(),
      roomId: chosen.id,
      roomTypeCode: chosen.roomTypeCode,
      checkIn: wanted[0]!,
      checkOut: nights[start + length]!.toString(),
      nights: wanted,
      guestName: name,
      // The stay's ordinal, not a draw: two guests may share a name — Vietnamese
      // surnames concentrate hard — and the address is a unique index.
      guestEmail: seededEmail(name, ordinal),
    };
  }

  return null;
}

/**
 * Writes the guests and their holds.
 *
 * The guest rows go into Better Auth's own table because there is nowhere else
 * a person lives in this system, and a stay with no name behind it cannot
 * exercise a front-desk screen. They carry no credential: a seeded guest is
 * somebody the property has a record of, not somebody who can sign in, and
 * writing a password hash nobody chose would be a credential in a fixture.
 */
async function insertGuestsAndStays(
  db: Database,
  stays: readonly SyntheticStay[],
): Promise<void> {
  const guests = stays.map((stay) => ({
    id: randomUUID(),
    name: stay.guestName,
    email: stay.guestEmail,
    emailVerified: true,
  }));

  await insertInChunks(db, guestUser, guests);

  await insertInChunks(
    db,
    roomAssignment,
    stays.map((stay) => ({
      roomId: stay.roomId,
      bookingId: stay.bookingId,
      checkInDate: stay.checkIn,
      checkOutDate: stay.checkOut,
    })),
  );
}

/**
 * A sparse set of restrictions — `FR-PRC-02`'s four rules, on the nights a
 * property actually protects.
 *
 * Sparse on purpose. A calendar where a third of the cells carry a rule teaches
 * a guest nothing; the states have to be rare enough that meeting one is
 * informative. All of them land on weekends, which is where a two-night pattern
 * is worth protecting and where a Saturday-only stay is worth refusing.
 */
function buildRestrictions(
  typeIds: Map<string, string>,
  nights: readonly CalendarDate[],
): {
  roomTypeId: string;
  stayDate: string;
  minimumStay: number;
  closedToArrival: boolean;
}[] {
  const rows: {
    roomTypeId: string;
    stayDate: string;
    minimumStay: number;
    closedToArrival: boolean;
  }[] = [];

  for (const type of ROOM_TYPES) {
    for (const night of nights) {
      if (!isWeekendNight(night)) {
        continue;
      }

      const minimumStay = faker.number.int({ min: 1, max: 10 }) <= 3 ? 2 : 1;
      const closedToArrival = faker.number.int({ min: 1, max: 100 }) <= 8;

      // A row saying "no minimum and open to arrival" is a row saying nothing.
      // The table holds the nights the property constrained, not one row per
      // type per date repeating the default — see `schema/pricing.ts`.
      if (minimumStay === 1 && !closedToArrival) {
        continue;
      }

      rows.push({
        roomTypeId: typeIds.get(type.code)!,
        stayDate: night.toString(),
        minimumStay,
        closedToArrival,
      });
    }
  }

  return rows;
}

/** §3: a Friday or Saturday night prices as weekend. */
function isWeekendNight(date: CalendarDate): boolean {
  const day = date.toDate(PROPERTY_TIME_ZONE).getDay();

  return day === 5 || day === 6;
}

/**
 * The gross for one night — the base, uplifted on a weekend.
 *
 * Integer throughout: §5 puts money in whole đồng, and the multiply-then-divide
 * keeps the uplift exact for every base that is a multiple of four, which every
 * rate in `property.ts` is.
 */
function nightlyGross(base: VndAmount, night: CalendarDate): VndAmount {
  return isWeekendNight(night)
    ? (base * BigInt(100 + WEEKEND_UPLIFT_PERCENT)) / 100n
    : base;
}

/** Every night from the first of the month, twelve months forward. */
function calendarNights(first: CalendarDate): readonly CalendarDate[] {
  const end = first.add({ months: CALENDAR_MONTHS });
  const nights: CalendarDate[] = [];

  for (let night = first; night.compare(end) < 0; night = night.add({ days: 1 })) {
    nights.push(night);
  }

  return nights;
}

/** The first of the current month, in the property's zone. */
function startOfPropertyMonth(): CalendarDate {
  const now = today(PROPERTY_TIME_ZONE);

  return parseDate(
    `${String(now.year).padStart(4, "0")}-${String(now.month).padStart(2, "0")}-01`,
  );
}

/**
 * An address that is unmistakably seeded and unmistakably unique.
 *
 * Diacritics are stripped for the local part and kept in the display name,
 * because a Vietnamese name is the point of the locale and an email address
 * with a `ầ` in it is a support ticket.
 */
function seededEmail(name: string, salt: number): string {
  const local = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

  return `${local}.${salt}@${SEED_EMAIL_DOMAIN}`;
}

// Postgres binds one parameter per column per row and stops at 65,535 of them.
// Twelve months of rates is 1,825 rows of three columns, which fits — but the
// margin is not worth relying on the day a column is added, and a chunked
// insert costs one extra round trip.
const CHUNK_ROWS = 500;

async function insertInChunks<TTable extends Parameters<Database["insert"]>[0]>(
  db: Database,
  table: TTable,
  rows: readonly unknown[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
    const chunk = rows.slice(start, start + CHUNK_ROWS);

    if (chunk.length > 0) {
      // The row type is the table's own and is checked at every call site
      // above; it cannot be expressed through this generic without repeating
      // each table's shape here, which is what the call sites already do.
      await db.insert(table).values(chunk as never);
    }
  }
}
