import { formatVnd } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import type { FolioPosting } from "@/features/departures/departure-queue";

import {
  correctionCount,
  DEFAULT_FOLIO_FILTERS,
  type FolioSummary,
  folioFilters,
  ledgerAgrees,
  ledgerLines,
  openingQuery,
  pageWindow,
  postedLabel,
  standing,
  standingLabel,
} from "./folio-ledger";

/* The folios screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: which typed filters
 * are a query the contract will take, what order an account's lines are read in,
 * which line was levied on which sale, which correction undoes which line, and
 * that the running balance this file sums is the same figure the API derived.
 *
 * The append-only rule is what most of it is about. A ledger that quietly netted
 * a reversal off the line it corrected would still balance, still total
 * correctly and still look right — and would have hidden the one thing this
 * screen exists to show. So the pairing is asserted in both directions and the
 * count of lines is asserted against the count of postings.
 */

const BUSINESS_DATE = "2026-08-18";

function posting(over: Partial<FolioPosting> = {}): FolioPosting {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "ROOM_CHARGE",
    amount: 1_500_000n,
    description: "Room 402, one night",
    businessDate: "2026-08-16",
    reversesPostingId: null,
    parentPostingId: null,
    chargeBasis: null,
    postedAt: "2026-08-16T21:05:00.000Z",
    postedBy: "Trần Văn A",
    ...over,
  };
}

function summary(over: Partial<FolioSummary> = {}): FolioSummary {
  return { charged: 0n, credited: 0n, outstanding: 0n, ...over };
}

describe("folioFilters", () => {
  it("asks for the accounts that do not balance, whatever their state", () => {
    // The dashboard's *Unsettled folios* card counts exactly this query and
    // leads here, so the screen's opening question has to be the same one.
    expect(folioFilters(DEFAULT_FOLIO_FILTERS, BUSINESS_DATE, 0)).toEqual({
      input: { balance: "OUTSTANDING", limit: 50, offset: 0 },
    });

    expect(openingQuery()).toEqual({
      balance: "OUTSTANDING",
      limit: 50,
      offset: 0,
    });
  });

  it("leaves out the state filter rather than sending a word for 'any'", () => {
    const attempt = folioFilters(
      { ...DEFAULT_FOLIO_FILTERS, state: "ANY" },
      BUSINESS_DATE,
      0,
    );

    expect(attempt).toEqual({
      input: { balance: "OUTSTANDING", limit: 50, offset: 0 },
    });
  });

  it("sends the state when one was chosen", () => {
    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, state: "CLOSED", balance: "ANY" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      input: { state: "CLOSED", balance: "ANY", limit: 50, offset: 0 },
    });
  });

  it("counts a typed date from the property's day, not the browser's", () => {
    const attempt = folioFilters(
      { ...DEFAULT_FOLIO_FILTERS, from: "-7d", to: "today" },
      BUSINESS_DATE,
      0,
    );

    expect(attempt).toEqual({
      input: {
        balance: "OUTSTANDING",
        from: "2026-08-11",
        to: "2026-08-18",
        limit: 50,
        offset: 0,
      },
    });
  });

  it("takes either end of the range on its own", () => {
    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, from: "15/8", to: "" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      input: {
        balance: "OUTSTANDING",
        from: "2026-08-15",
        limit: 50,
        offset: 0,
      },
    });

    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, from: "", to: "15/8" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      input: { balance: "OUTSTANDING", to: "2026-08-15", limit: 50, offset: 0 },
    });
  });

  it("names which of the two days it could not read", () => {
    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, from: "the fifteenth" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "The first day is not a date this screen can read. Type 15/3, 2026-03-15, today or -7d.",
    });

    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, to: "the fifteenth" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "The last day is not a date this screen can read. Type 15/3, 2026-03-15, today or -7d.",
    });
  });

  it("refuses a range that runs backwards, where it can still be fixed", () => {
    // The contract refuses the same pair. Refusing it here is that sentence
    // said in the property's own words before a request leaves the browser.
    expect(
      folioFilters(
        { ...DEFAULT_FOLIO_FILTERS, from: "16/8", to: "15/8" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "The last day falls before the first. Swap them, or clear one of the two.",
    });
  });

  it("waits for the property's day only when a date was typed", () => {
    expect(folioFilters(DEFAULT_FOLIO_FILTERS, null, 0)).toEqual({
      input: { balance: "OUTSTANDING", limit: 50, offset: 0 },
    });

    expect(
      folioFilters({ ...DEFAULT_FOLIO_FILTERS, from: "today" }, null, 0),
    ).toEqual({
      problem:
        "The property's day has not been read yet, and a typed date is counted from it. Try again.",
    });
  });

  it("carries the page being asked for", () => {
    expect(folioFilters(DEFAULT_FOLIO_FILTERS, BUSINESS_DATE, 100)).toEqual({
      input: { balance: "OUTSTANDING", limit: 50, offset: 100 },
    });
  });
});

describe("standing", () => {
  it("reads an account that owes money and one that is owed it apart", () => {
    expect(standing(summary({ outstanding: 1n }))).toBe("OUTSTANDING");
    expect(standing(summary({ outstanding: -1n }))).toBe("OVERPAID");
    expect(standing(summary())).toBe("SETTLED");
  });

  it("says an over-payment as money to hand back, not as a negative balance", () => {
    // The figure is compared against `formatVnd` of the *positive* amount, which
    // is the assertion worth making: the label carries the magnitude the desk
    // hands back rather than the signed balance it was derived from. The
    // currency string itself is `money.ts`'s and is not restated here — it
    // carries a non-breaking space that a literal in this file would get wrong.
    expect(
      standingLabel(summary({ charged: 1_000_000n, outstanding: -500_000n })),
    ).toBe(`${formatVnd(500_000n)} over-paid`);

    expect(standingLabel(summary({ outstanding: 500_000n }))).toBe(
      `${formatVnd(500_000n)} outstanding`,
    );

    expect(standingLabel(summary())).toBe("Settled");
  });
});

describe("pageWindow", () => {
  it("counts rows from one, against the total the API matched", () => {
    expect(pageWindow(213, 50, 0, 50)).toEqual({
      first: 1,
      last: 50,
      total: 213,
      hasPrevious: false,
      hasNext: true,
      previousOffset: 0,
      nextOffset: 50,
    });

    expect(pageWindow(213, 13, 200, 50)).toEqual({
      first: 201,
      last: 213,
      total: 213,
      hasPrevious: true,
      hasNext: false,
      previousOffset: 150,
      nextOffset: 250,
    });
  });

  it("offers nothing to press on an empty answer", () => {
    expect(pageWindow(0, 0, 0, 50)).toMatchObject({
      first: 0,
      last: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});

describe("ledgerLines", () => {
  it("draws a sale's service charge and VAT under it, in that order", () => {
    // `FR-FOL-02`: the three are written by one statement and share one
    // instant, so nothing about when they were written can order them.
    const sale = posting({ id: "a1", amount: 1_363_636n });
    const vat = posting({
      id: "a3",
      type: "VAT",
      amount: 136_364n,
      parentPostingId: "a1",
      description: "VAT",
    });
    const fee = posting({
      id: "a2",
      type: "SERVICE_CHARGE_FEE",
      amount: 68_182n,
      parentPostingId: "a1",
      description: "Service charge",
    });

    const lines = ledgerLines([vat, fee, sale]);

    expect(lines.map((line) => line.posting.id)).toEqual(["a1", "a2", "a3"]);
    expect(lines.map((line) => line.levied)).toEqual([false, true, true]);
  });

  it("keeps every posting exactly once, whatever the grouping", () => {
    const sale = posting({ id: "a1" });
    const fee = posting({
      id: "a2",
      type: "SERVICE_CHARGE_FEE",
      parentPostingId: "a1",
    });
    const payment = posting({
      id: "b1",
      type: "PAYMENT",
      amount: -1_000_000n,
      businessDate: "2026-08-17",
      postedAt: "2026-08-17T03:00:00.000Z",
    });

    const lines = ledgerLines([sale, fee, payment]);

    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((line) => line.posting.id))).toEqual(
      new Set(["a1", "a2", "b1"]),
    );
  });

  it("runs oldest first by trading day, then by the instant, then by id", () => {
    const later = posting({
      id: "c",
      businessDate: "2026-08-17",
      postedAt: "2026-08-17T01:00:00.000Z",
    });
    const earlierSameDay = posting({
      id: "b",
      businessDate: "2026-08-16",
      postedAt: "2026-08-16T22:00:00.000Z",
    });
    const earliest = posting({
      id: "a",
      businessDate: "2026-08-16",
      postedAt: "2026-08-16T21:00:00.000Z",
    });

    expect(
      ledgerLines([later, earliest, earlierSameDay]).map(
        (line) => line.posting.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("breaks a tied instant by id, so a refetch cannot re-order the ledger", () => {
    const one = posting({ id: "a" });
    const two = posting({ id: "b" });

    expect(ledgerLines([two, one]).map((line) => line.posting.id)).toEqual([
      "a",
      "b",
    ]);
    expect(ledgerLines([one, two]).map((line) => line.posting.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("pairs a correction with the line it undoes, in both directions", () => {
    const charge = posting({ id: "a1", amount: 500_000n });
    const reversal = posting({
      id: "r1",
      type: "REVERSAL",
      amount: -500_000n,
      reversesPostingId: "a1",
      businessDate: "2026-08-17",
      postedAt: "2026-08-17T02:00:00.000Z",
      description: "Posted to the wrong stay",
    });

    const [corrected, correction] = ledgerLines([charge, reversal]);

    expect(corrected?.reversedBy?.id).toBe("r1");
    expect(corrected?.reverses).toBeNull();
    expect(correction?.reverses?.id).toBe("a1");
    expect(correction?.reversedBy).toBeNull();
  });

  it("leaves the corrected line standing at the amount it was written for", () => {
    // The whole of `FR-FOL-01` in one assertion: the mistake is still on the
    // account at its original figure, and the correction is a second line.
    const charge = posting({ id: "a1", amount: 500_000n });
    const reversal = posting({
      id: "r1",
      type: "REVERSAL",
      amount: -500_000n,
      reversesPostingId: "a1",
      businessDate: "2026-08-17",
      postedAt: "2026-08-17T02:00:00.000Z",
    });

    const lines = ledgerLines([charge, reversal]);

    expect(lines.map((line) => line.posting.amount)).toEqual([
      500_000n,
      -500_000n,
    ]);
    expect(lines.map((line) => line.runningTotal)).toEqual([500_000n, 0n]);
  });

  it("runs the balance as whole đồng, line by line", () => {
    const charge = posting({ id: "a1", amount: 1_500_000n });
    const payment = posting({
      id: "b1",
      type: "PAYMENT",
      amount: -1_000_000n,
      businessDate: "2026-08-17",
      postedAt: "2026-08-17T03:00:00.000Z",
    });

    expect(
      ledgerLines([charge, payment]).map((line) => line.runningTotal),
    ).toEqual([1_500_000n, 500_000n]);
  });

  it("stands a component on its own rather than losing it when its sale is absent", () => {
    const orphan = posting({
      id: "a2",
      type: "VAT",
      amount: 136_364n,
      parentPostingId: "gone",
    });

    const lines = ledgerLines([orphan]);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.levied).toBe(false);
  });

  it("answers nothing for an account with no lines", () => {
    expect(ledgerLines([])).toEqual([]);
  });
});

describe("ledgerAgrees", () => {
  it("agrees when the lines come to the balance the API derived", () => {
    const lines = ledgerLines([
      posting({ id: "a1", amount: 1_500_000n }),
      posting({
        id: "b1",
        type: "PAYMENT",
        amount: -1_000_000n,
        businessDate: "2026-08-17",
        postedAt: "2026-08-17T03:00:00.000Z",
      }),
    ]);

    expect(
      ledgerAgrees(
        lines,
        summary({
          charged: 1_500_000n,
          credited: 1_000_000n,
          outstanding: 500_000n,
        }),
      ),
    ).toBe(true);
  });

  it("disagrees when the two derivations of one figure differ", () => {
    const lines = ledgerLines([posting({ id: "a1", amount: 1_500_000n })]);

    expect(ledgerAgrees(lines, summary({ outstanding: 1_400_000n }))).toBe(
      false,
    );
  });

  it("compares an empty account against the API's figure too", () => {
    expect(ledgerAgrees([], summary())).toBe(true);
    expect(ledgerAgrees([], summary({ outstanding: 1n }))).toBe(false);
  });
});

describe("correctionCount", () => {
  it("counts the reversing entries and nothing else", () => {
    expect(
      correctionCount([
        posting({ id: "a1" }),
        posting({ id: "r1", type: "REVERSAL", reversesPostingId: "a1" }),
        posting({ id: "r2", type: "REVERSAL", reversesPostingId: "a1" }),
      ]),
    ).toBe(2);

    expect(correctionCount([posting()])).toBe(0);
  });
});

describe("postedLabel", () => {
  it("names the member of staff who wrote the line, in the property's zone", () => {
    // 21:05 UTC on the 16th is 04:05 on the 17th in Ho Chi Minh City.
    expect(postedLabel(posting())).toBe("17 Aug 2026, 04:05, by Trần Văn A");
  });

  it("says a line nobody authored was not authored by a person", () => {
    expect(postedLabel(posting({ postedBy: null }))).toBe(
      "17 Aug 2026, 04:05, by the night audit or the payment gateway",
    );
  });
});
