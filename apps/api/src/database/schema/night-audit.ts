// What a trading day came to, written down once and never again — `FR-RPT-01`,
// and `screens.md`'s promise that every report page is "stamped with the
// business date of the night-audit snapshot it reads, because reports never see
// a day the audit has not closed".
//
// Every figure below can already be computed from the ledger and the inventory
// counters, which is exactly the objection this table has to answer. The answer
// is that a query over live tables is correct at the moment it is asked rather
// than at the moment the day ended, and the two drift for reasons that are all
// ordinary: a room charge reversed a week later, a closure that withdraws a room
// from sale after the night was sold, an `ADMIN` moving the rollover hour. A
// management report re-run in March would then show a different December from
// the one December was reported as, with nothing anywhere saying which of the
// two is the figure the property acted on. Freezing is what makes history stop
// moving — `payment_reconciliation_run` earns a table for the opposite reason,
// because it exists to be asked a question rather than to answer one, and this
// one is the answer.
//
// **The date is the primary key, so a second freeze of one day is not a thing
// the database can hold.** `FR-RPT-01` asks that the audit run "exactly once per
// business date, provable from job history", and `job-runner.service.ts` argues
// at length why a ledger of runs proves the wrong thing: it answers "has this
// already happened?" where the question is "would doing it again change
// anything?". Here the two coincide, because the row *is* the work. The sweep's
// predicate is the absence of this row and its product is the row, so the second
// pass the runner makes over the same transaction finds the day closed and does
// nothing — the proof and the guard are one object rather than a flag written
// afterwards.
//
// **A row per room type beside it, and that is the whole of the granularity
// decision.** `FR-RPT-03` wants occupancy, ADR and RevPAR, and `screens.md` puts
// them on a Reports page a manager reads by type. All three are ratios over the
// three figures held here:
//
//     occupancy = rooms_sold / sellable_rooms
//     ADR       = net_room_revenue_vnd / rooms_sold
//     RevPAR    = net_room_revenue_vnd / sellable_rooms
//
// so a property-wide row alone would answer the property-wide question and leave
// the per-type one to a query over live tables — which is the drift above,
// reintroduced for the half of the report that a revenue manager actually acts
// on. Storing the ratios instead was the other option and is worse: a ratio is a
// division of two integers that has to be taken at the precision the reader
// wants, and a stored ADR cannot be re-totalled across a range, a month or the
// five types, which is every question the range picker asks. So the three
// countable facts are stored and the ratios are computed by whoever asks.
//
// **Net room revenue excludes VAT and the service charge**, `FR-GST-04` and
// §5 — and it needs no arithmetic here to do it, because `FR-FOL-02` already
// posts the sale as three separate lines and the `ROOM_CHARGE` line is the net
// one. `tax-decomposition.ts` is where that figure is settled; this table sums
// the lines it wrote and re-derives nothing, which is what keeps a report from
// disagreeing with the invoice the guest was handed.
//
// **The snapshot is immutable in Postgres and not merely by convention.**
// `night_audit_snapshot_is_frozen` refuses `UPDATE` and `DELETE` on both tables
// in the migration that creates them, the way `0011` does for the folio ledger
// and `0023` for the loyalty one, and for the reason `FR-RPT-01` gives in one
// clause: reports read snapshots so that history never changes. A convention
// would hold for the services written against it and for nothing else — a
// support script, a later migration, somebody at a psql prompt — and the whole
// value of the row is that the figure a manager saw in December is the figure
// anybody sees in March.
//
// What is deliberately *not* here:
//
// - **An invoice, or anything about one.** `FR-RPT-01` says outright that the
//   night audit does not issue them and names `FR-FOL-04` as what does. A
//   column here counting invoiced folios would be a second queue beside the
//   `folio_awaiting_invoice_idx` predicate that already is one.
// - **The current business date.** §2 derives it from the clock and the
//   configured rollover hour, and `business-date.service.ts` refuses to hold it
//   anywhere for a reason that applies twice as hard to a stored column: two
//   answers to what day it is will differ, and the stored one will be the one
//   nothing can correct. What "rolls the date" means here is that the day that
//   just ended acquires a row and is thereby closed.
// - **Payments, outstanding balances or a ledger identity.** `NFR-02` holds Σ
//   postings against Σ payments plus outstanding nightly, and that is an
//   arithmetic over two live tables rather than a figure a report reads back. A
//   frozen copy of it would be a second answer to a question whose whole point
//   is that the two sides are recomputed and compared.
// - **A room-status count.** `FR-RPT-02` wants one and `room_condition` holds
//   it, but a housekeeping status is where a room stands *now* and is never a
//   fact about a night that has ended — §1 and `FR-INV-04` keep readiness and
//   sellability on separate axes precisely so the two cannot be confused, and a
//   frozen "dirty at 04:00" would be the confusion given a column.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { roomType } from "./inventory.js";

/**
 * One closed trading day, property-wide.
 *
 * The business date and never the calendar date — §2. A day that runs from
 * 04:00 to 04:00 contains a walk-in taken at 01:30 that the calendar would file
 * under tomorrow, and an occupancy drawn on midnight would report that night
 * twice: once where it was sold and once where it was slept.
 */
export const nightAuditSnapshot = pgTable(
  "night_audit_snapshot",
  {
    businessDate: date("business_date", { mode: "string" }).primaryKey(),
    // When the day was closed, which is not the day itself. A date frozen at
    // 04:05 the next morning and one frozen six days late by a manager draining
    // a backlog are different answers to "was anybody watching?" —
    // `payment_reconciliation_run.reconciled_at` is kept for the same reason and
    // states it at length.
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Rooms the property could have sold that night, which is `FR-INV-04`'s
    // figure and not a count of rooms: a closure withdraws a room from sale by
    // moving `type_inventory.total_rooms`, and an occupancy measured against the
    // forty rooms that physically exist would punish a property for a floor it
    // deliberately took out of service.
    sellableRooms: smallint("sellable_rooms").notNull(),
    // Rooms that were slept in and charged for. `night-audit.service.ts` says
    // why this is counted from the ledger rather than read off
    // `type_inventory.sold_rooms`: the numerator of ADR has to be the same set
    // of rooms as its denominator.
    roomsSold: smallint("rooms_sold").notNull(),
    // Whole đồng, `mode: "bigint"` on `NFR-12`'s rule and `money.ts`'s argument.
    // Signed, and the sign is doing work: a day whose room charges were reversed
    // within it nets to nothing, and a day carrying a correction to an earlier
    // night is genuinely a day of negative room revenue. A column refusing that
    // would force the audit to either lie or refuse to close the day.
    netRoomRevenueVnd: bigint("net_room_revenue_vnd", {
      mode: "bigint",
    }).notNull(),
    // Everything else the property *sold* that day, net: today that is the
    // service items, at the same net basis as the room charges beside them,
    // with their own VAT and service-charge lines standing outside it.
    //
    // Two things are deliberately not in here. Payments and refunds are money
    // moving rather than money earned. And §4's cancellation charge is not a
    // sale at all — it is money a booking forfeited by not happening, so
    // counting it would put takings on a day the property did no business, and
    // a night of mass cancellations would report as a good one.
    // `night-audit.service.ts` makes that argument where the classification is.
    otherRevenueVnd: bigint("other_revenue_vnd", { mode: "bigint" }).notNull(),
  },
  (table) => [
    // A negative count is a bug in whatever assembled the row rather than a
    // night that happened. There is deliberately no `rooms_sold <=
    // sellable_rooms` beside it: a room withdrawn from sale after the night was
    // sold leaves a day genuinely sold above what was sellable, and a check
    // refusing that row would stop the audit closing the day over an occupancy
    // above 100% that is the true reading of what happened.
    check(
      "night_audit_snapshot_counts_are_not_negative",
      sql`${table.sellableRooms} >= 0 and ${table.roomsSold} >= 0`,
    ),
  ],
);

/**
 * The same night, per room type — the rows `FR-RPT-03` is read from.
 *
 * There is no other-revenue column here and that is the shape rather than an
 * omission: a service item is sold to a stay and a stay has a type, but the
 * property's own income has no type at all, and a per-type column that held one
 * kind of non-room money and not the other would be a total nobody can add up.
 *
 * The three columns present are exactly the three that ADR, RevPAR and occupancy
 * are ratios of, so a manager comparing Deluxe against Suite is comparing frozen
 * figures rather than a live query filtered by a type.
 */
export const nightAuditSnapshotType = pgTable(
  "night_audit_snapshot_type",
  {
    // The parent, and the reference is what stops a type row existing for a day
    // nobody closed. No `onDelete`, so Postgres restricts — but the trigger in
    // the migration has already refused the delete, and the two together mean
    // the restriction is never the thing that has to hold.
    businessDate: date("business_date", { mode: "string" })
      .notNull()
      .references(() => nightAuditSnapshot.businessDate),
    // The type as it was, by reference. A code copied in as text would survive a
    // type being renamed, which sounds like the point of a snapshot and is not:
    // the five types are the property's own and a report grouped by a stale
    // string would show one type twice.
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomType.id),
    sellableRooms: smallint("sellable_rooms").notNull(),
    roomsSold: smallint("rooms_sold").notNull(),
    netRoomRevenueVnd: bigint("net_room_revenue_vnd", {
      mode: "bigint",
    }).notNull(),
  },
  (table) => [
    // One type on one night is one row, and the date leads because every report
    // this table exists for picks a range of dates first. Two rows for one pair
    // would each hold part of the night and the property-wide row above would
    // agree with neither.
    primaryKey({ columns: [table.businessDate, table.roomTypeId] }),
    check(
      "night_audit_snapshot_type_counts_are_not_negative",
      sql`${table.sellableRooms} >= 0 and ${table.roomsSold} >= 0`,
    ),
  ],
);

export type NightAuditSnapshotRow = typeof nightAuditSnapshot.$inferSelect;
export type NightAuditSnapshotTypeRow =
  typeof nightAuditSnapshotType.$inferSelect;
