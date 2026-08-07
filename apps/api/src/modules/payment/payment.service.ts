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
// booking's own id and a nonce, stored on the row the attempt opens, and handed
// to the gateway; a callback arrives carrying it and nothing else this property
// wrote. Two things are read out of it and they answer different questions. The
// booking half says which stay, which is what opens an account for a callback
// about an attempt whose row is not there. The whole string says which
// *attempt*, which is what `payment.attempt_reference` is matched on — and
// matching on it is how a `PENDING` row becomes the payment rather than sitting
// beside it forever.
//
// The booking's id and not the folio's, because `ensureFolio` is the one
// idempotent way to reach an account and it takes a booking. A reference naming
// a folio could only be minted after the account had been opened, which puts a
// write in front of the payment url a payer is waiting on — and the callback
// path would still have to open the same account anyway.
//
// Not the guest-facing booking reference either. `PaymentAttempt` says a stay
// may be paid more than once and that a replayed callback has to resolve to one
// attempt; the nonce is what makes the reference name the attempt rather than
// the stay.
//
// Nothing is trusted from it. The gateway signs the reference it echoes back —
// `FR-PAY-02` — so a payer cannot aim a callback at a stay of their choosing,
// and what is read out of it is a uuid that either names a booking or does not,
// which `ensureFolio` answers with a refusal rather than an account.
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
// So neither write below is preceded by a look, and both are single statements
// the database serialises for us. Resolving an attempt is one conditional
// `UPDATE … where attempt_reference = $1 and status = 'PENDING'`: ten of them at
// once, and the first to reach the row holds its lock until it commits, after
// which the other nine re-evaluate that predicate against the row as it now
// stands, match nothing, and report no rows updated. Recording an attempt whose
// row is absent is one unguarded `INSERT`, and `23505` off either partial unique
// index is the answer — the convention `sql-state.ts` sets out and
// `folio.service.ts` follows. Both indexes stay in place regardless of what this
// file does: the guarantee `FR-PAY-03` asks for belongs in the schema, where it
// holds for the next caller too.
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
// wrote is what makes that possible. The exposure this closes is not forgery —
// `FR-PAY-02` has the gateway sign the amount, so a payer who edits it produces
// a callback that fails verification and never reaches here. It is bookkeeping:
// a callback that verifies and still names a figure nobody asked for is a
// terminal, a currency scale or a merchant account disagreeing with this
// property, and posting it would put a number on a guest's invoice that no
// attempt of theirs accounts for.
//
// So it refuses, loudly, and writes nothing at all. The attempt stays `PENDING`,
// which is the honest state — it is exactly the "money claimed and not yet
// confirmed" `schema/payment.ts` defines, and somebody now has to look. No new
// `payment_status` member is invented for it: `PENDING`, `SUCCESS`, `FAILED` and
// `REFUNDED` are what became of the *money*, a mismatch is a disagreement about
// what the money was for, and a fifth member would be a state every reader of
// the table — the balance, `NFR-02`'s sum, a guest's invoice — would have to
// learn in order to keep ignoring.

import { randomUUID } from "node:crypto";
import type { VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { payment } from "../../database/schema/payment.js";
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
 * Thrown to roll a transaction back once the database has already answered.
 *
 * A throw and not a returned flag because the answer has to travel out through
 * `TransactionRunner.run`, and a rollback is the only thing that must happen on
 * the way. Private to this file: it is the shape of one control flow, not
 * something a caller has an opinion about.
 *
 * "Resolved" and not "recorded", because both terminal writes raise it. A
 * success already taken and a refusal already filed are the same fact from this
 * file's point of view — the attempt is no longer open, and whatever this
 * delivery was going to write has been written.
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
   * Opens an attempt: an address to send the payer to, and a row saying one is
   * outstanding.
   *
   * The gateway is asked first and the rows are written after, which is the
   * cheaper of the two failures and the one that costs nothing to recover from.
   * A url built for an attempt whose row rolled back still resolves when the
   * callback arrives — the reference names the booking, and the account is
   * opened on the way in — so what the property loses is the record and the
   * amount check that reads it, on a payment the gateway signed and reported
   * either way. The other order loses a connection instead, on every attempt
   * rather than on the ones that failed: `database.module.ts` sizes the pool
   * at ten, and ten transactions held open across a gateway round trip is an API
   * that has stopped answering anything else.
   */
  async createPaymentRequest(
    request: GatewayPaymentRequest,
  ): Promise<OpenedPayment> {
    const reference = referenceFor(request.bookingId);

    // Checked here rather than left to the insert, because the failure is not
    // the insert's. An id that cannot be written into a reference mints an
    // attempt no callback could ever be resolved back to — money taken and never
    // posted — and Postgres would report it as a malformed uuid on a write that
    // happens after the payer has already been sent somewhere.
    if (!reference) {
      throw new ORPCError("BAD_REQUEST", {
        message: "That is not a booking id, so there is no stay to collect for",
      });
    }

    const { paymentUrl } = await this.gateway.createPayment({
      reference,
      // Minted here and stored in the reference's own timing, because the
      // gateway partitions transactions by the day an attempt was opened and a
      // later query has to name the same instant — `PaymentAttempt` says so.
      createdAt: new Date(),
      amount: request.amount,
      description: request.description,
      returnUrl: request.returnUrl,
      payerIpAddress: request.payerIpAddress,
    });

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
    const bookingId = bookingIn(transaction.reference);

    if (!bookingId) {
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

      await this.recordRefusal(
        bookingId,
        transaction.reference,
        transaction.amount,
      );

      return "REFUSED";
    }

    return await this.record(bookingId, transaction);
  }

  /**
   * The payment and its posting, or neither.
   *
   * A redelivered callback is answered by the database rather than by a look
   * this file took first — the note at the top argues why — and either answer
   * arrives as a thrown sentinel rather than a `return`. That is not a
   * preference. A `23505` aborts the transaction, Postgres accepts no further
   * statement on an aborted one, and the folio posting below is one; rolling the
   * whole thing back and reporting it outside the boundary is the only order the
   * database permits, and it is also the correct answer.
   *
   * A `23505` from anywhere else in this transaction is not possible to mistake
   * for those: `ensureFolio` settles its own conflict, and the sole uniqueness a
   * posting can violate is the reversal key, which no `PAYMENT` line sets.
   */
  private async record(
    bookingId: string,
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<CallbackOutcome> {
    try {
      await this.transactions.run(async (exec) => {
        const folioId = await this.take(exec, bookingId, transaction);

        await this.folios.postPayment(exec, {
          folioId,
          amount: transaction.amount,
          // The trading day the money moved in, which is not necessarily the
          // one this callback arrived in.
          businessDate: this.businessDates.current(transaction.paidAt),
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
   * **Nothing updated does not mean nothing to do.** The attempt's row is
   * absent whenever the transaction that opened it rolled back, which
   * {@link createPaymentRequest} accepts on purpose, and money that the gateway
   * says it took has to reach the account either way. So the fallback writes the
   * row the request would have — under the same reference, so the second
   * delivery of this callback collides with it rather than adding a third.
   *
   * **The amount is compared and never adopted.** What the row holds is what the
   * property asked for; a callback naming anything else rolls the whole
   * transaction back, leaving the attempt `PENDING` and the ledger untouched.
   * The header says why that is a refusal rather than a status. The fallback has
   * nothing to compare against — the figure the attempt was opened for went down
   * with the transaction that would have stored it — so it records what the
   * gateway reports, which is what `FR-PAY-05` holds against the gateway's own
   * daily report.
   */
  private async take(
    exec: DbExecutor,
    bookingId: string,
    transaction: Extract<GatewayTransaction, { status: "SUCCESS" }>,
  ): Promise<string> {
    try {
      const [attempt] = await exec
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

      if (attempt) {
        if (attempt.asked !== transaction.amount) {
          throw new ORPCError("CONFLICT", {
            message:
              "The gateway reports an amount this property did not open the " +
              "attempt for, so nothing has been posted and the attempt is " +
              "still outstanding",
          });
        }

        return attempt.folioId;
      }

      const folioId = await this.folios.ensureFolio(exec, bookingId);

      await exec.insert(payment).values({
        folioId,
        method: GATEWAY_METHOD,
        attemptReference: transaction.reference,
        gatewayTransactionId: transaction.gatewayTransactionId,
        amount: transaction.amount,
        status: "SUCCESS",
        paidAt: transaction.paidAt,
      });

      return folioId;
    } catch (error) {
      // Only Postgres' own refusal is read as an answer here. The two
      // `ORPCError`s that can reach this — the mismatch above and
      // `ensureFolio`'s missing booking — carry a `code` of their own that
      // `sqlStateOf` will happily hand back, and neither of them is `23505`, so
      // both travel on out of the transaction as the refusals they are.
      if (sqlStateOf(error) === UNIQUE_VIOLATION) {
        throw new AlreadyResolved();
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
   * The same two statements {@link take} uses and for the same reasons — the
   * attempt's own row resolved where there is one, and written where the
   * request that opened it rolled back. A refusal carries no gateway
   * transaction id and cannot, because `GatewayTransaction` will not name a
   * transaction nobody paid, so the reference is the only thing a second
   * delivery can be recognised by; `payment_attempt_reference_unique_key` is
   * what recognises it, and the duplicate `FAILED` row a redelivery used to
   * write is that index's refusal now.
   *
   * The amount is not compared here. Nothing is posted either way, so a figure
   * the gateway disagrees about is a disagreement over money that did not move —
   * and the row keeps what the property asked for, which is the figure a guest
   * asking why they were not charged is asking about.
   */
  private async recordRefusal(
    bookingId: string,
    reference: string,
    amount: VndAmount,
  ): Promise<void> {
    try {
      await this.transactions.run(async (exec) => {
        const [attempt] = await exec
          .update(payment)
          .set({ status: "FAILED" })
          .where(
            and(
              eq(payment.attemptReference, reference),
              eq(payment.status, "PENDING"),
            ),
          )
          .returning({ id: payment.id });

        if (attempt) {
          return;
        }

        const folioId = await this.folios.ensureFolio(exec, bookingId);

        try {
          await exec.insert(payment).values({
            folioId,
            method: GATEWAY_METHOD,
            attemptReference: reference,
            amount,
            status: "FAILED",
          });
        } catch (error) {
          if (sqlStateOf(error) === UNIQUE_VIOLATION) {
            throw new AlreadyResolved();
          }

          throw error;
        }
      });
    } catch (error) {
      // The attempt reached a terminal state before this delivery did. Nothing
      // to write and nothing to tell the gateway that it was not already going
      // to be told — a refusal answers "refused" however many times it arrives.
      if (error instanceof AlreadyResolved) {
        return;
      }

      throw error;
    }
  }
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

/**
 * The stay a reference was minted for, or nothing if this property did not mint
 * it.
 *
 * The hyphens go back in because a `uuid` column is compared as a uuid and not
 * as the text somebody wrote it in — thirty-two bare digits reach Postgres as a
 * cast it refuses, which would surface as a failed write rather than as the
 * "this is not ours" that it is.
 */
function bookingIn(reference: string): string | undefined {
  if (!REFERENCE_PATTERN.test(reference)) {
    return undefined;
  }

  const stay = reference.slice(0, UUID_HEX_LENGTH);

  return [
    stay.slice(0, 8),
    stay.slice(8, 12),
    stay.slice(12, 16),
    stay.slice(16, 20),
    stay.slice(20),
  ].join("-");
}
