import { SEARCH_RESULT_LIMIT } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  balanceDue,
  CHECKOUT_STEPS,
  checkOutRefusal,
  type Departure,
  departureAfter,
  type Folio,
  isClosed,
  overpayment,
  parseAmount,
  refusalSentence,
  refusalStep,
  type SearchResults,
  sequenceSteps,
  stepAfter,
  todaysDepartures,
} from "./departure-queue";

/* The queue's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives: what
 * matters about the sequence's focus behaviour is where focus actually lands,
 * and jsdom has no layout to answer that with. What is covered instead is
 * everything underneath the markup — which stays are in the queue, in what
 * order, how many steps this checkout has, where the next row is, what the
 * account is short, and what an operator's keystrokes parse to.
 */

const TODAY = "2026-08-16";

function stay(over: Partial<Departure> = {}): Departure {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "BK-1000",
    state: "CHECKED_IN",
    roomType: "DELUXE",
    checkIn: "2026-08-14",
    checkOut: TODAY,
    roomNumber: "201",
    guestNames: ["Nguyễn Thị Hương"],
    ...over,
  };
}

function answer(bookings: Departure[]): SearchResults {
  return { scope: "everything", rooms: [], bookings, guests: [] };
}

function account(over: Partial<Folio> = {}): Folio {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    bookingId: stay().id,
    state: "OPEN",
    openedAt: "2026-08-14T09:00:00.000Z",
    closedAt: null,
    summary: { charged: 2_000_000n, credited: 2_000_000n, outstanding: 0n },
    postings: [],
    ...over,
  };
}

function settling(outstanding: bigint): Folio {
  return account({
    summary: { charged: 2_000_000n, credited: 0n, outstanding },
  });
}

describe("cutting today's queue out of the search", () => {
  it("keeps the checked-in stays leaving on the property's day", () => {
    const queue = todaysDepartures(
      answer([
        stay({ reference: "BK-1001", roomNumber: "201" }),
        stay({
          reference: "BK-1002",
          roomNumber: "202",
          checkOut: "2026-08-18",
        }),
      ]),
      TODAY,
    );

    expect(queue?.departures.map((one) => one.reference)).toEqual(["BK-1001"]);
  });

  it("drops a stay somebody has already checked out", () => {
    // The answer is shared with the dashboard's count and read from the cache
    // while a refetch is in flight, so a stay a colleague ended seconds ago can
    // still be in it.
    const queue = todaysDepartures(
      answer([
        stay({ state: "CHECKED_OUT", roomNumber: "201" }),
        stay({ reference: "BK-1003", roomNumber: "202" }),
      ]),
      TODAY,
    );

    expect(queue?.departures.map((one) => one.reference)).toEqual(["BK-1003"]);
  });

  it("orders the queue by room, numerically, because that is how a guest asks", () => {
    const queue = todaysDepartures(
      answer([
        stay({ reference: "BK-1009", roomNumber: "10" }),
        stay({ reference: "BK-1002", roomNumber: "9" }),
        stay({ reference: "BK-1005", roomNumber: "101" }),
      ]),
      TODAY,
    );

    expect(queue?.departures.map((one) => one.roomNumber)).toEqual([
      "9",
      "10",
      "101",
    ]);
  });

  it("breaks a tie on the reference so the order cannot move between two presses", () => {
    const queue = todaysDepartures(
      answer([
        stay({ reference: "BK-1009", roomNumber: "204" }),
        stay({ reference: "BK-1002", roomNumber: "204" }),
      ]),
      TODAY,
    );

    expect(queue?.departures.map((one) => one.reference)).toEqual([
      "BK-1002",
      "BK-1009",
    ]);
  });

  it("keeps a stay holding no room, and puts it last", () => {
    // Still leaving today. Dropping it would be the console deciding a row does
    // not exist because it cannot label it.
    const queue = todaysDepartures(
      answer([
        stay({ reference: "BK-1009", roomNumber: null }),
        stay({ reference: "BK-1002", roomNumber: "999" }),
      ]),
      TODAY,
    );

    expect(queue?.departures.map((one) => one.reference)).toEqual([
      "BK-1002",
      "BK-1009",
    ]);
  });

  it("says when the search answered its own ceiling", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_unused, at) =>
      stay({ reference: `BK-${2000 + at}`, roomNumber: `${200 + at}` }),
    );

    expect(todaysDepartures(answer(full), TODAY)?.truncated).toBe(true);
    expect(todaysDepartures(answer(full.slice(1)), TODAY)?.truncated).toBe(
      false,
    );
  });

  it("refuses to call a narrowed answer an empty queue", () => {
    // A grant covering rooms only. "Nobody is leaving" would be a different and
    // false statement about the property.
    expect(todaysDepartures({ scope: "rooms", rooms: [] }, TODAY)).toBeNull();
  });
});

describe("where focus goes when a row leaves the queue", () => {
  const first = stay({ id: "a", reference: "BK-1001", roomNumber: "201" });
  const middle = stay({ id: "b", reference: "BK-1002", roomNumber: "202" });
  const last = stay({ id: "c", reference: "BK-1003", roomNumber: "203" });

  it("moves to the next departure", () => {
    expect(departureAfter([first, middle, last], "b")).toBe("c");
  });

  it("moves back one when the finished row was the last", () => {
    expect(departureAfter([first, middle, last], "c")).toBe("b");
  });

  it("answers nothing when the queue is now empty", () => {
    expect(departureAfter([], "a")).toBeNull();
  });

  it("falls to the head of the queue when the row is not in it", () => {
    expect(departureAfter([first, middle], "gone")).toBe("a");
  });
});

describe("reading the account", () => {
  it("reports what the guest still owes", () => {
    expect(balanceDue(settling(450_000n))).toBe(450_000n);
  });

  it("reports nothing due on a settled account", () => {
    expect(balanceDue(account())).toBe(0n);
  });

  it("does not report an over-payment as a balance due", () => {
    expect(balanceDue(settling(-200_000n))).toBe(0n);
  });

  it("reports an over-payment as its own positive figure", () => {
    // Money the property is holding and the guest has not been given back —
    // both the close and the check-out refuse on it.
    expect(overpayment(settling(-200_000n))).toBe(200_000n);
  });

  it("reports no over-payment on an account that is short", () => {
    expect(overpayment(settling(450_000n))).toBe(0n);
  });

  it("knows an account that has already been agreed", () => {
    expect(isClosed(account())).toBe(false);
    expect(
      isClosed(
        account({ state: "CLOSED", closedAt: "2026-08-16T04:00:00.000Z" }),
      ),
    ).toBe(true);
  });
});

describe("how many steps this checkout has", () => {
  it("asks for a payment when the account is short", () => {
    expect(sequenceSteps({ balanceDue: true })).toEqual([
      "account",
      "payment",
      "settlement",
    ]);
  });

  it("goes straight through when there is nothing to collect", () => {
    // The ordinary case for a stay booked through the funnel: it arrived paid
    // in full, so a payment step would be a press spent on nothing.
    expect(sequenceSteps({ balanceDue: false })).toEqual([
      "account",
      "settlement",
    ]);
  });

  it("always reads the charges and always ends with the press that ends the stay", () => {
    for (const balance of [true, false]) {
      const steps = sequenceSteps({ balanceDue: balance });

      expect(steps[0]).toBe("account");
      expect(steps.at(-1)).toBe("settlement");
    }
  });

  it("walks the steps it was given and stops at the end", () => {
    const steps = sequenceSteps({ balanceDue: false });

    expect(stepAfter(steps, "account")).toBe("settlement");
    expect(stepAfter(steps, "settlement")).toBeNull();
  });

  it("skips the payment step a settled account does not have", () => {
    expect(stepAfter(sequenceSteps({ balanceDue: false }), "account")).toBe(
      "settlement",
    );
    expect(stepAfter(sequenceSteps({ balanceDue: true }), "account")).toBe(
      "payment",
    );
  });

  it("names every step the sequence can show", () => {
    expect(CHECKOUT_STEPS).toEqual(["account", "payment", "settlement"]);
  });
});

describe("reading a refused check-out", () => {
  it("reads the contract's code off the error", () => {
    expect(checkOutRefusal({ data: { code: "FOLIO_NOT_SETTLED" } })).toBe(
      "FOLIO_NOT_SETTLED",
    );
  });

  it("answers nothing for an error carrying no code the contract declares", () => {
    // An illegal transition, or a network that was not there. The central toast
    // has it; the sequence has nowhere to steer.
    expect(checkOutRefusal({ data: { code: "SOMETHING_ELSE" } })).toBeNull();
    expect(checkOutRefusal({ message: "Failed to fetch" })).toBeNull();
    expect(checkOutRefusal(null)).toBeNull();
    expect(checkOutRefusal("nope")).toBeNull();
  });

  it("sends the operator back to the charges, where the fresh ledger is", () => {
    // Reaching the refusal means the balance this sequence held was stale, so a
    // payment field prefilled from it would ask for the wrong money.
    expect(refusalStep("FOLIO_NOT_SETTLED")).toBe("account");
  });

  it("says what happened in words that name the next act", () => {
    expect(refusalSentence("FOLIO_NOT_SETTLED")).toContain("charges again");
  });
});

describe("an amount an operator typed", () => {
  it("reads a plain figure", () => {
    expect(parseAmount("450000")).toBe(450_000n);
  });

  it("reads the grouping a receptionist can see on the screen", () => {
    expect(parseAmount("1.500.000")).toBe(1_500_000n);
    expect(parseAmount(" 1 500 000 ")).toBe(1_500_000n);
  });

  it("refuses a comma, which is the decimal mark đồng has no use for", () => {
    // Reading it as a grouping mark would post a hundredfold of what was meant.
    expect(parseAmount("1,500")).toBeNull();
  });

  it("refuses nothing, less than nothing, and what is not a figure", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-450000")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("cash")).toBeNull();
  });
});
