/* The record link, written and read back.
 *
 * Two properties are worth a test and the rest is a string. The first is the
 * contract's refinement: `contract/audit.ts` refuses a `rowId` with no
 * `tableName`, because `audit_entry_row_idx` is on the pair and half an address
 * is the wider scan. Nothing the console links to or lands on may be that
 * shape, and the assertions below check both directions of it rather than
 * trusting that the types do.
 *
 * The second is that a url is something anyone can type. A bookmark kept for a
 * month, a chat message with a bracket swallowed, a parameter repeated by a
 * form — every one of them has to open the sweep screen rather than a crash or
 * a question the route would answer with a 400.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIT_FILTERS } from "./change-log";
import {
  RECORD_TABLES,
  recordHistoryFilters,
  recordHistoryHref,
} from "./record-history";

/** A row id in the spelling Postgres writes one. */
const A_ROW = "11111111-1111-4111-8111-111111111111";

describe("recordHistoryHref", () => {
  it("names the table and the row the audit screen filters on", () => {
    expect(recordHistoryHref(RECORD_TABLES.booking, A_ROW)).toBe(
      `/audit?tableName=booking&rowId=${A_ROW}`,
    );
  });

  it("addresses the account the invoice number is a column of", () => {
    // `schema/folio.ts` writes `folio.invoice_reference` on the account's own
    // row, so the invoice has no table of its own and the folio's history is
    // the invoice's history.
    expect(recordHistoryHref(RECORD_TABLES.folio, A_ROW)).toContain(
      "tableName=folio",
    );
  });

  it("escapes what it puts in the query string", () => {
    expect(recordHistoryHref(RECORD_TABLES.guest, "a b&c=d")).toBe(
      "/audit?tableName=guest&rowId=a+b%26c%3Dd",
    );
  });
});

describe("recordHistoryFilters", () => {
  it("opens on the record a history link named", () => {
    expect(
      recordHistoryFilters({ tableName: "booking", rowId: A_ROW }),
    ).toEqual({
      ...DEFAULT_AUDIT_FILTERS,
      tableName: "booking",
      rowId: A_ROW,
    });
  });

  it("reads back the url it writes", () => {
    const href = recordHistoryHref(RECORD_TABLES.guest, A_ROW);
    const query = new URL(href, "https://console.invalid").searchParams;

    expect(recordHistoryFilters(Object.fromEntries(query.entries()))).toEqual({
      ...DEFAULT_AUDIT_FILTERS,
      tableName: "guest",
      rowId: A_ROW,
    });
  });

  it("leaves the sweep screen unfiltered when nothing was asked", () => {
    expect(recordHistoryFilters({})).toEqual(DEFAULT_AUDIT_FILTERS);
  });

  it("refuses a row with no table, which is the scan the contract forbids", () => {
    expect(recordHistoryFilters({ rowId: A_ROW })).toEqual(
      DEFAULT_AUDIT_FILTERS,
    );
  });

  it("drops the whole address when the row is not a record id", () => {
    // Not the table on its own: the link was written to ask about one record,
    // and every change to every booking is a different question.
    expect(
      recordHistoryFilters({ tableName: "booking", rowId: "not-an-id" }),
    ).toEqual(DEFAULT_AUDIT_FILTERS);
  });

  it("takes a table with no row, which is the log of one kind of record", () => {
    expect(recordHistoryFilters({ tableName: " folio " })).toEqual({
      ...DEFAULT_AUDIT_FILTERS,
      tableName: "folio",
    });
  });

  it("ignores a table no Postgres could name", () => {
    expect(recordHistoryFilters({ tableName: "f".repeat(64) })).toEqual(
      DEFAULT_AUDIT_FILTERS,
    );
  });

  it("treats a repeated parameter as none, two records being one too many", () => {
    expect(
      recordHistoryFilters({
        tableName: ["booking", "folio"],
        rowId: A_ROW,
      }),
    ).toEqual(DEFAULT_AUDIT_FILTERS);
  });

  it("treats an empty parameter as absent", () => {
    expect(recordHistoryFilters({ tableName: "", rowId: A_ROW })).toEqual(
      DEFAULT_AUDIT_FILTERS,
    );
  });

  it("never carries a day, an actor or an act in from a url", () => {
    // The sweep's filters belong to the person doing the sweep. A link narrows
    // to the thing somebody had a question about and leaves the rest of the
    // log's width where the reader can see it.
    expect(
      recordHistoryFilters({
        tableName: "guest",
        rowId: A_ROW,
        day: "2027-09-15",
        actorId: A_ROW,
        action: "DELETE",
      }),
    ).toEqual({ ...DEFAULT_AUDIT_FILTERS, tableName: "guest", rowId: A_ROW });
  });
});
