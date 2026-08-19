import { SEARCH_RESULT_LIMIT } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import type { BoardRoom } from "@/features/housekeeping";

import {
  type Arrival,
  arrivalAfter,
  assignableRooms,
  CHECK_IN_STEPS,
  checkInRefusal,
  depositDue,
  type Folio,
  parseAmount,
  parseBirthDate,
  refusalSentence,
  refusalStep,
  roomRefusal,
  type SearchResults,
  sequenceSteps,
  stepAfter,
  todaysArrivals,
} from "./arrival-queue";

/* The queue's decisions, held to the rules the module states.
 *
 * Nothing here renders anything, for the reason `vitest.config.ts` gives: what
 * matters about the sequence's focus behaviour is where focus actually lands,
 * and jsdom has no layout to answer that with. What is covered instead is
 * everything underneath the markup — which stays are in the queue, which rooms
 * are offered, how many steps this arrival has, where the next row is, and what
 * an operator's keystrokes parse to.
 */

const TODAY = "2026-08-16";

function stay(over: Partial<Arrival> = {}): Arrival {
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

function answer(bookings: Arrival[]): SearchResults {
  return { scope: "everything", rooms: [], bookings, guests: [] };
}

function room(over: Partial<BoardRoom> = {}): BoardRoom {
  return {
    roomNumber: "201",
    floor: 2,
    roomType: "DELUXE",
    status: "CLEAN",
    isReady: true,
    isOccupied: false,
    note: null,
    updatedAt: null,
    updatedBy: null,
    ...over,
  };
}

function account(outstanding: bigint): Folio {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    bookingId: stay().id,
    state: "OPEN",
    openedAt: "2026-08-14T09:00:00.000Z",
    closedAt: null,
    summary: { charged: 2_000_000n, credited: 0n, outstanding },
    postings: [],
  };
}

describe("cutting today's queue out of the search", () => {
  it("keeps the confirmed stays arriving on the property's day", () => {
    const queue = todaysArrivals(
      answer([
        stay({ reference: "BK-1001" }),
        stay({ reference: "BK-1002", checkIn: "2026-08-17" }),
      ]),
      TODAY,
    );

    expect(queue?.arrivals.map((one) => one.reference)).toEqual(["BK-1001"]);
  });

  it("drops a stay somebody has already checked in", () => {
    // The answer is shared with the dashboard's count and read from the cache
    // while a refetch is in flight, so a stay a colleague admitted seconds ago
    // can still be in it.
    const queue = todaysArrivals(
      answer([stay({ state: "CHECKED_IN" }), stay({ reference: "BK-1003" })]),
      TODAY,
    );

    expect(queue?.arrivals.map((one) => one.reference)).toEqual(["BK-1003"]);
  });

  it("drops a confirmed stay that arrived on an earlier day", () => {
    // Still occupying today, so the search returns it; a no-show for the night
    // audit rather than somebody at the counter.
    const queue = todaysArrivals(
      answer([stay({ checkIn: "2026-08-14", checkOut: "2026-08-20" })]),
      TODAY,
    );

    expect(queue?.arrivals).toEqual([]);
  });

  it("orders the queue by reference so it cannot move between two presses", () => {
    const queue = todaysArrivals(
      answer([
        stay({ reference: "BK-1009" }),
        stay({ reference: "BK-1002" }),
        stay({ reference: "BK-1005" }),
      ]),
      TODAY,
    );

    expect(queue?.arrivals.map((one) => one.reference)).toEqual([
      "BK-1002",
      "BK-1005",
      "BK-1009",
    ]);
  });

  it("says when the search answered its own ceiling", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_unused, at) =>
      stay({ reference: `BK-${2000 + at}` }),
    );

    expect(todaysArrivals(answer(full), TODAY)?.truncated).toBe(true);
    expect(todaysArrivals(answer(full.slice(1)), TODAY)?.truncated).toBe(false);
  });

  it("answers null rather than an empty queue for a narrowed scope", () => {
    // A `rooms`-scoped answer contains no stays at all. "Nobody is arriving" is
    // a different and false statement.
    expect(todaysArrivals({ scope: "rooms", rooms: [] }, TODAY)).toBeNull();
  });
});

describe("where focus goes when a row is finished", () => {
  const queue = [
    stay({ id: "a", reference: "BK-1" }),
    stay({ id: "b", reference: "BK-2" }),
    stay({ id: "c", reference: "BK-3" }),
  ];

  it("advances to the next arrival", () => {
    expect(arrivalAfter(queue, "b")).toBe("c");
  });

  it("falls back to the previous one at the end of the queue", () => {
    expect(arrivalAfter(queue, "c")).toBe("b");
  });

  it("answers null when the queue is emptied", () => {
    expect(arrivalAfter([stay({ id: "a" })], "a")).toBeNull();
    expect(arrivalAfter([], "a")).toBeNull();
  });

  it("falls back to the head when the row is no longer in the queue", () => {
    expect(arrivalAfter(queue, "gone")).toBe("a");
  });
});

describe("the rooms a stay may be walked into", () => {
  const rooms = [
    room({ roomNumber: "201" }),
    room({ roomNumber: "202", isReady: false, status: "DIRTY" }),
    room({ roomNumber: "203", isOccupied: true }),
    room({ roomNumber: "204", roomType: "SUPERIOR" }),
    room({ roomNumber: "210" }),
    room({ roomNumber: "21", floor: 2 }),
  ];

  const nothingRefused: ReadonlySet<string> = new Set();

  it("offers only ready, empty rooms of the type the stay was sold", () => {
    expect(
      assignableRooms(rooms, "DELUXE", "", nothingRefused).map(
        (one) => one.roomNumber,
      ),
    ).toEqual(["21", "201", "210"]);
  });

  it("narrows on a typed fragment anywhere in the number", () => {
    expect(
      assignableRooms(rooms, "DELUXE", "01", nothingRefused).map(
        (one) => one.roomNumber,
      ),
    ).toEqual(["201"]);
  });

  it("offers nothing when the property has no ready room of that type", () => {
    expect(assignableRooms(rooms, "PREMIER", "", nothingRefused)).toEqual([]);
  });

  it("drops a room the API has already refused for this stay", () => {
    // The board answers tonight — clean, nobody in it — while the API refuses
    // across every night the stay covers, so a room taken by a booking that
    // arrives tomorrow looks free here and is not. Once it has been refused,
    // offering it again buys the same refusal.
    expect(
      assignableRooms(rooms, "DELUXE", "", new Set(["201"])).map(
        (one) => one.roomNumber,
      ),
    ).toEqual(["21", "210"]);
  });

  it("empties the list once every ready room has been refused", () => {
    expect(
      assignableRooms(rooms, "DELUXE", "", new Set(["21", "201", "210"])),
    ).toEqual([]);
  });

  it("keeps a refused room out of a narrowed list too", () => {
    expect(
      assignableRooms(rooms, "DELUXE", "21", new Set(["210"])).map(
        (one) => one.roomNumber,
      ),
    ).toEqual(["21"]);
  });
});

describe("reading a refused room assignment", () => {
  it("takes a held room off the list and names picking another", () => {
    // `booking.assignRoom` declares no errors, so the exclusion constraint
    // arrives as an undefined conflict carrying only a status and a sentence.
    const refusal = roomRefusal(
      {
        defined: false,
        code: "CONFLICT",
        status: 409,
        message:
          "Room 501 is already held across part of 2026-08-17 to 2026-08-20",
      },
      "501",
    );

    expect(refusal.spokenFor).toBe(true);
    expect(refusal.sentence).toContain("501");
    expect(refusal.sentence).toContain("pick another");
  });

  it("leaves the room on the list for anything that is not a hold", () => {
    // A room housekeeping soiled a moment ago, or a request that never landed:
    // pressing again is a reasonable thing for the operator to do with either.
    expect(roomRefusal({ status: 422 }, "204").spokenFor).toBe(false);
    expect(roomRefusal(new Error("network"), "204").spokenFor).toBe(false);
    expect(roomRefusal(undefined, "204").spokenFor).toBe(false);
  });

  it("names the room in every sentence, so the operator knows which press", () => {
    for (const error of [{ status: 409 }, { status: 500 }, null]) {
      expect(roomRefusal(error, "308").sentence).toContain("308");
    }
  });
});

describe("the deposit the sequence offers", () => {
  it("is the account's own outstanding balance", () => {
    expect(depositDue(account(1_500_000n))).toBe(1_500_000n);
  });

  it("is nothing on a settled stay", () => {
    expect(depositDue(account(0n))).toBe(0n);
  });

  it("is nothing on an over-paid stay, because that is a refund", () => {
    expect(depositDue(account(-200_000n))).toBe(0n);
  });
});

describe("the steps this arrival has", () => {
  it("asks for the document at every arrival, whoever is standing there", () => {
    // It used to be dropped for a guest the property already held, on the
    // reasoning that their particulars were taken last time. A second occupant
    // registered on somebody else's word has a name and nothing else, and
    // check-in names them by id ever after — so the step being skipped was the
    // only place their record could have been filled in.
    expect(sequenceSteps({ depositDue: true })).toEqual([
      "guest",
      "identity",
      "room",
      "deposit",
      "review",
    ]);
  });

  it("drops the deposit step on a settled stay", () => {
    expect(sequenceSteps({ depositDue: false })).toEqual([
      "guest",
      "identity",
      "room",
      "review",
    ]);
  });

  it("always names somebody and always assigns a room", () => {
    for (const dueDeposit of [true, false]) {
      const steps = sequenceSteps({ depositDue: dueDeposit });

      expect(steps).toContain("guest");
      expect(steps).toContain("room");
      expect(steps.at(-1)).toBe("review");
    }
  });

  it("walks the steps in the order they are declared", () => {
    const steps = sequenceSteps({ depositDue: true });

    expect(steps).toEqual([...CHECK_IN_STEPS]);
    expect(stepAfter(steps, "guest")).toBe("identity");
    expect(stepAfter(steps, "review")).toBeNull();
    expect(stepAfter(sequenceSteps({ depositDue: false }), "room")).toBe(
      "review",
    );
  });

  it("goes on past a step the answer to it removed", () => {
    // The deposit is posted, which settles the account and drops the step that
    // was just answered. What follows it is still the review.
    expect(stepAfter(sequenceSteps({ depositDue: false }), "deposit")).toBe(
      "review",
    );
  });
});

describe("reading a refused check-in", () => {
  it("finds the contract's code on the error's data", () => {
    expect(checkInRefusal({ data: { code: "ROOM_NOT_READY" } })).toBe(
      "ROOM_NOT_READY",
    );
  });

  it("answers null for anything that is not one of the five", () => {
    expect(checkInRefusal({ data: { code: "SOMETHING_ELSE" } })).toBeNull();
    expect(checkInRefusal({ data: null })).toBeNull();
    expect(checkInRefusal(new Error("network"))).toBeNull();
    expect(checkInRefusal(undefined)).toBeNull();
  });

  it("sends the room refusals back to the assignment control", () => {
    expect(refusalStep("ROOM_NOT_ASSIGNED")).toBe("room");
    expect(refusalStep("ROOM_NOT_READY")).toBe("room");
    expect(refusalStep("ROOM_OUT_OF_ORDER")).toBe("room");
  });

  it("keeps the window refusals on the review step, where the sentence is", () => {
    expect(refusalStep("ARRIVAL_WINDOW_EARLY")).toBe("review");
    expect(refusalStep("ARRIVAL_WINDOW_LATE")).toBe("review");
  });

  it("names an act in every sentence", () => {
    for (const code of [
      "ARRIVAL_WINDOW_EARLY",
      "ARRIVAL_WINDOW_LATE",
      "ROOM_NOT_ASSIGNED",
      "ROOM_NOT_READY",
      "ROOM_OUT_OF_ORDER",
    ] as const) {
      expect(refusalSentence(code).length).toBeGreaterThan(0);
    }
  });
});

describe("what an operator types", () => {
  it("reads an amount with the separators the screen printed", () => {
    expect(parseAmount("1500000")).toBe(1_500_000n);
    expect(parseAmount("1.500.000")).toBe(1_500_000n);
    expect(parseAmount(" 1 500 000 ")).toBe(1_500_000n);
  });

  it("refuses an amount that is not money handed over", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-1000")).toBeNull();
    // A comma is vi-VN's decimal mark, and đồng has no minor unit — reading it
    // as a grouping mark would post a hundredfold of what was typed.
    expect(parseAmount("1500,50")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("a lot")).toBeNull();
  });

  it("reads a birth date only in the unambiguous spelling", () => {
    expect(parseBirthDate("1985-03-15")).toBe("1985-03-15");
    expect(parseBirthDate(" 1985-03-15 ")).toBe("1985-03-15");
    expect(parseBirthDate("15/03/1985")).toBeNull();
    expect(parseBirthDate("85-03-15")).toBeNull();
  });

  it("refuses a day that is not on the calendar", () => {
    expect(parseBirthDate("1990-02-30")).toBeNull();
    expect(parseBirthDate("1990-13-01")).toBeNull();
    expect(parseBirthDate("1992-02-29")).toBe("1992-02-29");
  });
});
