import { formatVnd, ROOM_TYPE_CODES, STAFF_ROLES } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  breakfastLabel,
  type CalendarNight,
  cellKey,
  extendSelection,
  inclusiveNights,
  isSelected,
  mayEditRates,
  mayEditRestrictions,
  mayReadRates,
  mayReadRestrictions,
  monthSpans,
  NO_RESTRICTION_FIELDS,
  nightColumns,
  nightNeighbour,
  nightWindow,
  type PlanFields,
  parseCellKey,
  parseDong,
  percentLabel,
  planFields,
  planPatch,
  priceEdit,
  type RatePlan,
  rateCell,
  rateGrid,
  readsRoomType,
  restrictionEdit,
  restrictionMarks,
  restrictionSentence,
  type StayRestriction,
  selectionSpan,
  shiftWindow,
  spanLabel,
  type TypeAnswer,
  UNPUBLISHED_MARK,
  unreadTypes,
  verticalNeighbour,
  WINDOW_NIGHTS,
} from "./rate-grid";

/* The rate grid's decisions, held to the four rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives. What
 * is covered instead is everything underneath the markup: which nights are on
 * screen, whether a night reads as unpriced or as unrestricted, what a drag
 * across the grid means once it is let go, how few requests a season costs, and
 * the one distinction `updateRatePlanInput` exists to keep — leaving breakfast
 * alone against removing it.
 */

const MONDAY = "2026-08-17";

function night(date: string, grossPerNight: bigint | null): CalendarNight {
  return { date, grossPerNight };
}

function rule(over: Partial<StayRestriction> = {}): StayRestriction {
  return {
    date: MONDAY,
    minimumStay: 1,
    maximumStay: null,
    closedToArrival: false,
    closedToDeparture: false,
    ...over,
  };
}

function plan(over: Partial<RatePlan> = {}): RatePlan {
  return {
    code: "BB",
    name: "Bed and breakfast",
    percentAdjustment: 0,
    breakfastPerPersonGross: 120_000n,
    displayOrder: 2,
    ...over,
  };
}

/** A window whose every night of every type is priced the same. */
function answered(
  roomType: TypeAnswer["roomType"],
  dates: readonly string[],
  gross: bigint | null,
  restrictions: readonly StayRestriction[] = [],
): TypeAnswer {
  return {
    roomType,
    calendar: {
      failed: false,
      nights: dates.map((date) => night(date, gross)),
    },
    restrictions: { failed: false, restrictions },
  };
}

// ── Who is offered what ────────────────────────────────────────────────────

describe("capability predicates", () => {
  it("offers the calendar to every role the rate-plans row names", () => {
    // `pricing.rate-plans`: RECEPTIONIST 👁, ACCOUNTANT 👁, MANAGER ✅, ADMIN ✅.
    expect(STAFF_ROLES.filter(mayReadRates)).toEqual([
      "RECEPTIONIST",
      "ACCOUNTANT",
      "MANAGER",
      "ADMIN",
    ]);
  });

  it("keeps the housekeeper out of the tariff altogether", () => {
    expect(mayReadRates("HOUSEKEEPING")).toBe(false);
    expect(mayReadRestrictions("HOUSEKEEPING")).toBe(false);
  });

  it("offers a price edit to management only", () => {
    expect(STAFF_ROLES.filter(mayEditRates)).toEqual(["MANAGER", "ADMIN"]);
  });

  it("withholds the restrictions row from the accountant", () => {
    // A minimum stay is a rule about what the property will sell, not a figure
    // that appears on an invoice — the narrower of the two matrix rows.
    expect(mayReadRestrictions("ACCOUNTANT")).toBe(false);
    expect(mayReadRates("ACCOUNTANT")).toBe(true);
    expect(STAFF_ROLES.filter(mayReadRestrictions)).toEqual([
      "RECEPTIONIST",
      "MANAGER",
      "ADMIN",
    ]);
  });

  it("offers a restriction edit to management only", () => {
    expect(STAFF_ROLES.filter(mayEditRestrictions)).toEqual([
      "MANAGER",
      "ADMIN",
    ]);
  });

  it("offers no edit to anybody who may not read", () => {
    for (const role of STAFF_ROLES) {
      expect(!mayEditRates(role) || mayReadRates(role)).toBe(true);
      expect(!mayEditRestrictions(role) || mayReadRestrictions(role)).toBe(
        true,
      );
    }
  });
});

// ── The nights on screen ───────────────────────────────────────────────────

describe("nightWindow", () => {
  it("holds four weeks, both ends included", () => {
    const window = nightWindow(MONDAY);

    expect(window.dates).toHaveLength(WINDOW_NIGHTS);
    expect(window.from).toBe(MONDAY);
    // The contract's range is inclusive of both ends, so the last night on
    // screen is the 28th and not the 29th.
    expect(window.to).toBe("2026-09-13");
    expect(window.dates[WINDOW_NIGHTS - 1]).toBe(window.to);
  });

  it("walks over a month boundary without a case for it", () => {
    const window = nightWindow("2026-08-30", 3);

    expect(window.dates).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("is one night wide at its narrowest", () => {
    const window = nightWindow(MONDAY, 1);

    expect(window.from).toBe(MONDAY);
    expect(window.to).toBe(MONDAY);
    expect(window.dates).toEqual([MONDAY]);
  });

  it("refuses to be narrower than a night", () => {
    // A window of nothing has no `to`, and every caller reads one.
    expect(nightWindow(MONDAY, 0).dates).toEqual([MONDAY]);
  });
});

describe("shiftWindow", () => {
  it("moves a screenful at a time and keeps its width", () => {
    const window = nightWindow(MONDAY, 7);
    const next = shiftWindow(window, 1);

    expect(next.from).toBe("2026-08-24");
    expect(next.dates).toHaveLength(7);
    expect(shiftWindow(next, -1).from).toBe(MONDAY);
  });
});

describe("nightColumns", () => {
  it("names the month on the first column and where one begins", () => {
    const columns = nightColumns(["2026-08-30", "2026-08-31", "2026-09-01"]);

    expect(columns.map((column) => column.monthLabel)).toEqual([
      "Aug",
      null,
      "Sept",
    ]);
  });

  it("marks Saturday and Sunday and nothing else", () => {
    const columns = nightColumns([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);

    expect(columns.map((column) => column.isWeekend)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("prints the day of the month unpadded, beside its weekday", () => {
    const [column] = nightColumns(["2026-08-01"]);

    expect(column.dayLabel).toBe("1");
    expect(column.weekdayLabel).toBe("Sat");
  });
});

describe("inclusiveNights", () => {
  it("counts a single night as one", () => {
    expect(inclusiveNights(MONDAY, MONDAY)).toBe(1);
  });

  it("counts both ends of a week", () => {
    expect(inclusiveNights(MONDAY, "2026-08-23")).toBe(7);
  });

  it("crosses a month and a leap day", () => {
    expect(inclusiveNights("2026-08-30", "2026-09-01")).toBe(3);
    expect(inclusiveNights("2028-02-28", "2028-03-01")).toBe(3);
  });
});

// ── One cell ───────────────────────────────────────────────────────────────

describe("restrictionSentence", () => {
  it("says nothing about a night with no rule", () => {
    expect(restrictionSentence(null)).toBeNull();
  });

  it("does not dress a minimum of one up as a rule", () => {
    // Every returned row carries a minimum, and 1 is the unrestricted value —
    // such a row exists only because another field is set.
    expect(restrictionSentence(rule({ closedToArrival: true }))).toBe(
      "Closed to arrival",
    );
    expect(restrictionSentence(rule())).toBeNull();
  });

  it("reads the four rules in the order the form asks them", () => {
    expect(
      restrictionSentence(
        rule({
          minimumStay: 3,
          maximumStay: 7,
          closedToArrival: true,
          closedToDeparture: true,
        }),
      ),
    ).toBe(
      "Minimum stay 3 nights. Maximum stay 7 nights. Closed to arrival. Closed to departure",
    );
  });
});

describe("restrictionMarks", () => {
  it("abbreviates the rules to what fits a cell", () => {
    expect(
      restrictionMarks(
        rule({
          minimumStay: 3,
          maximumStay: 5,
          closedToArrival: true,
          closedToDeparture: true,
        }),
      ),
    ).toEqual(["3+", "≤5", "CTA", "CTD"]);
  });

  it("marks nothing on a night with no rule", () => {
    expect(restrictionMarks(null)).toEqual([]);
    expect(restrictionMarks(rule())).toEqual([]);
  });
});

describe("rateCell", () => {
  it("reads a published night as a price in thousands", () => {
    const cell = rateCell("DELUXE", MONDAY, night(MONDAY, 1_850_000n), null);

    expect(cell.isPublished).toBe(true);
    expect(cell.grossPerNight).toBe(1_850_000n);
    expect(cell.priceLabel).toBe("1.850");
    expect(cell.cellLabel).toContain(formatVnd(1_850_000n));
  });

  it("reads a night the property has not published as unpriced", () => {
    const cell = rateCell("DELUXE", MONDAY, night(MONDAY, null), null);

    expect(cell.isPublished).toBe(false);
    expect(cell.grossPerNight).toBeNull();
    expect(cell.priceLabel).toBe(UNPUBLISHED_MARK);
    expect(cell.cellLabel).toContain("not published");
  });

  it("never says an unpublished night is unavailable", () => {
    // The whole reason this contract is separate from `availability`: the guest
    // calendar renders a night with no row as taken, and a manager needs to read
    // the same night as unpriced.
    const label = rateCell(
      "DELUXE",
      MONDAY,
      night(MONDAY, null),
      null,
    ).cellLabel.toLowerCase();

    expect(label).not.toContain("sold out");
    expect(label).not.toContain("unavailable");
    expect(label).not.toContain("closed");
  });

  it("treats a missing night the same as one answered null", () => {
    const missing = rateCell("DELUXE", MONDAY, undefined, null);

    expect(missing.isPublished).toBe(false);
    expect(missing.priceLabel).toBe(UNPUBLISHED_MARK);
  });

  it("keeps an unpriced night's rule, because the two are different facts", () => {
    const cell = rateCell(
      "DELUXE",
      MONDAY,
      night(MONDAY, null),
      rule({ minimumStay: 2 }),
    );

    expect(cell.isPublished).toBe(false);
    expect(cell.restrictionMarks).toEqual(["2+"]);
    expect(cell.cellLabel).toContain("Minimum stay 2 nights");
  });
});

// ── The grid ───────────────────────────────────────────────────────────────

describe("rateGrid", () => {
  const window = nightWindow(MONDAY, 3);

  it("runs days across and types down, in the product's own type order", () => {
    const grid = rateGrid(
      window,
      [...ROOM_TYPE_CODES]
        .reverse()
        .map((roomType) => answered(roomType, window.dates, 1_000_000n)),
    );

    // The rows come in the order they were answered, which the hook builds from
    // `ROOM_TYPE_CODES` — reversing the input proves the grid does not sort, so
    // the one ordering of room types in the product is the only one on screen.
    expect(grid.rows).toHaveLength(ROOM_TYPE_CODES.length);
    expect(grid.columns.map((column) => column.date)).toEqual(window.dates);
    expect(grid.rows[0].cells.map((cell) => cell.date)).toEqual(window.dates);
  });

  it("draws a night the calendar left out rather than a shorter row", () => {
    const grid = rateGrid(window, [
      {
        roomType: "DELUXE",
        calendar: {
          failed: false,
          nights: [night(window.dates[0], 900_000n)],
        },
        restrictions: { failed: false, restrictions: [] },
      },
    ]);

    // A row narrower than the headings above it would mis-align every column.
    expect(grid.rows[0].cells).toHaveLength(3);
    expect(grid.rows[0].cells.map((cell) => cell.isPublished)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("puts a rule on its own night and on no other", () => {
    const grid = rateGrid(window, [
      answered("DELUXE", window.dates, 900_000n, [
        rule({ date: window.dates[1], minimumStay: 4 }),
      ]),
    ]);

    expect(grid.rows[0].cells.map((cell) => cell.restrictionMarks)).toEqual([
      [],
      ["4+"],
      [],
    ]);
  });

  it("draws no cells for a type whose prices could not be read", () => {
    const grid = rateGrid(window, [
      {
        roomType: "DELUXE",
        calendar: { failed: true, nights: undefined },
        restrictions: { failed: false, restrictions: [] },
      },
    ]);

    expect(grid.rows[0].status).toBe("failed");
    expect(grid.rows[0].cells).toEqual([]);
  });

  it("keeps a read in flight apart from one that failed", () => {
    const grid = rateGrid(window, [
      {
        roomType: "DELUXE",
        calendar: { failed: false, nights: undefined },
        restrictions: { failed: false, restrictions: [] },
      },
    ]);

    expect(grid.rows[0].status).toBe("pending");
    expect(grid.status).toBe("pending");
  });

  it("says the rules are unread when their own read failed", () => {
    // Drawing every night as unrestricted would be a claim about what the
    // property will sell, made out of an outage.
    const grid = rateGrid(window, [
      {
        roomType: "DELUXE",
        calendar: { failed: false, nights: [] },
        restrictions: { failed: true, restrictions: undefined },
      },
    ]);

    expect(grid.rows[0].status).toBe("ready");
    expect(grid.rows[0].rulesUnread).toBe(true);
  });

  it("does not call withheld rules unread", () => {
    // An accountant is not offered the restrictions row at all, which is a
    // permission rather than an outage and is said once above the grid.
    const grid = rateGrid(window, [
      {
        roomType: "DELUXE",
        calendar: { failed: false, nights: [] },
        restrictions: null,
      },
    ]);

    expect(grid.rows[0].rulesUnread).toBe(false);
    expect(grid.rows[0].cells.every((cell) => cell.restriction === null)).toBe(
      true,
    );
  });

  it("is failed only when no type will answer", () => {
    const failed = {
      calendar: { failed: true, nights: undefined },
      restrictions: null,
    } as const;

    expect(
      rateGrid(window, [
        { roomType: "SUPERIOR", ...failed },
        { roomType: "DELUXE", ...failed },
      ]).status,
    ).toBe("failed");

    expect(
      rateGrid(window, [
        { roomType: "SUPERIOR", ...failed },
        answered("DELUXE", window.dates, 900_000n),
      ]).status,
    ).toBe("ready");
  });
});

describe("unreadTypes", () => {
  it("names the types whose prices and whose rules are missing, apart", () => {
    const window = nightWindow(MONDAY, 1);
    const grid = rateGrid(window, [
      {
        roomType: "SUPERIOR",
        calendar: { failed: true, nights: undefined },
        restrictions: { failed: true, restrictions: undefined },
      },
      {
        roomType: "DELUXE",
        calendar: { failed: false, nights: [] },
        restrictions: { failed: true, restrictions: undefined },
      },
      answered("PREMIER", window.dates, 900_000n),
    ]);

    const unread = unreadTypes(grid.rows);

    // A row with no prices is reported once, as prices — saying its rules are
    // missing too would be two sentences about one outage.
    expect(unread.prices).toEqual(["SUPERIOR"]);
    expect(unread.rules).toEqual(["DELUXE"]);
  });
});

// ── Selecting a span ───────────────────────────────────────────────────────

describe("selectionSpan", () => {
  it("normalises a drag drawn from any corner", () => {
    const forwards = selectionSpan({
      anchor: { roomType: "SUPERIOR", date: MONDAY },
      focus: { roomType: "PREMIER", date: "2026-08-23" },
    });
    const backwards = selectionSpan({
      anchor: { roomType: "PREMIER", date: "2026-08-23" },
      focus: { roomType: "SUPERIOR", date: MONDAY },
    });

    expect(backwards).toEqual(forwards);
    expect(forwards.from).toBe(MONDAY);
    expect(forwards.to).toBe("2026-08-23");
  });

  it("selects a contiguous block of types in the product's order", () => {
    const span = selectionSpan({
      anchor: { roomType: "PANORAMA_SUITE", date: MONDAY },
      focus: { roomType: "DELUXE", date: MONDAY },
    });

    expect(span.roomTypes).toEqual([
      "DELUXE",
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("counts the nights and the rows the block covers", () => {
    const span = selectionSpan({
      anchor: { roomType: "SUPERIOR", date: MONDAY },
      focus: { roomType: "DELUXE", date: "2026-08-23" },
    });

    expect(span.nights).toBe(7);
    expect(span.cells).toBe(14);
  });

  it("is one night of one type at its smallest", () => {
    const cell = { roomType: "DELUXE", date: MONDAY } as const;
    const span = selectionSpan({ anchor: cell, focus: cell });

    expect(span.roomTypes).toEqual(["DELUXE"]);
    expect(span.nights).toBe(1);
    expect(span.cells).toBe(1);
  });
});

describe("isSelected", () => {
  const span = selectionSpan({
    anchor: { roomType: "DELUXE", date: "2026-08-18" },
    focus: { roomType: "PREMIER", date: "2026-08-20" },
  });

  it("holds the cells inside the block", () => {
    expect(isSelected(span, "DELUXE", "2026-08-18")).toBe(true);
    expect(isSelected(span, "PREMIER", "2026-08-20")).toBe(true);
    expect(isSelected(span, "PREMIER", "2026-08-19")).toBe(true);
  });

  it("holds nothing outside it, on either axis", () => {
    expect(isSelected(span, "SUPERIOR", "2026-08-19")).toBe(false);
    expect(isSelected(span, "DELUXE", "2026-08-17")).toBe(false);
    expect(isSelected(span, "DELUXE", "2026-08-21")).toBe(false);
    expect(isSelected(null, "DELUXE", "2026-08-19")).toBe(false);
  });
});

describe("extendSelection", () => {
  const first = { roomType: "DELUXE", date: MONDAY } as const;
  const second = { roomType: "PREMIER", date: "2026-08-20" } as const;

  it("anchors on a plain press", () => {
    expect(extendSelection(null, first, false)).toEqual({
      anchor: first,
      focus: first,
    });
  });

  it("moves the focus and leaves the anchor where it was", () => {
    const selection = extendSelection(
      extendSelection(null, first, false),
      second,
      true,
    );

    expect(selection).toEqual({ anchor: first, focus: second });
    expect(selectionSpan(selection).cells).toBe(8);
  });

  it("re-anchors rather than growing when the press is plain", () => {
    const selection = extendSelection(
      { anchor: first, focus: second },
      second,
      false,
    );

    expect(selection).toEqual({ anchor: second, focus: second });
  });

  it("anchors when extending with nothing selected", () => {
    // Shift on the first press of a fresh screen is not an error, and throwing
    // the press away would leave the operator pressing a dead cell.
    expect(extendSelection(null, first, true)).toEqual({
      anchor: first,
      focus: first,
    });
  });
});

describe("cellKey", () => {
  it("names both of a cell's coordinates in the one value the group tracks", () => {
    const cell = { roomType: "JUNIOR_SUITE", date: MONDAY } as const;

    expect(cellKey(cell)).toBe("JUNIOR_SUITE:2026-08-17");
    expect(parseCellKey(cellKey(cell))).toEqual(cell);
  });

  it("reads nothing out of a value that is not a cell", () => {
    // The DOM is where these come back from, so a stray member of some other
    // list has to answer null rather than a room type nobody selected.
    expect(parseCellKey(undefined)).toBeNull();
    expect(parseCellKey("")).toBeNull();
    expect(parseCellKey("402")).toBeNull();
    expect(parseCellKey("SUITE:2026-08-17")).toBeNull();
    expect(parseCellKey("DELUXE:2026-08-17:extra")).toBeNull();
  });
});

describe("verticalNeighbour", () => {
  const rows = ["SUPERIOR", "DELUXE", "PREMIER"] as const;

  it("keeps the night and moves the type", () => {
    // One step through the members in document order would be the next night.
    // Down from a Monday has to be the same Monday, one type lower.
    expect(
      verticalNeighbour(rows, { roomType: "DELUXE", date: MONDAY }, 1),
    ).toEqual({ roomType: "PREMIER", date: MONDAY });

    expect(
      verticalNeighbour(rows, { roomType: "DELUXE", date: MONDAY }, -1),
    ).toEqual({ roomType: "SUPERIOR", date: MONDAY });
  });

  it("stops at either edge rather than wrapping", () => {
    expect(
      verticalNeighbour(rows, { roomType: "SUPERIOR", date: MONDAY }, -1),
    ).toBeNull();
    expect(
      verticalNeighbour(rows, { roomType: "PREMIER", date: MONDAY }, 1),
    ).toBeNull();
  });

  it("steps only through the rows actually drawn", () => {
    // A type whose prices failed to load draws no cells, so it is not in `rows`
    // and the arrows must not stop on it.
    expect(
      verticalNeighbour(
        ["SUPERIOR", "PREMIER"],
        { roomType: "SUPERIOR", date: MONDAY },
        1,
      ),
    ).toEqual({ roomType: "PREMIER", date: MONDAY });

    expect(
      verticalNeighbour(rows, { roomType: "PANORAMA_SUITE", date: MONDAY }, -1),
    ).toBeNull();
  });
});

describe("nightNeighbour", () => {
  const dates = ["2026-08-17", "2026-08-18", "2026-08-19"] as const;

  it("keeps the type and moves the night", () => {
    // The axis the roving group would get wrong in the other direction: one
    // step through the members in document order from the last night of a type
    // is the first night of the next one, four weeks back.
    expect(
      nightNeighbour(dates, { roomType: "DELUXE", date: "2026-08-18" }, 1),
    ).toEqual({ roomType: "DELUXE", date: "2026-08-19" });

    expect(
      nightNeighbour(dates, { roomType: "DELUXE", date: "2026-08-18" }, -1),
    ).toEqual({ roomType: "DELUXE", date: "2026-08-17" });
  });

  it("stops at either end of the window rather than wrapping", () => {
    expect(
      nightNeighbour(dates, { roomType: "DELUXE", date: "2026-08-17" }, -1),
    ).toBeNull();
    expect(
      nightNeighbour(dates, { roomType: "DELUXE", date: "2026-08-19" }, 1),
    ).toBeNull();
  });

  it("answers nothing for a night the window does not hold", () => {
    expect(
      nightNeighbour(dates, { roomType: "DELUXE", date: "2026-09-01" }, 1),
    ).toBeNull();
  });
});

describe("monthSpans", () => {
  it("gathers a named column and the unnamed ones after it into one run", () => {
    const spans = monthSpans(
      nightColumns(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]),
    );

    expect(spans).toEqual([
      { label: "Aug", from: "2026-08-30", nights: 2 },
      { label: "Sept", from: "2026-09-01", nights: 2 },
    ]);
  });

  it("covers every column exactly once", () => {
    // The runs are a heading row over the dates, so a night in two spans or in
    // none would put the whole second header row out of step with the first.
    const columns = nightColumns([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);

    expect(
      monthSpans(columns).reduce((total, span) => total + span.nights, 0),
    ).toBe(columns.length);
  });

  it("answers nothing for a window with no nights in it", () => {
    expect(monthSpans([])).toEqual([]);
  });
});

describe("spanLabel", () => {
  it("names one type by its code", () => {
    const label = spanLabel(
      selectionSpan({
        anchor: { roomType: "DELUXE", date: MONDAY },
        focus: { roomType: "DELUXE", date: MONDAY },
      }),
    );

    expect(label).toContain("DELUXE");
    expect(label).toContain("1 night");
  });

  it("counts the types once there is more than one", () => {
    const label = spanLabel(
      selectionSpan({
        anchor: { roomType: "SUPERIOR", date: MONDAY },
        focus: { roomType: "PREMIER", date: "2026-08-23" },
      }),
    );

    expect(label).toContain("3 room types");
    expect(label).toContain("7 nights");
  });
});

// ── Reading a figure an operator typed ─────────────────────────────────────

describe("parseDong", () => {
  it("reads a bare figure", () => {
    expect(parseDong("1850000")).toBe(1_850_000n);
  });

  it("reads the property's own grouping", () => {
    expect(parseDong("1.850.000")).toBe(1_850_000n);
    expect(parseDong(" 1,850,000 ")).toBe(1_850_000n);
  });

  it("refuses a separator that is not a thousands mark", () => {
    // "1.5" from somebody who meant one and a half million would otherwise be
    // fifteen đồng — positive, accepted by the contract, and wrong on every
    // night of the season.
    expect(parseDong("1.5")).toBeNull();
    expect(parseDong("1850.00")).toBeNull();
    expect(parseDong("1.85")).toBeNull();
  });

  it("refuses anything that is not a whole count of đồng", () => {
    expect(parseDong("")).toBeNull();
    expect(parseDong("   ")).toBeNull();
    expect(parseDong("1850k")).toBeNull();
    expect(parseDong("-1850000")).toBeNull();
    expect(parseDong("một triệu")).toBeNull();
  });

  it("answers a bigint, so an amount cannot be added to a count", () => {
    expect(typeof parseDong("1000")).toBe("bigint");
  });
});

// ── The price edit ─────────────────────────────────────────────────────────

describe("priceEdit", () => {
  const week = selectionSpan({
    anchor: { roomType: "SUPERIOR", date: MONDAY },
    focus: { roomType: "SUPERIOR", date: "2026-08-23" },
  });

  it("prices a week with one call", () => {
    const edit = priceEdit(week, "1850000");

    expect("calls" in edit).toBe(true);
    if (!("calls" in edit)) {
      return;
    }

    expect(edit.calls).toHaveLength(1);
    expect(edit.calls[0]).toEqual({
      roomType: "SUPERIOR",
      from: MONDAY,
      to: "2026-08-23",
      grossPerNight: "1850000",
    });
    expect(edit.nights).toBe(7);
  });

  it("prices a fortnight across every type with one call per type", () => {
    // `screens.md` asks for a weekend uplift or a Tết season to be one edit
    // rather than fourteen. Fourteen nights of five types is five requests.
    const season = selectionSpan({
      anchor: { roomType: "SUPERIOR", date: MONDAY },
      focus: { roomType: "PANORAMA_SUITE", date: "2026-08-30" },
    });
    const edit = priceEdit(season, "2400000");

    expect("calls" in edit).toBe(true);
    if (!("calls" in edit)) {
      return;
    }

    expect(edit.calls).toHaveLength(ROOM_TYPE_CODES.length);
    expect(edit.calls.map((call) => call.roomType)).toEqual([
      ...ROOM_TYPE_CODES,
    ]);
    expect(edit.calls.every((call) => call.from === MONDAY)).toBe(true);
    expect(edit.calls.every((call) => call.to === "2026-08-30")).toBe(true);
    expect(edit.nights).toBe(70);
  });

  it("sends the đồng exactly as typed, with nothing rounded into them", () => {
    const edit = priceEdit(week, "1850400");

    expect("calls" in edit && edit.calls[0].grossPerNight).toBe("1850400");
  });

  it("refuses a free night in the contract's own words", () => {
    const edit = priceEdit(week, "0");

    expect("problem" in edit).toBe(true);
    if ("problem" in edit) {
      expect(edit.problem).toContain("comp");
    }
  });

  it("refuses a figure that is not a whole count of đồng", () => {
    const edit = priceEdit(week, "1.5");

    expect("problem" in edit && edit.problem).toContain("whole number of đồng");
  });
});

// ── The restriction edit ───────────────────────────────────────────────────

describe("restrictionEdit", () => {
  const week = selectionSpan({
    anchor: { roomType: "DELUXE", date: MONDAY },
    focus: { roomType: "PREMIER", date: "2026-08-23" },
  });

  it("writes one rule per type over the whole span", () => {
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      minimumStay: "3",
      closedToArrival: true,
    });

    expect("calls" in edit).toBe(true);
    if (!("calls" in edit)) {
      return;
    }

    expect(edit.calls).toHaveLength(2);
    expect(edit.calls[0]).toEqual({
      roomType: "DELUXE",
      from: MONDAY,
      to: "2026-08-23",
      minimumStay: 3,
      maximumStay: null,
      closedToArrival: true,
      closedToDeparture: false,
    });
    expect(edit.nights).toBe(14);
    expect(edit.clears).toBe(false);
  });

  it("sends all four fields even when only one was typed", () => {
    // The contract defaults them so a body naming a minimum alone does not
    // silently carry over yesterday's closed-to-arrival flag.
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      minimumStay: "2",
    });

    expect("calls" in edit && Object.keys(edit.calls[0]).sort()).toEqual([
      "closedToArrival",
      "closedToDeparture",
      "from",
      "maximumStay",
      "minimumStay",
      "roomType",
      "to",
    ]);
  });

  it("reads the unrestricted rule as a removal", () => {
    const edit = restrictionEdit(week, NO_RESTRICTION_FIELDS);

    expect("clears" in edit && edit.clears).toBe(true);
  });

  it("reads a blank minimum as one night", () => {
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      minimumStay: "",
      closedToDeparture: true,
    });

    expect("calls" in edit && edit.calls[0].minimumStay).toBe(1);
    expect("clears" in edit && edit.clears).toBe(false);
  });

  it("reads a blank maximum as no ceiling", () => {
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      minimumStay: "2",
      maximumStay: "",
    });

    expect("calls" in edit && edit.calls[0].maximumStay).toBeNull();
  });

  it("refuses a maximum below the minimum in the contract's words", () => {
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      minimumStay: "5",
      maximumStay: "2",
    });

    expect("problem" in edit && edit.problem).toContain(
      "must not fall below minimumStay",
    );
  });

  it("refuses a stay length the columns cannot hold", () => {
    expect(
      "problem" in
        restrictionEdit(week, {
          ...NO_RESTRICTION_FIELDS,
          minimumStay: "0",
        }),
    ).toBe(true);

    expect(
      "problem" in
        restrictionEdit(week, {
          ...NO_RESTRICTION_FIELDS,
          minimumStay: "400",
        }),
    ).toBe(true);
  });

  it("refuses a stay length that is not a count of nights", () => {
    const edit = restrictionEdit(week, {
      ...NO_RESTRICTION_FIELDS,
      maximumStay: "a week",
    });

    expect("problem" in edit && edit.problem).toContain(
      "whole number of nights",
    );
  });
});

// ── The three plans ────────────────────────────────────────────────────────

describe("planFields", () => {
  it("seeds the name and the adjustment and leaves breakfast blank", () => {
    // Blank is the PATCH's own `undefined`. A box seeded with the current figure
    // and then cleared would be asking this form to guess between "unchanged"
    // and "removed", which is the one distinction the route exists to keep.
    expect(planFields(plan())).toEqual({
      name: "Bed and breakfast",
      percentAdjustment: "0",
      breakfastPerPersonGross: "",
      removesBreakfast: false,
    });
  });
});

describe("planPatch", () => {
  function fields(over: Partial<PlanFields> = {}): PlanFields {
    return { ...planFields(plan()), ...over };
  }

  it("leaves breakfast alone when the box is blank", () => {
    const patch = planPatch(plan(), fields({ name: "Bed & breakfast" }));

    expect("input" in patch).toBe(true);
    if (!("input" in patch)) {
      return;
    }

    expect(patch.input).toEqual({ code: "BB", name: "Bed & breakfast" });
    expect("breakfastPerPersonGross" in patch.input).toBe(false);
    expect(patch.changes).toEqual(['Renames it to "Bed & breakfast"']);
  });

  it("removes breakfast with an explicit null, and says so", () => {
    const patch = planPatch(plan(), fields({ removesBreakfast: true }));

    expect("input" in patch).toBe(true);
    if (!("input" in patch)) {
      return;
    }

    expect(patch.input).toEqual({ code: "BB", breakfastPerPersonGross: null });
    expect(patch.changes).toEqual([
      "Removes breakfast — the plan becomes room-only",
    ]);
  });

  it("keeps the two acts apart rather than resolving them", () => {
    // A figure and the room-only tick together is a commercial question this
    // form must not answer on the operator's behalf.
    const patch = planPatch(
      plan(),
      fields({ breakfastPerPersonGross: "150000", removesBreakfast: true }),
    );

    expect("problem" in patch && patch.problem).toContain("Decide one");
  });

  it("sets breakfast as the decimal text the wire takes", () => {
    const patch = planPatch(
      plan(),
      fields({ breakfastPerPersonGross: "150.000" }),
    );

    expect("input" in patch && patch.input.breakfastPerPersonGross).toBe(
      "150000",
    );
    expect("changes" in patch && patch.changes[0]).toBe(
      `Sets breakfast to ${formatVnd(150_000n)} a head`,
    );
  });

  it("does not call a removal a change when there is no breakfast to remove", () => {
    const roomOnly = plan({ code: "STANDARD", breakfastPerPersonGross: null });
    const patch = planPatch(roomOnly, {
      ...planFields(roomOnly),
      removesBreakfast: true,
    });

    expect("problem" in patch && patch.problem).toContain(
      "Nothing in the plan",
    );
  });

  it("sends nothing when nothing has moved", () => {
    const patch = planPatch(plan(), fields());

    expect("problem" in patch && patch.problem).toContain(
      "the room-only tick is what removes it",
    );
  });

  it("patches the adjustment on its own", () => {
    const patch = planPatch(plan({ code: "NONREF", percentAdjustment: 0 }), {
      ...planFields(plan({ code: "NONREF" })),
      percentAdjustment: "-10",
    });

    expect("input" in patch && patch.input).toEqual({
      code: "NONREF",
      percentAdjustment: -10,
    });
    expect("changes" in patch && patch.changes).toEqual([
      "Sets the adjustment to -10%",
    ]);
  });

  it("never sends the display order", () => {
    // Read-only in the contract: three plans are ordered once and the column is
    // unique, so reordering would be a swap of rows rather than a PATCH.
    const patch = planPatch(plan(), fields({ name: "Anything" }));

    expect("input" in patch && "displayOrder" in patch.input).toBe(false);
  });

  it("refuses an adjustment that is not a signed whole percent", () => {
    expect(
      "problem" in planPatch(plan(), fields({ percentAdjustment: "8.5" })),
    ).toBe(true);
    expect(
      "problem" in planPatch(plan(), fields({ percentAdjustment: "200" })),
    ).toBe(true);
  });

  it("refuses a breakfast of nothing in the contract's own words", () => {
    const patch = planPatch(plan(), fields({ breakfastPerPersonGross: "0" }));

    expect("problem" in patch && patch.problem).toContain(
      "breakfast must cost something",
    );
  });

  it("refuses a name emptied out", () => {
    const patch = planPatch(plan(), fields({ name: "   " }));

    expect("problem" in patch).toBe(true);
  });
});

describe("percentLabel", () => {
  it("signs an uplift and leaves a reduction its own minus", () => {
    expect(percentLabel(8)).toBe("+8%");
    expect(percentLabel(-10)).toBe("-10%");
    expect(percentLabel(0)).toBe("0%");
  });
});

describe("breakfastLabel", () => {
  it("says what a plan includes for breakfast", () => {
    expect(breakfastLabel(plan())).toContain(formatVnd(120_000n));
    expect(breakfastLabel(plan({ breakfastPerPersonGross: null }))).toBe(
      "Room only — no breakfast included",
    );
  });
});

// ── What an edit stales ────────────────────────────────────────────────────

describe("readsRoomType", () => {
  const key = [
    "pricing",
    "readRateCalendar",
    {
      input: { roomType: "DELUXE", from: MONDAY, to: "2026-09-13" },
      type: "query",
    },
  ];

  it("matches the read that asked about this type", () => {
    expect(readsRoomType(key, "DELUXE")).toBe(true);
  });

  it("leaves every other type's answer alone", () => {
    // A price written on DELUXE leaves PREMIER's window exactly as correct as it
    // was, and refetching it would ask the API for the whole grid again.
    expect(readsRoomType(key, "PREMIER")).toBe(false);
  });

  it("matches nothing in a key that names no type", () => {
    expect(readsRoomType(["pricing", "listRatePlans"], "DELUXE")).toBe(false);
    expect(readsRoomType([], "DELUXE")).toBe(false);
    expect(readsRoomType(["pricing", null, undefined], "DELUXE")).toBe(false);
  });
});
