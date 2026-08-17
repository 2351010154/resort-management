// What the booking declarations say, and what is left to a database.
//
// The lifecycle vocabulary crosses three boundaries — a Postgres enum, the
// transition table the service will enforce, and the wire schema a front-desk
// client reads — so drift between them is the failure worth catching here. A
// state renamed in one place and not the others produces rows nothing can read
// rather than an error anyone sees.
//
// Whether Postgres actually refuses a cancelled booking with no reason, a hold
// with no expiry or an assignment naming a booking nobody took is a question
// about the migration, and it is answered in `test/booking-storage.e2e-spec.ts`
// against a real database.

import { readFileSync } from "node:fs";
import {
  BOOKING_STATES,
  bookingStateSchema,
  CANCELLATION_REASONS,
  cancellationReasonSchema,
  RATE_PLAN_CODES,
} from "@mariva/shared";
import type { BookingState } from "@mariva/shared";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  booking,
  bookingNight,
  bookingStateEnum,
  cancellationReasonEnum,
} from "./booking.js";
import type { BookingRow } from "./booking.js";
import { roomAssignment } from "./inventory.js";

describe("the lifecycle vocabulary", () => {
  it("names the same six states in Postgres as on the wire", () => {
    expect(bookingStateEnum.enumValues).toEqual([...BOOKING_STATES]);
    expect(bookingStateSchema.options).toEqual([...BOOKING_STATES]);
  });

  it("holds six states and no seventh", () => {
    // `booking-state-machine.md` §1 argues the count: an abandoned hold and a
    // guest cancellation differ in reason and not in effect, so an `EXPIRED`
    // state would double the transition table and settle nothing.
    expect(BOOKING_STATES).toHaveLength(6);
    expect(BOOKING_STATES).not.toContain("EXPIRED");
  });

  it("cannot be joined by a seventh", () => {
    // @ts-expect-error — the enum is closed at §1's six. A state invented in a
    // service fails to compile rather than reaching a transition table that has
    // no row for it.
    const invented: BookingState = "EXPIRED";

    expect(bookingStateSchema.safeParse(invented).success).toBe(false);
  });

  it("carries every cancellation reason as a column, not as states", () => {
    expect(cancellationReasonEnum.enumValues).toEqual([...CANCELLATION_REASONS]);
    expect(cancellationReasonSchema.options).toEqual([...CANCELLATION_REASONS]);
  });
});

describe("the booking row", () => {
  it("dates the stay by the calendar and never by the clock", () => {
    // A timestamp would put an arrival at 23:50 Ho Chi Minh City on the day
    // before in UTC, which is the off-by-one night that reads as a booking
    // system quietly losing a day's revenue rather than as a bug.
    expect(booking.checkInDate.getSQLType()).toBe("date");
    expect(booking.checkOutDate.getSQLType()).toBe("date");

    // `mode: "string"` — the ISO text Postgres stores, not a `Date` the driver
    // rebuilt at UTC midnight. Asserted at the type level because that is where
    // the mode is visible; a `Date` here stops compiling.
    const arrival: BookingRow["checkInDate"] = "2026-08-14";

    expect(arrival).toBe("2026-08-14");
  });

  it("times the hold expiry by the clock, because a TTL is not a night", () => {
    // The one column here that is genuinely an instant: a hold placed at 14:32
    // expires twenty minutes later, and no calendar date expresses that.
    expect(booking.holdExpiresAt.getSQLType()).toBe("timestamp with time zone");
  });

  it("prices in whole đồng and never in a decimal type", () => {
    for (const amount of [
      booking.quotedStayTotalGross,
      booking.quotedExtraPersonPerNightGross,
      booking.quotedBreakfastPerPersonGross,
      bookingNight.standardGross,
    ]) {
      expect(amount.getSQLType()).toBe("bigint");
    }

    const total: BookingRow["quotedStayTotalGross"] = 1_850_000n;

    expect(total).toBe(1_850_000n);
  });

  it("sells the plans the rate table already knows", () => {
    // The same Postgres enum `rate_plan.code` uses, rather than a second type
    // holding the same three words. A booking on a plan the tariff has never
    // heard of is a price nothing can explain.
    expect(booking.ratePlanCode.enumValues).toEqual([...RATE_PLAN_CODES]);
  });

  it("records the party it quoted rather than a head count", () => {
    // `occupancy-pricing.ts` prices children in three age bands, and a count
    // cannot say which band each head fell in. "Three guests" could not be
    // re-explained, refunded or reported on without guessing whether the third
    // was a toddler or an adult.
    expect(booking.adults.notNull).toBe(true);
    expect(booking.childAges.notNull).toBe(true);
    expect(booking.childAges.getSQLType()).toBe("smallint[]");
  });

  it("carries the account that booked it in the type that account's ids are", () => {
    // `guest_user.id` is Better Auth's 32-character base-62 string, and
    // `guest-auth.ts` says why that table takes no database-generated key. A
    // `uuid` here would be a foreign key Postgres refuses to create at all.
    expect(booking.userId.getSQLType()).toBe("text");

    const account: BookingRow["userId"] = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";

    expect(account).toHaveLength(32);
  });

  it("finds one account's stays by an index that skips every walk-in", () => {
    // Most stays at a forty-room property are taken at the desk and carry no
    // account, so the index holds the rows the question is asked about and not
    // the nulls underneath them — `booking_hold_expires_at_idx`'s argument.
    const own = getTableConfig(booking).indexes.find(
      (declared) => declared.config.name === "booking_user_id_idx",
    );

    expect(own?.config.where).toBeDefined();
    expect(
      (own?.config.columns ?? []).map((column) =>
        "name" in column && typeof column.name === "string"
          ? column.name
          : "(expression)",
      ),
    ).toEqual(["user_id"]);
  });

  it("leaves nullable exactly the columns a live booking may lack", () => {
    // A reason and an instant belong to a cancellation, an expiry to a hold, a
    // breakfast figure to `BB`, and a waiver to the manager who granted one.
    // Everything else is present on every booking, including the frozen quote —
    // a booking with no price is the failure this table was reshaped to
    // prevent.
    expect(booking.cancellationReason.notNull).toBe(false);
    expect(booking.cancelledAt.notNull).toBe(false);
    expect(booking.penaltyWaivedAt.notNull).toBe(false);
    expect(booking.penaltyWaivedBy.notNull).toBe(false);
    expect(booking.holdExpiresAt.notNull).toBe(false);
    expect(booking.quotedBreakfastPerPersonGross.notNull).toBe(false);
    // And the account, which most bookings do not have: a walk-in is somebody
    // at the counter, and a `NOT NULL` here would mean inventing an account
    // for a guest who will never sign in.
    expect(booking.userId.notNull).toBe(false);
    // Null on every stay whose anonymous credential is still good, which is
    // every stay until somebody attaches one to an account.
    expect(booking.anonAccessRevokedAt.notNull).toBe(false);

    expect(booking.quotedStayTotalGross.notNull).toBe(true);
    expect(booking.quotedPercentAdjustment.notNull).toBe(true);
    expect(booking.quotedExtraPersonPerNightGross.notNull).toBe(true);
  });

  it("times a cancellation and a waiver by the clock, not the calendar", () => {
    // §4's free window closes at 18:00 on a stated day, so the instant a
    // cancellation arrived decides which side of it the stay falls — a `date`
    // here would round every cancellation to midnight and waive half of them.
    expect(booking.cancelledAt.getSQLType()).toBe("timestamp with time zone");
    expect(booking.penaltyWaivedAt.getSQLType()).toBe(
      "timestamp with time zone",
    );
  });

  it("declares the checks that leave a half-stated booking unrepresentable", () => {
    const declared = getTableConfig(booking)
      .checks.map((check) => check.name)
      .sort();

    expect(declared).toEqual([
      "booking_child_ages_are_ages",
      "booking_covers_at_least_one_night",
      "booking_has_an_adult",
      "booking_held_by_only_while_held",
      "booking_hold_expiry_exactly_when_held",
      "booking_names_a_waiver_authority_exactly_when_waived",
      "booking_quoted_adjustment_within_bounds",
      "booking_quoted_breakfast_positive_when_set",
      "booking_quoted_extra_person_positive",
      "booking_quoted_promotion_is_whole_or_absent",
      "booking_quoted_promotion_reduces_within_its_scale",
      "booking_quoted_total_positive",
      "booking_reason_exactly_when_cancelled",
      "booking_records_a_cancellation_instant_exactly_when_cancelled",
      "booking_revokes_anonymous_access_only_with_an_account",
    ]);
  });

  it("cannot give up its anonymous credential with nobody to recover through", () => {
    // The stranding rule, and the reason revocation is safe to make permanent.
    // A guest whose cookie has been revoked reaches the stay by signing in, and
    // one who never chose a password gets one by resetting it to the address the
    // confirmation was mailed to. Revoking a stay filed under nobody would leave
    // neither route, so the row is refused instead of the guest being locked out
    // of something they paid for.
    //
    // Written as an implication and not a biconditional: an attached stay may
    // perfectly well never have had a cookie to give up, because the guest was
    // signed in when they booked.
    const stranding = getTableConfig(booking).checks.find(
      (check) =>
        check.name === "booking_revokes_anonymous_access_only_with_an_account",
    );

    expect(stranding).toBeDefined();
    expect(booking.anonAccessRevokedAt.getSQLType()).toBe(
      "timestamp with time zone",
    );
  });

  it("addresses a booking by a reference nothing else answers to", () => {
    // M7 routes on `/bookings/<reference>`. Two bookings sharing one is a link
    // that opens somebody else's stay.
    expect(booking.reference.isUnique).toBe(true);
  });
});

describe("the frozen nights", () => {
  it("stores the calendar price, not the plan-adjusted one", () => {
    // The load-bearing choice, and `booking.ts` argues it at length: §5 forbids
    // rounding inside a calculation, so the plan's percentage is applied once
    // over the summed stay. A per-night adjusted figure would divide per night
    // and the stored nights would then fail to sum to the stored total.
    //
    // Asserted as the absence of a second money column: a night that carried
    // its own adjusted total is exactly the shape this rejects.
    const columns = Object.keys(bookingNight);

    expect(columns).toContain("standardGross");
    expect(columns).not.toContain("adjustedGross");
    expect(columns).not.toContain("planGross");
  });

  it("gives a booking one row per night and no second one", () => {
    const unique = getTableConfig(bookingNight).indexes.find(
      (declared) => declared.config.name === "booking_night_booking_date_key",
    );

    expect(unique?.config.unique).toBe(true);
    expect(
      (unique?.config.columns ?? []).map((column) =>
        "name" in column && typeof column.name === "string"
          ? column.name
          : "(expression)",
      ),
    ).toEqual(["booking_id", "stay_date"]);
  });
});

describe("the key room assignment waited for", () => {
  it("points a hold at the booking that placed it", () => {
    // `inventory.ts` carried `booking_id` with no foreign key from M3, on the
    // stated grounds that there was nothing yet to reference. There is now, and
    // the key is written by hand into this migration rather than declared in
    // Drizzle — the column's comment gives the import-cycle reason.
    const migration = readFileSync(
      new URL("../migrations/0006_booking_core.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain(
      `ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_booking_id_booking_id_fk"`,
    );
  });

  it("leaves a closure with no booking behind it", () => {
    // A room withdrawn for a leaking pipe is held through the same table. The
    // key is on a nullable column for that reason, and a `NOT NULL` here would
    // mean modelling a closure somewhere the exclusion constraint cannot see.
    expect(roomAssignment.bookingId.notNull).toBe(false);
  });
});
