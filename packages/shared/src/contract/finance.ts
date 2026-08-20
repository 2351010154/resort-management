// The property's own cash book over the wire — `FR-OPS-02`, *thu chi*.
//
// Three routes over one row of the RBAC matrix. `operations.income-expense` —
// "Income / expense (thu chi)" — carries all three at `full` for `ACCOUNTANT`,
// `MANAGER` and `ADMIN`, and grants nothing to anybody else. `RECEPTIONIST` is
// absent from that row, which has a consequence worth stating rather than
// discovering: **a manager or the accountant records the cash taken out of a
// receptionist's till, and the receptionist sees it only as their drawer's
// expected figure moving.** That is the matrix's decision and not this file's;
// `rbac-matrix.md` is where it would be changed.
//
// **Its own file rather than three more routes in `operations.ts`.** That file
// opens by naming itself the desk's working day and every shape in it belongs to
// one person's drawer or to the handover it leaves; both of its rows read
// `RECEPTIONIST: conditional`, and half its argument is about what "own shift"
// means on each act. This row denies a receptionist outright and is read by the
// accountant closing a month. Two audiences that far apart in one contract file
// is an invitation to reuse the wrong capability the next time a route is added,
// which is the boundary `business-date.ts` draws away from `system-config.ts`
// for the same reason. What the two files share is one field — `cashBookNet` on
// `shiftSchema` — and it is declared there, on the shift, because it is a fact
// about a drawer.
//
// **Nothing here posts to a folio and nothing here reads one.** `screens.md`:
// Finance is "strictly the money the folio system does not capture", and stay
// revenue "lives in Reports, computed from night-audit snapshots; showing it
// here too would invite double-counting the hotel's main income". So no route
// below names a booking, and no category names a night.
//
// **A cash entry names the drawer it moved through.** Money out of a till is
// money the count will not find, so it has to be in that shift's arithmetic or
// the desk cannot reconcile — `schema/shift.ts` and `schema/cash-book.ts` both
// state it. Unlike a payment, the shift cannot be "the caller's own open one":
// the person recording this is an accountant or a manager, who may hold no
// drawer at all. So the entry *names* a shift, the shape below refuses a cash
// entry that names none, and the handler refuses one naming a drawer that has
// been counted out — a counted drawer's variance stands on the count that closed
// it, which is the sentence `shift.service.ts` already throws at a second close.
//
// **The book is append-only and a mistake is reversed, never edited.** There is
// no update route and no delete route here, and the absence is the design:
// `schema/cash-book.ts` argues that an expense edited after the drawer it came
// out of was counted would move a variance somebody has already signed for. The
// reversal is a row of its own that names the row it undoes, so both stay in the
// book — the arrangement `folio.ts` uses for the ledger, for the same reason.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/**
 * How much one entry may say about itself, in characters.
 *
 * `LONGEST_PENDING_ITEM`'s figure and close to its argument: this is "hai thùng
 * nước suối, cửa hàng Minh Phát" or "lương tháng 8, ca buồng phòng", a line an
 * accountant reads back down a column of them months later. The category says
 * what kind of money it was and this says what it actually bought, which is a
 * sentence rather than a paragraph — an entry needing more than this is usually
 * two entries.
 */
export const LONGEST_CASH_BOOK_NOTE = 500;

/**
 * Which way the money went.
 *
 * The direction carries the sign, which is why the amount below is refused at or
 * below nothing: an expense sent as a negative income would be one movement
 * sayable two ways, and every sum over the book would have to decide which
 * spelling it believed.
 */
export const cashBookDirectionSchema = z.enum(["INCOME", "EXPENSE"]);

export type CashBookDirection = z.infer<typeof cashBookDirectionSchema>;

/**
 * How the money moved, and the only thing that decides whether a drawer is
 * involved.
 *
 * **Not `paymentMethodSchema`, though it holds both of these names.** That one
 * describes how a guest paid and carries `VNPAY` because `FR-PAY-01` commits to
 * one gateway; a salary is never a gateway transaction, and sharing the type
 * would mean the day a second gateway joins the payment enum it silently becomes
 * a way of paying the cleaner.
 */
export const cashBookMethodSchema = z.enum(["CASH", "BANK_TRANSFER"]);

export type CashBookMethod = z.infer<typeof cashBookMethodSchema>;

/**
 * What the property takes in that a folio never sees.
 *
 * Stay revenue is deliberately not a member: `screens.md` computes it from
 * night-audit snapshots in Reports, and a category for it here would invite the
 * property to count its main income twice.
 */
export const INCOME_CATEGORIES = [
  "VENUE_HIRE",
  "PARTNER_COMMISSION",
  "ASSET_SALE",
  "SUPPLIER_REFUND",
  "OTHER",
] as const;

/** What the property spends on. `screens.md` names the first three — supplies,
 *  utilities and salaries — and the rest are what a small resort actually
 *  writes cheques for. */
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
 * Every category, either side.
 *
 * **An enum and not a table, so a new category is a migration.** `FR-OPS-02`
 * asks for "income/expense with categories" and asks nothing about editing them,
 * which is the whole of the difference from `FR-IDN-03`'s tax values: a VAT rate
 * that takes a deploy to change is a rate the property cannot legally charge,
 * and nothing of the kind is true of the difference between *vật tư* and *sửa
 * chữa*. `screens.md` sets the house style for this exact case where it refuses
 * a report builder — "the requirements enumerate exactly what is needed".
 *
 * A migration for a new category is acceptable because the property adds one
 * roughly never, and the cost of the alternative is paid the other way: a set
 * anybody can extend at the desk becomes forty categories, half of them
 * synonyms, and a month's report nobody can read.
 *
 * `OTHER` is on both sides, and it is what makes the rest honest. Money moves
 * for reasons a fixed list does not hold, and the alternative to an admitted
 * `OTHER` is not a migration — it is a parking fine filed under `SUPPLIES`,
 * which is wrong where nobody can see it. A month with a large `OTHER` is the
 * property's own signal that the list needs a member.
 */
export const CASH_BOOK_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  "VENUE_HIRE",
  "PARTNER_COMMISSION",
  "ASSET_SALE",
  "SUPPLIER_REFUND",
] as const;

export const cashBookCategorySchema = z.enum(CASH_BOOK_CATEGORIES);

export type CashBookCategory = z.infer<typeof cashBookCategorySchema>;

/**
 * Whether a category may be booked on a side.
 *
 * Declared once and read by the shape below, the handler and the console, so
 * there is one answer to "may this pair be recorded" rather than three that have
 * to be kept agreeing. The database holds the same rule as
 * `cash_book_entry_direction_suits_its_category`, which is the wall; this is
 * what makes the refusal a sentence somebody can act on instead of a fault.
 *
 * `SALARIES` as income is not a rare event to be reported but a typo, and one
 * that would show wages as money the property took — in the one column an
 * accountant reads a month by.
 */
export function categorySuitsDirection(
  category: CashBookCategory,
  direction: CashBookDirection,
): boolean {
  const permitted: readonly string[] =
    direction === "INCOME" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return permitted.includes(category);
}

/**
 * One movement of the property's own money, as anything that reads the book
 * sees it.
 *
 * `shiftId` is not null on exactly the `CASH` entries —
 * `cash_book_entry_shift_binding` is the database refusing every row where the
 * two disagree — so a reader may branch on either and get the same answer. That
 * is `shiftSchema`'s arrangement for its own nullables and its reason: the
 * alternative is a union with a member the handler can never return.
 *
 * `recordedByName` travels beside the id because no route in this contract turns
 * a staff id into a person, and a book of who spent the property's money is not
 * readable as a column of uuids — `shiftSchema` carries `operatorName` for the
 * same reason.
 *
 * **`reversedByEntryId` is derived and is the only state an entry has.** The
 * book is append-only, so "has this been corrected" is not a column somebody
 * sets but whether another row names it; carrying the answer here is what lets a
 * screen decline to offer the correction twice, without asking a second
 * question. It is null on the ordinary entry and on every reversal — a reversal
 * is not itself reversed, and the handler says so.
 */
export const cashBookEntrySchema = z.object({
  id: z.uuid(),
  direction: cashBookDirectionSchema,
  category: cashBookCategorySchema,
  method: cashBookMethodSchema,
  /** Always above nothing. The direction carries the sign. */
  amount: vndAmountSchema,
  /** The trading day the money moved, in the property's own rollover. */
  businessDate: isoStayDateSchema,
  /** The drawer it passed through. Null on exactly the entries that touched none. */
  shiftId: z.uuid().nullable(),
  /** What it was for, in the words of whoever recorded it. Never empty. */
  note: z.string(),
  recordedById: z.uuid(),
  /** Who the property holds answerable, in the name it employs them under. */
  recordedByName: z.string(),
  recordedAt: z.iso.datetime(),
  /** The entry this one undoes. Null on everything that is not a correction. */
  reversesEntryId: z.uuid().nullable(),
  /** The correction that undid this one. Null while it still stands. */
  reversedByEntryId: z.uuid().nullable(),
});

/**
 * Recording a movement: what it was, how much, which day, and — where đồng
 * physically moved — which drawer.
 *
 * **The two invariants that can be said in a shape are said here.** A cash entry
 * names a drawer and nothing else may; a category belongs to a side. Both are
 * `CHECK` constraints on the table as well, and this is not the same rule
 * written twice for the sake of it: the database is the wall and refuses every
 * caller, and these two turn the wall's fault into a sentence the person who
 * typed it can act on while the words are still on screen. `openShiftInput`
 * makes the same trade for its own figure.
 *
 * **The business date is optional and means the property's current trading
 * day.** Naming one is how an accountant files Friday's transfer on Monday, and
 * the rollover means the answer is never the browser's calendar — which is why
 * an absent one is resolved on the server rather than defaulted here. A day
 * ahead of the property's own is refused by the handler: money that has not
 * moved is not an entry.
 *
 * **No recorder and no instant.** Who recorded this is the session's, which the
 * handler already knows and a caller could only get wrong; the instant is the
 * clock's. A body carrying either would be an entry attributed to somebody who
 * did not make it, or backdated by the person who did.
 */
export const recordCashBookEntryInput = z
  .object({
    direction: cashBookDirectionSchema,
    category: cashBookCategorySchema,
    method: cashBookMethodSchema,
    amount: vndAmountInputSchema.refine(
      (amount) => amount > 0n,
      "an entry records a quantity of đồng, and the direction says which way it went",
    ),
    businessDate: stayDateSchema.optional(),
    /** Required on cash and refused on anything else — the refinements below. */
    shiftId: z.uuid().nullish(),
    note: z.string().trim().min(1).max(LONGEST_CASH_BOOK_NOTE),
  })
  .refine((entry) => categorySuitsDirection(entry.category, entry.direction), {
    message: "that category is not booked on that side of the book",
    path: ["category"],
  })
  .refine((entry) => (entry.method === "CASH") === (entry.shiftId != null), {
    message:
      "cash names the drawer it moved through, and nothing else may — money out of a till has to be in that shift's count",
    path: ["shiftId"],
  });

/**
 * Undoing one: the entry, why, and — where the đồng go back into a till — which
 * drawer they go back into.
 *
 * **No amount, no category and no direction.** Every one of them is the reversed
 * entry's own, read by the handler from the row: a caller able to send them
 * would be recording a second, unrelated movement while calling it a correction,
 * and the two would not net to nothing. `reversePostingInput` names only the
 * line for the same reason.
 *
 * **The drawer is named again rather than inherited.** The original may have
 * moved through a till that was counted out hours ago, and its variance stands
 * on that count — so the money physically comes back through whichever drawer is
 * open now, and that is the shift this row binds to. Inheriting the original's
 * would put đồng into a handover somebody has already signed for, which is the
 * one thing this table is arranged to prevent. It is nullish here because
 * whether a drawer is wanted at all depends on the reversed entry's method,
 * which this shape cannot see; the handler refuses the mismatch with a sentence.
 *
 * The reason is required and has no default. A correction with no account of
 * why is one an accountant cannot answer for months later, and the book is
 * append-only — the explanation cannot be added afterwards. It is the same
 * requirement `postOverrideRefundInput` puts on a discretionary refund.
 */
export const reverseCashBookEntryInput = z.object({
  entryId: z.uuid(),
  shiftId: z.uuid().nullish(),
  note: z.string().trim().min(1).max(LONGEST_CASH_BOOK_NOTE),
});

/**
 * The most entries one page will answer with.
 *
 * `LONGEST_SHIFT_PAGE`'s figure and its argument: this is a book somebody reads
 * rather than a search, so the tail is reached by `offset` instead of the caller
 * being told to ask a narrower question.
 */
export const LONGEST_CASH_BOOK_PAGE = 200;

/** The page a caller gets for not naming one. About a month of a small
 *  property's own spending. */
export const CASH_BOOK_PAGE_SIZE = 50;

/**
 * Which entries to read back — a span of trading days, a side, a category, a
 * method, or any combination.
 *
 * **The days are `businessDate` and not `recordedAt`**, because that column is
 * the whole reason the date is stored: an accountant recording Friday's transfer
 * on Monday has filed it under Friday, and a month cut on the instant would
 * report it in the wrong one. Both ends are inclusive and each is optional on
 * its own, like `listShiftHistoryInput`.
 *
 * Nothing here narrows by who recorded an entry. The row that governs this
 * contract is `full` for all three roles that hold it, so there is no scope for
 * a filter to be confused with — and "who spent this" is a question the change
 * log answers across every table at once, which is what `FR-AUD-02` is for.
 */
export const listCashBookEntriesInput = z
  .object({
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
    direction: cashBookDirectionSchema.optional(),
    category: cashBookCategorySchema.optional(),
    method: cashBookMethodSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LONGEST_CASH_BOOK_PAGE)
      .default(CASH_BOOK_PAGE_SIZE),
    // Rows to skip, not a page number — `folio.ts` says why, and the order this
    // route promises is total for the same reason: latest trading day first,
    // then the most recently recorded, with the id breaking a tie, so a caller
    // stepping by `limit` sees each entry once.
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (query) => !query.from || !query.to || query.from.compare(query.to) <= 0,
    { message: "to must not fall before from", path: ["to"] },
  );

/**
 * A page of the book, what the filters matched behind it, and what those matches
 * came to on each side.
 *
 * **The two sums are the reason a page of a cash book is not just a page.** What
 * an accountant opens this screen to ask is what the property took and spent
 * over a stretch of days, and a total assembled from the rows on screen would
 * answer it for the first fifty and be silently wrong for every page after. Both
 * are counted under the same predicate the page was cut from, on every read —
 * `folioPageSchema`'s argument for `total`, applied to the two figures the
 * screen actually prints.
 *
 * They are gross and not netted against each other. Which way the property is
 * running is a subtraction the reader can do; a single net figure would hide a
 * month that took eighty million and spent seventy-nine behind one that moved
 * nothing at all.
 *
 * Reversals are ordinary rows and are counted in both figures like any other:
 * an expense of two hundred thousand and the correction that undid it appear as
 * two hundred thousand out and two hundred thousand in, which is what the book
 * says and what a reader checking it against a bank statement needs to see.
 */
export const cashBookPageSchema = z.object({
  entries: z.array(cashBookEntrySchema),
  total: z.number().int().min(0),
  /** Everything the filters matched on the income side, added up. */
  incomeTotal: vndAmountSchema,
  /** And on the expense side. Also above nothing — the sides are separate. */
  expenseTotal: vndAmountSchema,
});

export const finance = {
  recordCashBookEntry: oc
    // POST to a collection, because an entry is a thing the property has many of
    // and today's electricity bill is not an edit of last month's. Two presses
    // honestly make two entries: money moving twice is two movements, and the
    // book is where the property finds out.
    .route({ method: "POST", path: "/finance/entries" })
    .input(recordCashBookEntryInput)
    .output(cashBookEntrySchema),

  reverseCashBookEntry: oc
    // A nominalised act on the member, the way `folio.ts` spells `/reversals`:
    // it happens to an entry at most once, and a second attempt is refused by
    // `cash_book_entry_reversal_unique_key` rather than appended. The answer is
    // the correcting entry itself — the row that was created, not the row that
    // was corrected, because that one has not changed and by design cannot.
    .route({ method: "POST", path: "/finance/entries/{entryId}/reversal" })
    .input(reverseCashBookEntryInput)
    .output(cashBookEntrySchema),

  listCashBookEntries: oc
    // The collection itself, with the narrowing in the query string, so a month
    // of the book is a link an accountant can keep rather than a procedure. No
    // member route beside it: nothing in `screens.md` opens one entry on its
    // own, and the row already carries everything the book draws.
    .route({ method: "GET", path: "/finance/entries" })
    .input(listCashBookEntriesInput)
    .output(cashBookPageSchema),
};
