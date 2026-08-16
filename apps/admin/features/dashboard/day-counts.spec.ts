import { describe, expect, it } from "vitest";

import type { HousekeepingBoard } from "@/features/housekeeping";

import {
  arrivalCriteria,
  arrivalsAwaitingCheckIn,
  countReading,
  departureCriteria,
  departuresAwaitingCheckout,
  type DayCount,
  type FolioPage,
  roomsNotReady,
  type SearchResults,
  shiftDate,
  unsettledFolios,
} from "./day-counts";

/* The arithmetic behind four numbers a desk is going to trust.
 *
 * Nothing below needs a browser, which is why it is here rather than in the
 * Playwright run: the counts are cut out of three API answers by pure
 * functions, and every way they can be wrong — the wrong day, the wrong side of
 * a half-open window, a failure printed as a zero — is a property of those
 * functions and of nothing React does with them.
 */

const TODAY = "2026-08-16";

function stay(overrides: {
  checkIn: string;
  checkOut: string;
  reference?: string;
}) {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    reference: overrides.reference ?? "BK-1042",
    state: "CONFIRMED" as const,
    roomType: "SUPERIOR" as const,
    checkIn: overrides.checkIn,
    checkOut: overrides.checkOut,
    roomNumber: null,
    guestNames: [],
  };
}

function found(bookings: ReturnType<typeof stay>[]): SearchResults {
  return { scope: "everything", rooms: [], bookings, guests: [] };
}

/** What the API answers a caller whose grant covers rooms and nothing else. */
const roomsOnly: SearchResults = { scope: "rooms", rooms: [] };

describe("shiftDate", () => {
  it("walks the calendar in both directions", () => {
    expect(shiftDate(TODAY, 1)).toBe("2026-08-17");
    expect(shiftDate(TODAY, -1)).toBe("2026-08-15");
    expect(shiftDate(TODAY, 0)).toBe(TODAY);
  });

  it("crosses a month and a year without a case for either", () => {
    expect(shiftDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("gets February right in a leap year and in an ordinary one", () => {
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("refuses something that is not a calendar date", () => {
    expect(() => shiftDate("today", 1)).toThrow(/calendar date/);
  });
});

describe("arrivalCriteria", () => {
  it("asks for the stays that are confirmed and occupy today", () => {
    // The API matches by overlap — `checkIn < to and checkOut > from` — so one
    // business day is the window every stay arriving today falls inside.
    expect(arrivalCriteria(TODAY)).toEqual({
      state: "CONFIRMED",
      from: TODAY,
      to: "2026-08-17",
    });
  });
});

describe("departureCriteria", () => {
  it("asks for yesterday, which is the window a departure is visible in", () => {
    // A stay leaving today owns nights up to but not including today, so
    // today's own window would exclude exactly the stays the card counts.
    expect(departureCriteria(TODAY)).toEqual({
      state: "CHECKED_IN",
      from: "2026-08-15",
      to: TODAY,
    });
  });
});

describe("arrivalsAwaitingCheckIn", () => {
  it("counts the stays arriving today and no others", () => {
    // The middle one is a confirmed stay that arrived yesterday and was never
    // checked in. It still occupies today, so the search returns it — it is a
    // no-show for the night audit rather than somebody standing at the desk.
    const results = found([
      stay({ checkIn: TODAY, checkOut: "2026-08-18" }),
      stay({ checkIn: "2026-08-15", checkOut: "2026-08-18" }),
      stay({ checkIn: TODAY, checkOut: "2026-08-17" }),
    ]);

    expect(arrivalsAwaitingCheckIn(results, TODAY)).toEqual({
      count: 2,
      truncated: false,
    });
  });

  it("counts nothing as zero, which is a real answer", () => {
    expect(arrivalsAwaitingCheckIn(found([]), TODAY)).toEqual({
      count: 0,
      truncated: false,
    });
  });

  it("says a full page was cut short rather than printing a floor as a total", () => {
    const results = found(
      Array.from({ length: 50 }, (_, index) =>
        stay({
          checkIn: TODAY,
          checkOut: "2026-08-18",
          reference: `BK-${index}`,
        }),
      ),
    );

    expect(arrivalsAwaitingCheckIn(results, TODAY)?.truncated).toBe(true);
  });

  it("refuses to answer out of a rooms-only search", () => {
    // A narrowed answer carries no stays at all. Zero would be a statement
    // about the property; null is the truth, which is that this caller was not
    // asked to see them.
    expect(arrivalsAwaitingCheckIn(roomsOnly, TODAY)).toBeNull();
  });
});

describe("departuresAwaitingCheckout", () => {
  it("counts the stays whose last night was last night", () => {
    const results = found([
      stay({ checkIn: "2026-08-14", checkOut: TODAY }),
      stay({ checkIn: "2026-08-14", checkOut: "2026-08-18" }),
      stay({ checkIn: "2026-08-15", checkOut: TODAY }),
    ]);

    expect(departuresAwaitingCheckout(results, TODAY)).toEqual({
      count: 2,
      truncated: false,
    });
  });

  it("refuses to answer out of a rooms-only search", () => {
    expect(departuresAwaitingCheckout(roomsOnly, TODAY)).toBeNull();
  });
});

describe("roomsNotReady", () => {
  it("counts every room a guest cannot be walked into", () => {
    const board: HousekeepingBoard = {
      businessDate: TODAY,
      rooms: [
        tile("401", { status: "CLEAN", isReady: true }),
        tile("402", { status: "DIRTY", isReady: false }),
        // Ready is the API's own answer to the check-in guard, so an inspected
        // room counts as ready without this file knowing why.
        tile("403", { status: "INSPECTED", isReady: true }),
        tile("404", { status: "OUT_OF_ORDER", isReady: false }),
      ],
    };

    expect(roomsNotReady(board)).toEqual({ count: 2, truncated: false });
  });
});

describe("unsettledFolios", () => {
  it("reads the total under the filter rather than the length of the page", () => {
    // One row asked for and seven accounts matched: the card's number is the
    // API's count under the filter, never `folios.length`, which is the page
    // size and would report the property as almost settled.
    const page: FolioPage = {
      folios: [
        {
          id: "00000000-0000-4000-8000-00000000000f",
          bookingId: "00000000-0000-4000-8000-000000000000",
          state: "OPEN",
          openedAt: "2026-08-15T09:00:00.000Z",
          closedAt: null,
          summary: { charged: 1n, credited: 0n, outstanding: 1n },
        },
      ],
      total: 7,
    };

    expect(unsettledFolios(page)).toEqual({ count: 7, truncated: false });
  });
});

describe("countReading", () => {
  const counted: DayCount = { count: 3, truncated: false };

  it("is pending while there is no answer yet", () => {
    expect(
      countReading({ failed: false, data: undefined }, () => counted),
    ).toEqual({ status: "pending" });
  });

  it("fails without deriving anything when the source failed", () => {
    const reading = countReading({ failed: true, data: "anything" }, () => {
      throw new Error("a failed card must not be derived from");
    });

    expect(reading).toEqual({ status: "failed" });
  });

  it("fails rather than reporting zero when the answer cannot say", () => {
    // This is the whole point of the union: there is no `count` on a failed
    // reading, so no render path can reach for one and find a zero that reads
    // as "nobody is waiting".
    expect(
      countReading({ failed: false, data: "anything" }, () => null),
    ).toEqual({ status: "failed" });
  });

  it("carries the figure and its ceiling through once it is known", () => {
    expect(
      countReading({ failed: false, data: "anything" }, () => ({
        count: 50,
        truncated: true,
      })),
    ).toEqual({ status: "counted", count: 50, truncated: true });
  });

  it("reports a genuine zero as a count", () => {
    expect(
      countReading({ failed: false, data: "anything" }, () => ({
        count: 0,
        truncated: false,
      })),
    ).toEqual({ status: "counted", count: 0, truncated: false });
  });
});

function tile(
  roomNumber: string,
  condition: {
    status: HousekeepingBoard["rooms"][number]["status"];
    isReady: boolean;
  },
): HousekeepingBoard["rooms"][number] {
  return {
    roomNumber,
    floor: 4,
    roomType: "SUPERIOR",
    status: condition.status,
    isReady: condition.isReady,
    isOccupied: false,
    note: null,
    updatedAt: null,
    updatedBy: null,
  };
}
