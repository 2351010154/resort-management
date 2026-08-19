// What the shift declarations promise, and what is left to a database.
//
// Three claims carry this file, and each of them is a rule that would otherwise
// be a habit in a service.
//
// The first is that one person cannot have two drawers open. Declared without
// `unique` the table accepts as many open shifts as the desk double-clicks;
// declared without the `where` the property gets one shift per receptionist ever
// and the second day at work is a `23505`. The two are separate mistakes and
// both are asserted below.
//
// The second is that a shift is closed exactly when it was counted, and the
// third is that cash is in a drawer and nothing else is. Both are biconditional
// checks, and the payment one is asserted over its *text* rather than only its
// name: written as a list of the methods that are exempt it would pass every
// test here and refuse the first payment taken through the next gateway the
// property adds. The shape is the point, so the shape is what is tested.
//
// Whether Postgres actually refuses a second open shift while the first insert
// is still in flight is a question about the migration and about row locks, and
// no assertion over a schema object can answer it. That belongs to an
// end-to-end test against a real database, as `payment.spec.ts` says of its own
// index.

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { payment } from "./payment.js";
import { pendingItem, shift } from "./shift.js";

const dialect = new PgDialect();

function checkNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).checks.map((declared) => declared.name);
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): string {
  const declared = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  );

  if (!declared) {
    throw new Error(`no check named ${name}`);
  }

  return dialect.sqlToQuery(declared.value).sql;
}

function indexColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): string[] {
  const declared = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name,
  );

  // An index may be built on an expression rather than a column, so the
  // declaration is a union and the name has to be asked for rather than
  // assumed. An expression here would be a different index than the one this
  // file is about.
  return (declared?.config.columns ?? []).map((column) =>
    "name" in column && typeof column.name === "string"
      ? column.name
      : "(expression)",
  );
}

const openShiftIndex = getTableConfig(shift).indexes.find(
  (declared) => declared.config.name === "shift_one_open_per_operator",
);

describe("one open drawer per person", () => {
  it("is unique, so two presses of open cannot both succeed", () => {
    // Both requests read the table, both find no open shift, and both insert.
    // Between the read and the insert there is nothing holding the key, so a
    // guard in the service cannot prevent it — the index can.
    expect(openShiftIndex?.config.unique).toBe(true);
    expect(indexColumns(shift, "shift_one_open_per_operator")).toEqual([
      "operator_id",
    ]);
  });

  it("is partial, so a receptionist may work more than one day", () => {
    // Keyed on the operator alone, the second shift anybody ever opened would
    // collide with their first. The predicate says which rows the rule is
    // about, rather than leaving it to a convention about nulls.
    expect(openShiftIndex?.config.where).toBeDefined();
  });

  it("keeps the operator's own history and the property's readable", () => {
    const names = getTableConfig(shift).indexes.map(
      (declared) => declared.config.name,
    );

    expect(names).toContain("shift_operator_idx");
    expect(names).toContain("shift_opened_at_idx");
  });
});

describe("the drawer's two figures", () => {
  it("counts đồng as integers that survive being summed", () => {
    // `NFR-12`, as every money column in this schema carries it. A float that
    // is out by a đồng makes the variance computed from it out by a đồng, with
    // nothing to trace it to.
    expect(shift.openingFloat.getSQLType()).toBe("bigint");
    expect(shift.openingFloat.dataType).toBe("bigint");
    expect(shift.closingCount.getSQLType()).toBe("bigint");
    expect(shift.closingCount.dataType).toBe("bigint");
  });

  it("demands the float and leaves the count until the shift ends", () => {
    // The drawer is counted before the first guest, so there is no such thing
    // as an open shift with no float. The closing count is what "open" means
    // the absence of.
    expect(shift.openingFloat.notNull).toBe(true);
    expect(shift.closingCount.notNull).toBe(false);
    expect(shift.closedAt.notNull).toBe(false);
  });

  it("closes a shift exactly when it was counted", () => {
    // Both directions. A count with no closing time leaves the shift open to
    // the next cash payment, which lands in a drawer already counted; a closing
    // time with no count is a drawer nobody counted.
    expect(checkNames(shift)).toContain("shift_closed_exactly_when_counted");
    expect(checkSql(shift, "shift_closed_exactly_when_counted")).toContain(
      "is null) = (",
    );
  });

  it("stores the business date it opened under rather than deriving it", () => {
    // The roll hour is editable, and a shift that changed which day it belonged
    // to would move cash between two days' takings after both were reported. A
    // `date` and not a timestamp: this is a day in a place, not an instant.
    expect(shift.openingBusinessDate.getSQLType()).toBe("date");
    expect(shift.openingBusinessDate.notNull).toBe(true);
  });

  it("names somebody answerable for every drawer", () => {
    expect(shift.operatorId.notNull).toBe(true);
  });
});

describe("what the shift refuses to store", () => {
  it("keeps no variance and no running total of the cash taken", () => {
    // Both are queries over the payments that name the shift. A stored total is
    // correct at the instant it was frozen and has to be maintained by whoever
    // remembers to; a variance that has quietly stopped tracking its payments
    // is worse than none, because the desk trusts it.
    const columns = Object.keys(shift).join(" ").toLowerCase();

    expect(columns).not.toContain("variance");
    expect(columns).not.toContain("cashtaken");
    expect(columns).not.toContain("expectedcount");
  });

  it("says open and closed with a timestamp and not a second enum", () => {
    // A `state` column would be a second answer to a question `closed_at`
    // already answers, and the unique index above is keyed on one of the two.
    expect(Object.keys(shift)).not.toContain("state");
    expect(Object.keys(shift)).not.toContain("status");
  });
});

describe("what one shift hands to the next", () => {
  it("keys an item to the shift that raised it", () => {
    expect(pendingItem.raisedByShiftId.notNull).toBe(true);
    expect(indexColumns(pendingItem, "pending_item_raised_by_shift_idx")).toEqual(
      ["raised_by_shift_id"],
    );
  });

  it("indexes the backlog and not the history", () => {
    // "What is still outstanding" is the only question asked across every shift
    // the property has ever run, and a year of cleared items is never an answer
    // to it. Partial, so the index stays the size of the backlog.
    const unresolved = getTableConfig(pendingItem).indexes.find(
      (declared) => declared.config.name === "pending_item_unresolved_idx",
    );

    expect(unresolved?.config.where).toBeDefined();
    expect(unresolved?.config.unique).toBe(false);
  });

  it("demands a description, since an item nobody can act on is a count", () => {
    expect(pendingItem.description.notNull).toBe(true);
  });

  it("resolves an item exactly when a shift cleared it", () => {
    // Both halves or neither. The handover screen reads the backlog by the
    // instant and the audit trail reads who cleared it by the shift, and a row
    // carrying one without the other answers the two readers differently.
    expect(checkNames(pendingItem)).toContain(
      "pending_item_resolved_exactly_when_a_shift_cleared_it",
    );
    expect(pendingItem.resolvedAt.notNull).toBe(false);
    expect(pendingItem.resolvedByShiftId.notNull).toBe(false);
  });
});

describe("the money that is in the drawer", () => {
  it("binds a payment to a shift only when there is a drawer to bind to", () => {
    expect(payment.shiftId.getSQLType()).toBe("uuid");
    expect(payment.shiftId.notNull).toBe(false);
    expect(
      getTableConfig(payment).indexes.map((declared) => declared.config.name),
    ).toContain("payment_shift_idx");
  });

  it("states the rule over cash alone and not over the methods exempt from it", () => {
    // The shape is the claim. An enumeration — "`VNPAY` and `BANK_TRANSFER`
    // have no shift" — satisfies the name and the intent today and refuses the
    // first payment taken through the next gateway the property adds;
    // `FR-PAY-06` already names MoMo as one. The biconditional says what is
    // true of the drawer and nothing about the rest.
    const sql = checkSql(payment, "payment_shift_binding");

    expect(sql).toContain("'CASH'");
    expect(sql).not.toContain("VNPAY");
    expect(sql).not.toContain("BANK_TRANSFER");
    expect(sql).toContain("= (");
  });
});
