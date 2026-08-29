// Which gateways this deployment collects through, which is a question about the
// environment rather than about the code.
//
// `ports/gateway-registry.ts` allows the map to be partial and answers an
// unbound method with a `503` naming it. Nothing proved that the map is ever
// *actually* partial, and the difference is invisible from every surface a payer
// touches: an adapter without credentials refuses at its first call, so a guest
// who chose PayPal on a property that has not onboarded it gets a `503` either
// way, a sentence apart.
//
// `reconciliation.job.ts` is the one caller that can tell them apart, and it
// fails silently in the direction that matters. It asks every bound gateway for
// its side of a night and deliberately catches nothing per gateway — a provider
// that is configured and unreachable has to take the night down rather than let
// it half-reconcile. PayPal answers a window directly, so that call is made
// whether or not the day holds a PayPal attempt. Bound without credentials it
// would raise its own `503` on every hourly run, no `payment_reconciliation_run`
// row would ever be written, and each day would fall past `LOOK_BACK_DAYS`
// unreconciled — taking VNPay's money with it, on a property that does not use
// PayPal at all.
//
// VNPay never showed this and cannot: it answers no window, so the sweep
// reconstructs its night out of the attempts this property minted, and an
// unconfigured terminal has none to be asked about.
//
// So what is asserted here is the binding itself, from outside, against the two
// environments a deployment is actually in — before `g2-production-paypal.md`
// sets the production app credentials and after it. The ambient stand-ins are
// `guest.module.spec.ts`'s
// arrangement and are never called: compiling the graph and reading the map back
// is the whole assertion, and what the gateways do with a real merchant account
// is the e2e suite's.

import "reflect-metadata";

import { Global, Module, type ValueProvider } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LoggerModule } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import { ENV, type Env } from "../../config/env.js";
import { DRIZZLE } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { AuditService } from "../audit/audit.service.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import { PaymentModule } from "./payment.module.js";

/**
 * Everything the module's providers take from a booted application, standing in
 * as `guest.module.spec.ts` stands its own in. None is called — compiling the
 * graph and reading the map back is the whole assertion.
 *
 * The logger is the real `LoggerModule` rather than a stub, because the per-class
 * tokens `@InjectPinoLogger` asks for are minted by that module and not by a
 * name this file could enumerate. Silenced rather than mocked, so a controller
 * added under this module later does not fail here for want of a token.
 */
const AMBIENT: readonly ValueProvider[] = [
  { provide: DRIZZLE, useValue: {} },
  { provide: TransactionRunner, useValue: {} },
  { provide: AuditService, useValue: {} },
];

/**
 * A deployment that has not onboarded PayPal — the three variables unset.
 *
 * Only the fields a constructor under this graph reads are named. The auth
 * secret is one of them and is a literal rather than anything real:
 * `booking-token.service.ts` derives a key from it at construction, so it has to
 * be some bytes, and which bytes is nothing this file asserts.
 */
const WITHOUT_PAYPAL = {
  BETTER_AUTH_SECRET: "not-a-secret-only-bytes-to-derive-from",
  VNPAY_TMN_CODE: "TERMINAL",
  VNPAY_SECRET_KEY: "SECRET",
  VNPAY_SANDBOX: true,
  PAYPAL_SANDBOX: true,
} as unknown as Env;

/** The same deployment after the flip: all three set together, as `env.ts` requires. */
const WITH_PAYPAL = {
  ...WITHOUT_PAYPAL,
  PAYPAL_CLIENT_ID: "CLIENT",
  PAYPAL_CLIENT_SECRET: "SECRET",
  PAYPAL_WEBHOOK_ID: "WEBHOOK",
} as unknown as Env;

async function registryUnder(env: Env): Promise<GatewayRegistry> {
  @Global()
  @Module({
    providers: [...AMBIENT, { provide: ENV, useValue: env }],
    exports: [...AMBIENT.map(({ provide }) => provide), ENV],
  })
  class AmbientModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      LoggerModule.forRoot({ pinoHttp: { enabled: false } }),
      AmbientModule,
      PaymentModule,
    ],
  }).compile();

  const registry = moduleRef.get(GatewayRegistry);

  await moduleRef.close();

  return registry;
}

describe("which gateways the payment module binds", () => {
  it("collects through VNPay alone until PayPal's three variables are set", async () => {
    const registry = await registryUnder(WITHOUT_PAYPAL);

    // The list the sweep iterates. PayPal absent from it is the whole point:
    // present, the nightly comparison would ask an adapter with no credentials
    // for a window and never reconcile a day again.
    expect(registry.all().map(([method]) => method)).toEqual(["VNPAY"]);
  });

  it("refuses a PayPal attempt by naming the method, rather than binding one it cannot reach", async () => {
    const registry = await registryUnder(WITHOUT_PAYPAL);

    expect(() => registry.for("PAYPAL")).toThrow(/PAYPAL/);
  });

  it("collects through both once the deployment holds PayPal's credentials", async () => {
    const registry = await registryUnder(WITH_PAYPAL);

    // Ordered by the contract's own list, which is what makes a sweep that
    // fetches two reports fetch them the same way on every run.
    expect(registry.all().map(([method]) => method)).toEqual([
      "VNPAY",
      "PAYPAL",
    ]);
  });
});
