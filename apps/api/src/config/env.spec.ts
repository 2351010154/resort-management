// The environment is where a wrong number is cheapest to catch. Everything
// below is about the three money figures: a rate, a service charge and the rule
// that decides what VAT is computed on. `property-and-tariff.md` §8 forbids the
// tree to carry any of them, and `FR-IDN-03` makes them data an `ADMIN` edits.
//
// A default would satisfy neither. It would let a deploy that configured
// nothing invoice at a figure the accountant has not answered for — `ASM-01` is
// still open — and say nothing while doing it. So production must write them
// down and development is handed provisional ones, and these tests are what
// hold that line in place.

import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

// Everything a production boot needs *besides* the figures under test, so a
// failure below is about the figure and not about the fixture.
const PRODUCTION_BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
  RESEND_API_KEY: "re_test",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  // Deliberately not the provisional figures: a test that reused them could
  // not tell a value that was read from one that was assumed.
  VAT_RATE_BPS: "1000",
  SERVICE_CHARGE_RATE_BPS: "700",
  VAT_INCLUDES_SERVICE_CHARGE: "false",
} as const;

const DEVELOPMENT_BASE = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
} as const;

/** The fixture minus one variable, which is the case each test is about. */
function without(
  source: Record<string, string>,
  key: string,
): Record<string, string> {
  const { [key]: _removed, ...rest } = source;

  return rest;
}

describe("the money figures in production", () => {
  it.each([
    "VAT_RATE_BPS",
    "SERVICE_CHARGE_RATE_BPS",
    "VAT_INCLUDES_SERVICE_CHARGE",
  ])("refuses to boot without %s", (key) => {
    expect(() => parseEnv(without({ ...PRODUCTION_BASE }, key))).toThrow(
      EnvValidationError,
    );
  });

  it("names the missing figure rather than failing generically", () => {
    expect(() =>
      parseEnv(without({ ...PRODUCTION_BASE }, "VAT_RATE_BPS")),
    ).toThrow(/VAT_RATE_BPS/);
  });

  it("reads the figures it is given rather than any figure of its own", () => {
    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.VAT_RATE_BPS).toBe(1000);
    expect(env.SERVICE_CHARGE_RATE_BPS).toBe(700);
    expect(env.VAT_INCLUDES_SERVICE_CHARGE).toBe(false);
  });
});

describe("the money figures outside production", () => {
  it("hands a developer provisional figures so an unconfigured database posts", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.VAT_RATE_BPS).toBe(800);
    expect(env.SERVICE_CHARGE_RATE_BPS).toBe(500);
    expect(env.VAT_INCLUDES_SERVICE_CHARGE).toBe(true);
  });

  it("still prefers a figure that was written down", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE, VAT_RATE_BPS: "1000" });

    expect(env.VAT_RATE_BPS).toBe(1000);
  });

  it("refuses a rate outside the basis-points range wherever it runs", () => {
    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, VAT_RATE_BPS: "10001" }),
    ).toThrow(EnvValidationError);
  });
});

describe("the reduced-VAT window", () => {
  it("refuses one that closes before it opens", () => {
    expect(() =>
      parseEnv({
        ...DEVELOPMENT_BASE,
        REDUCED_VAT_FROM: "2026-12-31",
        REDUCED_VAT_TO: "2026-01-01",
      }),
    ).toThrow(/REDUCED_VAT_TO/);
  });

  it("leaves it unset, which is one rate covering every date", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.REDUCED_VAT_FROM).toBeUndefined();
    expect(env.REDUCED_VAT_TO).toBeUndefined();
  });
});
