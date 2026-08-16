import { SEARCH_RESULT_LIMIT } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  type CreatedBooking,
  defaultStay,
  mayTakeBookings,
  type NewBookingFields,
  NO_SEARCH_FIELDS,
  newBookingInput,
  parseChildAges,
  type SearchFields,
  type SearchResults,
  type Stay,
  searchCriteria,
  stayList,
  todaysCriteria,
  walkInArrival,
} from "./booking-search";

/* The screen's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives: what
 * matters about `/` and `n` is where focus actually lands and which element the
 * press came from, and jsdom has no layout to answer that with. What is covered
 * instead is everything underneath the markup — which window "today" is, whether
 * what an operator typed is a search the contract will take, what a typed date
 * means against the property's day, which parties are bookings, who is offered a
 * creating control, and what a stay one request old looks like to the check-in
 * sequence.
 */

const TODAY = "2026-08-16";

function stay(over: Partial<Stay> = {}): Stay {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "BK-1000",
    state: "CONFIRMED",
    roomType: "DELUXE",
    checkIn: TODAY,
    checkOut: "2026-08-18",
    roomNumber: null,
    guestNames: [],
    ...over,
  };
}

function answer(bookings: Stay[]): SearchResults {
  return { scope: "everything", rooms: [], bookings, guests: [] };
}

function typed(over: Partial<SearchFields> = {}): SearchFields {
  return { ...NO_SEARCH_FIELDS, ...over };
}

function form(over: Partial<NewBookingFields> = {}): NewBookingFields {
  return {
    kind: "walk-in",
    roomType: "DELUXE",
    plan: "STANDARD",
    checkIn: TODAY,
    checkOut: "2026-08-17",
    adults: "2",
    childAges: "",
    contactName: "",
    contactEmail: "",
    ...over,
  };
}

describe("todaysCriteria", () => {
  it("asks for the one business day, half-open, so an arrival, an in-house stay and a departure all overlap it", () => {
    expect(todaysCriteria(TODAY)).toEqual({
      from: TODAY,
      to: "2026-08-17",
    });
  });

  it("narrows by no state, because a cancelled stay is one the desk still gets telephoned about", () => {
    expect(todaysCriteria(TODAY)).not.toHaveProperty("state");
  });
});

describe("searchCriteria", () => {
  it("refuses a search with nothing to go on, which is what the contract refuses", () => {
    const attempt = searchCriteria(typed(), TODAY);

    expect(attempt).toHaveProperty("problem");
  });

  it("carries a reference, trimmed", () => {
    expect(searchCriteria(typed({ reference: " bk-1042 " }), TODAY)).toEqual({
      criteria: { reference: "bk-1042" },
    });
  });

  it("carries a name and a telephone number together, which the API reads as an and", () => {
    expect(
      searchCriteria(typed({ guestName: "Hương", guestPhone: "0905" }), TODAY),
    ).toEqual({ criteria: { guestName: "Hương", guestPhone: "0905" } });
  });

  it("refuses a range with one end", () => {
    expect(searchCriteria(typed({ from: TODAY }), TODAY)).toHaveProperty(
      "problem",
    );
    expect(searchCriteria(typed({ to: TODAY }), TODAY)).toHaveProperty(
      "problem",
    );
  });

  it("refuses a date it cannot read rather than sending a guess", () => {
    expect(
      searchCriteria(typed({ from: "sometime march", to: TODAY }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses an end that does not fall after its start", () => {
    expect(
      searchCriteria(typed({ from: TODAY, to: TODAY }), TODAY),
    ).toHaveProperty("problem");
    expect(
      searchCriteria(typed({ from: TODAY, to: "2026-08-15" }), TODAY),
    ).toHaveProperty("problem");
  });

  it("reads the range the way an operator writes it, counted from the property's day", () => {
    expect(searchCriteria(typed({ from: "today", to: "+3d" }), TODAY)).toEqual({
      criteria: { from: TODAY, to: "2026-08-19" },
    });
  });

  it("reads a day-first written date", () => {
    expect(
      searchCriteria(typed({ from: "15/3/2027", to: "18/3/2027" }), TODAY),
    ).toEqual({ criteria: { from: "2027-03-15", to: "2027-03-18" } });
  });

  it("sends only the dimensions that were given", () => {
    expect(
      searchCriteria(
        typed({ reference: "BK-1", from: TODAY, to: "+1d" }),
        TODAY,
      ),
    ).toEqual({
      criteria: { reference: "BK-1", from: TODAY, to: "2026-08-17" },
    });
  });
});

describe("stayList", () => {
  it("answers null for a narrowed scope, which has no stays in it to list", () => {
    expect(stayList({ scope: "rooms", rooms: [] })).toBeNull();
  });

  it("orders by arrival, then by reference, so the list cannot move under the arrow keys", () => {
    const list = stayList(
      answer([
        stay({ id: "c", reference: "BK-3000", checkIn: "2026-08-18" }),
        stay({ id: "b", reference: "BK-2000", checkIn: TODAY }),
        stay({ id: "a", reference: "BK-1000", checkIn: TODAY }),
      ]),
    );

    expect(list?.stays.map((one) => one.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves every state in, because the screen is asked about stays rather than about a queue", () => {
    const list = stayList(
      answer([
        stay({ id: "a", state: "CANCELLED" }),
        stay({ id: "b", reference: "BK-2000", state: "CHECKED_IN" }),
      ]),
    );

    expect(list?.stays).toHaveLength(2);
  });

  it("says nothing was cut short when the answer is under the cap", () => {
    expect(stayList(answer([stay()]))?.truncated).toBe(false);
  });

  it("says a full answer was cut short, because there is no second page to ask for", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, at) =>
      stay({ id: `id-${at}`, reference: `BK-${at}` }),
    );

    expect(stayList(answer(full))?.truncated).toBe(true);
  });
});

describe("mayTakeBookings", () => {
  it("offers creation to the three roles the matrix grants booking.write", () => {
    expect(mayTakeBookings("RECEPTIONIST")).toBe(true);
    expect(mayTakeBookings("MANAGER")).toBe(true);
    expect(mayTakeBookings("ADMIN")).toBe(true);
  });

  it("offers the accountant none, because they read bookings and do not act on them", () => {
    expect(mayTakeBookings("ACCOUNTANT")).toBe(false);
  });

  it("offers the housekeeper none, who is not given this family at all", () => {
    expect(mayTakeBookings("HOUSEKEEPING")).toBe(false);
  });
});

describe("defaultStay", () => {
  it("opens on tonight, counted from the property's day and never from a clock", () => {
    expect(defaultStay(TODAY)).toEqual({
      checkIn: TODAY,
      checkOut: "2026-08-17",
    });
  });
});

describe("parseChildAges", () => {
  it("reads an empty field as a party of adults rather than as a mistake", () => {
    expect(parseChildAges("  ")).toEqual([]);
  });

  it("reads ages separated by commas or spaces", () => {
    expect(parseChildAges("5, 9")).toEqual([5, 9]);
    expect(parseChildAges("5 9")).toEqual([5, 9]);
  });

  it("keeps an infant, whose age is a real zero", () => {
    expect(parseChildAges("0")).toEqual([0]);
  });

  it("refuses the whole list when one entry is not a number, rather than dropping a head", () => {
    expect(parseChildAges("5, five")).toBeNull();
  });

  it("leaves the band to the contract, and reads an age above it as a number", () => {
    expect(parseChildAges("19")).toEqual([19]);
  });
});

describe("newBookingInput", () => {
  it("takes the stay as the contract states it, dates as YYYY-MM-DD", () => {
    expect(newBookingInput(form(), TODAY)).toEqual({
      input: {
        roomType: "DELUXE",
        plan: "STANDARD",
        checkIn: TODAY,
        checkOut: "2026-08-17",
        adults: 2,
        childAges: [],
      },
    });
  });

  it("reads the dates the way an operator writes them, from the property's day", () => {
    const attempt = newBookingInput(
      form({ checkIn: "tomorrow", checkOut: "+3d" }),
      TODAY,
    );

    expect(attempt).toEqual({
      input: expect.objectContaining({
        checkIn: "2026-08-17",
        checkOut: "2026-08-19",
      }),
    });
  });

  it("refuses a date it cannot read", () => {
    expect(
      newBookingInput(form({ checkIn: "next week" }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses a departure that does not fall after the arrival", () => {
    expect(
      newBookingInput(form({ checkIn: TODAY, checkOut: TODAY }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses a stay sold to nobody", () => {
    expect(newBookingInput(form({ adults: "0" }), TODAY)).toHaveProperty(
      "problem",
    );
    expect(newBookingInput(form({ adults: "" }), TODAY)).toHaveProperty(
      "problem",
    );
  });

  it("carries the children as ages, because three bands price them and a count cannot say which", () => {
    expect(
      newBookingInput(form({ adults: "2", childAges: "5, 9" }), TODAY),
    ).toEqual({
      input: expect.objectContaining({ adults: 2, childAges: [5, 9] }),
    });
  });

  it("refuses a party larger than one booking, in the contract's own words", () => {
    expect(
      newBookingInput(form({ adults: "9", childAges: "5, 9" }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses an age the contract does not price as a child's", () => {
    expect(newBookingInput(form({ childAges: "19" }), TODAY)).toHaveProperty(
      "problem",
    );
  });

  it("carries the contact the desk took, because this door is the only one that can", () => {
    expect(
      newBookingInput(
        form({
          kind: "phone",
          contactName: "  Đỗ Thị Lan  ",
          contactEmail: " lan@example.test ",
        }),
        TODAY,
      ),
    ).toEqual({
      input: expect.objectContaining({
        contactName: "Đỗ Thị Lan",
        contactEmail: "lan@example.test",
      }),
    });
  });

  it("sends no contact at all for a walk-in who gave none", () => {
    const attempt = newBookingInput(form(), TODAY);

    // Absent rather than empty: the contract refuses an empty name and an
    // address that is not one, and a guest at the counter has neither.
    expect(attempt).not.toHaveProperty("problem");
    expect("input" in attempt && attempt.input).not.toHaveProperty(
      "contactName",
    );
    expect("input" in attempt && attempt.input).not.toHaveProperty(
      "contactEmail",
    );
  });

  it("takes a walk-in's contact when the desk was given one", () => {
    expect(
      newBookingInput(
        form({
          contactName: "Trần Văn Hùng",
          contactEmail: "hung@example.test",
        }),
        TODAY,
      ),
    ).toEqual({
      input: expect.objectContaining({
        contactName: "Trần Văn Hùng",
        contactEmail: "hung@example.test",
      }),
    });
  });

  it("refuses a telephone booking with nobody to write to", () => {
    expect(newBookingInput(form({ kind: "phone" }), TODAY)).toHaveProperty(
      "problem",
    );
    expect(
      newBookingInput(form({ kind: "phone", contactName: "Lan" }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses half a contact on either path, because half of one is unusable", () => {
    expect(newBookingInput(form({ contactName: "Lan" }), TODAY)).toHaveProperty(
      "problem",
    );
    expect(
      newBookingInput(form({ contactEmail: "lan@example.test" }), TODAY),
    ).toHaveProperty("problem");
  });

  it("refuses an address the contract does not read as one", () => {
    expect(
      newBookingInput(
        form({
          kind: "phone",
          contactName: "Lan",
          contactEmail: "lan-at-home",
        }),
        TODAY,
      ),
    ).toHaveProperty("problem");
  });
});

describe("walkInArrival", () => {
  const taken: CreatedBooking = {
    id: "33333333-3333-4333-8333-333333333333",
    reference: "BK-9001",
    userId: null,
    contactEmail: null,
    contactName: null,
    state: "CONFIRMED",
    cancellationReason: null,
    roomType: "SUPERIOR",
    checkIn: TODAY,
    checkOut: "2026-08-17",
    plan: "STANDARD",
    adults: 2,
    childAges: [],
    stayTotalGross: 1_200_000n,
    holdExpiresAt: null,
  };

  it("hands the sequence the stay the search would have answered", () => {
    expect(walkInArrival(taken)).toEqual({
      id: taken.id,
      reference: "BK-9001",
      state: "CONFIRMED",
      roomType: "SUPERIOR",
      checkIn: TODAY,
      checkOut: "2026-08-17",
      roomNumber: null,
      guestNames: [],
    });
  });

  it("holds no room and names nobody, which is what a booking one request old is", () => {
    const arrival = walkInArrival(taken);

    expect(arrival.roomNumber).toBeNull();
    expect(arrival.guestNames).toEqual([]);
  });
});
