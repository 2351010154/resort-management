// What the property was actually paid — `FR-PAY-03`, and
// `docs/architecture/infrastructure.md` §Payments.
//
// A row here is a movement of money as the *payer's side* reports it: a gateway
// callback, a note in the drawer, a line on a bank statement. The guest's
// account says the same thing in its own words, as a `folio_posting` of type
// `PAYMENT`, and the two are not one fact written twice. `NFR-02` is the
// nightly reconciliation between them — Σ postings = Σ payments + outstanding —
// and a reconciliation with only one side has nothing to compare.
//
// **The partial unique index is the whole file.** `infrastructure.md` §Payments
// states the fact it is built on without hedging: "VNPay may send the same IPN
// more than once. A unique constraint on the gateway transaction id is
// mandatory, not defensive." A handler that read the table first and inserted if
// it found nothing would pass a test that replays one IPN ten times in a row and
// still take the money twice the first afternoon two callbacks arrive together —
// between the read and the insert there is nothing holding the key, and both
// handlers find nothing. So the guarantee is the index's. Ten concurrent
// replays are ten inserts, one of which commits; the other nine are told
// `23505` and post nothing.
//
// **Partial, because the column is null for most of the property's money.**
// Cash and bank transfer have no gateway and therefore no gateway id, and a
// plain unique constraint would be satisfied by any number of nulls in
// Postgres — so the index would appear to hold and would in fact permit
// exactly the rows it was written to permit. The `where` clause says that out
// loud instead of relying on a null-comparison rule a reader has to recall.
// `folio_posting_reversal_unique_key` is the same shape for the same reason.
//
// **The attempt is here, and a decision is what put it there.** This file used
// to record the column's absence as an open question — whether an unpaid attempt
// is a row here or a query against the booking it belongs to — and
// `payment.service.ts` answered it by writing a `PENDING` row the moment it
// opens one. A row nothing can find again is worse than no row: the callback
// that resolves it arrives naming the reference and nothing else, so with no
// column to match on, a paid stay ends holding a `PENDING` row beside its
// `SUCCESS` one and every reader of the table has to guess which of the two is
// the money. `attempt_reference` is what the callback matches on.
//
// It is the property's own name for the attempt and not anything a gateway
// said — minted here, handed over, echoed back — so `FR-PAY-01` is intact: no
// reader of this column learns a gateway's vocabulary from it.
//
// **It carries its own partial unique index, for the guarantee the first one
// cannot give.** An attempt the gateway *refused* has no transaction id —
// `GatewayTransaction` will not name one for money nobody paid — so nothing
// keyed on that column reaches it. Keyed on the attempt instead, one attempt is
// one row whatever became of it, and that is what lets a callback be resolved by
// a single conditional `UPDATE` and, when it matches nothing, by a single read
// of the row it was aimed at: both are statements about *the* attempt, and only
// this index makes "the" the right word. Partial with the same predicate and for
// the same reason as the other: the money the property collects itself was
// opened under no attempt at all.
//
// **The row's status is written more than once, and that is not the ledger's
// rule bent.** `folio_posting` is append-only because `FR-FOL-01` says a mistake
// on a guest's account is corrected by a reversing entry and never an edit. This
// table is not that account. It records the payer's side — one attempt, and what
// became of it — and an attempt resolving from `PENDING` to `SUCCESS` is that
// one fact finishing rather than a second fact overwriting the first. The
// reconciliation `NFR-02` runs holds the two tables against each other precisely
// because they are written under different rules.
//
// **Cash belongs to a drawer, and the column that says which is not optional.**
// `FR-OPS-01` puts every cash payment inside an open shift, so that the variance
// a receptionist is asked to explain at handover is computable at all: đồng in
// the till with no shift on it is đồng nobody is answerable for, and it turns
// every count that day into a discrepancy with no name attached. Gateway money
// is the opposite case — it never touches the drawer, so binding it to a shift
// would inflate the count by money that is not in it.
//
// `payment_shift_binding` states that as one biconditional and not as a branch
// per method: cash has a shift, everything else has none. Written as an
// enumeration — "`VNPAY` and `BANK_TRANSFER` have no shift" — the constraint
// would refuse the first row of the next method the property adds, and
// `FR-PAY-06`'s MoMo is already named as one. A drawer rule that blocks a
// gateway integration is a rule that has outgrown what it knows. The
// biconditional says what is true of the drawer and nothing about the rest.
//
// Bank transfer sits on the gateway side of it, which is the one line worth
// reading twice: it is money the desk takes rather than money a gateway takes,
// but it lands in a bank account and never in the till, so counting it into the
// drawer would produce a shortfall equal to every transfer of the shift.
//
// **The posting this payment is the other half of, when there is one.** This
// column was left out while nothing needed it, on the grounds that each row
// already names the folio and that the direction of the key was not knowable
// until a caller had a use for it. A reversal is that use. Undoing a payment
// posting has to say what became of the money as well as what became of the
// line: the ledger's half reverses to nothing, and a `payment` row left at
// `SUCCESS` beside it would leave Σ payments standing at a figure the ledger no
// longer carries — `NFR-02` broken by the correction rather than by the
// mistake.
//
// The key is written from the payment to the posting because that is the
// direction the pair is created in: `folio.postPayment` writes the posting
// first and has its id in hand, where a column on `folio_posting` would have to
// be filled in by a second statement after the payment row existed. It is
// nullable and unique-where-present, which says the two things that are true of
// it: the gateway's rows have no posting to name — the attempt is opened before
// any line is written, and `payment.service.ts` posts the ledger's half through
// a different call — and no posting may be the other half of two payments.
//
// What is deliberately *not* here:
// - **The instant the attempt was opened.** `PaymentAttempt` is a reference
//   *and* a creation time, because a gateway partitions transactions by the day
//   one was opened and a later query has to name the same instant. This column
//   is that instant on a gateway row, and it is written rather than defaulted:
//   `payment.service.ts` mints it once and hands the same value to the insert
//   and to the gateway, so the pair is exact by construction. It used to be the
//   row's own clock — the transaction's start time, near the attempt's and not
//   equal to it — and `FR-PAY-05`'s nightly query is what made the difference
//   matter, because an instant a second out comes back "transaction not found"
//   and reads as money the gateway never took. On the money the desk collected
//   itself there is no attempt and no gateway, and this is simply when the row
//   was written.
// - **A gateway response code, a bank code or a card type.** `FR-PAY-01` keeps
//   gateway vocabulary inside the adapter, and a column here would carry it
//   past the port and into every reader of this table.
// - **A refund.** `FR-PAY-04` makes a refund a reversing entry on the ledger.
//   `REFUNDED` below says what became of this payment; what was handed back,
//   when and on whose authority is a posting, and it is `M6`'s refund task.
// - **`updated_at`.** `config.ts` and `service.ts` both make the argument and it
//   holds here: nothing reads it, and a column nothing reads cannot be told
//   apart from one nobody has filled in yet.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { folio, folioPosting } from "./folio.js";
import { staffUser } from "./identity.js";
import { shift } from "./shift.js";

/**
 * How the money reached the property.
 *
 * A method and not a provider list: `CASH` and `BANK_TRANSFER` are ways of
 * paying, and `VNPAY` and `PAYPAL` are the two gateways `infrastructure.md`
 * §Payments commits to. A second gateway is a second member here and a second
 * adapter behind `FR-PAY-01`'s port — never a second table and never a second
 * folio, which is why `PAYPAL` arriving changed this line and nothing about the
 * shape of the table under it.
 *
 * `FR-PAY-01` caps the property at two implementations, and `PAYPAL` takes the
 * second slot. A third gateway is not a third member added quietly here; it is
 * a decision that has to reopen that cap first.
 */
export const PAYMENT_METHODS = [
  "VNPAY",
  "PAYPAL",
  "CASH",
  "BANK_TRANSFER",
] as const;

export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);

/**
 * What became of the payment.
 *
 * `PENDING` is money claimed and not yet confirmed — a transfer the desk has
 * been told about and has not seen land. `FAILED` is kept rather than deleted
 * because a payment the gateway refused is what a guest asking "why was I not
 * charged" is asking about, and `FR-PAY-05`'s reconciliation compares two
 * reports rather than one report and an absence.
 */
export const PAYMENT_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
] as const;

export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);

/**
 * One movement of money against one account.
 *
 * `postedBy` is null for a payment no person authored — the gateway's callback
 * writes rows on nobody's authority, and `folio_posting.posted_by` leaves the
 * column null for the same reason rather than naming a placeholder account that
 * would make an automated payment indistinguishable from one a receptionist
 * took. Cash and bank transfer are the other case: somebody stood at the desk
 * and counted it, and `FR-AUD-01` asks who.
 *
 * `paidAt` is the payer's clock and never ours. `GatewayTransaction` refuses to
 * describe a successful transaction without one precisely so that no caller can
 * reach for `?? new Date()`, and a payment dated by this process rather than by
 * the gateway is the drift `FR-PAY-05` exists to catch.
 */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folioId: uuid("folio_id")
      .notNull()
      .references(() => folio.id),
    method: paymentMethodEnum("method").notNull(),
    // The property's own name for the attempt this row belongs to — the
    // reference `payment.service.ts` mints, hands to the gateway, and is handed
    // back in every callback about it. It is the only thing a callback and a row
    // have in common, and so the only thing an unresolved attempt can be found
    // again by.
    //
    // Text rather than a pair of columns for the two halves the reference is
    // built out of. What matches here is the whole string as the gateway echoed
    // it, and splitting it into a booking and a nonce would be this table
    // knowing how the service composes a value it neither reads nor validates.
    //
    // Null on the money nobody opened an attempt for — the cash and the
    // transfers the desk takes itself — which is the same set of rows the
    // gateway id is null on, and why both indexes below are partial.
    attemptReference: text("attempt_reference"),
    // The gateway's own id for the money it took — VNPay's `vnp_TransactionNo`.
    // Text rather than a number: it is an identifier the gateway hands back and
    // compares as a string, and the day one arrives with a leading zero or a
    // letter in it, a numeric column would either refuse it or round it.
    //
    // Null on everything the property collected itself, which is what makes the
    // index below partial.
    gatewayTransactionId: text("gateway_transaction_id"),
    // Whole đồng, unsigned — `NFR-12`. `mode: "bigint"` so the value that comes
    // back is the integer that went in; `folio_posting.amount` says at length
    // why a figure routed through `number` loses đồng in silence.
    //
    // Unsigned because this is a magnitude and not a ledger entry. The sign
    // convention belongs to `folio_posting`, which stores a payment negative so
    // the balance is a plain sum, and repeating it here would be one convention
    // in two places for a reconciliation whose whole job is to compare them.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: paymentStatusEnum("status").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    postedBy: uuid("posted_by").references(() => staffUser.id),
    // The drawer this money was counted into, and null for every đồng that
    // never reached one. The check below is what makes that sentence a rule
    // rather than a habit, and the header says why it is written as a
    // biconditional over `CASH` instead of a list of the methods that are
    // exempt.
    //
    // *Which* drawer is a fact in `shift` and so beyond what a check over one
    // row can see. A trigger holds it — cash named into a shift that has been
    // counted out, or into one belonging to somebody other than this row's
    // `posted_by`, is refused with `MV006`. The reasoning, and what is
    // deliberately left to the two foreign keys instead, is in
    // `migrations/0040_a_payment_is_counted_into_an_open_shift_of_its_own.sql`.
    shiftId: uuid("shift_id").references(() => shift.id),
    // The ledger line this row is the payer's side of, for the money the desk
    // collected itself. Null on a gateway row, which has none — the header says
    // why the key runs in this direction and what a reversal needs it for.
    folioPostingId: uuid("folio_posting_id").references(() => folioPosting.id),
    // What the payer was actually charged, when the gateway could not charge
    // đồng — PayPal does not support VND at all, so a guest paying that way
    // approves a figure in dollars while `amount` above stays the đồng this
    // property posts and reconciles.
    //
    // Three columns and not one, because all three are needed to check the
    // fourth: the currency names the unit, the amount is what left the payer's
    // account in it, and the rate is the only lawful bridge back to `amount`.
    // Recording the pair without the rate would leave a settlement nobody could
    // verify a month later, once the property had edited its rate.
    //
    // Null on everything collected in đồng, which is cash, transfers and every
    // VNPay row. `money.ts` states the rule these hold to: presentment is a
    // record and never an amount — nothing sums these, and no folio reads them.
    presentmentCurrency: text("presentment_currency"),
    // The minor unit of that currency — cents. `mode: "bigint"` for the reason
    // `amount` uses one: a figure routed through `number` loses its last digits
    // in silence, and this one is compared against a gateway's own report.
    presentmentAmount: bigint("presentment_amount", { mode: "bigint" }),
    // Đồng per one major unit, frozen when the attempt opened and never
    // re-read. `numeric` and not a float: this is the one fraction in the
    // payment path, and a double would convert a stay to within a few đồng of
    // right — the drift `FR-PAY-05` surfaces a month later as a day that will
    // not reconcile.
    fxRate: numeric("fx_rate"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The guarantee `FR-PAY-03` asks for, and the reason it is an index rather
    // than a check in the handler is at the top of this file.
    uniqueIndex("payment_gateway_transaction_unique_key")
      .on(table.gatewayTransactionId)
      .where(sql`${table.gatewayTransactionId} is not null`),
    // One attempt, one row, whatever became of it — and the lookup a callback is
    // resolved through, which a unique index already serves.
    //
    // The index above cannot make this claim: a refused attempt carries no
    // transaction id, so nothing keyed on one reaches it. This is what lets
    // `payment.service.ts` resolve a callback with one conditional `UPDATE` and
    // read the outcome off one row when it matches nothing. Partial for the
    // reason the other one is, and stated the same way rather than left to
    // Postgres' rule about nulls in a unique index.
    uniqueIndex("payment_attempt_reference_unique_key")
      .on(table.attemptReference)
      .where(sql`${table.attemptReference} is not null`),
    // One posting has at most one payer's side. A reversal reads this column to
    // find the row it has to settle, and a second payment naming the same line
    // would leave it settling one of them and reporting nothing about the
    // other. Partial, because the gateway's rows all name no posting and
    // Postgres would otherwise hold them to being distinct from each other.
    uniqueIndex("payment_folio_posting_unique_key")
      .on(table.folioPostingId)
      .where(sql`${table.folioPostingId} is not null`),
    // The variance query: sum the cash counted into one drawer. It is asked
    // once per handover and again by every manager reading a shift back, and
    // without it that sum is a scan of every payment the property has ever
    // taken.
    index("payment_shift_idx").on(table.shiftId),
    // Every read of this table is "what has this folio been paid" — the
    // reconciliation's sum, and the balance the check-out guard reads beside it.
    index("payment_folio_idx").on(table.folioId),
    // A payment of nothing is not a payment, and a negative one is the ledger's
    // sign convention leaking into a column that does not carry it. Both would
    // sum into `NFR-02` and neither would throw anywhere else.
    check("payment_amount_is_positive", sql`${table.amount} > 0`),
    // Both directions. A payment that succeeded with no time on it cannot be
    // reconciled against the gateway's report of the same day, and a time of
    // payment on one that is pending or refused is a moment nothing happened
    // at — most likely this process's clock, standing in for a gateway's.
    //
    // `REFUNDED` sits on the paid side because it is a payment that was taken
    // and later handed back; when it was taken does not stop being true.
    check(
      "payment_paid_at_exactly_when_money_moved",
      sql`(${table.status} in ('SUCCESS', 'REFUNDED')) = (${table.paidAt} is not null)`,
    ),
    // `FR-OPS-01` in one line, both directions: cash is in a drawer, and
    // nothing else is. A cash payment with no shift is đồng nobody is
    // answerable for; a gateway payment with one inflates a count by money that
    // was never in the till.
    //
    // Stated over `CASH` alone rather than over the methods that are exempt,
    // because the exempt list is not closed — `FR-PAY-06` already names MoMo —
    // and a constraint written as that list would refuse the first payment
    // taken through the next gateway the property adds.
    check(
      "payment_shift_binding",
      sql`(${table.method} = 'CASH') = (${table.shiftId} is not null)`,
    ),
    // All three or none. Any two of them describe a charge nobody can check: a
    // currency and an amount with no rate cannot be brought back to đồng, and a
    // rate with no amount records the terms of a conversion that is not written
    // down. The row is either silent about presentment or complete about it.
    check(
      "payment_presentment_is_whole_or_absent",
      sql`num_nonnulls(${table.presentmentCurrency}, ${table.presentmentAmount}, ${table.fxRate}) in (0, 3)`,
    ),
    // And a gateway that cannot charge đồng must not be silent. `PAYPAL` is
    // settled in another currency by definition, so a `PAYPAL` row without
    // presentment is one `FR-PAY-05` could never reconcile — the ledger would
    // hold đồng the gateway never reports and the report would hold dollars the
    // ledger cannot match.
    //
    // Written as an implication over `PAYPAL` rather than as a list of the
    // methods that are exempt, for the reason `payment_shift_binding` gives
    // about closed lists: the exempt set is every method that settles in đồng,
    // and naming them would refuse the first payment taken through whatever
    // comes next.
    // Compared as text rather than as the enum it is, and the cast is
    // load-bearing rather than cosmetic. The migration that adds `PAYPAL` to
    // `payment_method` and the one that adds this constraint are applied in a
    // single transaction, and Postgres refuses to evaluate a label added in the
    // transaction it is used in — `55P04`, `unsafe use of new value`. As text no
    // label is materialised, and the rule is the same rule. The migration says
    // this at greater length, and it was checked against a live server rather
    // than reasoned about.
    check(
      "payment_foreign_gateway_states_what_it_charged",
      sql`${table.method}::text <> 'PAYPAL' or ${table.presentmentCurrency} is not null`,
    ),
    // A charge of nothing is not a charge, and the sign convention that keeps
    // `amount` unsigned keeps this one unsigned too.
    check(
      "payment_presentment_amount_is_positive",
      sql`${table.presentmentAmount} is null or ${table.presentmentAmount} > 0`,
    ),
    // A rate of nothing converts nothing, and a negative one converts money
    // into its opposite. Both would divide into a folio that cannot be made to
    // balance against any report.
    check(
      "payment_fx_rate_is_positive",
      sql`${table.fxRate} is null or ${table.fxRate} > 0`,
    ),
  ],
);

export type PaymentRow = typeof payment.$inferSelect;
