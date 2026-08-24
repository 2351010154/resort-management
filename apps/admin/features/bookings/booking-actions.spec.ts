import { describe, expect, it } from "vitest";

import { visibleBookingActions } from "./booking-actions";

describe("visibleBookingActions", () => {
  it("keeps accountants read-only", () => {
    expect(visibleBookingActions("ACCOUNTANT", "CONFIRMED")).toEqual([]);
  });

  it.each(["RECEPTIONIST", "MANAGER", "ADMIN"] as const)(
    "offers offline confirmation to %s for a hold",
    (role) => expect(visibleBookingActions(role, "HELD")).toContain("confirm"),
  );

  it("reserves cancellation waiver for managers and admins", () => {
    expect(visibleBookingActions("RECEPTIONIST", "CONFIRMED")).not.toContain(
      "cancelWithWaiver",
    );
    expect(visibleBookingActions("MANAGER", "CONFIRMED")).toContain(
      "cancelWithWaiver",
    );
    expect(visibleBookingActions("ADMIN", "CONFIRMED")).toContain(
      "cancelWithWaiver",
    );
  });

  it("shows transition-specific actions", () => {
    expect(visibleBookingActions("MANAGER", "CONFIRMED")).toContain(
      "markNoShow",
    );
    expect(visibleBookingActions("MANAGER", "NO_SHOW")).toContain("reinstate");
    expect(visibleBookingActions("RECEPTIONIST", "CHECKED_IN")).toContain(
      "moveRoom",
    );
    expect(visibleBookingActions("RECEPTIONIST", "CANCELLED")).toEqual([]);
  });

  it("keeps manager-only late-arrival actions hidden from reception", () => {
    expect(visibleBookingActions("RECEPTIONIST", "CONFIRMED")).not.toContain(
      "markNoShow",
    );
    expect(visibleBookingActions("RECEPTIONIST", "NO_SHOW")).not.toContain(
      "reinstate",
    );
  });

  it("matches room and date operation states", () => {
    expect(visibleBookingActions("MANAGER", "HELD")).not.toContain(
      "extendStay",
    );
    expect(visibleBookingActions("MANAGER", "CONFIRMED")).not.toContain(
      "shortenStay",
    );
    expect(visibleBookingActions("MANAGER", "CHECKED_IN")).toEqual(
      expect.arrayContaining([
        "moveRoom",
        "changeRoomType",
        "extendStay",
        "shortenStay",
      ]),
    );
  });
});
