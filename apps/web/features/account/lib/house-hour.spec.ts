import { describe, expect, it } from "vitest";
import { houseLight, lightAt } from "./house-hour";

describe("lightAt", () => {
  it("cuts the day at first light, high sun, low sun and the lamps", () => {
    expect(lightAt(5 * 60 + 29)).toBe("lamplight");
    expect(lightAt(5 * 60 + 30)).toBe("morning");
    expect(lightAt(8 * 60 + 59)).toBe("morning");
    expect(lightAt(9 * 60)).toBe("daylight");
    expect(lightAt(15 * 60 + 29)).toBe("daylight");
    expect(lightAt(15 * 60 + 30)).toBe("golden");
    expect(lightAt(17 * 60 + 59)).toBe("golden");
    expect(lightAt(18 * 60)).toBe("lamplight");
  });

  it("keeps the previous night's lamps on past midnight", () => {
    expect(lightAt(0)).toBe("lamplight");
    expect(lightAt(23 * 60 + 59)).toBe("lamplight");
  });
});

describe("houseLight", () => {
  it("reads the property's clock, not the runtime's", () => {
    // 09:40 UTC is 16:40 in Nha Trang, which keeps UTC+7 all year.
    expect(houseLight(new Date("2026-10-08T09:40:00Z"))).toBe("golden");
    // 00:15 UTC is 07:15 there, and 13:30 UTC is 20:30.
    expect(houseLight(new Date("2026-10-08T00:15:00Z"))).toBe("morning");
    expect(houseLight(new Date("2026-10-08T13:30:00Z"))).toBe("lamplight");
  });

  it("reads midnight as the start of the day, not its end", () => {
    // 17:05 UTC is 00:05 in Nha Trang — still the night's lamplight.
    expect(houseLight(new Date("2026-10-08T17:05:00Z"))).toBe("lamplight");
  });
});
