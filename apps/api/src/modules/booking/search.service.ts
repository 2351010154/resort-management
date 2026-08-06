// What the front desk searches for — `FR-BOOK-05`, in the three kinds of thing
// the property has.
//
// **Two methods and not one with a scope argument.** `searchRooms` answers the
// narrowed grant and `search` answers the full one, which is `guest.service.ts`'s
// split between the masked read and the audited reveal applied to a whole
// result: a rooms-only answer has no field a booking could travel in, so a
// caller holding the narrowed grant cannot be handed one by a handler that
// forgot to empty an array. A single method taking `{ roomsOnly: true }` would
// put the authorisation boundary inside an argument, and the first caller to
// pass it by habit would be reading stays under housekeeping's authority.
//
// **A dimension answers only the set it is a fact about, and a set nothing was
// asked about is not answered.** A room's readiness says nothing about a stay,
// and a booking reference says nothing about a room — so each set below is
// filtered by its own dimensions, and returns nothing at all when none of them
// were given. The alternative is a search for `roomStatus=DIRTY` answering with
// every booking the property has ever taken, which is an export behind a text
// field.
//
// **The rooms are the housekeeping board's tiles, narrowed.** `getBoard` already
// answers what a room is: its type, its readiness, whether somebody is in it,
// who last touched it. Re-querying those columns here would be a second
// description of a room that drifts from the first the day `isReady` changes
// meaning — and the property has forty rooms, so narrowing the board in memory
// costs one query and reads as what it is. The one thing the board cannot answer
// is which rooms were held across a range of dates, and that is the only room
// query this file owns.
//
// **The CCCD is neither returned nor searchable.** The number is masked by
// `cccd-mask.ts` on the way out — the same function the record route uses, so
// there is one masking rule rather than one per caller — and no filter reaches
// the column. A search over it would confirm a number from outside the audit
// trail one guess at a time, which is the disclosure `FR-GST-03`'s masking
// exists to stop.

import {
  type BookingState,
  type HousekeepingStatus,
  type RoomTypeCode,
  SEARCH_RESULT_LIMIT,
  type StayDate,
} from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { guest, registration } from "../../database/schema/guest.js";
import {
  room,
  roomAssignment,
  roomType,
} from "../../database/schema/inventory.js";
import { maskCccd } from "../guest/cccd-mask.js";
import {
  type BoardRoom,
  HousekeepingService,
} from "../housekeeping/housekeeping.service.js";

/** A window of dates, half-open like every other range in the system. */
export interface SearchRange {
  readonly from: StayDate;
  readonly to: StayDate;
}

/** The dimensions `FR-BOOK-05` lists, as the service takes them. */
export interface SearchFilters {
  readonly roomNumber?: string;
  readonly roomType?: RoomTypeCode;
  readonly roomStatus?: HousekeepingStatus;
  readonly range?: SearchRange;
  readonly guestName?: string;
  readonly guestPhone?: string;
  readonly state?: BookingState;
  readonly reference?: string;
}

/** One stay a search found. Carries no amount — see this file's header. */
export interface BookingHit {
  readonly id: string;
  readonly reference: string;
  readonly state: BookingState;
  readonly roomType: RoomTypeCode;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomNumber: string | null;
  readonly guestNames: readonly string[];
}

/** One person a search found, with the number masked and never the number. */
export interface GuestHit {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly cccdMasked: string | null;
}

/** Everything the unnarrowed grant may see. */
export interface SearchResults {
  readonly rooms: readonly BoardRoom[];
  readonly bookings: readonly BookingHit[];
  readonly guests: readonly GuestHit[];
}

@Injectable()
export class SearchService {
  constructor(private readonly housekeeping: HousekeepingService) {}

  /**
   * The rooms alone — what the matrix's `⚠` on this row narrows to.
   *
   * The business date is a parameter for `getBoard`'s reason: the property's
   * own day is resolved once by the caller, and a board rendered against two
   * answers to "what day is it" shows a departure as still in house on one
   * screen and gone on another.
   *
   * The tiles are always answered for that day even when a range was given.
   * A room's condition has no history — `room_condition` holds one row per room
   * and the board reads the state it is in now — so the range cannot narrow
   * what a tile says. What it narrows is which rooms appear: the ones a guest's
   * stay covered inside the window.
   */
  async searchRooms(
    exec: DbExecutor,
    filters: SearchFilters,
    businessDate: StayDate,
  ): Promise<readonly BoardRoom[]> {
    if (!asksAboutRooms(filters)) {
      return [];
    }

    const board = await this.housekeeping.getBoard(exec, businessDate);
    const held =
      filters.range === undefined
        ? null
        : await this.roomsOccupiedWithin(exec, filters.range);

    return board
      .filter(
        (tile) =>
          fragmentMatches(tile.roomNumber, filters.roomNumber) &&
          (filters.roomType === undefined ||
            tile.roomType === filters.roomType) &&
          (filters.roomStatus === undefined ||
            tile.status === filters.roomStatus) &&
          (held === null || held.has(tile.roomNumber)),
      )
      .slice(0, SEARCH_RESULT_LIMIT);
  }

  /** Rooms, stays and people — what an unnarrowed grant may see. */
  async search(
    exec: DbExecutor,
    filters: SearchFilters,
    businessDate: StayDate,
  ): Promise<SearchResults> {
    return {
      rooms: await this.searchRooms(exec, filters, businessDate),
      bookings: await this.searchBookings(exec, filters),
      guests: await this.searchGuests(exec, filters),
    };
  }

  /**
   * The rooms a guest's stay covered inside the window.
   *
   * `booking_id is not null` because a closure is not occupancy — the board
   * draws that line in the same words, and a room out for a leaking pipe is
   * held without anybody being in it. Overlap is half-open on both sides, so a
   * stay departing on the first day of the window does not put its room in the
   * answer.
   */
  private async roomsOccupiedWithin(
    exec: DbExecutor,
    range: SearchRange,
  ): Promise<ReadonlySet<string>> {
    const rows = await exec
      .selectDistinct({ number: room.number })
      .from(roomAssignment)
      .innerJoin(room, eq(room.id, roomAssignment.roomId))
      .where(
        and(
          isNotNull(roomAssignment.bookingId),
          overlaps(roomAssignment.checkInDate, roomAssignment.checkOutDate, range),
        ),
      );

    return new Set(rows.map((row) => row.number));
  }

  /**
   * The stays matching what was asked, with the room each holds and the people
   * registered on it.
   *
   * Three queries rather than one join, because the last two are one-to-many: a
   * booking moved once holds two assignment rows and a family of four holds
   * four registrations, and a single join would return the same stay eight
   * times for the caller to collapse. The two follow-ups are keyed off the ids
   * the first found, so they read exactly the rows that are going to be shown.
   */
  private async searchBookings(
    exec: DbExecutor,
    filters: SearchFilters,
  ): Promise<readonly BookingHit[]> {
    const conditions = bookingConditions(filters);

    if (conditions.length === 0) {
      return [];
    }

    const found = await exec
      .select({
        id: booking.id,
        reference: booking.reference,
        state: booking.state,
        roomType: roomType.code,
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
      })
      .from(booking)
      .innerJoin(roomType, eq(roomType.id, booking.roomTypeId))
      .where(and(...conditions))
      // Arrival first, and the reference to break a tie, because a day of
      // arrivals arriving in the order Postgres found them is a list nobody can
      // read down. Deterministic order also makes the cap above take the same
      // fifty rows on every call rather than an arbitrary fifty.
      .orderBy(asc(booking.checkInDate), asc(booking.reference))
      .limit(SEARCH_RESULT_LIMIT);

    if (found.length === 0) {
      return [];
    }

    const ids = found.map((row) => row.id);
    const rooms = await this.roomsHeldBy(exec, ids);
    const names = await this.guestsRegisteredOn(exec, ids);

    return found.map((row) => ({
      ...row,
      roomNumber: rooms.get(row.id) ?? null,
      guestNames: names.get(row.id) ?? [],
    }));
  }

  /**
   * The room each of those bookings holds now.
   *
   * A stay that moved rooms holds an assignment per room it slept in — the
   * table appends rather than replaces, because the guest really was in 304 on
   * Tuesday. The one the desk wants is the current one, so the rows arrive in
   * assignment order and the last write for a booking wins.
   */
  private async roomsHeldBy(
    exec: DbExecutor,
    bookingIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const rows = await exec
      .select({
        bookingId: roomAssignment.bookingId,
        number: room.number,
      })
      .from(roomAssignment)
      .innerJoin(room, eq(room.id, roomAssignment.roomId))
      .where(inArray(roomAssignment.bookingId, [...bookingIds]))
      .orderBy(asc(roomAssignment.checkInDate));

    const held = new Map<string, string>();

    for (const row of rows) {
      if (row.bookingId !== null) {
        held.set(row.bookingId, row.number);
      }
    }

    return held;
  }

  /**
   * The people registered on those bookings, the holder first.
   *
   * Empty for a stay nobody has checked into yet, which is the ordinary case
   * for a booking taken this morning: `registration` rows are written by the
   * transition that reaches `CHECKED_IN` and never before it.
   */
  private async guestsRegisteredOn(
    exec: DbExecutor,
    bookingIds: readonly string[],
  ): Promise<ReadonlyMap<string, string[]>> {
    const rows = await exec
      .select({
        bookingId: registration.bookingId,
        fullName: guest.fullName,
      })
      .from(registration)
      .innerJoin(guest, eq(guest.id, registration.guestId))
      .where(inArray(registration.bookingId, [...bookingIds]))
      .orderBy(desc(registration.isPrimary), asc(registration.registeredAt));

    const names = new Map<string, string[]>();

    for (const row of rows) {
      const party = names.get(row.bookingId);

      if (party === undefined) {
        names.set(row.bookingId, [row.fullName]);
      } else {
        party.push(row.fullName);
      }
    }

    return names;
  }

  /**
   * The people matching a name or a phone number.
   *
   * Only those two dimensions reach this set. A person is not a stay: the date
   * range, the booking state and the room filters describe a booking, and the
   * guests those find are already named on the booking hits. Answering them
   * here as well would return the same people twice under a different heading.
   *
   * Both filters together are an `and`. Two criteria narrow — a desk that has a
   * name and a number is looking for the person who matches both, and an `or`
   * would answer with every Nguyễn in the property.
   */
  private async searchGuests(
    exec: DbExecutor,
    filters: SearchFilters,
  ): Promise<readonly GuestHit[]> {
    const conditions: SQL[] = [];

    if (filters.guestName !== undefined) {
      conditions.push(ilike(guest.fullName, fragment(filters.guestName)));
    }

    if (filters.guestPhone !== undefined) {
      // A null phone yields null here rather than false, and Postgres drops the
      // row either way — a guest with no number on file is not a match for one.
      conditions.push(ilike(guest.phone, fragment(filters.guestPhone)));
    }

    if (conditions.length === 0) {
      return [];
    }

    const rows = await exec
      .select({
        id: guest.id,
        fullName: guest.fullName,
        phone: guest.phone,
        cccdNumber: guest.cccdNumber,
      })
      .from(guest)
      .where(and(...conditions))
      .orderBy(asc(guest.fullName))
      .limit(SEARCH_RESULT_LIMIT);

    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      // The one place the column is read, and it is read to be masked. Nothing
      // downstream is handed the number.
      cccdMasked: maskCccd(row.cccdNumber),
    }));
  }
}

/** Whether anything asked about was a fact about a room. */
function asksAboutRooms(filters: SearchFilters): boolean {
  return (
    filters.roomNumber !== undefined ||
    filters.roomType !== undefined ||
    filters.roomStatus !== undefined ||
    filters.range !== undefined
  );
}

/**
 * The stay-shaped conditions, one per dimension that was given.
 *
 * `roomStatus` is absent on purpose and is the only dimension that is. Whether
 * a room has been cleaned is a fact about the room this morning, not about the
 * stay that is booked into it in November — a booking filtered by it would be
 * answering a question nobody asked.
 */
function bookingConditions(filters: SearchFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.reference !== undefined) {
    conditions.push(ilike(booking.reference, fragment(filters.reference)));
  }

  if (filters.state !== undefined) {
    conditions.push(eq(booking.state, filters.state));
  }

  if (filters.roomType !== undefined) {
    conditions.push(eq(roomType.code, filters.roomType));
  }

  if (filters.range !== undefined) {
    conditions.push(
      overlaps(booking.checkInDate, booking.checkOutDate, filters.range),
    );
  }

  if (filters.roomNumber !== undefined) {
    // A correlated `exists` rather than a join, for the reason the board gives
    // one: a booking that moved rooms holds several assignments, and a join
    // would return that stay once per room it slept in. The tables are
    // interpolated as schema objects so a renamed column is a build error here
    // rather than a subquery that typechecks and fails at the desk.
    conditions.push(sql`exists (
      select 1
        from ${roomAssignment}
        join ${room} on ${room.id} = ${roomAssignment.roomId}
       where ${roomAssignment.bookingId} = ${booking.id}
         and ${room.number} ilike ${fragment(filters.roomNumber)}
    )`);
  }

  if (filters.guestName !== undefined) {
    conditions.push(registeredGuestMatches(guest.fullName, filters.guestName));
  }

  if (filters.guestPhone !== undefined) {
    conditions.push(registeredGuestMatches(guest.phone, filters.guestPhone));
  }

  return conditions;
}

/** A stay on this booking belongs to somebody whose column matches. */
function registeredGuestMatches(
  column: typeof guest.fullName | typeof guest.phone,
  value: string,
): SQL {
  return sql`exists (
    select 1
      from ${registration}
      join ${guest} on ${guest.id} = ${registration.guestId}
     where ${registration.bookingId} = ${booking.id}
       and ${column} ilike ${fragment(value)}
  )`;
}

/**
 * Half-open overlap between a stored range and the window asked about.
 *
 * `[start, end)` on both sides, which is the convention every range in the
 * system keeps: a stay departing on the morning the window opens does not
 * overlap it, and neither does one arriving on the day it closes.
 */
function overlaps(
  start: AnyPgColumn,
  end: AnyPgColumn,
  range: SearchRange,
): SQL {
  return sql`${start} < ${range.to.toString()} and ${end} > ${range.from.toString()}`;
}

/**
 * A caller's text as a `like` pattern matching anywhere in the column.
 *
 * A fragment and not an exact value, because that is how the desk searches: the
 * last four digits of a phone number read off a booking slip, the first few
 * letters of a name spelled over the telephone, `20` for the second floor.
 *
 * The wildcards a caller could type are escaped rather than honoured. A search
 * for `%` is a search for a per-cent sign — a guest whose name contains one is
 * findable and a caller cannot turn a filter into "every row" by typing one
 * character.
 */
function fragment(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** The same fragment rule, applied in memory to a board tile. */
function fragmentMatches(value: string, wanted: string | undefined): boolean {
  return (
    wanted === undefined || value.toLowerCase().includes(wanted.toLowerCase())
  );
}
