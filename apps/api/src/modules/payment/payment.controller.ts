// One payment's whole conversation: where the property asks for the money —
// `FR-PAY-02` — and then where the gateway reports what became of it and where
// the payer lands, which is `FR-PAY-03`.
//
// **Two of the three are VNPay's routes, and the file is shaped by that.**
// Everything else under `modules/` answers through `contract` in
// `@mariva/shared`, because the caller on the other end is this property's own
// web app and the contract is what makes the two agree at compile time. The IPN
// and the payer's return have no such caller. Their paths, their methods, their
// parameter names and the shape of their answers are all VNPay's specification,
// and a contract written over them would be this codebase declaring a shape it
// does not own and cannot change. So they are plain Nest routes —
// `guest-auth.controller.ts` mounts Better Auth's own surface for the same
// reason, and gives it.
//
// **The third is the property's own, and it is the only one that holds a
// capability.** Opening an attempt is the desk asking a gateway to collect
// against a stay: the caller is this property's web app, the shape is this
// property's to choose, and `rbac-matrix.md` §2 governs it like every other
// staff route. So it is declared in `contract/payment.ts` and guarded by
// `payment.open-attempt`. It is answered here rather than beside the folio
// because the attempt and the callback that resolves it are one conversation —
// and because `payment.module.ts` registers one controller for this module.
//
// **VNPay's two paths are written on their handlers rather than on the class**,
// which is what lets the three live together. A `@Controller` prefix is
// prepended to a contract route as well as to a plain one, and `FR-PAY-02`'s
// address belongs to a stay rather than to a gateway. Spelling the segments out
// twice buys something worth more than it costs: {@link GATEWAY_RETURN_PATH} is
// both the route the payer comes back to and the url handed to the gateway when
// an attempt is opened, so the address VNPay is told to use and the address that
// answers it cannot drift apart.
//
// That is also why this file names a gateway where `payment.service.ts` refuses
// to. `FR-PAY-01` keeps gateway vocabulary out of the *property's* code, and the
// service below the port has never seen a response code; this sits on the other
// side of that line, at the edge where VNPay's protocol is the only language
// spoken. `FR-PAY-06`'s second gateway is a second controller beside this one,
// exactly as it is a second adapter beside `vnpay.adapter.ts` — and the service
// between them does not change either time.
//
// **Both of the gateway's are `GET`, because that is how VNPay calls them.** The
// IPN arrives with the whole transaction in the query string and the payer's
// return is a browser redirect carrying the same parameters; neither has a body,
// and a `POST` handler for either would be a route the gateway can never reach.
// The address of each is registered per terminal in VNPay's merchant admin —
// `docs/architecture/infrastructure.md` §Payments — so staging and production
// name the same two paths under their own `API_URL`.
//
// **Neither of those two can hold a session, and the decorator says which
// credential stands in.** The gateway has no account here and the payer arrives
// redirected from somebody else's site, so `rbac-matrix.md` §2's
// deny-by-default has to be answered with something other than a capability.
// For the IPN it is the signature, verified inside the maintained library
// behind the port — that *is* the authentication, and it is why an unsigned
// callback is refused rather than filed as a failed payment. For the return it
// is weaker and the route is built to need less: a signed redirect proves the
// gateway sent the payer, and nothing below acts on it.
//
// **What the IPN's answer means.** `RspCode` is not a verdict on the payment. It
// says whether this property received the notification and finished acting on
// it, which is why a payment VNPay refused is acknowledged `00` just as one it
// took is: both were understood, and both were filed. Only `00` and `02` end the
// conversation; every other code asks VNPay to deliver it again, which is the
// right answer to an outage and to a disagreement a person has to settle.
//
// The pairs themselves come from the library rather than being written out here.
// `FR-PAY-02` puts VNPay's own constants inside the package that maintains them,
// and a `Message` retyped by hand is a string that drifts from the specification
// without anything noticing.
//
// `IpnIpProhibited` is the one documented code this file never sends. VNPay
// allows a merchant to restrict callbacks to a list of source addresses, and
// this property does not keep one: the list would be VNPay's own egress ranges,
// maintained here, failing closed on the day they change — against an attacker
// who still could not produce a signature.

import { contract } from "@mariva/shared";
import { Controller, Get, Inject, Ip, Query, Redirect } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import {
  InpOrderAlreadyConfirmed,
  IpnFailChecksum,
  IpnInvalidAmount,
  IpnOrderNotFound,
  IpnSuccess,
  IpnUnknownError,
} from "vnpay";
import {
  RequiresCapability,
  Unguarded,
} from "../../common/auth/access.decorators.js";
import { ENV, type Env } from "../../config/env.js";
import {
  type CallbackOutcome,
  disagreementOf,
  PaymentService,
} from "./payment.service.js";
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "./ports/payment-gateway.port.js";

/**
 * VNPay's acknowledgement, as its IPN specification defines the pair.
 *
 * Declared here rather than imported so that the handlers state what they
 * return; the library's constants satisfy it structurally, and nothing in this
 * file builds one of its own.
 */
interface Acknowledgement {
  readonly RspCode: string;
  readonly Message: string;
}

/**
 * Where VNPay posts its report of an attempt. Registered per terminal in the
 * merchant admin, so changing it is a deployment step and not only an edit.
 */
const GATEWAY_IPN_PATH = "payments/vnpay/ipn";

/**
 * Where VNPay sends the payer's browser afterwards — read twice, and that is the
 * point of naming it.
 *
 * Once as the route that answers, and once as the `returnUrl` given to the
 * gateway on every attempt this property opens. Two literals would be two
 * strings that agree until somebody moves the route, at which point every payer
 * would be redirected to a 404 with their payment already taken.
 */
const GATEWAY_RETURN_PATH = "payments/vnpay/return";

/**
 * Where the payer is handed back to on the site they started from.
 *
 * The booking funnel, which is the page they left — not a page of its own. A
 * screen that reads the two parameters below is the guest funnel's to build, and
 * until it does the payer lands back where they were rather than on a 404, which
 * is the failure mode worth choosing between.
 */
const PAYER_RETURN_PATH = "/booking";

/**
 * What the payer's browser is told, which is a caption and not a fact about
 * money.
 *
 * `confirming` and not `paid`, and the difference is the whole point of this
 * route. The redirect can and does beat the IPN — they are two independent
 * deliveries of the same claim — so a browser arriving here has been told by the
 * gateway that it took the money, and this property has not yet finished
 * agreeing. A page that said "paid" would be a receipt issued by whoever
 * happened to arrive first.
 */
type Caption = "confirming" | "refused" | "unfinished" | "unverified";

/** What each outcome the gateway signs reads as to the payer. */
const CAPTIONS: Readonly<Record<"SUCCESS" | "FAILED" | "PENDING", Caption>> = {
  SUCCESS: "confirming",
  FAILED: "refused",
  PENDING: "unfinished",
};

/** A 303 rather than a 302: the answer is at another address, and no browser
 *  or proxy may cache this one as though it were the page. */
const SEE_THE_FUNNEL = 303;

// No prefix, and the header says why: a prefix here would be prepended to the
// contract route as well, and that route's address belongs to a stay.
@Controller()
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    // The port, and never the adapter — `FR-PAY-01`. The return route needs a
    // signature checked and nothing else, and the one method that does it is
    // already on the port: `PaymentGateway.verifyCallback` states outright that
    // the webhook and the payer's return are the same claim over the same
    // signature, and that which of them the property *acts* on is the caller's
    // policy. This is that policy, and it is to act on one of them.
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(PaymentController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The desk asking a gateway to collect against a stay — `FR-PAY-02`.
   *
   * **The handler adds no rule of its own, and that is deliberate.**
   * {@link PaymentService.createPaymentRequest} already refuses an amount of
   * nothing or less, and refuses it before a row is written or a payer is sent
   * anywhere; both refusals carry an `ORPCError` and reach the caller as the 400
   * they were written to be. A copy of either check here would be a second place
   * for one decision to live, and the two would agree until one was reworded.
   *
   * **Two of the five fields the service needs are the request's, not the
   * body's.** A caller that could name its own `returnUrl` could send the payer
   * anywhere afterwards, on a page carrying the gateway's own signed parameters —
   * so the address is this property's, built from the route below. A caller that
   * could state its own address would be choosing what the gateway screens it
   * for, which is a fraud signal that means nothing; so it is read off the
   * connection.
   *
   * What comes back says where to send the payer and what this property will
   * call the attempt afterwards. It says nothing about money having moved:
   * `contract/payment.ts` argues that at length, and the row this just committed
   * is `PENDING` until a callback resolves it.
   */
  @RequiresCapability("payment.open-attempt")
  @Implement(contract.payment.openAttempt)
  openAttempt(@Ip() payerIpAddress: string) {
    return implement(contract.payment.openAttempt).handler(async ({ input }) =>
      this.payments.createPaymentRequest({
        bookingId: input.bookingId,
        amount: input.amount,
        description: input.description,
        returnUrl: this.gatewayReturnUrl(),
        payerIpAddress,
      }),
    );
  }

  /**
   * The gateway's own report of what became of an attempt — the delivery this
   * property acts on.
   *
   * The callback is handed to the service exactly as it arrived, because the
   * signature is computed over the parameters as sent and anything this handler
   * reshaped first would verify against nothing. Nothing here reads a field of
   * it before {@link PaymentService.handleIpn} has authenticated it.
   *
   * Nothing thrown leaves this route. VNPay reads `RspCode` out of a 200 and a
   * merchant that answers a 500 has told it nothing it can act on — so every
   * failure below, including the ones that are this property's fault, becomes a
   * documented pair and a log line.
   */
  @Unguarded(
    "VNPay's IPN — the gateway holds no session of this property's, and the " +
      "signature the maintained library verifies on the callback is what " +
      "stands in for one",
  )
  @Get(GATEWAY_IPN_PATH)
  async ipn(
    @Query() callback: Record<string, unknown>,
  ): Promise<Acknowledgement> {
    try {
      return this.acknowledge(await this.payments.handleIpn(callback), callback);
    } catch (error) {
      return this.refuse(error, callback);
    }
  }

  /**
   * Where the gateway sends the payer's browser when they are finished.
   *
   * **This route makes no decision about money and must not.** The IPN above is
   * the authority: it is the delivery VNPay retries until it is acknowledged, it
   * arrives whether or not the payer's browser survived the round trip, and it
   * is the one this property posts from. What arrives here is a person, on a url
   * they could bookmark, at a moment that may be before or after the money has
   * been confirmed. Nothing below writes a row, reads an account, or resolves an
   * attempt.
   *
   * The signature is still checked, and for a reason that is not bookkeeping: an
   * unverified redirect is a link anybody can compose, and following it into a
   * page that says the stay is paid is a lie a stranger got to write. So only
   * what the gateway signed is carried onward, and an unsigned redirect carries
   * nothing at all — not even the reference, which on that path is a string
   * somebody else chose.
   */
  @Unguarded(
    "VNPay's return url — the payer's browser arrives redirected from the " +
      "gateway with no session, and the gateway's signature is the only thing " +
      "vouching for what it carries. Nothing here acts on money",
  )
  @Get(GATEWAY_RETURN_PATH)
  @Redirect()
  async payerReturn(
    @Query() redirect: Record<string, unknown>,
  ): Promise<{ url: string; statusCode: number }> {
    const verification = await this.gateway.verifyCallback(redirect);

    if (!verification.verified) {
      this.logger.warn(
        named(redirect),
        "a payer returned on a redirect the gateway did not sign",
      );

      return this.handBack("unverified");
    }

    const { transaction } = verification;

    return this.handBack(CAPTIONS[transaction.status], transaction.reference);
  }

  /**
   * What VNPay is told about a callback this property acted on.
   *
   * Four outcomes and three answers. `RECORDED` and `REFUSED` are both `00`
   * because the code reports receipt rather than payment — the gateway's report
   * was understood and filed, and which way it pointed is the property's
   * business. `STILL_OPEN` is `00` for a narrower reason: a retry redelivers the
   * same signed payload, so asking for it again could only produce the same
   * snapshot, and the terminal outcome arrives later as its own notification
   * rather than as a retry of this one.
   *
   * `ALREADY_RECORDED` is the redelivery, and it is `02` rather than `00`. Both
   * end the conversation, and `02` is the protocol's own word for a notification
   * about an order this merchant has already confirmed — which is what happened,
   * and is not a failure. Answering `00` would be accurate about the money and
   * silent about the fact that nothing was written this time.
   */
  private acknowledge(
    outcome: CallbackOutcome,
    callback: Record<string, unknown>,
  ): Acknowledgement {
    switch (outcome) {
      case "RECORDED":
        this.logger.info(
          named(callback),
          "a gateway callback became a payment and a line on the account",
        );

        return IpnSuccess;

      case "ALREADY_RECORDED":
        // Deliberately not a warning. A gateway is entitled to keep asking
        // until it is told, and a redelivery logged as a fault is an alert
        // that fires on the protocol working.
        this.logger.info(
          named(callback),
          "a gateway callback was delivered again and the payment is already on file",
        );

        return InpOrderAlreadyConfirmed;

      case "REFUSED":
        this.logger.info(
          named(callback),
          "the gateway reports it refused this attempt, and the refusal is on file",
        );

        return IpnSuccess;

      case "STILL_OPEN":
        this.logger.info(
          named(callback),
          "the gateway reports this attempt is still open, so nothing was written",
        );

        return IpnSuccess;
    }
  }

  /**
   * What VNPay is told about a callback this property would not act on.
   *
   * Every refusal the service raises carries an `ORPCError` code, and the three
   * it can raise map onto three of VNPay's own: a callback nobody signed is a
   * checksum failure, a reference naming no attempt of this property's is an
   * order it does not have, and a disagreement is neither — see below.
   *
   * Everything else is `99`, and that includes the failures that are this
   * property's own: a database that went away mid-callback, or a process with no
   * terminal configured. `99` asks VNPay to deliver the notification again,
   * which is exactly the recovery those two want. It is the ceiling on this
   * handler rather than a case, so a refusal added to the service tomorrow
   * without a line here answers something safe.
   */
  private refuse(
    error: unknown,
    callback: Record<string, unknown>,
  ): Acknowledgement {
    if (error instanceof ORPCError) {
      switch (error.code) {
        case "UNAUTHORIZED":
          // The route is unguarded on purpose, so most of what fails here is
          // traffic rather than money — a crawler, a scan, a stale link. Loud
          // enough to count, quiet enough not to page anybody.
          this.logger.warn(
            named(callback),
            "a callback arrived without the gateway's signature",
          );

          return IpnFailChecksum;

        case "NOT_FOUND":
          this.logger.warn(
            named(callback),
            "a signed callback names no attempt this property opened",
          );

          return IpnOrderNotFound;

        case "CONFLICT":
          return this.contradicted(error, callback);
      }
    }

    this.logger.error(
      { ...named(callback), err: error },
      "a gateway callback could not be acted on at all",
    );

    return IpnUnknownError;
  }

  /**
   * A callback the property will not act on because it contradicts what is
   * already on file — the case nobody was seeing until this route existed.
   *
   * Loud on every reading of it. Nothing was posted, the attempt is sitting in a
   * state a person has to resolve, and the sentence the service wrote is the one
   * that says which — so it is carried into the log rather than restated here.
   *
   * `04` only for the amount, and this is why the service names the
   * disagreement rather than leaving three refusals sharing one status and one
   * paragraph of English. `Invalid amount` is a diagnosis offered to VNPay, and
   * offering it for a contradiction about the *outcome* — a success reported
   * over a refusal already filed — would be this property asserting something it
   * has not established. Those answer `99`, which claims nothing except that the
   * notification could not be acted on.
   */
  private contradicted(
    error: ORPCError<string, unknown>,
    callback: Record<string, unknown>,
  ): Acknowledgement {
    const disagreement = disagreementOf(error.data);

    this.logger.error(
      { ...named(callback), disagreement, reason: error.message },
      "a gateway callback contradicts this property's record — nothing was posted",
    );

    return disagreement === "AMOUNT" ? IpnInvalidAmount : IpnUnknownError;
  }

  /**
   * The address the gateway is told to send the payer back to.
   *
   * Absolute, because it leaves this process and is read by somebody else's
   * server. `API_URL` is where this API answers as the browser sees it, and the
   * path is rooted rather than resolved against it: Nest mounts every route at
   * the origin's root, so a base carrying a path of its own would produce a url
   * no route here answers.
   */
  private gatewayReturnUrl(): string {
    return new URL(`/${GATEWAY_RETURN_PATH}`, this.env.API_URL).toString();
  }

  /** The payer, sent on to the site with a caption and nothing else. */
  private handBack(
    caption: Caption,
    reference?: string,
  ): { url: string; statusCode: number } {
    const url = new URL(PAYER_RETURN_PATH, this.env.WEB_ORIGIN);

    url.searchParams.set("payment", caption);

    if (reference) {
      url.searchParams.set("reference", reference);
    }

    return { url: url.toString(), statusCode: SEE_THE_FUNNEL };
  }
}

/**
 * The fields of a callback worth a log line, and no others.
 *
 * Never the callback itself. It carries `vnp_SecureHash` alongside the payer's
 * bank and card type, and `vnpay.adapter.ts` switches the library's own logger
 * off rather than pointing it somewhere for exactly that reason. These five
 * identify the delivery, tie it to a row and to VNPay's merchant screen, and say
 * what it claimed — which is what a person triaging one needs and the end of
 * what they need.
 *
 * Read before anything has been verified, so every one of them is whatever
 * arrived on the wire and none of them is trusted for more than a log.
 */
function named(callback: Record<string, unknown>): Record<string, string | undefined> {
  return {
    reference: text(callback.vnp_TxnRef),
    gatewayTransactionId: text(callback.vnp_TransactionNo),
    responseCode: text(callback.vnp_ResponseCode),
    transactionStatus: text(callback.vnp_TransactionStatus),
    reportedAmount: text(callback.vnp_Amount),
  };
}

/** A query parameter as text, or nothing if it is not one thing a payer sent. */
function text(reported: unknown): string | undefined {
  return typeof reported === "string" || typeof reported === "number"
    ? String(reported)
    : undefined;
}
