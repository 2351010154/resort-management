import { describe, expect, it } from "vitest";
import {
  listRefundCandidatesInput,
  refundCandidatesPageSchema,
} from "./payment.js";

describe("refund candidate contract", () => {
  it("accepts the worklist filters but no reconciliation status selector", () => {
    const parsed = listRefundCandidatesInput.parse({
      bookingId: "9f1d4e2a-1c3b-4a5d-8e7f-0a1b2c3d4e5f",
      businessDate: "2026-08-24",
      method: "CASH",
      status: "FAILED",
      limit: "10",
      offset: "20",
    });

    expect(parsed).not.toHaveProperty("status");
    expect(parsed).toMatchObject({ limit: 10, offset: 20 });
  });

  it("exposes only the fields needed to choose a policy-refund stay", () => {
    const row = refundCandidatesPageSchema.parse({
      payments: [
        {
          paymentId: "9f1d4e2a-1c3b-4a5d-8e7f-0a1b2c3d4e5f",
          bookingId: "01234567-89ab-4def-8123-456789abcdef",
          bookingReference: "MRV-20260824-0001",
          method: "VNPAY",
          amount: 1_200_000n,
          paidAt: "2026-08-24T01:30:00.000Z",
          businessDate: "2026-08-23",
          folioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          gatewayTransactionId: "secret",
          discrepancyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      ],
      total: 1,
    }).payments[0];

    expect(Object.keys(row ?? {}).sort()).toEqual([
      "amount",
      "bookingId",
      "bookingReference",
      "businessDate",
      "method",
      "paidAt",
      "paymentId",
    ]);
  });
});
