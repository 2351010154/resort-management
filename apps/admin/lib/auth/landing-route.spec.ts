import { STAFF_ROLES } from "@mariva/shared";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANDING,
  LANDING_BY_ROLE,
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

  // Driven off the shared list rather than the five above. A sixth role added
  // to the contract already fails to compile — `LANDING_BY_ROLE` is a
  // `Record<StaffRole, string>` and would be missing a key — and this is the
  // same fact at runtime, for the case where the map is edited to satisfy the
  // compiler by pointing the new role at nothing in particular.
  it("gives every role the contract defines a destination of its own", () => {
    for (const role of STAFF_ROLES) {
      expect(LANDING_BY_ROLE[role]).toMatch(/^\//);
      expect(landingRouteFor(role)).toBe(LANDING_BY_ROLE[role]);
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

  // A URL parser strips these before it resolves, so each one below is
  // `//evil.example` by the time a router acts on it while looking like a
  // rooted path to any check that reads only the first two characters.
  it("refuses a destination smuggling a control character past the leading slash", () => {
    expect(safeReturnPath("/\n/evil.example")).toBeNull();
    expect(safeReturnPath("/\t/evil.example")).toBeNull();
    expect(safeReturnPath("/\r/evil.example")).toBeNull();
    expect(safeReturnPath("/\u0000/evil.example")).toBeNull();
    expect(safeReturnPath("/arrivals\n")).toBeNull();
  });

  // Returned as the parser resolved it, not as it arrived: what the caller
  // navigates to has to be the string that was judged, or the judgement was
  // about something else.
  it("hands back the resolved path, query and fragment", () => {
    expect(safeReturnPath("/arrivals/../payments?a=1#top")).toBe(
      "/payments?a=1#top",
    );
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
