// The booking, and the price it was sold at.
//
// Two tables, and the second is the reason this file is longer than the state
// machine suggests. `booking` holds what the guest agreed to; `booking_night`
// holds the calendar prices that agreement was computed from. Storing only the
// dates, the type and the plan code would record a *recipe* rather than a price,
// and every input to that recipe — the rate calendar, the plan's percentage,
// the breakfast figure, the extra-person rate — is a row the RBAC matrix lets a
// manager edit. Re-deriving a total after any of those moved answers with a
// number the guest never saw, and answers it confidently.
//
// What is deliberately *not* here:
//
// - **The guest.** A booking is taken before anyone is identified — the funnel
//   holds a room and asks for a name afterwards. The guest record and its
//   foreign key are the next migration's, and nothing here needs one to be
//   correct.
// - **Charges, postings and refunds.** M4 computes the cancellation and no-show
//   amounts and persists none of them. The folio is M6, and a money table
//   written before the ledger that owns it is a second place for a balance to
//   live.

import { BOOKING_STATES, CANCELLATION_REASONS } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { roomType } from "./inventory.js";
import { ratePlanCodeEnum } from "./pricing.js";

/**
 * The six states as a database type, from the same tuple the wire schema is
 * built from — the pattern `room_type_code` and `rate_plan_code` set.
 */
export const bookingStateEnum = pgEnum("booking_state", BOOKING_STATES);

/**
 * Why a booking ended without a stay — `booking-state-machine.md` §1.
 *
 * A column and not a state, so the six above stay six however many reasons the
 * property later distinguishes.
 */
export const cancellationReasonEnum = pgEnum(
  "cancellation_reason",
  CANCELLATION_REASONS,
);

/**
 * One booking: one room type, one half-open range of nights, one agreed price.
 *
 * The stay range is `[check_in_date, check_out_date)`, the same convention
 * `room_assignment` and `@mariva/shared`'s stay range state — the departure date
 * is not a night sold.
 *
 * Occupancy is stored as the party that was quoted rather than as a head count,
 * because `occupancy-pricing.ts` prices children in three age bands and a count
 * cannot say which band each head fell in. A booking that recorded "three
 * guests" could not be re-explained, refunded or reported on without guessing
 * whether the third was a toddler or an adult.
 */
export const booking = pgTable(
  "booking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What the guest is told and what M7 routes on — `/bookings/<reference>`.
    // Unique because it is an address: two bookings answering to one reference
    // is a link that opens somebody else's stay. Its shape is the generator's
    // business and is not pinned here, so changing the format is not a
    // migration that has to rewrite every historical row.
    reference: text("reference").notNull().unique(),
    state: bookingStateEnum("state").notNull(),
    cancellationReason: cancellationReasonEnum("cancellation_reason"),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
    // Dates and never timestamps — §1's timezone row, and the reason
    // `@mariva/shared`'s stay date is a `CalendarDate`. `mode: "string"` keeps
    // the ISO text Postgres stores instead of handing back a `Date` at UTC
    // midnight, which in UTC+7 is the previous night.
    checkInDate: date("check_in_date", { mode: "string" }).notNull(),
    checkOutDate: date("check_out_date", { mode: "string" }).notNull(),
    ratePlanCode: ratePlanCodeEnum("rate_plan_code").notNull(),
    // The party, as quoted. Ages and not a count, for the reason above.
    adults: smallint("adults").notNull(),
    childAges: smallint("child_ages").array().notNull().default([]),

    // ── The frozen quote ────────────────────────────────────────────────────
    // Everything below was read at the moment of sale and is never recomputed.
    // The stay total is the authoritative figure; the other three are the inputs
    // that produced it, kept so a folio line at M6 can explain the number
    // without reading tables that have since changed.
    quotedStayTotalGross: bigint("quoted_stay_total_gross", {
      mode: "bigint",
    }).notNull(),
    // Signed points off the calendar price, as `rate_plan` holds it.
    quotedPercentAdjustment: smallint("quoted_percent_adjustment").notNull(),
    // Null on a plan that included no breakfast — the difference between `BB`
    // and the other two, as it stood on the day.
    quotedBreakfastPerPersonGross: bigint("quoted_breakfast_per_person_gross", {
      mode: "bigint",
    }),
    // The figure `occupancy-pricing.ts`'s age bands are percentages *of*.
    quotedExtraPersonPerNightGross: bigint(
      "quoted_extra_person_per_night_gross",
      { mode: "bigint" },
    ).notNull(),

    // When an unconfirmed hold stops holding anything. Null once the booking is
    // no longer `HELD`: the TTL is a fact about a hold, and a stale expiry left
    // on a confirmed stay is a date a sweep could act on.
    holdExpiresAt: timestamp("hold_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The front desk's two questions — which bookings arrive today, and which
    // are still held — are both a scan over a state and a date.
    index("booking_state_check_in_date_idx").on(table.state, table.checkInDate),
    // What the TTL sweep asks: holds whose expiry has passed. Partial, because
    // every other state has no expiry and the index has no reason to carry them.
    index("booking_hold_expires_at_idx")
      .on(table.holdExpiresAt)
      .where(sql`${table.holdExpiresAt} is not null`),
    // A stay of no nights is not a booking. `room_assignment` refuses the same
    // row for the same reason — an empty range holds nothing and collides with
    // nothing, which is how a booking would slip past the guarantee inventory
    // exists to give.
    check(
      "booking_covers_at_least_one_night",
      sql`${table.checkOutDate} > ${table.checkInDate}`,
    ),
    // Both directions on purpose. A cancelled booking without a reason cannot be
    // priced by §4's grid, and a reason on a live booking is a cancellation
    // somebody started and did not finish.
    check(
      "booking_reason_exactly_when_cancelled",
      sql`(${table.state} = 'CANCELLED') = (${table.cancellationReason} is not null)`,
    ),
    // Same shape, same argument: a hold with no expiry is held forever, and an
    // expiry on anything else is a sweep waiting to cancel a stay that is
    // already sold.
    check(
      "booking_hold_expiry_exactly_when_held",
      sql`(${table.state} = 'HELD') = (${table.holdExpiresAt} is not null)`,
    ),
    // A room sleeps somebody. Zero adults with a list of children is a party
    // nobody could check in.
    check("booking_has_an_adult", sql`${table.adults} >= 1`),
    // An age is not negative, and the bands in `occupancy-pricing.ts` resolve to
    // a charge for every value that is not.
    check("booking_child_ages_are_ages", sql`0 <= all(${table.childAges})`),
    // Zero is not a price. A comp is a folio adjustment at M6, not a booking
    // sold for nothing — `rate_calendar` refuses zero for the same reason.
    check(
      "booking_quoted_total_positive",
      sql`${table.quotedStayTotalGross} > 0`,
    ),
    // The bounds `rate_plan` puts on the live column, kept on the frozen copy so
    // a quote cannot store what the plan itself could not hold.
    check(
      "booking_quoted_adjustment_within_bounds",
      sql`${table.quotedPercentAdjustment} between -100 and 100`,
    ),
    check(
      "booking_quoted_breakfast_positive_when_set",
      sql`${table.quotedBreakfastPerPersonGross} is null or ${table.quotedBreakfastPerPersonGross} > 0`,
    ),
    check(
      "booking_quoted_extra_person_positive",
      sql`${table.quotedExtraPersonPerNightGross} > 0`,
    ),
  ],
);

/**
 * One night of the stay, at the calendar price it was sold at.
 *
 * These are `rate_calendar.gross_per_night` as it stood at the moment of sale —
 * the `STANDARD` price, *before* the plan's percentage, breakfast and
 * extra-person charge are applied. That is the load-bearing choice in this file.
 *
 * `property-and-tariff.md` §5 forbids rounding inside a calculation, and the
 * pricing path honours it by summing the nights first and dividing by a hundred
 * once, over the whole stay. Storing the plan-adjusted figure per night would
 * mean dividing per night, and the stored nights would then fail to sum to the
 * stored total by a few đồng — a discrepancy that is unprovable rather than
 * merely wrong. Storing the calendar price sidesteps it entirely: these rows and
 * the four frozen inputs on `booking` reproduce `quoted_stay_total_gross`
 * exactly, by the same arithmetic that produced it.
 *
 * They exist because a total alone cannot answer what §4's grid asks. "The first
 * night" is a cancellation penalty and a no-show charge; "the remaining nights
 * at 50%" is an early departure. Both are a night's price, and neither may be
 * approximated by dividing a total by a count when a weekend night costs more
 * than a Tuesday.
 *
 * One row per night the stay was *sold*, written with the booking in the
 * transaction that consumes the inventory. That is `[check_in_date,
 * check_out_date)` as the booking was taken, and an extension keeps it so by
 * appending rows for the nights it adds.
 *
 * An early departure is the one operation that leaves rows past the departure
 * date, deliberately. §4 charges "the remaining nights at 50%", so the nights
 * nobody will now sleep are precisely the basis of that charge — deleting them
 * would destroy the number the folio has to post and, later, explain. A
 * cancellation and the night audit leave them for the same reason: what stops
 * happening is the stay, not the record of what it was sold as.
 */
export const bookingNight = pgTable(
  "booking_night",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id),
    stayDate: date("stay_date", { mode: "string" }).notNull(),
    standardGross: bigint("standard_gross", { mode: "bigint" }).notNull(),
  },
  (table) => [
    // One price per night of one booking. A second row for the same night would
    // make the stay total depend on which one a sum happened to read, which is
    // the whole failure this table was added to prevent.
    uniqueIndex("booking_night_booking_date_key").on(
      table.bookingId,
      table.stayDate,
    ),
    check("booking_night_gross_positive", sql`${table.standardGross} > 0`),
  ],
);

export type BookingRow = typeof booking.$inferSelect;
export type BookingNightRow = typeof bookingNight.$inferSelect;
