// The property's own cash book — categorised income and expense, `FR-OPS-02`.
//
// `screens.md` draws this boundary and it is narrow on purpose: Finance is
// "strictly the money the folio system does not capture — categorised income and
// expense such as supplies, utilities and salaries", and stay revenue "lives in
// Reports, computed from night-audit snapshots". So nothing here posts to a
// folio, nothing here reads one, and no row below is a guest's. This is the
// book the property keeps about itself, beside the ledger it keeps about its
// guests, and the two never meet.
//
// **An entry is a fact, not a state, so the table is append-only.** `0011` makes
// the argument for the folio ledger and it lands harder here, because the figure
// a drawer was counted against is computed from these rows: an expense edited
// after a shift was counted out would move a variance somebody has already
// signed for and reported, with nothing anywhere saying it moved. The refusal is
// a trigger rather than a service rule for the reason that file gives — a rule
// in a service holds for its own callers and for nobody else — and a mistake is
// corrected by a reversing entry that names the row it undoes, which leaves both
// the mistake and the correction in the book.
//
// **A cash entry belongs to a drawer.** Money physically leaving or entering a
// till has to be in that shift's arithmetic or the desk cannot reconcile:
// `shift.ts` says the variance is the opening float plus the cash bound to the
// shift held against the count, and đồng taken out of the till for a delivery of
// bottled water is đồng the count will not find. So a `CASH` entry names the
// shift it moved through and nothing else may — the biconditional below, which
// is `payment_shift_binding`'s arrangement for the same reason. A salary paid by
// bank transfer never touches a drawer and must not move one.
//
// **The drawer's sum is keyed on `shift_id` and never on `business_date`.** The
// two can differ — an accountant records Friday's transfer on Monday, and the
// column is which trading day the money moved rather than which day somebody
// typed it — and keying the arithmetic on the shift is what makes them unable to
// disagree. A closed drawer's figure is a sum over rows that can no longer
// change, which is the whole of what "reproducible" means here.
//
// **`recorded_by` is `NOT NULL` and there is no `system` case.** Every other
// nullable actor column in this schema is nullable because something without a
// person behind it writes rows — a gateway callback, a nightly sweep, the
// seeder. Nothing writes a cash-book entry except a member of staff standing in
// front of the money, and `rbac-matrix.md` grants the row to three staff roles
// and to no realm at all besides. A placeholder account would make an entry
// nobody is answerable for indistinguishable from one somebody is.
//
// What is deliberately *not* here:
//
// - **A running balance, or a total per category.** Both are sums over these
//   rows, and `payment_reconciliation_run` argues why a total written down is
//   correct at the instant it was frozen while a total computed is correct at
//   the instant it is asked. A stored balance would stop tracking its own
//   reversals the first time somebody forgot to recompute it.
// - **A supplier, an invoice number or an attachment.** `FR-OPS-02` asks for
//   income and expense with categories; a vendor table is a purchase ledger, and
//   what the property actually needs recorded about a delivery fits in the note
//   the entry already carries.
// - **A `state` column.** An entry is either reversed or it is not, and that is
//   whether another row names it. A column beside that would be a second answer
//   to the same question for the two to disagree from.

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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./identity.js";
import { shift } from "./shift.js";

/**
 * Which way the money went.
 *
 * Two members and no third, because a cash book has exactly two sides. The
 * direction carries the sign, which is why {@link cashBookEntry}'s amount is
 * refused at or below nothing: an expense stored as a negative income would be
 * the same movement sayable two ways, and every sum over the book would have to
 * decide which spelling it believed.
 */
export const CASH_BOOK_DIRECTIONS = ["INCOME", "EXPENSE"] as const;

export const cashBookDirectionEnum = pgEnum(
  "cash_book_direction",
  CASH_BOOK_DIRECTIONS,
);

/**
 * How the money moved, and the only thing that decides whether a drawer is
 * involved.
 *
 * **Not `payment_method`, though it holds two of these three names.** That enum
 * describes how a *guest* paid and carries `VNPAY` because `FR-PAY-01` commits
 * to one gateway; a salary or an electricity bill is never a gateway
 * transaction, and sharing the type would mean the day a second gateway joins
 * the payment enum it silently becomes a way of paying the cleaner. Two enums
 * that happen to share two member names are two facts about two different kinds
 * of money.
 */
export const CASH_BOOK_METHODS = ["CASH", "BANK_TRANSFER"] as const;

export const cashBookMethodEnum = pgEnum("cash_book_method", CASH_BOOK_METHODS);

/**
 * What the property spends on. `screens.md` names the first three.
 *
 * **An enum and not a table, so a new category is a migration.** `FR-OPS-02`
 * asks for "income/expense with categories" and asks nothing about editing them,
 * which is the whole of the difference from the tax values in `FR-IDN-03`: those
 * are a row an `ADMIN` edits because a rate that takes a deploy to change is a
 * rate the property cannot legally charge, and nothing of the kind is true of
 * the difference between *vật tư* and *sửa chữa*. `screens.md` sets the house
 * style for exactly this case where it refuses a report builder — "the
 * requirements enumerate exactly what is needed". A category table would also
 * bring the questions a table brings and this requirement never asks: who may
 * add one, what happens to the entries under one somebody deleted, and whether
 * two people may create *Điện nước* twice.
 *
 * A migration for a new category is acceptable because the property adds one
 * roughly never, and because the cost of getting it wrong is borne the other
 * way: a set anybody can extend at the desk becomes forty categories, half of
 * them synonyms, and a month's report nobody can read.
 *
 * `OTHER` is on both sides and is the pressure valve that makes the rest of this
 * honest. Money genuinely moves for reasons a fixed list does not hold, and the
 * alternative to an honest `OTHER` is not a migration — it is a receptionist
 * filing a parking fine under `SUPPLIES`, which is worse, because it is wrong
 * where nobody can see it. A month with a large `OTHER` in it is the property's
 * own signal that the list needs a member.
 */
export const CASH_BOOK_CATEGORIES = [
  // Expense. The first three are the ones `screens.md` names; the rest are what
  // a small resort actually writes cheques for.
  "SUPPLIES",
  "UTILITIES",
  "SALARIES",
  "MAINTENANCE",
  "LAUNDRY",
  "MARKETING",
  "TRANSPORT",
  "TAXES_AND_FEES",
  // Income the folio does not capture. Stay revenue is deliberately absent —
  // `screens.md` puts it in Reports, computed from night-audit snapshots, and a
  // category for it here would invite the property to count its main income
  // twice.
  "VENUE_HIRE",
  "PARTNER_COMMISSION",
  "ASSET_SALE",
  "SUPPLIER_REFUND",
  // Either side.
  "OTHER",
] as const;

export const cashBookCategoryEnum = pgEnum(
  "cash_book_category",
  CASH_BOOK_CATEGORIES,
);

/**
 * Which categories are money coming in.
 *
 * Named here rather than only in the check constraint below, because the
 * contract and the console both need the same split — the recording form offers
 * the categories that suit the direction, and a second hand-written list would
 * eventually offer one the database refuses.
 */
export const INCOME_CATEGORIES = [
  "VENUE_HIRE",
  "PARTNER_COMMISSION",
  "ASSET_SALE",
  "SUPPLIER_REFUND",
  "OTHER",
] as const;

/** Which categories are money going out. `OTHER` is in both, and the docblock
 *  on {@link CASH_BOOK_CATEGORIES} says why it has to be. */
export const EXPENSE_CATEGORIES = [
  "SUPPLIES",
  "UTILITIES",
  "SALARIES",
  "MAINTENANCE",
  "LAUNDRY",
  "MARKETING",
  "TRANSPORT",
  "TAXES_AND_FEES",
  "OTHER",
] as const;

/**
 * One movement of the property's own money.
 *
 * `note` is `NOT NULL` and refused empty, which is `pending_item.description`'s
 * rule and its reason: a category says what kind of money this was and only the
 * note says what it actually bought. An accountant reading back a month of
 * `SUPPLIES` at three hundred thousand đồng each has, without it, a column of
 * figures and no account of any of them — and the table is append-only, so the
 * explanation cannot be added afterwards.
 *
 * `business_date` is the trading day the money moved and is not derived from
 * `recorded_at`. The property's rollover means a night entry belongs to the day
 * before, which is `shift.opening_business_date`'s argument, and an accountant
 * recording Friday's transfer on Monday is filing it under Friday. Which day a
 * row is filed under is therefore an answer the server resolves or the caller
 * states, never one a reader computes from the instant.
 */
export const cashBookEntry = pgTable(
  "cash_book_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: cashBookDirectionEnum("direction").notNull(),
    category: cashBookCategoryEnum("category").notNull(),
    method: cashBookMethodEnum("method").notNull(),
    // Whole đồng, always above nothing — `NFR-12`, and `mode: "bigint"` for the
    // reason every money column in this schema carries it: a figure routed
    // through `number` loses đồng in silence above 2^53, and a cash book that is
    // out by one puts a drawer out by one with nothing to trace it to.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    // The trading day the money moved, in the property's own rollover. Stored
    // rather than derived, for the reason the docblock gives.
    businessDate: date("business_date", { mode: "string" }).notNull(),
    // The till this passed through. Null on exactly the entries that touched no
    // till, which the check below makes the same set as the non-cash ones.
    shiftId: uuid("shift_id").references(() => shift.id),
    // What it was for, in the words of whoever recorded it.
    note: text("note").notNull(),
    // The member of staff answerable for the entry. `FR-AUD-01`'s question
    // about every đồng, answered on the row as well as in the change log — the
    // log says who wrote it and this says who the property holds to it, and the
    // screen prints the second without reading the first.
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => staffUser.id),
    // The entry this one undoes. A self-reference, so a correction is a row like
    // any other and is itself part of the book. The key is declared below rather
    // than here, so it can be named after what it means.
    reversesEntryId: uuid("reverses_entry_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "cash_book_entry_reverses_an_entry",
      columns: [table.reversesEntryId],
      foreignColumns: [table.id],
    }),
    // An entry is reversed at most once. Twice would take the same money back
    // out of the book twice, and — because a correction is an insert rather than
    // an edit — nothing else would refuse the second row. Partial, because every
    // ordinary entry leaves this column null and they do not collide.
    uniqueIndex("cash_book_entry_reversal_unique_key")
      .on(table.reversesEntryId)
      .where(sql`${table.reversesEntryId} is not null`),
    // "What did the property take and spend over these days" — the screen's own
    // question, and the range every report of this book is cut on.
    index("cash_book_entry_business_date_idx").on(table.businessDate),
    // "What moved through this drawer" — the sum a shift's expected cash is
    // computed with. Partial, because a bank transfer names no drawer and no
    // query ever looks for the entries that do not: the index stays the size of
    // the cash that passed through tills rather than the size of the book.
    index("cash_book_entry_shift_idx")
      .on(table.shiftId)
      .where(sql`${table.shiftId} is not null`),
    // Above nothing, because the direction carries the sign. A negative expense
    // is an income spelled the other way round, and a book that admitted both
    // spellings would need every sum over it to decide which one it believed.
    check("cash_book_entry_amount_is_a_quantity", sql`${table.amount} > 0`),
    // Cash names a drawer and nothing else may — `payment_shift_binding`'s
    // biconditional, for the same reason. Half of it would let a salary paid by
    // transfer move a receptionist's variance; the other half would let đồng out
    // of the till belong to no handover at all.
    check(
      "cash_book_entry_shift_binding",
      sql`(${table.method} = 'CASH') = (${table.shiftId} is not null)`,
    ),
    // A category belongs to a side. `SALARIES` as income is not a rare event to
    // be reported, it is a typo — and one that would show wages as money the
    // property took, in the one column an accountant reads a month by. The lists
    // are the two constants above, written out here because a check constraint
    // is text Postgres stores and cannot import them.
    //
    // **A correction is exempt, and it has to be.** Its side is the opposite of
    // the row it undoes, by construction rather than by choice, and its category
    // is that row's — an expense on `SUPPLIES` is undone by income on
    // `SUPPLIES`, which is precisely the pairing the rule refuses. Giving the
    // correction some neutral category instead would be worse than the
    // exemption: the column an accountant reads a month by would show three
    // hundred thousand đồng of supplies that were never bought, with the money
    // coming back somewhere else entirely. So the rule is about which side a
    // *movement* may be chosen on, and a correction chooses neither.
    check(
      "cash_book_entry_direction_suits_its_category",
      sql`(
        ${table.reversesEntryId} is not null
      ) or (
        ${table.direction} = 'INCOME'
        and ${table.category} in ('VENUE_HIRE', 'PARTNER_COMMISSION', 'ASSET_SALE', 'SUPPLIER_REFUND', 'OTHER')
      ) or (
        ${table.direction} = 'EXPENSE'
        and ${table.category} in ('SUPPLIES', 'UTILITIES', 'SALARIES', 'MAINTENANCE', 'LAUNDRY', 'MARKETING', 'TRANSPORT', 'TAXES_AND_FEES', 'OTHER')
      )`,
    ),
    // A note of two spaces satisfies `NOT NULL` and says nothing, which is the
    // one thing this column exists to prevent.
    check(
      "cash_book_entry_note_says_something",
      sql`btrim(${table.note}) <> ''`,
    ),
    // The one cycle the foreign key cannot refuse: a row that reverses itself,
    // which nets to zero and leaves the original mistake standing. Longer cycles
    // are impossible already — the key requires the reversed row to exist first,
    // so two rows cannot each precede the other.
    check(
      "cash_book_entry_does_not_reverse_itself",
      sql`${table.reversesEntryId} is distinct from ${table.id}`,
    ),
  ],
);

export type CashBookEntryRow = typeof cashBookEntry.$inferSelect;
export type CashBookDirection = (typeof CASH_BOOK_DIRECTIONS)[number];
export type CashBookCategory = (typeof CASH_BOOK_CATEGORIES)[number];
export type CashBookMethod = (typeof CASH_BOOK_METHODS)[number];
