// The boundary this module exists to hold: a window in, one window of nights
// out, with money and dates in the form the screen reasons in rather than the
// form the wire spells them in.
//
// The client is stubbed because what is under test is the question asked and the
// decoding of the answer — not oRPC. What the stub answers is shaped exactly as
// the transport answers: an ISO date, and đồng as decimal text, which is what
// `money.ts` says a `bigint` becomes in JSON.

import { parseDate } from "@internationalized/date";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calendar = vi.fn();
const search = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { availability: { calendar, search } },
}));

const { readNightRates, readStayOffers } = await import("./availability");

/** A window of nights as the API answers it, from `from` for `days` nights. */
function windowOf(from: string, days: number) {
  const first = parseDate(from);

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
  // One request for the whole horizon. The month form made a year of nights
  // thirteen calls on the first paint of a public page, and this is the
  // assertion that keeps it one.
  it("asks for the window once, half-open, as text", async () => {
    calendar.mockImplementation(async () => windowOf("2026-08-30", 34));

    await readNightRates(parseDate("2026-08-30"), 34, "STANDARD");

    expect(calendar.mock.calls.map(([query]) => query)).toEqual([
      { from: "2026-08-30", to: "2026-10-03", plan: "STANDARD" },
    ]);
  });

  it("crosses the year boundary in the same one call", async () => {
    calendar.mockImplementation(async () => windowOf("2026-12-20", 20));

    await readNightRates(parseDate("2026-12-20"), 20, "NONREF");

    expect(calendar.mock.calls.map(([query]) => query)).toEqual([
      { from: "2026-12-20", to: "2027-01-09", plan: "NONREF" },
    ]);
  });

  // The answer is exactly the nights that were asked for, so nothing is trimmed
  // here — the foot says "n of the next m nights are free" off this list, and a
  // night the guest cannot book must never appear in it.
  it("hands back the window the route answered with", async () => {
    calendar.mockImplementation(async () => windowOf("2026-08-30", 4));

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

  // Half a calendar is worse than none: the missing nights refuse every press
  // with "not yet priced", which a guest cannot tell from a property that is
  // full. The read fails whole, and the screen says so.
  it("refuses the whole window when the read fails", async () => {
    calendar.mockRejectedValue(new Error("no"));

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
