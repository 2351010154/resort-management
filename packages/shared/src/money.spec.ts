import { describe, expect, it } from "vitest";
import {
  convertPresentmentToVnd,
  convertVndToPresentment,
  formatPresentment,
  formatVnd,
  formatVndThousands,
  fxRateSchema,
  PROPERTY_CURRENCY,
  roundVndForDisplay,
  splitVnd,
  type VndAmount,
  vndAmountSchema,
} from "./money.js";

describe("a VND amount", () => {
  it("is a bigint", () => {
    expect(vndAmountSchema.parse(1_250_000n)).toBe(1_250_000n);
  });

  // The reason the type is bigint rather than a branded number: an amount and
  // a count cannot be added by accident, because the two do not mix at all.
  it("refuses a number", () => {
    expect(vndAmountSchema.safeParse(1_250_000).success).toBe(false);
  });

  it("refuses a numeric string", () => {
    expect(vndAmountSchema.safeParse("1250000").success).toBe(false);
  });

  // A refund and a reversing entry are negative charges. A folio that could
  // only hold positive amounts would force callers to subtract magnitudes, and
  // the audit trail is exactly the thing that would go missing.
  it("carries a sign", () => {
    expect(vndAmountSchema.parse(-500_000n)).toBe(-500_000n);
    expect(vndAmountSchema.parse(0n)).toBe(0n);
  });

  // Well past what a hotel folio reaches, but the point of the type is that
  // there is no precision cliff to reason about at all.
  it("holds an amount beyond a double's integer range", () => {
    const huge = 9_007_199_254_740_993n;

    expect(vndAmountSchema.parse(huge)).toBe(huge);
    expect(Number(huge)).not.toBe(huge);
  });
});

describe("formatting", () => {
  it("is đồng", () => {
    expect(PROPERTY_CURRENCY).toBe("VND");
  });

  // Display only. The assertions are on the parts rather than the exact string,
  // because grouping and symbol placement belong to the ICU data and change
  // with the Node version — pinning the whole string would break on an upgrade
  // that got nothing wrong.
  it("groups the amount and marks the currency", () => {
    const formatted = formatVnd(1_250_000n);

    expect(formatted).toContain("₫");
    expect(formatted.replace(/\D/g, "")).toBe("1250000");
  });

  it("shows a negative amount as negative", () => {
    expect(formatVnd(-500_000n)).toContain("-");
  });

  // No minor unit: there is nothing after the separator to round, and a
  // fractional đồng would mean the type had been widened somewhere upstream.
  it("shows no fractional part", () => {
    const formatted = formatVnd(1_000n satisfies VndAmount);

    expect(formatted.replace(/\D/g, "")).toBe("1000");
  });
});

describe("display rounding", () => {
  it("goes to the nearest thousand", () => {
    expect(roundVndForDisplay(1_850_400n)).toBe(1_850_000n);
    expect(roundVndForDisplay(1_850_600n)).toBe(1_851_000n);
  });

  it("rounds a half step up", () => {
    expect(roundVndForDisplay(1_850_500n)).toBe(1_851_000n);
  });

  it("leaves an amount already on the step alone", () => {
    expect(roundVndForDisplay(1_850_000n)).toBe(1_850_000n);
    expect(roundVndForDisplay(0n)).toBe(0n);
  });

  // A reversal must round to the exact negative of the charge it reverses, or
  // the two do not cancel on screen and the folio looks unbalanced when it is
  // not. Truncation toward zero gets this wrong in one direction only, which is
  // the kind of asymmetry nobody finds by reading.
  it("is symmetric about zero", () => {
    expect(roundVndForDisplay(-1_850_600n)).toBe(-1_851_000n);
    expect(roundVndForDisplay(-1_850_500n)).toBe(-1_851_000n);
    expect(roundVndForDisplay(-1_850_400n)).toBe(-1_850_000n);
  });

  // The regression the report on this screen names outright: a stay total
  // derived from the rounded per-night figure disagrees with the total derived
  // from the un-rounded sum, on the same card, by a visible amount. Rounding is
  // the last step, once.
  it("sums before it rounds, not after", () => {
    const nights = [1_850_400n, 1_850_400n] satisfies VndAmount[];
    const total = nights.reduce((sum, night) => sum + night, 0n);

    expect(roundVndForDisplay(total)).toBe(3_701_000n);
    expect(roundVndForDisplay(nights[0]) * 2n).toBe(3_700_000n);
  });
});

describe("thousands, for a calendar cell", () => {
  it("drops three zeroes and the symbol", () => {
    const formatted = formatVndThousands(1_850_000n);

    expect(formatted).not.toContain("₫");
    expect(formatted.replace(/\D/g, "")).toBe("1850");
  });

  it("rounds before it divides", () => {
    expect(formatVndThousands(1_850_600n).replace(/\D/g, "")).toBe("1851");
  });
});

describe("splitting an amount from its mark", () => {
  // The mark has to be its own element, because ₫ (U+20AB) is a Vietnamese glyph
  // and a Latin-only face has no version of it — the digits and the currency sign
  // end up drawn by two different fonts whether or not anyone asked.
  it("separates the figure from the currency", () => {
    const { amount, currency } = splitVnd(1_250_000n);

    expect(amount.replace(/\D/g, "")).toBe("1250000");
    expect(currency).toBe("₫");
    expect(amount).not.toContain("₫");
  });

  it("keeps the two halves reassemblable into the formatted string", () => {
    const { amount, currency } = splitVnd(1_250_000n);
    const rejoined = `${amount} ${currency}`;

    expect(rejoined.replace(/\s/g, "")).toBe(
      formatVnd(1_250_000n).replace(/\s/g, ""),
    );
  });

  it("carries a negative sign on the figure, not the mark", () => {
    const { amount, currency } = splitVnd(-500_000n);

    expect(amount).toContain("-");
    expect(currency).toBe("₫");
  });
});

describe("what a foreign gateway charged", () => {
  const RATE = "26150";

  it("converts đồng to cents, rounding once at the end", () => {
    // 1,850,000 ₫ ÷ 26,150 = 70.7457… dollars → 7,075 cents.
    expect(convertVndToPresentment(1_850_000n, "USD", RATE).minorUnits).toBe(
      7_075n,
    );
  });

  it("rounds half up rather than toward zero", () => {
    // A rate chosen so the quotient lands exactly on a half cent.
    expect(convertVndToPresentment(3n, "USD", "2").minorUnits).toBe(150n);
    expect(convertVndToPresentment(1n, "USD", "8").minorUnits).toBe(13n);
  });

  it("carries a fractional rate exactly", () => {
    // The digits after the point are the whole point of the text form — a
    // double would land a cent away on a stay this size.
    const { minorUnits } = convertVndToPresentment(
      50_000_000n,
      "USD",
      "26150.75",
    );

    expect(minorUnits).toBe(191_199n);
  });

  it("freezes the rate it was given", () => {
    expect(convertVndToPresentment(1_850_000n, "USD", RATE).rate).toBe(RATE);
  });

  it("refuses an amount nobody can be charged", () => {
    expect(() => convertVndToPresentment(0n, "USD", RATE)).toThrow(RangeError);
    expect(() => convertVndToPresentment(-1_000n, "USD", RATE)).toThrow(
      RangeError,
    );
  });

  // A đồng is worth well under a cent, so a small enough charge converts to
  // nothing at all. Refused rather than sent as a zero-dollar order.
  it("refuses an amount that converts to nothing", () => {
    expect(() => convertVndToPresentment(100n, "USD", "1000000")).toThrow(
      RangeError,
    );
  });

  it("converts back at the frozen rate", () => {
    const presentment = convertVndToPresentment(1_850_000n, "USD", RATE);

    // Not the amount it started from, and deliberately so: a cent is coarser
    // than a đồng, so the round trip lands within one cent's worth. That gap is
    // the tolerance reconciliation has to state rather than discover.
    expect(convertPresentmentToVnd(presentment)).toBe(1_850_113n);
  });

  it("refuses a rate that converts nothing", () => {
    expect(fxRateSchema.safeParse("0").success).toBe(false);
    expect(fxRateSchema.safeParse("-26150").success).toBe(false);
    expect(fxRateSchema.safeParse("twenty").success).toBe(false);
  });

  it("accepts a rate with a fraction", () => {
    expect(fxRateSchema.parse("26150.75")).toBe("26150.75");
  });

  it("formats what the payer will approve", () => {
    expect(
      formatPresentment({ currency: "USD", minorUnits: 7_075n, rate: RATE }),
    ).toBe("$70.75");
  });
});
