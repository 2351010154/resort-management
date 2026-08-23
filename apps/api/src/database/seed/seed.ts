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
import { eq, inArray, sql } from "drizzle-orm";
import { decomposeGross } from "../../modules/folio/tax-decomposition.js";
import { NightAuditService } from "../../modules/reporting/night-audit.service.js";
import {
  SystemConfigService,
  type TaxRules,
} from "../../modules/system-config/system-config.service.js";
import type { Database } from "../database.module.js";
import { booking, bookingNight } from "../schema/booking.js";
import { feedback } from "../schema/feedback.js";
import { folio, folioPosting } from "../schema/folio.js";
import { registration } from "../schema/guest.js";
import { guestAccount, guestSession, guestUser } from "../schema/index.js";
import { roomCondition } from "../schema/housekeeping.js";
import { loyaltyLedger } from "../schema/loyalty.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../schema/night-audit.js";
import { payment } from "../schema/payment.js";
import { paymentDiscrepancy } from "../schema/reconciliation.js";
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

// How many of the stays behind today took breakfast on their arrival night.
// Sparse for the reason the restrictions are sparse: a fixture where every stay
// bought the same thing says nothing about the difference between what a room
// earned and what everything else did, which is the split the revenue report is
// two columns for.
const BREAKFAST_SHARE_PERCENT = 35;

// The hour a departed stay settled its account, in the property's own zone. Any
// hour inside the day would do; what matters is that the instant is built in
// that zone rather than the machine's, because a folio closed at 00:00 UTC
// closes on the day before in Ho Chi Minh City.
const SETTLEMENT_HOUR = 11;

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
  /** The part of the seeded year that has already happened. */
  readonly history: SeededHistory;
}

/**
 * What the seed left behind today — the only part of it a report can read.
 *
 * `FR-RPT-02` and `FR-RPT-03` are both drawn from `night_audit_snapshot`, and
 * `schema/night-audit.ts` says why that is not a detail a fixture may go
 * around: reports read frozen days so that history cannot move. A seed that
 * wrote a year of stays and closed none of it therefore produces a property
 * whose report pages are empty however many bookings it holds, which is what
 * these figures exist to stop being the case.
 */
export interface SeededHistory {
  /** Accounts opened — one per stay that has already occupied a night. */
  readonly folios: number;
  /** Nights charged across all of them. */
  readonly nightsCharged: number;
  readonly serviceItemsSold: number;
  /** Trading days the night audit closed, which is what a report can see. */
  readonly closedDays: number;
  readonly lastClosedBusinessDate: string | null;
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
  //
  // The ledger those stays carry goes before them, and it goes by `truncate`
  // rather than by delete: `folio_posting` refuses a `DELETE` outright — the
  // append-only trigger raises on it for every client, this one included. That
  // is not a widening of what this wipe owns. A folio names a booking with no
  // cascade, every booking goes on the line below, and an account whose stay
  // does not exist is not a record anybody can read; deleting the stay *is*
  // emptying it. Left standing, one such row fails the delete of `booking` for
  // every seed that runs after it, from inside a wipe and a long way from
  // whatever wrote it.
  //
  // Every table that references the ledger is named rather than reached by a
  // `cascade`, for the reason at the top of this function: `payment` and
  // `loyalty_ledger` point at a folio, `payment_discrepancy` points at a
  // payment, and a `cascade` would take whatever is pointed at these next
  // without anybody deciding it should.
  //
  // `truncate` also needs rights over the tables rather than over their rows,
  // which is the property `schema/folio.ts` relies on: a deployment that does
  // not grant them to the role the API runs as gets a seed that fails loudly
  // instead of a ledger that is quietly gone.
  await db.execute(sql`delete from ${roomAssignment}`);
  await db.execute(sql`delete from ${registration}`);
  await db.execute(sql`delete from ${bookingNight}`);
  await db.execute(
    sql`truncate ${folioPosting}, ${folio}, ${payment}, ${loyaltyLedger}, ${paymentDiscrepancy}`,
  );
  // What a stay was asked about afterwards, for the reason the ledger goes: it
  // names a booking, the bookings go, and nothing else clears it.
  await db.execute(sql`delete from ${feedback}`);
  await db.execute(sql`delete from ${booking}`);
  await db.execute(sql`delete from ${typeInventory}`);
  await db.execute(sql`delete from ${stayRestriction}`);
  await db.execute(sql`delete from ${rateCalendar}`);
  // The closed trading days, before the room types their per-type rows name.
  // `truncate` and not `delete`, because `0043` refuses a row-level delete on
  // both of these outright: a snapshot is frozen so that a report re-read next
  // year says what it said. Emptying the table wholesale is a different act from
  // editing a day, it needs rights over the table rather than over its rows, and
  // it is the same property `schema/folio.ts` relies on for the ledger above.
  // Both together in one statement, because the type rows reference the day.
  await db.execute(
    sql`truncate ${nightAuditSnapshotType}, ${nightAuditSnapshot}`,
  );
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
  // The ids come back because a sold item names the catalog row it was sold
  // from — `folio_posting_names_a_service_item_exactly_when_it_is_one` — and
  // the history written below sells one of them.
  const serviceItems = await db
    .insert(serviceCatalog)
    .values(
      SERVICE_CATALOG.map((item) => ({
        code: item.code,
        name: item.name,
        unitPriceGross: item.unitPriceGross,
        taxClass: item.taxClass,
      })),
    )
    .returning({ id: serviceCatalog.id, code: serviceCatalog.code });

  const serviceItemIds = new Map(serviceItems.map((row) => [row.code, row.id]));

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

  const history = await writeHistory(
    db,
    stays,
    grossByTypeAndDate,
    nights,
    serviceItemIds,
  );

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
    history,
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
      // The day after the last night, computed rather than looked up. The
      // calendar is a list of nights, so a stay whose final night is the last
      // of them departs on a date that is deliberately not in it — reading the
      // departure out of the list left that stay with no check-out date at all.
      checkOut: nights[start + length - 1]!.add({ days: 1 }).toString(),
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
 * The ledger the stays behind today ran up, and the days the audit closed over
 * it — `FR-RPT-01`.
 *
 * The seed's other half writes a calendar and the stays standing against it,
 * which is a property with a future and no past. Everything the reports read is
 * in the past: `report-queries.service.ts` and `performance-queries.service.ts`
 * both begin at `night_audit_snapshot`, so a demo property with no closed day
 * shows two empty pages and a null business-date stamp no matter how many
 * bookings it holds.
 *
 * **The figures are posted and then frozen, never written straight into the
 * snapshot.** A fixture that invented plausible occupancy and revenue rows
 * would be a second implementation of the night audit — one that no test covers
 * and that cannot disagree with the ledger, because there would be no ledger
 * for it to disagree with. So this writes the folios and the postings a stay
 * genuinely produces and then hands each date to {@link NightAuditService},
 * which is the same object the cron runs. What a report shows is therefore what
 * the audit made of the seeded ledger, and a bug in either is visible in the
 * other.
 *
 * **A stay that has slept in a room is not `CONFIRMED`.** The states are moved
 * here rather than at placement because it is this function that decides which
 * stays are behind today: a stay whose last night has passed has departed, one
 * that arrived before today and has not yet departed is in house, and the rest
 * of the year is left confirmed and unbilled. Charging a confirmed booking
 * would be a folio the API itself would refuse to open.
 *
 * **A departed stay settles in full and its folio closes.** `FR-FOL-04` closes
 * an account at nothing outstanding, so a checked-out stay carrying a balance
 * is a state the desk could not have produced. The money arrives by bank
 * transfer for a reason that is in the schema rather than in taste:
 * `payment_shift_binding` puts cash inside an open shift, and a seed that paid
 * in cash would have to invent a shift for every departure to have a drawer to
 * put it in.
 *
 * Nothing is written at all when the calendar opens in the future, which is the
 * case every e2e fixture pins with `--from`. There is no past to charge, and a
 * suite asserting on a freshly seeded property sees exactly what it saw before.
 */
async function writeHistory(
  db: Database,
  stays: readonly SyntheticStay[],
  grossByTypeAndDate: Map<string, VndAmount>,
  nights: readonly CalendarDate[],
  serviceItemIds: Map<string, string>,
): Promise<SeededHistory> {
  // Today itself is deliberately not in here. A day is closed by the audit once
  // it has ended, and freezing the day the demo is being given on would report
  // a night that is still being slept.
  const now = today(PROPERTY_TIME_ZONE);
  const closed = nights.filter((night) => night.compare(now) < 0);

  if (closed.length === 0) {
    return {
      folios: 0,
      nightsCharged: 0,
      serviceItemsSold: 0,
      closedDays: 0,
      lastClosedBusinessDate: null,
    };
  }

  // Read per date and not once, because the relief window makes the VAT rate a
  // function of the business date — `system-config.service.ts`. A seed that
  // decomposed every night at today's rate would put a figure on a December
  // invoice that December's rate never produced.
  const configuration = new SystemConfigService();
  const rules = new Map<string, TaxRules>();

  for (const night of closed) {
    rules.set(night.toString(), await configuration.taxRules(db, night));
  }

  const standard = RATE_PLANS.find((plan) => plan.code === "STANDARD")!;
  // The one item in §6's catalog that carries a price. The other six are left
  // to the owner, and a seed that sold one would be inventing the figure the
  // catalog deliberately does not state.
  const breakfast = SERVICE_CATALOG.find((item) => item.code === "BREAKFAST")!;

  const folios: (typeof folio.$inferInsert)[] = [];
  const postings: (typeof folioPosting.$inferInsert)[] = [];
  const payments: (typeof payment.$inferInsert)[] = [];
  // Which accounts to close, and when — applied after the lines are on them.
  // `folio_posting_stops_at_a_closed_folio` refuses a posting to a closed
  // account, which is the rule the desk works under and not an obstacle to
  // work around: an account is closed because there is nothing more to put on
  // it. So the seed opens every folio, bills it, and closes it afterwards, in
  // the order a stay actually goes through.
  const closures: { readonly folioId: string; readonly closedAt: Date }[] = [];
  const departed: string[] = [];
  const inHouse: string[] = [];

  let nightsCharged = 0;
  let serviceItemsSold = 0;

  /** One sale as `FR-FOL-02`'s three lines, the shape `postSale` writes. */
  const sell = (
    folioId: string,
    businessDate: string,
    grossAmount: VndAmount,
    line: {
      readonly type: "ROOM_CHARGE" | "SERVICE_ITEM";
      readonly description: string;
      readonly serviceCatalogId?: string;
    },
  ): void => {
    const lines = decomposeGross(grossAmount, rules.get(businessDate)!);
    // Stated rather than defaulted, because the two derived lines name it.
    const chargeId = randomUUID();

    postings.push(
      {
        id: chargeId,
        folioId,
        type: line.type,
        amount: lines.netCharge,
        description: line.description,
        serviceCatalogId: line.serviceCatalogId ?? null,
        businessDate,
      },
      {
        folioId,
        type: "SERVICE_CHARGE_FEE",
        amount: lines.serviceCharge,
        description: `Service charge on ${line.description}`,
        parentPostingId: chargeId,
        businessDate,
      },
      {
        folioId,
        type: "VAT",
        amount: lines.vat,
        description: `VAT on ${line.description}`,
        parentPostingId: chargeId,
        businessDate,
      },
    );
  };

  for (const stay of stays) {
    // The nights are contiguous from the arrival, so the ones behind today are
    // a prefix of them and the index below is the night's own.
    const charged = stay.nights.filter(
      (night) => parseDate(night).compare(now) < 0,
    );

    if (charged.length === 0) {
      continue;
    }

    const folioId = randomUUID();
    const hasLeft = parseDate(stay.checkOut).compare(now) <= 0;

    let owed = 0n;

    for (const [index, night] of charged.entries()) {
      // The night's own share of the stay total, taken as the difference
      // between the stay through this night and the stay through the last —
      // which is how `room-charge-sweep.ts` prices a night, and for the reason
      // it gives: the plan's percentage applies to the stay rather than to the
      // night, so a per-night division would leave the folio a few đồng from
      // the total the booking was sold at.
      const gross =
        quotedTotal(
          { ...stay, nights: stay.nights.slice(0, index + 1) },
          grossByTypeAndDate,
          standard,
        ) -
        quotedTotal(
          { ...stay, nights: stay.nights.slice(0, index) },
          grossByTypeAndDate,
          standard,
        );

      owed += gross;
      sell(folioId, night, gross, {
        type: "ROOM_CHARGE",
        description: `Room charge, night of ${night}`,
      });
    }

    nightsCharged += charged.length;

    if (faker.number.int({ min: 1, max: 100 }) <= BREAKFAST_SHARE_PERCENT) {
      const gross = breakfast.unitPriceGross! * BigInt(INCLUDED_OCCUPANCY);

      owed += gross;
      serviceItemsSold += 1;
      sell(folioId, charged[0]!, gross, {
        type: "SERVICE_ITEM",
        description: `${INCLUDED_OCCUPANCY} × ${breakfast.name}`,
        serviceCatalogId: serviceItemIds.get(breakfast.code)!,
      });
    }

    folios.push({ id: folioId, bookingId: stay.bookingId });

    if (!hasLeft) {
      inHouse.push(stay.bookingId);

      continue;
    }

    const settledAt = new Date(
      parseDate(stay.checkOut).toDate(PROPERTY_TIME_ZONE).getTime() +
        SETTLEMENT_HOUR * 3_600_000,
    );

    payments.push({
      folioId,
      method: "BANK_TRANSFER",
      amount: owed,
      status: "SUCCESS",
      paidAt: settledAt,
    });

    // Negative on the ledger, which is the convention
    // `folio_posting_sign_matches_type` enforces: money in reduces what is
    // owed, so a settled account is a plain sum of zero.
    postings.push({
      folioId,
      type: "PAYMENT",
      amount: -owed,
      description: "Bank transfer",
      businessDate: stay.checkOut,
    });

    closures.push({ folioId, closedAt: settledAt });
    departed.push(stay.bookingId);
  }

  // Order is the foreign keys again: the accounts before the lines that name
  // them, and the payments last because they name an account too.
  await insertInChunks(db, folio, folios);
  await insertInChunks(db, folioPosting, postings);
  await insertInChunks(db, payment, payments);

  for (const closure of closures) {
    await db
      .update(folio)
      .set({ state: "CLOSED", closedAt: closure.closedAt })
      .where(eq(folio.id, closure.folioId));
  }

  await moveTo(db, departed, "CHECKED_OUT");
  await moveTo(db, inHouse, "CHECKED_IN");

  const audit = new NightAuditService();
  let closedDays = 0;

  for (const night of closed) {
    if (await audit.freeze(db, night)) {
      closedDays += 1;
    }
  }

  return {
    folios: folios.length,
    nightsCharged,
    serviceItemsSold,
    closedDays,
    lastClosedBusinessDate: closed.at(-1)!.toString(),
  };
}

/** Puts the named stays into one state, chunked for the parameter ceiling. */
async function moveTo(
  db: Database,
  bookingIds: readonly string[],
  state: "CHECKED_IN" | "CHECKED_OUT",
): Promise<void> {
  for (let start = 0; start < bookingIds.length; start += CHUNK_ROWS) {
    const chunk = bookingIds.slice(start, start + CHUNK_ROWS);

    if (chunk.length > 0) {
      await db.update(booking).set({ state }).where(inArray(booking.id, chunk));
    }
  }
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
