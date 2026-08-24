import { describe, expect, it } from "vitest";
import { roomClosureQuery } from "./inventory.js";

describe("roomClosureQuery", () => {
  it("accepts room and one-sided current/future overlap narrowing", () => {
    const query = roomClosureQuery.parse({
      roomNumber: "402",
      checkIn: "2026-08-24",
    });
    expect(query.roomNumber).toBe("402");
    expect(query.checkIn?.toString()).toBe("2026-08-24");
  });

  it("accepts a half-open overlap window", () => {
    expect(
      roomClosureQuery
        .parse({
          checkIn: "2026-08-24",
          checkOut: "2026-08-27",
        })
        .checkOut?.toString(),
    ).toBe("2026-08-27");
  });

  it("refuses an empty or backwards window", () => {
    expect(() =>
      roomClosureQuery.parse({
        checkIn: "2026-08-24",
        checkOut: "2026-08-24",
      }),
    ).toThrow("checkOut must fall after checkIn");
  });
});
