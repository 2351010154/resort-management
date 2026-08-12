import { describe, expect, it } from "vitest";
import {
  type HeldStay,
  isBooked,
  isLost,
  isSettled,
  readCaption,
  stayTotal,
} from "./stay-funnel";

/**
 * A stay as the API answers it, in whichever state the test is about.
 *
 * Written out in full rather than partially cast, because the fields the
 * predicates read are the point: a stay whose `state` were optional would let a
 * test pass against a shape the API cannot produce.
 */
const stayIn = (state: HeldStay["state"]): HeldStay => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  reference: "MRV4K2QX",
  userId: "guest-account",
  state,
  cancellationReason: null,
  roomType: "DELUXE",
  checkIn: "2026-08-20",
  checkOut: "2026-08-22",
  plan: "STANDARD",
  adults: 2,
  childAges: [],
  stayTotalGross: 4_200_000n,
  holdExpiresAt: null,
});

describe("readCaption", () => {
  it("reads back each caption the API sends", () => {
    expect(readCaption("confirming")).toBe("confirming");
    expect(readCaption("refused")).toBe("refused");
    expect(readCaption("unfinished")).toBe("unfinished");
    expect(readCaption("unverified")).toBe("unverified");
  });

  it("calls a landing that carries none unknown", () => {
    expect(readCaption(null)).toBe("unknown");
  });

  it("calls anything else unknown rather than trusting it", () => {
    expect(readCaption("paid")).toBe("unknown");
    expect(readCaption("")).toBe("unknown");
  });
});

describe("isSettled", () => {
  it("is false while the stay is still being held", () => {
    expect(isSettled(stayIn("HELD"))).toBe(false);
  });

  it("is true once the callback has confirmed it", () => {
    expect(isSettled(stayIn("CONFIRMED"))).toBe(true);
  });

  // The reason a screen may not read this as "the money landed" on its own. A
  // released hold has also stopped being one, and it is the opposite fact.
  it("is true for a stay that stopped being held by being cancelled", () => {
    expect(isSettled(stayIn("CANCELLED"))).toBe(true);
  });
});

describe("isLost", () => {
  it("names the stay nobody can pay for any more", () => {
    expect(isLost(stayIn("CANCELLED"))).toBe(true);
  });

  it("is false for a hold that is still running and one that was paid", () => {
    expect(isLost(stayIn("HELD"))).toBe(false);
    expect(isLost(stayIn("CONFIRMED"))).toBe(false);
  });
});

describe("isBooked", () => {
  it("is true only for the stay a payment confirmed", () => {
    expect(isBooked(stayIn("CONFIRMED"))).toBe(true);
  });

  it("is false while the stay is still being held", () => {
    expect(isBooked(stayIn("HELD"))).toBe(false);
  });

  // The whole reason it is not `isSettled`. A hold released while its guest was
  // at the gateway has stopped being held and is the opposite of a booking, and
  // a screen reading the two as one thanks that guest for a payment and sends
  // them to a confirmation for a room that is back on sale.
  it("is false for a hold that was released while the guest was paying", () => {
    expect(isBooked(stayIn("CANCELLED"))).toBe(false);
  });
});

describe("stayTotal", () => {
  it("reads the bigint the contract declares", () => {
    expect(stayTotal(stayIn("HELD"))).toBe(4_200_000n);
  });

  // The normalisation `stayTotal` exists for. `money.ts` crosses đồng as decimal
  // text because JSON has no integer wide enough, so what a given transport
  // hands back is the transport's business — and a widening of that boundary
  // must not quietly turn a total into a number that has lost đồng.
  it("reads a total that arrived as the decimal text the wire carries", () => {
    const asText = { ...stayIn("HELD"), stayTotalGross: "4200000" };

    expect(stayTotal(asText as unknown as HeldStay)).toBe(4_200_000n);
  });
});
