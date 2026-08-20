/* What holds a file to the screen that asked for it.
 *
 * `excelExportSearch` is the only place the console decides what an export is
 * asked for, and the property it has to hold is one sentence: everything the
 * operator filtered by reaches the file, and nothing else changes. Every case
 * below is a way that could quietly stop being true — a page carried into a
 * request that has none, a cleared field sent as an empty value the API refuses,
 * a filter of a shape nobody thought about.
 *
 * The download itself is not asserted here, which is `vitest.config.ts`'s own
 * line: an anchor click and an object url are browser behaviour, and jsdom is
 * not evidence about them.
 */

import { describe, expect, it } from "vitest";

import { excelExportSearch, mayTakeAnExport } from "./excel-export";

/** The query the finance screen submits, as the client types it. */
const A_CASH_BOOK_QUESTION = {
  from: "2026-08-01",
  to: "2026-08-31",
  direction: "EXPENSE",
  category: "SUPPLIES",
  method: undefined,
  limit: 50,
  offset: 100,
};

describe("the filters an export is asked for", () => {
  it("carries every filter the screen submitted", () => {
    const search = new URLSearchParams(excelExportSearch(A_CASH_BOOK_QUESTION));

    expect(search.get("from")).toBe("2026-08-01");
    expect(search.get("to")).toBe("2026-08-31");
    expect(search.get("direction")).toBe("EXPENSE");
    expect(search.get("category")).toBe("SUPPLIES");
  });

  it("leaves the page behind — an export has no page", () => {
    const search = new URLSearchParams(excelExportSearch(A_CASH_BOOK_QUESTION));

    expect(search.has("limit")).toBe(false);
    expect(search.has("offset")).toBe(false);
  });

  it("drops a filter the operator cleared rather than sending it empty", () => {
    const search = new URLSearchParams(
      excelExportSearch({ tableName: "", rowId: undefined, actorId: null }),
    );

    expect(search.has("tableName")).toBe(false);
    expect(search.has("rowId")).toBe(false);
    expect(search.has("actorId")).toBe(false);
  });

  it("asks for the whole list when nothing was filtered", () => {
    expect(excelExportSearch({ limit: 50, offset: 0 })).toBe("");
  });

  it("escapes what an operator typed", () => {
    const search = new URLSearchParams(
      excelExportSearch({ tableName: "rate calendar & co" }),
    );

    expect(search.get("tableName")).toBe("rate calendar & co");
  });

  it("refuses a filter it cannot carry rather than dropping it", () => {
    expect(() => excelExportSearch({ operator: { id: "abc" } })).toThrow(
      /not something an export can carry/,
    );
  });

  it("carries a filter that is a number, since a screen may hold one", () => {
    const search = new URLSearchParams(excelExportSearch({ year: 2026 }));

    expect(search.get("year")).toBe("2026");
  });
});

describe("who the console offers an export to", () => {
  it("offers it to everybody the matrix's Excel export row names", () => {
    for (const role of [
      "RECEPTIONIST",
      "ACCOUNTANT",
      "MANAGER",
      "ADMIN",
    ] as const) {
      expect(mayTakeAnExport(role)).toBe(true);
    }
  });

  it("offers it to nobody the row leaves out", () => {
    expect(mayTakeAnExport("HOUSEKEEPING")).toBe(false);
  });
});
