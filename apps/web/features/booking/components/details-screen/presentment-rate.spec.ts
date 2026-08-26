import { describe, expect, it } from "vitest";
import { formatRate } from "./presentment-rate";

describe("the rate a PayPal attempt was frozen at", () => {
  it("keeps the fraction, because the dollar figure beside it was computed from the whole rate", () => {
    // The defect this replaced rounded to whole đồng, so a property on 26,150.5
    // quoted an exact dollar figure beside "26.151 ₫" — a guest who multiplies
    // the two finds the property's own screen disagreeing with itself.
    expect(formatRate("26150.5")).toBe("26.150,5 ₫");
  });

  it("prints a whole rate whole, rather than padding a fraction nobody set", () => {
    expect(formatRate("26150")).toBe("26.150 ₫");
  });

  it("drops trailing zeros, which are the same rate written longer", () => {
    expect(formatRate("26150.50")).toBe("26.150,5 ₫");
    expect(formatRate("26150.000")).toBe("26.150 ₫");
  });

  it("groups the thousands the way the rest of the funnel writes money", () => {
    expect(formatRate("1234567.25")).toBe("1.234.567,25 ₫");
  });
});
