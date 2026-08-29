// One payment's whole conversation: where the property asks for the money —
// `FR-PAY-02` — where the gateway reports what became of it and where the payer
// lands, which is `FR-PAY-03`, where somebody reads back the nights on which the
// gateway's report and this property's ledger did not agree, `FR-PAY-05`, and
// where they read the payments themselves.
//
// **Two of the six are VNPay's routes, and the file is shaped by that.**
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
// **The other four are the property's own, and they are the ones that hold a
// capability.** Opening an attempt is asking a gateway to collect against a
// stay; listing the nights that were reconciled and reading one of them is the
// accountant asking what the sweep found; listing the payments is the same
// person asking what the property was actually paid, which until that route
// existed nothing outside this module could see. In all four the caller is on
// this property's side of the wire, the shape is this property's to choose, and
// `rbac-matrix.md` §2 governs them. So they are declared in
// `contract/payment.ts` and guarded by `payment.open-attempt` and
// `payment.reconcile`. They are answered here rather than beside the folio
// because the attempt, the callback that resolves it and the night that checks
// both are one conversation — and because `payment.module.ts` registers one
// controller for this module.
//
// **One route here holds no capability at all and is not the gateway's**, and
// it is the listing of the gateways this deployment can collect through. It has
// no subject: it names no stay, reads no session and answers the same sentence
// to everybody, because what it reports is which adapters this process has
// bound. That is what `access.decorators.ts` admits as unguarded — a route with
// no subject at all — and it is why the funnel may ask it before a guest has
// typed anything. What it forecloses is the alternative the funnel had, which
// was to draw a provider as choosable on a guess and let
// `ports/gateway-registry.ts`'s internal refusal be the sentence a guest reads
// after they have pressed the button.
//
// **Opening an attempt is the one route here a guest can reach**, and the row
// grants the guest realm `⚠` rather than `✅`: the desk collects against any
// stay, and a guest only against the one they booked. `roles.ts` is explicit
// that `⚠` passes the guard with the condition attached, so the scope is owed
// below the guard rather than at it — the account comes off the session in the
// handler and `payment.service.ts` settles it in the query, where the route's
// other refusals already are. The four staff roles that hold the row hold it
// `✅` and are not scoped at all, which is not an omission: a walk-in belongs to
// no account, and a receptionist taking their card is the ordinary use of this
// route.
//
// **The three routes under `payment.reconcile` are declared as reads**, which
// is the second argument to `@RequiresCapability` and not a comment. The row
// grants `full` to the three roles that hold it, so nothing is refused today
// that would otherwise be admitted; it is declared anyway, because the day the
// matrix hands somebody a 👁 over gateway reconciliation — an auditor, a night
// manager — these must be the routes that let them look, and not the routes
// that refuse them. `folio.controller.ts` makes the same argument about its own
// read.
//
// The payment list is the third of them and takes no key of its own. The row is
// this property's money as the payer's side reports it, and a payment row is
// less than the disagreement the day's read already hands the same caller about
// the same attempt — `contract/payment.ts` argues that where the route is
// declared.
//
// None of the three writes, and there is deliberately no route here that does.
// `schema/reconciliation.ts` keeps the table append-only because a row is an
// observation of what a day looked like when it was looked at; a route that
// acknowledged, resolved or corrected one would be editing the evidence. Sweeping
// a night again is `jobs.ts`'s trigger, under the capability that already governs
// a sweep.
//
// **VNPay's two paths are written on their handlers rather than on the class**,
// which is what lets the four live together. A `@Controller` prefix is
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
  CurrentPrincipal,
  RequiresCapability,
  Unguarded,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import { ENV, type Env } from "../../config/env.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import {
  type CallbackOutcome,
  disagreementOf,
  type ListedPayment,
  PaymentService,
} from "./payment.service.js";
import { GatewayRegistry } from "./ports/gateway-registry.js";
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "./ports/payment-gateway.port.js";
import type {
  ObservedDiscrepancy,
  ReconciledDay,
  ReconciliationRunSummary,
} from "./reconciliation.service.js";
import { ReconciliationService } from "./reconciliation.service.js";

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
 * Which of the property's payment methods the two routes below speak for.
 *
 * A callback route has exactly one gateway posting to it — the paths, the
 * parameter names and the signature scheme in this file are all VNPay's — so
 * this file is the only thing in the request that can say which provider is
 * speaking, and `payment.service.ts` needs it said: the adapter that
 * authenticates a callback is resolved from it, and the attempt a callback may
 * resolve is narrowed by it.
 *
 * The property's own vocabulary rather than a gateway's, which is what keeps it
 * from being the leak `FR-PAY-01` forbids. `payment_method` is a list of ways
 * money reaches the desk; what crosses into the service is a member of that
 * list, and nothing on the far side learns a host, a checksum or a response
 * code from it. `FR-PAY-06`'s second gateway declares its own beside its own
 * two paths, in its own controller.
 */
const GATEWAY_METHOD = "VNPAY";

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
 * `repository-structure.md` §`(booking)` names this route and says why it is
 * not the confirmation: the redirect and the IPN are two independent deliveries
 * of one claim, and the browser can arrive first. So the payer lands on a screen
 * that resolves — which is this one — and the confirmation is the stay's own
 * page once it does.
 *
 * The hold is in the path because every funnel step after the second has it
 * there, and the screen needs it to ask what became of the stay. It is taken
 * from the reference the gateway signed rather than from anything the payer
 * could edit; {@link stayInReference} is where that is unpacked.
 */
const PAYER_RETURN_PATH = "/booking/:hold/confirming";

/**
 * Where a payer goes when the redirect carried no reference this property can
 * read — an unsigned link, or a signed one naming an attempt in a shape this
 * property never mints.
 *
 * The funnel's own front door, which is the honest answer: without a reference
 * there is no stay to show a page about, and the guest's booking, if they have
 * one, is reachable from their account. The caption travels with them so the
 * screen can say why they are here rather than showing a bare search.
 */
const PAYER_FALLBACK_PATH = "/booking";

/** The characters of a reference that are the booking's id — `payment.service.ts`. */
const STAY_HEX_LENGTH = 32;

/** That half, and only if it is what a uuid with its hyphens taken out looks like. */
const STAY_HEX_PATTERN = new RegExp(`^[0-9a-f]{${STAY_HEX_LENGTH}}$`);

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
    private readonly reconciliations: ReconciliationService,
    // The boundary the two-statement read below is taken inside, opened here
    // because that is where `transaction-runner.ts` puts every one of them and
    // a service opens none — and not because it buys a snapshot. It does not:
    // the runner takes Drizzle's default `read committed`, so the run row and
    // the discrepancies under it are still two statements at two moments.
    // Their answer is coherent for a reason that belongs to the writer rather
    // than to this boundary — `reconciliation.job.ts` commits a run row and
    // that night's discrepancies together, writing the run last — so a run this
    // read can see is one whose rows it can see too.
    private readonly transactions: TransactionRunner,
    // The port, and never the adapter — `FR-PAY-01`. The return route needs a
    // signature checked and nothing else, and the one method that does it is
    // already on the port: `PaymentGateway.verifyCallback` states outright that
    // the webhook and the payer's return are the same claim over the same
    // signature, and that which of them the property *acts* on is the caller's
    // policy. This is that policy, and it is to act on one of them.
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    // Every adapter this deployment bound, for the one route below that
    // reports them. The registry is asked rather than the environment, so
    // what the funnel is told and what an attempt will actually resolve are
    // one fact read twice — `payment.module.ts` is the only place either is
    // decided.
    private readonly registry: GatewayRegistry,
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(PaymentController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Which gateways this deployment can actually collect through.
   *
   * **Read off the registry rather than off the environment**, because the
   * registry is what an attempt will be resolved against a moment later —
   * `payment.module.ts` decides both from one predicate, and a second reading
   * of the credentials here would be a fact this property held twice.
   *
   * **Unguarded, and it costs the sentence `access.decorators.ts` asks for.**
   * The route has no subject: it names no stay, reads no session and answers
   * identically to everybody, which is the same standing the liveness probe
   * has. What it discloses is which payment providers the property collects
   * through, which is written on the funnel's own payment step for every guest
   * who reaches it.
   *
   * The order is the registry's, which is the contract's own list — so two
   * reads answer the same way and a screen drawing tiles from it does not
   * reshuffle them between paints.
   */
  @Unguarded(
    "the gateways this deployment collects through — a fact about the server " +
      "with no subject and no session, and the same sentence the funnel's " +
      "payment step shows every guest",
  )
  @Implement(contract.payment.gateways)
  gateways() {
    return implement(contract.payment.gateways).handler(async () =>
      await Promise.resolve({
        methods: this.registry.all().map(([method]) => method),
      }),
    );
  }

  /**
   * Asking a gateway to collect against a stay — `FR-PAY-02`.
   *
   * **The handler adds no rule of its own, and that is deliberate.**
   * {@link PaymentService.createPaymentRequest} already refuses an amount of
   * nothing or less, refuses an id that is not a booking's, refuses a guest a
   * stay that is not theirs, and refuses a guest any amount but what that stay
   * was quoted — each before a row is written or a payer is sent anywhere, and
   * each carrying an `ORPCError` that reaches the caller as the status it was
   * written to be. A copy of any of them here would be a second place for one
   * decision to live, and the two would agree until one was reworded.
   *
   * **Three of the six fields the service needs are the request's, not the
   * body's.** A caller that could name its own `returnUrl` could send the payer
   * anywhere afterwards, on a page carrying the gateway's own signed parameters —
   * so the address is this property's, built from the route below. A caller that
   * could state its own address would be choosing what the gateway screens it
   * for, which is a fraud signal that means nothing; so it is read off the
   * connection.
   *
   * The third is the account, and it is the same rule read at its sharpest.
   * `rbac-matrix.md` grants this row `⚠` to the guest realm — the guard admits a
   * signed-in guest and leaves the scope to be finished below — and an account
   * id a caller could send would be that scope choosing itself. So it comes off
   * the session, and what the handler does with it is pass it on: `⚠` is a
   * condition, not a check, and the place a condition on which rows a caller may
   * name is settled is the query, which is the service's.
   *
   * What comes back says where to send the payer and what this property will
   * call the attempt afterwards. It says nothing about money having moved:
   * `contract/payment.ts` argues that at length, and the row this just committed
   * is `PENDING` until a callback resolves it.
   */
  @RequiresCapability("payment.open-attempt")
  @Implement(contract.payment.openAttempt)
  openAttempt(
    @Ip() payerIpAddress: string,
    @CurrentPrincipal() principal: Principal | null,
  ) {
    return implement(contract.payment.openAttempt).handler(async ({ input }) =>
      this.payments.createPaymentRequest({
        bookingId: input.bookingId,
        // The one field of the six the caller genuinely chooses, and it is
        // carried through rather than decided here. `FR-PAY-06` makes the
        // gateway a per-attempt question and the contract defaults it to the
        // one the property already had, so a caller that predates the second
        // provider is answered exactly as before — the handler adds no rule of
        // its own, which is the argument the paragraph above makes about every
        // other refusal on this route.
        method: input.method,
        amount: input.amount,
        description: input.description,
        returnUrl: this.gatewayReturnUrl(),
        payerIpAddress,
        guestAccountId: guestAccount(principal),
        provenBookingId: provenBooking(principal, input.bookingId),
      }),
    );
  }

  /**
   * The nights that were held against the gateway's report, and how much of each
   * one disagreed — `FR-PAY-05`, read back.
   *
   * **A day with nothing on it is still listed, and that is the whole reason
   * this answers from the run table rather than from the discrepancies.**
   * `schema/reconciliation.ts` writes nothing at all for an attempt the two
   * reports agree on, so a list drawn from `payment_discrepancy` would show only
   * the bad nights — and a night missing from it could equally be a clean one or
   * one the sweep never reached. Those are opposite facts, and only a run row
   * tells them apart.
   *
   * Both bounds are optional and the service assembles whichever arrived; the
   * contract says why absent is a better default than a window invented here.
   *
   * `hasMore` is carried through rather than recomputed. The service applies
   * the ceiling and is the only thing that knows a day fell past it, and a
   * handler deriving the flag from the length of what it was handed would be
   * guessing at the very case the flag exists for — a list of exactly the
   * ceiling, which is what both a complete answer and a truncated one look
   * like from here.
   */
  @RequiresCapability("payment.reconcile", "read")
  @Implement(contract.payment.listReconciliations)
  listReconciliations() {
    return implement(contract.payment.listReconciliations).handler(
      async ({ input }) => {
        const listed = await this.transactions.run((exec) =>
          this.reconciliations.runs(exec, input),
        );

        return { runs: listed.runs.map(runOnWire), hasMore: listed.hasMore };
      },
    );
  }

  /**
   * What one reconciled night actually found.
   *
   * **A date nobody reconciled is a `NOT_FOUND`, and a date reconciled clean is
   * a 200 with an empty list.** The two are different answers because they are
   * different facts — the sweep has never run against a day it is still trading,
   * and a screen shown an empty list for one would report a night as agreed that
   * nobody has looked at. The refusal names the day so the reader can see which
   * one it is talking about, and says the thing they can act on: the night is
   * outstanding, and `jobs.ts`'s trigger is how it gets swept.
   *
   * The service returns `null` for exactly that case, and this is where it
   * becomes the refusal — a controller's job, because "no row" is a fact and
   * "404" is a protocol.
   */
  @RequiresCapability("payment.reconcile", "read")
  @Implement(contract.payment.readReconciliation)
  readReconciliation() {
    return implement(contract.payment.readReconciliation).handler(
      async ({ input }) => {
        const day = await this.transactions.run((exec) =>
          this.reconciliations.reconciledDay(exec, input.businessDate),
        );

        if (!day) {
          throw new ORPCError("NOT_FOUND", {
            message:
              `No reconciliation has been run for ${input.businessDate.toString()} — ` +
              "either the property is still trading that day or the sweep has " +
              "not reached it yet",
          });
        }

        return dayOnWire(day);
      },
    );
  }

  /**
   * What the property has been paid, narrowed and paged.
   *
   * **The same `payment.reconcile` row as the two reads above, declared as a
   * read for the same reason and adding no key.** That row governs this
   * property's money as the payer's side reports it, which is what a payment row
   * is; and a row here is strictly less than what `readReconciliation` already
   * hands the same caller about the same attempt — both figures, the
   * classification and the payment it names. So nothing is reachable through
   * this route that the key did not already open. What `rbac-matrix.md` §2
   * forbids is one route whose authority turns on its body, and this one has
   * none.
   *
   * **No realm check below it, unlike `folio.controller.ts`'s collection.** That
   * one owes a check because `folio.read` grants the guest realm a conditional
   * scope the guard cannot finish; this row is `denied` for that realm outright,
   * so a guest is refused by the guard before the handler exists to them. A copy
   * of that refusal here would be a second decision about a question the matrix
   * has already answered — and the two would agree until the row moved.
   *
   * **Wrapped in a transaction**, for the argument the folio list makes: the
   * page and the count over it are two statements printed side by side, and on
   * two connections they would be two moments — a table of nineteen rows under a
   * heading that says twenty. The rollover hour the days are derived from is
   * read on the same connection for the same reason.
   */
  @RequiresCapability("payment.reconcile", "read")
  @Implement(contract.payment.list)
  listPayments() {
    return implement(contract.payment.list).handler(async ({ input }) => {
      const page = await this.transactions.run((exec) =>
        this.payments.list(exec, {
          bookingId: input.bookingId,
          businessDate: input.businessDate,
          method: input.method,
          status: input.status,
          limit: input.limit,
          offset: input.offset,
        }),
      );

      return {
        payments: page.payments.map(paymentOnWire),
        total: page.total,
      };
    });
  }

  /** A refund worklist with none of reconciliation's sensitive columns. */
  @RequiresCapability("folio.refund-policy", "read")
  @Implement(contract.payment.listRefundCandidates)
  listRefundCandidates() {
    return implement(contract.payment.listRefundCandidates).handler(
      async ({ input }) => {
        const page = await this.transactions.run((exec) =>
          this.payments.listRefundCandidates(exec, input),
        );

        return {
          payments: page.payments.map((row) => ({
            ...row,
            paidAt: row.paidAt.toISOString(),
          })),
          total: page.total,
        };
      },
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
      return this.acknowledge(
        await this.payments.handleIpn(callback, GATEWAY_METHOD),
        callback,
      );
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

  /**
   * The payer, sent on to the site with a caption and nothing else.
   *
   * The caption is what the gateway told the browser, and the screen it lands
   * on treats it as a caption rather than as a fact — the note on {@link Caption}
   * says why. The reference travels beside it because a support question about
   * a payment starts from that string, and because the screen has to ask about
   * one attempt rather than about the stay in general.
   *
   * A reference this property cannot read a stay out of sends the payer to the
   * funnel's door instead of composing a url with an empty segment in it, which
   * would be a 404 built by this property out of its own bad input.
   */
  private handBack(
    caption: Caption,
    reference?: string,
  ): { url: string; statusCode: number } {
    const stay = reference ? stayInReference(reference) : undefined;

    const url = new URL(
      stay ? PAYER_RETURN_PATH.replace(":hold", stay) : PAYER_FALLBACK_PATH,
      this.env.WEB_ORIGIN,
    );

    url.searchParams.set("payment", caption);

    if (reference) {
      url.searchParams.set("reference", reference);
    }

    return { url: url.toString(), statusCode: SEE_THE_FUNNEL };
  }
}

/**
 * The stay a reference was minted for, as the uuid the funnel addresses it by.
 *
 * `payment.service.ts` mints a reference as the booking's id in bare hex
 * followed by a nonce, and this is the only place that half is read back. What
 * it is read for matters: an address to send a browser to, and not an authority
 * over anything. The screen it lands on asks the API what became of that stay
 * under the guest's own session, and `booking.read-own` refuses a stay that is
 * not theirs — so a payer who edited the segment would be looking at a 404
 * rather than at somebody else's booking.
 *
 * Nothing here trusts the string beyond its shape. A reference the gateway did
 * not sign never reaches this — `payerReturn` drops it — and one that is signed
 * but not in this property's shape produces nothing, which sends the payer to
 * the funnel's door rather than to a url with a malformed segment in it.
 */
function stayInReference(reference: string): string | undefined {
  const stay = reference.slice(0, STAY_HEX_LENGTH);

  if (!STAY_HEX_PATTERN.test(stay)) {
    return undefined;
  }

  // Back into the shape a uuid is written in — 8-4-4-4-12 — because that is
  // what the route's parameter is and what the API will be asked about.
  return [
    stay.slice(0, 8),
    stay.slice(8, 12),
    stay.slice(12, 16),
    stay.slice(16, 20),
    stay.slice(20),
  ].join("-");
}

/**
 * The account an attempt has to be scoped to, or null when it does not.
 *
 * Null for the desk, and that is the answer rather than a gap: every staff role
 * holding `payment.open-attempt` holds it `full`, and a receptionist taking a
 * walk-in's card is collecting against a stay that belongs to no account at all.
 * Scoping them would refuse the ordinary use of the route.
 *
 * Null is also what an unauthenticated caller would produce, and that is
 * unreachable rather than trusted: the row is not the public one, so the guard
 * answers a request with no session at all with a 401 before this runs.
 *
 * Declared here rather than imported from `booking.controller.ts`, which owns
 * one of the same shape. `folio.controller.ts` and `housekeeping.controller.ts`
 * each keep their own for the reason that file gives: a shared helper would be
 * one module's session rule governing another's writes.
 */
function guestAccount(principal: Principal | null): string | null {
  return principal?.realm === "guest" ? principal.userId : null;
}

/**
 * The one stay a booking-scoped caller has proved, when that is the authority
 * they hold.
 *
 * The funnel takes a booking from somebody who never signed up — the hold
 * issues them a credential naming that stay and nothing else — and this is the
 * route where they pay for it. There is no account to scope by, so the scope is
 * the booking itself, and it is settled here from the credential before the
 * service is asked anything: a token minted for one stay naming another is
 * refused on its face, with no lookup behind the refusal to leak whether the id
 * exists.
 *
 * `undefined` for everybody else, which is what leaves the two existing
 * authorities exactly as they were — an account scopes by `user_id`, the desk
 * is unscoped.
 */
function provenBooking(
  principal: Principal | null,
  bookingId: string,
): string | undefined {
  if (principal?.realm !== "booking") {
    return undefined;
  }

  if (principal.bookingId !== bookingId) {
    throw new ORPCError("FORBIDDEN", {
      message: "This link opens only the booking it was issued for",
    });
  }

  return principal.bookingId;
}

/**
 * A run as the wire carries it — the instant into ISO-8601.
 *
 * The business date is already the nine characters the column holds, and the
 * đồng on a discrepancy stay `bigint`: the serialiser under the contract writes
 * one out as decimal text on its own, which is what `money.ts` says a response
 * declares. Only the instants need turning, and they are turned here rather than
 * in the service so that nothing below the route has to know a wire exists —
 * `folio.controller.ts` draws the same line in the same place.
 */
function runOnWire(run: ReconciliationRunSummary) {
  return { ...run, reconciledAt: run.reconciledAt.toISOString() };
}

/** One reconciled day, the same way. */
function dayOnWire(day: ReconciledDay) {
  return {
    businessDate: day.businessDate,
    reconciledAt: day.reconciledAt.toISOString(),
    discrepancies: day.discrepancies.map(discrepancyOnWire),
  };
}

function discrepancyOnWire(discrepancy: ObservedDiscrepancy) {
  return { ...discrepancy, observedAt: discrepancy.observedAt.toISOString() };
}

/**
 * One payment as the wire carries it — the instant into ISO-8601, and null
 * kept as null.
 *
 * The đồng stay `bigint`: the serialiser under the contract writes one out as
 * decimal text on its own, which is what `money.ts` says a response declares and
 * the one crossing that cannot round a figure. The business date is already the
 * nine characters a date is spelled with, because the service derived it into
 * them.
 */
function paymentOnWire(row: ListedPayment) {
  return { ...row, paidAt: row.paidAt?.toISOString() ?? null };
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
