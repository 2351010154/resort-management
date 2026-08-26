// PayPal's half of one payment's conversation: where the gateway reports what
// became of an attempt — `FR-PAY-03` — and where the payer's browser lands
// afterwards.
//
// **A second controller beside `payment.controller.ts`, and that is the shape
// `FR-PAY-01` asks for.** The rule is that no gateway type leaks past the port,
// and the line it draws runs between a controller and a service: a callback
// route has no caller but its own gateway, so its path, its method, its
// parameter names and the shape of its answer are that gateway's specification
// and nothing this codebase may choose. `payment.controller.ts` argues that at
// length for VNPay's two routes and says outright that `FR-PAY-06`'s second
// gateway registers a second controller beside it. This is that controller.
// `payment.service.ts` below the port still knows nothing about either provider
// — it is handed a `payment_method`, which is the property's own word for a way
// money reaches the desk.
//
// **Nothing here is written over `contract` in `@mariva/shared`**, for the
// reason the file beside it gives about its own two: a contract is what makes
// this property's web app and this property's API agree at compile time, and
// neither route below has a caller on this property's side of the wire. One is
// PayPal posting JSON; the other is a browser arriving from somebody else's
// site. A contract over them would be this codebase declaring a shape it does
// not own and cannot change.
//
// **The two routes differ from VNPay's in the way that matters most: what
// authenticates them.** VNPay signs a query string, so both of its routes carry
// the same signature and its return url is worth verifying. PayPal signs a
// *transmission* — five headers over a POSTed body, checked by asking PayPal
// itself, which is what `FR-PAY-02` requires of a codebase that computes no
// signature and validates no certificate chain. That signature exists only on
// the webhook. The payer's return carries `token`, an order id, and nothing
// else at all: no signature, no reference of this property's, no proof the payer
// ever paid.
//
// So the asymmetry below is not an oversight, it is the design. **The webhook is
// the sole authority over money and the return decides nothing** — it writes no
// row, reads no account, resolves no attempt and names no stay. A return route
// that confirmed anything would let a stranger who guessed or replayed an order
// id mark a booking paid, and PayPal hands that id to the payer's own browser.
//
// **The webhook answers 200 for exactly three refusals, and asks to be
// redelivered for everything else.** A forgery, an event about an attempt
// nobody opened, and a claim contradicting what is on file are the same on
// every redelivery — the signature will not become valid, the reference will
// not start existing, the amount will not come to agree — so a `2xx` is the
// honest answer and asking again is work for nothing. A verification failure in
// particular is a `200` with nothing written: there is nobody to report a
// forgery to, the sender is not PayPal by definition, and a `4xx` would tell
// whoever posted it which of their guesses was closest.
//
// **Everything else is this property's own failure rather than the caller's,
// and a retry is the one thing that fixes it.** A database unreachable
// mid-callback, a process holding no credential for this gateway, PayPal's own
// API refusing to say whether a transmission is its own — none of those are a
// decision against the payment, they are this property not yet being in a
// position to record one, and the fix is usually minutes away on somebody
// else's terminal. So the webhook answers whatever status the failure carries,
// never a `2xx`, and PayPal's own three-day backoff is what asks again — rather
// than a person reading a log line and requesting a redelivery by hand once
// whatever failed has been noticed. This is the same choice `payment.
// controller.ts`'s IPN makes with `99`, and the two gateways do not get to
// quietly disagree about what a lost delivery costs.
//
// The return route below throws nothing at all, and needs no such distinction:
// it decides nothing, writes nothing, and there is nothing in it that can fail
// this way. A `500` reaching a payer's browser is a guest looking at a stack
// trace instead of at their booking, which is a fate this route avoids by
// having no failure mode to report in the first place.
//
// **What is logged is the transmission and never the event.** A PayPal webhook
// body carries the payer's name, their email address and their PayPal account
// id, and it arrives on an unguarded route where most of what arrives is not a
// payment at all. `PAYPAL-TRANSMISSION-ID` is the one string that identifies a
// delivery, is searchable in PayPal's own webhook dashboard, is stable across
// that delivery's retries, and is a header rather than a field of the body —
// which is what makes it the only thing this file may name before verification
// has passed. The body is not read here at any point, verified or not: it is
// handed to the adapter whole, because that is the only form a signature can be
// checked over.

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Redirect,
} from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import { Unguarded } from "../../common/auth/access.decorators.js";
import { ENV, type Env } from "../../config/env.js";
import {
  type CallbackOutcome,
  disagreementOf,
  PaymentService,
} from "./payment.service.js";

/**
 * Which of the property's payment methods the two routes below speak for.
 *
 * The same field `payment.controller.ts` declares for the same reason: a
 * callback route has exactly one gateway posting to it, so this file is the only
 * thing in the request that can say which provider is speaking — and
 * `payment.service.ts` needs it said, because the adapter that authenticates a
 * callback is resolved from it and the attempt a callback may resolve is
 * narrowed by it.
 *
 * The property's own vocabulary and not PayPal's, which is what keeps it from
 * being the leak `FR-PAY-01` forbids. `payment_method` is a list of ways money
 * reaches the desk; what crosses the port is a member of that list, and nothing
 * on the far side learns a host, a header or an event type from it.
 */
const GATEWAY_METHOD = "PAYPAL";

/**
 * Where PayPal posts its report of an attempt.
 *
 * Registered per application in PayPal's developer dashboard against the
 * property's webhook id — the same id `paypal.adapter.ts` sends to
 * `/v1/notifications/verify-webhook-signature` — so changing it is a deployment
 * step and not only an edit. `docs/architecture/infrastructure.md` §Payments
 * records VNPay's two addresses the same way.
 */
const GATEWAY_WEBHOOK_PATH = "payments/paypal/webhook";

/**
 * Where PayPal sends the payer's browser afterwards — read twice, and that is
 * the point of naming it, exactly as `payment.controller.ts` names VNPay's.
 *
 * Once as the route that answers, and once as the address handed to the gateway
 * when an attempt is opened. Two literals would be two strings that agree until
 * somebody moves the route, at which point every payer would be redirected to a
 * 404 with their payment already taken.
 */
const GATEWAY_RETURN_PATH = "payments/paypal/return";

/**
 * The five headers a PayPal delivery is signed over, as the property's servers
 * present them.
 *
 * Lowercased, because HTTP header names are case-insensitive and Node normalises
 * them that way before a handler sees one; matching PayPal's documented capitals
 * would be a controller that worked against the documentation and forwarded
 * nothing from a real delivery.
 *
 * **Named here rather than the whole header bag being passed on**, and the
 * narrowing is the point. What reaches the adapter is a request from the public
 * internet, and everything about it except these five is either irrelevant to
 * the signature or actively somebody else's business — a cookie, an
 * `authorization` header a misdirected client attached, a proxy's own
 * annotations. A route that forwarded them all would be widening what an adapter
 * can see for no verification it could perform.
 *
 * `paypal.adapter.ts` names the same five, and the pair is deliberate rather than
 * duplication that drifted: this file decides what may leave the request, and
 * the adapter decides what a delivery consists of — the port is explicit that
 * the second of those is the adapter's business and the record is untyped so it
 * stays there. A disagreement between the two fails in the safe direction, which
 * is worth stating: a header this file did not forward is a header the adapter
 * cannot find, and a delivery it cannot find one for is answered
 * `{ verified: false }` and posts nothing.
 */
const TRANSMISSION_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

/** Which of the five identifies the delivery, for the one thing that is logged. */
const TRANSMISSION_ID = "paypal-transmission-id";

/**
 * Where a payer coming back from PayPal is handed to.
 *
 * The funnel's own front door, and unlike VNPay's return there is no second
 * option. That route has a signed reference and can send the payer to the
 * confirming screen for the stay it names; this one has an order id PayPal
 * minted, no signature over it and no way to turn it into a booking that does
 * not amount to trusting a string a stranger could have chosen. So there is no
 * stay to open a page about, the payer lands at the door, and their booking — if
 * they have one — is reachable from their account.
 *
 * The caption travels with them so the screen can say why they are here rather
 * than showing a bare search.
 */
const PAYER_FALLBACK_PATH = "/booking";

/**
 * What the payer's browser is told, which is a caption and not a fact about
 * money.
 *
 * `confirming` and never `paid`, for the reason `payment.controller.ts` gives
 * about its own and then one more. The redirect and the webhook are two
 * independent deliveries of the same claim and the browser routinely arrives
 * first — but here the browser also arrives carrying nothing this property
 * checked, so even "the gateway told the payer it took the money" is more than
 * this route knows. What it knows is that somebody's browser reached this
 * address. A page that said "paid" would be a receipt issued by whoever
 * happened to open the url.
 *
 * One caption and not a table, which is the honest consequence: PayPal sends an
 * approving payer and a cancelling one to the same address — `paypal.adapter.ts`
 * gives that order's `cancelUrl` and `returnUrl` the same value, and says why —
 * and nothing on this path could tell them apart anyway.
 */
const CONFIRMING = "confirming";

/** A 303 rather than a 302: the answer is at another address, and no browser
 *  or proxy may cache this one as though it were the page. */
const SEE_THE_FUNNEL = 303;

// No prefix, and for `payment.controller.ts`'s reason: the paths are written on
// the handlers because a `@Controller` prefix is prepended to every route under
// it, and {@link GATEWAY_RETURN_PATH} has to stay the exact string that is also
// handed to the gateway when an attempt is opened.
@Controller()
export class PaypalController {
  constructor(
    // The service and nothing below it. There is no `PaymentGateway` injected
    // here, unlike `payment.controller.ts`, and the absence is the design: that
    // controller holds the port because its *return* route verifies a signature,
    // and this one's return route has no signature to verify. The webhook's
    // verification happens where every other callback's does — inside
    // `handleIpn`, through the adapter the method resolves — so a gateway in
    // this constructor would be a second route to an adapter for a caller that
    // does not exist.
    private readonly payments: PaymentService,
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(PaypalController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * PayPal's own report of what became of an attempt — the delivery this
   * property acts on, and the only one.
   *
   * **The headers and the body are handed over together, in the one opaque
   * record the port describes, and nested rather than merged.** PayPal signs a
   * transmission: the signature is computed over the five headers *and* the body
   * as sent, so neither half means anything without the other and a handler that
   * reshaped either would produce something that verifies against nothing —
   * a failure indistinguishable from a forgery. They are two keys because they
   * come from different places and only one of them is the sender's:
   * `paypal.adapter.ts` argues it on `deliveryIn`, and the short of it is that a
   * body field named `paypal-transmission-sig` merged alongside the real header
   * would be a forger supplying the very value the check is meant to test.
   *
   * **No field of the body is read here, at any point.** Not before
   * verification, which would be this route acting on a stranger's JSON, and not
   * after either — what an event consists of is the adapter's business and the
   * port keeps this record untyped precisely so it stays there. The log line
   * below names a header instead, and the note at the top of this file says why
   * that one is safe when nothing in the body is.
   *
   * **`FR-PAY-03` is answered below this route rather than in it.** A webhook
   * delivered ten times posts exactly once because `payment.service.ts` claims
   * the attempt with a conditional `UPDATE` and Postgres holds two partial
   * unique indexes under it — idempotency keyed on the gateway transaction id,
   * which for this gateway is the capture's. This handler adds no check of its
   * own and keeps no memory between requests; a controller-level guard against
   * replays would be a second answer to that question, would not survive a
   * second process, and would be the one consulted when the two disagreed.
   *
   * **Nothing thrown leaves this route for a refusal that is the caller's** —
   * an unverified signature, an unknown attempt, a claim already contradicted
   * on file. {@link unacted} answers those three calmly. Anything else it
   * rethrows once it is logged, because it is a failure that is this
   * property's own and the one thing that fixes it is PayPal trying again.
   */
  @Unguarded(
    "PayPal's webhook — the gateway holds no session of this property's, and " +
      "the signature over the transmission, verified by asking PayPal itself, " +
      "is what stands in for one",
  )
  @Post(GATEWAY_WEBHOOK_PATH)
  // 200 rather than Nest's 201 for a POST. PayPal treats any 2xx as delivered,
  // so nothing turns on which one — but a 201 claims a resource was created at
  // an address this route does not return, and a redelivery creates nothing at
  // all.
  @HttpCode(200)
  async webhook(
    @Headers() headers: Record<string, unknown>,
    @Body() event: unknown,
  ): Promise<void> {
    const delivery = { headers: transmissionIn(headers), event };

    try {
      this.filed(
        await this.payments.handleIpn(delivery, GATEWAY_METHOD),
        headers,
      );
    } catch (error) {
      this.unacted(error, headers);
    }
  }

  /**
   * Where PayPal sends the payer's browser when they are finished with it.
   *
   * **This route makes no decision about anything and is built to need none.**
   * It writes no row, reads no account, resolves no attempt into money and does
   * not so much as ask PayPal a question. The webhook above is the authority: it
   * is the delivery PayPal retries until it gets a `2xx`, it arrives whether or
   * not the payer's browser survived the round trip, and it is the one carrying
   * a signature this property can check.
   *
   * **`token` is read and deliberately not used**, which is the whole argument
   * of the route. It is the order id PayPal minted, it arrives on a url the
   * payer can bookmark, edit or send to somebody else, and there is no signature
   * over it of any kind — so it proves nothing about who is asking or about what
   * they paid. It is accepted as a parameter because PayPal always sends it and
   * a handler that could not name it would look like one that had not been told;
   * nothing downstream receives it. It is not carried into the redirect either,
   * for `payment.controller.ts`'s reason about an unsigned reference: a string a
   * stranger chose, put on the property's own page, is a stranger choosing what
   * the page talks about.
   *
   * So what is handed back is a caption and an address, and the caption is
   * `confirming` however the payer got here. The stay's own page tells them what
   * actually happened, off this property's rows, once the webhook has agreed.
   */
  @Unguarded(
    "PayPal's return url — the payer's browser arrives redirected from the " +
      "gateway with no session and, unlike VNPay's return, no signature over " +
      "anything it carries. Nothing stands in for a session here, which is " +
      "exactly why this route decides nothing and writes nothing",
  )
  @Get(GATEWAY_RETURN_PATH)
  @Redirect()
  payerReturn(
    @Query("token") _order?: string,
  ): { url: string; statusCode: number } {
    return this.handBack();
  }

  /**
   * What is written down about a delivery this property acted on.
   *
   * Four outcomes and four lines, and no answer to shape — PayPal reads the
   * status code and nothing in the body, so unlike VNPay's `RspCode` there is no
   * pair to choose. What is left is the record a person triaging tomorrow's
   * reconciliation reads, and each outcome is worth telling apart in it.
   *
   * A redelivery is `info` and deliberately not a warning. PayPal is entitled to
   * keep asking until it gets a `2xx`, and its retry schedule guarantees it will
   * on any delivery whose acknowledgement was lost; a redelivery logged as a
   * fault is an alert that fires on the protocol working exactly as designed.
   */
  private filed(
    outcome: CallbackOutcome,
    headers: Record<string, unknown>,
  ): void {
    switch (outcome) {
      case "RECORDED":
        this.logger.info(
          delivered(headers),
          "a gateway callback became a payment and a line on the account",
        );

        return;

      case "ALREADY_RECORDED":
        this.logger.info(
          delivered(headers),
          "a gateway callback was delivered again and the payment is already on file",
        );

        return;

      case "REFUSED":
        this.logger.info(
          delivered(headers),
          "the gateway reports it refused this attempt, and the refusal is on file",
        );

        return;

      case "STILL_OPEN":
        this.logger.info(
          delivered(headers),
          "the gateway reports this attempt is still open, so nothing was written",
        );
    }
  }

  /**
   * What is written down about a delivery this property would not act on — and
   * which of those refusals still answers 200, and which is thrown onward so
   * PayPal asks again.
   *
   * Every refusal the service raises deliberately carries an `ORPCError` code,
   * and three of them are the caller's, never this property's own. A delivery
   * nothing signed is ordinary traffic on an unguarded url: a crawler, a scan, a
   * stale link, somebody's misconfigured sandbox. A verified event naming no
   * attempt of this property's is a merchant account answering for somebody
   * else's orders. A disagreement is money that has to be reconciled by hand,
   * because what is on file is what this property already decided to record.
   *
   * **None of the three is worth a retry, and that is why none of them is
   * thrown.** A redelivery of any of them carries the same event and would be
   * refused the same way, so asking again would buy three days of PayPal
   * retrying an answer that cannot change — while a forgery answered `401`
   * would be this property telling whoever posted it that their signature was
   * the part that failed. So each of the three below is logged and returns.
   *
   * **Everything else is rethrown, and that is the ceiling rather than a case**
   * — a refusal added to the service tomorrow without a line here still asks
   * PayPal to try again rather than being silently accepted as final. What lives
   * behind that ceiling is exactly the failures that are this property's own: a
   * database away mid-callback, a process holding no credential for this
   * gateway, PayPal's own API refusing to say whether a transmission is its own
   * when `paypal.adapter.ts` asks it. Every one of those is a payment this
   * property has not yet been able to record, not one it has decided against,
   * and a retry over PayPal's own three-day backoff is the one thing that
   * fixes it. The transmission id is written here so a person triaging tomorrow
   * can find the delivery on PayPal's dashboard; the error itself is written
   * again by whatever catches the throw — a coded refusal like
   * `SERVICE_UNAVAILABLE` or `BAD_GATEWAY` carries its own status straight
   * through the route, and an error nobody coded on purpose gets its stack
   * found by the same filter `job-trigger.controller.ts`'s throws already rely
   * on. This is the same choice `payment.controller.ts` makes with `99` for
   * VNPay, so the two gateways do not quietly diverge on what a lost delivery
   * costs.
   */
  private unacted(error: unknown, headers: Record<string, unknown>): void {
    if (error instanceof ORPCError) {
      switch (error.code) {
        case "UNAUTHORIZED":
          // Loud enough to count, quiet enough not to page anybody: the route is
          // unguarded on purpose, so most of what fails here is traffic rather
          // than money.
          this.logger.warn(
            delivered(headers),
            "a callback arrived without the gateway's signature",
          );

          return;

        case "NOT_FOUND":
          this.logger.warn(
            delivered(headers),
            "a signed callback names no attempt this property opened",
          );

          return;

        case "CONFLICT":
          // Loud on every reading of it. Nothing was posted, the attempt is
          // sitting in a state a person has to resolve, and the sentence the
          // service wrote is the one that says which — so it is carried into the
          // log rather than restated here.
          this.logger.error(
            {
              ...delivered(headers),
              disagreement: disagreementOf(error.data),
              reason: error.message,
            },
            "a gateway callback contradicts this property's record — nothing was posted",
          );

          return;
      }
    }

    // Everything past this point is this property's own failure — the database,
    // this gateway's own credentials, PayPal's own API — and none of the three
    // refusals above. Logged with the transmission id so a redelivery can be
    // matched to this line, then rethrown: `webhook`'s catch does nothing more
    // with it, so it reaches Nest's exception layer and answers with whatever
    // status the failure itself carries, never the `200` above `@HttpCode`
    // sets for success.
    this.logger.error(
      { ...delivered(headers), err: error },
      "a gateway callback could not be acted on — asking the gateway to redeliver it",
    );

    throw error;
  }

  /**
   * The payer, sent on to the site with a caption and nothing else.
   *
   * The same shape `payment.controller.ts` hands back — a url and a 303 — and a
   * strictly smaller argument list, because there is nothing else this route
   * could honestly pass. No reference, so no stay, so no confirming screen: the
   * note on {@link PAYER_FALLBACK_PATH} says why, and the note on
   * {@link CONFIRMING} says why the caption is a caption.
   */
  private handBack(): { url: string; statusCode: number } {
    const url = new URL(PAYER_FALLBACK_PATH, this.env.WEB_ORIGIN);

    url.searchParams.set("payment", CONFIRMING);

    return { url: url.toString(), statusCode: SEE_THE_FUNNEL };
  }
}

/**
 * The five transmission headers, taken off the request and narrowed to text.
 *
 * A header Node parsed more than once arrives as an array and a header that was
 * absent arrives as `undefined`; neither is a value a signature was computed
 * over, so neither is forwarded. What the adapter then finds is a delivery
 * missing a header, which it answers `{ verified: false }` — the same treatment
 * a request with no headers at all gets, which is the right one: `FR-PAY-03`
 * leaves this route unguarded, so a delivery that does not look like PayPal's is
 * a crawler and not an incident.
 *
 * Every other header of the request is dropped here rather than passed along.
 * The note on {@link TRANSMISSION_HEADERS} argues why the narrowing belongs at
 * this end of the hand-off.
 */
function transmissionIn(
  headers: Record<string, unknown>,
): Record<string, string> {
  const transmission: Record<string, string> = {};

  for (const header of TRANSMISSION_HEADERS) {
    const value = headers[header];

    if (typeof value === "string") {
      transmission[header] = value;
    }
  }

  return transmission;
}

/**
 * The one thing about a delivery worth a log line, and the only thing this file
 * is allowed to name.
 *
 * Never the event. A PayPal webhook body carries the payer's name, their email
 * address and their PayPal account id, and this route is reached by anyone who
 * can post to a url — so logging what arrived would be filling this property's
 * log with strangers' JSON on the strength of nothing at all, and with real
 * payers' personal data the rest of the time. `paypal.adapter.ts` switches the
 * SDK's own logger off for the same reason.
 *
 * The transmission id is enough for what a person triaging one actually does:
 * it is what PayPal's webhook dashboard is searched by, it is stable across a
 * delivery's retries so two log lines can be told apart from two deliveries, and
 * it is what a redelivery is requested against once whatever failed has been
 * fixed. It is also a header rather than a field of the body, which is what makes
 * it readable before verification has passed — everything the sender chose is
 * still unread at that point.
 *
 * Absent when the request carried no such header, which is most of what reaches
 * an unguarded url and is worth seeing as absent rather than as an exception on
 * the way to reading it.
 */
function delivered(
  headers: Record<string, unknown>,
): { readonly transmissionId: string | undefined } {
  const id = headers[TRANSMISSION_ID];

  return { transmissionId: typeof id === "string" ? id : undefined };
}
