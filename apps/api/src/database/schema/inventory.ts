// The property itself — what the five types are and which forty rooms exist —
// and the two layers of inventory that are sold against them. Owned by
// `modules/inventory`.
//
// Authority for every value these tables hold:
// docs/architecture/property-and-tariff.md §1. That file is provisional in whole
// — sizes, bedding and aspects are the developer's call "until the database
// holds them", and this is the database holding them. What the schema fixes is
// the shape rather than the values: five types, forty rooms, and a room that
// belongs to exactly one type.
//
// Three things §1 describes are deliberately *not* columns here:
//
// - **Included occupancy.** Two, for every type, so it is one constant in
//   `@mariva/shared` rather than five rows repeating themselves. §1 states it
//   once on purpose — a per-type value would imply the property varies what the
//   rate covers, when it does not.
// - **Amenities.** §1's twelve lines are identical across all five types and are
//   "one list here and not a column on the table above". A type that ever
//   differs takes an override at that point and not before; five copies of the
//   same twelve lines is five places to forget.
// - **Photographs.** The funnel's galleries are hand-written in
//   `apps/web/features/booking/lib/room-images.ts`, alt text included, because
//   the description of a photograph is writing and not data. A column here would
//   be a second place for the same twenty-seven frames to disagree from.
//
// The two inventory tables at the foot of this file answer different questions
// and neither subsumes the other. `type_inventory` answers "is there a Deluxe
// left on the fourteenth", which is what a search across a twelve-month
// calendar asks for every type and every date, and which one row and one
// `CHECK` can settle. `room_assignment` answers "is room 304 free from the
// twelfth to the fifteenth", which is a question about overlapping ranges and
// takes an exclusion constraint to settle. A booking writes both in one
// transaction: the counter is what refuses the forty-first sale of forty rooms,
// and the assignment is what refuses handing two guests the same key.
//
// Both invariants live in Postgres rather than in a service, because a check
// performed by application code is a check two concurrent requests can both
// pass before either writes. That is the difference between a system that is
// usually right and one where the wrong state cannot be stored.

import { ROOM_TYPE_CODES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The five room types as a database type.
 *
 * Built from the same tuple the wire schema is built from, so Postgres, the API
 * and the funnel cannot come to disagree about what a type is called. A sixth
 * code is rejected at the write rather than at render, where an unknown type
 * reads as an empty card and gets diagnosed as a broken component.
 */
export const roomTypeCodeEnum = pgEnum("room_type_code", ROOM_TYPE_CODES);

export const roomType = pgTable(
  "room_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: roomTypeCodeEnum("code").notNull().unique(),
    name: text("name").notNull(),
    // The hard ceiling. A party above it is a rejection, not a price — §3.
    maxOccupancy: smallint("max_occupancy").notNull(),
    // What the standard bedding sleeps. Below `maxOccupancy` only where an extra
    // bed is what closes the gap, which is the difference between an extra bed a
    // guest needs and one they are merely offered.
    beddingSleeps: smallint("bedding_sleeps").notNull(),
    // No default. A type that does not say whether it takes an extra bed should
    // fail the insert, not quietly become a type that does not.
    takesExtraBed: boolean("takes_extra_bed").notNull(),
    squareMetres: smallint("square_metres").notNull(),
    bedding: text("bedding").notNull(),
    aspect: text("aspect").notNull(),
    // The two sentences the property says about the type. Not nullable:
    // design-foundations.md §6 forbids a component inventing a hotel fact, so a
    // type with nothing to say leaves the room card with nothing to print.
    description: text("description").notNull(),
    // The order the five render in — ascending by maximum occupancy, then price.
    // A column rather than a sort, because price lives in `rate_calendar` and
    // varies by date: there is no stable ordering to derive. Unique, because two
    // types sharing a position makes the list order arbitrary, and a stable order
    // is what lets the eye compare one fact down a column.
    displayOrder: smallint("display_order").notNull().unique(),
  },
  (table) => [
    check(
      "room_type_max_occupancy_at_least_bedding",
      sql`${table.maxOccupancy} >= ${table.beddingSleeps}`,
    ),
    // §1: "Beds sleep is not max occupancy" — a type may sleep fewer than it
    // takes, but only when an extra bed is what makes up the difference. Without
    // this a type could claim to hold four in bedding for two and no bed to add.
    check(
      "room_type_extra_bed_closes_the_gap",
      sql`${table.takesExtraBed} OR ${table.maxOccupancy} = ${table.beddingSleeps}`,
    ),
  ],
);

/**
 * The forty physical rooms — §1: floors 2–5, ten a floor, numbered
 * `<floor><nn>`.
 *
 * The type reference has no `onDelete`, so Postgres restricts: a type with rooms
 * cannot be deleted. Cascading would take the rooms with it, and a room is what
 * every future assignment, folio and housekeeping row points at.
 */
export const room = pgTable(
  "room",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Text rather than a number: `201` is a label the property assigns, and the
    // day one of them becomes `4A` a smallint column is a migration.
    number: text("number").notNull().unique(),
    floor: smallint("floor").notNull(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
  },
  (table) => [index("room_room_type_id_idx").on(table.roomTypeId)],
);

/**
 * Layer one: how many of a type the property may sell on one date, and how many
 * it already has.
 *
 * A stored counter rather than a count derived from bookings at read time. A
 * derived count is read before it is written, so two requests racing for the
 * last Deluxe can both see one free — and the availability query would have to
 * scan every booking touching the range on every search, which is the shape
 * that misses a three-hundred-millisecond budget across twelve months.
 *
 * `total_rooms` starts at the type's room count and moves only when the
 * property withdraws a room from sale. Housekeeping marking a room dirty is not
 * that: it changes who may enter the room today, not how many rooms exist to
 * sell, and the two have been conflated in enough systems to be worth saying.
 */
export const typeInventory = pgTable(
  "type_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
    // A date and never a timestamp — §1's timezone row, and the reason
    // `@mariva/shared`'s stay date is a `CalendarDate`. `mode: "string"` keeps
    // the ISO text Postgres stores instead of handing back a `Date` at UTC
    // midnight, which in UTC+7 is the previous night and reads as an off-by-one
    // nobody can see in the data.
    stayDate: date("stay_date", { mode: "string" }).notNull(),
    totalRooms: smallint("total_rooms").notNull(),
    // Defaulted, because a date the property has opened for sale and nobody has
    // booked yet is a real row, and writing the zero by hand is one more place
    // to write something else.
    soldRooms: smallint("sold_rooms").notNull().default(0),
  },
  (table) => [
    // One row per type per date. Two rows for the same pair would each hold
    // half the truth and the ceiling below would be enforced twice against two
    // partial counts, which is oversell arriving through the constraint meant
    // to stop it.
    uniqueIndex("type_inventory_room_type_date_key").on(
      table.roomTypeId,
      table.stayDate,
    ),
    // The availability query asks for a range of dates across every type at
    // once, so the date is the selective column and the one the scan starts
    // from. The unique index above leads with the type and cannot serve it.
    index("type_inventory_stay_date_idx").on(table.stayDate),
    // The line this milestone rests on. Oversell is not something the booking
    // service is asked to remember to check; it is a row Postgres refuses to
    // store, whatever forgot to check. Equality is deliberately legal: a type
    // sold out for the night is full, which is a normal state and not an error.
    check(
      "type_inventory_sold_at_most_total",
      sql`${table.soldRooms} <= ${table.totalRooms}`,
    ),
    // The ceiling above is satisfied by any pair of negative numbers, so on its
    // own it would let a cancellation that decrements one time too many leave
    // the row reading as availability rather than as the bug it is.
    check("type_inventory_sold_not_negative", sql`${table.soldRooms} >= 0`),
    check("type_inventory_total_not_negative", sql`${table.totalRooms} >= 0`),
  ],
);

/**
 * Layer two: one physical room, held for one half-open range of dates.
 *
 * The constraint that makes a second guest in room 304 unrepresentable is not
 * in this file, because Drizzle has no expression for it:
 *
 *   EXCLUDE USING gist (
 *     room_id WITH =,
 *     daterange(check_in_date, check_out_date, '[)') WITH &&
 *   )
 *
 * It is written by hand into the migration that creates this table, over the
 * btree_gist extension the first migration enables. Postgres evaluates it while
 * holding the index entry, so two transactions inserting overlapping holds on
 * one room cannot both commit — one of them gets an exclusion violation no
 * matter how the application was written.
 *
 * `[)` is the load-bearing pair of characters. The departure date is not a
 * night sold, so a stay ending on the fifth and a stay beginning on the fifth
 * share a boundary rather than a night, and back-to-back arrivals are the
 * ordinary case a hotel runs on rather than a conflict every caller has to
 * special-case. `@mariva/shared`'s stay range states the same convention for
 * the wire, and the two must not drift.
 *
 * The room reference has no `onDelete`, so Postgres restricts: a room with a
 * stay against it cannot be deleted out from under the folio and the audit
 * trail that point at it.
 */
export const roomAssignment = pgTable(
  "room_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    // Null means the row is not a booking. A room withdrawn from sale is held
    // through this same table, because a room held for a guest and a room held
    // for a leaking pipe are the same fact to the exclusion constraint: neither
    // can be given to anybody else.
    //
    // No foreign key, because there is no booking table to point at yet, and a
    // reference to a table nobody has written is a migration that cannot apply.
    // The key is added when there is something for it to reference.
    bookingId: uuid("booking_id"),
    checkInDate: date("check_in_date", { mode: "string" }).notNull(),
    checkOutDate: date("check_out_date", { mode: "string" }).notNull(),
    // Why the room is out, in the words of whoever took it out. Null for a
    // booking, which explains itself through the booking it names.
    closureReason: text("closure_reason"),
  },
  (table) => [
    // What the front desk asks: everything held against this room. The
    // exclusion constraint's own GiST index also leads with the room, but a
    // plain equality lookup is what a btree is for.
    index("room_assignment_room_id_idx").on(table.roomId),
    // A stay of no nights is the one row the exclusion constraint cannot
    // refuse: `daterange('2026-08-05', '2026-08-05', '[)')` is empty, and an
    // empty range overlaps nothing at all. Such a row would sit in the table
    // holding no night and colliding with nothing, which is the single way past
    // the guarantee this table exists to give — so it is refused here instead.
    check(
      "room_assignment_covers_at_least_one_night",
      sql`${table.checkOutDate} > ${table.checkInDate}`,
    ),
  ],
);

export type RoomTypeRow = typeof roomType.$inferSelect;
export type RoomRow = typeof room.$inferSelect;
export type TypeInventoryRow = typeof typeInventory.$inferSelect;
export type RoomAssignmentRow = typeof roomAssignment.$inferSelect;
