// What a production boot is allowed to say about the PayPal gateway, mirroring
// the VNPay checks in `env-vnpay-production.spec.ts` — the same failure, in a
// gateway whose sandbox signs and answers exactly like the live one.
//
// One rule is PayPal-specific: the trio of credentials is all-or-nothing
// rather than the pair VNPay carries, because verification is a call to
// PayPal naming the webhook id and a deployment with the client credentials
// but not that id could open an order it can never confirm.

import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

// Everything a production boot needs *besides* the PayPal variables under
// test, so a failure below is about PayPal and not about the fixture.
const PRODUCTION_BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
  RESEND_API_KEY: "re_test",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  ADMIN_ORIGIN: "https://admin.mariva.test",
  TRUSTED_CLIENT_IP_HEADER: "fly-client-ip",
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

// The full trio and the one production a live client obliges the deploy to
// have: the sandbox switched off.
const LIVE_CREDENTIALS = {
  PAYPAL_CLIENT_ID: "live-client-id",
  PAYPAL_CLIENT_SECRET: "live-client-secret",
  PAYPAL_WEBHOOK_ID: "WH-live-webhook-id",
  PAYPAL_SANDBOX: "false",
} as const;

const SANDBOX_CREDENTIALS = {
  PAYPAL_CLIENT_ID: "sandbox-client-id",
  PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_WEBHOOK_ID: "WH-sandbox-webhook-id",
} as const;

describe("PayPal's credential trio", () => {
  it.each([
    ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"],
    ["PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_CLIENT_ID"],
    ["PAYPAL_WEBHOOK_ID", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  ])("refuses one of the three set alone, naming all three", (only) => {
    expect(() =>
      parseEnv({
        ...DEVELOPMENT_BASE,
        [only]: "just-one-value",
      }),
    ).toThrow(
      /PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID are set together, or none of them is/,
    );
  });

  it("refuses two of the three, naming all three", () => {
    const { PAYPAL_WEBHOOK_ID: _unset, ...twoOfThree } = SANDBOX_CREDENTIALS;

    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, ...twoOfThree }),
    ).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({ ...DEVELOPMENT_BASE, ...twoOfThree }),
    ).toThrow(/PAYPAL_WEBHOOK_ID/);
  });

  it("refuses the partial trio in production too, not just in development", () => {
    const { PAYPAL_CLIENT_SECRET: _unset, ...twoOfThree } = LIVE_CREDENTIALS;

    expect(() =>
      parseEnv({ ...PRODUCTION_BASE, ...twoOfThree }),
    ).toThrow(EnvValidationError);
  });

  it("takes all three together", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE, ...SANDBOX_CREDENTIALS });

    expect(env.PAYPAL_CLIENT_ID).toBe("sandbox-client-id");
    expect(env.PAYPAL_CLIENT_SECRET).toBe("sandbox-client-secret");
    expect(env.PAYPAL_WEBHOOK_ID).toBe("WH-sandbox-webhook-id");
  });

  it("is not required at all, so a property that has not onboarded PayPal still boots", () => {
    expect(() => parseEnv({ ...PRODUCTION_BASE })).not.toThrow();
    expect(() => parseEnv({ ...DEVELOPMENT_BASE })).not.toThrow();

    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.PAYPAL_CLIENT_ID).toBeUndefined();
    expect(env.PAYPAL_CLIENT_SECRET).toBeUndefined();
    expect(env.PAYPAL_WEBHOOK_ID).toBeUndefined();
  });
});

describe("a production PayPal client pointed at the sandbox", () => {
  it("refuses to boot, naming the switch rather than the client", () => {
    // The default is sandbox, so the mistake this catches is an omission: a
    // deploy that wrote down live credentials and never wrote down the switch.
    expect(() =>
      parseEnv({
        ...PRODUCTION_BASE,
        ...LIVE_CREDENTIALS,
        PAYPAL_SANDBOX: "true",
      }),
    ).toThrow(
      /PAYPAL_SANDBOX: must be false in production once PAYPAL_CLIENT_ID is set/,
    );

    expect(() =>
      parseEnv({
        ...PRODUCTION_BASE,
        ...LIVE_CREDENTIALS,
        PAYPAL_SANDBOX: "true",
      }),
    ).toThrow(EnvValidationError);
  });

  it("refuses a client that never named the switch at all", () => {
    // Omitting it is not a neutral act — the default is sandbox, which is the
    // refused value once a client id is configured.
    const { PAYPAL_SANDBOX: _unset, ...withoutSwitch } = LIVE_CREDENTIALS;

    expect(() =>
      parseEnv({ ...PRODUCTION_BASE, ...withoutSwitch }),
    ).toThrow(/PAYPAL_SANDBOX/);
  });

  it("boots when the client is live and the switch says so", () => {
    const env = parseEnv({ ...PRODUCTION_BASE, ...LIVE_CREDENTIALS });

    expect(env.PAYPAL_SANDBOX).toBe(false);
    expect(env.PAYPAL_CLIENT_ID).toBe("live-client-id");
    expect(env.PAYPAL_WEBHOOK_ID).toBe("WH-live-webhook-id");
  });

  it("leaves a production deploy with no PayPal credentials alone", () => {
    // The sandbox default stands where there is nothing to point at it. A
    // property that has not onboarded PayPal takes no PayPal money, and
    // refusing its boot would refuse a deploy over a payment route it never
    // uses.
    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.PAYPAL_SANDBOX).toBe(true);
  });

  it("leaves development on the sandbox client it is tested with", () => {
    const env = parseEnv({ ...DEVELOPMENT_BASE, ...SANDBOX_CREDENTIALS });

    expect(env.PAYPAL_SANDBOX).toBe(true);
  });
});
