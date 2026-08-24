import { formatVnd, PAYMENT_PAGE_SIZE } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAYMENT_FILTERS,
  DISCREPANCY_LABELS,
  discrepancyEntries,
  type ListedPayment,
  mayReconcile,
  NIGHTS_IN_VIEW,
  nightReading,
  openingQuestion,
  type PaymentDiscrepancy,
  paidLabel,
  paymentFilters,
  paymentRows,
  type ReconciledNight,
  type ReconciliationRun,
  recentNights,
  refundCandidateInput,
  reportedAmount,
  tradingDayLabel,
} from "./payment-day";

/* The payments screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: which typed filters
 * are a query the contract will take, which trading day the two reads are both
 * about, which night a row's disagreement is held by, and what the screen says
 * about a night nobody has compared yet.
 *
 * The rule most of it is about is that this screen never restates a
 * disagreement's figures. A console that computed the difference between what a
 * gateway reported and what the ledger holds would be a second observation of a
 * night, made on a machine that did not look at the night — so the assertions
 * below check that a row is joined to the reconciliation's own row by id, and
 * that a row whose night is not on screen offers the way to that night instead
 * of any number at all.
 */

const BUSINESS_DATE = "2026-08-18";

function payment(over: Partial<ListedPayment> = {}): ListedPayment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    folioId: "33333333-3333-4333-8333-333333333333",
    method: "VNPAY",
    status: "SUCCESS",
    amount: 1_500_000n,
    gatewayTransactionId: "14020821",
    paidAt: "2026-08-17T21:05:00.000Z",
    businessDate: "2026-08-18",
    discrepancyId: null,
    ...over,
  };
}

function discrepancy(
  over: Partial<PaymentDiscrepancy> = {},
): PaymentDiscrepancy {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    attemptReference: "MARIVA-2026-0817-0001",
    kind: "AMOUNT_MISMATCH",
    gatewayAmount: 1_500_000n,
    ledgerAmount: 1_400_000n,
    paymentId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-08-18T21:05:00.000Z",
    ...over,
  };
}

function night(over: Partial<ReconciledNight> = {}): ReconciledNight {
  return {
    businessDate: BUSINESS_DATE,
    reconciledAt: "2026-08-18T21:05:00.000Z",
    discrepancies: [],
    ...over,
  };
}

function run(businessDate: string, discrepancyCount = 0): ReconciliationRun {
  return {
    businessDate,
    reconciledAt: `${businessDate}T21:05:00.000Z`,
    discrepancyCount,
  };
}

describe("mayReconcile", () => {
  it("offers the screen to the roles the matrix grants the reconciliation row", () => {
    expect(mayReconcile("ACCOUNTANT")).toBe(true);
    expect(mayReconcile("MANAGER")).toBe(true);
    expect(mayReconcile("ADMIN")).toBe(true);
  });

  it("withholds it from the desk, whose money work is the folio's", () => {
    // The rail offers a receptionist this family because a refund is worked
    // from it, and every read on this screen is governed by the one key they
    // are not granted. Showing them the table would be three 403s.
    expect(mayReconcile("RECEPTIONIST")).toBe(false);
    expect(mayReconcile("HOUSEKEEPING")).toBe(false);
  });
});

describe("DISCREPANCY_LABELS", () => {
  it("names a disagreement by what it is rather than by its money", () => {
    for (const sentence of Object.values(DISCREPANCY_LABELS)) {
      expect(sentence).not.toMatch(/\d/);
    }
  });
});

describe("paymentFilters", () => {
  it("opens on everything the property was paid today", () => {
    expect(paymentFilters(DEFAULT_PAYMENT_FILTERS, BUSINESS_DATE, 0)).toEqual({
      question: {
        input: {
          businessDate: BUSINESS_DATE,
          limit: PAYMENT_PAGE_SIZE,
          offset: 0,
        },
        day: BUSINESS_DATE,
      },
    });

    expect(openingQuestion(BUSINESS_DATE)).toEqual({
      input: {
        businessDate: BUSINESS_DATE,
        limit: PAYMENT_PAGE_SIZE,
        offset: 0,
      },
      day: BUSINESS_DATE,
    });
  });

  it("has no opening question before the property has said what day it is", () => {
    // "Today" has no honest answer until the API resolves it: the day rolls at
    // 04:00 and the browser's calendar date is the wrong one at 01:30.
    expect(openingQuestion(null)).toBeNull();
  });

  it("counts a typed day from the property's day, not the browser's", () => {
    expect(
      paymentFilters(
        { ...DEFAULT_PAYMENT_FILTERS, day: "-1d" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      question: {
        input: {
          businessDate: "2026-08-17",
          limit: PAYMENT_PAGE_SIZE,
          offset: 0,
        },
        day: "2026-08-17",
      },
    });
  });

  it("asks about every day when the day is cleared, and names no night", () => {
    // The only way to reach an attempt that moved no money: a pending or
    // refused row belongs to no trading day, so naming one excludes it.
    expect(
      paymentFilters(
        { ...DEFAULT_PAYMENT_FILTERS, day: "", status: "FAILED" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      question: {
        input: { status: "FAILED", limit: PAYMENT_PAGE_SIZE, offset: 0 },
        day: null,
      },
    });
  });

  it("leaves out a filter rather than sending a word for 'any'", () => {
    const attempt = paymentFilters(
      { ...DEFAULT_PAYMENT_FILTERS, method: "ANY", status: "ANY" },
      BUSINESS_DATE,
      0,
    );

    expect(attempt).toEqual({
      question: {
        input: {
          businessDate: BUSINESS_DATE,
          limit: PAYMENT_PAGE_SIZE,
          offset: 0,
        },
        day: BUSINESS_DATE,
      },
    });
  });

  it("sends all four dimensions when all four were chosen", () => {
    expect(
      paymentFilters(
        {
          day: "17/8",
          bookingId: "22222222-2222-4222-8222-222222222222",
          method: "CASH",
          status: "REFUNDED",
        },
        BUSINESS_DATE,
        50,
      ),
    ).toEqual({
      question: {
        input: {
          businessDate: "2026-08-17",
          bookingId: "22222222-2222-4222-8222-222222222222",
          method: "CASH",
          status: "REFUNDED",
          limit: PAYMENT_PAGE_SIZE,
          offset: 50,
        },
        day: "2026-08-17",
      },
    });
  });

  it("waits for the property's day rather than counting from nothing", () => {
    expect(paymentFilters(DEFAULT_PAYMENT_FILTERS, null, 0)).toEqual({
      problem:
        "The property's day has not been read yet, and a typed date is counted from it. Try again.",
    });
  });

  it("refuses a day it cannot read, in the words the operator can act on", () => {
    expect(
      paymentFilters(
        { ...DEFAULT_PAYMENT_FILTERS, day: "last Tuesday" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "That is not a day this screen can read. Type 15/3, 2026-03-15, today or -1d.",
    });
  });

  it("refuses a stay id the route would refuse, before the request leaves", () => {
    expect(
      paymentFilters(
        { ...DEFAULT_PAYMENT_FILTERS, bookingId: "BK-1042" },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "That is not a stay's identifier. Copy the whole id printed on the stay's folio.",
    });
  });

  it("refuses an id of the right shape that is not one this product mints", () => {
    // Five groups of the right lengths, all hexadecimal, and still not a v4
    // identifier — the contract's own schema is what knows the difference, so
    // the refusal happens here rather than as a 400 after the request.
    expect(
      paymentFilters(
        {
          ...DEFAULT_PAYMENT_FILTERS,
          bookingId: "22222222-2222-9222-c222-222222222222",
        },
        BUSINESS_DATE,
        0,
      ),
    ).toEqual({
      problem:
        "That is not a stay's identifier. Copy the whole id printed on the stay's folio.",
    });
  });

  it("takes a stay id however it was pasted", () => {
    const attempt = paymentFilters(
      {
        ...DEFAULT_PAYMENT_FILTERS,
        bookingId: "  22222222-2222-4222-8222-222222222222  ",
      },
      BUSINESS_DATE,
      0,
    );

    expect(attempt).toEqual({
      question: {
        input: {
          businessDate: BUSINESS_DATE,
          bookingId: "22222222-2222-4222-8222-222222222222",
          limit: PAYMENT_PAGE_SIZE,
          offset: 0,
        },
        day: BUSINESS_DATE,
      },
    });
  });
});

describe("refundCandidateInput", () => {
  it("keeps only the desk-safe day, method and paging filters", () => {
    expect(
      refundCandidateInput({
        input: {
          businessDate: BUSINESS_DATE,
          bookingId: "22222222-2222-4222-8222-222222222222",
          method: "CASH",
          status: "SUCCESS",
          limit: PAYMENT_PAGE_SIZE,
          offset: PAYMENT_PAGE_SIZE,
        },
        day: BUSINESS_DATE,
      }),
    ).toEqual({
      businessDate: BUSINESS_DATE,
      method: "CASH",
      limit: PAYMENT_PAGE_SIZE,
      offset: PAYMENT_PAGE_SIZE,
    });
  });
});

describe("nightReading", () => {
  it("is pending while the comparison is in flight", () => {
    expect(nightReading(undefined, undefined)).toEqual({ status: "pending" });
  });

  it("hands the night over whole once it is read", () => {
    const read = night({ discrepancies: [discrepancy()] });

    expect(nightReading(read, undefined)).toEqual({
      status: "ready",
      night: read,
    });
  });

  it("reads a day with no run as unswept rather than as a fault", () => {
    // The ordinary state of the day in progress: the sweep compares a night
    // after the property's day closes.
    expect(nightReading(undefined, 404)).toEqual({ status: "unswept" });
  });

  it("reads anything else as the failure it is", () => {
    expect(nightReading(undefined, 500)).toEqual({ status: "failed" });
    expect(nightReading(undefined, null)).toEqual({ status: "failed" });
  });
});

describe("paymentRows", () => {
  it("floats disagreements to the top and keeps the route's order inside each group", () => {
    const disputed = payment({ id: "b", discrepancyId: "d-1" });
    const first = payment({ id: "a" });
    const second = payment({ id: "c" });

    const rows = paymentRows([first, disputed, second], null);

    expect(rows.map((row) => row.payment.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps every payment on the page exactly once", () => {
    const page = [
      payment({ id: "a" }),
      payment({ id: "b", discrepancyId: "d" }),
    ];

    expect(paymentRows(page, null)).toHaveLength(page.length);
  });

  it("hands over the night's own observation rather than a figure of its own", () => {
    const observed = discrepancy();
    const rows = paymentRows(
      [payment({ discrepancyId: observed.id })],
      night({ discrepancies: [observed] }),
    );

    expect(rows[0].discrepancy).toBe(observed);
    expect(rows[0].route).toEqual({
      kind: "in-view",
      discrepancyId: observed.id,
    });
  });

  it("names the night that holds a disagreement the one on screen does not", () => {
    // A list spanning several days, or a night that is simply not this row's:
    // the row offers the way to the trading day it moved on, and no money.
    const rows = paymentRows(
      [payment({ discrepancyId: "d-1", businessDate: "2026-08-14" })],
      night({ discrepancies: [discrepancy({ id: "d-2" })] }),
    );

    expect(rows[0].discrepancy).toBeNull();
    expect(rows[0].route).toEqual({
      kind: "other-night",
      businessDate: "2026-08-14",
    });
  });

  it("says so when the disagreement belongs to no trading day at all", () => {
    const rows = paymentRows(
      [
        payment({
          discrepancyId: "d-1",
          status: "PENDING",
          paidAt: null,
          businessDate: null,
        }),
      ],
      null,
    );

    expect(rows[0].route).toEqual({ kind: "undated" });
  });

  it("leaves an ordinary payment carrying nothing to explain", () => {
    const rows = paymentRows([payment()], night());

    expect(rows[0]).toEqual({
      payment: payment(),
      discrepancy: null,
      route: { kind: "none" },
    });
  });
});

describe("discrepancyEntries", () => {
  it("marks the disagreements whose payment is in the list beside them", () => {
    const entries = discrepancyEntries(
      night({ discrepancies: [discrepancy()] }),
      [payment()],
    );

    expect(entries[0].onScreen).toBe(true);
  });

  it("marks the money this property has no payment row for", () => {
    // `MISSING_LOCALLY` names an attempt the gateway reported and the ledger
    // never wrote, so no filter could bring it into the table.
    const entries = discrepancyEntries(
      night({
        discrepancies: [
          discrepancy({
            kind: "MISSING_LOCALLY",
            paymentId: null,
            ledgerAmount: null,
          }),
        ],
      }),
      [payment()],
    );

    expect(entries[0].onScreen).toBe(false);
  });

  it("marks a disagreement whose payment the filters have narrowed away", () => {
    const entries = discrepancyEntries(
      night({ discrepancies: [discrepancy({ paymentId: "elsewhere" })] }),
      [payment()],
    );

    expect(entries[0].onScreen).toBe(false);
  });

  it("keeps the order the route answered in", () => {
    const first = discrepancy({ id: "d-1", attemptReference: "A" });
    const second = discrepancy({ id: "d-2", attemptReference: "B" });

    expect(
      discrepancyEntries(night({ discrepancies: [first, second] }), []).map(
        (entry) => entry.discrepancy.id,
      ),
    ).toEqual(["d-1", "d-2"]);
  });
});

describe("recentNights", () => {
  it("puts the newest night first whatever order it arrived in", () => {
    expect(
      recentNights([
        run("2026-08-16"),
        run("2026-08-18"),
        run("2026-08-17"),
      ]).map((reconciled) => reconciled.businessDate),
    ).toEqual(["2026-08-18", "2026-08-17", "2026-08-16"]);
  });

  it("keeps a week of them in view and no more", () => {
    const runs = Array.from({ length: 30 }, (_, index) =>
      run(`2026-07-${String(index + 1).padStart(2, "0")}`),
    );

    expect(recentNights(runs)).toHaveLength(NIGHTS_IN_VIEW);
  });
});

describe("reportedAmount", () => {
  it("prints a figure as đồng", () => {
    expect(reportedAmount(1_500_000n)).toBe(formatVnd(1_500_000n));
  });

  it("keeps 'reported nothing' apart from 'reported nothing at all'", () => {
    // A side that sent no figure and a side that reported a payment of zero are
    // different claims about a night, and the classification beside them is
    // only readable if the two never print the same.
    expect(reportedAmount(null)).toBe("Nothing reported");
    expect(reportedAmount(0n)).not.toBe("Nothing reported");
  });
});

describe("paidLabel and tradingDayLabel", () => {
  it("reads the payer's instant in the property's zone", () => {
    // 21:05 UTC on the 17th is 04:05 on the 18th in Ho Chi Minh City.
    expect(paidLabel(payment())).toBe("18 Aug 2026, 04:05");
  });

  it("says a row that moved no money moved none, and belongs to no day", () => {
    const unresolved = payment({
      status: "PENDING",
      paidAt: null,
      businessDate: null,
    });

    expect(paidLabel(unresolved)).toBe("No money has moved");
    expect(tradingDayLabel(unresolved)).toBe("No trading day");
  });

  it("prints the trading day the API derived rather than slicing the instant", () => {
    // The instant is on the 17th in UTC and the day is the 18th: 01:00 belongs
    // to the day that has not rolled yet, and only the derived date says which.
    expect(tradingDayLabel(payment())).toBe("18 August");
  });
});
