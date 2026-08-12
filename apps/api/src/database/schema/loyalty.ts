// What a stay earned — `FR-GST-05`, and `property-and-tariff.md` §7.
//
// One table, and it is a ledger for the same reason `folio_posting` is one: the
// requirement says "balance = Σ ledger rows, never a mutable counter". A balance
// column would be a second place for a guest's points to live, and the two would
// disagree the first time an accrual was retried, rolled back, or written by a
// job somebody re-ran.
//
// **Accrual-only, in v1 and in this table's shape.** `product-requirements.md`
// lists a redemption engine as a non-goal, so there is no burn column, no
// signed movement type and no balance-at-a-point row. Points are earned per
// closed folio and never spent, which makes the sum of this table the whole of
// the answer.
//
// **Idempotent by the folio, not by the caller.** One row per closed folio is
// the unique key below, which is the `FR-PAY-03` pattern applied to points: a
// job that runs twice over the same night, a retried close and a support script
// all arrive as the same accrual, and the second one is refused by the database
// rather than by whoever remembered to check. Keying on the folio rather than on
// the booking is deliberate — `FR-GST-05` posts "at folio close, never at
// booking or payment", so a cancelled or no-show stay closes no folio and
// structurally earns nothing.
//
// What is deliberately *not* here:
//
// - **A tier.** `FR-GST-04` makes the tier a *derived value, never hand-set*,
//   recomputed at business-date rollover from the trailing-12-month window.
//   `schema/guest.ts` refuses to store one for the same reason, and storing it
//   beside the points would be the same mistake with a better view of it: a
//   column that is correct only until the window moves under it.
// - **A points balance, total or running sum.** See above.
// - **An expiry job.** §7 expires "points earned in year `Y` … 31 December of
//   `Y+1`", which is a date each row carries and a predicate every read applies.
//   A rolling-inactivity rule would need a sweep; a fixed calendar date needs
//   nothing but the column.
// - **The earn rate.** §8's prohibition, and §7 puts the rate in system
//   configuration for the same reason: what a stay earned is this row, and what
//   the rate was when it earned it is a config row read at accrual time.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { folio } from "./folio.js";
import { user as guestUser } from "./guest-auth.js";

/**
 * One accrual: the points one closed folio earned one account.
 *
 * `earnedAt` is an instant and `expiresAt` is a calendar date, and the split is
 * the one `folio_posting` draws between `posted_at` and `business_date`. The
 * accrual happens at a moment — the close — and the points stop being spendable
 * at the end of a day in Ho Chi Minh City, which no timestamp expresses without
 * moving the boundary by seven hours.
 */
export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // `text` for `booking.user_id`'s reason: Better Auth generates the guest
    // realm's ids itself.
    userId: text("user_id")
      .notNull()
      .references(() => guestUser.id),
    folioId: uuid("folio_id")
      .notNull()
      .references(() => folio.id)
      // The idempotency key. A second accrual for one stay is points the guest
      // did not earn, and — because the balance is a sum rather than a column —
      // nothing downstream would notice the doubling.
      .unique(),
    // A count and not money, and `mode: "bigint"` all the same: the column is
    // summed over a guest's whole history, and a `number` here would be a
    // different type for every reader of an integer Postgres already holds
    // exactly.
    pointsEarned: bigint("points_earned", { mode: "bigint" }).notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // §7's fixed calendar expiry. `mode: "string"` keeps the ISO text Postgres
    // stores rather than a `Date` at UTC midnight, which in UTC+7 is the day
    // before — the same reason `booking.check_in_date` takes it.
    expiresAt: date("expires_at", { mode: "string" }).notNull(),
    // What the guest reads beside the figure. Optional, because the folio the
    // row keys to already says which stay earned it.
    note: text("note"),
  },
  (table) => [
    // The balance query, which is every read of this table: this account's
    // unexpired rows. Leading with the account and ordering by the expiry is
    // what lets `expires_at > current_date` be answered from the index.
    index("loyalty_ledger_user_expires_at_idx").on(
      table.userId,
      table.expiresAt,
    ),
    // Accrual-only, stated as a constraint rather than as a habit. A negative
    // row is a redemption, which v1 does not have and which no endpoint could
    // authorise; zero is legal, because a stay whose net room revenue fell
    // below one earn unit honestly earned nothing and still has to occupy its
    // folio's one row.
    check("loyalty_ledger_accrues_only", sql`${table.pointsEarned} >= 0`),
  ],
);

export type LoyaltyLedgerRow = typeof loyaltyLedger.$inferSelect;
