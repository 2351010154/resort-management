// What survives a guest leaving the funnel, and what must not.
//
// The pair under test is the whole of the durable surface: everything written
// goes through `encodeStay` and everything read comes back through `decodeStay`,
// so the two claims worth holding to account are here rather than behind
// `localStorage`. They are a privacy claim and a correctness claim.
//
// - **A search and never a person.** Contact belongs on the review screen, one
//   press before the money, and a key in a browser that quietly accumulated a
//   name and an address would move it. So the encoder is asserted field by
//   field, not spot-checked: an addition shows up here as a failure rather than
//   as a value nobody meant to keep.
// - **A search that has gone stale is not offered back.** Dates in the past are
//   refused at the hold, so restoring them would put a guest on a screen that
//   fails when they press the button.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { decodeStay, encodeStay, type RememberedStay } from "./remembered-stay";

const TODAY = parseDate("2026-08-10");
const SAVED_AT = Date.UTC(2026, 7, 10, 10, 0, 0);
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const A_SEARCH: RememberedStay = {
  checkIn: parseDate("2026-09-01"),
  checkOut: parseDate("2026-09-03"),
  party: { adults: 2, children: [{ age: 7 }] },
  plan: "BB",
  roomType: "DELUXE",
};

/** The one string a visit leaves behind, back as a search. */
const roundTrip = (stay: RememberedStay, today = TODAY, now = SAVED_AT) =>
  decodeStay(encodeStay(stay, SAVED_AT), today, now);

describe("the search a visit leaves behind", () => {
  it("comes back as the stay that was asked about", () => {
    expect(roundTrip(A_SEARCH)).toEqual(A_SEARCH);
  });

  it("keeps the dates, the party, the plan and the room and nothing else", () => {
    // Field by field on purpose. A contact pair, a booking reference or an id
    // arriving in this key would be a guest's stay left in a lobby browser, and
    // an assertion that only checked the fields it expected would not see it.
    expect(JSON.parse(encodeStay(A_SEARCH, SAVED_AT))).toEqual({
      savedAt: SAVED_AT,
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      adults: 2,
      childAges: [7],
      plan: "BB",
      roomType: "DELUXE",
    });
  });

  it("keeps the ages rather than a count of children", () => {
    // §3 prices under-6 free, 6–11 at half and 12-plus as an adult, so a count
    // restores a stay at a different total than the guest was looking at.
    const restored = roundTrip({
      ...A_SEARCH,
      party: { adults: 1, children: [{ age: 3 }, { age: 9 }] },
    });

    expect(restored?.party.children).toEqual([{ age: 3 }, { age: 9 }]);
  });
});

describe("a search that is not offered back", () => {
  it("expires after fifteen minutes", () => {
    expect(roundTrip(A_SEARCH, TODAY, SAVED_AT + FIFTEEN_MINUTES - 1)).toEqual(
      A_SEARCH,
    );
    expect(roundTrip(A_SEARCH, TODAY, SAVED_AT + FIFTEEN_MINUTES)).toBeNull();
  });

  it("drops a timeless value written before expiry was introduced", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));
    const { savedAt: _, ...legacy } = stored;

    expect(decodeStay(JSON.stringify(legacy), TODAY, SAVED_AT)).toBeNull();
  });

  it("drops a value dated in the future", () => {
    expect(
      decodeStay(encodeStay(A_SEARCH, SAVED_AT + 1), TODAY, SAVED_AT),
    ).toBeNull();
  });

  it("drops one whose arrival the property has passed", () => {
    expect(roundTrip(A_SEARCH, parseDate("2026-09-02"))).toBeNull();
  });

  // The night the guest arrives is still sellable up to the moment the property
  // moves off it, which is the whole reason the comparison is not inclusive.
  it("keeps one arriving on the property's own today", () => {
    expect(roundTrip(A_SEARCH, parseDate("2026-09-01"))).not.toBeNull();
  });

  it("drops a value nothing wrote, rather than believing half of it", () => {
    expect(decodeStay(null, TODAY, SAVED_AT)).toBeNull();
    expect(decodeStay("", TODAY, SAVED_AT)).toBeNull();
    expect(decodeStay("not json", TODAY, SAVED_AT)).toBeNull();
    expect(decodeStay("[]", TODAY, SAVED_AT)).toBeNull();
    expect(
      decodeStay(JSON.stringify({ checkIn: "2026-09-01" }), TODAY, SAVED_AT),
    ).toBeNull();
  });

  it("drops a date that is not one", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));

    expect(
      decodeStay(
        JSON.stringify({ ...stored, checkIn: "garbage" }),
        TODAY,
        SAVED_AT,
      ),
    ).toBeNull();
    // Shaped like a date and not a day that exists — the same refusal the url
    // codec makes, for the same reason.
    expect(
      decodeStay(
        JSON.stringify({ ...stored, checkIn: "2026-02-31" }),
        parseDate("2026-01-01"),
        SAVED_AT,
      ),
    ).toBeNull();
  });

  it("refuses a reversed stay rather than reordering it", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));

    expect(
      decodeStay(
        JSON.stringify({ ...stored, checkOut: "2026-08-30" }),
        TODAY,
        SAVED_AT,
      ),
    ).toBeNull();
  });

  it("drops a plan or a room type the property does not sell", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));

    expect(
      decodeStay(JSON.stringify({ ...stored, plan: "FREE" }), TODAY, SAVED_AT),
    ).toBeNull();
    expect(
      decodeStay(
        JSON.stringify({ ...stored, roomType: "PENTHOUSE" }),
        TODAY,
        SAVED_AT,
      ),
    ).toBeNull();
  });
});

describe("a search somebody edited by hand", () => {
  // Anything at all can be written into a storage key, so what comes back is
  // bounded exactly as a typed search is — a party of nine restored out of here
  // would quote a stay the property has no room for.
  it("clamps a party to what the property can sleep", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));
    const restored = decodeStay(
      JSON.stringify({ ...stored, adults: 99, childAges: [40, 2, 2, 2, 2] }),
      TODAY,
      SAVED_AT,
    );

    expect(restored?.party.adults).toBe(4);
    expect(restored?.party.children).toEqual([
      { age: 11 },
      { age: 2 },
      { age: 2 },
    ]);
  });

  it("reads a party of the wrong shape as no party at all", () => {
    const stored = JSON.parse(encodeStay(A_SEARCH, SAVED_AT));
    const restored = decodeStay(
      JSON.stringify({ ...stored, adults: "two", childAges: "3,9" }),
      TODAY,
      SAVED_AT,
    );

    expect(restored?.party).toEqual({ adults: 2, children: [] });
  });
});
