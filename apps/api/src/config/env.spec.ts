// The environment is where a wrong number is cheapest to catch. Everything
// below is about the money figures: two VAT rates, a service charge and the rule
// that decides what VAT is computed on. `property-and-tariff.md` §8 forbids the
// tree to carry any of them, and `FR-IDN-03` makes them data an `ADMIN` edits.
//
// A default would satisfy neither. It would let a deploy that configured
// nothing invoice at a figure no accountant has confirmed — `ASM-01` is answered
// from published sources only — and say nothing while doing it. So production
// must write them down and development is handed provisional ones, and these
// tests are what hold that line in place.
//
// Two VAT rates and not one, because statutory relief lapses back into a
// standard rate rather than into no rate. Production is refused without either,
// separately, so the message names the one that is missing.

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
  ADMIN_ORIGIN: "https://admin.mariva.test",
  // Deliberately not the provisional figures: a test that reused them could
  // not tell a value that was read from one that was assumed.
  STANDARD_VAT_RATE_BPS: "1100",
  REDUCED_VAT_RATE_BPS: "900",
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
    "STANDARD_VAT_RATE_BPS",
    "REDUCED_VAT_RATE_BPS",
    "SERVICE_CHARGE_RATE_BPS",
    "VAT_INCLUDES_SERVICE_CHARGE",
  ])("refuses to boot without %s", (key) => {
    expect(() => parseEnv(without({ ...PRODUCTION_BASE }, key))).toThrow(
      EnvValidationError,
    );
  });

  it("names the missing figure rather than failing generically", () => {
    expect(() =>
      parseEnv(without({ ...PRODUCTION_BASE }, "REDUCED_VAT_RATE_BPS")),
    ).toThrow(/REDUCED_VAT_RATE_BPS/);

    // Named separately from the reduced rate, because a deploy that supplied one
    // and not the other is the likely mistake and a single message covering both
    // would leave the operator guessing which they forgot.
    expect(() =>
      parseEnv(without({ ...PRODUCTION_BASE }, "STANDARD_VAT_RATE_BPS")),
    ).toThrow(/STANDARD_VAT_RATE_BPS/);
  });

  it("requires the standard rate even with no relief window in sight", () => {
    // It is the rate on every date the window does not cover, and with no window
    // set that is every date there is. A deploy that supplied only the reduced
    // rate would have no answer for any date at all.
    expect(() =>
      parseEnv(without({ ...PRODUCTION_BASE }, "STANDARD_VAT_RATE_BPS")),
    ).toThrow(EnvValidationError);
  });

  it("reads the figures it is given rather than any figure of its own", () => {
    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.STANDARD_VAT_RATE_BPS).toBe(1100);
    expect(env.REDUCED_VAT_RATE_BPS).toBe(900);
    expect(env.SERVICE_CHARGE_RATE_BPS).toBe(700);
    expect(env.VAT_INCLUDES_SERVICE_CHARGE).toBe(false);
  });
});

describe("the money figures outside production", () => {
  it("hands a developer provisional figures so an unconfigured database posts", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.STANDARD_VAT_RATE_BPS).toBe(1000);
    expect(env.REDUCED_VAT_RATE_BPS).toBe(800);
    expect(env.SERVICE_CHARGE_RATE_BPS).toBe(500);
    expect(env.VAT_INCLUDES_SERVICE_CHARGE).toBe(true);
  });

  it("still prefers a figure that was written down", () => {
    const env = parseEnv({
      ...DEVELOPMENT_BASE,
      STANDARD_VAT_RATE_BPS: "1100",
      REDUCED_VAT_RATE_BPS: "900",
    });

    expect(env.STANDARD_VAT_RATE_BPS).toBe(1100);
    expect(env.REDUCED_VAT_RATE_BPS).toBe(900);
  });

  it("refuses a rate outside the basis-points range wherever it runs", () => {
    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, REDUCED_VAT_RATE_BPS: "10001" }),
    ).toThrow(EnvValidationError);

    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, STANDARD_VAT_RATE_BPS: "10001" }),
    ).toThrow(EnvValidationError);
  });
});

describe("the VNPay terminal", () => {
  it("is not required, so a developer without a merchant account still boots", () => {
    // The whole reason the pair is optional. A terminal comes from VNPay's
    // onboarding, and requiring one at boot would stop every developer and
    // every CI runner from starting an API that mostly does other things.
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.VNPAY_TMN_CODE).toBeUndefined();
    expect(env.VNPAY_SECRET_KEY).toBeUndefined();
  });

  it("is not required in production either, since the flip is not this milestone", () => {
    // `prd-m6.md` scope decision 2 puts the switch to live credentials, and
    // gate `G2` behind it, with the guest funnel. A refusal here would assert
    // that a deployed property is already taking card payments.
    expect(() => parseEnv({ ...PRODUCTION_BASE })).not.toThrow();
  });

  it("refuses half of one", () => {
    // A terminal code with no secret signs nothing, and the failure arrives at
    // a checksum — on a payment a guest is waiting for, or on an IPN whose
    // signature never verifies, so money that moved is never posted.
    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, VNPAY_TMN_CODE: "MRVTEST1" }),
    ).toThrow(/VNPAY_TMN_CODE/);

    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, VNPAY_SECRET_KEY: "a-hash-secret" }),
    ).toThrow(/VNPAY_TMN_CODE/);
  });

  it("takes both together", () => {
    const env = parseEnv({
      ...DEVELOPMENT_BASE,
      VNPAY_TMN_CODE: "MRVTEST1",
      VNPAY_SECRET_KEY: "a-hash-secret",
    });

    expect(env.VNPAY_TMN_CODE).toBe("MRVTEST1");
    expect(env.VNPAY_SECRET_KEY).toBe("a-hash-secret");
  });

  it("points at the sandbox until somebody says otherwise", () => {
    // The wrong value is only safe in one direction: a production deploy still
    // on sandbox takes no money and is noticed at the first transaction, while
    // a staging deploy on production takes real money from whoever is testing.
    expect(parseEnv({ ...DEVELOPMENT_BASE }).VNPAY_SANDBOX).toBe(true);
    expect(
      parseEnv({ ...DEVELOPMENT_BASE, VNPAY_SANDBOX: "false" }).VNPAY_SANDBOX,
    ).toBe(false);
  });
});

describe("ADMIN_ORIGIN", () => {
  it("defaults to the admin app's fixed development port", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.ADMIN_ORIGIN).toBe("http://localhost:3002");
  });

  it("still prefers a value that was written down", () => {
    const env = parseEnv({
      ...DEVELOPMENT_BASE,
      ADMIN_ORIGIN: "https://admin.mariva.test",
    });

    expect(env.ADMIN_ORIGIN).toBe("https://admin.mariva.test");
  });

  it("refuses to boot in production without it", () => {
    // Unset, `main.ts` would build its CORS allow-list without the admin
    // console's origin, and every admin request would be rejected by the
    // browser before it left the CORS preflight.
    expect(() =>
      parseEnv(without({ ...PRODUCTION_BASE }, "ADMIN_ORIGIN")),
    ).toThrow(/ADMIN_ORIGIN/);
  });

  it("takes the production value it is given rather than the development default", () => {
    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.ADMIN_ORIGIN).toBe("https://admin.mariva.test");
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

  it("leaves it unset, which is a property claiming no relief period", () => {
    // Unset is not an unbounded window. `SystemConfigService` resolves every
    // date to the standard rate when neither end is named, so the reduced rate
    // sits in the row unused until somebody states the period it applies to.
    const env = parseEnv({ ...DEVELOPMENT_BASE });

    expect(env.REDUCED_VAT_FROM).toBeUndefined();
    expect(env.REDUCED_VAT_TO).toBeUndefined();
  });
});
