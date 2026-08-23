// What a stretch of closed days comes to, and how the ledger's penalties land on
// it — `FR-RPT-02`'s arithmetic.
//
// `bucketRevenue`, `totalOver` and `tallyRoomStatus` are pure for the reason
// `rollUp` is, so every case below is reachable from literals: a range that
// reached nothing, a range whose days were never closed, a day of corrections,
// and a quarter with a boundary running through it. Whether the statements above
// them select the right rows is a question about a real Postgres and belongs to
// a storage test; what is asserted here is the arithmetic a page is read from.
//
// The join is the part worth testing hardest, because it is the one place two
// tables meet. `night-audit.service.ts` keeps `POLICY_CHARGE` out of the
// snapshot on the grounds that a forfeited booking is not a sale, so the revenue
// page has to add it back from the ledger — and the rule that makes that safe is
// that a penalty only counts on a day the audit actually closed. A day the audit
// gave up on is a real state, `night-audit-watchdog.job.ts` exists because of
// it, and a report that put that day's penalties on the page with no room
// revenue beside them would be showing money earned on a day the property has
// not agreed on.

import { describe, expect, it } from "vitest";
import {
  bucketKeyOf,
  bucketRevenue,
  type ClosedDay,
  type DayPenalty,
  type RoomStanding,
  tallyRoomStatus,
  totalOver,
} from "./report-queries.service.js";

/** A closed day, in the two figures the snapshot froze. */
function closed(
  businessDate: string,
  roomRevenueVnd: bigint,
  otherRevenueVnd = 0n,
): ClosedDay {
  return { businessDate, roomRevenueVnd, otherRevenueVnd };
}

/** What §4's charges came to on one trading day. */
function penalty(businessDate: string, penaltyVnd: bigint): DayPenalty {
  return { businessDate, penaltyVnd };
}

describe("which bucket a trading day falls in", () => {
  it("is the day itself, the month, or the quarter it sits in", () => {
    expect(bucketKeyOf("2026-08-14", "DAY")).toBe("2026-08-14");
    expect(bucketKeyOf("2026-08-14", "MONTH")).toBe("2026-08");
    expect(bucketKeyOf("2026-08-14", "QUARTER")).toBe("2026-Q3");
  });

  it("puts each of the twelve months in the quarter it belongs to", () => {
    // Spelled out rather than computed, because the thing that would go wrong is
    // an off-by-one at a boundary and a test that repeats the implementation's
    // arithmetic cannot catch one.
    const quarters = [
      ["2026-01-31", "2026-Q1"],
      ["2026-02-01", "2026-Q1"],
      ["2026-03-31", "2026-Q1"],
      ["2026-04-01", "2026-Q2"],
      ["2026-06-30", "2026-Q2"],
      ["2026-07-01", "2026-Q3"],
      ["2026-09-30", "2026-Q3"],
      ["2026-10-01", "2026-Q4"],
      ["2026-12-31", "2026-Q4"],
    ] as const;

    for (const [day, quarter] of quarters) {
      expect(bucketKeyOf(day, "QUARTER")).toBe(quarter);
    }
  });
});

describe("a stretch of closed days, bucketed", () => {
  it("gives each day its own bucket when the cut is by day", () => {
    const buckets = bucketRevenue(
      [
        closed("2026-08-13", 12_000_000n, 800_000n),
        closed("2026-08-14", 15_000_000n, 250_000n),
      ],
      [],
      "DAY",
    );

    expect(buckets).toEqual([
      {
        from: "2026-08-13",
        to: "2026-08-13",
        closedDays: 1,
        roomRevenueVnd: 12_000_000n,
        otherRevenueVnd: 800_000n,
        penaltyRevenueVnd: 0n,
        totalVnd: 12_800_000n,
      },
      {
        from: "2026-08-14",
        to: "2026-08-14",
        closedDays: 1,
        roomRevenueVnd: 15_000_000n,
        otherRevenueVnd: 250_000n,
        penaltyRevenueVnd: 0n,
        totalVnd: 15_250_000n,
      },
    ]);
  });

  it("answers with nothing at all for a range that reached no closed day", () => {
    // The empty range, which is what a property gets before its first night
    // audit and what a reader gets for asking about next week. Not one bucket of
    // zeroes: a bucket says a day was closed, and none was.
    expect(bucketRevenue([], [], "DAY")).toEqual([]);
    expect(bucketRevenue([], [], "MONTH")).toEqual([]);
    expect(totalOver([])).toEqual({
      closedDays: 0,
      roomRevenueVnd: 0n,
      otherRevenueVnd: 0n,
      penaltyRevenueVnd: 0n,
      totalVnd: 0n,
    });
  });

  it("carries a day of corrections through as the negative day it was", () => {
    // A day that reversed more than it charged — `schema/night-audit.ts` stores
    // the figure signed for exactly this, and a report taking magnitudes would
    // turn a fortnight of corrections into a good one.
    const buckets = bucketRevenue(
      [
        closed("2026-08-13", 12_000_000n),
        closed("2026-08-14", -3_000_000n, -200_000n),
      ],
      [penalty("2026-08-14", -500_000n)],
      "MONTH",
    );

    expect(buckets).toEqual([
      {
        from: "2026-08-13",
        to: "2026-08-14",
        closedDays: 2,
        roomRevenueVnd: 9_000_000n,
        otherRevenueVnd: -200_000n,
        penaltyRevenueVnd: -500_000n,
        totalVnd: 8_300_000n,
      },
    ]);
  });

  it("names the first and last closed day in a bucket, not the calendar's", () => {
    // A month the audit has only reached the third of. The bucket says so —
    // which is the boundary stated at the resolution somebody comparing two
    // months needs, rather than an August spanning thirty-one days while holding
    // three.
    const [august] = bucketRevenue(
      [
        closed("2026-08-01", 1_000_000n),
        closed("2026-08-02", 1_000_000n),
        closed("2026-08-03", 1_000_000n),
      ],
      [],
      "MONTH",
    );

    expect(august?.from).toBe("2026-08-01");
    expect(august?.to).toBe("2026-08-03");
    expect(august?.closedDays).toBe(3);
  });

  it("keeps the two sides of a quarter boundary in different buckets", () => {
    const buckets = bucketRevenue(
      [
        closed("2026-06-30", 4_000_000n),
        closed("2026-07-01", 6_000_000n),
      ],
      [penalty("2026-06-30", 1_000_000n), penalty("2026-07-01", 2_000_000n)],
      "QUARTER",
    );

    expect(buckets.map((held) => held.from)).toEqual([
      "2026-06-30",
      "2026-07-01",
    ]);
    expect(buckets.map((held) => held.totalVnd)).toEqual([
      5_000_000n,
      8_000_000n,
    ]);
  });

  it("puts a bucket in chronological order however the days arrived", () => {
    const buckets = bucketRevenue(
      [
        closed("2026-09-02", 1n),
        closed("2026-07-15", 2n),
        closed("2026-08-20", 3n),
      ],
      [],
      "MONTH",
    );

    expect(buckets.map((held) => held.from)).toEqual([
      "2026-07-15",
      "2026-08-20",
      "2026-09-02",
    ]);
  });
});

describe("the ledger's penalties, joined onto the closed days", () => {
  it("adds §4's charges to the bucket the trading day falls in", () => {
    const buckets = bucketRevenue(
      [closed("2026-08-13", 12_000_000n), closed("2026-08-14", 15_000_000n)],
      [penalty("2026-08-13", 900_000n), penalty("2026-08-14", 1_500_000n)],
      "MONTH",
    );

    expect(buckets).toEqual([
      {
        from: "2026-08-13",
        to: "2026-08-14",
        closedDays: 2,
        roomRevenueVnd: 27_000_000n,
        otherRevenueVnd: 0n,
        penaltyRevenueVnd: 2_400_000n,
        totalVnd: 29_400_000n,
      },
    ]);
  });

  it("drops a penalty posted on a day the audit never closed", () => {
    // The hole day. The audit refused the fourteenth and closed the days either
    // side of it, so the fourteenth is not on this page — and its penalties are
    // not either, because a bucket carrying money from a day with no room
    // revenue beside it is the page showing a day nobody has agreed on.
    const buckets = bucketRevenue(
      [closed("2026-08-13", 12_000_000n), closed("2026-08-15", 15_000_000n)],
      [
        penalty("2026-08-13", 900_000n),
        penalty("2026-08-14", 5_000_000n),
        penalty("2026-08-15", 100_000n),
      ],
      "MONTH",
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.closedDays).toBe(2);
    expect(buckets[0]?.penaltyRevenueVnd).toBe(1_000_000n);
  });

  it("answers with nothing when every penalty fell on an unclosed day", () => {
    // A property whose night audit has not run, with a fortnight of
    // cancellations behind it. No bucket exists to hang them on, and inventing
    // one would be the report claiming trading days the audit never closed.
    expect(
      bucketRevenue([], [penalty("2026-08-14", 5_000_000n)], "DAY"),
    ).toEqual([]);
  });
});

describe("what a range came to", () => {
  it("adds the buckets rather than the days a second time", () => {
    const buckets = bucketRevenue(
      [
        closed("2026-07-31", 4_000_000n, 100_000n),
        closed("2026-08-01", 6_000_000n, 200_000n),
      ],
      [penalty("2026-07-31", 500_000n)],
      "MONTH",
    );

    expect(totalOver(buckets)).toEqual({
      closedDays: 2,
      roomRevenueVnd: 10_000_000n,
      otherRevenueVnd: 300_000n,
      penaltyRevenueVnd: 500_000n,
      totalVnd: 10_800_000n,
    });
  });
});

describe("how the property's rooms are standing", () => {
  const STANDINGS: readonly RoomStanding[] = [
    { roomType: "DELUXE", status: "CLEAN", rooms: 6 },
    { roomType: "DELUXE", status: "DIRTY", rooms: 2 },
    { roomType: "SUPERIOR", status: "CLEAN", rooms: 10 },
    { roomType: "SUPERIOR", status: "OUT_OF_ORDER", rooms: 1 },
  ];

  it("counts every status on every type, zero included", () => {
    const tally = tallyRoomStatus(STANDINGS);

    expect(tally.rooms).toBe(19);
    expect(tally.byStatus).toEqual([
      { status: "CLEAN", rooms: 16 },
      { status: "DIRTY", rooms: 2 },
      { status: "INSPECTED", rooms: 0 },
      { status: "OUT_OF_ORDER", rooms: 1 },
    ]);
  });

  it("lists the types in the property's own ladder rather than the alphabet", () => {
    // `SUPERIOR` before `DELUXE`, which is `ROOM_TYPE_CODES` and the order a
    // manager reads the room mix in.
    const tally = tallyRoomStatus(STANDINGS);

    expect(tally.byType.map((type) => type.roomType)).toEqual([
      "SUPERIOR",
      "DELUXE",
    ]);
    expect(tally.byType.map((type) => type.rooms)).toEqual([11, 8]);
  });

  it("leaves out a type the property has no rooms of", () => {
    // A row of noughts for a type nobody built reads as a type the property
    // operates and has closed, which is a different and alarming fact.
    const tally = tallyRoomStatus([
      { roomType: "PANORAMA_SUITE", status: "INSPECTED", rooms: 2 },
    ]);

    expect(tally.byType.map((type) => type.roomType)).toEqual([
      "PANORAMA_SUITE",
    ]);
    expect(tally.byType[0]?.byStatus).toEqual([
      { status: "CLEAN", rooms: 0 },
      { status: "DIRTY", rooms: 0 },
      { status: "INSPECTED", rooms: 2 },
      { status: "OUT_OF_ORDER", rooms: 0 },
    ]);
  });

  it("counts nothing for a property with no rooms", () => {
    expect(tallyRoomStatus([])).toEqual({
      rooms: 0,
      byStatus: [
        { status: "CLEAN", rooms: 0 },
        { status: "DIRTY", rooms: 0 },
        { status: "INSPECTED", rooms: 0 },
        { status: "OUT_OF_ORDER", rooms: 0 },
      ],
      byType: [],
    });
  });
});
