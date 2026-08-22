// What a stretch of closed days performed at — `FR-RPT-03`'s arithmetic.
//
// `bucketPerformance` and `totalPerformanceOver` are pure for the reason
// `bucketRevenue` is, so every case below is reachable from literals. What is
// asserted here is the arithmetic a page is read from; whether the statements
// above them select the right rows is a question about a real Postgres and
// belongs to `test/performance-queries-storage.e2e-spec.ts`.
//
// **The first block is the file's reason for existing.** A ratio computed from
// summed counts and a ratio computed as the mean of daily ratios are both
// plausible-looking numbers, they agree whenever the nights are the same size,
// and they are never the same size. So the first case is built out of two nights
// whose two readings are thousands of đồng apart — an implementation that
// averaged would still produce something that charted, and only a case whose
// figures were chosen to separate the two rules would notice.
//
// The rest is the edge of each formula: a denominator of zero on either side, a
// night sold above what was sellable, a range of corrections, a bucket that
// holds two thirds of a month, the types a bucket names, and the đồng at the
// half.

import { describe, expect, it } from "vitest";
import {
  bucketPerformance,
  type PerformanceDay,
  type PerformanceTypeDay,
  totalPerformanceOver,
} from "./performance-queries.service.js";

/** A closed day, in the three counts the snapshot froze. */
function closed(
  businessDate: string,
  sellableRooms: number,
  roomsSold: number,
  netRoomRevenueVnd: bigint,
): PerformanceDay {
  return { businessDate, sellableRooms, roomsSold, netRoomRevenueVnd };
}

/** The same three, for one room type on one closed day. */
function ofType(
  businessDate: string,
  roomType: PerformanceTypeDay["roomType"],
  sellableRooms: number,
  roomsSold: number,
  netRoomRevenueVnd: bigint,
): PerformanceTypeDay {
  return {
    businessDate,
    roomType,
    sellableRooms,
    roomsSold,
    netRoomRevenueVnd,
  };
}

describe("a ratio over a bucket", () => {
  it("divides the summed counts rather than averaging the daily ratios", () => {
    // A quiet night on a nearly closed property and a full Saturday, chosen so
    // that all three ratios separate the two rules — the sellable counts differ
    // as well as the sold ones, because a mean of occupancies happens to be
    // right when every night was the same size, and every night is not.
    //
    //   summed  ADR  34,000,000 / 21 = 1,619,048 đồng
    //   averaged ADR (1,000,000 + 1,650,000) / 2 = 1,325,000 đồng
    //
    // Three hundred thousand đồng of ADR nobody sold a room at, and a figure
    // that would chart perfectly well.
    const [held] = bucketPerformance(
      [
        closed("2026-08-11", 10, 1, 1_000_000n),
        closed("2026-08-15", 40, 20, 33_000_000n),
      ],
      [],
      "MONTH",
    );

    expect(held?.property.adrVnd).toBe(1_619_048n);
    expect(held?.property.adrVnd).not.toBe(1_325_000n);

    // Occupancy: 21/50, not the mean of 0.1 and 0.5.
    expect(held?.property.occupancy).toBeCloseTo(0.42, 10);
    expect(held?.property.occupancy).not.toBeCloseTo(0.3, 10);

    // RevPAR: 34,000,000/50, not the mean of 100,000 and 825,000.
    expect(held?.property.revparVnd).toBe(680_000n);
    expect(held?.property.revparVnd).not.toBe(462_500n);
  });

  it("keeps a range total off the mean of its buckets too", () => {
    // The same two days cut daily, then totalled. A range total is where
    // somebody would reach for a mean of twelve months, so the rule is asserted
    // at the level it is easiest to break — and the answer is the one the single
    // bucket above gave, which is what "the totals cannot disagree with the
    // buckets" means.
    const totals = totalPerformanceOver(
      bucketPerformance(
        [
          closed("2026-08-11", 10, 1, 1_000_000n),
          closed("2026-08-15", 40, 20, 33_000_000n),
        ],
        [],
        "DAY",
      ),
    );

    expect(totals.closedDays).toBe(2);
    expect(totals.property).toMatchObject({
      sellableRooms: 50,
      roomsSold: 21,
      netRoomRevenueVnd: 34_000_000n,
      adrVnd: 1_619_048n,
      revparVnd: 680_000n,
    });
    expect(totals.property.occupancy).toBeCloseTo(0.42, 10);
  });

  it("counts the property row over its own columns and not over the types", () => {
    // The parent's counts agree with the children by construction —
    // `schema/night-audit.ts` says so — and this asserts that the property row is
    // read from the parent rather than assembled from them. The type rows here
    // deliberately do not add up to the property row, which cannot happen in the
    // database and is the only way to tell the two implementations apart.
    const [held] = bucketPerformance(
      [closed("2026-08-11", 40, 20, 40_000_000n)],
      [
        ofType("2026-08-11", "SUPERIOR", 5, 2, 1_000_000n),
        ofType("2026-08-11", "DELUXE", 5, 3, 2_000_000n),
      ],
      "DAY",
    );

    expect(held?.property).toMatchObject({
      sellableRooms: 40,
      roomsSold: 20,
      netRoomRevenueVnd: 40_000_000n,
      adrVnd: 2_000_000n,
    });
    expect(held?.byType.map((type) => type.sellableRooms)).toEqual([5, 5]);
  });
});

describe("a ratio with nothing to divide by", () => {
  it("has no occupancy and no RevPAR when the property had nothing on sale", () => {
    // A closed property, which is not an empty house. A zero occupancy would
    // read as a property that failed to sell forty rooms it was offering.
    const [held] = bucketPerformance(
      [closed("2026-08-11", 0, 0, 0n)],
      [],
      "DAY",
    );

    expect(held?.property.occupancy).toBeNull();
    expect(held?.property.revparVnd).toBeNull();
    expect(held?.property.sellableRooms).toBe(0);
  });

  it("has no ADR on an empty night", () => {
    // Forty rooms on sale and nobody in them. Occupancy and RevPAR are real
    // answers — 0% and nothing per available room — and ADR has none, because a
    // 0 there would read as "the rooms sold for nothing".
    const [held] = bucketPerformance(
      [closed("2026-08-11", 40, 0, 0n)],
      [],
      "DAY",
    );

    expect(held?.property.occupancy).toBe(0);
    expect(held?.property.revparVnd).toBe(0n);
    expect(held?.property.adrVnd).toBeNull();
  });

  it("has all three null over a range that reached no closed day", () => {
    const totals = totalPerformanceOver([]);

    expect(totals).toEqual({
      closedDays: 0,
      property: {
        sellableRooms: 0,
        roomsSold: 0,
        netRoomRevenueVnd: 0n,
        occupancy: null,
        adrVnd: null,
        revparVnd: null,
      },
      // Empty rather than five all-null rows: a type with no frozen row has no
      // measured fact, and a row for it would assert a measurement nobody made.
      byType: [],
    });
  });
});

describe("a night that ran past what was on sale", () => {
  it("reports occupancy above 100% rather than capping it", () => {
    // A closure that withdrew a room after the night was sold.
    // `schema/night-audit.ts` carries no `rooms_sold <= sellable_rooms` check on
    // purpose, and this is the reading that check would have refused.
    const [held] = bucketPerformance(
      [closed("2026-08-11", 38, 40, 76_000_000n)],
      [],
      "DAY",
    );

    expect(held?.property.occupancy).toBeCloseTo(40 / 38, 10);
    expect(held?.property.occupancy).toBeGreaterThan(1);
    expect(held?.property.revparVnd).toBe(2_000_000n);
  });
});

describe("a range carrying corrections to earlier nights", () => {
  it("reports a negative ADR and RevPAR rather than a magnitude", () => {
    // Revenue is signed and the sign is doing work: a report taking magnitudes
    // would turn a month of corrections into a good one.
    const [held] = bucketPerformance(
      [closed("2026-08-11", 40, 4, -8_000_000n)],
      [],
      "DAY",
    );

    expect(held?.property.adrVnd).toBe(-2_000_000n);
    expect(held?.property.revparVnd).toBe(-200_000n);
    expect(held?.property.occupancy).toBeCloseTo(0.1, 10);
  });
});

describe("what a bucket says about the days in it", () => {
  it("spans the first and last closed day rather than the calendar month", () => {
    // The audit has reached the twentieth. A bucket labelled August spanning the
    // whole month while holding two thirds of it is the one way this page could
    // mislead without being wrong — and a ratio over two thirds of a month is a
    // number nothing on the chart would flag.
    const [held] = bucketPerformance(
      [
        closed("2026-08-01", 40, 20, 40_000_000n),
        closed("2026-08-12", 40, 30, 60_000_000n),
        closed("2026-08-20", 40, 10, 20_000_000n),
      ],
      [],
      "MONTH",
    );

    expect(held).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-20",
      closedDays: 3,
    });
    expect(held?.property.roomsSold).toBe(60);
  });

  it("puts each quarter's days in one bucket, chronologically", () => {
    const buckets = bucketPerformance(
      [
        closed("2026-07-01", 40, 10, 10_000_000n),
        closed("2026-04-30", 40, 10, 10_000_000n),
        closed("2026-09-30", 40, 10, 10_000_000n),
      ],
      [],
      "QUARTER",
    );

    expect(buckets.map((held) => [held.from, held.to, held.closedDays])).toEqual(
      [
        ["2026-04-30", "2026-04-30", 1],
        ["2026-07-01", "2026-09-30", 2],
      ],
    );
  });

  it("names only the types something was frozen for, in the property's order", () => {
    // A type with no snapshot row in the bucket is absent rather than all-null,
    // and the ones present come out in `ROOM_TYPE_CODES` order — the ladder from
    // `SUPERIOR` up — however they arrived, so two identical requests answer
    // identically.
    const [held] = bucketPerformance(
      [closed("2026-08-11", 40, 12, 24_000_000n)],
      [
        ofType("2026-08-11", "JUNIOR_SUITE", 4, 2, 8_000_000n),
        ofType("2026-08-11", "SUPERIOR", 12, 6, 6_000_000n),
        ofType("2026-08-11", "DELUXE", 10, 4, 10_000_000n),
      ],
      "DAY",
    );

    expect(held?.byType.map((type) => type.roomType)).toEqual([
      "SUPERIOR",
      "DELUXE",
      "JUNIOR_SUITE",
    ]);
    expect(held?.byType[2]).toMatchObject({
      roomType: "JUNIOR_SUITE",
      adrVnd: 4_000_000n,
      revparVnd: 2_000_000n,
    });
  });

  it("sums a type over the bucket's days and divides once", () => {
    const [held] = bucketPerformance(
      [
        closed("2026-08-11", 40, 1, 1_000_000n),
        closed("2026-08-15", 40, 20, 33_000_000n),
      ],
      [
        ofType("2026-08-11", "DELUXE", 10, 1, 1_000_000n),
        ofType("2026-08-15", "DELUXE", 10, 20, 33_000_000n),
      ],
      "MONTH",
    );

    // The same never-average property one level down: the type's month is
    // 34,000,000 over 21, not the mean of its two nights.
    expect(held?.byType[0]).toMatchObject({
      roomType: "DELUXE",
      sellableRooms: 20,
      roomsSold: 21,
      adrVnd: 1_619_048n,
    });
  });

  it("carries a type into the range totals when it appeared in any bucket", () => {
    const totals = totalPerformanceOver(
      bucketPerformance(
        [
          closed("2026-08-11", 40, 2, 4_000_000n),
          closed("2026-09-11", 40, 2, 4_000_000n),
        ],
        [
          ofType("2026-08-11", "DELUXE", 10, 2, 4_000_000n),
          ofType("2026-09-11", "PANORAMA_SUITE", 2, 2, 4_000_000n),
        ],
        "MONTH",
      ),
    );

    expect(totals.byType.map((type) => type.roomType)).toEqual([
      "DELUXE",
      "PANORAMA_SUITE",
    ]);
    expect(totals.closedDays).toBe(2);
  });
});

describe("the đồng at the half", () => {
  it("rounds away from zero, and rounds a correction the same way its twin was", () => {
    // 3 đồng over 2 rooms is 1.5, which becomes 2 — and −3 over 2 becomes −2
    // rather than −1. Truncating toward zero would round a refund and the charge
    // it reverses differently, which is the tie rule `roundVndForDisplay` states
    // for its own step and the reason it states it.
    const half = (revenue: bigint) =>
      bucketPerformance([closed("2026-08-11", 2, 2, revenue)], [], "DAY")[0]
        ?.property.adrVnd;

    expect(half(3n)).toBe(2n);
    expect(half(-3n)).toBe(-2n);
    expect(half(1n)).toBe(1n);
    expect(half(-1n)).toBe(-1n);

    // And below the half, in both signs, so the rule is a rounding rather than a
    // ceiling on the magnitude.
    const third = (revenue: bigint) =>
      bucketPerformance([closed("2026-08-11", 3, 3, revenue)], [], "DAY")[0]
        ?.property.adrVnd;

    expect(third(4n)).toBe(1n);
    expect(third(-4n)).toBe(-1n);
  });
});
