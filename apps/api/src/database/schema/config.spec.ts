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
    // §8's table, plus the clock hour. `retentionYears` is asserted absent
    // rather than merely unlisted: `ASM-02`'s floor lost its only reader when
    // `FR-GST-02` stopped storing identity-document images, and what remains is
    // a do-not-delete-before over `registration`, which has no delete path to
    // gate. A column nothing reads is worse than its absence, so the absence is
    // the thing worth holding still.
    const columns = Object.keys(systemConfig);

    expect(columns).toEqual(
      expect.arrayContaining([
        "standardVatRateBps",
        "reducedVatRateBps",
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
      systemConfig.standardVatRateBps,
      systemConfig.reducedVatRateBps,
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
    expect(systemConfig.standardVatRateBps.getSQLType()).toBe("smallint");
    expect(systemConfig.reducedVatRateBps.getSQLType()).toBe("smallint");
    expect(systemConfig.serviceChargeRateBps.getSQLType()).toBe("smallint");
    expect(systemConfig.businessDateRolloverHour.getSQLType()).toBe("smallint");
  });

  it("bounds every rate and the hour, so a typo cannot reach a posting", () => {
    const declared = getTableConfig(systemConfig).checks.map(
      (check) => check.name,
    );

    expect(declared).toEqual([
      "system_config_holds_exactly_one_row",
      "system_config_standard_vat_rate_within_bounds",
      "system_config_reduced_vat_rate_within_bounds",
      "system_config_service_charge_rate_within_bounds",
      "system_config_rollover_hour_is_an_hour",
      "system_config_reduced_vat_window_opens_before_it_closes",
      "system_config_loyalty_earns_at_least_a_point",
      "system_config_loyalty_earn_unit_is_money",
      "system_config_silver_takes_at_least_one_stay",
      "system_config_silver_revenue_is_money",
      "system_config_gold_stays_not_below_silver",
      "system_config_gold_revenue_not_below_silver",
    ]);
  });

  it("dates the reduced-VAT window and leaves either end open", () => {
    // A business date, never an instant — `NFR-12`, and relief applies to a
    // date rather than to a moment in a timezone. Both ends nullable because a
    // relief period genuinely can be half-open: one that has started with no
    // announced end, or one whose end is known and whose start predates the
    // system. Neither end set is a property stating it has no relief period at
    // all, which the service resolves to the standard rate.
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

  it("holds a rate for dates the reduced window does not cover", () => {
    // Statutory relief is a temporary reduction from a standard rate that never
    // went away, so a window with an end date has a rate on the far side of it
    // by construction. A table that could not express that rate would guarantee
    // a refused posting on the day the window lapsed — on a property that had
    // configured the window correctly. Neither column is a guess: both are
    // `NOT NULL` with no default, asserted above.
    const columns = Object.keys(systemConfig);

    expect(columns).toContain("standardVatRateBps");
    expect(columns).toContain("reducedVatRateBps");
    expect(columns).not.toContain("vatRateBps");
  });

  it("prices the time axis only, leaving the item axis to one tax class", () => {
    // The rate that survived the split is still one rate per *date*. A rate that
    // differs by what is being sold — §6's Minibar line staying at the standard
    // rate inside the window, because the relief excludes goods subject to
    // excise tax — is a second axis, and `service.ts` keeps it at one class
    // until that condition is met. A per-class column here would be a rate
    // nothing resolves against.
    const columns = Object.keys(systemConfig).join(" ").toLowerCase();

    expect(columns).not.toContain("class");
    expect(columns).not.toContain("taxrate");
  });

  it("carries §7's loyalty figures with the values §7 proposes", () => {
    // The opposite arrangement to the rates above, and the difference is
    // ownership rather than rigour. §8's figures belong to an accountant or to
    // the owner, so a default would be this repository answering for them; §7
    // says the earn rate and the thresholds are the developer's proposal until
    // the owner tunes them, so the default *is* the answer this
    // repository gave. Asserted as values, because the figures are the thing §7
    // decided and a column that silently drifted from them would still look
    // configured.
    expect(systemConfig.loyaltyPointsPerUnit.default).toBe(1);
    expect(systemConfig.tierSilverStays.default).toBe(2);
    expect(systemConfig.tierGoldStays.default).toBe(4);

    // The đồng figures declare their defaults as SQL, because the migration
    // generator writes its snapshot as JSON and a `bigint` has none. What
    // Postgres stores is asserted in `test/config-storage.e2e-spec.ts`, where
    // the value can be read back rather than inspected as a declaration.
    for (const column of [
      systemConfig.loyaltyEarnUnitVnd,
      systemConfig.tierSilverRevenueVnd,
      systemConfig.tierGoldRevenueVnd,
    ]) {
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(true);
      expect(column.getSQLType()).toBe("bigint");
    }
  });

  it("stores thresholds a tier is derived from, and never a tier", () => {
    // `FR-GST-04` makes the tier a derived value recomputed at rollover over a
    // trailing window, so a stored one is correct only until the window moves
    // under it. `schema/loyalty.ts` and `schema/guest.ts` refuse a column for it
    // and this row refuses one too — what it holds is the ladder, which is a
    // decision that stands until somebody edits it.
    const columns = Object.keys(systemConfig).join(" ").toLowerCase();

    expect(columns).toContain("tiersilverstays");
    expect(columns).toContain("tiergoldrevenuevnd");
    expect(columns).not.toContain("currenttier");
    expect(columns).not.toContain("loyaltytier");
  });

  it("keeps the tier discounts where the pricing path reads them", () => {
    // §7 applies the Silver and Gold discounts "as a promotions rate modifier
    // (`FR-PRC-03`)", and `pricing.ts` stores them as `promotion` rows carrying
    // `requires_loyalty_tier`. A copy here would be a second authority for one
    // figure, and whichever copy the pricing path did not read would be a
    // configuration value nothing reads.
    const columns = Object.keys(systemConfig).join(" ").toLowerCase();

    expect(columns).not.toContain("discount");
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
