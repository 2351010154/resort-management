// One case per boundary of `booking-state-machine.md` §4's three check-in
// guards, and both sides of each ⚑ in §7.
//
// The room-ready suite walks `HOUSEKEEPING_STATUSES` rather than naming the
// statuses it cares about, for the reason `state-machine.spec.ts` walks §2's
// grid: a fifth status added to the tuple would otherwise be a status this file
// silently never asks about, and the default a guard gives an unconsidered value
// is precisely the thing worth a test.

import { parseDate } from "@internationalized/date";
import { type HousekeepingStatus, HOUSEKEEPING_STATUSES } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import type { RoomAssignmentRow } from "../../../database/schema/inventory.js";
import {
  type CheckInRefusal,
  validateArrivalWindow,
  validateRoomAssigned,
  validateRoomReady,
} from "./check-in.guard.js";

const ARRIVAL = parseDate("2026-08-14");
const DEPARTURE = parseDate("2026-08-17");

/** The refusal a guard threw, or `null` if it admitted the guest. */
function refusalOf(act: () => void): CheckInRefusal | null {
  try {
    act();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    const orpc = error as ORPCError<string, { code: CheckInRefusal }>;
    // Every one of §4's guards is a 409 — the state pair is legal and it is the
    // circumstances that refuse.
    expect(orpc.code).toBe("CONFLICT");
    return orpc.data.code;
  }
}

function window(businessDate: string, earlyCheckInEnabled = false) {
  return () =>
    validateArrivalWindow({
      businessDate: parseDate(businessDate),
      arrivalDate: ARRIVAL,
      departureDate: DEPARTURE,
      earlyCheckInEnabled,
    });
}

describe("the arrival window", () => {
  it("admits a guest on their arrival date", () => {
    expect(refusalOf(window("2026-08-14"))).toBeNull();
  });

  it("admits a guest arriving mid-stay", () => {
    expect(refusalOf(window("2026-08-15"))).toBeNull();
  });

  // The departure date is not a night sold, so this guest has nothing left to
  // occupy — but §4 draws the line *after* it, and the line is what is tested.
  it("admits a guest on their departure date", () => {
    expect(refusalOf(window("2026-08-17"))).toBeNull();
  });

  it("refuses the day before arrival", () => {
    expect(refusalOf(window("2026-08-13"))).toBe("ARRIVAL_WINDOW_EARLY");
  });

  it("refuses the day after departure", () => {
    expect(refusalOf(window("2026-08-18"))).toBe("ARRIVAL_WINDOW_LATE");
  });

  it("walks the calendar rather than the clock", () => {
    // A month boundary is not a special case for `CalendarDate.compare`, and a
    // guard comparing ISO strings or day-of-month numbers would fail here.
    expect(
      refusalOf(() =>
        validateArrivalWindow({
          businessDate: parseDate("2026-09-01"),
          arrivalDate: parseDate("2026-08-31"),
          departureDate: parseDate("2026-09-02"),
          earlyCheckInEnabled: false,
        }),
      ),
    ).toBeNull();
  });

  describe("with early check-in enabled — §7's first ⚑", () => {
    it("admits a guest before their arrival date", () => {
      expect(refusalOf(window("2026-08-13", true))).toBeNull();
    });

    // The flag relaxes one half of the window. §4 marks only the early side.
    it("still refuses one that has already departed", () => {
      expect(refusalOf(window("2026-08-18", true))).toBe("ARRIVAL_WINDOW_LATE");
    });
  });
});

describe("the room requirement", () => {
  const assignment: RoomAssignmentRow = {
    id: "8f2a5c1e-0000-4000-8000-000000000001",
    roomId: "8f2a5c1e-0000-4000-8000-000000000002",
    bookingId: "8f2a5c1e-0000-4000-8000-000000000003",
    checkInDate: ARRIVAL.toString(),
    checkOutDate: DEPARTURE.toString(),
    closureReason: null,
  };

  it("admits a booking that has a room", () => {
    expect(refusalOf(() => validateRoomAssigned(assignment))).toBeNull();
  });

  it("refuses one that has none", () => {
    expect(refusalOf(() => validateRoomAssigned(null))).toBe(
      "ROOM_NOT_ASSIGNED",
    );
  });
});

describe("the room-ready rule", () => {
  const READY: readonly HousekeepingStatus[] = ["CLEAN", "INSPECTED"];

  it.each(READY)("admits a guest into a %s room", (status) => {
    expect(refusalOf(() => validateRoomReady(status, false))).toBeNull();
  });

  it.each(HOUSEKEEPING_STATUSES.filter((s) => !READY.includes(s)))(
    "refuses a %s room",
    (status) => {
      expect(refusalOf(() => validateRoomReady(status, false))).toBe(
        "ROOM_NOT_READY",
      );
    },
  );

  describe("with dirty-room check-in enabled — §7's second ⚑", () => {
    it("admits a guest into a DIRTY room", () => {
      expect(refusalOf(() => validateRoomReady("DIRTY", true))).toBeNull();
    });

    // The flag answers §7's question, which is about a room that is merely not
    // cleaned yet. A room with a fault in it is a different decision nobody made.
    it("still refuses an OUT_OF_ORDER room", () => {
      expect(refusalOf(() => validateRoomReady("OUT_OF_ORDER", true))).toBe(
        "ROOM_NOT_READY",
      );
    });

    it.each(READY)("leaves a %s room admitted", (status) => {
      expect(refusalOf(() => validateRoomReady(status, true))).toBeNull();
    });
  });
});
