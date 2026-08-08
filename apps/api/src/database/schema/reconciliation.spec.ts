// What the discrepancy declarations promise, and what is left to a database.
//
// Two claims carry this file, and they are the two ways this table can fail
// silently.
//
// The first is the key. A nightly comparison is re-run — by the cron, by a
// manager, and by `job-runner.service.ts` deliberately running a sweep twice
// inside one transaction to prove it settles — and without the unique index
// every re-run files the same disagreement again. Nobody notices, because the
// symptom is a table that grows and a phone that rings twice about one payment.
//
// The second is that the classification and the columns stay one fact. A row
// saying `MISSING_LOCALLY` while carrying a ledger figure is a discrepancy that
// contradicts itself, and the person handed it at four in the morning has no way
// to tell which half is the mistake. The check is what refuses it, and it is
// declared here rather than enforced by whichever writer remembered.
//
// Whether Postgres actually refuses those rows is a question about the
// migration, and no assertion over a schema object can answer it —
// `payment.spec.ts` says the same about its own two indexes and hands the
// question to a storage test against a real database. What is asserted below is
// that the declarations exist and say what the service was written against.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_DISCREPANCY_KINDS,
  paymentDiscrepancy,
} from "./reconciliation.js";

const declared = getTableConfig(paymentDiscrepancy);

const dailyKey = declared.indexes.find(
  (index) =>
    index.config.name ===
    "payment_discrepancy_business_date_attempt_unique_key",
);

const checks = declared.checks.map((check) => check.name);

describe("the daily key", () => {
  it("is unique, so one attempt on one date is one row however often the comparison runs", () => {
    expect(dailyKey?.config.unique).toBe(true);
    // An index may be built on an expression rather than a column, so the
    // declaration is a union and the name has to be asked for rather than
    // assumed — `payment.spec.ts` makes the same allowance.
    expect(
      dailyKey?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["business_date", "attempt_reference"]);
  });

  it("is not partial, because there is no row it is allowed to skip", () => {
    // `payment`'s two keys are partial because the column they cover is null on
    // the money the desk collects itself. Both columns here are `not null`, so
    // a predicate would only be a set of rows the key stopped holding for.
    expect(dailyKey?.config.where).toBeUndefined();
    expect(paymentDiscrepancy.businessDate.notNull).toBe(true);
    expect(paymentDiscrepancy.attemptReference.notNull).toBe(true);
  });

  it("keys on the property's own name for the attempt", () => {
    // The one identifier both sides carry in every case. The gateway's
    // transaction id cannot do the job: a `MISSING_LOCALLY` row exists
    // precisely because there is no payment row here to have stored one on.
    expect(paymentDiscrepancy.attemptReference.getSQLType()).toBe("text");
  });
});

describe("the trading day", () => {
  it("is a date and not an instant", () => {
    // `property-and-tariff.md` §2. The business date is a calendar day the
    // property declares, not a moment — a timestamp here would be reconciled
    // against midnight in whatever zone the reader happened to be in, which is
    // the off-by-one-night the whole type exists to prevent.
    expect(paymentDiscrepancy.businessDate.getSQLType()).toBe("date");
  });
});

describe("the two figures", () => {
  it("are whole đồng handed back as the integers that went in", () => {
    // `NFR-12`, and it matters twice over here: these columns exist to be
    // subtracted from one another, and a figure routed through `number` would
    // turn a discrepancy of a few đồng into one nobody can reproduce.
    expect(paymentDiscrepancy.gatewayAmount.getSQLType()).toBe("bigint");
    expect(paymentDiscrepancy.gatewayAmount.dataType).toBe("bigint");
    expect(paymentDiscrepancy.ledgerAmount.getSQLType()).toBe("bigint");
    expect(paymentDiscrepancy.ledgerAmount.dataType).toBe("bigint");
  });

  it("are nullable, because a disagreement is one-sided half the time", () => {
    // A side that reports nothing reports nothing. Zero would be a claim that
    // the gateway took no money under that reference, which is a different
    // statement and one the check below would have to allow through.
    expect(paymentDiscrepancy.gatewayAmount.notNull).toBe(false);
    expect(paymentDiscrepancy.ledgerAmount.notNull).toBe(false);
  });

  it("carry no zero and no sign", () => {
    expect(checks).toContain("payment_discrepancy_amounts_are_positive");
  });
});

describe("the classification", () => {
  it("offers one member per way the two reports can disagree", () => {
    expect(PAYMENT_DISCREPANCY_KINDS).toEqual([
      "MISSING_LOCALLY",
      "MISSING_AT_GATEWAY",
      "AMOUNT_MISMATCH",
    ]);
  });

  it("has no member for an agreement, because an agreement is not a row", () => {
    // The table records exceptions. A row per compared attempt would be the
    // gateway's daily report copied into Postgres to record the one thing
    // nobody looks up, and `reconciliation.service.ts` is where `MATCHED`
    // lives — as an outcome a caller reads, never a row it writes.
    expect([...PAYMENT_DISCREPANCY_KINDS]).not.toContain("MATCHED");
  });

  it("is held to the columns it describes", () => {
    // Both directions of all three members, as the constraint states them. A
    // `MISSING_LOCALLY` row with a payment on it, or an `AMOUNT_MISMATCH` whose
    // two figures agree, is refused by the database rather than by the reader
    // who thought to check.
    expect(checks).toContain("payment_discrepancy_kind_matches_the_sides");
  });
});

describe("what the table refuses to know", () => {
  it("names no gateway field, so nothing gateway-shaped reaches a reader", () => {
    // `FR-PAY-01`, and `payment.spec.ts` asserts the same about its own table.
    // A settlement batch number or a response code here would be one gateway's
    // paperwork in a column every reader of this table has to interpret.
    const columns = Object.keys(paymentDiscrepancy).join(" ").toLowerCase();

    expect(columns).not.toContain("responsecode");
    expect(columns).not.toContain("bankcode");
    expect(columns).not.toContain("batch");
    expect(columns).not.toContain("merchant");
  });

  it("records no resolution, because nothing resolves one yet", () => {
    // `FR-PAY-05` pages a phone and paging is a later piece of work. A column
    // nothing fills cannot be told apart from one nobody has got to yet, which
    // is the argument `payment.ts` makes about `updated_at`.
    const columns = Object.keys(paymentDiscrepancy).join(" ").toLowerCase();

    expect(columns).not.toContain("resolved");
    expect(columns).not.toContain("acknowledged");
  });
});
