// The desk's working day over the wire — `FR-OPS-01`. Who has the drawer open,
// what was counted into it and out of it, what the variance came to, and what
// the next person still has to be told.
//
// Seven routes over two rows of the RBAC matrix, and no route here the matrix
// does not already govern: `operations.cash-drawer` — "Cash drawer open / close
// / count" — carries the four shift routes, and `operations.shift-handover` —
// "Shift handover notes" — carries the three pending-item ones. Both rows read
// `RECEPTIONIST: conditional` with the note "RCP: own shift", and that word is
// the whole of the scoping the requirement asks for. It is enforced by the
// handler, which knows who is calling; what the shapes below can do is make the
// out-of-scope act unsayable where saying it costs nothing, and they do that
// wherever a receptionist's own shift is the only shift the act could be about.
//
// **The variance is computed here and never submitted.** `schema/shift.ts`
// refuses the column in as many words — it is the opening float plus the cash
// bound to the shift, held against the count — and a route that took the figure
// from its caller would be worse than the column: the drawer would report
// whatever the person closing it typed. So the close takes the count and the
// note, and the variance comes back on the answer. Nothing in this file accepts
// a variance, and every shape that carries one derives it.
//
// **Nor does the caller say what a shift is worth so far, or which day it is
// on.** `cashTaken` is the sum of the `CASH` payments bound to the shift —
// `payment.shift_id`, which `schema/payment.ts` makes mandatory on exactly that
// method — and the opening business date is the property's rollover applied to
// the clock, which `business-date.ts` argues at length must be resolved once, on
// the server. A console computing either would be a second answer to a question
// the property has already answered.
//
// **The current shift and the history are two routes because they are two
// questions.** `screens.md` draws the line: the shift a receptionist is on lives
// in the shell's top bar and is opened, counted and closed from the command
// palette on whatever screen they are already working; the Shifts screen is the
// history — past shifts, variances, handover notes — read by managers and the
// accountant. So one route answers "am I on a drawer, and what is in it" with no
// input at all, and the other ranges over days and operators and pages.
//
// **Pending items are their own collection and not a sub-resource of a shift.**
// The point of the table is that an item outlives the shift that found it:
// raised by one, inherited by the next, resolved by whichever finally deals with
// it. `/shifts/{id}/pending-items` would address the backlog by the shift that
// is least interesting about it — the one it is no longer the problem of — and
// the question the incoming shift actually asks ("what is still outstanding")
// names no shift at all.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { vndAmountInputSchema, vndAmountSchema } from "../money.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/**
 * How much a shift may leave the next one, in characters.
 *
 * Bounded on `LONGEST_FEEDBACK_COMMENT`'s argument, and this box is read under
 * more pressure than that one: it is the first thing somebody taking the desk
 * reads, and a note long enough to scroll is a note that gets skimmed. Generous
 * enough for the several sentences a bad night actually produces — the parts of
 * a handover that have a shape of their own are pending items, and they are rows
 * rather than prose.
 */
export const LONGEST_HANDOVER_NOTE = 2000;

/**
 * How much one outstanding item may say.
 *
 * Shorter than the note above because it is a different kind of sentence: "305
 * deposit not receipted", "spare key with the manager". An item that needs a
 * paragraph is a handover note, and an item nobody can read at a glance does not
 * get picked up by the shift that inherits it.
 */
export const LONGEST_PENDING_ITEM = 500;

/**
 * A shift as anything that reads one sees it — the drawer, the day, and what the
 * count came to.
 *
 * **The nullable fields are one fact in three columns, and they move together.**
 * `closingCount` and `closedAt` are null on exactly the shift that is still
 * open — `shift_closed_exactly_when_counted` is the database refusing every row
 * where they disagree — and `variance` is null on exactly the same rows, because
 * a drawer nobody has counted has nothing to be out by. A reader may branch on
 * any one of them and get the same answer, which is the arrangement
 * `listedPaymentSchema` uses for its own nullables and for the same reason: the
 * alternative is a union with a member the handler can never return.
 *
 * `cashTaken` is not nullable and travels on the open shift too. It is the money
 * the drawer should have gained so far, which is precisely the figure somebody
 * about to count it needs — a shift is counted before it is closed, and a field
 * that only appeared afterwards would arrive one act too late.
 *
 * `cashBookNet` is the property's own money moving through the same till —
 * `FR-OPS-02`, and `finance.ts` holds the routes that write it. It is a second
 * field rather than more đồng folded into `cashTaken` because the two are
 * different facts about the drawer and the desk reads them differently: one is
 * what guests paid in, the other is what the property took out for a delivery or
 * put in from a hire, and a single figure would leave a receptionist unable to
 * tell a shortfall from an errand. Signed, and the only figure here that
 * ordinarily is — a shift that spent more from the till than it took into it
 * nets below nothing, which is the usual shape of a day.
 *
 * **`variance` is the count less what was expected**, expected being
 * `openingFloat + cashTaken + cashBookNet`. Positive is a drawer with more đồng
 * in it than the property can account for and negative is one that is short;
 * both are wrong, and the sign says which way, which is the first thing a
 * manager asks. The expected figure itself is not restated: all three of its
 * terms are on this object, and the sum of exact integers is not somewhere a
 * figure can go wrong, where a fourth copy of it is.
 *
 * `operatorName` travels beside the id because no route in this contract turns a
 * staff id into a person. The history exists to say who was answerable for a day
 * that went badly, and a column of uuids does not say it.
 */
export const shiftSchema = z.object({
  id: z.uuid(),
  operatorId: z.uuid(),
  /** Who was answerable, in the name the property employs them under. */
  operatorName: z.string(),
  openingFloat: vndAmountSchema,
  openedAt: z.iso.datetime(),
  /** The trading day the shift belongs to — resolved when it opened, never since. */
  openingBusinessDate: isoStayDateSchema,
  /** Cash bound to this shift so far. Zero on a drawer nothing has been paid into. */
  cashTaken: vndAmountSchema,
  /** The property's own cash through this till: income recorded into it less
   *  expense taken out of it. Below nothing on the ordinary day, and zero on a
   *  drawer nobody has spent from. */
  cashBookNet: vndAmountSchema,
  /** Counted out at the handover. Null while the shift is open. */
  closingCount: vndAmountSchema.nullable(),
  /** Counted less expected. Null while the shift is open, for want of a count. */
  variance: vndAmountSchema.nullable(),
  closedAt: z.iso.datetime().nullable(),
  /** What the next person was told. Null on a shift with nothing to say. */
  handoverNote: z.string().nullable(),
});

/**
 * Opening a drawer: the đồng counted into it, and nothing else.
 *
 * No operator, because the only person who may be answerable for this drawer is
 * the one asking — a body naming somebody else would be a receptionist opening a
 * shift in a colleague's name, and every đồng taken on it would be attributed to
 * the wrong person for the rest of the day. No business date either: which
 * trading day a shift opened at 01:00 belongs to is the rollover's answer and
 * the server's to give.
 *
 * Zero is a legitimate float — a desk that starts the day with an empty drawer
 * has counted it and found nothing — and below zero is not a quantity of cash at
 * all. The refusal is stated here rather than left to the column, so the person
 * who typed it gets a sentence instead of a fault, which is the trade
 * `postChargeInput` makes for its own figure.
 *
 * A second open drawer for the same operator is refused by
 * `shift_one_open_per_operator` and reported as "you already have a shift open".
 * Nothing in this shape could have caught that: the rule is about the rows that
 * already exist.
 */
export const openShiftInput = z.object({
  openingFloat: vndAmountInputSchema.refine(
    (amount) => amount >= 0n,
    "a drawer cannot be opened with less than nothing in it",
  ),
});

/**
 * Closing a drawer: what was counted out of it, and what the next person needs
 * to know.
 *
 * **No variance and no expected figure.** Both are arithmetic over the shift's
 * own opening float and the cash bound to it, and a close carrying either would
 * let the receptionist closing the drawer declare it square. The count is the
 * one number only a person standing at the drawer can supply, so it is the one
 * number this takes.
 *
 * **The shift is named, and that is deliberate.** A receptionist closes their
 * own and the handler holds them to it, but the matrix grants `MANAGER` and
 * `ADMIN` `full` on the drawer row, and the case that grant is for is the shift
 * somebody went home without closing. An address meaning "the caller's own open
 * shift" would leave that drawer open forever.
 *
 * The note is optional because a quiet shift genuinely has nothing to hand over,
 * and trimmed-empty is refused rather than stored: a note of two spaces reads to
 * the next shift as a note nobody wrote, which is what its absence already says.
 * Absent and `null` are the same claim here, as they are for a guest's comment.
 */
export const closeShiftInput = z.object({
  shiftId: z.uuid(),
  closingCount: vndAmountInputSchema.refine(
    (amount) => amount >= 0n,
    "a drawer cannot be counted at less than nothing",
  ),
  handoverNote: z.string().trim().min(1).max(LONGEST_HANDOVER_NOTE).nullish(),
});

/**
 * The most shifts one page of the history will answer with.
 *
 * `LONGEST_FOLIO_PAGE`'s figure and its argument: this is a screen somebody
 * reads rather than a search, so the tail is reached by `offset` instead of the
 * caller being told to ask a narrower question. A property running three shifts
 * a day fills a page of this size in about two months.
 */
export const LONGEST_SHIFT_PAGE = 200;

/** The page a caller gets for not naming one. Roughly a fortnight of desk. */
export const SHIFT_PAGE_SIZE = 50;

/**
 * Which shifts to read back — a person, a span of trading days, or both.
 *
 * **The days are `openingBusinessDate` and not `openedAt`**, because that column
 * is the whole reason the date is stored: a night shift opened at 01:00 is
 * answerable for the day before, and a history filtered on the instant would
 * file its variance under a day the property had already reported. Both ends are
 * inclusive and each is optional on its own, like `listFoliosInput` — these name
 * the first and last day of interest, where a stay's own [checkIn, checkOut)
 * does not.
 *
 * `operatorId` is the manager's question, and `shift_operator_idx` exists for
 * it. A receptionist naming a colleague is refused by the handler rather than by
 * this shape: the alternative — no filter at all — would take the manager's read
 * away in order to prevent a receptionist's, and the scoping the matrix
 * describes turns on who the caller is, which a schema cannot see.
 *
 * The open shift appears here when it falls inside the window. It is history the
 * moment it is a row, and dropping it would mean a manager looking at today
 * could not see who is on the desk.
 */
export const listShiftHistoryInput = z
  .object({
    operatorId: z.uuid().optional(),
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LONGEST_SHIFT_PAGE)
      .default(SHIFT_PAGE_SIZE),
    // Rows to skip, not a page number — `folio.ts` says why, and the order this
    // route promises is total for the same reason: newest opening first with
    // the id breaking a tie, so a caller stepping by `limit` sees each shift
    // once.
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (query) => !query.from || !query.to || query.from.compare(query.to) <= 0,
    { message: "to must not fall before from", path: ["to"] },
  );

/**
 * A page of shifts, and how many the filters matched behind it.
 *
 * `total` is counted under the same predicate the page was cut from, on every
 * read — `folioPageSchema`'s argument, and the figure a pager needs in order to
 * offer a last page rather than only a next one.
 */
export const shiftPageSchema = z.object({
  shifts: z.array(shiftSchema),
  total: z.number().int().min(0),
});

/**
 * One thing a shift could not finish.
 *
 * `resolvedAt` and `resolvedByShiftId` are null together and filled together —
 * `pending_item_resolved_exactly_when_a_shift_cleared_it` refuses every row
 * where they disagree — so "is this outstanding" and "who cleared it" cannot
 * give contradictory answers to two readers who picked different columns.
 *
 * `resolvedByShiftId` may name the raising shift, and that is the ordinary case
 * of an item raised at 09:00 and cleared at 11:00 rather than a fault to be
 * rendered specially.
 */
export const pendingItemSchema = z.object({
  id: z.uuid(),
  /** The shift that found it — the one the item is *from*, not the one it is for. */
  raisedByShiftId: z.uuid(),
  description: z.string(),
  createdAt: z.iso.datetime(),
  /** Null while it is still somebody's problem. */
  resolvedAt: z.iso.datetime().nullable(),
  /** Which shift dealt with it. Null on exactly the rows the instant is null on. */
  resolvedByShiftId: z.uuid().nullable(),
});

/**
 * Raising an item: what is outstanding, in the words of whoever found it.
 *
 * **No shift travels.** An item is raised by the shift the caller is on, which
 * the handler already knows and a caller could only get wrong — naming another
 * shift would file the finding against a drawer that never saw it, and naming a
 * closed one would add to a handover that has already happened. A caller on no
 * shift at all is refused and told to open one, which is the coupling
 * `screens.md` describes for cash: the desk's work belongs to a drawer, or it
 * belongs to nobody.
 *
 * Trimmed and non-empty, because `description` is `NOT NULL` for a reason the
 * table states — an item that says nothing is an item the next shift cannot act
 * on — and whitespace would satisfy the column while saying nothing.
 */
export const raisePendingItemInput = z.object({
  description: z.string().trim().min(1).max(LONGEST_PENDING_ITEM),
});

/**
 * Clearing an item: the item, and nothing about who cleared it.
 *
 * The resolving shift is the caller's own open one, for the reason the raising
 * shift is, and the instant is the clock's. A body carrying either would be a
 * shift crediting itself with somebody else's work, or backdating its own.
 *
 * An item already resolved is refused by the handler rather than silently
 * re-stamped: a second resolution would overwrite which shift actually dealt
 * with it, and that column is the half of the row the audit trail reads.
 */
export const resolvePendingItemInput = z.object({
  pendingItemId: z.uuid(),
});

/**
 * The most items one page will answer with.
 *
 * Lower than the shift history's ceiling, and the difference is what the two
 * lists are. A backlog is meant to be worked down — a hundred items outstanding
 * is not a handover but a standing problem, and no screen improves it by
 * painting two hundred. The history behind `ANY` is reached by `offset`, like
 * every other list here.
 */
export const LONGEST_PENDING_ITEM_PAGE = 100;

/** The page a caller gets for not naming one. A handover panel's worth. */
export const PENDING_ITEM_PAGE_SIZE = 50;

/**
 * Which items to list — the backlog by default, and one shift's findings on
 * request.
 *
 * **`state` is an enum and not a boolean**, on `listFoliosInput`'s argument: a
 * `?resolved=false` in a query string arrives as the string "false", which most
 * coercions read as true, and the failure mode of that mistake is a shift handed
 * a backlog of items that were all dealt with days ago. Two named members have
 * no such reading.
 *
 * It defaults to `OUTSTANDING` because that is the question the table is shaped
 * around — `pending_item_unresolved_idx` is partial on exactly this predicate,
 * and it is the only question asked across every shift the property has ever
 * run. `ANY` is the manager reading back a stretch of desk, and it is the case
 * paging exists for.
 *
 * `raisedByShiftId` is "what did this shift raise", which the closing screen
 * asks about itself and a manager asks about a night that went badly. It is not
 * scoping: an item is inherited by shifts that did not raise it, so a filter on
 * the raiser answers a question about provenance rather than about ownership.
 */
export const listPendingItemsInput = z.object({
  state: z.enum(["OUTSTANDING", "ANY"]).default("OUTSTANDING"),
  raisedByShiftId: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LONGEST_PENDING_ITEM_PAGE)
    .default(PENDING_ITEM_PAGE_SIZE),
  // Rows to skip, not a page number. Oldest first with the id breaking a tie —
  // the order the unresolved index is built in, and the order a backlog is
  // worked in.
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * A page of items, and how many the filters matched behind it.
 *
 * `total` is the figure a handover badge is actually asking for — "seven things
 * outstanding" — and a caller wanting only that asks for `limit=1` and reads it,
 * rather than pulling rows it will not draw.
 */
export const pendingItemPageSchema = z.object({
  items: z.array(pendingItemSchema),
  total: z.number().int().min(0),
});

export const operations = {
  openShift: oc
    // POST to a collection, because a shift is a thing the property has many of
    // and today's is not an edit of yesterday's. The refusal of a second open
    // drawer comes from the unique index rather than from the verb.
    .route({ method: "POST", path: "/shifts" })
    .input(openShiftInput)
    .output(shiftSchema),

  closeShift: oc
    // A nominalised act rather than a collection, the way `folio.ts` spells
    // `/closure`: it happens to a shift once, and a second attempt is refused
    // rather than appended. The answer is the closed shift itself, variance
    // included — the figure the whole act exists to produce, on the connection
    // that produced it.
    .route({ method: "POST", path: "/shifts/{shiftId}/closure" })
    .input(closeShiftInput)
    .output(shiftSchema),

  currentShift: oc
    // A fixed member of the collection rather than an id, because the caller
    // cannot name a shift here at all: this is "the drawer I am on", which is
    // the top bar's question on every screen. No input, so there is nothing to
    // point it at somebody else's day.
    //
    // Nullable, and the null is the ordinary state of a receptionist who has
    // not opened a drawer yet — the console renders "no shift" from it and the
    // palette offers to open one. A refusal would be the wrong shape: nothing
    // is wrong with not being on a shift.
    .route({ method: "GET", path: "/shifts/current" })
    .output(shiftSchema.nullable()),

  listShiftHistory: oc
    // The collection itself, with the narrowing in the query string, so the
    // Shifts screen is a link a manager can keep rather than a procedure. No
    // member route beside it: nothing in `screens.md` opens one shift on its
    // own, and the row already carries everything the history draws.
    .route({ method: "GET", path: "/shifts" })
    .input(listShiftHistoryInput)
    .output(shiftPageSchema),

  raisePendingItem: oc
    // A root collection, because an item outlives the shift that raised it —
    // the header says why it does not hang off `/shifts/{id}`. POST, and two
    // presses honestly make two items: an item is a finding rather than a
    // state, and the same thing noticed twice is the desk's to resolve twice.
    .route({ method: "POST", path: "/pending-items" })
    .input(raisePendingItemInput)
    .output(pendingItemSchema),

  resolvePendingItem: oc
    // Nominalised for the reason the close is: it happens once, and the shift
    // credited with it is written at that instant and never rewritten.
    .route({
      method: "POST",
      path: "/pending-items/{pendingItemId}/resolution",
    })
    .input(resolvePendingItemInput)
    .output(pendingItemSchema),

  listPendingItems: oc
    // The backlog, GET, filters in the query string — the read a shift makes
    // when it takes the desk over, and the one a closing screen makes about
    // itself.
    .route({ method: "GET", path: "/pending-items" })
    .input(listPendingItemsInput)
    .output(pendingItemPageSchema),
};
