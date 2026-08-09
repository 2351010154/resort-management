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
import type { VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { payment, type PaymentRow } from "../../database/schema/payment.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { BusinessDateService } from "../booking/business-date.service.js";
import { FolioService } from "../folio/folio.service.js";
import {
  type GatewayTransaction,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "./ports/payment-gateway.port.js";

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

@Injectable()
export class PaymentService {
  constructor(
    // The port and never the adapter — `FR-PAY-01`. Nothing in this file names
    // a gateway response code, a signature scheme or a host.
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly folios: FolioService,
    private readonly businessDates: BusinessDateService,
    private readonly transactions: TransactionRunner,
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

    await this.transactions.run(async (exec) => {
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
      });
    });

    const { paymentUrl } = await this.gateway.createPayment({
      reference,
      // The attempt's own clock, in the reference's timing, because the gateway
      // partitions transactions by the day one was opened and a later query has
      // to name the same instant — `PaymentAttempt` says so. `payment.created_at`
      // is this row's rather than the attempt's, which `schema/payment.ts` files
      // as `FR-PAY-04`'s to resolve.
      createdAt: new Date(),
      amount: request.amount,
      description: request.description,
      returnUrl: request.returnUrl,
      payerIpAddress: request.payerIpAddress,
    });

    return { paymentUrl, reference };
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
   * The payment and its posting, or neither.
   *
   * A redelivered callback is answered by the row rather than by a look this
   * file took before writing — the note at the top argues why — and that answer
   * arrives as a thrown sentinel rather than a `return`, because the posting
   * below must not run and a rollback is the only thing that has to happen on
   * the way out.
   */
  private async record(
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<CallbackOutcome> {
    try {
      await this.transactions.run(async (exec) => {
        const folioId = await this.take(exec, transaction);

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
          // `postedBy` is left unset. Nobody authored this: the callback writes
          // on no person's authority, and a placeholder account would make an
          // automated payment indistinguishable from one a receptionist took.
        });
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
