// Which of the property's gateways answers for a given payment method.
//
// `FR-PAY-01` puts two implementations behind one port and `FR-PAY-06` is the
// second of them arriving. Until it did, "the gateway" was a single binding and
// a single injected instance, and that was honest: with one adapter there is
// nothing to choose between. With two there is, and the choice is made once per
// attempt rather than once per deployment — a guest in the funnel picks the
// gateway they want to pay through, so two payments against the same stay may
// go to different providers on the same afternoon.
//
// **The key is a payment method and not a gateway name**, which is what keeps
// this file on the property's side of `FR-PAY-01`. `payment_method` is
// `schema/payment.ts`'s list of ways money reaches the desk, `contract/
// payment.ts` narrows it to the members a gateway answers for, and the same
// value is what the row records. So the map is keyed by the thing already
// written on the payment rather than by a second identifier invented here to
// name a provider — one key, stored, resolvable again later, and a caller that
// holds a row holds everything it needs to reach the adapter that opened it.
//
// **A method with no adapter is answered rather than crashed, and that is the
// same decision `vnpay.adapter.ts` already made about a missing terminal
// code.** That file builds its client on first use so a deployment without
// credentials boots and fails at the payment, naming the variables, instead of
// refusing to start an API that mostly does other things. A registry that threw
// at construction would undo it from the other end: a property that has not
// finished PayPal's merchant onboarding could not start the process at all,
// and the thing it could not do — collect through PayPal — is one route out of
// several dozen. So the binding is allowed to be partial and the gap is a `503`
// at the one call that needs it, carrying the method it could not resolve.
//
// **It resolves and does nothing else.** No fallback to another gateway, and
// that is worth saying out loud: a caller who asked for PayPal and was quietly
// sent to VNPay would be a guest charged in đồng on a card they chose to pay
// dollars with, and a row whose `method` and whose money disagree. Nothing here
// substitutes one provider for another.
//
// **It also answers what is bound, which is a question two callers have.**
// `FR-PAY-05` reconciles a night against the gateways' reports, and the sweep
// that does it has no payer's choice to resolve — it needs every provider the
// property collects through, because the night holds money from both. The
// second is the funnel, through `payment.controller.ts`'s listing route: a
// screen that hard-coded which providers are choosable would offer a guest a
// gateway this deployment has no credentials for, and the refusal below —
// written for a log — would be the sentence they read after pressing the
// button. Both are a listing rather than a second kind of resolution, and it is
// here rather than in either caller for the reason the map is here at all:
// which providers this deployment has is one fact, and a caller assembling its
// own view of it would be a second one, differing the first time a binding
// moved.

import {
  type GatewayPaymentMethod,
  gatewayPaymentMethodSchema,
} from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import type { PaymentGateway } from "./payment-gateway.port.js";

/**
 * The adapters this deployment actually has, by the method each answers for.
 *
 * Partial on purpose — see the note above on why an unbound method is a `503`
 * rather than a boot failure. `payment.module.ts` is the one place it is
 * assembled, because that is where every other binding in this module is
 * argued.
 */
export type GatewayBindings = Partial<
  Readonly<Record<GatewayPaymentMethod, PaymentGateway>>
>;

/**
 * The map, behind a method so callers ask a question rather than index a
 * record.
 *
 * A class and not a bare object, so that the refusal below lives with the
 * lookup: an `undefined` handed back to each caller would be a `503` written
 * out at every call site, in slightly different words, drifting apart. It is
 * also its own DI token — `payment.module.ts` provides it by class, unlike the
 * port beside it, because a class is a value at run time and has nothing to
 * erase into a symbol.
 */
export class GatewayRegistry {
  constructor(private readonly bound: GatewayBindings) {}

  /**
   * The adapter that answers for this method, or a refusal naming it.
   *
   * `SERVICE_UNAVAILABLE` and not `BAD_REQUEST`, because the caller asked for
   * something the property genuinely accepts — the method is a member of the
   * contract's own list — and what is missing is this deployment's credentials
   * for it. That is a temporary fact about the server, which is what a `503`
   * says and what a `400` would misreport as the guest's mistake.
   *
   * The method is in the message for the same reason `vnpay.adapter.ts` names
   * `VNPAY_TMN_CODE` and `VNPAY_SECRET_KEY` in its own: whoever reads this in a
   * log is being asked to configure exactly one thing, and a sentence that
   * withheld which one would send them through every gateway the property has.
   */
  /**
   * Every gateway this deployment can actually reach, with the method each one
   * answers for.
   *
   * For the callers that have a question about all of them rather than about
   * the one a payer chose. `FR-PAY-05`'s nightly sweep asks each gateway for
   * its side of the same night and holds the two answers against one ledger; it
   * cannot name a provider to ask, and asking about a method it read off a row
   * would give it {@link GatewayRegistry.for}'s refusal on the one deployment
   * where a method is unbound: a night that could not be reconciled at all,
   * every hour, because one of two providers is unconfigured. The other is the
   * funnel, which asks so that it can offer a guest the providers this
   * deployment can actually take money through and draw the rest as refused
   * before anybody presses anything.
   *
   * **What is bound and not what is possible.** A method with no adapter is
   * simply absent from this list, so a payment recorded against it is money the
   * property cannot ask anybody about — which the comparison downstream reports
   * as a disagreement and pages about, rather than passing over in silence.
   *
   * Ordered by the contract's own list rather than by whatever order the
   * bindings were assembled in, so a sweep that fetches two reports fetches them
   * in the same order on every run and a failure is reproducible.
   */
  all(): readonly (readonly [GatewayPaymentMethod, PaymentGateway])[] {
    return gatewayPaymentMethodSchema.options.flatMap((method) => {
      const gateway = this.bound[method];

      return gateway ? [[method, gateway] as const] : [];
    });
  }

  for(method: GatewayPaymentMethod): PaymentGateway {
    const gateway = this.bound[method];

    if (!gateway) {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        status: 503,
        message: `This property cannot collect through ${method} — no gateway is configured for it`,
      });
    }

    return gateway;
  }
}
