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
// What is deliberately *not* here:
//
// - **A folio posting reference.** The posting and the payment are written in
//   one transaction and each already names the folio. A key between them would
//   have to be written in one direction or the other, and neither is knowable
//   before both rows exist — the payment service that writes the pair is where
//   that question is answered, if it turns out to be one.
// - **The attempt the gateway was opened under.** `PaymentGateway`'s
//   `PaymentAttempt` is a reference and the instant it was minted, and it is
//   the caller who mints and keeps the pair. Whether an unpaid attempt is a
//   `PENDING` row here or a query against the booking it belongs to is the
//   handler's decision, and inventing a column for it now would be a guess at
//   an answer that costs a migration either way.
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
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { folio } from "./folio.js";
import { staffUser } from "./identity.js";

/**
 * How the money reached the property.
 *
 * A method and not a provider list: `CASH` and `BANK_TRANSFER` are ways of
 * paying, and `VNPAY` is the one gateway `infrastructure.md` §Payments commits
 * to. A second gateway is a second member here and a second adapter behind
 * `FR-PAY-01`'s port — never a second table and never a second folio.
 */
export const PAYMENT_METHODS = ["VNPAY", "CASH", "BANK_TRANSFER"] as const;

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
  ],
);

export type PaymentRow = typeof payment.$inferSelect;
