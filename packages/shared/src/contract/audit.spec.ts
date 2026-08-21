// What a reader of the change log may ask for, and the three things they may
// not.
//
// The first is half an address. `audit_entry_row_idx` is on the pair, so a row
// id without the table it is in is the narrower-looking half doing the wider
// scan — and every caller holding a row id got it from a record, which means it
// holds the table too. A viewer that accepted the half-address would appear to
// work and take a second longer every month.
//
// The second is a window that runs backwards. Both ends are optional on their
// own; given together they have to name a stretch of time that exists, and the
// refusal is a sentence for whoever built the link rather than an empty page
// nobody can account for.
//
// The third is a page bigger than the route will cut. The ceiling is stated on
// the shape so an over-large `limit` is a 400 with a number in it, rather than a
// query that reads two thousand rows because somebody typed a zero too many.
//
// The defaults are asserted beside them, because a caller that names no page is
// the ordinary caller: the console's first request carries filters and nothing
// else, and a `limit` that arrived as `undefined` would be a page of the whole
// table.

import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  LONGEST_AUDIT_PAGE,
  listAuditEntriesInput,
  readAuditEntryInput,
} from "./audit.js";

/** A row of some table, addressed the way a history link addresses one. */
const A_RECORD = {
  tableName: "rate_calendar",
  rowId: "0d1a3f5c-4b8e-4a2d-9c1f-6e7b8a9d0c11",
};

describe("asking the change log about a record", () => {
  it("takes the table and the row together", () => {
    const asked = listAuditEntriesInput.parse(A_RECORD);

    expect(asked.tableName).toBe("rate_calendar");
    expect(asked.rowId).toBe(A_RECORD.rowId);
  });

  it("refuses a row id with no table beside it", () => {
    const refused = listAuditEntriesInput.safeParse({ rowId: A_RECORD.rowId });

    expect(refused.success).toBe(false);
  });

  it("takes a table on its own, which is the sweep's question", () => {
    // Everything that has ever happened to the rate calendar is a question with
    // an index behind it; it is only the row without the table that is not.
    const asked = listAuditEntriesInput.parse({ tableName: "rate_calendar" });

    expect(asked.rowId).toBeUndefined();
  });

  it("refuses a table name no table could have", () => {
    // Postgres' own identifier limit. Longer than this matches no row at any
    // price, so the refusal costs a caller nothing they could have had.
    const refused = listAuditEntriesInput.safeParse({
      tableName: "r".repeat(64),
    });

    expect(refused.success).toBe(false);
  });
});

describe("the window a sweep reads over", () => {
  it("takes two instants and keeps them as written", () => {
    const asked = listAuditEntriesInput.parse({
      from: "2027-09-15T00:00:00.000Z",
      to: "2027-09-16T00:00:00.000Z",
    });

    expect(asked.from).toBe("2027-09-15T00:00:00.000Z");
    expect(asked.to).toBe("2027-09-16T00:00:00.000Z");
  });

  it("takes either end on its own", () => {
    expect(
      listAuditEntriesInput.safeParse({ from: "2027-09-15T00:00:00.000Z" })
        .success,
    ).toBe(true);
    expect(
      listAuditEntriesInput.safeParse({ to: "2027-09-15T00:00:00.000Z" })
        .success,
    ).toBe(true);
  });

  it("refuses a window that runs backwards", () => {
    const refused = listAuditEntriesInput.safeParse({
      from: "2027-09-16T00:00:00.000Z",
      to: "2027-09-15T00:00:00.000Z",
    });

    expect(refused.success).toBe(false);
  });

  it("refuses a window of no width, which no entry can fall in", () => {
    // Half-open, so `from === to` selects nothing at all. A filter that can only
    // ever answer empty is a link somebody built wrong, and saying so is more
    // use than the empty page.
    const refused = listAuditEntriesInput.safeParse({
      from: "2027-09-15T00:00:00.000Z",
      to: "2027-09-15T00:00:00.000Z",
    });

    expect(refused.success).toBe(false);
  });

  it("refuses a date where an instant belongs", () => {
    // The property's day is not the calendar's, and a bare date would leave the
    // API to guess which. The console converts the day somebody picked into two
    // instants in the property's own zone before it asks.
    const refused = listAuditEntriesInput.safeParse({ from: "2027-09-15" });

    expect(refused.success).toBe(false);
  });
});

describe("the page", () => {
  it("hands a caller who named none the screenful the route defaults to", () => {
    const asked = listAuditEntriesInput.parse({});

    expect(asked.limit).toBe(AUDIT_PAGE_SIZE);
    expect(asked.offset).toBe(0);
  });

  it("coerces the two figures a query string carries as text", () => {
    const asked = listAuditEntriesInput.parse({ limit: "10", offset: "20" });

    expect(asked.limit).toBe(10);
    expect(asked.offset).toBe(20);
  });

  it("refuses a page larger than the route will cut", () => {
    const refused = listAuditEntriesInput.safeParse({
      limit: LONGEST_AUDIT_PAGE + 1,
    });

    expect(refused.success).toBe(false);
  });

  it("refuses a negative offset, which is not a place in a list", () => {
    expect(listAuditEntriesInput.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("asking for one entry", () => {
  it("takes the entry's own id and nothing else", () => {
    const asked = readAuditEntryInput.parse({
      auditEntryId: A_RECORD.rowId,
      tableName: "rate_calendar",
    });

    expect(asked.auditEntryId).toBe(A_RECORD.rowId);
    expect("tableName" in asked).toBe(false);
  });

  it("refuses anything that is not an entry id", () => {
    expect(readAuditEntryInput.safeParse({ auditEntryId: "42" }).success).toBe(
      false,
    );
  });
});
