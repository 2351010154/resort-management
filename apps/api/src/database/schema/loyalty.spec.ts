// What the ledger declares, and — more to the point — what it refuses to
// declare.
//
// Two of the assertions below are absences, which is unusual for a schema test
// and is the whole reason this file exists. `FR-GST-04` makes the VIP tier a
// derived value "never hand-set", and `FR-GST-05` makes the balance the sum of
// these rows "never a mutable counter". Neither rule can be broken by a service;
// both are broken by adding a column, and a column nobody asserted the absence
// of is a column somebody adds in good faith a milestone later.
//
// Whether Postgres actually refuses a second accrual for one folio is a question
// about the migration, and it is answered in `test/guest-account-link.e2e-spec.ts`
// against a real database.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { loyaltyLedger } from "./loyalty.js";

describe("the loyalty ledger", () => {
  it("earns points against one folio and refuses a second accrual for it", () => {
    // `FR-GST-05`: "accrual is idempotent per folio by unique constraint — the
    // `FR-PAY-03` pattern". A job that ran twice, a retried close and a support
    // script all arrive as the same row, and the second is refused here rather
    // than by whoever remembered to check.
    expect(loyaltyLedger.folioId.isUnique).toBe(true);
    expect(loyaltyLedger.folioId.notNull).toBe(true);
  });

  it("stores no tier, no balance and no counter", () => {
    // `FR-GST-04` derives the tier from a trailing-12-month window recomputed
    // at rollover, so a stored one is correct only until the window moves under
    // it. `schema/guest.ts` refuses the same column for the same reason.
    const columns = Object.keys(loyaltyLedger);

    expect(columns).toContain("pointsEarned");
    expect(columns).not.toContain("tier");
    expect(columns).not.toContain("balance");
    expect(columns).not.toContain("pointsBalance");
    expect(columns).not.toContain("pointsRedeemed");
  });

  it("accrues and never burns", () => {
    // A negative row is a redemption, which is a stated non-goal and which no
    // endpoint could authorise. Zero is legal: a stay whose net room revenue
    // fell below one earn unit honestly earned nothing and still occupies its
    // folio's one row.
    expect(
      getTableConfig(loyaltyLedger).checks.map((check) => check.name),
    ).toEqual(["loyalty_ledger_accrues_only"]);
  });

  it("counts points in an integer type and never a float", () => {
    expect(loyaltyLedger.pointsEarned.getSQLType()).toBe("bigint");
  });

  it("earns at an instant and expires on a calendar date", () => {
    // §7 expires "points earned in year `Y` … 31 December of `Y+1`", which is a
    // day in Ho Chi Minh City. A timestamp would move that boundary by seven
    // hours; the accrual itself is a moment, because a folio closes at one.
    expect(loyaltyLedger.earnedAt.getSQLType()).toBe(
      "timestamp with time zone",
    );
    expect(loyaltyLedger.expiresAt.getSQLType()).toBe("date");
  });

  it("answers a balance from one account's unexpired rows", () => {
    // The only read this table has: leading with the account and ordering by
    // the expiry is what lets `expires_at > current_date` be answered from the
    // index rather than from a scan of every guest's history.
    const balance = getTableConfig(loyaltyLedger).indexes.find(
      (declared) =>
        declared.config.name === "loyalty_ledger_user_expires_at_idx",
    );

    expect(
      (balance?.config.columns ?? []).map((column) =>
        "name" in column && typeof column.name === "string"
          ? column.name
          : "(expression)",
      ),
    ).toEqual(["user_id", "expires_at"]);
  });
});
