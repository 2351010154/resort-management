// Where the gateway's report and the property's own ledger disagree —
// `FR-PAY-05`, and `docs/architecture/infrastructure.md` §Payments.
//
// `payment.ts` records what the payer's side said; the folio records what the
// guest's account says. Neither of them records the third fact, which is that
// somebody held the two against a report the gateway publishes for the day and
// found them the same. Until this table, a disagreement was a comment in
// `payment.service.ts` saying it "has to be reconciled by hand", which means it
// was nobody's: an amount the gateway and the ledger differ on left no trace
// that a person could be handed, and a payment the gateway took that never
// reached an account looked exactly like a stay nobody paid for.
//
// **A row per disagreement, and nothing at all for an agreement.** The
// comparison classifies every attempt on either side of the day — matched,
// absent here, absent there, or agreed on except for the figure — and only the
// last three are written down. A row per compared attempt would be the gateway's
// daily report copied into Postgres, growing by every payment the property ever
// takes, to record the one thing nobody ever needs to look up. What somebody has
// to be handed is the exception, and the exception is what is here.
//
// So an empty day is the good day. That reads oddly for a table until you notice
// what the alternative costs: a "clean" row per date is a row whose absence
// means either that the day was clean or that reconciliation never ran, and the
// two are the opposite of each other. `job-runner.service.ts` already logs one
// line per run including the empty ones, for exactly that reason and with
// exactly that argument — a sweep that quietly stopped firing is invisible in a
// log that only records the runs that found work — so the question "did anyone
// look at the 14th?" is already answered, and answering it a second time here
// would be a second answer to drift from the first.
//
// **The key is `FR-PAY-03`'s shape over a different pair of columns.** The
// nightly job re-runs — the cron's own tick, a manager re-running a date by
// hand, `job-runner.service.ts` deliberately running the sweep twice inside one
// transaction to prove it settles — and a second pass must not write the same
// disagreement again. As on `payment`, the guarantee is the index's rather than
// a look the caller took first: between a read and an insert there is nothing
// holding the key, so two runs that both looked would both find nothing and both
// write. One attempt on one business date is one row here, and the second
// insert is refused by Postgres.
//
// **The attempt reference is what both sides are named by.** It is the
// property's own string — minted by `payment.service.ts`, handed over, echoed
// back — so keying on it carries no gateway vocabulary past the port
// (`FR-PAY-01`), and it is the one identifier that exists on both sides of every
// case below. The gateway's own transaction id cannot do the job: a payment the
// ledger holds and the gateway's report does not mention may never have been
// given one, and a `MISSING_LOCALLY` row is precisely the case where this
// property has no row to have stored it on.
//
// **Both amounts are nullable and the check says which.** A disagreement is
// asymmetric — one side reports đồng and the other reports nothing — and an
// amount of zero would be a lie about it that `NFR-02`'s arithmetic would then
// carry. `payment_discrepancy_kind_matches_the_sides` makes the classification
// and the columns one fact instead of two that can drift: a `MISSING_LOCALLY`
// row carrying a ledger figure, or an `AMOUNT_MISMATCH` whose two figures are
// equal, is refused by the database rather than by whichever reader thought to
// check.
//
// **Nothing here is ever written back to.** The append-only rule the ledger
// keeps is kept differently by this table and for a different reason:
// `folio_posting` is append-only because a mistake on a guest's account is
// corrected by a reversing entry, and this is append-only because it is a record
// of what was observed at a moment. The observation does not stop having been
// true when the missing callback finally arrives an hour later. What a re-run
// finds then is a matched attempt, which writes nothing — so the row stands,
// saying what the day looked like when it was looked at.
//
// What is deliberately *not* here:
//
// - **A resolution, an acknowledgement or an assignee.** `FR-PAY-05` says
//   discrepancies page a phone, and paging is a later piece of work with its own
//   answer about who is on call. A `resolved_at` column added now would be a
//   workflow nothing drives, and a column nothing fills cannot be told apart
//   from one nobody has got to yet — `payment.ts` makes the same argument about
//   `updated_at`.
// - **A day's totals, on the run row below or anywhere else.** The paragraph
//   above says why an agreement is written down nowhere, and a stored count of
//   compared attempts or discrepancies found is the same figure kept twice: it
//   is a query over `payment` and `payment_discrepancy` that is correct at the
//   moment it is asked rather than at the moment it was frozen.
//   `payment_reconciliation_run` therefore holds a date and the instant it was
//   looked at, and not one number — it exists to be *asked a question*, not to
//   answer one, and the difference is the whole of why it earns a table when a
//   summary row would not.
// - **An author, and an audit entry.** `audit.ts` files who changed which row,
//   and its `actor_id` is `not null` on the argument that leaving room for an
//   unattributable write is how the interesting writes become the
//   unattributable ones. Nobody authors a row here: the comparison runs on a
//   schedule, on no person's authority, exactly as `folio_posting.posted_by` is
//   null for the writers with no person behind them. Auditing this table is the
//   same piece of work as auditing the sweeps, and `audit.ts` says what that
//   costs — a nullable actor beside a column saying which kind of writer a null
//   means, made with a second kind of actor in hand.
// - **A gateway response code, a settlement batch number or a merchant id.**
//   `FR-PAY-01`, unchanged: the report reaches this table through the port as
//   references and đồng, and a column shaped like one gateway's paperwork would
//   be the second gateway's migration.
// - **The folio.** A discrepancy is about a payment, and the payment names the
//   account. Carrying a folio id here would be the same fact in two places, kept
//   in step by nothing, on the one table whose entire purpose is to notice when
//   two copies of a fact have stopped agreeing.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { payment } from "./payment.js";

/**
 * The ways the two reports can fail to say the same thing.
 *
 * Three members and not a boolean, because a person answering one of these does
 * something different for each. Money the gateway took that never reached an
 * account is a guest owed a receipt and a folio short by that amount; money the
 * ledger holds that the gateway's report does not mention is either a payment
 * the property recorded against a gateway that never took it or a report that
 * arrived early; and two figures that disagree is a terminal, a currency scale
 * or a merchant account configured against a different property.
 *
 * "Matched" is not a member, and that is the table's shape rather than an
 * omission — the header says why an agreement is written down nowhere. The
 * service's own outcome type adds it, because a comparison has to be able to say
 * so; a row cannot, because there is no row.
 *
 * Named from this property's point of view. `MISSING_LOCALLY` is missing *here*,
 * which is the direction that costs a guest money.
 */
export const PAYMENT_DISCREPANCY_KINDS = [
  "MISSING_LOCALLY",
  "MISSING_AT_GATEWAY",
  "AMOUNT_MISMATCH",
] as const;

export const paymentDiscrepancyKindEnum = pgEnum(
  "payment_discrepancy_kind",
  PAYMENT_DISCREPANCY_KINDS,
);

/** One of the three, as a value a caller can branch on. */
export type PaymentDiscrepancyKind = (typeof PAYMENT_DISCREPANCY_KINDS)[number];

/**
 * One attempt, on one business date, that the two reports describe differently.
 *
 * The business date and not the calendar date — `property-and-tariff.md` §2. A
 * payment taken at 01:30 belongs to the trading day that has not been closed
 * yet, and a reconciliation partitioned by midnight would report the same money
 * missing on one day and unexplained on the next, every night, for every
 * property whose guests pay after dark.
 */
export const paymentDiscrepancy = pgTable(
  "payment_discrepancy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    // The property's own name for the attempt, matched whole. `payment.ts` says
    // why the column there is text and never a parsed pair, and the same holds
    // here for the stronger reason: this row may exist because there is no
    // payment row at all, so the string is the only thing that names what is
    // being reported on.
    attemptReference: text("attempt_reference").notNull(),
    kind: paymentDiscrepancyKindEnum("kind").notNull(),
    // Whole đồng, unsigned, `mode: "bigint"` — `payment.ts` and `money.ts` both
    // argue it, and it matters here twice over: these two columns exist to be
    // subtracted from one another by whoever reads them, and a figure that lost
    // its last digits on the way through `number` would turn a discrepancy of
    // nothing into a discrepancy nobody can reproduce.
    //
    // Null where that side reports nothing at all, which is not the same as
    // reporting zero. The check below is what keeps the two apart.
    gatewayAmount: bigint("gateway_amount", { mode: "bigint" }),
    ledgerAmount: bigint("ledger_amount", { mode: "bigint" }),
    // The payment this is about, where there is one. Null on `MISSING_LOCALLY`
    // by definition — that is the case where the property has no such row — and
    // present on the other two, because a person handed this row needs the money
    // and not just its name.
    //
    // A reference and never a claim on the row: nothing in the reconciliation
    // path updates or deletes a payment, so this points at a fact somebody else
    // wrote and goes on pointing at it.
    paymentId: uuid("payment_id").references(() => payment.id),
    // When the two reports were held against each other. Not `created_at`,
    // because the row is an observation rather than a record that was opened —
    // and the instant is worth keeping where `payment.created_at` is only worth
    // reading by: a discrepancy found at 04:05 and one found at 16:00 on the
    // same business date are different questions about how long the gap stood.
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One attempt on one business date is one row, so the nightly job may be
    // re-run — by the cron, by a manager, or by the runner proving to itself
    // that the sweep settles — without writing the same disagreement twice. The
    // header argues why this is the index's guarantee and not a caller's.
    //
    // Not partial: both columns are `not null`, so unlike `payment`'s two keys
    // there is no set of rows for the predicate to exclude.
    uniqueIndex("payment_discrepancy_business_date_attempt_unique_key").on(
      table.businessDate,
      table.attemptReference,
    ),
    // A discrepancy of nothing is not a discrepancy, and a negative amount is a
    // sign convention this table does not carry any more than `payment` does.
    // Either would be read as money by whoever is handed the row.
    check(
      "payment_discrepancy_amounts_are_positive",
      sql`(${table.gatewayAmount} is null or ${table.gatewayAmount} > 0)
        and (${table.ledgerAmount} is null or ${table.ledgerAmount} > 0)`,
    ),
    // The classification and the columns are one fact. Every branch is spelled
    // out rather than left to the writer's care, because the row outlives the
    // code that wrote it and a reader has to be able to trust the `kind` without
    // re-deriving it from the amounts.
    //
    // `AMOUNT_MISMATCH` insists the two figures actually differ: two equal
    // amounts filed as a mismatch is a matched attempt written down as an
    // exception, and it would page somebody at four in the morning about money
    // that is exactly where it should be.
    //
    // The `case` covers every member of the enum, so it is never null and the
    // check never passes by default.
    check(
      "payment_discrepancy_kind_matches_the_sides",
      sql`case ${table.kind}
        when 'MISSING_LOCALLY' then
          ${table.gatewayAmount} is not null
            and ${table.ledgerAmount} is null
            and ${table.paymentId} is null
        when 'MISSING_AT_GATEWAY' then
          ${table.gatewayAmount} is null
            and ${table.ledgerAmount} is not null
            and ${table.paymentId} is not null
        when 'AMOUNT_MISMATCH' then
          ${table.gatewayAmount} is not null
            and ${table.ledgerAmount} is not null
            and ${table.paymentId} is not null
            and ${table.gatewayAmount} <> ${table.ledgerAmount}
      end`,
    ),
  ],
);

export type PaymentDiscrepancyRow = typeof paymentDiscrepancy.$inferSelect;

/**
 * A business date somebody has already held the two reports against.
 *
 * This is the sweep's predicate and it is the reason the table exists. The
 * comparison is only honest over a *closed* trading day: a payment whose
 * callback is still in flight when the report is read is money the gateway holds
 * and this property does not, which classifies as `MISSING_LOCALLY` and pages a
 * phone about a payment that lands four seconds later. So `ReconciliationJob`
 * never touches the day the property is currently having, and asks instead which
 * closed days it still owes work for — a question the table above cannot answer,
 * because a clean day writes nothing there and its silence is indistinguishable
 * from a day nobody looked at.
 *
 * `job-runner.service.ts`'s per-run log line records that a run happened and is
 * the right home for that fact for a person reading back. It is not a home for
 * this one: a sweep cannot query a log, and the sweep is what needs the answer.
 *
 * **The date is the primary key**, so the fact and its uniqueness are one thing.
 * A second reconciliation of a date it already holds is refused by Postgres
 * rather than by a caller that looked first — the argument the header makes
 * about `payment_discrepancy`'s key, which is also what makes the sweep safe to
 * run inside `JobRunner`'s two passes: the first writes the row, the second
 * finds the date no longer outstanding and does nothing.
 *
 * **Nothing cascades into it and it points at nothing.** A run is about a day
 * rather than about any row, and the attempts it compared may since have been
 * resolved, re-paid or refunded without making it untrue that the day was looked
 * at on the morning it was.
 */
export const paymentReconciliationRun = pgTable("payment_reconciliation_run", {
  businessDate: date("business_date", { mode: "string" }).primaryKey(),
  // When the day was looked at, which is not the day itself and is worth
  // keeping for the same reason `observed_at` is above: a date reconciled at
  // 04:05 the next morning and one reconciled six days late are different
  // answers to "was anybody watching?".
  reconciledAt: timestamp("reconciled_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
});

export type PaymentReconciliationRunRow =
  typeof paymentReconciliationRun.$inferSelect;
