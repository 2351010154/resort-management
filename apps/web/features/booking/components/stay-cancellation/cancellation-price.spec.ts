import { describe, expect, it } from "vitest";
import type { CancellationQuote } from "./cancellation";
import { priceOfCancelling } from "./cancellation-price";

/** A quote as the API answers one. The wire carries the amount as decimal text
 *  and the contract declares a `bigint`, so both forms are exercised below. */
const quote = (
  basis: CancellationQuote["basis"],
  amount: CancellationQuote["amount"],
): CancellationQuote => ({ basis, amount });

describe("what a row of the grid says", () => {
  it("calls a free cancellation free, and quotes no figure for it", () => {
    const price = priceOfCancelling(quote("NONE", 0n));

    expect(price.cost).toBe("Cancelling this stay costs nothing.");
    expect(price.amount).toBeNull();
    expect(price.refund).toBeNull();
  });

  it("names the first night, and what it comes to", () => {
    const price = priceOfCancelling(quote("FIRST_NIGHT", 1_200_000n));

    expect(price.cost).toBe("Cancelling now costs the first night.");
    expect(price.amount).toBe(1_200_000n);
    expect(price.refund).toBeNull();
  });

  it("says nothing comes back on a non-refundable rate", () => {
    const price = priceOfCancelling(quote("FULL_STAY", 3_700_000n));

    expect(price.amount).toBe(3_700_000n);
    expect(price.refund).toBe("Nothing you have paid comes back.");
  });

  it("speaks of money paid without claiming any has been", () => {
    // A `HELD` stay is quotable and cancellable, and has paid nothing. The one
    // sentence left about money already handed over is a rule rather than a
    // claim that any money exists, so its wording is true of an unpaid hold and
    // of a stay paid in full alike.
    expect(priceOfCancelling(quote("FULL_STAY", 1n)).refund).toContain(
      "you have paid",
    );
  });

  it("promises money back on no row at all", () => {
    // Refunds are started by staff out of band, and no code path returns money
    // on its own, so a row that told a guest their money was coming back would
    // be committing somebody else to an act nobody has asked for. Every basis
    // but the non-refundable one states its charge and stops. The two
    // early-departure rows have a second reason: they cannot reach a
    // cancellation quote, and the nights already slept are on the folio.
    for (const basis of [
      "NONE",
      "FIRST_NIGHT",
      "REMAINING_NIGHTS_HALF",
      "REMAINING_NIGHTS_FULL",
    ] as const) {
      expect(priceOfCancelling(quote(basis, 1n)).refund).toBeNull();
    }
  });
});

describe("the figure, whichever way it arrives", () => {
  it("reads the amount the transport hands back", () => {
    // `money.ts` crosses the two processes as decimal text because JSON has no
    // integer wide enough for money, and the contract declares the `bigint`
    // either side of it. A panel that trusted one form would lose đồng the day
    // that boundary widened.
    const asText = { basis: "FIRST_NIGHT", amount: "1200000" };

    expect(
      priceOfCancelling(asText as unknown as CancellationQuote).amount,
    ).toBe(1_200_000n);
  });

  it("drops a figure of nothing rather than printing it", () => {
    // A zero beside "this cancellation is free" is the same fact twice, and a
    // charge of ₫0 on any other row is a figure that tells the guest nothing.
    expect(priceOfCancelling(quote("FIRST_NIGHT", 0n)).amount).toBeNull();
  });

  it("reads the row and not the number", () => {
    // The claim `policy-charge.ts` exists to make: two quotes that come to the
    // same money say different things, because the property decided different
    // things.
    expect(priceOfCancelling(quote("NONE", 0n)).cost).not.toBe(
      priceOfCancelling(quote("FIRST_NIGHT", 0n)).cost,
    );
  });
});
