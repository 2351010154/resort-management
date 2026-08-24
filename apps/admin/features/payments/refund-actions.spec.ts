import { describe, expect, it } from "vitest";
import {
  mayOverrideRefund,
  mayPolicyRefund,
  overrideRefundAttempt,
} from "./refund-actions";

describe("refund actions", () => {
  it("offers policy refunds to ledger roles and overrides only to management", () => {
    expect(mayPolicyRefund("RECEPTIONIST")).toBe(true);
    expect(mayPolicyRefund("ACCOUNTANT")).toBe(true);
    expect(mayPolicyRefund("MANAGER")).toBe(true);
    expect(mayPolicyRefund("ADMIN")).toBe(true);
    expect(mayPolicyRefund("HOUSEKEEPING")).toBe(false);
    expect(mayOverrideRefund("ACCOUNTANT")).toBe(false);
    expect(mayOverrideRefund("MANAGER")).toBe(true);
    expect(mayOverrideRefund("ADMIN")).toBe(true);
  });
  it("requires positive VND and a reason for an override", () => {
    expect(
      overrideRefundAttempt("stay", "500.000", " Service recovery "),
    ).toEqual({
      input: {
        bookingId: "stay",
        amount: "500000",
        reason: "Service recovery",
      },
    });
    expect(overrideRefundAttempt("stay", "0", "reason")).toHaveProperty(
      "problem",
    );
    expect(overrideRefundAttempt("stay", "500000", " ")).toHaveProperty(
      "problem",
    );
  });
});
