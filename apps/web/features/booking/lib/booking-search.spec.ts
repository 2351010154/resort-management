import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  type BookingSearch,
  formatStayDate,
  formatStayDates,
  readBookingSearch,
  writeBookingSearch,
} from "./booking-search";

const read = (query: string) => readBookingSearch(new URLSearchParams(query));

describe("reading a search from the URL", () => {
  it("takes an ordered pair of dates as a range", () => {
    const search = read("from=2026-08-10&to=2026-08-12");

    expect(search.range?.checkIn.toString()).toBe("2026-08-10");
    expect(search.range?.checkOut.toString()).toBe("2026-08-12");
  });

  // Both or neither: a half-open range prices nothing, so it is not a range.
  it("drops a range missing one end", () => {
    expect(read("from=2026-08-10").range).toBeNull();
    expect(read("to=2026-08-12").range).toBeNull();
  });

  // A typo, not a request to swap them. Swapping would quote a stay the link never
  // asked for, and the guest would not know it had been rewritten.
  it("refuses a reversed range rather than reordering it", () => {
    expect(read("from=2026-08-12&to=2026-08-10").range).toBeNull();
  });

  it("refuses a same-day range", () => {
    expect(read("from=2026-08-10&to=2026-08-10").range).toBeNull();
  });

  // A date that will not parse is dropped rather than defaulted: a guest arriving on
  // a broken link should see the screen asking for dates, not an invented stay.
  it("drops a date that is not a date", () => {
    expect(read("from=garbage&to=2026-08-12").range).toBeNull();
    expect(read("from=2026-02-31&to=2026-03-02").range).toBeNull();
  });

  it("defaults to two adults and no children", () => {
    expect(read("").party).toEqual({ adults: 2, children: [] });
  });

  it("reads child ages, not a child count", () => {
    expect(read("ages=3,9").party.children).toEqual([{ age: 3 }, { age: 9 }]);
  });

  it("clamps a party to what the property can sleep", () => {
    expect(read("adults=99").party.adults).toBe(4);
    expect(read("adults=0").party.adults).toBe(1);
  });

  it("clamps a child's age into the child bands", () => {
    expect(read("ages=40").party.children).toEqual([{ age: 11 }]);
  });

  it("ignores an age that is not a number", () => {
    expect(read("ages=9,abc").party.children).toEqual([{ age: 9 }]);
  });

  it("falls back to the standard plan for an unknown plan", () => {
    expect(read("plan=FREE_ROOMS").plan).toBe("STANDARD");
    expect(read("plan=NONREF").plan).toBe("NONREF");
  });
});

describe("writing a search back to the URL", () => {
  const base: BookingSearch = {
    range: {
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-12"),
    },
    party: { adults: 2, children: [] },
    plan: "STANDARD",
  };

  // Defaults are omitted so the shortest link that means something is the one a
  // guest is asked to share.
  it("writes only what differs from the default", () => {
    expect(writeBookingSearch(base)).toBe("?from=2026-08-10&to=2026-08-12");
  });

  it("writes the party when it is not two adults", () => {
    expect(
      writeBookingSearch({
        ...base,
        party: { adults: 3, children: [{ age: 9 }] },
      }),
    ).toBe("?from=2026-08-10&to=2026-08-12&adults=3&ages=9");
  });

  it("writes nothing at all for an empty search", () => {
    expect(
      writeBookingSearch({
        range: null,
        party: { adults: 2, children: [] },
        plan: "STANDARD",
      }),
    ).toBe("");
  });

  // The codec has to run in both directions, or a shared link re-prices itself on
  // arrival. This is the property that matters most about the whole module.
  it("round-trips", () => {
    const full: BookingSearch = {
      range: {
        checkIn: parseDate("2026-12-24"),
        checkOut: parseDate("2026-12-27"),
      },
      party: { adults: 3, children: [{ age: 4 }, { age: 11 }] },
      plan: "BB",
    };

    const again = read(writeBookingSearch(full).slice(1));

    expect(again.range?.checkIn.toString()).toBe("2026-12-24");
    expect(again.range?.checkOut.toString()).toBe("2026-12-27");
    expect(again.party).toEqual(full.party);
    expect(again.plan).toBe("BB");
  });
});

describe("saying the dates back to the guest", () => {
  it("counts nights, not days", () => {
    const stay = formatStayDates({
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-12"),
    });

    expect(stay.nights).toBe("2 nights");
  });

  it("says one night in the singular", () => {
    const stay = formatStayDates({
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-11"),
    });

    expect(stay.nights).toBe("1 night");
  });

  it("drops the repeated month inside one month", () => {
    const stay = formatStayDates({
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-12"),
    });

    expect(stay.dates).toBe("10 – 12 August");
  });

  it("names both months across a boundary", () => {
    const stay = formatStayDates({
      checkIn: parseDate("2026-08-30"),
      checkOut: parseDate("2026-09-02"),
    });

    expect(stay.dates).toBe("30 August – 2 September");
  });

  // The regression the property's timezone exists to prevent: a stay date formatted
  // against the machine's clock renders the wrong day for exactly the guests most
  // likely to book a resort in Vietnam. Asserted on the date the guest asked for.
  it("renders the date it was given, whatever the machine's zone", () => {
    expect(formatStayDate(parseDate("2026-08-10"))).toBe("10 August 2026");
    expect(formatStayDate(parseDate("2026-01-01"))).toBe("1 January 2026");
    expect(formatStayDate(parseDate("2026-12-31"))).toBe("31 December 2026");
  });
});
