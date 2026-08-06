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
// A synthetic stay is written as three consistent facts, because that is what a
// stay now is: a `CONFIRMED` booking carrying the price it was sold at, a hold
// on a physical room that the exclusion constraint can see, and a matching
// increment of the type's counter. The booking came last — `room_assignment`
// held an invented id until there was a table for the key to point at — and now
// that the key exists the id has to name a row that exists too.
//
// Every seeded booking is `STANDARD`, two adults, no children. Not because a
// demo of one plan is interesting, but because a fixture that varied them would
// be computing breakfast heads and age bands in a seed file — arithmetic that
// belongs to `occupancy-pricing.ts` and is proved by its own tests, not by rows
// nobody asserts against. The frozen quote below is still computed rather than
// invented: it is the same sum over the same calendar the availability query
// reads, so a seeded stay's stored price and its re-derived one agree.
//
// The two layers are written consistently by construction rather than by
// arithmetic afterwards: a stay is only generated for a room that is free for
// every one of its nights, and `sold_rooms` is counted from the stays that were
// actually placed. There is no path here that can increment a counter for a key
// nobody holds.

import { randomUUID } from "node:crypto";
import {
  type CalendarDate,
  getDayOfWeek,
  parseDate,
  today,
} from "@internationalized/date";
import { faker } from "@faker-js/faker/locale/vi";
import {
  INCLUDED_OCCUPANCY,
  PROPERTY_TIME_ZONE,
  type VndAmount,
} from "@mariva/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../database.module.js";
import { booking, bookingNight } from "../schema/booking.js";
import { registration } from "../schema/guest.js";
import { guestAccount, guestSession, guestUser } from "../schema/index.js";
import { roomCondition } from "../schema/housekeeping.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../schema/inventory.js";
import {
  propertyTariff,
  rateCalendar,
  ratePlan,
  stayRestriction,
} from "../schema/pricing.js";
import { serviceCatalog } from "../schema/service.js";
import {
  CALENDAR_MONTHS,
  EXTRA_PERSON_PER_NIGHT_GROSS,
  RATE_PLANS,
  ROOM_COUNT,
  ROOM_TYPES,
  roomNumbers,
  SEED_EMAIL_DOMAIN,
  SERVICE_CATALOG,
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
  readonly serviceItems: number;
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
  // Assignments first, then the registrations, then the nights, then the
  // bookings all three hang off: each step removes the rows that reference the
  // next one, so no delete here needs a cascade to get past a key.
  //
  // Every registration goes, without a filter deciding which. A registration
  // names a booking and this wipes all of them, so there is no subset that
  // could outlive the statement below. The guests those rows named are left
  // where they are: a person is not owned by one stay, and the seed never
  // wrote them.
  await db.execute(sql`delete from ${roomAssignment}`);
  await db.execute(sql`delete from ${registration}`);
  await db.execute(sql`delete from ${bookingNight}`);
  await db.execute(sql`delete from ${booking}`);
  await db.execute(sql`delete from ${typeInventory}`);
  await db.execute(sql`delete from ${stayRestriction}`);
  await db.execute(sql`delete from ${rateCalendar}`);
  // Before the rooms they name, for the same reason the assignments went before
  // the bookings: each delete here clears the rows that reference the next.
  await db.execute(sql`delete from ${roomCondition}`);
  await db.execute(sql`delete from ${room}`);
  await db.execute(sql`delete from ${roomType}`);
  await db.execute(sql`delete from ${ratePlan}`);
  await db.execute(sql`delete from ${propertyTariff}`);
  await db.execute(sql`delete from ${serviceCatalog}`);
  // The sessions and credentials before the guests they belong to, for the same
  // reason again. A seeded guest has neither today, so this clears nothing —
  // but the first fixture that signs one in would otherwise meet a foreign-key
  // violation raised from inside a wipe, which is a long way from the test that
  // caused it.
  const seededGuests = sql`select id from ${guestUser} where ${guestUser.email} like ${`%@${SEED_EMAIL_DOMAIN}`}`;

  await db.execute(
    sql`delete from ${guestSession} where ${guestSession.userId} in (${seededGuests})`,
  );
  await db.execute(
    sql`delete from ${guestAccount} where ${guestAccount.userId} in (${seededGuests})`,
  );
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

  // One row, and the table's own `CHECK` is what keeps it to one — see
  // `schema/pricing.ts`. The seed states the figure rather than defaulting it,
  // because a tariff nobody chose is a tariff nobody can be held to.
  await db
    .insert(propertyTariff)
    .values({ extraPersonPerNightGross: EXTRA_PERSON_PER_NIGHT_GROSS });

  await db.insert(ratePlan).values(
    RATE_PLANS.map((plan) => ({
      code: plan.code,
      name: plan.name,
      percentAdjustment: plan.percentAdjustment,
      breakfastPerPersonGross: plan.breakfastPerPersonGross,
      displayOrder: plan.displayOrder,
    })),
  );

  // §6's catalog, seeded here beside the room types and the rate plans for the
  // reason those two are here: it is the property's reference data, not a
  // fixture, and the seed is where this repository states what the property
  // sells. Six of the eight go in without a price and stay that way — §6 leaves
  // them to the owner, and a row without a price is a row a posting must refuse
  // rather than a row a seed fills in.
  await db.insert(serviceCatalog).values(
    SERVICE_CATALOG.map((item) => ({
      code: item.code,
      name: item.name,
      unitPriceGross: item.unitPriceGross,
      taxClass: item.taxClass,
    })),
  );

  // The calendar as a lookup as well as rows. A booking freezes the price it
  // was sold at, and the only way that frozen figure can be trusted is for it to
  // come from the very numbers written to `rate_calendar` rather than from a
  // second pass that recomputes them and could differ.
  const grossByTypeAndDate = new Map<string, VndAmount>(
    ROOM_TYPES.flatMap((type) =>
      nights.map(
        (night) =>
          [
            `${type.code}|${night.toString()}`,
            nightlyGross(type.baseGrossPerNight, night),
          ] as const,
      ),
    ),
  );

  const rates = ROOM_TYPES.flatMap((type) =>
    nights.map((night) => ({
      roomTypeId: typeIds.get(type.code)!,
      stayDate: night.toString(),
      grossPerNight: grossByTypeAndDate.get(
        `${type.code}|${night.toString()}`,
      )!,
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

  await insertGuestsAndStays(db, stays, typeIds, grossByTypeAndDate);

  return {
    roomTypes: ROOM_TYPES.length,
    rooms: rooms.length,
    nightsOpened: nights.length,
    ratesWritten: rates.length,
    restrictions: restrictions.length,
    serviceItems: SERVICE_CATALOG.length,
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

  // A room and its condition are written together, because a room without one
  // is a room the check-in guard cannot answer for: `FR-HK-01` admits a guest
  // into `CLEAN` or `INSPECTED`, and a missing row is neither. The status is
  // left to default — a seeded property has had no stays yet, so every room is
  // clean, and stating `CLEAN` here would be repeating the column's own default
  // in a second place.
  await db
    .insert(roomCondition)
    .values(inserted.map(({ id }) => ({ roomId: id })));

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
      // The booking this stay is, written here so the hold and the booking row
      // share it. Never null: a null booking id means "this hold is a closure",
      // and a synthetic guest's stay is not a closure.
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
 * Writes the guests, their bookings and the holds those bookings placed.
 *
 * The guest rows go into Better Auth's own table because there is nowhere else
 * a person lives in this system, and a stay with no name behind it cannot
 * exercise a front-desk screen. They carry no credential: a seeded guest is
 * somebody the property has a record of, not somebody who can sign in, and
 * writing a password hash nobody chose would be a credential in a fixture.
 *
 * Order matters below and the foreign keys say why: the nights and the holds
 * both name a booking, so the bookings are written first.
 */
async function insertGuestsAndStays(
  db: Database,
  stays: readonly SyntheticStay[],
  typeIds: Map<string, string>,
  grossByTypeAndDate: Map<string, VndAmount>,
): Promise<void> {
  const guests = stays.map((stay) => ({
    id: randomUUID(),
    name: stay.guestName,
    email: stay.guestEmail,
    emailVerified: true,
  }));

  await insertInChunks(db, guestUser, guests);

  const standard = RATE_PLANS.find((plan) => plan.code === "STANDARD")!;

  await insertInChunks(
    db,
    booking,
    stays.map((stay, ordinal) => ({
      // The id `room_assignment` already carries. Stated rather than defaulted,
      // because the hold and the booking were drawn together and a second
      // generated id here would separate them.
      id: stay.bookingId,
      reference: seededReference(stay, ordinal),
      // Confirmed and not held: a hold has a TTL, and a fixture full of
      // bookings whose expiry has long passed is a calendar the first run of
      // the sweep would empty.
      state: "CONFIRMED" as const,
      roomTypeId: typeIds.get(stay.roomTypeCode)!,
      checkInDate: stay.checkIn,
      checkOutDate: stay.checkOut,
      ratePlanCode: standard.code,
      // Two, which is the included occupancy — so no head in a seeded party is
      // an extra one and the tariff below is frozen without being charged.
      adults: INCLUDED_OCCUPANCY,
      quotedStayTotalGross: quotedTotal(stay, grossByTypeAndDate, standard),
      quotedPercentAdjustment: standard.percentAdjustment,
      quotedBreakfastPerPersonGross: standard.breakfastPerPersonGross,
      quotedExtraPersonPerNightGross: EXTRA_PERSON_PER_NIGHT_GROSS,
    })),
  );

  await insertInChunks(
    db,
    bookingNight,
    stays.flatMap((stay) =>
      stay.nights.map((night) => ({
        bookingId: stay.bookingId,
        stayDate: night,
        standardGross: grossByTypeAndDate.get(`${stay.roomTypeCode}|${night}`)!,
      })),
    ),
  );

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
 * What the stay was sold for, by the arithmetic that sold it.
 *
 * The nights are summed before the plan's percentage is applied, and the
 * division happens once over the whole stay — `property-and-tariff.md` §5, and
 * the same order `availability.service.ts` applies it in. Dividing per night
 * would leave the seeded total a few đồng from the total the funnel quotes for
 * the identical stay, which is the drift the frozen columns exist to prevent
 * appearing in a fixture.
 */
function quotedTotal(
  stay: SyntheticStay,
  grossByTypeAndDate: Map<string, VndAmount>,
  plan: { readonly percentAdjustment: number },
): VndAmount {
  const nights = stay.nights.reduce(
    (total, night) =>
      total + grossByTypeAndDate.get(`${stay.roomTypeCode}|${night}`)!,
    0n,
  );

  return (nights * BigInt(100 + plan.percentAdjustment)) / 100n;
}

/**
 * The reference a seeded booking answers to.
 *
 * Deterministic from the arrival and the stay's ordinal, so a demo link keeps
 * working across a reseed. The generator the API uses at runtime is `M4`'s and
 * owns the format; this is a fixture writing something in its shape, not a
 * second implementation of it — nothing reads a reference back apart.
 */
function seededReference(stay: SyntheticStay, ordinal: number): string {
  return `MRV-${stay.checkIn.replaceAll("-", "")}-${String(ordinal).padStart(4, "0")}`;
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

/**
 * §3: a Friday or Saturday night prices as weekend.
 *
 * Read off the calendar date, never through an instant. `toDate(zone).getDay()`
 * builds the right moment and then resolves it in whatever zone the *process*
 * runs in — 17:00 the previous day once that is UTC, which is the runner and
 * the deployed host both. The uplift would land on Thursday and Friday there
 * and on Friday and Saturday on a developer's machine in Ho Chi Minh City, and
 * the rates written would differ by where the seed was run from.
 *
 * `en-US` for the locale because its week begins on Sunday, which makes 5 and 6
 * Friday and Saturday. It is a statement about the numbering below, not about
 * the property's language.
 */
function isWeekendNight(date: CalendarDate): boolean {
  const day = getDayOfWeek(date, "en-US");

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
