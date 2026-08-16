// The boundary this module exists to hold: months in, one window of nights out,
// with money and dates in the form the screen reasons in rather than the form
// the wire spells them in.
//
// The client is stubbed because what is under test is the fan-out, the decoding
// and the trim — not oRPC. What the stub answers is shaped exactly as the
// transport answers: an ISO date, and đồng as decimal text, which is what
// `money.ts` says a `bigint` becomes in JSON.

import { parseDate } from "@internationalized/date";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calendar = vi.fn();
const search = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { availability: { calendar, search } },
}));

const { readNightRates, readStayOffers } = await import("./availability");

/** A month of nights as the API answers it, from the first of the month. */
function monthOf(year: number, month: number, days: number) {
  const first = parseDate(`${year}-${String(month).padStart(2, "0")}-01`);

  return {
    plan: "STANDARD",
    nights: Array.from({ length: days }, (_, offset) => ({
      date: first.add({ days: offset }).toString(),
      lowestGross: "1850000",
      isSoldOut: false,
      isClosedToArrival: false,
      minimumStay: 1,
    })),
  };
}

beforeEach(() => {
  calendar.mockReset();
  search.mockReset();
});

describe("reading the priced window", () => {
  it("asks for every month the window touches, and no others", async () => {
    calendar.mockImplementation(async (query: { month: number }) =>
      monthOf(2026, query.month, 31),
    );

    await readNightRates(parseDate("2026-08-30"), 34, "STANDARD");

    expect(calendar.mock.calls.map(([query]) => query)).toEqual([
      { year: 2026, month: 8, plan: "STANDARD" },
      { year: 2026, month: 9, plan: "STANDARD" },
      { year: 2026, month: 10, plan: "STANDARD" },
    ]);
  });

  it("crosses the year boundary rather than counting past twelve", async () => {
    calendar.mockImplementation(
      async (query: { year: number; month: number }) =>
        monthOf(query.year, query.month, 28),
    );

    await readNightRates(parseDate("2026-12-20"), 20, "NONREF");

    expect(calendar.mock.calls.map(([query]) => query)).toEqual([
      { year: 2026, month: 12, plan: "NONREF" },
      { year: 2027, month: 1, plan: "NONREF" },
    ]);
  });

  // The months are whole, so the first and last of them overhang the window at
  // both ends. A night the guest cannot book must not be counted as one they can
  // — the foot says "n of the next m nights are free" off exactly this list.
  it("trims the months back to the window", async () => {
    calendar.mockImplementation(async (query: { month: number }) =>
      monthOf(2026, query.month, 31),
    );

    const nights = await readNightRates(parseDate("2026-08-30"), 4, "STANDARD");

    expect(nights.map((night) => night.date.toString())).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("decodes the wire's text into a date and đồng", async () => {
    calendar.mockResolvedValue({
      plan: "STANDARD",
      nights: [
        {
          date: "2026-08-30",
          lowestGross: "1850000",
          isSoldOut: false,
          isClosedToArrival: true,
          minimumStay: 2,
        },
      ],
    });

    const [night] = await readNightRates(
      parseDate("2026-08-30"),
      1,
      "STANDARD",
    );

    expect(night).toEqual({
      date: parseDate("2026-08-30"),
      lowestGross: 1_850_000n,
      isSoldOut: false,
      isClosedToArrival: true,
      minimumStay: 2,
    });
  });

  it("keeps a sold-out night's absent price absent", async () => {
    calendar.mockResolvedValue({
      plan: "STANDARD",
      nights: [
        {
          date: "2026-08-30",
          lowestGross: null,
          isSoldOut: true,
          isClosedToArrival: false,
          minimumStay: 1,
        },
      ],
    });

    const [night] = await readNightRates(
      parseDate("2026-08-30"),
      1,
      "STANDARD",
    );

    expect(night.lowestGross).toBeNull();
  });

  // Half a calendar is worse than none: the missing month refuses every press
  // with "not yet priced", which a guest cannot tell from a property that is
  // full. So one month failing fails the read, and the screen says so.
  it("refuses the whole window when one month fails", async () => {
    calendar.mockImplementation(async (query: { month: number }) => {
      if (query.month === 9) throw new Error("no");
      return monthOf(2026, query.month, 31);
    });

    await expect(
      readNightRates(parseDate("2026-08-30"), 34, "STANDARD"),
    ).rejects.toThrow("no");
  });
});

describe("reading the offers for a range", () => {
  it("sends the dates as text and the party flat", async () => {
    search.mockResolvedValue({ plan: "BB", offers: [] });

    await readStayOffers(
      {
        checkIn: parseDate("2026-08-10"),
        checkOut: parseDate("2026-08-12"),
      },
      { adults: 2, children: [{ age: 9 }, { age: 3 }] },
      "BB",
    );

    expect(search).toHaveBeenCalledWith({
      checkIn: "2026-08-10",
      checkOut: "2026-08-12",
      plan: "BB",
      adults: 2,
      childAges: [9, 3],
    });
  });

  it("normalises both figures into đồng", async () => {
    search.mockResolvedValue({
      plan: "STANDARD",
      offers: [
        {
          code: "DELUXE",
          perNightGross: "2450000",
          stayTotalGross: "4900000",
          isAvailable: true,
        },
      ],
    });

    const [offer] = await readStayOffers(
      {
        checkIn: parseDate("2026-08-10"),
        checkOut: parseDate("2026-08-12"),
      },
      { adults: 2, children: [] },
      "STANDARD",
    );

    expect(offer).toEqual({
      code: "DELUXE",
      perNightGross: 2_450_000n,
      stayTotalGross: 4_900_000n,
      isAvailable: true,
    });
  });
});
