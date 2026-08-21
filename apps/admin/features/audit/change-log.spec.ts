/* What the audit screen decides for itself, and the one thing it must never do
 * to a value it was handed.
 *
 * The last is the reason this file exists at all. A snapshot column arrives as
 * the characters Postgres holds — `audit.service.ts` refuses to let the driver
 * parse `jsonb` and `contract/audit.ts` refuses to carry an object — and the
 * console is the last place a đồng amount could be taken through a JavaScript
 * `number` and come back a different figure. So {@link valueLabel} is asserted
 * against a figure with more significant digits than a `number` can hold, and
 * the assertion names what a `number` would have made of it rather than merely
 * checking equality: a regression should say what happened to the value.
 *
 * Beside it, the two judgements the screen makes before it asks anything. A
 * record is a table and a row together, because the index behind it is on the
 * pair and because half an address is a scan; and a day picked in a filter is a
 * day in Ho Chi Minh City rather than in whatever zone the browser is set to,
 * turned into the half-open window the route takes.
 */

import { describe, expect, it } from "vitest";

import {
  actorLabel,
  auditFilters,
  type ChangedField,
  changedCount,
  changedFirst,
  DEFAULT_AUDIT_FILTERS,
  dayWindow,
  type LoggedChange,
  mayReadTheLog,
  NOTHING,
  valueLabel,
} from "./change-log";

/** The property's day every relative expression below is counted from. */
const TODAY = "2027-09-15";

/** A row id in the spelling Postgres writes one. */
const A_ROW = "11111111-1111-4111-8111-111111111111";
const AN_ACTOR = "22222222-2222-4222-8222-222222222222";

/** A stay total with more significant digits than a JavaScript `number` can
 *  hold — seventeen, where `Number.MAX_SAFE_INTEGER` runs out at sixteen. */
const AN_UNROUNDABLE_AMOUNT = "12345678901234567";

function aField(field: Partial<ChangedField>): ChangedField {
  return {
    column: "price_gross",
    before: "1200000",
    after: "1300000",
    changed: true,
    ...field,
  };
}

function aChange(change: Partial<LoggedChange>): LoggedChange {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    actorKind: "staff",
    actorId: AN_ACTOR,
    actorName: "Nguyễn Thị Hạnh",
    occurredAt: "2027-09-15T03:00:00.000Z",
    tableName: "rate_calendar",
    rowId: A_ROW,
    action: "UPDATE",
    ...change,
  };
}

describe("drawing a value out of a snapshot", () => {
  it("hands back a đồng amount with every digit it arrived with", () => {
    // The sharpest thing this family promises. Postgres `jsonb` numbers are
    // arbitrary precision; a JavaScript `number` is not.
    expect(valueLabel(AN_UNROUNDABLE_AMOUNT)).toBe(AN_UNROUNDABLE_AMOUNT);
    // Named rather than merely avoided, so a regression says what happened to
    // the figure instead of failing on an opaque mismatch.
    expect(valueLabel(AN_UNROUNDABLE_AMOUNT)).not.toBe(
      String(Number(AN_UNROUNDABLE_AMOUNT)),
    );
  });

  it("does not group, round or re-space a figure it was given", () => {
    // No thousands separator and no currency mark: a snapshot column is untyped
    // text out of an arbitrary table, and the console does not know whether it
    // is holding đồng, a room number or a percentage in basis points.
    expect(valueLabel("1200000")).toBe("1200000");
    expect(valueLabel("0.5")).toBe("0.5");
  });

  it("draws a column that held nothing as a mark rather than as a word", () => {
    // The cell beside it may legitimately hold the text "null", which is why
    // the absent value is not spelled that way.
    expect(valueLabel(null)).toBe(NOTHING);
    expect(valueLabel("null")).toBe("null");
  });
});

describe("who made the change", () => {
  it("names the member of staff", () => {
    expect(actorLabel(aChange({}))).toBe("Nguyễn Thị Hạnh");
  });

  it("names the property itself for a change nobody made", () => {
    // A sweep, a scheduled job, a gateway's callback. `schema/audit.ts` argues
    // that a placeholder account here would make an unattributable write
    // indistinguishable from an attributed one.
    const swept = aChange({
      actorKind: "system",
      actorId: null,
      actorName: null,
    });

    expect(actorLabel(swept)).toBe("The property itself");
  });

  it("does not pass off a departed colleague as the property", () => {
    // The two are different facts and the log exists to keep them apart.
    const gone = aChange({ actorName: null });

    expect(actorLabel(gone)).not.toBe("The property itself");
  });
});

describe("the columns of one change", () => {
  const fields = [
    aField({ column: "id", changed: false }),
    aField({ column: "price_gross", changed: true }),
    aField({ column: "stay_date", changed: false }),
    aField({ column: "updated_reason", changed: true }),
  ];

  it("puts the columns that moved first", () => {
    expect(changedFirst(fields).map((field) => field.column)).toEqual([
      "price_gross",
      "updated_reason",
      "id",
      "stay_date",
    ]);
  });

  it("keeps the route's own order inside each half", () => {
    // The route hands the columns back in name order, and this only ever
    // partitions them — so the same change draws the same way twice.
    const twice = changedFirst(changedFirst(fields));

    expect(twice.map((field) => field.column)).toEqual(
      changedFirst(fields).map((field) => field.column),
    );
  });

  it("drops nothing", () => {
    // Every column is drawn, touched or not: the guest's name beside the amount
    // is how somebody recognises the row they are reading about.
    expect(changedFirst(fields)).toHaveLength(fields.length);
  });

  it("counts what actually moved", () => {
    expect(changedCount(fields)).toBe(2);
    expect(changedCount([])).toBe(0);
  });
});

describe("the day a filter names", () => {
  it("is a day in the property's zone and not the browser's", () => {
    // Midnight in Ho Chi Minh City is 17:00 UTC the day before. A console open
    // on a laptop somebody brought back from a conference would otherwise read
    // a different day than the desk beside it.
    expect(dayWindow("2027-09-15").from).toBe("2027-09-14T17:00:00.000Z");
  });

  it("is half-open, so a reader stepping day by day sees midnight once", () => {
    const first = dayWindow("2027-09-15");
    const second = dayWindow("2027-09-16");

    expect(first.to).toBe(second.from);
  });

  it("is exactly a day wide", () => {
    const { from, to } = dayWindow("2027-09-15");

    expect(Date.parse(to) - Date.parse(from)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("building the question", () => {
  it("asks for the whole log when nothing is filtered", () => {
    const attempt = auditFilters(DEFAULT_AUDIT_FILTERS, TODAY, 0);

    expect("problem" in attempt).toBe(false);

    if ("problem" in attempt) {
      return;
    }

    expect(attempt.question.day).toBeNull();
    expect(attempt.question.input.tableName).toBeUndefined();
    expect(attempt.question.input.from).toBeUndefined();
    expect(attempt.question.input.offset).toBe(0);
  });

  it("takes a table and a row together, which is what a record link carries", () => {
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, tableName: "rate_calendar", rowId: A_ROW },
      TODAY,
      0,
    );

    if ("problem" in attempt) {
      throw new Error(attempt.problem);
    }

    expect(attempt.question.input.tableName).toBe("rate_calendar");
    expect(attempt.question.input.rowId).toBe(A_ROW);
  });

  it("refuses a row with no table beside it", () => {
    // The contract refuses it too; saying so here is what turns a 400 into a
    // sentence under the field that the person who typed it can act on.
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, rowId: A_ROW },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("takes a table on its own, which is the sweep's question", () => {
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, tableName: "payment" },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(false);
  });

  it("refuses an id that is not one", () => {
    expect(
      "problem" in
        auditFilters(
          { ...DEFAULT_AUDIT_FILTERS, tableName: "payment", rowId: "42" },
          TODAY,
          0,
        ),
    ).toBe(true);

    expect(
      "problem" in
        auditFilters({ ...DEFAULT_AUDIT_FILTERS, actorId: "42" }, TODAY, 0),
    ).toBe(true);
  });

  it("resolves a relative day against the property's own", () => {
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, day: "yesterday" },
      TODAY,
      0,
    );

    if ("problem" in attempt) {
      throw new Error(attempt.problem);
    }

    expect(attempt.question.day).toBe("2027-09-14");
    expect(attempt.question.input.from).toBe("2027-09-13T17:00:00.000Z");
    expect(attempt.question.input.to).toBe("2027-09-14T17:00:00.000Z");
  });

  it("stops on a day it cannot read rather than answering with every day", () => {
    // A filter the operator believes is in force, silently ignored, is worse
    // than a refusal: the whole log would come back looking like one day's.
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, day: "sometime last spring" },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("holds a relative day until the property's own has been read", () => {
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, day: "today" },
      null,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });

  it("still asks the unfiltered question before the property's day arrives", () => {
    // Nothing in the defaults is counted from the day, so the screen opens on
    // the log rather than on a wait for a date it is not going to use.
    expect("problem" in auditFilters(DEFAULT_AUDIT_FILTERS, null, 0)).toBe(
      false,
    );
  });

  it("carries the offset the pager asked for", () => {
    const attempt = auditFilters(DEFAULT_AUDIT_FILTERS, TODAY, 100);

    if ("problem" in attempt) {
      throw new Error(attempt.problem);
    }

    expect(attempt.question.input.offset).toBe(100);
  });

  it("refuses a table name no table could have", () => {
    const attempt = auditFilters(
      { ...DEFAULT_AUDIT_FILTERS, tableName: "r".repeat(64) },
      TODAY,
      0,
    );

    expect("problem" in attempt).toBe(true);
  });
});

describe("who is offered the screen", () => {
  it("offers it to the three roles the matrix grants the row", () => {
    expect(mayReadTheLog("ACCOUNTANT")).toBe(true);
    expect(mayReadTheLog("MANAGER")).toBe(true);
    expect(mayReadTheLog("ADMIN")).toBe(true);
  });

  it("does not offer it to the desk or the floor", () => {
    // Not a wall — the API's capability guard is the wall. This is whether a
    // screen is drawn for somebody it would refuse.
    expect(mayReadTheLog("RECEPTIONIST")).toBe(false);
    expect(mayReadTheLog("HOUSEKEEPING")).toBe(false);
  });
});
