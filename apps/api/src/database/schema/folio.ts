// The ledger — `FR-FOL-01`, and `docs/architecture/property-and-tariff.md` §5.
//
// Two tables and one trigger. `folio` is the account one stay runs up; every
// figure on it is a `folio_posting` row; and the balance is the sum of those
// rows and is never a column. `booking/ports/folio.port.ts` already states the
// consequence — "a balance this module computed would be a second place for a
// balance to live" — and a stored total here would be that second place,
// arriving by a different door. `NFR-02` is the identity the sum has to satisfy
// nightly: Σ postings = Σ payments + outstanding.
//
// **Append-only is a trigger, and it is the point of the file.** `FR-FOL-01`
// does not say postings *should not* be edited; it says a mistake is corrected
// by a reversing entry, "never an `UPDATE` or `DELETE`". A rule enforced by the
// service that writes postings is a rule that holds until the next caller — a
// migration, a support script, a second service, a `psql` session at the end of
// a long evening. So `UPDATE` and `DELETE` raise, for every client, and the
// service is left with nothing to remember.
//
// It is a trigger rather than a `RULE` because the two fail differently. `CREATE
// RULE … DO INSTEAD NOTHING` makes the write vanish: the statement succeeds, the
// client is told a row was changed, and nothing was. A ledger that quietly
// ignores an `UPDATE` is worse than one that accepts it, because nobody finds
// out. The trigger raises with its own SQLSTATE, so the caller is told exactly
// which rule it hit and the transaction that tried it does not commit. Drizzle
// has no expression for either, so the statement is written by hand in
// `migrations/0011_folio_ledger.sql`, which explains itself there — the same
// arrangement `room_assignment`'s `EXCLUDE` constraint uses.
//
// What is *not* fenced off, and honestly: `TRUNCATE`, `DROP` and `ALTER TABLE …
// DISABLE TRIGGER`. All three need rights over the table itself rather than
// over its rows, which is a different question from the one this file answers —
// and a `BEFORE TRUNCATE` guard would fail an existing storage spec that
// truncates `booking … cascade` and reaches the ledger transitively, for a hole
// a deployment closes by not granting `TRUNCATE` to the role the API runs as.
//
// **The sign convention, once, here.** A charge is positive and a payment is
// negative, so the balance is a plain sum and zero is settled. A refund is
// therefore *positive*: it hands money back, which undoes a payment, and a
// booking that was owed 200,000 ₫ is at zero once it has been refunded. The
// `folio_posting_sign_matches_type` check is that sentence as a constraint,
// because a payment stored positive would not throw — it would double the
// balance and read as a guest who owes twice what they do.
//
// **A closed account takes no further lines, and that is a trigger too.**
// `FR-FOL-01` says so and `folio.service.ts` recorded why the rule was not here
// yet: it belongs with the close that creates the state, and until something
// closed a folio the state was unreachable rather than unguarded. Something
// closes one now, so the guard arrives with it — in
// `migrations/0016_folio_invoice_reference.sql`, beside the append-only trigger
// and for the same reason. A service that refused the posting would be refusing
// it for its own callers, and the invoice this file's other trigger protects is
// only worth protecting if the lines it was drawn from cannot grow afterwards.
//
// What is deliberately *not* here:
//
// - **A balance, a total, or a running sum.** See above.
// - **A second invoice number.** The column below holds the number of the
//   invoice issued when the account was agreed, and it is written once —
//   `0016` refuses the overwrite the way `0011` refuses an edited posting.
//   `FR-FOL-04` says *điều chỉnh/thay thế* map onto folio reversals, so a
//   corrected invoice is a second provider number for one stay and not an edit
//   of the first; a column that could be rewritten would drop the number the
//   tax authority already holds and leave nothing pointing at the document it
//   corrected. The second number is a row, and it belongs to the milestone that
//   has the ruling in hand.
// - **A link between the three lines one gross amount decomposes into.**
//   `FR-FOL-02` posts a charge, its service charge and its VAT as separate
//   lines; nothing yet reads them as a group, and `NFR-02` only sums. A
//   grouping column invented now would be a guess at how a reversal of "the
//   whole charge" is issued, which is the posting service's decision to make.
// - **A rate, a percentage or a basis point.** §8's prohibition. What a line's
//   tax was is the line; what the rate was is `system_config` read at posting
//   time.
// - **`updated_at`.** On `folio_posting` it would be a column that can never
//   change, which is worse than absent. On `folio` the only change is the close,
//   and `closed_at` says it in the tense that matters.

import { CHARGE_BASES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { booking } from "./booking.js";
import { staffUser } from "./identity.js";
import { serviceCatalog } from "./service.js";

/**
 * Whether the account is still taking lines.
 *
 * Two states and no third. `booking-state-machine.md` §4 refuses a check-out
 * whose folio does not balance, so closing is the moment the account is agreed;
 * a `SETTLED` distinct from `CLOSED` would be a balance of zero expressed twice,
 * once as a state somebody has to maintain and once as the sum that is already
 * true.
 */
export const FOLIO_STATES = ["OPEN", "CLOSED"] as const;

export const folioStateEnum = pgEnum("folio_state", FOLIO_STATES);

/**
 * What a line is, and it is the only place a posting says so.
 *
 * Every member has a document behind it. `ROOM_CHARGE` is the night audit's
 * line (`FR-RPT-01`); `SERVICE_ITEM` is a catalog row posted at §6's price, and
 * §5's extra bed "posts to the folio as a service item, never as a rate
 * increase"; `SERVICE_CHARGE_FEE` and `VAT` are the two lines `FR-FOL-02`
 * decomposes a gross figure into, which §5 requires be shown separately rather
 * than folded into the charge; `POLICY_CHARGE` is a row of §4's cancellation
 * grid; `PAYMENT` and `REFUND` are money moving in and out; `REVERSAL` is
 * `FR-FOL-01`'s correction.
 *
 * `SERVICE_CHARGE_FEE` is spelled at that length on purpose. "Service charge"
 * in §5 is the 5% levied on a line, and "service item" in §6 is something the
 * property sold; a member called `SERVICE_CHARGE` sitting beside `SERVICE_ITEM`
 * would be two different things one word apart, on an invoice an accountant
 * reads.
 */
export const POSTING_TYPES = [
  "ROOM_CHARGE",
  "SERVICE_ITEM",
  "SERVICE_CHARGE_FEE",
  "VAT",
  "POLICY_CHARGE",
  "PAYMENT",
  "REFUND",
  "REVERSAL",
] as const;

export const postingTypeEnum = pgEnum("posting_type", POSTING_TYPES);

/**
 * §4's grid rows as a database type, from the tuple `@mariva/shared` already
 * holds — the pattern `booking_state` and `cancellation_reason` set.
 *
 * `policy-charge.ts` was written for this column: "the rows of §4's grid, as the
 * thing a folio line at `M6` will say it is", and it explains why the amount
 * cannot stand in for the reason — a free cancellation and an early departure on
 * the final night both come to zero.
 */
export const chargeBasisEnum = pgEnum("charge_basis", CHARGE_BASES);

/**
 * One account per stay.
 *
 * The booking key is unique because `FR-FOL-01` says one folio per stay, and
 * because a second folio would split the balance the check-out guard reads: two
 * accounts each summing to zero is not the same claim as one, and the guard
 * would pass on whichever it happened to find.
 *
 * Nothing here is derived. There is no balance, no charge total and no payment
 * total — those are `sum(amount)` over the postings, which is the only figure
 * that cannot disagree with the ledger it came from.
 */
export const folio = pgTable(
  "folio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => booking.id)
      .unique(),
    state: folioStateEnum("state").notNull().default("OPEN"),
    // When the account was agreed. `FR-FOL-04` hangs the e-invoice off this
    // moment and §7's commission accrues at it, so it is an instant and not a
    // business date — the invoice is issued when the desk closed the folio.
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    // The provider's number for the invoice drawn on this account — the legal
    // reference, `FR-FOL-04`. Opaque: nothing above the adapter reads a serial,
    // a form code or a date out of it, for the reason `ports/e-invoice.port.ts`
    // gives.
    //
    // Null until the number comes back, and that null is doing work. Issuance
    // is not part of the close — a provider timeout must never roll back a
    // checkout — so `state = 'CLOSED' and invoice_reference is null` is exactly
    // the set of accounts still owed an invoice. That predicate is the queue,
    // which is why no table of pending invoices stands beside this column: a
    // second row saying the same thing is a second thing to keep true, and
    // `e-invoice.job.ts` argues the point where the work is done.
    invoiceReference: text("invoice_reference"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Both directions, the way `booking` states its own pairs. A closed folio
    // with no closing time cannot be invoiced or accrued against; a closing time
    // on an open one is a close somebody started and did not finish, and the
    // next reader cannot tell which half is true.
    check(
      "folio_closed_at_exactly_when_closed",
      sql`(${table.state} = 'CLOSED') = (${table.closedAt} is not null)`,
    ),
    // One direction only, unlike the pair above, and the asymmetry is the whole
    // of `FR-FOL-04`'s timing. An invoice on an open account is a document
    // drawn from lines that can still change, and there is no honest reading of
    // it. A closed account with no number yet is the ordinary state of every
    // folio between the desk agreeing it and the job coming back, which is
    // seconds on a good day and the following morning on a bad one.
    check(
      "folio_invoice_reference_only_when_closed",
      sql`${table.invoiceReference} is null or ${table.state} = 'CLOSED'`,
    ),
    // The issuing job's one question, asked on a schedule for as long as this
    // property runs: which agreed accounts are still owed an invoice? Partial,
    // so it holds the accounts still waiting and not the years of settled ones
    // behind them — a folio leaves this index for good the moment its number is
    // written, which is what keeps the scan proportional to the work rather
    // than to the property's history.
    index("folio_awaiting_invoice_idx")
      .on(table.closedAt)
      .where(sql`${table.state} = 'CLOSED' and ${table.invoiceReference} is null`),
  ],
);

/**
 * One line of the account, and it is never edited again.
 *
 * `postedAt` is an instant and `businessDate` is a date, and they are different
 * questions rather than two spellings of one. The instant is when the row was
 * written; the business date is the trading day it belongs to, which §2's
 * rollover hour decides and which `NFR-02`'s nightly check groups by. A charge
 * posted at 01:00 by the night audit belongs to the day that has not rolled yet.
 *
 * `postedBy` is null for a system posting — the night audit and the gateway's
 * IPN both write rows no person authored, and `staff_user` keeps a departed
 * receptionist precisely so the rows they did author stay attributable.
 */
export const folioPosting = pgTable(
  "folio_posting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folioId: uuid("folio_id")
      .notNull()
      .references(() => folio.id),
    type: postingTypeEnum("type").notNull(),
    // Signed whole đồng — `NFR-12` and §5. `mode: "bigint"` so the value that
    // comes back is the integer that went in: a folio read through `number`
    // would lose đồng above 2^53 silently, and silence is the failure mode this
    // whole file is arranged against.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    // What the guest reads on the invoice. Written at posting time rather than
    // resolved at print time, because the row it would be resolved from — a
    // catalog name, a room number — may be renamed afterwards, and an invoice is
    // a legal document that cannot quietly change its own wording.
    description: text("description").notNull(),
    // The line this one undoes. A self-reference, so a reversal is a row like
    // any other and the correction is itself part of the account. The key is
    // declared below rather than here, because it has to name the folio too.
    reversesPostingId: uuid("reverses_posting_id"),
    // The charge this line was levied on. `FR-FOL-02` splits one agreed gross
    // figure into a charge, a service charge and a tax line, and §5 requires all
    // three be shown separately rather than folded together — which leaves the
    // two derived lines with nothing recording what they were derived *from*.
    // This records it.
    //
    // A parent rather than a shared group id, because the three are not peers.
    // The charge is the sale; the other two are percentages levied on it, and
    // `decomposeGross` computes them in that direction. Naming the principal is
    // also what makes the biconditional below sayable at all — a group id could
    // not refuse a group consisting only of a VAT line, which is an amount with
    // no sale behind it.
    //
    // Reversal is the other reason. `FR-FOL-01` corrects a mistake with a
    // reversing entry, so undoing one room charge means reversing all three of
    // its lines; with this column that set is `id = $1 or parent_posting_id =
    // $1`, and without it the service would have to infer siblings from the
    // instant they happened to be written at.
    //
    // Like the column above it, the key is declared below and names the folio.
    parentPostingId: uuid("parent_posting_id"),
    // The catalog row a service line charged for — `FR-FOL-03`. The key is what
    // makes a sold item undeletable, which is why `service_catalog` withdraws an
    // item with `is_active` instead of removing it.
    serviceCatalogId: uuid("service_catalog_id").references(
      () => serviceCatalog.id,
    ),
    // Which row of §4's grid a policy charge is. Null on everything else.
    chargeBasis: chargeBasisEnum("charge_basis"),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    postedBy: uuid("posted_by").references(() => staffUser.id),
  },
  (table) => [
    // The balance query, which is every read of this table: sum the amounts of
    // one folio.
    index("folio_posting_folio_idx").on(table.folioId),
    // **Both self-references stay inside one account.** A key on `id` alone
    // would let a line name a posting on somebody else's folio, and neither
    // direction of that is survivable: a `VAT` line in guest B's account levied
    // on guest A's room charge is a tax nothing in B accounts for, and a
    // `REVERSAL` in B undoing a posting in A credits the wrong guest while the
    // mistake stands. Both rows would satisfy every check above — a check reads
    // one row and cannot ask what folio another belongs to — and the
    // append-only trigger means neither could ever be corrected, only
    // compensated. The comment on `parentPostingId` states the reversal set as
    // `id = $1 or parent_posting_id = $1`; without this, that query can return a
    // line from an account it was never asked about.
    //
    // Carrying `folio_id` into the key is what closes it, and it needs a unique
    // constraint on the pair to point at. `MATCH SIMPLE` is what makes the
    // nullable case still work: `folio_id` is never null, so when the reference
    // is null the constraint is skipped entirely, exactly as the single-column
    // key behaved. These replace the per-column keys rather than joining them —
    // each implies the one it replaced.
    unique("folio_posting_id_folio_key").on(table.id, table.folioId),
    foreignKey({
      name: "folio_posting_reverses_a_line_on_the_same_folio",
      columns: [table.reversesPostingId, table.folioId],
      foreignColumns: [table.id, table.folioId],
    }),
    foreignKey({
      name: "folio_posting_derives_from_a_line_on_the_same_folio",
      columns: [table.parentPostingId, table.folioId],
      foreignColumns: [table.id, table.folioId],
    }),
    // A posting is reversed at most once. Twice would credit the guest twice for
    // one mistake, and — because the correction is an insert rather than an edit
    // — nothing else would refuse the second row. Partial, because every
    // ordinary line leaves this column null and they do not collide with each
    // other.
    uniqueIndex("folio_posting_reversal_unique_key")
      .on(table.reversesPostingId)
      .where(sql`${table.reversesPostingId} is not null`),
    // Both directions. A `REVERSAL` naming nothing is a credit with no mistake
    // behind it; a line of any other type naming a posting is a reversal that
    // did not say so, and would escape the uniqueness above being about
    // reversals at all.
    check(
      "folio_posting_reverses_exactly_when_reversal",
      sql`(${table.type} = 'REVERSAL') = (${table.reversesPostingId} is not null)`,
    ),
    // With this, the reversal graph is provably acyclic. A longer cycle cannot
    // be built — the key requires the reversed row to exist first, so two rows
    // cannot each precede the other — and this refuses the one length the key
    // cannot: a row that reverses itself, which would net to zero and leave the
    // original mistake standing.
    check(
      "folio_posting_does_not_reverse_itself",
      sql`${table.reversesPostingId} is distinct from ${table.id}`,
    ),
    // Both directions, like the pair above it. A tax line with no charge behind
    // it is an amount nothing accounts for; a charge naming a parent is a sale
    // claiming to have been levied on another sale. The two members named here
    // are exactly the two `decomposeGross` returns beside the charge, which is
    // what makes the set closed rather than a list somebody will extend.
    //
    // What it does not say, and no reader should assume: this constrains the
    // *child*'s type and never the parent's. A `VAT` line naming another `VAT`
    // line, or naming a `PAYMENT`, satisfies it — a check reads one row, so the
    // parent's type is as far out of reach here as the parent's folio was
    // before the key above carried `folio_id` into it. The damage would be
    // quiet rather than arithmetic: the balance sums amounts and never reads
    // this column, so `NFR-02` holds exactly either way, and only the reversal
    // set goes wrong — `id = $1 or parent_posting_id = $1` misses a tax line
    // hung off the wrong row, leaving the guest owing tax on a sale that was
    // undone.
    //
    // Left open rather than closed because a check cannot close it, and not
    // because the set is unknown. The set is `ROOM_CHARGE` and `SERVICE_ITEM`:
    // §5 records the owner's decision that a charge under §4's grid carries no
    // VAT and no service charge, so a `POLICY_CHARGE` is a principal that never
    // has a derived line hung off it. Closing the parent's side is a trigger,
    // and it belongs to the service that writes the three lines together — the
    // same reason the grouping column above was not invented ahead of that
    // service either.
    check(
      "folio_posting_derives_exactly_when_a_tax_line",
      sql`(${table.type} in ('SERVICE_CHARGE_FEE', 'VAT')) = (${table.parentPostingId} is not null)`,
    ),
    // The same length-one cycle the reversal pair refuses, for the same reason.
    // A longer one the key already prevents — the parent must exist before the
    // child can name it — but a tax line that is its own principal would render
    // as a charge levied on itself.
    check(
      "folio_posting_does_not_derive_from_itself",
      sql`${table.parentPostingId} is distinct from ${table.id}`,
    ),
    // `FR-FOL-03` posts catalog items "with their tax class", and the class is
    // the catalog row's. A `SERVICE_ITEM` naming no row is a charge whose tax
    // class nothing can resolve; a catalog reference on a payment or a room
    // charge is a line claiming to be a sale it is not. Selling something new is
    // a catalog row, which §6 makes deliberately cheap — "items are data".
    check(
      "folio_posting_names_a_service_item_exactly_when_it_is_one",
      sql`(${table.type} = 'SERVICE_ITEM') = (${table.serviceCatalogId} is not null)`,
    ),
    // The same pair for §4. `NONE` is one of the grid's rows and not the absence
    // of one, so a free cancellation still posts a line that says which row it
    // was — that is the whole argument `policy-charge.ts` makes for the type
    // existing.
    check(
      "folio_posting_names_a_basis_exactly_when_a_policy_charge",
      sql`(${table.type} = 'POLICY_CHARGE') = (${table.chargeBasis} is not null)`,
    ),
    // The sign convention, enforced rather than remembered. A payment is money
    // in and reduces what is owed; everything that is not a payment or a
    // reversal adds to it, including a refund, which hands money back and so
    // undoes a payment. A reversal is exempt because its sign is whatever the
    // line it undoes was.
    //
    // Zero is legal on both sides, and not by oversight: `system_config` accepts
    // a VAT rate of zero — "a zero-rated or exempt supply is not a mistake" —
    // so the VAT line of a decomposition may honestly be nothing, and §4's
    // `NONE` row is a policy charge of nothing.
    check(
      "folio_posting_sign_matches_type",
      sql`case ${table.type}
        when 'PAYMENT' then ${table.amount} <= 0
        when 'REVERSAL' then true
        else ${table.amount} >= 0
      end`,
    ),
  ],
);

export type FolioRow = typeof folio.$inferSelect;
export type FolioPostingRow = typeof folioPosting.$inferSelect;
