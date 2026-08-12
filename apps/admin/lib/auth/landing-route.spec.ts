import { STAFF_ROLES } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANDING,
  landingRouteFor,
  loginHref,
  safeReturnPath,
} from "./landing-route";

describe("landingRouteFor", () => {
  it("starts each role where its work starts", () => {
    expect(landingRouteFor("RECEPTIONIST")).toBe("/dashboard");
    expect(landingRouteFor("MANAGER")).toBe("/dashboard");
    expect(landingRouteFor("ADMIN")).toBe("/dashboard");
    expect(landingRouteFor("HOUSEKEEPING")).toBe("/housekeeping");
    expect(landingRouteFor("ACCOUNTANT")).toBe("/payments");
  });

  // Driven off the shared list rather than the five above, so a sixth role
  // added to the contract is a failure here rather than an operator landing
  // somewhere nobody chose.
  it("has a destination for every role the contract defines", () => {
    for (const role of STAFF_ROLES) {
      expect(landingRouteFor(role)).toMatch(/^\//);
    }
  });

  it("sends a role it has never heard of to the console's general entrance", () => {
    expect(landingRouteFor("NIGHT_AUDITOR")).toBe(DEFAULT_LANDING);
    expect(landingRouteFor("")).toBe(DEFAULT_LANDING);
  });
});

describe("safeReturnPath", () => {
  it("keeps a path on this origin", () => {
    expect(safeReturnPath("/arrivals?date=2026-03-15")).toBe(
      "/arrivals?date=2026-03-15",
    );
  });

  it("refuses anything that could leave this origin", () => {
    expect(safeReturnPath("//evil.example/arrivals")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("arrivals")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });
});

describe("loginHref", () => {
  it("carries the interrupted destination, encoded", () => {
    expect(loginHref("/arrivals?date=2026-03-15")).toBe(
      "/login?next=%2Farrivals%3Fdate%3D2026-03-15",
    );
  });

  it("carries nothing when there was no destination, or an unsafe one", () => {
    expect(loginHref(null)).toBe("/login");
    expect(loginHref("//evil.example")).toBe("/login");
  });
});
