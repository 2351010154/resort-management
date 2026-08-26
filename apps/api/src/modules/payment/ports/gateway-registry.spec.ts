// What the registry does with a method it was given an adapter for, and what it
// does with one it was not.
//
// The second is the case worth a file. A property runs this API with whatever
// gateways it has finished onboarding, and the half-configured deployment is
// not an edge — `vnpay.adapter.ts` is built around it, deferring a missing
// terminal code to the call so that an API without credentials still boots. The
// registry is the other end of that decision, and this file is where the shape
// of its refusal is pinned: a status a client can act on, and a sentence naming
// the one thing somebody has to configure.
//
// The adapters are stood in for, because nothing here is about what a gateway
// does. `vnpay.adapter.spec.ts` is where an implementation is held against a
// specification; this is a lookup and a refusal.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import { GatewayRegistry } from "./gateway-registry.js";
import type { PaymentGateway } from "./payment-gateway.port.js";

/**
 * Not a gateway. It is only ever compared by identity, so every method throws:
 * a case that called one of them would be asserting something this file does
 * not claim.
 */
function anAdapter(name: string): PaymentGateway {
  const unreached = () => {
    throw new Error(`${name} was called from a suite that only resolves it`);
  };

  return {
    createPayment: unreached,
    verifyCallback: unreached,
    refund: unreached,
    queryTransaction: unreached,
  };
}

describe("a method the property has an adapter for", () => {
  it("resolves to that adapter and no other", () => {
    // Two bindings rather than one, because a registry that returned its only
    // entry whatever it was asked would pass a single-adapter case. The claim
    // is that the key decides.
    const vnpay = anAdapter("the đồng gateway");
    const paypal = anAdapter("the foreign gateway");

    const registry = new GatewayRegistry({ VNPAY: vnpay, PAYPAL: paypal });

    expect(registry.for("VNPAY")).toBe(vnpay);
    expect(registry.for("PAYPAL")).toBe(paypal);
  });
});

describe("a method no adapter is bound to", () => {
  it("is refused as a fact about this deployment, not about the caller", () => {
    // `SERVICE_UNAVAILABLE` and not `BAD_REQUEST`: `PAYPAL` is a member of the
    // contract's own list of methods a gateway answers for, so the caller asked
    // for something the property accepts and this deployment has not been given
    // the credentials to collect through. A `400` would report that as the
    // guest's mistake.
    const refusal = refused(() =>
      new GatewayRegistry({ VNPAY: anAdapter("the đồng gateway") }).for(
        "PAYPAL",
      ),
    );

    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");
    expect(refusal.status).toBe(503);
  });

  it("names the method, so nobody has to guess which one to configure", () => {
    // The same argument `vnpay.adapter.ts` makes for naming `VNPAY_TMN_CODE`
    // and `VNPAY_SECRET_KEY` in its own refusal: whoever reads this in a log is
    // being asked to configure exactly one thing.
    const refusal = refused(() => new GatewayRegistry({}).for("PAYPAL"));

    expect(refusal.message).toContain("PAYPAL");
  });

  it("substitutes no other gateway for it", () => {
    // The failure this rules out is quiet rather than loud: a guest who chose
    // to pay in dollars, sent to a gateway that charges đồng, and a row whose
    // method and whose money disagree. An empty binding for the method asked
    // for is a refusal even when another gateway is standing right there.
    const registry = new GatewayRegistry({
      VNPAY: anAdapter("the đồng gateway"),
    });

    expect(() => registry.for("PAYPAL")).toThrow(ORPCError);
    expect(registry.for("VNPAY")).not.toBe(undefined);
  });
});

/** The refusal a lookup provoked. Fails the case if it resolved anything. */
function refused(work: () => unknown): ORPCError<string, unknown> {
  try {
    work();
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the registry resolved a method nothing is bound to");
}
