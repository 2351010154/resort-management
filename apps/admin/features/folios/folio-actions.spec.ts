import { describe, expect, it } from "vitest";
import {
  chargeAttempt,
  mayPostFolio,
  mayReverseFolio,
  serviceAttempt,
} from "./folio-actions";

describe("folio actions", () => {
  it("splits posting and reversal roles", () => {
    expect(mayPostFolio("RECEPTIONIST")).toBe(true);
    expect(mayPostFolio("ACCOUNTANT")).toBe(true);
    expect(mayPostFolio("HOUSEKEEPING")).toBe(false);
    expect(mayReverseFolio("RECEPTIONIST")).toBe(false);
    expect(mayReverseFolio("ACCOUNTANT")).toBe(true);
    expect(mayReverseFolio("MANAGER")).toBe(true);
    expect(mayReverseFolio("ADMIN")).toBe(true);
  });
  it("builds positive ad-hoc charges", () => {
    expect(chargeAttempt("stay", "150.000", " Late checkout ")).toEqual({
      input: {
        bookingId: "stay",
        grossAmount: "150000",
        description: "Late checkout",
      },
    });
    expect(chargeAttempt("stay", "0", "x")).toHaveProperty("problem");
  });
  it("omits amount for priced catalog items", () => {
    expect(
      serviceAttempt(
        "stay",
        {
          code: "BREAKFAST",
          name: "Breakfast",
          unitPriceGross: 100_000n,
          taxClass: "STANDARD",
        },
        "2",
        "999",
      ),
    ).toEqual({ input: { bookingId: "stay", code: "BREAKFAST", quantity: 2 } });
  });
  it("requires the agreed total for unpriced catalog items", () => {
    const item = {
      code: "LAUNDRY",
      name: "Laundry",
      unitPriceGross: null,
      taxClass: "STANDARD",
    } as const;
    expect(serviceAttempt("stay", item, "3", "240000")).toEqual({
      input: {
        bookingId: "stay",
        code: "LAUNDRY",
        quantity: 3,
        grossAmount: "240000",
      },
    });
    expect(serviceAttempt("stay", item, "3", "")).toHaveProperty("problem");
  });
});
