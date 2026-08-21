import { postPaymentInput } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  DESK_PAYMENT_METHODS,
  type DeskPaymentFields,
  deskPaymentAttempt,
  METHOD_LABELS,
  OFFERED_PAYMENT_METHODS,
  parseAmount,
} from "./desk-payment";

const STAY = "11111111-1111-4111-8111-111111111111";

/** The refusal the arrivals step passes in, used wherever the caller's own
 *  sentence is not what is under test. */
const NOTHING_HANDED_OVER =
  "A deposit is money handed over, so it is a figure above nothing.";

function typed(over: Partial<DeskPaymentFields> = {}): DeskPaymentFields {
  return {
    amount: "500000",
    method: "BANK_TRANSFER",
    description: "Deposit taken at check-in",
    ...over,
  };
}

describe("a figure typed at the desk", () => {
  it("reads the grouping marks a vi-VN keyboard puts in", () => {
    expect(parseAmount("1.500.000")).toBe(1_500_000n);
    expect(parseAmount("1 500 000")).toBe(1_500_000n);
  });

  it("refuses nothing, less than nothing, and what is not a figure", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-450000")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("cash")).toBeNull();
  });

  it("refuses a comma, which is the decimal mark and not a grouping one", () => {
    // A đồng has no minor unit, so a comma is somebody typing one. Read as a
    // grouping mark it would post a hundredfold of what was meant.
    expect(parseAmount("1,50")).toBeNull();
  });
});

describe("how the money arrived", () => {
  it("names the two ways a desk can be paid and no gateway", () => {
    expect([...DESK_PAYMENT_METHODS]).toStrictEqual(["CASH", "BANK_TRANSFER"]);
  });

  it("cannot reach the gateway's method, which only the IPN handler writes", () => {
    // Both halves of the boundary. The console has no `VNPAY` to offer, and the
    // route would refuse it if something here invented one — a desk posting able
    // to claim the gateway's method would credit the property with money the
    // gateway never confirmed.
    expect([...DESK_PAYMENT_METHODS]).not.toContain("VNPAY");
    expect(
      postPaymentInput.safeParse({
        bookingId: STAY,
        amount: "500000",
        method: "VNPAY",
        description: "Deposit taken at check-in",
      }).success,
    ).toBe(false);
  });

  it("has words on screen for every method the contract carries", () => {
    for (const method of DESK_PAYMENT_METHODS) {
      expect(METHOD_LABELS[method]).not.toBe("");
    }
  });

  it("offers cash, now that the route binds it to a drawer", () => {
    // Cash belongs to the drawer it was counted into, and `folio.postPayment`
    // resolves the operator's open shift and binds the payment to it. The one
    // case it still refuses — an operator on no drawer — carries a code the
    // checkout sequence acts on by opening one in place, so the radio is
    // offered rather than withheld from the property's most ordinary
    // settlement.
    expect([...OFFERED_PAYMENT_METHODS]).toStrictEqual([
      ...DESK_PAYMENT_METHODS,
    ]);
    expect([...OFFERED_PAYMENT_METHODS]).toContain("CASH");
    expect(
      postPaymentInput.safeParse({
        bookingId: STAY,
        amount: "500000",
        method: "CASH",
        description: "Deposit taken at check-in",
      }).success,
    ).toBe(true);
  });
});

describe("the money the desk sends", () => {
  it("carries the method the desk picked", () => {
    expect(
      deskPaymentAttempt(
        STAY,
        typed({ method: "BANK_TRANSFER" }),
        NOTHING_HANDED_OVER,
      ),
    ).toStrictEqual({
      payment: {
        bookingId: STAY,
        amount: "500000",
        method: "BANK_TRANSFER",
        description: "Deposit taken at check-in",
      },
    });

    expect(
      deskPaymentAttempt(STAY, typed({ method: "CASH" }), NOTHING_HANDED_OVER),
    ).toStrictEqual({
      payment: {
        bookingId: STAY,
        amount: "500000",
        method: "CASH",
        description: "Deposit taken at check-in",
      },
    });
  });

  it("is a body the route accepts", () => {
    const attempt = deskPaymentAttempt(STAY, typed(), NOTHING_HANDED_OVER);

    expect("payment" in attempt).toBe(true);
    expect(
      postPaymentInput.safeParse("payment" in attempt ? attempt.payment : null)
        .success,
    ).toBe(true);
  });

  it("refuses to guess a method nobody stated", () => {
    const attempt = deskPaymentAttempt(
      STAY,
      typed({ method: null }),
      NOTHING_HANDED_OVER,
    );

    // Not a default, not the likelier of the two. The ledger is append-only, so
    // a line posted without a method can never be told which it was, and the
    // drawer the day's report asks about is counted from that distinction.
    expect("payment" in attempt).toBe(false);
    expect("problem" in attempt && attempt.problem).toContain(
      "how the money arrived",
    );
  });

  it("reads the amount the way the screen printed it, as text on the wire", () => {
    expect(
      deskPaymentAttempt(
        STAY,
        typed({ amount: "1.500.000" }),
        NOTHING_HANDED_OVER,
      ),
    ).toStrictEqual({
      payment: {
        bookingId: STAY,
        amount: "1500000",
        method: "BANK_TRANSFER",
        description: "Deposit taken at check-in",
      },
    });
  });

  it("names the first thing wrong and only that", () => {
    expect(
      deskPaymentAttempt(
        STAY,
        typed({ amount: "0", method: null }),
        NOTHING_HANDED_OVER,
      ),
    ).toStrictEqual({ problem: NOTHING_HANDED_OVER });

    expect(
      deskPaymentAttempt(
        STAY,
        typed({ description: "   ", method: null }),
        NOTHING_HANDED_OVER,
      ),
    ).toStrictEqual({
      problem: "The line needs a description — it is what the guest reads.",
    });
  });

  it("says the noun the step the operator is standing in uses", () => {
    // The one sentence the two steps do not share: a deposit is handed over and
    // a settlement is received, and an operator told the wrong noun has to work
    // out which form they are in.
    const settlement =
      "A payment is money received, so it is a figure above nothing.";

    expect(
      deskPaymentAttempt(STAY, typed({ amount: "0" }), settlement),
    ).toStrictEqual({ problem: settlement });
  });

  it("trims the line the guest reads", () => {
    const attempt = deskPaymentAttempt(
      STAY,
      typed({ description: "  Transfer  " }),
      NOTHING_HANDED_OVER,
    );

    expect("payment" in attempt && attempt.payment.description).toBe(
      "Transfer",
    );
  });
});
