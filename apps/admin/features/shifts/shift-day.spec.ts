import {
  LONGEST_HANDOVER_NOTE,
  LONGEST_PENDING_ITEM,
  SHIFT_PAGE_SIZE,
  type StaffRole,
} from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  cashDrawerRefusal,
  closeDrawerAttempt,
  DEFAULT_HISTORY_FIELDS,
  expectedInDrawer,
  historyQuestion,
  isOpen,
  mayPickOperator,
  mayReadDrawers,
  mayWorkADrawer,
  type Operator,
  openDrawerAttempt,
  operatorChoices,
  operatorsIn,
  parseDrawerAmount,
  pendingItemAttempt,
  type Shift,
  varianceReading,
} from "./shift-day";

/* The desk's day, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: who is offered a
 * drawer, what a till should be holding, which way a counted one was out, what
 * an operator's keystrokes parse to, and which refusal of a payment has an act
 * behind it.
 *
 * The rule most of it is about is that this console never computes a variance. A
 * figure derived here would be a second opinion about the one number the whole
 * close exists to produce, computed on a machine that did not hold the lock the
 * cash was summed under — so the assertions below check that the reading is of
 * the API's own field, and that nothing subtracts a count from anything.
 */

const OPERATOR = "44444444-4444-4444-8444-444444444444";
const SHIFT_ID = "55555555-5555-4555-8555-555555555555";
const TODAY = "2026-08-16";

const ROLES: readonly StaffRole[] = [
  "RECEPTIONIST",
  "HOUSEKEEPING",
  "ACCOUNTANT",
  "MANAGER",
  "ADMIN",
];

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: SHIFT_ID,
    operatorId: OPERATOR,
    operatorName: "Trần Minh Anh",
    openingFloat: 1_000_000n,
    openedAt: "2026-08-16T01:00:00.000Z",
    openingBusinessDate: TODAY,
    cashTaken: 2_500_000n,
    closingCount: null,
    variance: null,
    closedAt: null,
    handoverNote: null,
    ...over,
  };
}

describe("who is offered a drawer", () => {
  it("lets the three roles that work a till open, count and close one", () => {
    // The matrix's *Cash drawer* row at the level a write needs: `conditional`
    // for the desk, `full` for management. The condition is "own shift", which
    // the handler enforces by taking the operator off the session rather than by
    // refusing the act.
    expect(ROLES.filter(mayWorkADrawer)).toStrictEqual([
      "RECEPTIONIST",
      "MANAGER",
      "ADMIN",
    ]);
  });

  it("withholds the acts from the accountant, whose grant is a read", () => {
    // 👁 on the row, and the guard refuses a read-only grant on every write
    // route in the family. Offering the control would be offering a press that
    // answers 403 with money already in somebody's hand.
    expect(mayWorkADrawer("ACCOUNTANT")).toBe(false);
    expect(mayReadDrawers("ACCOUNTANT")).toBe(true);
  });

  it("offers the history to everyone but housekeeping", () => {
    // Housekeepers hold neither row: they see no money, which is the whole of
    // why the board is the one screen their day happens on.
    expect(ROLES.filter(mayReadDrawers)).toStrictEqual([
      "RECEPTIONIST",
      "ACCOUNTANT",
      "MANAGER",
      "ADMIN",
    ]);
    expect(mayReadDrawers("HOUSEKEEPING")).toBe(false);
  });

  it("withholds the operator filter from the desk, whose read is its own", () => {
    // The API narrows a receptionist's history to their own shifts by
    // overwriting the filter rather than refusing it, so a picker in their hands
    // would be a control whose every setting produced the same rows.
    expect(mayPickOperator("RECEPTIONIST")).toBe(false);
    expect(ROLES.filter(mayPickOperator)).toStrictEqual([
      "ACCOUNTANT",
      "MANAGER",
      "ADMIN",
    ]);
  });
});

describe("what the drawer should be holding", () => {
  it("is the opening float plus the cash bound to the shift", () => {
    expect(expectedInDrawer(shift())).toBe(3_500_000n);
  });

  it("is the float alone on a drawer nothing has been paid into", () => {
    expect(expectedInDrawer(shift({ cashTaken: 0n }))).toBe(1_000_000n);
  });

  it("counts an empty till as a drawer that was counted", () => {
    // Zero is a legitimate float, and a desk that opened an empty drawer has
    // established a fact rather than declined to.
    expect(expectedInDrawer(shift({ openingFloat: 0n, cashTaken: 0n }))).toBe(
      0n,
    );
  });
});

describe("whether a drawer is still open", () => {
  it("reads open while nobody has counted it out", () => {
    expect(isOpen(shift())).toBe(true);
  });

  it("reads closed once it has been", () => {
    expect(
      isOpen(
        shift({
          closedAt: "2026-08-16T09:00:00.000Z",
          closingCount: 3_500_000n,
          variance: 0n,
        }),
      ),
    ).toBe(false);
  });
});

describe("how far out a counted drawer was", () => {
  it("says nothing about a drawer nobody has counted", () => {
    expect(varianceReading(shift())).toBeNull();
  });

  it("reads the API's own figure rather than deriving one", () => {
    // The count and the expected figure disagree by 500.000 here, and the
    // variance says 100.000. The reading is of the field, because the property's
    // figure was computed under the lock its cash was summed under and this one
    // would not be.
    const counted = shift({
      closingCount: 4_000_000n,
      variance: 100_000n,
      closedAt: "2026-08-16T09:00:00.000Z",
    });

    expect(varianceReading(counted)).toStrictEqual({
      tone: "over",
      amount: 100_000n,
    });
  });

  it("reads a drawer that is short as a magnitude and a direction", () => {
    const counted = shift({
      closingCount: 3_400_000n,
      variance: -100_000n,
      closedAt: "2026-08-16T09:00:00.000Z",
    });

    expect(varianceReading(counted)).toStrictEqual({
      tone: "short",
      amount: 100_000n,
    });
  });

  it("reads a drawer that agrees as square rather than as nothing", () => {
    const counted = shift({
      closingCount: 3_500_000n,
      variance: 0n,
      closedAt: "2026-08-16T09:00:00.000Z",
    });

    expect(varianceReading(counted)).toStrictEqual({
      tone: "square",
      amount: 0n,
    });
  });
});

describe("a figure counted at a drawer", () => {
  it("accepts nothing, which a payment's own parser refuses", () => {
    // A till emptied into the safe is a count. `parseAmount` in
    // `lib/desk-payment.ts` refuses zero because money handed over is a figure
    // above nothing, and these are two different questions.
    expect(parseDrawerAmount("0")).toBe(0n);
  });

  it("drops the grouping marks an operator reads off the screen", () => {
    expect(parseDrawerAmount("1.500.000")).toBe(1_500_000n);
    expect(parseDrawerAmount(" 2 000 000 ")).toBe(2_000_000n);
  });

  it("refuses a comma, which is the decimal mark and not a grouping one", () => {
    // Read as a grouping mark it would record a hundredfold of what was counted.
    expect(parseDrawerAmount("1,50")).toBeNull();
  });

  it("refuses nothing typed at all, and anything that is not a figure", () => {
    expect(parseDrawerAmount("")).toBeNull();
    expect(parseDrawerAmount("about two million")).toBeNull();
    expect(parseDrawerAmount("-1000")).toBeNull();
  });
});

describe("opening a drawer", () => {
  it("sends the float as decimal text, which is what the contract takes", () => {
    expect(openDrawerAttempt({ openingFloat: "1.000.000" })).toStrictEqual({
      input: { openingFloat: "1000000" },
    });
  });

  it("takes an empty till as the count it is", () => {
    expect(openDrawerAttempt({ openingFloat: "0" })).toStrictEqual({
      input: { openingFloat: "0" },
    });
  });

  it("refuses a float nobody typed, and says what to do about it", () => {
    const attempt = openDrawerAttempt({ openingFloat: "" });

    expect("problem" in attempt).toBe(true);
  });

  it("carries no operator and no business date", () => {
    // Both are the server's: a body naming somebody else would attribute the
    // day's cash to the wrong person, and which trading day a shift opened at
    // 01:00 belongs to is the property's rollover.
    const attempt = openDrawerAttempt({ openingFloat: "500000" });

    expect("input" in attempt && Object.keys(attempt.input)).toStrictEqual([
      "openingFloat",
    ]);
  });
});

describe("closing a drawer", () => {
  it("sends the shift, the count and the note", () => {
    expect(
      closeDrawerAttempt(SHIFT_ID, {
        closingCount: "3.500.000",
        handoverNote: "  305 is waiting on a card machine receipt.  ",
      }),
    ).toStrictEqual({
      input: {
        shiftId: SHIFT_ID,
        closingCount: "3500000",
        handoverNote: "305 is waiting on a card machine receipt.",
      },
    });
  });

  it("sends no note at all for a note of whitespace", () => {
    // A note of two spaces reads to the next shift as a note nobody wrote,
    // which is what its absence already says.
    expect(
      closeDrawerAttempt(SHIFT_ID, {
        closingCount: "0",
        handoverNote: "   ",
      }),
    ).toStrictEqual({
      input: { shiftId: SHIFT_ID, closingCount: "0", handoverNote: null },
    });
  });

  it("refuses a count nobody typed", () => {
    const attempt = closeDrawerAttempt(SHIFT_ID, {
      closingCount: "",
      handoverNote: "",
    });

    expect("problem" in attempt).toBe(true);
  });

  it("refuses a note longer than the column, while it can still be edited", () => {
    const attempt = closeDrawerAttempt(SHIFT_ID, {
      closingCount: "100000",
      handoverNote: "n".repeat(LONGEST_HANDOVER_NOTE + 1),
    });

    expect("problem" in attempt).toBe(true);
  });

  it("carries no variance and no expected figure", () => {
    // The contract refuses both, because a close carrying either would let the
    // person counting the drawer declare it square.
    const attempt = closeDrawerAttempt(SHIFT_ID, {
      closingCount: "3500000",
      handoverNote: "",
    });

    expect(
      "input" in attempt && Object.keys(attempt.input).sort(),
    ).toStrictEqual(["closingCount", "handoverNote", "shiftId"]);
  });
});

describe("raising an outstanding item", () => {
  it("trims what was typed", () => {
    expect(pendingItemAttempt("  305 deposit not receipted ")).toStrictEqual({
      input: { description: "305 deposit not receipted" },
    });
  });

  it("refuses an item that says nothing", () => {
    expect("problem" in pendingItemAttempt("   ")).toBe(true);
  });

  it("refuses one nobody could read at a glance", () => {
    expect(
      "problem" in pendingItemAttempt("x".repeat(LONGEST_PENDING_ITEM + 1)),
    ).toBe(true);
  });
});

describe("a payment the desk could not take", () => {
  it("reads the drawer's refusal off the error's data", () => {
    expect(
      cashDrawerRefusal({ status: 409, data: { code: "NO_OPEN_SHIFT" } }),
    ).toBe("NO_OPEN_SHIFT");
  });

  it("answers null for every other refusal, which has no act behind it", () => {
    // A folio already agreed and a figure the route would not take are both
    // reported by the central toast, and a console matching on prose would break
    // the afternoon somebody rewrote a sentence.
    expect(
      cashDrawerRefusal({ status: 409, data: { code: "FOLIO_NOT_SETTLED" } }),
    ).toBeNull();
    expect(
      cashDrawerRefusal({
        status: 409,
        message: "there is no cash drawer open in your name",
      }),
    ).toBeNull();
  });

  it("answers null for what never reached a handler", () => {
    expect(cashDrawerRefusal(null)).toBeNull();
    expect(cashDrawerRefusal(new Error("Failed to fetch"))).toBeNull();
    expect(cashDrawerRefusal({ data: null })).toBeNull();
  });
});

describe("who worked the shifts on screen", () => {
  const other: Operator = {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Lê Bảo",
  };

  it("names each operator once, in an order that does not move", () => {
    const page = [
      shift(),
      shift({ id: "a", operatorId: other.id, operatorName: other.name }),
      shift({ id: "b" }),
    ];

    expect(operatorsIn(page)).toStrictEqual([
      other,
      { id: OPERATOR, name: "Trần Minh Anh" },
    ]);
  });

  it("keeps the operator being filtered on in the list", () => {
    // Narrowing to one person answers with that person's shifts alone, so a
    // picker rebuilt from the answer would offer only the choice already made —
    // a filter that reads as a control that has broken.
    const page = [shift()];

    expect(operatorChoices(page, other)).toStrictEqual([
      other,
      { id: OPERATOR, name: "Trần Minh Anh" },
    ]);
  });

  it("does not name the selected operator twice", () => {
    const page = [shift()];
    const selected: Operator = { id: OPERATOR, name: "Trần Minh Anh" };

    expect(operatorChoices(page, selected)).toStrictEqual([selected]);
  });
});

describe("the question the history is asked", () => {
  it("opens on no day at all, which the route answers with its own page", () => {
    expect(historyQuestion(DEFAULT_HISTORY_FIELDS, TODAY, 0)).toStrictEqual({
      query: {
        operatorId: undefined,
        from: undefined,
        to: undefined,
        limit: SHIFT_PAGE_SIZE,
        offset: 0,
      },
    });
  });

  it("resolves a typed day against the property's day and not a clock", () => {
    const attempt = historyQuestion(
      { from: "yesterday", to: "today", operator: null },
      TODAY,
      0,
    );

    expect(attempt).toStrictEqual({
      query: {
        operatorId: undefined,
        from: "2026-08-15",
        to: TODAY,
        limit: SHIFT_PAGE_SIZE,
        offset: 0,
      },
    });
  });

  it("carries the operator and the offset the pager asked for", () => {
    const attempt = historyQuestion(
      { from: "", to: "", operator: { id: OPERATOR, name: "Trần Minh Anh" } },
      TODAY,
      SHIFT_PAGE_SIZE,
    );

    expect("query" in attempt && attempt.query.operatorId).toBe(OPERATOR);
    expect("query" in attempt && attempt.query.offset).toBe(SHIFT_PAGE_SIZE);
  });

  it("refuses a range whose ends are the wrong way round", () => {
    const attempt = historyQuestion(
      { from: "2026-08-16", to: "2026-08-15", operator: null },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("accepts a single day typed into both ends, which are inclusive", () => {
    const attempt = historyQuestion(
      { from: TODAY, to: TODAY, operator: null },
      TODAY,
      0,
    );

    expect("query" in attempt && attempt.query.from).toBe(TODAY);
    expect("query" in attempt && attempt.query.to).toBe(TODAY);
  });

  it("refuses a day it cannot read", () => {
    const attempt = historyQuestion(
      { from: "some time last week", to: "", operator: null },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("refuses a typed day before the property has said what day it is", () => {
    // Relative dates count from the property's rollover, and resolving one
    // against this machine's calendar would file a variance under a day the
    // property has already reported.
    const attempt = historyQuestion(
      { from: "today", to: "", operator: null },
      null,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("asks a question with no dates before the property has said", () => {
    expect("query" in historyQuestion(DEFAULT_HISTORY_FIELDS, null, 0)).toBe(
      true,
    );
  });
});
