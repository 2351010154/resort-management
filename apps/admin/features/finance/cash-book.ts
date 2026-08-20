/* The property's own money, as the console has to reason about it: who may keep
 * the book at all, which categories belong on which side, what an operator's
 * keystrokes parse to before any of it is sent, and which till a cash entry goes
 * through.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/shifts/shift-day.ts` and `features/payments/payment-day.ts` both
 * give: everything below is a judgement the API does not make for the console —
 * which roles are offered the screen, which drawers may still take cash, and
 * whether a typed figure is a quantity of đồng.
 *
 * Four rules hold throughout, and `cash-book.spec.ts` holds this file to them:
 *
 * 1. **The categories and their sides come from the contract.** `finance.ts`
 *    declares `INCOME_CATEGORIES` and `EXPENSE_CATEGORIES` and the database
 *    holds the same split as a `CHECK`; a list written out here would be a third
 *    opinion, and the first one to drift would offer an operator a pairing the
 *    table refuses after they had typed the amount.
 * 2. **Nothing here computes what a drawer should hold.** That is
 *    `features/shifts/shift-day.ts`'s one piece of arithmetic and it stays
 *    there — this feature's contribution to a variance is the entry it records,
 *    and the figure comes back on the shift.
 * 3. **Only an open drawer may be offered.** A counted drawer's variance stands
 *    on the count that closed it, and the API refuses cash against one; a picker
 *    that listed it would be offering a press that answers 409 with money
 *    already out of the till.
 * 4. **Who is offered the screen is decided from the matrix and never from a
 *    handler's answer.** `rbac-matrix.md`'s *Income / expense (thu chi)* row is
 *    `full` for the accountant and management and lists nobody else, and
 *    {@link mayKeepTheBook} is that row read literally. It is not a wall — the
 *    API's capability guard is the wall — and what it decides is whether the
 *    console offers somebody a control that would answer 403.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  CASH_BOOK_PAGE_SIZE,
  type CashBookCategory,
  type CashBookDirection,
  type CashBookMethod,
  categorySuitsDirection,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  LONGEST_CASH_BOOK_NOTE,
  type StaffRole,
} from "@mariva/shared";

import type { Shift } from "@/features/shifts";
import { parseLiberalDate } from "@/lib/date-parser";
import { parseAmount } from "@/lib/desk-payment";

/* The wire's shapes, read off the client rather than restated — the argument
 * every other feature in this console makes: `@mariva/shared` types the client
 * from the contract's own schemas, so a field renamed there breaks this file in
 * the pull request that renamed it, where a hand-written interface would compile
 * until it was wrong. */

/** A page of the book, what the filters matched, and the two side totals. */
export type CashBookPage = Awaited<
  ReturnType<ApiClient["finance"]["listCashBookEntries"]>
>;

/** One movement of the property's own money. */
export type CashBookEntry = CashBookPage["entries"][number];

/** What `GET /finance/entries` takes. */
export type CashBookQuery = Parameters<
  ApiClient["finance"]["listCashBookEntries"]
>[0];

/** What recording one takes. */
export type RecordEntry = Parameters<
  ApiClient["finance"]["recordCashBookEntry"]
>[0];

/** What correcting one takes. */
export type ReverseEntry = Parameters<
  ApiClient["finance"]["reverseCashBookEntry"]
>[0];

/**
 * Who may read and keep the property's cash book.
 *
 * The matrix's *Income / expense (thu chi)* row, which is `full` for
 * `ACCOUNTANT`, `MANAGER` and `ADMIN` and names nobody else. One predicate for
 * both the read and the writes, because the row grants one level to all three of
 * them — where the drawer's row needs two predicates precisely because it hands
 * the accountant a 👁 and the desk a `⚠`.
 *
 * **`RECEPTIONIST` is absent and that has a consequence worth knowing while
 * reading this file.** The person standing at the till may not record what came
 * out of it; a manager or the accountant does, and the receptionist sees it as
 * their drawer's expected figure moving. That is the matrix's decision rather
 * than this console's, and `rbac-matrix.md` is where it would be changed.
 */
export function mayKeepTheBook(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/**
 * The categories that may be booked on a side.
 *
 * Read off the contract's two lists rather than filtered out of one — the split
 * is the contract's fact and `categorySuitsDirection` is what the shape, the
 * handler and the database all agree through. A form that offered every category
 * on both sides would let somebody choose `SALARIES` as income and be refused
 * after typing the amount, and wages counted as money the property took is the
 * one mistake this column cannot survive.
 */
export function categoriesFor(
  direction: CashBookDirection,
): readonly CashBookCategory[] {
  return direction === "INCOME" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/** What each side of the book is called on screen. A `Record` over the union
 *  rather than a lookup with a fallback: a third direction added to the contract
 *  stops this file compiling, where a `?? direction` would print a database enum
 *  at an accountant. */
export const DIRECTION_LABELS: Record<CashBookDirection, string> = {
  INCOME: "Thu",
  EXPENSE: "Chi",
};

/** And how the money moved. Its own map rather than the desk's, which is a fact
 *  about how a *guest* paid: the two happen to hold the same two words today,
 *  and a shared map would mean a gateway added to the payment methods became a
 *  way of paying the cleaner. */
export const METHOD_LABELS: Record<CashBookMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
};

/**
 * What each category is called on screen, in both languages the desk uses.
 *
 * A `Record` over the union, so a category added to the contract stops this file
 * compiling rather than printing `TAXES_AND_FEES` at somebody. The Vietnamese is
 * beside the English because this is the one screen in the console whose readers
 * are the accountant and the owner, and *thu chi* is what they call the book —
 * `nav-inventory.ts` already carries the same pairing in its keywords.
 */
export const CATEGORY_LABELS: Record<CashBookCategory, string> = {
  SUPPLIES: "Supplies · vật tư",
  UTILITIES: "Utilities · điện nước",
  SALARIES: "Salaries · lương",
  MAINTENANCE: "Maintenance · sửa chữa",
  LAUNDRY: "Laundry · giặt là",
  MARKETING: "Marketing · tiếp thị",
  TRANSPORT: "Transport · vận chuyển",
  TAXES_AND_FEES: "Taxes and fees · thuế phí",
  VENUE_HIRE: "Venue hire · cho thuê mặt bằng",
  PARTNER_COMMISSION: "Partner commission · hoa hồng",
  ASSET_SALE: "Asset sale · thanh lý tài sản",
  SUPPLIER_REFUND: "Supplier refund · hoàn tiền nhà cung cấp",
  OTHER: "Other · khác",
};

/** Either a request the API will take, or the sentence that says why it is not
 *  one yet. The shape `lib/desk-payment.ts` uses, so a form built against either
 *  reads the same way. */
export type BookAttempt<T> =
  | { readonly input: T }
  | { readonly problem: string };

/** A drawer a cash entry may still be recorded against. */
export interface OpenDrawer {
  readonly id: string;
  readonly operatorName: string;
  readonly openingBusinessDate: string;
}

/**
 * The drawers that are still open, in the order the desk opened them.
 *
 * **Only the open ones, and that is rule three.** A drawer that has been counted
 * out takes no further cash — its variance stands on the count somebody signed —
 * and the API refuses the entry with a sentence saying so. Offering a closed
 * drawer here would be offering that refusal, after the money was already out of
 * the till.
 *
 * Built from the shift history the console already reads rather than from a
 * route of its own: no endpoint in this contract answers "which drawers are
 * open", and the history's own default page is the newest shifts, which is where
 * an open drawer necessarily is. A shift left open for a fortnight would fall off
 * that page, and that is a property somebody should be chasing rather than a
 * drawer to book cash into.
 *
 * Oldest first, so the list does not re-order itself under the reader when a
 * shift opens, with the id breaking a tie.
 */
export function openDrawersIn(shifts: readonly Shift[]): OpenDrawer[] {
  return shifts
    .filter((shift) => shift.closedAt === null)
    .sort(
      (left, right) =>
        left.openedAt.localeCompare(right.openedAt) ||
        left.id.localeCompare(right.id),
    )
    .map((shift) => ({
      id: shift.id,
      operatorName: shift.operatorName,
      openingBusinessDate: shift.openingBusinessDate,
    }));
}

/**
 * Which drawer a form opens on.
 *
 * Exactly one open drawer is the ordinary state of a small property and the one
 * case where a default is an answer rather than a guess — the money came out of
 * the only till there is. Two open drawers is a day shift and a night shift
 * overlapping, and picking one for the accountant would put đồng on the wrong
 * handover half the time; none at all is a property with no till open, which the
 * form says in words rather than resolving.
 */
export function theOnlyOpenDrawer(
  drawers: readonly OpenDrawer[],
): string | null {
  return drawers.length === 1 ? drawers[0]!.id : null;
}

/** What the operator typed into the recording form. */
export interface EntryFields {
  direction: CashBookDirection;
  category: CashBookCategory;
  method: CashBookMethod;
  /** As typed, in whatever grouping the operator reads off the screen. */
  amount: string;
  /** The trading day the money moved. Empty is the property's own day, which
   *  only the server knows. */
  businessDate: string;
  /** The till, on a cash entry. Empty on anything else. */
  shiftId: string;
  note: string;
}

/** The form the screen opens on: an expense in cash, which is what a property's
 *  cash book is mostly made of. The category is the first of that side's list. */
export const DEFAULT_ENTRY_FIELDS: EntryFields = {
  direction: "EXPENSE",
  category: "SUPPLIES",
  method: "CASH",
  amount: "",
  businessDate: "",
  shiftId: "",
  note: "",
};

/**
 * The fields, with the category kept on a side it may be booked on.
 *
 * Changing the direction changes which categories exist, and a form that left
 * `SALARIES` selected while the operator switched to income would submit a
 * pairing the database refuses. The first of the new side's list is chosen,
 * except where the one already selected is on both — `OTHER` is, and moving it
 * would be the form overwriting a choice that is still valid.
 *
 * The same is true of the drawer: a method that is no longer cash leaves a
 * `shiftId` behind that the contract refuses, so it is cleared with the method
 * rather than carried invisibly.
 */
export function onSide(
  fields: EntryFields,
  direction: CashBookDirection,
): EntryFields {
  return {
    ...fields,
    direction,
    category: categorySuitsDirection(fields.category, direction)
      ? fields.category
      : categoriesFor(direction)[0]!,
  };
}

/** The fields, with the drawer cleared where no drawer is wanted. */
export function byMethod(
  fields: EntryFields,
  method: CashBookMethod,
): EntryFields {
  return {
    ...fields,
    method,
    shiftId: method === "CASH" ? fields.shiftId : "",
  };
}

/**
 * The typed entry as a request the API will take, or the first thing wrong with
 * it.
 *
 * One refusal at a time, in the order the form reads, like every other form in
 * this console: a form with one message beside it is one thing to fix.
 *
 * **Zero is refused here, where a drawer count accepts it.**
 * `shift-day.ts`'s parser takes nothing as a fact about an emptied till; an
 * entry of nothing is not a movement of money at all, and the contract refuses
 * it. `lib/desk-payment.ts`'s parser already draws that line and is the one used
 * here.
 *
 * **The day is read against the property's business date and never the
 * browser's calendar** — "yesterday" typed at 01:30 means the trading day before
 * the one the desk is working. Left empty it travels absent, and the server
 * resolves it: a console that filled in its own answer would be a second opinion
 * about a question the property has already answered.
 */
export function entryAttempt(
  fields: EntryFields,
  businessDate: string | null,
): BookAttempt<RecordEntry> {
  const amount = parseAmount(fields.amount);

  if (amount === null) {
    return {
      problem:
        "Type the amount as a whole number of đồng, above nothing. Which way the money went is the side of the book, not a minus sign.",
    };
  }

  if (!categorySuitsDirection(fields.category, fields.direction)) {
    return {
      problem: `${CATEGORY_LABELS[fields.category]} is not booked as ${DIRECTION_LABELS[fields.direction].toLowerCase()}. A category belongs to one side of the book, so that the month reads.`,
    };
  }

  if (fields.method === "CASH" && fields.shiftId === "") {
    return {
      problem:
        "Cash moves through a till, so name the drawer it came out of or went into. Its count has to account for these đồng, or the operator signing for it is out by exactly this much.",
    };
  }

  const note = fields.note.trim();

  if (note === "") {
    return {
      problem:
        "Say what the money was for. The category says what kind of movement this was and only this says what it actually bought — and the book cannot be edited afterwards.",
    };
  }

  if (note.length > LONGEST_CASH_BOOK_NOTE) {
    return {
      problem: `That is ${note.length} characters and an entry stops at ${LONGEST_CASH_BOOK_NOTE}. An entry needing more than a line is usually two entries.`,
    };
  }

  const day = readDay(fields.businessDate, businessDate, "trading day");

  if ("problem" in day) {
    return day;
  }

  return {
    input: {
      direction: fields.direction,
      category: fields.category,
      method: fields.method,
      // Decimal text, per `money.ts`, because a JSON number would round a figure
      // in đồng that has no minor unit to round into.
      amount: amount.toString(),
      businessDate: day.day,
      shiftId: fields.method === "CASH" ? fields.shiftId : null,
      note,
    },
  };
}

/** What the operator typed into the correction. */
export interface ReversalFields {
  /** The till the đồng go back through, on a correction to a cash entry. */
  shiftId: string;
  /** Why. Required, because the book cannot be edited afterwards. */
  note: string;
}

/**
 * A correction as the API takes it, or the first thing wrong with it.
 *
 * **The drawer is the one that is open now, and never the entry's own.** The
 * original may have moved through a till counted out hours ago, and its variance
 * stands on that count; the money physically comes back through whichever drawer
 * is open, and that is the shift the correcting row binds to. The API refuses
 * the other reading, and this refuses it one layer earlier so the operator is
 * told while the panel is still on screen.
 */
export function reversalAttempt(
  entry: CashBookEntry,
  fields: ReversalFields,
): BookAttempt<ReverseEntry> {
  if (entry.method === "CASH" && fields.shiftId === "") {
    return {
      problem:
        "Undoing this puts đồng back in a till, so name the drawer that is open now — not the one the money came out of, whose count has already been signed for.",
    };
  }

  const note = fields.note.trim();

  if (note === "") {
    return {
      problem:
        "Say why this is being undone. A correction nobody explained is one an accountant cannot answer for months later, and the book is append-only.",
    };
  }

  if (note.length > LONGEST_CASH_BOOK_NOTE) {
    return {
      problem: `That is ${note.length} characters and an entry stops at ${LONGEST_CASH_BOOK_NOTE}.`,
    };
  }

  return {
    input: {
      entryId: entry.id,
      shiftId: entry.method === "CASH" ? fields.shiftId : null,
      note,
    },
  };
}

/** What the operator has typed into the book's filters. */
export interface BookFields {
  /** The first trading day of interest, as typed. Empty is no lower bound. */
  from: string;
  /** The last, inclusive. Empty is no upper bound. */
  to: string;
  /** One side of the book, or both. */
  direction: CashBookDirection | "";
  /** One category, or every one. */
  category: CashBookCategory | "";
  /** One way the money moved, or either. */
  method: CashBookMethod | "";
}

/** The filters the screen opens on: the most recent entries, everything. The
 *  route's own default page is about a month of a small property's spending,
 *  which is the stretch somebody opening this screen is asking about. */
export const DEFAULT_BOOK_FIELDS: BookFields = {
  from: "",
  to: "",
  direction: "",
  category: "",
  method: "",
};

export type BookQuestion =
  | { readonly query: CashBookQuery }
  | { readonly problem: string };

/**
 * The typed filters as a question the route will take, or the first thing wrong
 * with them.
 *
 * The days are read with the console's own liberal parser against the property's
 * business date, for the reason `shift-day.ts` gives about the same fields. The
 * order of the two ends is checked here as well as by the contract, so somebody
 * who typed them the wrong way round is told while the words are still in the
 * fields instead of after a round trip.
 *
 * An empty select is "every one" and travels as absent rather than as a member
 * nothing matches — which is what makes the opening question the whole book.
 */
export function bookQuestion(
  fields: BookFields,
  businessDate: string | null,
  offset: number,
): BookQuestion {
  const from = readDay(fields.from, businessDate, "first day of interest");

  if ("problem" in from) {
    return from;
  }

  const to = readDay(fields.to, businessDate, "last day of interest");

  if ("problem" in to) {
    return to;
  }

  if (from.day !== undefined && to.day !== undefined && from.day > to.day) {
    return {
      problem:
        "The last day of interest falls before the first. Both ends are inclusive, so a single day is that day typed into both.",
    };
  }

  return {
    query: {
      from: from.day,
      to: to.day,
      direction: fields.direction === "" ? undefined : fields.direction,
      category: fields.category === "" ? undefined : fields.category,
      method: fields.method === "" ? undefined : fields.method,
      limit: CASH_BOOK_PAGE_SIZE,
      offset,
    },
  };
}

/**
 * What the filtered book came to, net.
 *
 * The subtraction the page deliberately does not carry: `cashBookPageSchema`
 * sends the two sides gross, on the grounds that a single net figure would hide
 * a month that took eighty million and spent seventy-nine behind one that moved
 * nothing. The screen prints all three, and this is the one it computes — two
 * exact integers, which is the only arithmetic over money this feature does.
 */
export function netOfTheBook(page: {
  readonly incomeTotal: bigint;
  readonly expenseTotal: bigint;
}): bigint {
  return page.incomeTotal - page.expenseTotal;
}

/** One end of a range, read against the property's day. Absent is no bound
 *  rather than a refusal: a book with one end open is an ordinary question. */
function readDay(
  typed: string,
  businessDate: string | null,
  subject: string,
): { readonly day?: string } | { readonly problem: string } {
  if (typed.trim() === "") {
    return {};
  }

  if (businessDate === null) {
    return {
      problem:
        "The property's day has not been read yet, and a typed date is resolved against it rather than against this machine's calendar.",
    };
  }

  const day = parseLiberalDate(typed, businessDate);

  if (day === null) {
    return {
      problem: `The ${subject} could not be read. A trading day is written 2026-08-16, or 16/8, or today.`,
    };
  }

  return { day };
}
