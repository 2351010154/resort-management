import { describe, expect, it } from "vitest";

import { mayTakeAnExport } from "@/lib/excel-export";

import {
  ABSENT_FIGURE,
  boundaryNote,
  bucketLabel,
  DEFAULT_PERFORMANCE_FIGURE,
  DEFAULT_RANGE_FIELDS,
  formatFigure,
  formatOccupancy,
  formatRatioVnd,
  mayReadPerformance,
  mayReadRevenue,
  mayReadRoomStatus,
  type PerformanceBucketRow,
  type PerformanceFigures,
  performanceSeries,
  type RangeFields,
  type RevenueBucketRow,
  rangeQuestion,
  reportsFor,
  revenueSeries,
  roomStatusSeries,
} from "./reports";

/* The Reports family's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the three pages: who is offered
 * which door, who is offered it as a spreadsheet, what a typed range parses to
 * before it is sent, what a bucket is called, and what each chart is handed —
 * including the four places a report can mislead if the view model gets it
 * wrong: a negative bucket, a quarter's name, a ratio with nothing to divide by,
 * and a night sold above what was sellable.
 */

/** The property's day, so a typed range has something to be read against. */
const TODAY = "2026-08-16";

function bucket(over: Partial<RevenueBucketRow> = {}): RevenueBucketRow {
  return {
    from: "2026-08-01",
    to: "2026-08-31",
    closedDays: 31,
    roomRevenueVnd: 300_000_000n,
    otherRevenueVnd: 20_000_000n,
    penaltyRevenueVnd: 5_000_000n,
    totalVnd: 325_000_000n,
    ...over,
  };
}

/** Six figures that hang together — 87 of 100 sellable rooms sold at
 *  1,150,000 ₫, which is a RevPAR of 1,000,500 ₫. Overridden per case, since
 *  what each case is about is one of them being impossible to divide. */
function figures(over: Partial<PerformanceFigures> = {}): PerformanceFigures {
  return {
    sellableRooms: 100,
    roomsSold: 87,
    netRoomRevenueVnd: 100_050_000n,
    occupancy: 0.87,
    adrVnd: 1_150_000n,
    revparVnd: 1_000_500n,
    ...over,
  };
}

function performanceBucket(
  over: Partial<PerformanceBucketRow> = {},
): PerformanceBucketRow {
  return {
    from: "2026-08-01",
    to: "2026-08-31",
    closedDays: 31,
    property: figures(),
    byType: [{ roomType: "DELUXE", ...figures() }],
    ...over,
  };
}

describe("who is offered which report", () => {
  it("gives the receptionist room status and refuses them revenue", () => {
    // The matrix read literally, and the separation the two rows exist for: the
    // person holding the drawer does not read the property's takings.
    expect(mayReadRevenue("RECEPTIONIST")).toBe(false);
    expect(mayReadRoomStatus("RECEPTIONIST")).toBe(true);
    expect(reportsFor("RECEPTIONIST").map((page) => page.id)).toEqual([
      "room-status",
    ]);
  });

  it("gives the accountant the two money reports and refuses them room status", () => {
    // The mirror. Where the rooms stand is the state of the floors rather than
    // the state of the books, and the accountant is not on that row — they hold
    // the other two, which are two rows rather than one.
    expect(reportsFor("ACCOUNTANT").map((page) => page.id)).toEqual([
      "revenue",
      "performance",
    ]);
  });

  it("gives management all three", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      expect(reportsFor(role).map((page) => page.id)).toEqual([
        "revenue",
        "room-status",
        "performance",
      ]);
    }
  });

  it("offers a housekeeper room status and nothing else", () => {
    // Their `⚠` on the operational row is "own board", which narrows a list of
    // guests and has nothing to narrow on a count of rooms — they read every
    // one of those conditions on the board already. So the page opens for them,
    // as the API's guard opens it, and neither money report does.
    expect(mayReadRoomStatus("HOUSEKEEPING")).toBe(true);
    expect(reportsFor("HOUSEKEEPING").map((page) => page.id)).toEqual([
      "room-status",
    ]);
    // Reading the page is not taking it away: they are not on the export row,
    // and the route refuses them for that reason whatever this screen offers.
    expect(mayTakeAnExport("HOUSEKEEPING")).toBe(false);
  });

  it("offers occupancy, ADR and RevPAR to the three roles that hold the row", () => {
    // `reporting.performance` is its own row: the accountant, the manager and
    // the administrator, and nobody else. A menu entry is a door, and this is
    // the whole set of people the door opens for.
    for (const role of ["ACCOUNTANT", "MANAGER", "ADMIN"] as const) {
      expect(mayReadPerformance(role)).toBe(true);
      expect(reportsFor(role).map((page) => page.id)).toContain("performance");
    }

    for (const role of ["RECEPTIONIST", "HOUSEKEEPING"] as const) {
      expect(mayReadPerformance(role)).toBe(false);
      expect(reportsFor(role).map((page) => page.id)).not.toContain(
        "performance",
      );
    }
  });

  it("names the page after all three figures it answers", () => {
    // `screens.md` lists occupancy, ADR and RevPAR as three of the family's
    // five figures, and one page carries them — so the menu says so rather than
    // hiding two of the three behind a label naming the first.
    const named = reportsFor("ADMIN")
      .map((page) => page.label.toLowerCase())
      .join(" ");

    expect(named).toContain("occupancy");
    expect(named).toContain("adr");
    expect(named).toContain("revpar");
  });
});

describe("who is offered a report as a spreadsheet", () => {
  it("offers the performance export only where both matrix rows are granted", () => {
    // The conjunction each screen composes, and neither half alone: the *Excel
    // export* row's ⚠ on the receptionist means "operational lists only", and
    // this report's own row is what turns that into a refusal here without any
    // screen holding a list of who may export what.
    for (const role of ["ACCOUNTANT", "MANAGER", "ADMIN"] as const) {
      expect(mayReadPerformance(role) && mayTakeAnExport(role)).toBe(true);
    }

    // Holds the export row, is refused this report — so no control is offered.
    expect(mayTakeAnExport("RECEPTIONIST")).toBe(true);
    expect(
      mayReadPerformance("RECEPTIONIST") && mayTakeAnExport("RECEPTIONIST"),
    ).toBe(false);

    // Holds neither.
    expect(
      mayReadPerformance("HOUSEKEEPING") && mayTakeAnExport("HOUSEKEEPING"),
    ).toBe(false);
  });
});

describe("what a bucket is called", () => {
  it("names a day, a month and a quarter from the day it starts on", () => {
    expect(bucketLabel("2026-08-14", "DAY")).toBe("14 August");
    expect(bucketLabel("2026-08-14", "MONTH")).toBe("August 2026");
    expect(bucketLabel("2026-08-14", "QUARTER")).toBe("Q3 2026");
  });

  it("puts each quarter boundary on the right side of it", () => {
    expect(bucketLabel("2026-03-31", "QUARTER")).toBe("Q1 2026");
    expect(bucketLabel("2026-04-01", "QUARTER")).toBe("Q2 2026");
    expect(bucketLabel("2026-06-30", "QUARTER")).toBe("Q2 2026");
    expect(bucketLabel("2026-07-01", "QUARTER")).toBe("Q3 2026");
    expect(bucketLabel("2026-12-31", "QUARTER")).toBe("Q4 2026");
  });

  it("names a month by its first closed day, not by the calendar's first", () => {
    // A month the audit only reached on the fifth still reads "August 2026" —
    // how much of it is in the bucket is the row's own `closedDays`, which is
    // beside the label rather than smuggled into it.
    expect(bucketLabel("2026-08-05", "MONTH")).toBe("August 2026");
  });
});

describe("the page stamp", () => {
  it("says what is not on the page rather than where anything came from", () => {
    const said = boundaryNote("2026-08-15");

    expect(said).toContain("2026-08-15");
    expect(said).toContain("Nothing on this page reaches past");
  });

  it("explains a property whose audit has never run instead of going blank", () => {
    expect(boundaryNote(null)).toContain("closed no trading day yet");
  });
});

describe("a typed range as a question", () => {
  it("opens on everything the audit has closed, by month", () => {
    // Both ends empty is the honest opening question, and the coarsest useful
    // cut: a page that opened on days would draw a bar per day of the whole
    // history.
    const attempt = rangeQuestion(DEFAULT_RANGE_FIELDS, null);

    expect(attempt).toEqual({
      query: { bucket: "MONTH", from: undefined, to: undefined },
    });
  });

  it("reads both ends against the property's day rather than the calendar", () => {
    const attempt = rangeQuestion(
      { from: "1/8", to: "today", bucket: "DAY" },
      TODAY,
    );

    expect(attempt).toEqual({
      query: { bucket: "DAY", from: "2026-08-01", to: TODAY },
    });
  });

  it("refuses a range whose last day falls before its first", () => {
    const attempt = rangeQuestion(
      { from: "2026-08-20", to: "2026-08-10", bucket: "DAY" },
      TODAY,
    );

    expect(attempt).toHaveProperty("problem");
  });

  it("takes an upper bound ahead of the property's day without complaint", () => {
    // "This month" asked on the fourteenth is the ordinary question. The API
    // answers as far as the audit has reached and stamps the page with where
    // that was; refusing it here would be a rule the API does not have.
    const attempt = rangeQuestion(
      { from: "2026-08-01", to: "2026-08-31", bucket: "DAY" },
      TODAY,
    );

    expect(attempt).toEqual({
      query: { bucket: "DAY", from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("says the property's day has not arrived rather than guessing at one", () => {
    const typed: RangeFields = { from: "today", to: "", bucket: "MONTH" };

    expect(rangeQuestion(typed, null)).toHaveProperty("problem");
  });

  it("refuses a day that could not be read", () => {
    const typed: RangeFields = { from: "the ides", to: "", bucket: "MONTH" };

    expect(rangeQuestion(typed, TODAY)).toHaveProperty("problem");
  });
});

describe("the revenue chart's data", () => {
  it("labels each bar and splits the bucket into its three parts", () => {
    const bars = revenueSeries({
      bucket: "MONTH",
      buckets: [bucket()],
    });

    expect(bars).toEqual([
      {
        bucket: "August 2026",
        room: 300_000_000,
        other: 20_000_000,
        penalties: 5_000_000,
      },
    ]);
  });

  it("floors a negative part at nothing, because a stack cannot draw one", () => {
    // A fortnight that reversed more than it charged is real and the contract
    // keeps the sign for it — but a negative segment would render below the
    // baseline under the two positive ones and read as a *larger* month. The
    // table beside the chart is what carries what the bucket actually came to.
    const bars = revenueSeries({
      bucket: "MONTH",
      buckets: [
        bucket({
          roomRevenueVnd: -4_000_000n,
          otherRevenueVnd: 1_000_000n,
          penaltyRevenueVnd: -500_000n,
          totalVnd: -3_500_000n,
        }),
      ],
    });

    expect(bars[0]).toEqual({
      bucket: "August 2026",
      room: 0,
      other: 1_000_000,
      penalties: 0,
    });
  });

  it("draws nothing for a range that reached no closed day", () => {
    expect(revenueSeries({ bucket: "DAY", buckets: [] })).toEqual([]);
  });
});

describe("the room-status chart's data", () => {
  it("gives every bar the same segments, zeroes included", () => {
    // A chart whose colours mean different things from one column to the next
    // is a chart nobody can read across, which is why the API zero-fills and
    // why this asserts the shape rather than only the totals.
    const bars = roomStatusSeries({
      byType: [
        {
          roomType: "SUPERIOR",
          rooms: 11,
          byStatus: [
            { status: "CLEAN", rooms: 10 },
            { status: "DIRTY", rooms: 0 },
            { status: "INSPECTED", rooms: 0 },
            { status: "OUT_OF_ORDER", rooms: 1 },
          ],
        },
        {
          roomType: "DELUXE",
          rooms: 8,
          byStatus: [
            { status: "CLEAN", rooms: 6 },
            { status: "DIRTY", rooms: 2 },
            { status: "INSPECTED", rooms: 0 },
            { status: "OUT_OF_ORDER", rooms: 0 },
          ],
        },
      ],
    });

    expect(bars).toEqual([
      {
        roomType: "SUPERIOR",
        CLEAN: 10,
        DIRTY: 0,
        INSPECTED: 0,
        OUT_OF_ORDER: 1,
      },
      {
        roomType: "DELUXE",
        CLEAN: 6,
        DIRTY: 2,
        INSPECTED: 0,
        OUT_OF_ORDER: 0,
      },
    ]);
  });

  it("draws nothing for a property with no rooms on record", () => {
    expect(roomStatusSeries({ byType: [] })).toEqual([]);
  });
});

describe("how the property performed", () => {
  it("opens on occupancy", () => {
    // The one of the three that is a whole answer on its own and the only one
    // whose scale a reader already knows.
    expect(DEFAULT_PERFORMANCE_FIGURE).toBe("OCCUPANCY");
  });

  it("draws the figure that was selected and no other", () => {
    const report: Parameters<typeof performanceSeries>[0] = {
      bucket: "MONTH",
      buckets: [performanceBucket()],
    };

    // Occupancy crosses as percentage points; the two rates cross as đồng.
    expect(performanceSeries(report, "OCCUPANCY")).toEqual([
      { bucket: "August 2026", value: 87 },
    ]);
    expect(performanceSeries(report, "ADR")).toEqual([
      { bucket: "August 2026", value: 1_150_000 },
    ]);
    expect(performanceSeries(report, "REVPAR")).toEqual([
      { bucket: "August 2026", value: 1_000_500 },
    ]);
  });

  it("carries a ratio with no denominator as null rather than as a zero bar", () => {
    // A property that had nothing on sale is not a property whose rooms sold
    // for nothing. `null` is not a number, which is what the vendored bar reads
    // as nothing to draw and what keeps the day out of the scale's maximum — a
    // `0` here would be a bar on the floor saying something that did not happen.
    const closed = performanceSeries(
      {
        bucket: "DAY",
        buckets: [
          performanceBucket({
            property: figures({
              sellableRooms: 0,
              roomsSold: 0,
              netRoomRevenueVnd: 0n,
              occupancy: null,
              adrVnd: null,
              revparVnd: null,
            }),
          }),
        ],
      },
      "OCCUPANCY",
    );

    expect(closed).toEqual([{ bucket: "1 August", value: null }]);
    expect(closed[0]?.value).not.toBe(0);
  });

  it("does not cap a night sold above what was sellable", () => {
    // A closure withdrawing a room after the night was sold leaves a day
    // genuinely over 100%. The schema refuses to bound it and neither does
    // this: the chart's domain is computed from the data it is given, so the
    // bar draws above the others rather than being clipped level with them.
    const bars = performanceSeries(
      {
        bucket: "DAY",
        buckets: [
          performanceBucket({
            property: figures({
              sellableRooms: 10,
              roomsSold: 12,
              occupancy: 1.2,
            }),
          }),
        ],
      },
      "OCCUPANCY",
    );

    expect(bars).toEqual([{ bucket: "1 August", value: 120 }]);
    expect(formatOccupancy(1.2)).toBe("120%");
  });

  it("draws nothing for a range that reached no closed day", () => {
    expect(performanceSeries({ bucket: "DAY", buckets: [] }, "ADR")).toEqual(
      [],
    );
  });
});

describe("a performance figure as somebody reads it", () => {
  it("writes occupancy as a percentage, to one decimal at most", () => {
    expect(formatOccupancy(0.87)).toBe("87%");
    // Nine of eleven rooms. The decimal is kept because a small property's
    // occupancy moves by whole rooms and rounding it to 82% loses the room.
    expect(formatOccupancy(9 / 11)).toBe("81.8%");
  });

  it("prints a dash for a ratio that has no answer, never a zero", () => {
    expect(formatOccupancy(null)).toBe(ABSENT_FIGURE);
    expect(formatRatioVnd(null)).toBe(ABSENT_FIGURE);
    expect(formatOccupancy(null)).not.toContain("0");
    expect(formatRatioVnd(null)).not.toContain("0");
  });

  it("keeps a genuine zero apart from an absent one", () => {
    // A night that sold rooms and took nothing for them is a real reading and
    // is not the same fact as a night with no rooms on sale. The dash is
    // reserved for the second.
    expect(formatOccupancy(0)).toBe("0%");
    expect(formatRatioVnd(0n)).not.toBe(ABSENT_FIGURE);
  });

  it("spells each figure of a row the one way, whichever is asked for", () => {
    const row = figures();

    expect(formatFigure(row, "OCCUPANCY")).toBe(formatOccupancy(row.occupancy));
    expect(formatFigure(row, "ADR")).toBe(formatRatioVnd(row.adrVnd));
    expect(formatFigure(row, "REVPAR")).toBe(formatRatioVnd(row.revparVnd));
  });
});
