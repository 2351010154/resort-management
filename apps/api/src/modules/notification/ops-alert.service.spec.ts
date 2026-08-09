// What happens to a page nobody can deliver.
//
// The delivered case is the easy one and is asserted first, because the body is
// a contract: `ops-alert.service.ts` documents what a receiver is sent, and a
// field quietly renamed here is a routing rule that stops matching at the far
// end without anything failing on this side.
//
// The three undelivered cases are the point of the file. `ReconciliationJob`
// calls this from inside `JobRunner`'s transaction, holding the
// `payment_discrepancy` rows that are the durable record of the disagreement, so
// a page that throws would roll back the record in order to protect the
// notification about it. Each case below therefore asserts two things together:
// that nothing is thrown, and that the page's content reached the log — because
// "did not throw" on its own is also what silently dropping it looks like.

import "reflect-metadata";

import type { PinoLogger } from "nestjs-pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import { type OpsAlert, OpsAlertService } from "./ops-alert.service.js";

const ENDPOINT = "https://on-call.mariva.test/hook";

/** A discrepancy, in the shape `ReconciliationJob` composes one. */
const A_PAGE: OpsAlert = {
  kind: "payment-discrepancy",
  text: "VNPay took 1200000 đồng on 2027-11-02 under ref-one and this property has no payment for it",
  details: {
    businessDate: "2027-11-02",
    reference: "ref-one",
    discrepancy: "MISSING_LOCALLY",
    gatewayAmount: "1200000",
    ledgerAmount: null,
    paymentId: null,
  },
};

const warnings: { detail: Record<string, unknown>; message: string }[] = [];
const errors: { detail: Record<string, unknown>; message: string }[] = [];

// A stand-in rather than a real logger, for the reason the sweep suites give:
// the assertion is that the page's content survived, and the only place it can
// survive is here. Two lists because the service uses the level to say which of
// two things happened — nowhere to send it, versus somewhere that refused it.
const log = {
  warn: (detail: Record<string, unknown>, message: string) => {
    warnings.push({ detail, message });
  },
  error: (detail: Record<string, unknown>, message: string) => {
    errors.push({ detail, message });
  },
} as unknown as PinoLogger;

function alerter(endpoint: string | undefined): OpsAlertService {
  return new OpsAlertService(
    { OPS_ALERT_WEBHOOK_URL: endpoint } as Env,
    log,
  );
}

afterEach(() => {
  warnings.length = 0;
  errors.length = 0;
  vi.unstubAllGlobals();
});

describe("an endpoint that accepts the page", () => {
  it("is POSTed the alert's text, kind and every detail beside them", async () => {
    const fetched = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetched);

    const delivered = await alerter(ENDPOINT).page(A_PAGE);

    expect(delivered).toBe(true);

    const [url, init] = fetched.mock.calls[0]!;

    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");

    // The documented body, flat: a receiver's rule branches on `kind` and a
    // human reads `text`, and the details sit beside them rather than nested,
    // so a Slack-style webhook renders something usable with no transform.
    expect(JSON.parse(init.body)).toEqual({
      text: A_PAGE.text,
      kind: "payment-discrepancy",
      businessDate: "2027-11-02",
      reference: "ref-one",
      discrepancy: "MISSING_LOCALLY",
      gatewayAmount: "1200000",
      ledgerAmount: null,
      paymentId: null,
    });

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("is never called when no endpoint is configured, and the page is logged whole", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    const delivered = await alerter(undefined).page(A_PAGE);

    expect(delivered).toBe(false);
    expect(fetched).not.toHaveBeenCalled();

    // Warn and not error: nowhere to send it is a development configuration,
    // and `env.ts` is what refuses it in production once a terminal is set.
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(A_PAGE.text);
    expect(warnings[0]!.detail).toMatchObject({
      reference: "ref-one",
      discrepancy: "MISSING_LOCALLY",
    });
  });
});

describe("an endpoint that cannot take the page", () => {
  it("does not throw when it refuses, and logs what it refused and why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no such routing key", { status: 400 })),
    );

    const delivered = await alerter(ENDPOINT).page(A_PAGE);

    expect(delivered).toBe(false);
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain(A_PAGE.text);
    expect(errors[0]!.detail).toMatchObject({
      status: 400,
      detail: "no such routing key",
      reference: "ref-one",
    });
  });

  it("does not throw when it cannot be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")),
    );

    const delivered = await alerter(ENDPOINT).page(A_PAGE);

    expect(delivered).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain(A_PAGE.text);
    expect(errors[0]!.detail.err).toBeInstanceOf(Error);
    expect(errors[0]!.detail).toMatchObject({ reference: "ref-one" });
  });

  it("does not throw when reading the refusal's body itself fails", async () => {
    // A receiver that answers 500 and then drops the connection mid-body. The
    // `.catch` on the body read exists for this, and without it the failure
    // arrives as a rejected promise from inside the error path — a throw from
    // precisely the branch written not to throw.
    const refused = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error("socket hang up")),
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused));

    await expect(alerter(ENDPOINT).page(A_PAGE)).resolves.toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.detail).toMatchObject({ status: 500, detail: "" });
  });
});
