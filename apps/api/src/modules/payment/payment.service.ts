// The property's half of the conversation with whoever moves its money —
// `FR-PAY-01` and `FR-PAY-03`.
//
// Two acts, and they are not symmetrical. Opening an attempt is a request the
// property makes, on its own timing, and can simply make again. Acting on a
// callback is a claim somebody else makes about money that has already moved,
// arriving unauthenticated on a route anyone may post to, possibly more than
// once. Nearly everything below is about the second.
//
// **The reference is the whole of the correlation.** It is minted from the
// booking's own id and a nonce, committed on the row the attempt opens, and
// handed to the gateway; a callback arrives carrying it and nothing else this
// property wrote. It names one attempt, and `payment.attempt_reference` is what
// it is matched on — matching on it is how a `PENDING` row becomes the payment
// rather than sitting beside it forever.
//
// The booking's id is the first half because a question about a payment starts
// from a stay, and an operator holding a reference off a gateway's merchant
// screen should be able to get back to one. Nothing is *resolved* through that
// half: the attempt's row already names the folio, so a callback reads the
// account off the row it claims rather than off the string it arrived in.
//
// Not the guest-facing booking reference either. `PaymentAttempt` says a stay
// may be paid more than once and that a replayed callback has to resolve to one
// attempt; the nonce is what makes the reference name the attempt rather than
// the stay.
//
// Nothing is trusted from it. The gateway signs the reference it echoes back —
// `FR-PAY-02` — so a payer cannot aim a callback at a stay of their choosing,
// and a string that is not in the shape this file mints names no attempt of
// this property's and is refused before a connection is spent on it.
//
// **The attempt is committed before the payer is sent anywhere.** The row goes
// in first, in its own short transaction, and the gateway is asked afterwards
// with nothing held open across the round trip — `database.module.ts` sizes the
// pool at ten, and ten transactions waiting on a gateway is an API that has
// stopped answering anything else.
//
// What that order costs is a `PENDING` row for an attempt whose payment url
// never came back. It costs nothing to carry: the row already means "money
// claimed and not yet confirmed", which is indistinguishable from the payer who
// opened checkout and closed the tab, and no callback will ever name it.
//
// What it buys is that every callback that can arrive has a row to resolve. The
// other order — gateway first, row after — loses the row on exactly the attempts
// whose write failed, and then has to invent the payment from the callback: a
// second insert path, and an amount taken on the gateway's word, because the
// figure the property asked for went down with the transaction that would have
// stored it. There is one write path below, and every amount is compared.
//
// **Idempotency is the database's, and this only reads its answer.**
// `infrastructure.md` §Payments states the fact without hedging: "VNPay may send
// the same IPN more than once. A unique constraint on the gateway transaction id
// is mandatory, not defensive." A handler that selected a row and wrote when it
// found nothing passes a sequential replay ten times out of ten, and takes the
// money twice the first afternoon two callbacks arrive together — between the
// read and the write there is nothing holding the key, so both handlers find
// nothing.
//
// So resolving an attempt is not preceded by a look. It is one conditional
// `UPDATE … where attempt_reference = $1 and status = 'PENDING'`: ten of them at
// once, and the first to reach the row holds its lock until it commits, after
// which the other nine re-evaluate that predicate against the row as it now
// stands, match nothing, and report no rows updated. The two partial unique
// indexes stay in place regardless of what this file does: one attempt is one
// row and one gateway transaction is one payment, and the guarantee `FR-PAY-03`
// asks for belongs in the schema, where it holds for the next caller too.
//
// **No rows updated is a question and not an answer.** All it says is that the
// attempt was not `PENDING`, and there are three reasons for that. It resolved
// the way this callback claims, which is the replay and is the only one of the
// three that is idempotent. It resolved the *other* way — a gateway reporting a
// success over a refusal it filed an hour ago, or a refusal over money already
// on the account. Or there is no such row, and this property did not open the
// attempt at all.
//
// So the row is read back and the three are told apart. Reading it is safe here
// precisely because nothing was written: the `UPDATE` matched nothing, the
// transaction is intact, and the `SELECT` sees whatever the winner committed.
// The replay is answered; the other two write nothing and refuse, because a
// callback that contradicts what is already on file is not something a handler
// should settle on its own authority.
//
// **The payment and its posting are one commit.** They are one fact written in
// two vocabularies — what the payer's side reports, and what the guest's account
// says — and `NFR-02` reconciles the two nightly: Σ postings = Σ payments +
// outstanding. A payment row committed without its posting fails that identity
// every night after, and in the meantime shows a receptionist a balance the
// guest has already settled. So the pair goes through `TransactionRunner`, and a
// ledger that refuses takes the payment row down with it.
//
// **A stay that was being held is confirmed in that same commit**, which is
// `booking-state-machine.md` §3's `HELD → CONFIRMED` and its caption, "deposit
// taken". The desk's route to that transition is behind `booking.write` and no
// guest holds it, so a guest paying for their own hold has no other way to
// reach it — and a hold that stays `HELD` is one `hold-expiry-sweep.ts` cancels
// two minutes later, releasing a room the guest has paid for. Third in the same
// transaction for the same reason as the second: a confirmation that could fail
// on its own would leave money on a folio whose stay is still counting down.
//
// Only a hold moves, and `BookingService.confirmPaidHold` is where that is
// argued. Money arrives at a stay at more than one moment, and a balance taken
// from a guest already in the building is not a transition.
//
// **The posting is dated by the gateway's clock.** `BusinessDateService` is
// asked which trading day `paidAt` fell in, never which day it is now. A
// callback redelivered the next morning, or replayed by hand a week later, has
// to land on the day the money moved; dating it from this process would move a
// figure between two trading days depending on when the gateway got through, and
// `property-and-tariff.md` §2 is about exactly that off-by-one-night.
//
// **The amount is checked against the attempt, and a disagreement posts
// nothing.** A gateway's own integration guidance has a merchant compare the
// figure in a callback against the order it opened, and the row the attempt
// wrote is what makes that possible — on every attempt, because the order above
// leaves no path to a posting that does not go through one. The exposure this
// closes is not forgery — `FR-PAY-02` has the gateway sign the amount, so a
// payer who edits it produces a callback that fails verification and never
// reaches here. It is bookkeeping: a callback that verifies and still names a
// figure nobody asked for is a terminal, a currency scale or a merchant account
// disagreeing with this property, and posting it would put a number on a guest's
// invoice that no attempt of theirs accounts for.
//
// **Money landing on a stay nobody can honour pages somebody, and posts
// anyway.** `BookingService.confirmPaidHold` moves a hold and no-ops on every
// other state, which is right — refusing there would roll back money the
// gateway has already taken — but a no-op that said nothing left the worst of
// those states silent: a stay the property cancelled while the payer was at the
// gateway keeps the money, stays cancelled, and until this existed the only
// thing that would ever surface the pair was `FR-PAY-05`'s nightly comparison.
// Somebody refunds it by hand, and they cannot do that until they know.
//
// The page is registered through `afterCommit` and dispatched by
// `TransactionRunner` once the commit returns. `OpsAlertService.page` is a
// `fetch` with a five-second timeout, and a vendor round trip inside the
// transaction would hold one of ten pooled connections for its length — the
// failure `booking.service.ts` already argues for the confirmation mail. It is
// also the whole of the ordering guarantee: a transaction that rolls back
// throws its queue away unrun, so a posting the ledger refuses pages nobody,
// and a page that goes out is a page about money that is durably on an account.
//
// A redelivery pages nothing of its own for a reason it does not have to
// restate: the replay never reaches the transition. `take` finds the attempt
// already recording this gateway transaction and raises `AlreadyResolved`
// before `confirmPaidHold` is called, so there is no second landing to page
// about — and the rollback that sentinel causes would have discarded one
// anyway.
//
// So it refuses, loudly, and writes nothing at all. The attempt stays `PENDING`,
// which is the honest state — it is exactly the "money claimed and not yet
// confirmed" `schema/payment.ts` defines, and somebody now has to look. No new
// `payment_status` member is invented for it, and none for the contradicted
// attempt above either: `PENDING`, `SUCCESS`, `FAILED` and `REFUNDED` are what
// became of the *money*, both refusals are disagreements about what the money
// was for, and a fifth member would be a state every reader of the table — the
// balance, `NFR-02`'s sum, a guest's invoice — would have to learn in order to
// keep ignoring.

import { randomUUID } from "node:crypto";
import type { StayDate, VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  type SQL,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { folio } from "../../database/schema/folio.js";
import { payment, type PaymentRow } from "../../database/schema/payment.js";
import { paymentDiscrepancy } from "../../database/schema/reconciliation.js";
import { sqlStateOf } from "../../database/sql-state.js";
import {
  afterCommit,
  TransactionRunner,
} from "../../database/transaction-runner.js";
import { BookingService, type PaidStay } from "../booking/booking.service.js";
import {
  type BusinessDateRule,
  BusinessDateService,
} from "../booking/business-date.service.js";
import { FolioService } from "../folio/folio.service.js";
import { OpsAlertService } from "../notification/ops-alert.service.js";
import {
  type GatewayTransaction,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "./ports/payment-gateway.port.js";
// The coarse day bound the reconciliation reads its own ledger side with. One
// definition rather than two, so a payment listed under a trading day and the
// same payment compared against the gateway's report of that day are drawn from
// the same range.
import { startOfDayUtc } from "./reconciliation.service.js";

const UNIQUE_VIOLATION = "23505";

/**
 * The method recorded against everything this service writes.
 *
 * The one place here that names a gateway, and it names the *property's* own
 * vocabulary rather than anything a gateway said: `payment_method` is a list of
 * ways money reaches the desk, and `schema/payment.ts` argues that a second
 * gateway is a second member of it. A constant because the binding is one —
 * `payment.module.ts` points `PAYMENT_GATEWAY` at a single adapter. `FR-PAY-06`
 * is what turns this into a value the binding has to supply, and inventing that
 * parameter before there is a second thing to pass it is a guess at which of the
 * two ends should hold it.
 */
const GATEWAY_METHOD = "VNPAY";

/**
 * What a guest is told about a stay that is not theirs and about one that is not
 * there — the same sentence, said in one place so the two cannot drift apart.
 *
 * `mayCollectFor` argues why they read alike: a reply that separated them would
 * confirm which ids name real stays to a caller holding one they should not
 * have.
 */
const NO_STAY_OF_YOURS =
  "No booking of yours has that id, so there is nothing here for you to pay for";

/**
 * The one thing a booking-scoped caller is ever told when their credential does
 * not open the stay they named.
 *
 * Said in one place because it answers two different facts on purpose — a
 * credential minted for another booking, and one that has since been given up —
 * and a reply that separated them would tell whoever holds a stale cookie that
 * the stay is real and that something changed about it. `mayCollectFor` and
 * `collectsTheWholeStay` are the two that raise it, at the two points the branch
 * can learn either fact.
 */
const NOT_THE_BOOKING_THIS_LINK_OPENS =
  "This link opens only the booking it was issued for";

/** A uuid with its hyphens taken out. */
const UUID_HEX_LENGTH = 32;

/** The booking half of a reference, before the nonce is appended. */
const BOOKING_HEX_PATTERN = new RegExp(`^[0-9a-f]{${UUID_HEX_LENGTH}}$`);

/**
 * What a reference this service minted looks like: a booking id and a nonce,
 * both as bare hex.
 *
 * Hex and nothing else, because the field a gateway echoes it back in has a
 * length limit and an alphabet — VNPay's `vnp_TxnRef` among them — and the
 * digits are the one thing every gateway's idea of both will carry. Sixty-four
 * characters, comfortably inside VNPay's hundred.
 */
const REFERENCE_PATTERN = new RegExp(`^[0-9a-f]{${UUID_HEX_LENGTH * 2}}$`);

/** What the property is asking a gateway to collect, and for which stay. */
export interface GatewayPaymentRequest {
  readonly bookingId: string;

  /** In đồng — `money.ts` on why nothing above the adapter scales it. */
  readonly amount: VndAmount;

  /** Shown to the payer on the gateway's own page. */
  readonly description: string;

  /** Where the gateway sends the payer's browser when they are finished. */
  readonly returnUrl: string;

  /** The payer's address, for the gateway's fraud screening. */
  readonly payerIpAddress: string;

  /**
   * The guest account the request was made under, or null when the caller's
   * authority over this stay is not an ownership one.
   *
   * This is the condition `rbac-matrix.md` attaches to `payment.open-attempt`'s
   * `⚠` for the guest realm, arriving as a value rather than as a check the
   * caller already made. Required and explicitly nullable so that every caller
   * states which of the two it is: an optional field would let a route that
   * forgot it open a payment page against any stay whose id it had, which is the
   * exposure the grant is conditional *because of*.
   *
   * Null is the desk, and the desk is not scoped. All four staff roles hold the
   * row `full` and take a walk-in's card against a stay that belongs to no
   * account at all — a scope applied to them would refuse the ordinary case.
   *
   * Null is also the funnel's guest who never signed up, and their scope is the
   * field below rather than this one — see it for why the two are separate.
   */
  readonly guestAccountId: string | null;

  /**
   * The single stay a booking-scoped credential proved, when that is what the
   * caller holds.
   *
   * The funnel takes a booking before anyone has an account, so the guest paying
   * for it has no `user_id` to be compared against —
   * `auth/booking-token/booking-token.service.ts` says why that credential is a
   * token rather than an account created from a typed address. Their authority
   * is still an ownership one; it is just proved about the booking instead of
   * about an account.
   *
   * A separate field and not a second meaning for the one above, because the two
   * fail in opposite directions. `guestAccountId` is null for a caller who is
   * *not* scoped, so folding a proven booking into it as another null would turn
   * the funnel's narrowest caller into the property's widest one. Optional
   * rather than nullable for the same reason the field above is nullable rather
   * than optional: the desk and the account holder must both keep stating what
   * they are, and only the new caller carries the new field.
   */
  readonly provenBookingId?: string;
}

export interface OpenedPayment {
  /** Send the payer here. */
  readonly paymentUrl: string;

  /**
   * The property's name for this attempt, echoed back in every callback about
   * it. Returned rather than kept private because a support question about a
   * payment is a question about this string, and the gateway's merchant screen
   * is where the other half of that conversation happens.
   */
  readonly reference: string;
}

/**
 * What a callback turned out to amount to.
 *
 * Four answers and not a boolean, because the caller has to say something
 * different to the gateway about each: money posted, money already posted,
 * money refused, and an attempt the payer may yet finish. Two things are not
 * among them and both are rejections rather than outcomes — a forged callback,
 * because nothing about it is a payment, and one whose amount is not the
 * amount the attempt was opened for, because nobody may act on it until a
 * person has.
 */
export type CallbackOutcome =
  | "RECORDED"
  | "ALREADY_RECORDED"
  | "REFUSED"
  | "STILL_OPEN";

/**
 * What a callback and this property's own record turned out to disagree about.
 *
 * Carried as `data` on every `CONFLICT` {@link PaymentService.handleIpn} raises,
 * because those are one status code over three different disagreements and a
 * caller has something different to say about each — the route that answers a
 * gateway has to name the figure when it is the figure, and must not name it
 * when it is not. The sentence each refusal carries is written for the person
 * who will have to reconcile it, and a caller matching on that prose breaks the
 * first time one of them is reworded.
 *
 * Three members and not a boolean, and none of them is a state anything is
 * stored in: the header above says why a disagreement writes nothing and adds no
 * `payment_status`. This names what was disagreed about, for the length of one
 * throw.
 */
export type CallbackDisagreement =
  /** The gateway's figure is not the figure the attempt was opened for. */
  | "AMOUNT"
  /** The attempt is already filed as something this callback contradicts. */
  | "OUTCOME"
  /** The gateway's transaction is already recorded against another attempt. */
  | "TRANSACTION";

/**
 * Thrown to abandon a transaction whose attempt is already resolved exactly as
 * this callback claims.
 *
 * A throw and not a returned flag because the posting below must not run and
 * the answer still has to travel out through `TransactionRunner.run`; a
 * rollback is the only thing that must happen on the way. Private to this file:
 * it is the shape of one control flow, not something a caller has an opinion
 * about.
 *
 * Only the replay raises it — the same delivery again, naming the same
 * transaction, against a row that already says so. An attempt resolved the
 * *other* way leaves by the ordinary route as a refusal, because the two are
 * not the same fact and nothing downstream could tell them apart if they
 * arrived the same way.
 */
class AlreadyResolved extends Error {}

/**
 * Which payments are being asked about, and how much of the answer is wanted.
 *
 * Every dimension is optional except the two that bound the answer, and each
 * narrows on a fact of the row itself — the contract argues why the trading day
 * is nonetheless the odd one out, being the only one no column holds.
 */
export interface PaymentListQuery {
  readonly bookingId?: string;
  readonly businessDate?: StayDate;
  readonly method?: PaymentRow["method"];
  readonly status?: PaymentRow["status"];
  readonly limit: number;
  readonly offset: number;
}

/**
 * One payment as the list answers it: the row, the stay behind it, and the
 * disagreement filed against it if a night found one.
 *
 * `businessDate` is the nine characters the wire spells a date with rather than
 * a `StayDate`. It is derived here and read nowhere else — nothing compares or
 * does arithmetic on it — so a `CalendarDate` would be an object made only to be
 * turned back into the string it came from.
 */
export interface ListedPayment {
  readonly id: string;
  readonly bookingId: string;
  readonly folioId: string;
  readonly method: PaymentRow["method"];
  readonly status: PaymentRow["status"];
  readonly amount: VndAmount;
  readonly gatewayTransactionId: string | null;
  readonly paidAt: Date | null;
  readonly businessDate: string | null;
  readonly discrepancyId: string | null;
}

/**
 * A page of payments, and how many the filters matched behind it.
 *
 * `total` is counted under the same predicate the page was cut from. It is not
 * the page's length: a page shorter than its limit says nothing once an offset
 * was given, and a full one says nothing at all.
 */
export interface PaymentPage {
  readonly payments: readonly ListedPayment[];
  readonly total: number;
}

@Injectable()
export class PaymentService {
  constructor(
    // The port and never the adapter — `FR-PAY-01`. Nothing in this file names
    // a gateway response code, a signature scheme or a host.
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly folios: FolioService,
    private readonly businessDates: BusinessDateService,
    // Asked one question and only one: whether a stay is a given account's.
    // `payment.module.ts` already imports `BookingModule` for the business date
    // and records that nothing runs the other way, so this adds a caller to an
    // export rather than an edge to the graph. Reaching into `booking` from here
    // would be a second copy of an ownership rule that has one owner, one spec
    // and one comment explaining what it does about a null.
    private readonly bookings: BookingService,
    private readonly transactions: TransactionRunner,
    // Last, so adding it moved no existing argument — `booking.service.ts`
    // takes its two mail collaborators the same way and for the same reason.
    // Asked for exactly one thing, and only after a commit: to wake somebody
    // about money that has landed on a stay the property cannot honour. The
    // header says why the call is post-commit and why this service, rather than
    // the state machine, is what decides a state is worth waking a person for.
    private readonly alerts: OpsAlertService,
  ) {}

  /**
   * Opens an attempt: a row saying money is outstanding, and an address to send
   * the payer to.
   *
   * In that order, and the header argues it at length. The row is committed
   * before the gateway is asked, so every callback that can arrive has a row to
   * resolve and a figure to be checked against; the transaction closes before
   * the round trip, so nothing is held across it.
   *
   * Both refusals below happen before either — a caller who named the wrong
   * kind of thing, or asked for the wrong kind of money, should not first cost
   * a payer a page to look at.
   *
   * **A stay still being held has its hold extended in the same transaction**,
   * so the room survives the round trip the payer is about to make. It is the
   * one thing here that writes outside the payment's own tables, and the comment
   * at the call site argues why it belongs in that transaction, in that order,
   * and on every door.
   *
   * **The third refusal is the scope `rbac-matrix.md` leaves to be finished
   * here.** The row is `⚠` for the guest realm, which `roles.ts` defines as a
   * grant the guard passes on with the condition attached — so a signed-in guest
   * reaches this method and the question of whose stay it is has not been asked
   * yet. It is asked inside the transaction, before the folio is opened, so a
   * refusal leaves no account behind for a stay the caller had no business
   * naming.
   */
  async createPaymentRequest(
    request: GatewayPaymentRequest,
  ): Promise<OpenedPayment> {
    const reference = referenceFor(request.bookingId);

    // Checked here rather than left to the insert, because the failure is not
    // the insert's. An id that cannot be written into a reference mints an
    // attempt no callback could ever be resolved back to, and Postgres would
    // report it as a malformed uuid rather than as the wrong sort of name.
    if (!reference) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That is not a booking id, so there is no stay to collect for",
      });
    }

    // `payment_amount_is_positive` would refuse this too, but as a fault rather
    // than as an answer anybody could act on — and only after the row had been
    // attempted. `postPayment` makes the same refusal in the same words at the
    // other end of the money's journey.
    if (request.amount <= 0n) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "A payment attempt is money the property is asking for, so the " +
          "amount has to be more than nothing",
      });
    }

    // Minted once, here, and then written down and sent — never taken twice.
    //
    // A gateway partitions transactions by the day one was opened, and VNPay
    // matches a later `queryDr` on the created instant formatted to the second.
    // `schema/payment.ts` recorded `created_at` as "this row's clock rather than
    // the attempt's — near enough to read by, and not the same thing", and left
    // the exact pair to the first caller that needed one. `ReconciliationJob` is
    // that caller: it asks the gateway about every attempt of a business date,
    // so a stored instant that is *near* the one VNPay holds is one that
    // sometimes falls on the other side of a second boundary and comes back
    // "transaction not found". That answer is indistinguishable from money the
    // gateway never took, so it would be filed as `MISSING_AT_GATEWAY` and page
    // somebody at four in the morning about a payment sitting safely at VNPay.
    //
    // So the row carries the instant the gateway was given rather than the one
    // its own transaction started at, and the two are the same value by
    // construction instead of by proximity.
    const openedAt = new Date();

    await this.transactions.run(async (exec) => {
      await this.mayCollectFor(exec, request);

      // The stay's own deadline, pushed out to cover the round trip that starts
      // the moment this transaction commits — `BOOKING_PAYMENT_WINDOW_MINUTES`.
      //
      // In the transaction that writes the attempt, so the two are one fact: a
      // room held for a payment nobody opened would be inventory given away for
      // nothing, and an attempt opened against a hold that was not extended is
      // the race this exists to close. `BookingService` owns the write because it
      // owns the column and the check constraint over it; a stay that is not
      // `HELD` is a no-op there rather than a violation, which is what keeps a
      // desk collecting a balance from a `CHECKED_IN` guest out of this.
      //
      // **Before the folio, and that ordering is deliberate.** `ensureFolio`
      // inserts a row whose foreign key takes a share lock on this booking, and
      // upgrading that to the update's own lock afterwards is the shape that
      // deadlocks against `hold-expiry-sweep.ts` — which takes the booking `for
      // update` first and then reads the payments. Taking the stronger lock first
      // leaves the sweep waiting rather than the two waiting on each other.
      //
      // **Every door, not just the guest's.** The window is sized for the payer's
      // round trip and a gateway is no faster for a receptionist: the desk sends a
      // payment link or turns a screen around, and a hold cancelled under that
      // link loses the property the same room. Nothing about who pressed the
      // button changes how long the bank takes. The desk's other collections are
      // untouched anyway — a `CONFIRMED` or `CHECKED_IN` stay has no hold to
      // extend — so the only case this widens is the desk taking money for a
      // booking the funnel is still holding, which is the case that wants it.
      await this.bookings.extendHoldForPayment(exec, request.bookingId);

      const folioId = await this.folios.ensureFolio(exec, request.bookingId);

      await exec.insert(payment).values({
        folioId,
        method: GATEWAY_METHOD,
        // What makes this row findable again. Without it the callback that
        // resolves the attempt has nothing to match on, and a paid stay ends
        // holding this row beside a second one saying the money arrived.
        attemptReference: reference,
        amount: request.amount,
        // Nothing has been paid, so there is no gateway id to record and no
        // moment to date — which is exactly what the row in this state is
        // permitted to hold: `payment_paid_at_exactly_when_money_moved` refuses
        // a time of payment on an attempt nobody has finished.
        status: "PENDING",
        // Explicit, overriding the column's `defaultNow()`. The default is the
        // transaction's start time, which is a different instant from the one
        // below and is the whole reason this is passed rather than defaulted.
        createdAt: openedAt,
      });
    });

    const { paymentUrl } = await this.gateway.createPayment({
      reference,
      createdAt: openedAt,
      amount: request.amount,
      description: request.description,
      returnUrl: request.returnUrl,
      payerIpAddress: request.payerIpAddress,
    });

    return { paymentUrl, reference };
  }

  /**
   * The ownership half of `payment.open-attempt`, for the realm it applies to.
   *
   * **A `where` clause and not a comparison after the row arrives.**
   * `BookingService.isOwner` matches the stay and the account in one predicate,
   * which is what keeps a walk-in unreachable: the desk's stays hold a null
   * `user_id`, SQL equality never matches a null, and there is no branch here
   * that could read one as an account. Borrowed rather than rewritten — that
   * method already carries the spec and the comment for this exact case, and a
   * second query would be a second answer to one question.
   *
   * **Null passes straight through, and that is the desk.** Every staff role
   * holding this row holds it `full`; scoping them would refuse a receptionist
   * taking a walk-in's card, which is the ordinary use of the route.
   *
   * **`NOT_FOUND`, and the same one for both absences.** `isOwner` is false for
   * a stay that is not this account's and false for a booking id nobody holds,
   * so a guest gets one sentence either way — the same line `booking.service.ts`
   * takes on the routes a guest reaches their own stay by. The enumeration
   * argument is weaker here than it is there, because this route is addressed by
   * a uuid rather than by eight readable characters, and consistency is what
   * decides it: one rule across every guest-facing refusal is a rule a reviewer
   * can check. `ensureFolio` below already answers a booking that does not exist
   * with a 404 of its own, so this is also the smaller change to what a caller
   * sees.
   */
  private async mayCollectFor(
    exec: DbExecutor,
    request: GatewayPaymentRequest,
  ): Promise<void> {
    // A booking-scoped caller is scoped to exactly one stay, and it is the one
    // their credential names. Asserted here as well as at the handler, because
    // this is the method that decides whether a payment page may be opened
    // against a stay — a caller reaching the service by any other route gets the
    // same answer as one arriving through the controller.
    //
    // Which stay it names is all this comparison can settle. Whether that
    // credential still opens it is a fact about a row, and it is settled by the
    // query below rather than by a lookup of its own — see
    // {@link collectsTheWholeStay}.
    if (request.provenBookingId !== undefined) {
      if (request.provenBookingId !== request.bookingId) {
        throw new ORPCError("FORBIDDEN", {
          message: NOT_THE_BOOKING_THIS_LINK_OPENS,
        });
      }

      await this.collectsTheWholeStay(exec, request);

      return;
    }

    if (request.guestAccountId === null) {
      return;
    }

    if (
      !(await this.bookings.isOwner(
        exec,
        request.bookingId,
        request.guestAccountId,
      ))
    ) {
      throw new ORPCError("NOT_FOUND", { message: NO_STAY_OF_YOURS });
    }

    await this.collectsTheWholeStay(exec, request);
  }

  /**
   * The one amount a guest may open an attempt for — the stay's frozen total.
   *
   * **The amount is the guest's to send and not the guest's to choose.** The
   * property collects the whole stay before arrival, so there is exactly one
   * figure a guest door may be opened for; without this refusal a hostile client
   * opens an attempt for a thousand đồng, pays it, and comes back holding a
   * gateway success. Nothing downstream would catch it: {@link PaymentService}'s
   * `record` confirms a paid hold from the callback's *status* and never from
   * its amount, and it is right not to — `booking-state-machine.md` §3 captions
   * `HELD → CONFIRMED` "deposit taken" and a refusal there would roll back money
   * the gateway has already taken. So the only moment this can be refused is
   * before an attempt exists to be paid, which is here.
   *
   * **Against `quoted_stay_total_gross` and never against a figure priced now.**
   * §8 freezes what a booking was quoted and `assignment.service.ts` rewrites
   * that column when a stay's room type changes, so the column *is* this stay's
   * current price by construction — where a second calculation here would be a
   * number that could disagree with the one the guest was shown.
   *
   * **The desk never reaches this.** All four staff roles hold the row `full`
   * and a desk collects deposits, part payments and balances against one stay;
   * that is a different operation performed by somebody the property has already
   * trusted with the till, and scoping it would refuse the ordinary case.
   *
   * **The booking-token branch reads one column more, and this is the only place
   * on the payment path that can.** `auth/booking-token/booking-token.service.ts`
   * admits its credential by arithmetic over a signature and reads no row, which
   * is what keeps it cheap on a cookie sent with every request — and leaves it
   * unable to say whether that credential has since been surrendered.
   * `anon_access_revoked_at` is that instant, and testing it here costs nothing:
   * it is another conjunct on a `where` that was already going to fetch this
   * stay's quoted total, so a revoked stay comes back as no row rather than as a
   * second query's answer and `access.guard.ts` still takes no round trip.
   *
   * Written out rather than borrowed from `BookingService`, which carries the
   * same conjunct on the same column for the read path. The predicate there is
   * private to that file and the service exposes no query this one could ride,
   * so reuse would mean a second statement against a row already being selected
   * — which is the cost the column was arranged to avoid. The column itself is
   * what keeps the two honest: either of them reading it wrong shows up as a
   * stay still reachable after its cookie was given up.
   *
   * **The account branch is untouched by it**, and that is the half most easily
   * lost. Revocation kills the loose anonymous copy and says nothing about who
   * owns the booking, so the guest who has just attached this stay pays for it
   * through their session exactly as before.
   */
  private async collectsTheWholeStay(
    exec: DbExecutor,
    request: GatewayPaymentRequest,
  ): Promise<void> {
    const byCredential = request.provenBookingId !== undefined;

    const [stay] = await exec
      .select({ quoted: booking.quotedStayTotalGross })
      .from(booking)
      .where(
        and(
          eq(booking.id, request.bookingId),
          byCredential ? isNull(booking.anonAccessRevokedAt) : undefined,
        ),
      )
      .limit(1);

    // Unreachable from the account branch, which has just proved the row by
    // matching it, and reachable from the proven branch on two facts: the stay a
    // credential names has gone, or the credential no longer opens it. One
    // refusal for both, and it is the one a credential naming somebody else's
    // stay already gets — a revoked cookie told anything different would learn
    // that its booking is real and that something about it changed.
    if (!stay) {
      throw byCredential
        ? new ORPCError("FORBIDDEN", {
            message: NOT_THE_BOOKING_THIS_LINK_OPENS,
          })
        : new ORPCError("NOT_FOUND", { message: NO_STAY_OF_YOURS });
    }

    if (request.amount !== stay.quoted) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "The property collects the whole stay before arrival, so an attempt " +
          "is opened for what the stay was quoted and not for part of it",
      });
    }
  }

  /**
   * What the property has been paid, narrowed and paged — the money as the
   * payer's side reported it.
   *
   * **A read of `payment` and never of the ledger.** The two say the same thing
   * in different words on purpose — `schema/payment.ts` explains why they are
   * written under different rules and compared rather than merged — and a list
   * assembled from `folio_posting` would be this property's own account of the
   * money, which is exactly the side a person triaging a gateway payment is not
   * asking about. Nothing here is aggregated: every column comes off one row.
   *
   * **The stay is joined and not stored.** A payment names an account and an
   * account names a stay, so the booking a caller filters on and the booking a
   * row carries are one join rather than a column that could fall out of step.
   * Inner, because `payment.folio_id` is `not null` behind a foreign key and
   * there is no payment belonging to no account.
   *
   * **The trading day is derived from `paid_at`, and that is why one filter
   * takes a different route through this method than the other three.** §2's
   * rollover is a configured hour in the property's own zone, so no column holds
   * the day and no `where` clause can name it. The rule is read once and applied
   * to every row — `reconciliation.service.ts`'s own arrangement for the same
   * question, so that one boundary classifies everything this answers with.
   *
   * A request naming a day therefore narrows in the statement to the coarse
   * range that contains it whatever the hour is, and finishes the narrowing in
   * memory. The page and the total are cut after that, because a `limit` applied
   * before the classification would be wrong rather than merely different: it
   * would hand back the newest rows *near* the day and call them the day's, with
   * a count beside them that was the range's. The cost is bounded by what it
   * reads — three days of one property's payments — and reading less would take
   * a stored business date, which is a second place for §2's rule to live.
   *
   * A row whose money never moved has no `paid_at`, so the range excludes it on
   * its own: no predicate is needed to say an unresolved attempt belongs to no
   * trading day.
   *
   * **Two statements when no day is named**, because the total is not inferable
   * from the page — a short page says nothing once an offset was given and a
   * full page says nothing ever. The caller holds both inside one transaction,
   * so the table and the figure over it are one moment.
   */
  async list(exec: DbExecutor, query: PaymentListQuery): Promise<PaymentPage> {
    // One reading of the rollover hour for every row this answers with, so the
    // day a payment is reported on and the day the filter tested are the same
    // boundary.
    const dates = await this.businessDates.rule(exec);

    const narrowed: SQL[] = [];

    if (query.bookingId) {
      narrowed.push(eq(folio.bookingId, query.bookingId));
    }

    if (query.method) {
      narrowed.push(eq(payment.method, query.method));
    }

    if (query.status) {
      narrowed.push(eq(payment.status, query.status));
    }

    if (query.businessDate) {
      // A day out on either side, which contains the business date whatever
      // hour the property rolls at. Each row is then asked the real question
      // below.
      narrowed.push(
        gte(
          payment.paidAt,
          startOfDayUtc(query.businessDate.subtract({ days: 1 })),
        ),
        lt(payment.paidAt, startOfDayUtc(query.businessDate.add({ days: 2 }))),
      );
    }

    const where = narrowed.length === 0 ? undefined : and(...narrowed);

    // Built afresh on each call rather than held in a variable, because a
    // Drizzle builder carries the clauses added to it: a second use would
    // inherit the first one's `limit`.
    const matching = () =>
      exec
        .select({
          id: payment.id,
          bookingId: folio.bookingId,
          folioId: payment.folioId,
          method: payment.method,
          status: payment.status,
          amount: payment.amount,
          gatewayTransactionId: payment.gatewayTransactionId,
          paidAt: payment.paidAt,
          // The disagreement filed against this row, and never its figures —
          // `contract/payment.ts` says why a payment references a discrepancy
          // rather than restating one. A correlated read and not a join, so a
          // payment carrying two observations cannot double the row it hangs
          // off; the newest stands, and the id breaks a tie so that two reads
          // answer alike.
          discrepancyId: sql<
            string | null
          >`(select ${paymentDiscrepancy.id} from ${paymentDiscrepancy}
             where ${paymentDiscrepancy.paymentId} = ${payment.id}
             order by ${paymentDiscrepancy.observedAt} desc, ${paymentDiscrepancy.id} desc
             limit 1)`,
        })
        .from(payment)
        .innerJoin(folio, eq(folio.id, payment.folioId))
        .where(where)
        // Newest row first, the id breaking a tie, so the order is total. An
        // offset over a partial order is a page that shows one payment twice
        // and another never. `created_at` and not `paid_at`: the latter is null
        // on everything unresolved, so ordering by it would be ordering on
        // whether money had moved.
        .orderBy(desc(payment.createdAt), desc(payment.id));

    if (query.businessDate) {
      const day = query.businessDate.toString();

      const onTheDay = (await matching())
        .map((row) => dated(row, dates))
        .filter((row) => row.businessDate === day);

      return {
        payments: onTheDay.slice(query.offset, query.offset + query.limit),
        total: onTheDay.length,
      };
    }

    const page = await matching().limit(query.limit).offset(query.offset);

    const [counted] = await exec
      .select({ total: count() })
      .from(payment)
      .innerJoin(folio, eq(folio.id, payment.folioId))
      .where(where);

    return {
      payments: page.map((row) => dated(row, dates)),
      total: counted?.total ?? 0,
    };
  }

  /**
   * Acts on what the gateway says became of an attempt — `FR-PAY-03`.
   *
   * The callback arrives exactly as it was received and is authenticated before
   * a single field of it is read. `CallbackVerification` is a union for that
   * reason — a caller that skipped the check cannot reach the transaction at
   * all — and an unverified callback is refused rather than filed as a failed
   * payment: the route this is called from is unguarded on purpose, so anything
   * at all may be posted to it and most of what fails here is traffic rather
   * than money.
   */
  async handleIpn(callback: Record<string, unknown>): Promise<CallbackOutcome> {
    const verification = await this.gateway.verifyCallback(callback);

    if (!verification.verified) {
      throw new ORPCError("UNAUTHORIZED", {
        message:
          "That callback does not carry the gateway's signature, so it is not the gateway speaking",
      });
    }

    const { transaction } = verification;

    // The shape, and only the shape, before a connection is spent on it. A
    // string this file did not mint names no attempt of this property's, and the
    // database has no answer worth asking for about one.
    if (!REFERENCE_PATTERN.test(transaction.reference)) {
      throw new ORPCError("NOT_FOUND", {
        message:
          "This property issued no attempt under that reference, so there is no stay to credit",
      });
    }

    if (transaction.status !== "SUCCESS") {
      // Nothing at all is written while the payer may still finish. The row the
      // request that opened the attempt wrote already says what is true — money
      // claimed and not yet confirmed — and rewriting it to what it already says
      // would spend a transaction to change nothing.
      if (transaction.status === "PENDING") {
        return "STILL_OPEN";
      }

      await this.recordRefusal(transaction.reference);

      return "REFUSED";
    }

    return await this.record(transaction);
  }

  /**
   * The payment, the stay it confirms and the line on the account — or none of
   * the three.
   *
   * A redelivered callback is answered by the row rather than by a look this
   * file took before writing — the note at the top argues why — and that answer
   * arrives as a thrown sentinel rather than a `return`, because the posting
   * below must not run and a rollback is the only thing that has to happen on
   * the way out. It is also what keeps a gateway's retries from paging twice:
   * the sentinel is raised before the stay is touched, so the second delivery
   * has no landing to report.
   */
  private async record(
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<CallbackOutcome> {
    try {
      await this.transactions.run(async (exec) => {
        const folioId = await this.take(exec, transaction);

        // The stay itself, in the same commit as the money. `booking-state-
        // machine.md` §3 captions `HELD → CONFIRMED` "deposit taken", and this
        // is where the deposit is taken — a guest holds no capability that
        // could make the transition themselves, so without this a paid hold
        // sits `HELD` until `hold-expiry-sweep.ts` cancels a room somebody has
        // paid for.
        //
        // Committed with the payment rather than after it, for the reason the
        // posting is: they are one fact. A confirmation that failed separately
        // would leave money on a folio whose stay is still counting down, which
        // is the failure this exists to stop, arriving by a narrower door.
        //
        // Only a hold moves. `confirmPaidHold` says why every other state is a
        // no-op and why a refusal here would roll back money already taken. It
        // hands back the state the money landed on, which is the one thing a
        // no-op could not say for itself.
        const stay = await this.bookings.confirmPaidHold(
          exec,
          await this.stayOn(exec, folioId),
        );

        await this.folios.postPayment(exec, {
          folioId,
          amount: transaction.amount,
          // The trading day the money moved in, which is not necessarily the
          // one this callback arrived in.
          businessDate: await this.businessDates.current(
            exec,
            transaction.paidAt,
          ),
          // The gateway's id is carried into the line the guest reads because
          // it is the one string that ties an invoice back to the gateway's own
          // daily report — which is the comparison `FR-PAY-05` makes.
          description: `Card payment ${transaction.gatewayTransactionId}`,
          // No method, because the payer's side of this money is the row `take`
          // has just resolved. The ledger writes both sides for the money the
          // desk collects itself, and a second `payment` row here would double
          // `NFR-02`'s Σ payments for every đồng the gateway confirmed.
          method: null,
          // `postedBy` is left unset. Nobody authored this: the callback writes
          // on no person's authority, and a placeholder account would make an
          // automated payment indistinguishable from one a receptionist took.
        });

        // After the posting rather than beside the transition, so that the page
        // claims what is true by the time it is sent: the money is on the
        // account. Registered, not sent — see the method.
        await this.pageIfNobodyCanHonour(exec, stay, transaction);
      });
    } catch (error) {
      if (error instanceof AlreadyResolved) {
        return "ALREADY_RECORDED";
      }

      throw error;
    }

    return "RECORDED";
  }

  /**
   * Wakes somebody when the money has landed on a stay the property cannot
   * honour — and changes nothing about either.
   *
   * **`CANCELLED` and nothing else, and the argument is what keeps this a
   * pager.** `confirmPaidHold` no-ops on five states, but four of them are
   * ordinary money and a page that cried about them would be muted inside a
   * week:
   *
   * - `CONFIRMED` is a stay the desk already confirmed off-line, or a guest
   *   paying a second time. `booking-state-machine.md` §1 gives it a balance.
   * - `CHECKED_IN` is a balance collected from a guest in the building, which
   *   §1 marks as the state where a balance is expected.
   * - `CHECKED_OUT` is §4's "no approved deferred settlement" arriving: a stay
   *   may leave with a bill still to be settled, and this is it being settled.
   * - `NO_SHOW` is the one worth arguing. It is a stay that did not happen, but
   *   §3 levies a no-show charge on it and §1 leaves the arrival night on the
   *   folio, so the account has money genuinely owing against it; and §2 makes
   *   `NO_SHOW → CHECKED_IN` legal, so the stay may yet be honoured by a guest
   *   who landed at 02:00. A page saying nobody can honour this would be
   *   telling a responder something that is not true.
   *
   * `CANCELLED` is none of that. §1 gives it no balance and §3 releases every
   * night; §3's `→ CANCELLED` rows move money *out* — "penalty per policy,
   * refund remainder" — because the property collects the whole stay before
   * arrival, so money moving *in* is not a collection anybody arranged. The
   * ordinary way it happens is the race `extendHoldForPayment` narrows but
   * cannot close: the payer finished, and the sweep had already cancelled the
   * hold. Nobody will supply the room, and the property is holding money it has
   * to hand back.
   *
   * **Nothing here is a decision about the money.** The payment is posted, the
   * cancellation stands, and no state moves — `FR-PAY-04`'s refund is a person's
   * act on the gateway's own screen, which is what refunds are here. This only
   * makes sure that person exists before tomorrow's reconciliation.
   *
   * **Registered for after the commit, never sent inside it.** `page` is a
   * `fetch` with a timeout on it; a vendor round trip inside this transaction
   * would hold one of ten pooled connections open for its length, which is the
   * failure the confirmation mail already had once. It is also the ordering
   * this needs: `TransactionRunner` throws the queue away on a rollback, so a
   * posting the ledger refuses pages nobody, and every page that goes out is
   * about money that is durably on an account.
   */
  private async pageIfNobodyCanHonour(
    exec: DbExecutor,
    stay: PaidStay,
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<void> {
    if (stay.state !== "CANCELLED") {
      return;
    }

    // Whether the page was delivered is not read. `ops-alert.service.ts` says
    // what that boolean is for and what it is not: a send that failed has
    // already been logged in full, and there is nothing this transaction could
    // usefully do about it from the far side of its own commit.
    await afterCommit(exec, async () => {
      await this.alerts.page({
        kind: "payment-on-cancelled-stay",
        text:
          `${transaction.amount} đồng has been taken for booking ` +
          `${stay.reference}, which was already cancelled — the payment is on ` +
          "the account and the stay stays cancelled, so it has to be refunded " +
          "by hand at the gateway",
        details: {
          reference: stay.reference,
          state: stay.state,
          // đồng as a string: this is a `bigint` and a page is JSON, and
          // `money.ts` refuses the loss `Number` would take — on the one field
          // whose whole purpose is a figure somebody has to hand back.
          amount: transaction.amount.toString(),
          gatewayTransactionId: transaction.gatewayTransactionId,
          // What the gateway's merchant screen is searched by, alongside the
          // transaction id: the refund is made there, on the day the money
          // moved rather than the day this arrived.
          paidAt: transaction.paidAt.toISOString(),
        },
      });
    });
  }

  /**
   * The attempt, resolved to the money that arrived on it. Hands back the
   * account the posting then belongs on.
   *
   * **The `UPDATE` is conditional and that condition is the whole guarantee.**
   * `status = 'PENDING'` is what makes the statement claim the attempt rather
   * than merely describe it: ten deliveries at once, and the first to reach the
   * row holds its lock through to commit, after which the other nine re-evaluate
   * the predicate against a row that now reads `SUCCESS` and update nothing.
   * That is one statement doing what a read followed by a write cannot, and the
   * two partial unique indexes stay under it regardless — they are what holds
   * for a caller that is not this file.
   *
   * **Nothing updated is read off the row rather than assumed.** The header
   * sets out the three states that produce it and why only one is the replay.
   * The read is safe because nothing was written: the statement above matched
   * no row, so the transaction is intact and the `SELECT` sees whatever the
   * delivery that beat this one committed.
   *
   * **The amount is compared and never adopted.** What the row holds is what the
   * property asked for; a callback naming anything else rolls the whole
   * transaction back, leaving the attempt `PENDING` and the ledger untouched.
   * The header says why that is a refusal rather than a status. There is no
   * branch here without a row to compare against — {@link createPaymentRequest}
   * commits one before the payer is sent anywhere.
   */
  private async take(
    exec: DbExecutor,
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<string> {
    try {
      const [claimed] = await exec
        .update(payment)
        .set({
          status: "SUCCESS",
          gatewayTransactionId: transaction.gatewayTransactionId,
          // The gateway's clock, never ours — `schema/payment.ts` on why the
          // column exists at all and why nothing may fill it from `Date.now`.
          paidAt: transaction.paidAt,
        })
        .where(
          and(
            eq(payment.attemptReference, transaction.reference),
            eq(payment.status, "PENDING"),
          ),
        )
        .returning({ folioId: payment.folioId, asked: payment.amount });

      if (claimed) {
        if (claimed.asked !== transaction.amount) {
          throw new ORPCError("CONFLICT", {
            data: disagreedAbout("AMOUNT"),
            message:
              "The gateway reports an amount this property did not open the " +
              "attempt for, so nothing has been posted and the attempt is " +
              "still outstanding",
          });
        }

        return claimed.folioId;
      }

      const held = await this.heldBy(exec, transaction.reference);

      if (!held) {
        throw new ORPCError("NOT_FOUND", {
          message:
            "This property has no attempt under that reference, so there is " +
            "no account the money could be posted to",
        });
      }

      // The replay, and the only reading of "no rows updated" that is one: the
      // same delivery again, naming the same transaction, against a row that
      // already records it. Answered rather than refused, because the gateway
      // is entitled to keep asking until it is told.
      if (
        held.status === "SUCCESS" &&
        held.gatewayTransactionId === transaction.gatewayTransactionId
      ) {
        throw new AlreadyResolved();
      }

      throw new ORPCError("CONFLICT", {
        data: disagreedAbout("OUTCOME"),
        message:
          `The gateway reports this attempt was paid under transaction ` +
          `${transaction.gatewayTransactionId}, but it is already filed as ` +
          `${held.status} — nothing has been posted, and the two accounts of ` +
          "it have to be reconciled by hand",
      });
    } catch (error) {
      // The one Postgres refusal this statement can provoke is
      // `payment_gateway_transaction_unique_key`: the gateway's id for money it
      // says it took is already recorded against a *different* attempt. That is
      // not a replay — a replay names this attempt and is answered above — so
      // there is nothing to make idempotent and something for a person to see.
      //
      // The `ORPCError`s raised above pass through untouched: `sqlStateOf` hands
      // back the `code` they carry, and none of them is `23505`.
      if (sqlStateOf(error) === UNIQUE_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          data: disagreedAbout("TRANSACTION"),
          message:
            `Transaction ${transaction.gatewayTransactionId} is already ` +
            "recorded against another attempt, so nothing has been posted",
        });
      }

      throw error;
    }
  }

  /**
   * A payment the gateway refused, kept rather than dropped.
   *
   * `schema/payment.ts` says why the row exists at all: a guest asking why they
   * were not charged is asking about it, and `FR-PAY-05` compares two reports
   * rather than one report and an absence.
   *
   * The same conditional `UPDATE` {@link take} uses and for the same reason, and
   * the same three readings of it matching nothing. A redelivered refusal finds
   * the row already `FAILED` and is told so — a refusal answers "refused"
   * however many times it arrives. A refusal over an attempt already recorded as
   * paid is the contradiction the header describes, pointing the other way, and
   * it refuses rather than unwinding money that is on the account.
   *
   * Nothing is written by either of those, so this needs no sentinel to escape
   * with: a `return` from inside the boundary commits a transaction that
   * touched nothing, and a `throw` rolls back the same emptiness.
   *
   * The amount is not compared here. Nothing is posted either way, so a figure
   * the gateway disagrees about is a disagreement over money that did not move —
   * and the row keeps what the property asked for, which is the figure a guest
   * asking why they were not charged is asking about.
   */
  private async recordRefusal(reference: string): Promise<void> {
    await this.transactions.run(async (exec) => {
      const [refused] = await exec
        .update(payment)
        .set({ status: "FAILED" })
        .where(
          and(
            eq(payment.attemptReference, reference),
            eq(payment.status, "PENDING"),
          ),
        )
        .returning({ id: payment.id });

      if (refused) {
        return;
      }

      const held = await this.heldBy(exec, reference);

      if (!held) {
        throw new ORPCError("NOT_FOUND", {
          message:
            "This property has no attempt under that reference, so there is " +
            "no refusal of its own to record",
        });
      }

      if (held.status === "FAILED") {
        return;
      }

      throw new ORPCError("CONFLICT", {
        data: disagreedAbout("OUTCOME"),
        message:
          `The gateway reports this attempt was refused, but it is already ` +
          `filed as ${held.status} — the money it says did not move is on the ` +
          "account, and the two accounts of it have to be reconciled by hand",
      });
    });
  }

  /**
   * The stay an account belongs to.
   *
   * Read off the folio rather than off the first half of the reference, which
   * carries the same id and is deliberately not trusted for it — the note at
   * the top of this file draws that line: a callback resolves through the row
   * it claims, never through the string it arrived in. The row is reached by a
   * folio id this transaction has just returned from `payment`, so the id is
   * the property's own and the join is total.
   *
   * Absent is impossible rather than unhandled: `payment.folio_id` is a foreign
   * key, so a payment row naming a folio that is not there is a broken database
   * and not a case. It is still stated, because the alternative is confirming
   * `undefined` as a booking id and finding out at the next statement.
   */
  private async stayOn(exec: DbExecutor, folioId: string): Promise<string> {
    const [account] = await exec
      .select({ bookingId: folio.bookingId })
      .from(folio)
      .where(eq(folio.id, folioId));

    if (!account) {
      throw new ORPCError("NOT_FOUND", {
        message:
          "That payment names an account no stay holds, so there is nothing to confirm",
      });
    }

    return account.bookingId;
  }

  /**
   * What the attempt under this reference says now, or nothing if this property
   * opened none.
   *
   * One row or none, and that is the index's doing rather than a `limit`:
   * `payment_attempt_reference_unique_key` is what makes a reference name at
   * most one attempt, so a second row here would be a broken invariant rather
   * than a result to narrow.
   */
  private async heldBy(
    exec: DbExecutor,
    reference: string,
  ): Promise<Pick<PaymentRow, "status" | "gatewayTransactionId"> | undefined> {
    const [held] = await exec
      .select({
        status: payment.status,
        gatewayTransactionId: payment.gatewayTransactionId,
      })
      .from(payment)
      .where(eq(payment.attemptReference, reference));

    return held;
  }
}

/**
 * One selected row with the trading day its money moved on written onto it.
 *
 * The rule is passed in rather than read here, which is what keeps a whole
 * answer classified against a single rollover hour: a helper that fetched its
 * own would date the first row and the last one under two readings of a
 * configuration an `ADMIN` can change while a page is being assembled.
 *
 * Null in and null out. Money that has not moved has no instant to be dated by,
 * and dating it by the moment the row was written would put an unresolved
 * attempt on a day the property was never paid on.
 */
function dated(
  row: Omit<ListedPayment, "businessDate">,
  dates: BusinessDateRule,
): ListedPayment {
  return {
    ...row,
    businessDate: row.paidAt ? dates.on(row.paidAt).toString() : null,
  };
}

/** The `data` a `CONFLICT` from {@link PaymentService.handleIpn} carries. */
export function disagreedAbout(disagreement: CallbackDisagreement): {
  readonly disagreement: CallbackDisagreement;
} {
  return { disagreement };
}

/**
 * What a refusal disagreed about, or nothing if it did not say.
 *
 * The reading half of {@link disagreedAbout}, written beside it so the two
 * cannot drift. `data` is `unknown` by the time a caller holds the error, and an
 * error carrying no `data` at all is the ordinary case — everything this service
 * raises that is not a `CONFLICT`.
 */
export function disagreementOf(data: unknown): CallbackDisagreement | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const named = (data as { disagreement?: unknown }).disagreement;

  return named === "AMOUNT" || named === "OUTCOME" || named === "TRANSACTION"
    ? named
    : undefined;
}

/**
 * A fresh reference for one attempt on one stay.
 *
 * Neither half is unique on its own account: the booking's repeats across every
 * attempt on that stay, and it is the nonce that makes the pair name the
 * attempt. A uuid without its hyphens is the nonce, for the same reason the
 * adapter's request id is one — thirty-two characters, unique without a counter
 * this process would have to keep across restarts and instances.
 *
 * Nothing for anything that is not a booking id, because a reference built out
 * of one could not be read back.
 */
function referenceFor(bookingId: string): string | undefined {
  const stay = bookingId.replaceAll("-", "").toLowerCase();

  if (!BOOKING_HEX_PATTERN.test(stay)) {
    return undefined;
  }

  return `${stay}${randomUUID().replaceAll("-", "")}`;
}
