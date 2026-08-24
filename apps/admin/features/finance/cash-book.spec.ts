// The four rules `cash-book.ts` opens with, held to.
//
// Everything asserted here is a judgement the API does not make for the console:
// which roles are offered the book, which categories belong on which side, which
// drawers may still take cash, and whether what an operator typed is a movement
// of money at all. The API refuses all of it too — the capability guard, the
// contract's refinements and the table's checks are the wall — and what these
// cases protect is the sentence the person who typed it reads instead of a
// fault.
//
// Nothing here computes what a drawer should hold. That figure is
// `features/shifts/shift-day.ts`'s one piece of arithmetic and it is tested
// there; this feature's contribution to a variance is the entry it records.

import { STAFF_ROLES, type StaffRole } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import type { Shift } from "@/features/shifts";

import {
  type BookFields,
  bookQuestion,
  byMethod,
  CATEGORY_LABELS,
  type CashBookEntry,
  categoriesFor,
  DEFAULT_BOOK_FIELDS,
  DEFAULT_ENTRY_FIELDS,
  type EntryFields,
  entryAttempt,
  mayKeepTheBook,
  netOfTheBook,
  onSide,
  openDrawersIn,
  reversalAttempt,
  theOnlyOpenDrawer,
} from "./cash-book";

const ROLES: readonly StaffRole[] = STAFF_ROLES;

const TODAY = "2026-08-20";
const DAY_DRAWER = "11111111-1111-4111-8111-111111111111";
const NIGHT_DRAWER = "22222222-2222-4222-8222-222222222222";
const AN_ENTRY = "33333333-3333-4333-8333-333333333333";

function fields(over: Partial<EntryFields> = {}): EntryFields {
  return { ...DEFAULT_ENTRY_FIELDS, ...over };
}

function filters(over: Partial<BookFields> = {}): BookFields {
  return { ...DEFAULT_BOOK_FIELDS, ...over };
}

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: DAY_DRAWER,
    operatorId: "44444444-4444-4444-8444-444444444444",
    operatorName: "Trần Minh Anh",
    openingFloat: 1_000_000n,
    openedAt: "2026-08-20T01:00:00.000Z",
    openingBusinessDate: TODAY,
    cashTaken: 0n,
    cashBookNet: 0n,
    closingCount: null,
    variance: null,
    closedAt: null,
    handoverNote: null,
    ...over,
  };
}

function entry(over: Partial<CashBookEntry> = {}): CashBookEntry {
  return {
    id: AN_ENTRY,
    direction: "EXPENSE",
    category: "SUPPLIES",
    method: "CASH",
    amount: 300_000n,
    businessDate: TODAY,
    shiftId: DAY_DRAWER,
    note: "Hai thùng nước suối.",
    recordedById: "55555555-5555-4555-8555-555555555555",
    recordedByName: "Vũ Minh Khoa",
    recordedAt: "2026-08-20T04:00:00.000Z",
    reversesEntryId: null,
    reversedByEntryId: null,
    ...over,
  };
}

/** The problem a refused attempt carries, or the sentence that says it was not
 *  refused — so a case that meant to assert a refusal cannot pass by getting a
 *  request instead. */
function refusal(attempt: object): string {
  return "problem" in attempt && typeof attempt.problem === "string"
    ? attempt.problem
    : "nothing was refused";
}

describe("who is offered the book", () => {
  it("opens it to the accountant and management and to nobody else", () => {
    // The matrix's *Income / expense (thu chi)* row read literally: `full` for
    // three roles and no entry at all for the other two. A receptionist is
    // absent deliberately — the person holding the money does not book what
    // left the till — and a console offering them the screen would be offering
    // a press that answers 403.
    expect(ROLES.filter(mayKeepTheBook)).toStrictEqual([
      "ACCOUNTANT",
      "MANAGER",
      "ADMIN",
    ]);
  });

  it("refuses the desk and housekeeping", () => {
    expect(mayKeepTheBook("RECEPTIONIST")).toBe(false);
    expect(mayKeepTheBook("HOUSEKEEPING")).toBe(false);
  });
});

describe("which categories belong on a side", () => {
  it("offers wages only as money going out", () => {
    expect(categoriesFor("EXPENSE")).toContain("SALARIES");
    expect(categoriesFor("INCOME")).not.toContain("SALARIES");
  });

  it("offers what the folio never sees only as money coming in", () => {
    expect(categoriesFor("INCOME")).toContain("VENUE_HIRE");
    expect(categoriesFor("EXPENSE")).not.toContain("VENUE_HIRE");
  });

  it("offers the pressure valve on both sides", () => {
    // Money moves for reasons a fixed list does not hold, and the alternative
    // to an admitted `OTHER` is a parking fine filed under supplies.
    expect(categoriesFor("INCOME")).toContain("OTHER");
    expect(categoriesFor("EXPENSE")).toContain("OTHER");
  });

  it("names every category it offers", () => {
    // A `Record` over the union, so a category added to the contract stops the
    // module compiling. This asserts the other half — that no member is
    // labelled with the enum name it came in as.
    for (const category of [
      ...categoriesFor("INCOME"),
      ...categoriesFor("EXPENSE"),
    ]) {
      expect(CATEGORY_LABELS[category]).not.toBe(category);
    }
  });

  it("moves a selection the new side cannot take", () => {
    // Switching to income with `SALARIES` selected would submit a pairing the
    // database refuses, after the amount had been typed.
    const moved = onSide(fields({ category: "SALARIES" }), "INCOME");

    expect(moved.direction).toBe("INCOME");
    expect(categoriesFor("INCOME")).toContain(moved.category);
  });

  it("leaves a selection that is valid on both sides where it is", () => {
    const kept = onSide(fields({ category: "OTHER" }), "INCOME");

    expect(kept.category).toBe("OTHER");
  });
});

describe("the drawer a cash entry names", () => {
  it("clears the till when the money did not move through one", () => {
    // A `shiftId` carried invisibly under a bank transfer is a request the
    // contract refuses, for a choice the operator has already changed.
    const transferred = byMethod(
      fields({ shiftId: DAY_DRAWER }),
      "BANK_TRANSFER",
    );

    expect(transferred.shiftId).toBe("");
  });

  it("keeps the till when the money still moves through one", () => {
    expect(byMethod(fields({ shiftId: DAY_DRAWER }), "CASH").shiftId).toBe(
      DAY_DRAWER,
    );
  });

  it("offers only the drawers nobody has counted out", () => {
    // A counted drawer's variance stands on the count that closed it, and the
    // API refuses cash against one — so offering it would be offering a refusal
    // with money already out of the till.
    const open = openDrawersIn([
      shift(),
      shift({
        id: NIGHT_DRAWER,
        closedAt: "2026-08-20T09:00:00.000Z",
        closingCount: 900_000n,
        variance: -100_000n,
      }),
    ]);

    expect(open.map((drawer) => drawer.id)).toStrictEqual([DAY_DRAWER]);
  });

  it("defaults to the only till there is and to nothing else", () => {
    const one = openDrawersIn([shift()]);
    const two = openDrawersIn([
      shift(),
      shift({ id: NIGHT_DRAWER, openedAt: "2026-08-20T13:00:00.000Z" }),
    ]);

    expect(theOnlyOpenDrawer(one)).toBe(DAY_DRAWER);
    // Two open drawers is a day and a night shift overlapping, and choosing for
    // the accountant would put đồng on the wrong handover half the time.
    expect(theOnlyOpenDrawer(two)).toBeNull();
    expect(theOnlyOpenDrawer([])).toBeNull();
  });
});

describe("what an operator typed into the recording form", () => {
  it("builds the request the API takes", () => {
    const attempt = entryAttempt(
      fields({ amount: "300.000", shiftId: DAY_DRAWER, note: "  Nước suối  " }),
      TODAY,
    );

    expect(attempt).toStrictEqual({
      input: {
        direction: "EXPENSE",
        category: "SUPPLIES",
        method: "CASH",
        // Decimal text, per `money.ts`, because a JSON number would round a
        // figure in đồng that has no minor unit to round into.
        amount: "300000",
        businessDate: undefined,
        shiftId: DAY_DRAWER,
        note: "Nước suối",
      },
    });
  });

  it("leaves the trading day to the server where none was typed", () => {
    // A console filling in its own answer would be a second opinion about the
    // property's rollover, computed at 01:30 against the browser's calendar.
    const attempt = entryAttempt(
      fields({ amount: "50000", shiftId: DAY_DRAWER, note: "Taxi" }),
      TODAY,
    );

    expect("input" in attempt && attempt.input.businessDate).toBeUndefined();
  });

  it("reads a typed day against the property's own", () => {
    const attempt = entryAttempt(
      fields({
        amount: "50000",
        shiftId: DAY_DRAWER,
        note: "Taxi",
        businessDate: "19/8",
      }),
      TODAY,
    );

    expect("input" in attempt && attempt.input.businessDate).toBe("2026-08-19");
  });

  it("refuses an amount that is not a quantity of đồng", () => {
    expect(refusal(entryAttempt(fields({ amount: "" }), TODAY))).toContain(
      "whole number of đồng",
    );
    // A comma is the vi-VN decimal mark, and a minor unit the currency does not
    // have — read as a grouping mark it would record a hundredfold.
    expect(refusal(entryAttempt(fields({ amount: "300,5" }), TODAY))).toContain(
      "whole number of đồng",
    );
  });

  it("refuses nothing at all, where a drawer count accepts it", () => {
    // A till counted at nothing is a fact somebody established; a movement of
    // nothing is not a movement.
    expect(refusal(entryAttempt(fields({ amount: "0" }), TODAY))).toContain(
      "above nothing",
    );
  });

  it("refuses cash that names no till", () => {
    const attempt = entryAttempt(
      fields({ amount: "300000", note: "Nước suối" }),
      TODAY,
    );

    expect(refusal(attempt)).toContain("name the drawer");
  });

  it("takes a bank transfer with no till at all", () => {
    const attempt = entryAttempt(
      fields({
        direction: "EXPENSE",
        category: "SALARIES",
        method: "BANK_TRANSFER",
        amount: "8000000",
        note: "Lương tháng 8",
      }),
      TODAY,
    );

    expect("input" in attempt && attempt.input.shiftId).toBeNull();
  });

  it("refuses an entry that says nothing about itself", () => {
    const attempt = entryAttempt(
      fields({ amount: "300000", shiftId: DAY_DRAWER, note: "   " }),
      TODAY,
    );

    // The book cannot be edited afterwards, so the explanation cannot be added
    // later either.
    expect(refusal(attempt)).toContain("what the money was for");
  });

  it("refuses a category the chosen side cannot take", () => {
    const attempt = entryAttempt(
      fields({
        direction: "INCOME",
        category: "SALARIES",
        method: "BANK_TRANSFER",
        amount: "8000000",
        note: "Lương tháng 8",
      }),
      TODAY,
    );

    expect(refusal(attempt)).toContain("not booked as");
  });
});

describe("undoing an entry", () => {
  it("carries only the entry, the till open now and the reason", () => {
    const attempt = reversalAttempt(entry(), {
      shiftId: NIGHT_DRAWER,
      note: "  Ghi trùng.  ",
    });

    // No amount, no category and no method: they are the original's, read by
    // the API off the row. A form that took them would be recording a second,
    // unrelated movement while calling it a correction.
    expect(attempt).toStrictEqual({
      input: {
        entryId: AN_ENTRY,
        shiftId: NIGHT_DRAWER,
        note: "Ghi trùng.",
      },
    });
  });

  it("refuses a correction to a cash entry that names no till", () => {
    const attempt = reversalAttempt(entry(), {
      shiftId: "",
      note: "Ghi trùng.",
    });

    expect(refusal(attempt)).toContain("drawer that is open now");
  });

  it("names no till at all when the original moved none", () => {
    const attempt = reversalAttempt(entry({ method: "BANK_TRANSFER" }), {
      shiftId: "",
      note: "Chuyển nhầm.",
    });

    expect("input" in attempt && attempt.input.shiftId).toBeNull();
  });

  it("refuses a correction with no account of why", () => {
    const attempt = reversalAttempt(entry(), {
      shiftId: NIGHT_DRAWER,
      note: "",
    });

    expect(refusal(attempt)).toContain("why this is being undone");
  });
});

describe("the question the filters ask", () => {
  it("opens on the whole book", () => {
    const asked = bookQuestion(DEFAULT_BOOK_FIELDS, null, 0);

    expect(asked).toStrictEqual({
      query: {
        from: undefined,
        to: undefined,
        direction: undefined,
        category: undefined,
        method: undefined,
        limit: 50,
        offset: 0,
      },
    });
  });

  it("narrows on the days, the side, the category and the method", () => {
    const asked = bookQuestion(
      filters({
        from: "1/8",
        to: "20/8",
        direction: "EXPENSE",
        category: "UTILITIES",
        method: "BANK_TRANSFER",
      }),
      TODAY,
      50,
    );

    expect(asked).toStrictEqual({
      query: {
        from: "2026-08-01",
        to: "2026-08-20",
        direction: "EXPENSE",
        category: "UTILITIES",
        method: "BANK_TRANSFER",
        limit: 50,
        offset: 50,
      },
    });
  });

  it("refuses a range that ends before it begins", () => {
    const asked = bookQuestion(filters({ from: "20/8", to: "1/8" }), TODAY, 0);

    expect(refusal(asked)).toContain("falls before the first");
  });

  it("refuses a day it cannot read", () => {
    const asked = bookQuestion(filters({ from: "sometime" }), TODAY, 0);

    expect(refusal(asked)).toContain("first day of interest");
  });
});

describe("what the filtered book came to", () => {
  it("nets the two sides the page sends gross", () => {
    // The API sends both sides separately on purpose: a single net figure would
    // hide a month that took eighty million and spent seventy-nine behind one
    // that moved nothing at all.
    expect(
      netOfTheBook({ incomeTotal: 80_000_000n, expenseTotal: 79_000_000n }),
    ).toBe(1_000_000n);
  });

  it("goes below nothing on the ordinary month", () => {
    expect(netOfTheBook({ incomeTotal: 0n, expenseTotal: 12_400_000n })).toBe(
      -12_400_000n,
    );
  });
});
