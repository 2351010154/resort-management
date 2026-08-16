// What a production boot is allowed to say about the payment gateway.
//
// Two claims, and both are about the same failure: a deploy that is half
// configured for real money. A terminal pointed at the sandbox signs and answers
// exactly as the live one does, so a booking confirms against a transaction that
// never moved anything; a terminal with no pager behind it takes real money and
// has nowhere for the night's disagreements to land. Neither is visible in
// traffic until a guest is already involved, so both are settled at boot.
//
// Non-production is deliberately untouched by either check. A sandbox terminal
// in development is how the funnel is exercised at all, and a developer has no
// on-call endpoint to name.

import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

// Everything a production boot needs *besides* the gateway variables under
// test, so a failure below is about the gateway and not about the fixture.
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

// A terminal, its secret, and the two things a live one obliges the deploy to
// have: an on-call endpoint and the sandbox switched off.
const LIVE_TERMINAL = {
  VNPAY_TMN_CODE: "MRVTEST1",
  VNPAY_SECRET_KEY: "a-hash-secret",
  VNPAY_SANDBOX: "false",
  OPS_ALERT_WEBHOOK_URL: "https://alerts.mariva.test/hooks/payments",
} as const;

const DEVELOPMENT_BASE = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://mariva@localhost:5432/mariva",
  BETTER_AUTH_SECRET: "guest-realm-secret-of-quite-sufficient-length",
  STAFF_JWT_SECRET: "staff-realm-secret-that-differs-and-is-long",
} as const;

describe("a production terminal pointed at the sandbox", () => {
  it("refuses to boot, naming the switch rather than the terminal", () => {
    // The default is sandbox, so the mistake this catches is an omission: a
    // deploy that wrote down live credentials and never wrote down the switch.
    expect(() =>
      parseEnv({
        ...PRODUCTION_BASE,
        ...LIVE_TERMINAL,
        VNPAY_SANDBOX: "true",
      }),
    ).toThrow(
      // The path and the sentence together: `EnvValidationError` prints
      // `path: message`, so this is the whole line a deploy reads, and it is
      // the switch that is named rather than the terminal beside it.
      /VNPAY_SANDBOX: must be false in production once VNPAY_TMN_CODE is set/,
    );

    expect(() =>
      parseEnv({
        ...PRODUCTION_BASE,
        ...LIVE_TERMINAL,
        VNPAY_SANDBOX: "true",
      }),
    ).toThrow(EnvValidationError);
  });

  it("refuses a terminal that never named the switch at all", () => {
    // Omitting it is not a neutral act — the default is sandbox, which is the
    // refused value once a terminal is configured.
    const { VNPAY_SANDBOX: _unset, ...withoutSwitch } = LIVE_TERMINAL;

    expect(() => parseEnv({ ...PRODUCTION_BASE, ...withoutSwitch })).toThrow(
      /VNPAY_SANDBOX/,
    );
  });

  it("boots when the terminal is live and the pager is named", () => {
    const env = parseEnv({ ...PRODUCTION_BASE, ...LIVE_TERMINAL });

    expect(env.VNPAY_SANDBOX).toBe(false);
    expect(env.VNPAY_TMN_CODE).toBe("MRVTEST1");
  });

  it("leaves a production deploy with no terminal alone", () => {
    // The sandbox default stands where there is nothing to point at it. A
    // property that has not onboarded takes no gateway money, and refusing its
    // boot would refuse a deploy over a payment path it never uses.
    const env = parseEnv({ ...PRODUCTION_BASE });

    expect(env.VNPAY_SANDBOX).toBe(true);
  });

  it("leaves development on the sandbox terminal it is tested with", () => {
    const env = parseEnv({
      ...DEVELOPMENT_BASE,
      VNPAY_TMN_CODE: "MRVTEST1",
      VNPAY_SECRET_KEY: "a-hash-secret",
    });

    expect(env.VNPAY_SANDBOX).toBe(true);
  });
});

describe("a production terminal with nowhere to page", () => {
  it("refuses to boot without an alert endpoint", () => {
    // Reconciliation's value is that a callback which never arrived — a guest
    // charged, their folio still showing the amount outstanding — is found the
    // next morning. A discrepancy nobody is told about is found by nobody.
    const { OPS_ALERT_WEBHOOK_URL: _unset, ...withoutPager } = LIVE_TERMINAL;

    expect(() => parseEnv({ ...PRODUCTION_BASE, ...withoutPager })).toThrow(
      /OPS_ALERT_WEBHOOK_URL/,
    );
  });

  it("does not require one where there is no terminal", () => {
    expect(() => parseEnv({ ...PRODUCTION_BASE })).not.toThrow();
    expect(
      parseEnv({
        ...DEVELOPMENT_BASE,
        VNPAY_TMN_CODE: "MRVTEST1",
        VNPAY_SECRET_KEY: "a-hash-secret",
      }).OPS_ALERT_WEBHOOK_URL,
    ).toBeUndefined();
  });
});
