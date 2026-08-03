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
// Promotions (`FR-PRC-03`) are a rate modifier stacking on top of a plan, and
// they are declared at the foot of this file. They are property-wide: no column
// narrows one to a plan or a type, because nothing in the requirements asks for
// a narrower one and §7's loyalty discount — the only consumer any document
// names — applies to whatever the guest booked. Scoping is a migration on the
// day a campaign needs it, and a nullable column nothing reads is worse than
// its absence, because a reader cannot tell an unset scope from an unbuilt one.
//
// The extra-person rate (`FR-PRC-04`) is at the foot of this file, and what it
// is *not* is the point. §3's age bands are decided, so the rate they are
// percentages of is a value the property tunes and therefore a row. §9's extra
// *bed* is not decided — the owner still has to say when one is mandatory and
// whether its charge stacks with or replaces the extra-person one — so there is
// no extra-bed column here and no pricing path that could infer one from bed
// capacity. The two questions read alike and only one of them has an answer.
//
// What is deliberately NOT here, because M3 does not price it:
//
// - **The extra-bed charge.** §6 makes it a service-catalog item and §9 leaves
//   when it is charged unanswered. A column here would be that inference.
// - **Season names.** They label rows in this table; until something renders a
//   label there is nothing for the column to be read by.

import { LOYALTY_TIERS, PROMOTION_TYPES, RATE_PLAN_CODES } from "@mariva/shared";
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

/**
 * Percentage or fixed đồng, from the same tuple the wire schema is built from.
 */
export const promotionTypeEnum = pgEnum("promotion_type", PROMOTION_TYPES);

/**
 * The two tiers §7 attaches a discount to.
 *
 * A Postgres type for a concept M3 cannot yet compute is deliberate: the tier a
 * guest holds is `FR-GST-04`'s to derive, but the tier a promotion *requires*
 * is a property decision §7 has already made, and storing it as text would let
 * a later milestone match `'Gold'` against `'GOLD'` and find nothing.
 */
export const loyaltyTierEnum = pgEnum("loyalty_tier", LOYALTY_TIERS);

/**
 * A discount that modifies what a plan quotes — `FR-PRC-03`.
 *
 * Rows rather than code, for the reason `rate_plan` is rows: §7 sets the
 * loyalty discounts at 5% and 10% and marks both ⚑ proposed, which makes them
 * values somebody tunes rather than values a deploy changes.
 *
 * **A promotion only ever reduces.** The `CHECK` below refuses a positive
 * value, so the sign is the same one `rate_plan.percent_adjustment` uses —
 * negative moves the price down. A modifier that raised a price would be a
 * surcharge, and a surcharge that arrived through the promotions path would
 * quote a guest more than the calendar they were shown.
 *
 * `value` carries both forms because they are never both set: a `PERCENTAGE`
 * row holds whole points and a `FIXED_AMOUNT` row holds whole đồng, and the
 * constraint bounds each against its own scale. Two nullable columns would let
 * a row set neither, which is a promotion that does nothing.
 *
 * Validity is a window and not a flag, so a campaign that ended stops applying
 * without anybody remembering to switch it off. `isActive` is the separate
 * question of whether a promotion inside its window should be offered at all —
 * pulling a live campaign is one column, and deleting the row would take the
 * history of what a past stay was quoted under with it.
 */
export const promotion = pgTable(
  "promotion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A human-typed handle — `LOYALTY_SILVER`, `EARLY_BIRD`. Not an enum: the
    // three rate plans are a closed set the property argues about, promotions
    // are a set it adds to, and a campaign should not need a migration.
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    type: promotionTypeEnum("type").notNull(),
    // Whole points when the type is PERCENTAGE, whole đồng when it is
    // FIXED_AMOUNT. `bigint` because the đồng form shares the column and a
    // fixed discount is priced on the same scale as the room rate.
    value: bigint("value", { mode: "bigint" }).notNull(),
    // Null at either end is an open-ended window — a loyalty discount has no
    // start date and no end date, which is exactly what §7 describes.
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    // "Stay 3 nights and save". Null is no length condition.
    minNights: smallint("min_nights"),
    // Null is open to everyone. Set, it is §7's Silver or Gold gate, and the
    // milestone that derives a guest's tier is the one that reads it.
    requiresLoyaltyTier: loyaltyTierEnum("requires_loyalty_tier"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    // Each form bounded on its own scale, in one constraint because the bound
    // that applies depends on the type. −100% is excluded along with 0: a night
    // discounted to nothing is a comp, and `rate_calendar` already argues that
    // a comp is a folio adjustment rather than a price.
    check(
      "promotion_value_reduces_within_its_scale",
      sql`(${table.type} = 'PERCENTAGE' and ${table.value} between -99 and -1)
        or (${table.type} = 'FIXED_AMOUNT' and ${table.value} < 0)`,
    ),
    // A window that closes before it opens applies on no date at all, which
    // reads in a report as a campaign nobody took up.
    check(
      "promotion_window_opens_before_it_closes",
      sql`${table.validFrom} is null or ${table.validTo} is null
        or ${table.validTo} >= ${table.validFrom}`,
    ),
    // A minimum of zero nights is not a condition, and a negative one is a
    // typo. Either would make the promotion apply to every stay while looking
    // like it restricts one.
    check(
      "promotion_minimum_at_least_one_night",
      sql`${table.minNights} is null or ${table.minNights} >= 1`,
    ),
  ],
);

/**
 * The tariff figures that belong to the property rather than to a plan, a type
 * or a date — `FR-PRC-04`.
 *
 * One row, and Postgres is what holds it to one: the primary key is a boolean
 * a `CHECK` pins to `true`, so a second row collides with the first. A table
 * that quietly grew a second row would make "the extra-person rate" a question
 * about which row a query read first, and unlike `rate_calendar` there is no
 * date or type to tell them apart.
 *
 * A table rather than a constant in the tree, for the reason `rate_plan` is a
 * table: §9 files the extra-person rate as data the property has not settled
 * (⚑ 600,000 ₫ proposed), and the RBAC matrix already gives a manager the
 * config it is one of. Written as a literal in a service it would be a value a
 * deploy changes, and retuning a price is not a release.
 *
 * A table rather than a column on `rate_plan`, because the charge does not vary
 * by plan. Repeating one figure across three rows would have the schema claim
 * the property prices a third head differently under `BB` — the same mistake §1
 * avoided by stating included occupancy once instead of per type.
 *
 * It holds one column today and that is not an argument against it. The
 * extra-bed price joins it the day the owner answers §9, and it is the row
 * that will already be there rather than a migration written under time
 * pressure at the point of sale.
 */
export const propertyTariff = pgTable(
  "property_tariff",
  {
    // Not a uuid, deliberately — a surrogate key would let a second row exist
    // and only a unique index on nothing could then stop it.
    isTheProperty: boolean("is_the_property").primaryKey().default(true),
    // ⚑ §3, proposed. Gross per night per head, and the figure the age bands
    // are percentages *of* — without it none of them resolve to a number.
    extraPersonPerNightGross: bigint("extra_person_per_night_gross", {
      mode: "bigint",
    }).notNull(),
  },
  (table) => [
    check("property_tariff_holds_exactly_one_row", sql`${table.isTheProperty}`),
    // Zero is not "the third head is free" — §3 already has a free band, and it
    // is decided by age. A zero here would silently apply it to everyone.
    check(
      "property_tariff_extra_person_positive",
      sql`${table.extraPersonPerNightGross} > 0`,
    ),
  ],
);

export type RatePlanRow = typeof ratePlan.$inferSelect;
export type PropertyTariffRow = typeof propertyTariff.$inferSelect;
export type RateCalendarRow = typeof rateCalendar.$inferSelect;
export type StayRestrictionRow = typeof stayRestriction.$inferSelect;
export type PromotionRow = typeof promotion.$inferSelect;
