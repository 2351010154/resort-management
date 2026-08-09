import { parseDate } from "@internationalized/date";
import type { NightRate, RoomTypeCode, VndAmount } from "@mariva/shared";
import { describe, expect, it } from "vitest";
import { ROOM_TYPES, roomType } from "./room-types";
import {
  indexNights,
  nightsInRange,
  occupancyFit,
  type Party,
  partitionRoomTypes,
  quoteStay,
  type TariffRates,
} from "./stay-quote";

// Round numbers, so an assertion reads as the rule it is checking rather than as
// arithmetic. The real fixture's weekend uplift is deliberately not used here —
// these tests are about property-and-tariff.md §3, not about the stand-in data.
const RATES: TariffRates = {
  extraPersonPerNight: 600_000n,
  breakfastPerPersonPerNight: 250_000n,
};

const ROOM_GROSS = 2_000_000n;

function freeNight(iso: string): NightRate {
  return {
    date: parseDate(iso),
    lowestGross: ROOM_GROSS,
    isSoldOut: false,
    isClosedToArrival: false,
    minimumStay: 1,
  };
}

/** Every type's offer for the range, all five priced off the same night rate. */
function quoteAll(
  party: Party,
  plan: "STANDARD" | "BB" | "NONREF",
  checkIn = "2026-08-10",
  checkOut = "2026-08-12",
) {
  const range = { checkIn: parseDate(checkIn), checkOut: parseDate(checkOut) };
  const nights = nightsInRange(range);
  const perType = new Map(
    nights.map((date) => [date.toString(), ROOM_GROSS as VndAmount]),
  );

  const offers = quoteStay({
    range,
    party,
    plan,
    rates: RATES,
    roomRates: new Map<RoomTypeCode, Map<string, VndAmount>>([
      ["SUPERIOR", perType],
      ["DELUXE", perType],
      ["PREMIER", perType],
      ["JUNIOR_SUITE", perType],
      ["PANORAMA_SUITE", perType],
    ]),
    nights: indexNights(nights.map((d) => freeNight(d.toString()))),
    soldOutTypes: new Set(),
  });

  return offers;
}

/** The one offer the plan-arithmetic assertions read. */
function quote(
  party: Party,
  plan: "STANDARD" | "BB" | "NONREF",
  checkIn?: string,
  checkOut?: string,
) {
  return quoteAll(party, plan, checkIn, checkOut).find(
    (offer) => offer.code === "PANORAMA_SUITE",
  )!;
}

const couple: Party = { adults: 2, children: [] };

describe("plan arithmetic", () => {
  it("charges the rate-calendar price on STANDARD", () => {
    expect(quote(couple, "STANDARD").stayTotalGross).toBe(4_000_000n);
  });

  // §3: NONREF is STANDARD − 10%.
  it("takes 10% off the room on NONREF", () => {
    expect(quote(couple, "NONREF").stayTotalGross).toBe(3_600_000n);
  });

  // §3: BB is STANDARD + breakfast for the booked occupancy, and breakfast posts as
  // its own folio line — so the discount and the breakfast are about different
  // things and must not compound.
  it("adds breakfast per person per night on BB", () => {
    expect(quote(couple, "BB").stayTotalGross).toBe(
      4_000_000n + 250_000n * 2n * 2n,
    );
  });

  it("discounts the room but not the extra person", () => {
    const three: Party = { adults: 3, children: [] };
    const room = (2_000_000n * 9n) / 10n;

    expect(quote(three, "NONREF").stayTotalGross).toBe((room + 600_000n) * 2n);
  });
});

describe("the child bands", () => {
  // §3: under 6 free, 6–11 half the extra-person rate, 12+ as an adult. The bands
  // apply to whoever is beyond the included occupancy of two.
  it("charges nothing for a party inside the included occupancy", () => {
    const withBaby: Party = { adults: 2, children: [{ age: 3 }] };

    // Three heads, but the under-6 takes the extra slot and costs nothing.
    expect(quote(withBaby, "STANDARD").stayTotalGross).toBe(4_000_000n);
  });

  it("charges a 6-to-11 child at half the extra-person rate", () => {
    const withChild: Party = { adults: 2, children: [{ age: 9 }] };

    expect(quote(withChild, "STANDARD").stayTotalGross).toBe(
      (2_000_000n + 300_000n) * 2n,
    );
  });

  it("charges a 12-year-old as an adult", () => {
    const withTeen: Party = { adults: 2, children: [{ age: 12 }] };

    expect(quote(withTeen, "STANDARD").stayTotalGross).toBe(
      (2_000_000n + 600_000n) * 2n,
    );
  });

  // The cheapest heads fill the extra slots, so a family is not charged as if the
  // adults were the ones outside the rate.
  it("puts the cheapest heads in the extra slots", () => {
    const family: Party = { adults: 2, children: [{ age: 3 }, { age: 9 }] };

    // Four heads, two beyond the included occupancy: the 3-year-old is free and the
    // 9-year-old is half. Never two adults at full rate.
    expect(quote(family, "STANDARD").stayTotalGross).toBe(
      (2_000_000n + 300_000n) * 2n,
    );
  });

  it("does not charge breakfast for an under-6", () => {
    const withBaby: Party = { adults: 2, children: [{ age: 3 }] };

    expect(quote(withBaby, "BB").stayTotalGross).toBe(
      4_000_000n + 250_000n * 2n * 2n,
    );
  });
});

describe("the two figures on a card", () => {
  it("reports the stay total as the un-rounded sum", () => {
    const offer = quote(couple, "STANDARD", "2026-08-10", "2026-08-13");

    expect(offer.stayTotalGross).toBe(6_000_000n);
  });

  // The per-night figure is an average and is display-only. The total is what
  // settles, so a truncated đồng in the average must never reach it.
  it("keeps the total authoritative when the average does not divide", () => {
    const odd: Party = { adults: 2, children: [{ age: 9 }] };
    const offer = quote(odd, "STANDARD", "2026-08-10", "2026-08-13");

    expect(offer.stayTotalGross).toBe((2_000_000n + 300_000n) * 3n);
    expect(offer.perNightGross).toBe(2_300_000n);
  });
});

describe("occupancy is a fit test, not a filter", () => {
  it("fits a party inside the maximum", () => {
    expect(
      occupancyFit(roomType("PREMIER"), { adults: 3, children: [] }),
    ).toEqual({
      fits: true,
    });
  });

  // §3: occupancy above the maximum is a rejection, not a price. The card still
  // renders — hiding it makes the guest think the hotel has no such room.
  it("says who a room sleeps and how many are asking", () => {
    const fit = occupancyFit(roomType("SUPERIOR"), { adults: 3, children: [] });

    expect(fit).toEqual({ fits: false, reason: "Sleeps 2. You are 3." });
  });

  it("counts children toward the maximum", () => {
    const fit = occupancyFit(roomType("SUPERIOR"), {
      adults: 2,
      children: [{ age: 4 }],
    });

    expect(fit.fits).toBe(false);
  });
});

describe("the extra bed", () => {
  // §1 makes a required bed free, so a quote has nothing to say about one. How
  // many beds a party requires is `bedsRequired` in `@mariva/shared`, tested
  // beside the bands the API prices against; what belongs here is that no offer
  // this file builds carries a bed price for the funnel to print.
  it("never puts a price on an offer, on any type", () => {
    const offers = quoteAll({ adults: 3, children: [] }, "STANDARD");

    expect(offers).toHaveLength(5);
    for (const offer of offers) {
      expect(offer).not.toHaveProperty("extraBedPerNightGross");
    }
  });

  it("does not make a party of three cost more on a type that needs one", () => {
    // The Junior Suite is the one type §1's rule can fire on. Its third head is
    // priced by §3's band and by nothing else, so the difference between it and
    // the Premier — which sleeps three in beds it already has — is the room
    // rate, and here the fixture gives both the same one.
    const offers = quoteAll({ adults: 3, children: [] }, "STANDARD");
    const byCode = new Map(offers.map((offer) => [offer.code, offer]));

    expect(byCode.get("JUNIOR_SUITE")?.stayTotalGross).toBe(
      byCode.get("PREMIER")?.stayTotalGross,
    );
  });
});

describe("nights of a range", () => {
  // The half-open convention: the departure date is not a night sold. This is the
  // off-by-one the whole calendar is built around.
  it("excludes the departure date", () => {
    const nights = nightsInRange({
      checkIn: parseDate("2026-08-10"),
      checkOut: parseDate("2026-08-12"),
    });

    expect(nights.map((d) => d.toString())).toEqual([
      "2026-08-10",
      "2026-08-11",
    ]);
  });
});

describe("the partition into cards and demoted rows", () => {
  /** An offer per type, with only the named codes free for the range. */
  function offering(...free: RoomTypeCode[]) {
    return ROOM_TYPES.map((type) => ({
      code: type.code,
      perNightGross: ROOM_GROSS,
      stayTotalGross: ROOM_GROSS,
      isAvailable: free.includes(type.code),
    }));
  }

  const two: Party = { adults: 2, children: [] };
  const three: Party = { adults: 3, children: [] };

  it("gives a card to what is free and fits, and a row to the rest", () => {
    const { takeable, soldOut, tooSmall } = partitionRoomTypes(
      offering("SUPERIOR", "PREMIER", "PANORAMA_SUITE"),
      two,
    );

    expect(takeable.map((type) => type.code)).toEqual([
      "SUPERIOR",
      "PREMIER",
      "PANORAMA_SUITE",
    ]);
    expect(soldOut.map((type) => type.code)).toEqual([
      "DELUXE",
      "JUNIOR_SUITE",
    ]);
    expect(tooSmall).toEqual([]);
  });

  it("demotes a type the party does not fit even when it is free", () => {
    const { takeable, tooSmall } = partitionRoomTypes(
      offering(...ROOM_TYPES.map((type) => type.code)),
      three,
    );

    // Superior and Deluxe both sleep two.
    expect(tooSmall.map((type) => type.code)).toEqual(["SUPERIOR", "DELUXE"]);
    expect(takeable.map((type) => type.code)).toEqual([
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("calls a type too small before it calls it sold out", () => {
    // Both true at once. "Not free for these nights" invites the guest to move
    // their dates, and moving the dates cannot make a room sleep three.
    const { soldOut, tooSmall } = partitionRoomTypes(offering(), three);

    expect(tooSmall.map((type) => type.code)).toEqual(["SUPERIOR", "DELUXE"]);
    expect(soldOut.map((type) => type.code)).toEqual([
      "PREMIER",
      "JUNIOR_SUITE",
      "PANORAMA_SUITE",
    ]);
  });

  it("loses no type, whatever the search", () => {
    const { takeable, soldOut, tooSmall } = partitionRoomTypes(
      offering("JUNIOR_SUITE"),
      three,
    );

    // Hiding a type makes the guest think the hotel does not have that room.
    expect(takeable.length + soldOut.length + tooSmall.length).toBe(
      ROOM_TYPES.length,
    );
  });

  it("leaves nothing takeable when the party fits nothing free", () => {
    // This is what sends the view to `NoAvailability` rather than to a column of
    // caps-labelled lines.
    expect(partitionRoomTypes(offering("SUPERIOR"), three).takeable).toEqual(
      [],
    );
  });

  it("keeps ROOM_TYPES' order inside each group", () => {
    const { soldOut } = partitionRoomTypes(offering("PREMIER"), two);
    const order = ROOM_TYPES.map((type) => type.code);

    const positions = soldOut.map((type) => order.indexOf(type.code));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
