// What the payment declarations promise, and what is left to a database.
//
// One claim carries this file. `infrastructure.md` §Payments says VNPay may
// send the same IPN more than once and that the unique constraint on the
// gateway's transaction id is "mandatory, not defensive" — so the index has to
// be *declared* unique, and it has to be *partial*, and the two are separate
// mistakes. Declared without `unique`, the table accepts ten copies of one
// payment and the only symptom is a guest charged ten times. Declared without
// the `where`, every cash payment in the property collides with the first one,
// and the symptom is a front desk that cannot take money.
//
// The attempt key is the same two mistakes over a second column, and it exists
// because the first one cannot reach a refusal: no money moved, so there is no
// transaction id to key on, and the reference the property minted is the only
// thing a redelivered refusal has in common with the first one.
//
// Whether Postgres actually refuses the second insert while the first is still
// in flight is a question about the migration and about row locks, and no
// assertion over a schema object can answer it. `test/payment-storage.e2e-spec.ts`
// answers it against a real database, with ten concurrent replays.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  payment,
} from "./payment.js";

const declaredIndexes = getTableConfig(payment).indexes;

const idempotencyIndex = declaredIndexes.find(
  (declared) => declared.config.name === "payment_gateway_transaction_unique_key",
);

const attemptIndex = declaredIndexes.find(
  (declared) => declared.config.name === "payment_attempt_reference_unique_key",
);

describe("the idempotency key", () => {
  it("is unique, so one callback delivered twice is one payment", () => {
    expect(idempotencyIndex?.config.unique).toBe(true);
    // An index may be built on an expression rather than a column, so the
    // declaration is a union and the name has to be asked for rather than
    // assumed. An expression here would be a different index than the one this
    // file is about.
    expect(
      idempotencyIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["gateway_transaction_id"]);
  });

  it("is partial, so the money the property collects itself does not collide", () => {
    // Cash and bank transfer have no gateway and so no id, and without the
    // predicate the property could take exactly one of them. Postgres would in
    // fact permit the nulls either way — nulls do not collide in a unique index
    // — but a rule that holds because of a null-comparison convention is a rule
    // the next reader has to recall rather than read.
    expect(idempotencyIndex?.config.where).toBeDefined();
  });

  it("keeps the id as text, since it is compared and never counted", () => {
    // An identifier the gateway hands back. A numeric column would refuse the
    // day one arrives with a letter in it, and round the day one arrives long.
    expect(payment.gatewayTransactionId.getSQLType()).toBe("text");
    expect(payment.gatewayTransactionId.notNull).toBe(false);
  });
});

describe("the attempt key", () => {
  it("is unique, so one attempt is one row whatever became of it", () => {
    // The guarantee the gateway id cannot give. A refused attempt carries no
    // transaction id — `GatewayTransaction` will not name one for money nobody
    // paid — so a redelivered refusal keyed on that column writes a second
    // `FAILED` row, and the reference is the only thing both deliveries share.
    expect(attemptIndex?.config.unique).toBe(true);
    expect(
      attemptIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["attempt_reference"]);
  });

  it("is partial, so the money the desk takes itself was opened under nothing", () => {
    expect(attemptIndex?.config.where).toBeDefined();
  });

  it("keeps the reference as nullable text, matched whole and never parsed", () => {
    // The property's own name for the attempt, echoed back by the gateway and
    // compared as the string it was handed. Nothing here splits it into the
    // booking and the nonce it was composed from — that is the service's, and a
    // column that knew the composition would have to be migrated with it.
    expect(payment.attemptReference.getSQLType()).toBe("text");
    expect(payment.attemptReference.notNull).toBe(false);
  });
});

describe("the amount", () => {
  it("is whole đồng handed back as the integer that went in", () => {
    // `NFR-12`. `mode: "bigint"` rather than `mode: "number"`, which is the
    // difference between a figure that survives above 2^53 and one that quietly
    // does not — and a payment wrong by a đồng fails `NFR-02` in a way nobody
    // can trace.
    expect(payment.amount.getSQLType()).toBe("bigint");
    expect(payment.amount.dataType).toBe("bigint");
  });

  it("carries no sign, because the ledger owns the convention", () => {
    const declared = getTableConfig(payment).checks.map((check) => check.name);

    expect(declared).toContain("payment_amount_is_positive");
  });
});

describe("what the table refuses to know", () => {
  it("names no gateway field, so nothing gateway-shaped reaches a reader", () => {
    // `FR-PAY-01`: no gateway type leaks past the port. A response code, a bank
    // code or a card type stored here would carry VNPay's vocabulary to every
    // query of this table, and the second gateway would arrive as a column
    // whose meaning depends on which row you are looking at.
    const columns = Object.keys(payment).join(" ").toLowerCase();

    expect(columns).not.toContain("responsecode");
    expect(columns).not.toContain("bankcode");
    expect(columns).not.toContain("cardtype");
    expect(columns).not.toContain("securehash");
  });

  it("stores no gateway credential", () => {
    // `config.ts` makes the same assertion about itself: credentials stay in
    // the environment, where the audience is the process rather than every
    // screen and script that can read a table.
    const columns = Object.keys(payment).join(" ").toLowerCase();

    expect(columns).not.toContain("secret");
    expect(columns).not.toContain("tmncode");
  });
});

describe("the two vocabularies", () => {
  it("offers a method for each way money reaches the property", () => {
    expect(PAYMENT_METHODS).toEqual(["VNPAY", "CASH", "BANK_TRANSFER"]);
  });

  it("keeps a refused payment rather than deleting it", () => {
    // A guest asking why they were not charged is asking about a `FAILED` row,
    // and `FR-PAY-05` reconciles two reports rather than one report and a gap.
    expect(PAYMENT_STATUSES).toContain("FAILED");
  });

  it("dates a payment exactly when one was taken", () => {
    // Both directions, as the constraint states them. A success with no time on
    // it cannot be reconciled against the gateway's report for that day; a time
    // on a pending or refused payment is a moment nothing happened at.
    const declared = getTableConfig(payment).checks.map((check) => check.name);

    expect(declared).toContain("payment_paid_at_exactly_when_money_moved");
    expect(payment.paidAt.notNull).toBe(false);
  });
});
