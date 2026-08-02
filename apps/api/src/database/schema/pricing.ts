// What a night costs and whether it may be sold — the data the availability
// query prices against. Owned by `modules/pricing`.
//
// Authority is `docs/architecture/property-and-tariff.md` §3.
//
// The shape §3 argues for is a calendar and not a formula. A season is a *name*
// over a set of dates, never a hardcoded range: "Peak" is what the property
// calls the fortnight it charged more for, and moving that fortnight is a data
// edit rather than a deploy. So `rate_calendar` holds one row per type per
// date, and nothing in the tree knows when Peak begins. The same argument
// covers weekends — §3 prices a Friday or Saturday arrival as weekend, and the
// seed writes that into the rows rather than the query deriving it, because a
// query that knows which days are weekends is a query that cannot be overridden
// for a public holiday.
//
// The three plans are rows rather than a `switch`. §3 states two of them as
// arithmetic on the third — `NONREF` is `STANDARD` − 10%, `BB` is `STANDARD`
// plus breakfast — and the RBAC matrix gives `MANAGER` the rate-plan row, so
// the ten and the breakfast price are values a manager changes. Written as
// literals in a service they would be values a deploy changes, which is not
// what the matrix says.
//
// What is deliberately NOT here, because M3 does not price it:
//
// - **Promotions** (`FR-PRC-03`). A rate modifier stacking on top of a plan.
// - **The extra-person ladder** (`FR-PRC-04`). §9 records that the owner has
//   not decided when an extra bed is mandatory or whether its charge stacks
//   with the extra-person one, and states that no pricing path may infer the
//   rule from bed capacity. A column here would be that inference.
// - **Season names.** They label rows in this table; until something renders a
//   label there is nothing for the column to be read by.

import { RATE_PLAN_CODES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { roomType } from "./inventory.js";

/**
 * The three plans as a database type, from the same tuple the wire schema is
 * built from — the pattern `room_type_code` sets, for the same reason.
 */
export const ratePlanCodeEnum = pgEnum("rate_plan_code", RATE_PLAN_CODES);

/**
 * A plan, and how its price is derived from the calendar.
 *
 * Two columns carry §3's whole table. `percentAdjustment` is signed points off
 * the calendar price — `0` for `STANDARD`, `-10` for `NONREF`. `breakfastPerPersonGross`
 * is set only on `BB`, and it is per person per night because §3 says breakfast
 * is "for the booked occupancy": a plan that charged it per booking would quote
 * a family the same as a single traveller.
 *
 * The breakfast figure is stored as its own amount and never folded into the
 * room rate. §3 is explicit about why: `BB`'s breakfast posts as its own folio
 * line, and a rate with breakfast baked in makes the revenue split
 * unrecoverable at reporting time, which is `M9`'s ADR silently wrong.
 */
export const ratePlan = pgTable(
  "rate_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: ratePlanCodeEnum("code").notNull().unique(),
    name: text("name").notNull(),
    // Signed, and in whole percent because §3 quotes it in whole percent. A
    // plan that ever needs a fraction takes a wider column at that point.
    percentAdjustment: smallint("percent_adjustment").notNull().default(0),
    // Null on a plan that includes no breakfast — which is the difference
    // between `BB` and the other two, expressed where it can be edited.
    breakfastPerPersonGross: bigint("breakfast_per_person_gross", {
      mode: "bigint",
    }),
    displayOrder: smallint("display_order").notNull().unique(),
  },
  (table) => [
    // A discount below −100% is a plan that pays the guest to stay, and an
    // uplift beyond +100% is a typo in a percent field. Neither is a price.
    check(
      "rate_plan_adjustment_within_bounds",
      sql`${table.percentAdjustment} between -100 and 100`,
    ),
    // Zero breakfast is not "breakfast included at no charge" — it is a plan
    // whose breakfast line would post as nothing, which is the folio saying
    // something happened that did not.
    check(
      "rate_plan_breakfast_positive_when_set",
      sql`${table.breakfastPerPersonGross} is null or ${table.breakfastPerPersonGross} > 0`,
    ),
  ],
);

/**
 * One type, one date, one price — the `STANDARD` gross the other two plans are
 * derived from.
 *
 * Gross per `property-and-tariff.md` §5: the number a guest is shown is the
 * number a guest pays, VAT and service charge inside it. The folio takes that
 * apart into posting lines at `M6`; the calendar never does, because a
 * guest-facing price that has to be assembled from three columns is a price
 * three call sites can assemble differently.
 *
 * `bigint` whole đồng, and never a numeric or a float. §5 again: rounding
 * inside a calculation makes the ledger fail to balance by a few đồng a night,
 * which is unprovable rather than merely wrong.
 */
export const rateCalendar = pgTable(
  "rate_calendar",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
    // A date, never a timestamp — the same argument `type_inventory` makes.
    stayDate: date("stay_date", { mode: "string" }).notNull(),
    grossPerNight: bigint("gross_per_night", { mode: "bigint" }).notNull(),
  },
  (table) => [
    // One price per type per night. Two rows would make "the price" a question
    // about which row the query happened to read first.
    uniqueIndex("rate_calendar_room_type_date_key").on(
      table.roomTypeId,
      table.stayDate,
    ),
    // The availability query joins this to `type_inventory` on the date across
    // every type at once, so the date leads the index the scan starts from —
    // the unique index above leads with the type and cannot serve it.
    index("rate_calendar_stay_date_idx").on(table.stayDate),
    // A free night is not a price, it is a comp, and a comp is a folio
    // adjustment. Zero here would quote it as a rate.
    check("rate_calendar_gross_positive", sql`${table.grossPerNight} > 0`),
  ],
);

/**
 * Whether a stay may begin, end or run across a night — `FR-PRC-02`.
 *
 * These reject at QUERY time and not at booking time, which is the requirement
 * and not an optimisation. A guest who is told at the payment step that the
 * night they chose has a two-night minimum has been made to do the work twice;
 * a calendar that greys the cell has taught them the rule.
 *
 * A row is the exception, not the rule. A type-date with no row here is
 * unrestricted, so the table holds the nights the property actually constrained
 * rather than one row per type per date repeating "no rule" — which is 73,000
 * rows a year saying nothing.
 */
export const stayRestriction = pgTable(
  "stay_restriction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
    stayDate: date("stay_date", { mode: "string" }).notNull(),
    // Nights a stay *beginning* on this date must run for. 1 is no rule, which
    // is also the default, so a row written for a closed-to-arrival flag alone
    // does not accidentally impose a minimum.
    minimumStay: smallint("minimum_stay").notNull().default(1),
    // Null is no ceiling. Zero would be a night nobody may stay, which is what
    // the flags below are for.
    maximumStay: smallint("maximum_stay"),
    // A stay may run through this night but not begin on it.
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    // A stay may run through this night but not end on it.
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
  },
  (table) => [
    uniqueIndex("stay_restriction_room_type_date_key").on(
      table.roomTypeId,
      table.stayDate,
    ),
    // The availability query reads the arrival night and the departure night
    // across every type, so the date leads here too.
    index("stay_restriction_stay_date_idx").on(table.stayDate),
    check(
      "stay_restriction_minimum_at_least_one_night",
      sql`${table.minimumStay} >= 1`,
    ),
    // A maximum below the minimum is a night no stay can satisfy in either
    // direction — a rule that rejects everything reads in the calendar as a
    // sold-out night nobody can explain.
    check(
      "stay_restriction_maximum_at_least_minimum",
      sql`${table.maximumStay} is null or ${table.maximumStay} >= ${table.minimumStay}`,
    ),
  ],
);

export type RatePlanRow = typeof ratePlan.$inferSelect;
export type RateCalendarRow = typeof rateCalendar.$inferSelect;
export type StayRestrictionRow = typeof stayRestriction.$inferSelect;
