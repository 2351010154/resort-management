// The property itself: what the five types are, and which forty rooms exist.
// Owned by `modules/inventory`.
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

import { ROOM_TYPE_CODES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
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

export type RoomTypeRow = typeof roomType.$inferSelect;
export type RoomRow = typeof room.$inferSelect;
