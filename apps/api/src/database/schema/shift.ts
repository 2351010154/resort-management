// The desk's working day: who has the drawer open, what was counted into it,
// what was counted out of it, and what the next person has to be told —
// `FR-OPS-01`.
//
// A shift is not a roster entry and not a login session. It is the interval one
// named person is answerable for one physical drawer, and every column here is
// about that answerability rather than about hours worked. `opening_float` is
// the đồng counted in at the start; `closing_count` is the đồng counted out at
// the end; the variance the property actually cares about is neither, but the
// arithmetic between the two and the cash taken in between.
//
// **The variance is a query and never a column.** It is `opening_float` plus the
// sum of the `CASH` payments bound to this shift, held against `closing_count`,
// and `payment_reconciliation_run` already makes the argument for leaving that
// kind of figure underived: a total written down is correct at the instant it
// was frozen, and a total computed is correct at the instant it is asked. A
// stored variance would have to be recomputed by whoever remembered to every
// time a payment was corrected, and a variance that has quietly stopped tracking
// its own payments is worse than no variance at all — it is a number the desk
// trusts.
//
// **One open shift per operator, and the database is what says so.** Two presses
// of "open shift" arriving together — a receptionist on the desk terminal and
// the same account on a tablet, or one impatient double-click — both read the
// table, both find no open shift, and both insert. The property then has one
// person answerable for two drawers, cash landing in whichever the handler saw
// first, and two closing counts that each look complete. A check in the service
// cannot prevent this: between the read and the insert there is nothing holding
// the key. `shift_one_open_per_operator` holds it. The second insert is told
// `23505` and the service turns that refusal into "you already have a shift
// open", which is the true answer.
//
// It is partial because a closed shift is history and history repeats: a
// receptionist works a shift every day, so keying on the operator alone would
// let each of them open exactly one shift ever. The predicate says which rows
// the rule is about — the open ones — and `payment.ts` says at length why that
// is written out rather than left to Postgres' convention about nulls.
//
// **A shift is closed exactly when it was counted.** `closing_count` and
// `closed_at` are one fact in two columns, and the check refuses every row where
// they disagree. A closing time with no count is a drawer somebody walked away
// from; a count with no closing time is a figure attached to a shift that reads
// as still open, so the next cash payment binds to it and the count it was
// closed on is already wrong. Either half alone would satisfy a reader asking
// "is this shift open?" and a reader asking "what was it counted at?" with
// answers that contradict each other.
//
// **`updated_at` earns its place here, where `payment.ts` refuses it.** That
// file's argument is that a column nothing reads cannot be told apart from one
// nobody has filled in yet — but a shift row is written twice by design, opened
// and later closed, and this is the only column that records when the second
// write happened for a shift that was closed and then had its handover note
// amended. `closed_at` is the drawer's clock and does not move again.
//
// What is deliberately *not* here:
//
// - **A state enum.** Open and closed are `closed_at is null` and `closed_at is
//   not null`. A `state` column beside them would be a second answer to the same
//   question, and the partial unique index above would then be keyed on one of
//   the two while the service read the other.
// - **The cash taken during the shift.** That is the sum of the payments that
//   name it, and `payment.shift_id` is the key that sum is taken over. A running
//   total kept here would be the same money in two places, reconciled by
//   nobody.
// - **A terminal, a till or a location.** The property has one desk and one
//   drawer; a column for which one would be a distinction nothing in
//   `FR-OPS-01` draws, filled in with the same value on every row.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./identity.js";

/**
 * One person, one drawer, one interval.
 *
 * `operator_id` is a staff account and never a guest one: the drawer is the
 * property's money and the question `FR-AUD-01` asks of every đồng in it is
 * which member of staff was standing there. It is `NOT NULL` for the reason
 * `audit.actor_id` is — a shift nobody is answerable for is not a quieter shift
 * but an unattributable one, and the variance it computes would be a figure with
 * nobody to hand it to.
 */
export const shift = pgTable(
  "shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => staffUser.id),
    // Whole đồng counted into the drawer before the first guest of the shift —
    // `NFR-12`, and `mode: "bigint"` for the reason every money column in this
    // schema carries it: a figure routed through `number` loses đồng in silence
    // above 2^53, and a float that is out by one makes every variance computed
    // from it out by one with nothing to trace it to.
    openingFloat: bigint("opening_float", { mode: "bigint" }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Which business date the shift belongs to, which is not the calendar date
    // `opened_at` falls on. The roll hour lives in `system_config` and a night
    // shift opened at 01:00 is answerable for the day before — so the date is
    // resolved once, when the shift opens, and stored. Deriving it later would
    // mean re-reading a roll hour that may have been edited since, and a shift
    // that changed which day it belonged to would move cash between two days'
    // takings after both had been reported.
    openingBusinessDate: date("opening_business_date", {
      mode: "string",
    }).notNull(),
    // Whole đồng counted out of the drawer at the handover. Null while the shift
    // is open, which is the whole of what "open" means here — see the check
    // below, which ties it to `closed_at` so the two cannot drift apart.
    closingCount: bigint("closing_count", { mode: "bigint" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    // What the next person has to be told: the sentence that does not fit in a
    // pending item. Free text rather than a structured list because a handover
    // note is prose by nature — "the safe key is with the manager", "room 305
    // says the kettle leaks" — and the items that do have a shape are rows in
    // `pending_item` below.
    handoverNote: text("handover_note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The guarantee, and the reason it is an index rather than a look the
    // service took first is at the top of this file. Partial, so a receptionist
    // may work every day of the year and still be refused a second drawer
    // today.
    uniqueIndex("shift_one_open_per_operator")
      .on(table.operatorId)
      .where(sql`${table.closedAt} is null`),
    // "What has this person been answerable for" — the receptionist's own
    // history, and the scoping `FR-OPS-01` puts on what a receptionist may see
    // at all.
    index("shift_operator_idx").on(table.operatorId),
    // "What happened at the desk over these days" — the manager's read, which
    // ranges over time and not over people.
    index("shift_opened_at_idx").on(table.openedAt),
    // Both halves of the close, or neither. A count with no closing time leaves
    // the shift open to the next cash payment, which lands in a drawer already
    // counted; a closing time with no count is a drawer nobody counted.
    check(
      "shift_closed_exactly_when_counted",
      sql`(${table.closingCount} is null) = (${table.closedAt} is null)`,
    ),
  ],
);

/**
 * What one shift could not finish and the next one inherits.
 *
 * A pending item is the part of a handover that outlives the note: the deposit
 * nobody has receipted, the invoice the guest in 214 is still waiting for, the
 * key that has not come back. It is raised by the shift that found it and
 * resolved by whichever later shift dealt with it — two different shifts, which
 * is why there are two keys and not one.
 *
 * `resolved_by_shift_id` may name the raising shift, and that is not a mistake
 * to be constrained away: a receptionist who raises an item at 09:00 and clears
 * it at 11:00 has done exactly what the table is for. What the check below
 * refuses is the half-resolved row — a resolution time with no shift behind it,
 * or a shift credited with a resolution that never happened — because the
 * handover screen reads unresolved items by one of those columns and the audit
 * trail reads who cleared them by the other.
 */
export const pendingItem = pgTable(
  "pending_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raisedByShiftId: uuid("raised_by_shift_id")
      .notNull()
      .references(() => shift.id),
    // What is outstanding, in the words of whoever found it. `NOT NULL` because
    // an item that says nothing is an item the next shift cannot act on, and a
    // row that exists only to be a count is a number without a task behind it.
    description: text("description").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    // Which shift cleared it — the accountability half of the resolution.
    // Nullable, and tied to the instant above by the check below.
    resolvedByShiftId: uuid("resolved_by_shift_id").references(() => shift.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "What did this shift raise" — the closing screen's own list, and the
    // record a manager reads back against a shift that went badly.
    index("pending_item_raised_by_shift_idx").on(table.raisedByShiftId),
    // "What is still outstanding, oldest first" — the question the incoming
    // shift asks, and the only one asked across every shift the property has
    // ever run. Partial on the resolution, because a property that operates for
    // a year accumulates thousands of cleared items and none of them is ever an
    // answer to this: the index stays the size of the backlog rather than the
    // size of the history.
    index("pending_item_unresolved_idx")
      .on(table.createdAt)
      .where(sql`${table.resolvedAt} is null`),
    // Both halves of the resolution, or neither — the reasoning is in the
    // docblock above.
    check(
      "pending_item_resolved_exactly_when_a_shift_cleared_it",
      sql`(${table.resolvedAt} is null) = (${table.resolvedByShiftId} is null)`,
    ),
  ],
);

export type ShiftRow = typeof shift.$inferSelect;
export type PendingItemRow = typeof pendingItem.$inferSelect;
