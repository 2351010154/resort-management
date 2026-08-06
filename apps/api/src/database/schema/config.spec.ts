// What the configuration declarations say, and what is left to a database.
//
// The claim this file exists to hold is the one `property-and-tariff.md` §8
// makes in a sentence: a tax rate is never a constant. That is asserted here as
// an *absence* — no column in this table supplies a rate by default — because
// the shape being rejected is not a rogue `const VAT_RATE = 0.08` somebody
// would notice in review. It is a well-meaning `.default(800)` on the column,
// which reads as configuration, ships as a compiled rate, and mis-invoices in
// silence for every date the accountant's real answer differs on.
//
// The rest is the shape a posting path depends on: rates as whole basis points
// rather than floats, business dates as dates rather than instants, and one
// row rather than several, so the rate, the window and the base rule that
// decompose a single gross figure are read together or not at all.
//
// Whether Postgres actually refuses a second configuration, a rate outside its
// scale, a window that closes before it opens, or a key this table does not
// have, is a question about the migration, and it is answered in
// `test/config-storage.e2e-spec.ts` against a real database.

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { systemConfig } from "./config.js";

describe("the system configuration", () => {
  it("holds the four inputs §8 forbids the tree from knowing, and the clock hour", () => {
    // §8's table, less the statutory retention floor `N`, which is the lawyer's
    // unanswered `ASM-02` and belongs to the milestone that consumes it — a
    // provisional retention window either deletes records the law requires kept
    // or keeps ID scans past the window `R3#6` asserts is empty.
    const columns = Object.keys(systemConfig);

    expect(columns).toEqual(
      expect.arrayContaining([
        "vatRateBps",
        "reducedVatFrom",
        "reducedVatTo",
        "vatIncludesServiceCharge",
        "serviceChargeRateBps",
        "businessDateRolloverHour",
      ]),
    );
    expect(columns).not.toContain("retentionYears");
  });

  it("supplies no rate of its own, so an unseeded database holds none", () => {
    // The assertion §8 is actually about. Every money figure is mandatory and
    // defaulted by nothing, so the row cannot exist until somebody supplied
    // each value, and a rate nobody chose cannot be read by a posting.
    for (const column of [
      systemConfig.vatRateBps,
      systemConfig.serviceChargeRateBps,
      systemConfig.vatIncludesServiceCharge,
      systemConfig.businessDateRolloverHour,
    ]) {
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.default).toBeUndefined();
    }
  });

  it("keeps rates in whole basis points and never in a float", () => {
    // `NFR-12` and §5 put money on integers, and the same argument reaches the
    // rate: a rate stored as 0.08 reintroduces at the multiplier exactly what
    // integer đồng removed at the amount. Basis points carry a statutory 1.5%
    // as 150 with no value that cannot be compared for equality.
    expect(systemConfig.vatRateBps.getSQLType()).toBe("smallint");
    expect(systemConfig.serviceChargeRateBps.getSQLType()).toBe("smallint");
    expect(systemConfig.businessDateRolloverHour.getSQLType()).toBe("smallint");
  });

  it("bounds every rate and the hour, so a typo cannot reach a posting", () => {
    const declared = getTableConfig(systemConfig).checks.map(
      (check) => check.name,
    );

    expect(declared).toEqual([
      "system_config_holds_exactly_one_row",
      "system_config_vat_rate_within_bounds",
      "system_config_service_charge_rate_within_bounds",
      "system_config_rollover_hour_is_an_hour",
      "system_config_reduced_vat_window_opens_before_it_closes",
    ]);
  });

  it("dates the reduced-VAT window and leaves either end open", () => {
    // A business date, never an instant — `NFR-12`, and relief applies to a
    // date rather than to a moment in a timezone. Both ends nullable because
    // null is unbounded and not missing: with neither set, which is how a
    // property runs before the accountant answers `ASM-01`, the configured rate
    // applies to every date.
    expect(systemConfig.reducedVatFrom.getSQLType()).toBe("date");
    expect(systemConfig.reducedVatTo.getSQLType()).toBe("date");
    expect(systemConfig.reducedVatFrom.notNull).toBe(false);
    expect(systemConfig.reducedVatTo.notNull).toBe(false);
  });

  it("is one row, so a posting reads one snapshot of every figure at once", () => {
    // `FR-FOL-02` decomposes one gross amount into three lines that must sum
    // back to it, reading the rate, the window and the base rule together.
    // Split across rows, those reads could straddle an `ADMIN` edit and produce
    // a posting computed half under the old configuration and half under the
    // new. The boolean primary key is `property_tariff`'s device for the same
    // problem: a second row collides with the first.
    const { checks, columns } = getTableConfig(systemConfig);

    expect(
      columns.filter((column) => column.primary).map((column) => column.name),
    ).toEqual(["is_the_configuration"]);
    expect(checks.map((check) => check.name)).toContain(
      "system_config_holds_exactly_one_row",
    );
  });

  it("holds no second rate for dates the reduced window does not cover", () => {
    // §8 files the rate and the reduced-VAT period as two answers the
    // accountant still owes. Inventing the standard rate behind the window
    // would settle `ASM-01` by guessing, and a guessed tax rate does not throw
    // — it invoices. The column arrives with the answer.
    const columns = Object.keys(systemConfig);

    expect(columns).toContain("vatRateBps");
    expect(columns).not.toContain("standardVatRateBps");
    expect(columns).not.toContain("reducedVatRateBps");
  });

  it("stores no gateway credential", () => {
    // Credentials stay in the environment. A secret in a table an `ADMIN`
    // screen reads has a wider audience than the process that uses it, and
    // `FR-PAY-02` validates them at boot instead.
    const columns = Object.keys(systemConfig).join(" ").toLowerCase();

    expect(columns).not.toContain("secret");
    expect(columns).not.toContain("credential");
  });
});
