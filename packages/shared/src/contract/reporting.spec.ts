// What holds an export's filters to the filters of the list it exports.
//
// `reporting.ts` claims each export input is its list's input with the paging
// taken out. That claim is the whole of "the filters on screen are the filters
// in the file", and it is exactly the kind of claim that decays quietly: a
// filter added to `listCashBookEntriesInput` next year would still compile
// here, still work on screen, and silently stop reaching the spreadsheet — an
// export answering a wider question than the one the operator asked, which is
// the failure that is worst because it looks like a success.
//
// So the two shapes are compared field for field rather than eyeballed, and the
// only difference permitted is the page.

import { describe, expect, it } from "vitest";

import { listAuditEntriesInput } from "./audit.js";
import { listCashBookEntriesInput } from "./finance.js";
import { listShiftHistoryInput } from "./operations.js";
import {
  cashBookExportInput,
  changeLogExportInput,
  excelExportFileName,
  shiftHistoryExportInput,
} from "./reporting.js";

/** What a list carries that an export has no use for: an export answers with
 *  everything the filters match, so there is no page for these to name. */
const PAGING = ["limit", "offset"];

function filtersOf(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape)
    .filter((field) => !PAGING.includes(field))
    .sort();
}

describe("an export's filters", () => {
  it("are the cash book list's filters without its page", () => {
    expect(filtersOf(cashBookExportInput)).toEqual(
      filtersOf(listCashBookEntriesInput),
    );
  });

  it("are the shift history's filters without its page", () => {
    expect(filtersOf(shiftHistoryExportInput)).toEqual(
      filtersOf(listShiftHistoryInput),
    );
  });

  it("are the change log's filters without its page", () => {
    expect(filtersOf(changeLogExportInput)).toEqual(
      filtersOf(listAuditEntriesInput),
    );
  });

  it("carry no page of their own", () => {
    for (const schema of [
      cashBookExportInput,
      shiftHistoryExportInput,
      changeLogExportInput,
    ]) {
      expect(Object.keys(schema.shape)).not.toContain("limit");
      expect(Object.keys(schema.shape)).not.toContain("offset");
    }
  });
});

describe("the cash book export's shape", () => {
  it("takes the trading days a screen would have submitted", () => {
    const parsed = cashBookExportInput.parse({
      from: "2026-08-01",
      to: "2026-08-31",
      category: "SUPPLIES",
    });

    expect(parsed.from?.toString()).toBe("2026-08-01");
    expect(parsed.to?.toString()).toBe("2026-08-31");
    expect(parsed.category).toBe("SUPPLIES");
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      cashBookExportInput.safeParse({ from: "2026-08-31", to: "2026-08-01" })
        .success,
    ).toBe(false);
  });

  it("takes no filter at all — the whole book is a legitimate question", () => {
    expect(cashBookExportInput.safeParse({}).success).toBe(true);
  });
});

describe("the change log export's shape", () => {
  it("refuses a row id with no table beside it, as the list does", () => {
    expect(
      changeLogExportInput.safeParse({
        rowId: "6f1a3f2e-0a1f-4a4e-9a1a-2b3c4d5e6f70",
      }).success,
    ).toBe(false);
  });

  it("refuses a window that closes before it opens", () => {
    expect(
      changeLogExportInput.safeParse({
        from: "2026-08-20T00:00:00.000Z",
        to: "2026-08-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("the name a downloaded export lands under", () => {
  it("carries the stem and the day it was taken", () => {
    expect(excelExportFileName("cash-book", "2026-08-20")).toBe(
      "cash-book-2026-08-20.xlsx",
    );
  });
});
