/* The desk's day, as the console has to reason about it: whose drawer this is,
 * what it should be holding, what a count came to, and what an operator's
 * keystrokes parse to before any of it is sent.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/payments/payment-day.ts` and `features/departures/departure-queue.ts`
 * both give: everything below is a judgement the API does not make for the
 * console — which roles are offered a drawer at all, what the till should hold
 * before somebody counts it, whether a typed figure is a quantity of đồng, and
 * which refusal of a payment has an action behind it.
 *
 * Four rules hold throughout, and `shift-day.spec.ts` holds this file to them:
 *
 * 1. **The variance is the API's figure and is never computed here.**
 *    `contract/operations.ts` refuses to accept one and derives it on the close,
 *    because a drawer that reported whatever the person closing it typed would
 *    report nothing at all. {@link varianceReading} reads the figure that came
 *    back and says which way it points; nothing in this file subtracts a count
 *    from anything.
 * 2. **What the drawer *should* hold is arithmetic the console is invited to
 *    do.** `shiftSchema` says so in as many words — the expected figure is not
 *    restated on the wire because both of its terms travel on the shift and the
 *    sum of two exact integers has nowhere to go wrong. {@link expectedInDrawer}
 *    is that sum and nothing more.
 * 3. **Zero is a quantity of cash.** A desk that starts the day with an empty
 *    drawer has counted it and found nothing, and a till counted out at nothing
 *    is a till that was emptied. {@link parseDrawerAmount} therefore accepts what
 *    `lib/desk-payment.ts`'s own parser refuses, and the two are separate
 *    functions rather than one with a flag because they are answering different
 *    questions: money handed over is a figure above nothing, and a count is a
 *    fact about a drawer.
 * 4. **Who is offered a door is decided from the matrix and never from a
 *    handler's answer.** `rbac-matrix.md` §3 carries two rows here — the cash
 *    drawer and the handover notes — and the three predicates below are those
 *    rows read literally. They are not a wall: the API's capability guard is the
 *    wall, and what these decide is whether a console offers somebody a control
 *    that would answer 403.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  CASH_PAYMENT_REFUSALS,
  type CashPaymentRefusal,
  LONGEST_HANDOVER_NOTE,
  LONGEST_PENDING_ITEM,
  SHIFT_PAGE_SIZE,
  type StaffRole,
} from "@mariva/shared";

import { parseLiberalDate } from "@/lib/date-parser";

/* The wire's shapes, read off the client rather than restated — the argument
 * every other feature in this console makes: `@mariva/shared` types the client
 * from the contract's own schemas, so a field renamed there breaks this file in
 * the pull request that renamed it, where a hand-written interface would compile
 * until it was wrong. */

/** A page of the history, and how many shifts the filters matched behind it. */
export type ShiftPage = Awaited<
  ReturnType<ApiClient["operations"]["listShiftHistory"]>
>;

/** One shift — the drawer, the day, and what the count came to. */
export type Shift = ShiftPage["shifts"][number];

/** What `GET /shifts` takes. */
export type ShiftHistoryQuery = Parameters<
  ApiClient["operations"]["listShiftHistory"]
>[0];

/** What opening a drawer takes: the đồng counted into it, and nothing else. */
export type OpenDrawer = Parameters<ApiClient["operations"]["openShift"]>[0];

/** What closing one takes: the shift, the count, and what the next person
 *  needs to know. */
export type CloseDrawer = Parameters<ApiClient["operations"]["closeShift"]>[0];

/** A page of outstanding items, and how many there are behind it. */
export type PendingItemPage = Awaited<
  ReturnType<ApiClient["operations"]["listPendingItems"]>
>;

/** One thing a shift could not finish. */
export type PendingItem = PendingItemPage["items"][number];

/**
 * Who may open, count and close a drawer — the matrix's *Cash drawer open /
 * close / count* row at the level a write needs.
 *
 * `RECEPTIONIST` is `conditional` there and `MANAGER` and `ADMIN` are `full`,
 * and all three land here: the condition is "own shift", which the handler
 * enforces by taking the operator off the session rather than by refusing the
 * act. `ACCOUNTANT` holds the row at `read` and is deliberately absent — the
 * guard refuses a read-only grant on every write route in the family, so a
 * console offering them the open control would be offering a press that answers
 * 403 with money already in somebody's hand.
 */
export function mayWorkADrawer(role: StaffRole): boolean {
  return role === "RECEPTIONIST" || role === "MANAGER" || role === "ADMIN";
}

/**
 * Who may read a drawer and the history behind it — the same row at `read`.
 *
 * The accountant is added to the three above, which is the whole reason the
 * matrix grants them 👁 on it: the property's takings are reconciled across the
 * desk, and a variance nobody outside the desk could see would be a figure with
 * no reader. `HOUSEKEEPING` holds neither row and is offered neither surface —
 * `nav-inventory.ts` already keeps the Shifts family out of their rail, and this
 * is the same decision applied to the bar that follows them onto every screen.
 */
export function mayReadDrawers(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || mayWorkADrawer(role);
}

/**
 * Who is offered the operator filter on the history.
 *
 * The manager's question, and the accountant's. A receptionist reaching it is
 * not refused by the API — `shift.controller.ts` overwrites their `operatorId`
 * with their own rather than answering 403, deliberately, so that an old link or
 * a remembered filter still returns the one history they are entitled to. What
 * that means for the console is that offering them the control would be offering
 * a filter whose every setting produces the same rows, which reads as a broken
 * screen rather than as a scope.
 */
export function mayPickOperator(role: StaffRole): boolean {
  return role === "ACCOUNTANT" || role === "MANAGER" || role === "ADMIN";
}

/** True while nobody has counted this drawer out. The three nullable fields
 *  move together — the database refuses every row where they disagree — so any
 *  one of them answers this and they cannot answer it differently. */
export function isOpen(shift: Shift): boolean {
  return shift.closedAt === null;
}

/**
 * What the drawer should be holding: the float it was opened with, plus the cash
 * guests paid into it, plus what the property's own book moved through it.
 *
 * The one piece of arithmetic over money this console does, and `shiftSchema`
 * asks for it here rather than sending a fourth figure: all three terms are on
 * the shift, all three are exact integers, and their sum is not somewhere a
 * figure can go wrong. It is what somebody about to count a till needs, which is
 * why `cashTaken` travels on an open shift as well as a closed one.
 *
 * `cashBookNet` is the only signed term and is usually below nothing: `FR-OPS-02`
 * lets a manager or the accountant record what came out of this till for a
 * delivery, and đồng handed to a supplier are đồng the count will not find.
 * Nobody who works a drawer may record one — the matrix denies a receptionist
 * that row outright — so from the desk's side this figure moves on its own, and
 * the panel prints it as a term of the sum rather than folding it away.
 */
export function expectedInDrawer(shift: Shift): bigint {
  return shift.openingFloat + shift.cashTaken + shift.cashBookNet;
}

/** Which way a counted drawer was out, if it was. */
export type VarianceTone = "square" | "over" | "short";

/** A closed drawer's variance, in the terms a manager reads it in. */
export interface VarianceReading {
  readonly tone: VarianceTone;
  /** The magnitude, always at or above nothing. Which way it points is
   *  {@link VarianceTone}, because "-2.000 ₫" beside the word "short" is the
   *  same fact stated twice and one of the two spellings will eventually be
   *  wrong. */
  readonly amount: bigint;
}

/**
 * What the count came to against what was expected, or null on a drawer nobody
 * has counted.
 *
 * The figure is the API's and is read rather than derived. A console that
 * subtracted `closingCount` from {@link expectedInDrawer} would be a second
 * opinion about the one number the whole close exists to produce — and it would
 * be a second opinion computed from a shift object that may have been fetched
 * before the last cash payment landed on it.
 *
 * Positive is a drawer with more đồng in it than the property can account for
 * and negative is one that is short. Both are wrong and the sign says which,
 * which is the first thing a manager asks.
 */
export function varianceReading(shift: Shift): VarianceReading | null {
  if (shift.variance === null) {
    return null;
  }

  if (shift.variance === 0n) {
    return { tone: "square", amount: 0n };
  }

  return shift.variance > 0n
    ? { tone: "over", amount: shift.variance }
    : { tone: "short", amount: -shift.variance };
}

/** What each way a drawer can be out is called on screen. */
export const VARIANCE_LABELS: Record<VarianceTone, string> = {
  square: "Square",
  over: "Over",
  short: "Short",
};

/**
 * A whole number of đồng counted at a drawer, or null.
 *
 * The separator rules are `lib/desk-payment.ts`'s and for its reasons: spaces
 * and full stops are dropped because they are the vi-VN grouping mark a
 * receptionist reads off the screen and types back, and a comma is refused
 * because it is the vi-VN decimal mark — a minor unit the currency does not
 * have, and one that silently read as a grouping mark would record a hundredfold
 * of what was counted.
 *
 * Zero is accepted, which is the whole of the difference from that parser. A
 * float of nothing is a desk that opened an empty till and a count of nothing is
 * a till that was emptied into the safe; both are facts somebody stood at the
 * drawer and established, and refusing them would leave the operator unable to
 * state the one thing they know.
 */
export function parseDrawerAmount(typed: string): bigint | null {
  const digits = typed.replaceAll(/[\s.]/g, "");

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  return BigInt(digits);
}

/** Either a request the API will take, or the sentence that says why it is not
 *  one yet. The shape `lib/desk-payment.ts` uses, so a form built against
 *  either reads the same way. */
export type DrawerAttempt<T> =
  | { readonly input: T }
  | { readonly problem: string };

/** What the operator typed into the open-drawer form. */
export interface OpenDrawerFields {
  openingFloat: string;
}

/** The float, as the contract takes it — decimal text, per `money.ts`, because
 *  a JSON number would round a figure in đồng that has no minor unit to round
 *  into. */
export function openDrawerAttempt(
  fields: OpenDrawerFields,
): DrawerAttempt<OpenDrawer> {
  const openingFloat = parseDrawerAmount(fields.openingFloat);

  if (openingFloat === null) {
    return {
      problem:
        "Count the float into the drawer and type it as a whole number of đồng. An empty till is nothing, which is a count — leave it blank and there is no count at all.",
    };
  }

  return { input: { openingFloat: openingFloat.toString() } };
}

/** What the operator typed into the close-drawer form. */
export interface CloseDrawerFields {
  closingCount: string;
  /** What the next person is told. Empty is a quiet shift with nothing to hand
   *  over, and it travels as absent rather than as an empty note. */
  handoverNote: string;
}

/**
 * The count and the note, as the close takes them.
 *
 * No variance and no expected figure, which is the contract's refusal applied
 * one layer earlier: the count is the one number only a person standing at the
 * drawer can supply, so it is the one number this builds.
 *
 * A note of whitespace is sent as no note rather than as a note. `closeShiftInput`
 * trims and refuses the empty remainder, and a note of two spaces reads to the
 * next shift as a note nobody wrote — which is what its absence already says.
 * The length is refused here rather than as a `400`, so the person who typed it
 * gets a sentence while the words are still on screen.
 */
export function closeDrawerAttempt(
  shiftId: string,
  fields: CloseDrawerFields,
): DrawerAttempt<CloseDrawer> {
  const closingCount = parseDrawerAmount(fields.closingCount);

  if (closingCount === null) {
    return {
      problem:
        "Count the drawer out and type what is in it as a whole number of đồng. A till emptied into the safe is nothing, which is still a count.",
    };
  }

  const handoverNote = fields.handoverNote.trim();

  if (handoverNote.length > LONGEST_HANDOVER_NOTE) {
    return {
      problem: `The handover note is ${handoverNote.length} characters and stops at ${LONGEST_HANDOVER_NOTE}. Anything with a shape of its own — a deposit not receipted, a key with the manager — is an outstanding item rather than a paragraph.`,
    };
  }

  return {
    input: {
      shiftId,
      closingCount: closingCount.toString(),
      handoverNote: handoverNote === "" ? null : handoverNote,
    },
  };
}

/**
 * One outstanding item, in the words of whoever found it.
 *
 * No shift travels with it and none is asked for: the item is raised by the
 * drawer the caller is on, which the handler already knows and a console could
 * only get wrong. What this refuses is an item that says nothing, because an
 * item the next shift cannot act on is not a handover.
 */
export function pendingItemAttempt(
  description: string,
): DrawerAttempt<{ description: string }> {
  const said = description.trim();

  if (said === "") {
    return {
      problem:
        "Say what is outstanding. The next shift reads this list before anything else, and a blank row tells them nothing.",
    };
  }

  if (said.length > LONGEST_PENDING_ITEM) {
    return {
      problem: `That is ${said.length} characters and an item stops at ${LONGEST_PENDING_ITEM}. An item nobody can read at a glance does not get picked up by the shift that inherits it — a longer account belongs in the handover note.`,
    };
  }

  return { input: { description: said } };
}

/**
 * The refusal code behind a rejected payment, or null.
 *
 * Read structurally off `data.code` and checked against the contract's own list,
 * which is what `contract/folio.ts` declares on the payment route and what
 * `payment-refusal.ts` exists for: a screen with an action behind a refusal
 * cannot be left matching on prose, because the prose is rewritten the afternoon
 * somebody improves it. An error carrying no code — a figure the route would not
 * take, an account already agreed, a network that was not there — answers null
 * and is left to the central toast.
 *
 * It lives in this feature rather than beside the checkout that catches it
 * because the refusal is the drawer's: what refuses the money is the absence of
 * a shift, and the way out of it is the act this feature owns.
 */
export function cashDrawerRefusal(error: unknown): CashPaymentRefusal | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const data = (error as { data?: unknown }).data;

  if (typeof data !== "object" || data === null) {
    return null;
  }

  const code = (data as { code?: unknown }).code;

  return CASH_PAYMENT_REFUSALS.includes(code as CashPaymentRefusal)
    ? (code as CashPaymentRefusal)
    : null;
}

/** Somebody who was answerable for a drawer, in the name the property employs
 *  them under. */
export interface Operator {
  readonly id: string;
  readonly name: string;
}

/**
 * The operators a page of history contains, each named once.
 *
 * The picker is built from the answer because no route in this console turns a
 * staff id into a list of people — `operatorName` travels on the shift precisely
 * so a history is readable without one, and inventing a staff directory here to
 * fill a filter would be a screen asking a question the API has no route for.
 * What it means in practice is that the choices are the people whose shifts are
 * on screen, which is the set a manager reading a stretch of desk is choosing
 * between anyway.
 *
 * Sorted by name so the list does not re-order itself under the reader when the
 * page behind it changes, with the id breaking a tie between two people the
 * property employs under one name.
 */
export function operatorsIn(shifts: readonly Shift[]): Operator[] {
  const byId = new Map<string, Operator>();

  for (const shift of shifts) {
    if (!byId.has(shift.operatorId)) {
      byId.set(shift.operatorId, {
        id: shift.operatorId,
        name: shift.operatorName,
      });
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

/**
 * The same list, with the operator currently filtered on kept in it.
 *
 * Narrowing to one person answers with that person's shifts and nothing else,
 * so a picker rebuilt from that answer alone would offer exactly the choice
 * already made — and a filter whose only other setting is "everyone" reads as a
 * control that has broken. Keeping the selection is what lets the reader see
 * where they are; clearing it back to every operator repopulates the rest.
 */
export function operatorChoices(
  shifts: readonly Shift[],
  selected: Operator | null,
): Operator[] {
  const choices = operatorsIn(shifts);

  if (selected === null || choices.some((one) => one.id === selected.id)) {
    return choices;
  }

  return [...choices, selected].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

/** What the operator has typed into the history's filters. */
export interface HistoryFields {
  /** The first trading day of interest, as typed. Empty is no lower bound. */
  from: string;
  /** The last, inclusive. Empty is no upper bound. */
  to: string;
  /** Whose desk, or everybody's. */
  operator: Operator | null;
}

/** The filters the screen opens on: the most recent shifts, everybody's. The
 *  route's own default page is roughly a fortnight of desk, which is the
 *  stretch somebody opening this screen is asking about. */
export const DEFAULT_HISTORY_FIELDS: HistoryFields = {
  from: "",
  to: "",
  operator: null,
};

/**
 * The typed filters as a query the route will take, or the first thing wrong
 * with them.
 *
 * The days are read with the console's own liberal parser, against the
 * property's business date rather than the browser's calendar — "yesterday"
 * typed at 01:30 means the trading day before the one the desk is working, and
 * resolving it off a wall clock would file a variance under a day the property
 * has already reported.
 *
 * One refusal at a time, in the order the form reads, like every other filter in
 * this console: a form with one message beside it is one thing to fix.
 *
 * The order of the two ends is checked here as well as by the contract, so an
 * operator who typed them the wrong way round is told while the words are still
 * in the fields instead of after a round trip.
 */
export type HistoryAttempt =
  | { readonly query: ShiftHistoryQuery }
  | { readonly problem: string };

export function historyQuestion(
  fields: HistoryFields,
  businessDate: string | null,
  offset: number,
): HistoryAttempt {
  const from = readDay(fields.from, businessDate, "first");

  if ("problem" in from) {
    return from;
  }

  const to = readDay(fields.to, businessDate, "last");

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
      operatorId: fields.operator?.id,
      from: from.day,
      to: to.day,
      limit: SHIFT_PAGE_SIZE,
      offset,
    },
  };
}

/** One end of the range, read against the property's day. Absent is no bound
 *  rather than a refusal: a history with one end open is an ordinary question. */
function readDay(
  typed: string,
  businessDate: string | null,
  end: "first" | "last",
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
      problem: `The ${end} day of interest could not be read. A trading day is written 2026-08-16, or 16/8, or today.`,
    };
  }

  return { day };
}
