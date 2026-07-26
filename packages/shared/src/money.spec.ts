import { describe, expect, it } from "vitest";
import {
  formatVnd,
  PROPERTY_CURRENCY,
  type VndAmount,
  vndAmountSchema,
} from "./money";

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
