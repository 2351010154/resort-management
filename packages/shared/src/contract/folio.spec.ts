// How the desk says money arrived, and the one method it can never claim.
//
// `postPaymentInput` is the door a receptionist posts cash and transfers
// through, and the method travelling on it is what `FR-OPS-01` sums the drawer
// from. Two halves are worth pinning, and neither is visible by reading the
// shape alone.
//
// The first is that the field is *required*. The ledger is append-only, so a
// payment posted without a method is a fact nobody can supply later — an
// optional field or a default would both make that loss look like a successful
// posting at the counter, which is exactly when the answer was still known.
//
// The second is that `VNPAY` is refused here while remaining a member of the
// property's own list. Gateway money is written by the IPN handler against a
// confirmation, and a desk posting able to name the gateway would credit the
// property with money nothing confirmed. The subset is derived by exclusion, so
// the assertion that matters is not that two members pass but that the excluded
// one fails — a derivation that stopped excluding would read exactly like a
// working one until somebody typed a gateway payment into the drawer.

import { describe, expect, it } from "vitest";
import { postPaymentInput } from "./folio.js";

/** A posting the schema is otherwise happy with, so only the method is under
 *  test. Text on the way in, per `money.ts`. */
const A_PAYMENT = {
  bookingId: "0d1a3f5c-4b8e-4a2d-9c1f-6e7b8a9d0c11",
  amount: "500000",
  description: "Cash at the desk, on departure",
};

describe("how the desk says the money arrived", () => {
  it("takes cash counted over the counter", () => {
    const payment = postPaymentInput.parse({
      ...A_PAYMENT,
      method: "CASH",
    });

    expect(payment.method).toBe("CASH");
    expect(payment.amount).toBe(500_000n);
  });

  it("takes a bank transfer the desk has seen land", () => {
    const payment = postPaymentInput.parse({
      ...A_PAYMENT,
      method: "BANK_TRANSFER",
      description: "Transfer, reference 9931",
    });

    expect(payment.method).toBe("BANK_TRANSFER");
  });

  it("refuses a posting that never said how the money arrived", () => {
    // The loss this field exists to prevent. Nothing can reconstruct the method
    // afterwards, so a shape that let the posting through would be reporting a
    // drawer it cannot account for.
    const refused = postPaymentInput.safeParse(A_PAYMENT);

    expect(refused.success).toBe(false);
    expect(
      refused.error?.issues.some((issue) => issue.path[0] === "method"),
    ).toBe(true);
  });

  it("supplies no method of its own for a posting that omitted one", () => {
    // Stated separately from the refusal above, because a default would satisfy
    // "the field is always present" while answering for the receptionist — and
    // the wrong half of the drawer is worse than an empty one.
    const refused = postPaymentInput.safeParse(A_PAYMENT);

    expect(refused.success).toBe(false);
    expect(refused.data).toBeUndefined();
  });

  it("refuses the gateway's method, which no desk can take", () => {
    // `VNPAY` is a member of the property's own list and is excluded from this
    // door. Money the gateway moved is written on the gateway's confirmation,
    // and a desk posting claiming it would credit the drawer with money nothing
    // confirmed.
    const refused = postPaymentInput.safeParse({
      ...A_PAYMENT,
      method: "VNPAY",
      description: "Card, ****4242",
    });

    expect(refused.success).toBe(false);
    expect(
      refused.error?.issues.some((issue) => issue.path[0] === "method"),
    ).toBe(true);
  });

  it("refuses a method the property does not accept at all", () => {
    const refused = postPaymentInput.safeParse({
      ...A_PAYMENT,
      method: "CHEQUE",
    });

    expect(refused.success).toBe(false);
  });
});
