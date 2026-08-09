// Writing the account, and answering the one question `booking` asks about it —
// `FR-FOL-01`, `FR-FOL-02`, and `docs/architecture/property-and-tariff.md` §5.
//
// `schema/folio.ts` holds the invariants and this holds the acts, which is why
// almost nothing here is checked twice. Append-only is a trigger; one account
// per stay is a unique key; a payment's sign is a `CHECK`; a line is reversed at
// most once because a partial unique index says so. A rule restated here would
// hold for this service's callers and for nobody else, and this service would
// still have to read the SQLSTATE off the refusal for the caller that went round
// it — so the writes go in unguarded and the refusal is the return value.
// `sql-state.ts` argues that convention at length. What is validated here is
// only what arrives from outside and no constraint can express as a sentence a
// caller could act on.
//
// **The balance is a query, and there is nowhere for it to be anything else.**
// `getBalance` sums the rows every time it is asked. `ports/folio.port.ts` gives
// the reason — "a balance this module computed would be a second place for a
// balance to live" — and `schema/folio.ts` refuses to hold the column that would
// be the other one. `NFR-02` is that sum: Σ postings = Σ payments + outstanding,
// which under the sign convention is the single addition below.
//
// **The port method reads on the pool, not on the caller's transaction.**
// `FolioPort.getBalance` takes a booking id and nothing else, deliberately —
// `booking` is not given an executor to hand across the boundary. So the
// check-out guard is answered from committed state: every payment that has been
// recorded, and none that is still being written in a transaction somewhere. The
// desk's own path never straddles that, because a payment is committed by the
// request that took it long before the request that closes the stay asks. A
// caller that ever needs to post and settle in one transaction needs a wider
// port than `booking` has any use for, and widening it is that caller's task.
//
// **A gross figure posts as three rows in one statement.** The two derived lines
// name the charge they were levied on, so they need its id — and taking that id
// from a first `INSERT` would leave the charge on the account without its tax
// for as long as the second statement took, and permanently if the caller had
// not opened a transaction. Generating the id here instead puts all three rows
// in one `INSERT`, which Postgres settles atomically and whose foreign-key
// checks run at the end of the statement, so a child may name a parent written
// beside it. The three then either arrive together or not at all, whatever
// boundary the caller opened.
//
// **The close is the one act here that reads before it writes.** Everything
// else on this service writes unguarded and reads the refusal off the SQLSTATE,
// because a constraint can say what it refused. A balance cannot: it is a sum
// over another table, so no `CHECK` on `folio` can see it, and the sentence
// `FR-FOL-01` asks for — an account is agreed only when it comes to nothing —
// has nowhere else to live. So {@link FolioService.close} takes the account's
// row lock first, sums under it, and refuses with the figure still outstanding,
// which is the one answer a receptionist can act on.
//
// The lock is what makes the sum true a moment later. Without it the balance is
// read, a charge lands on another connection, and the close writes `CLOSED`
// over an account that no longer settles — `NFR-02` broken by two statements
// that were each correct. Held, the two orders both end well: a posting already
// in flight is waited for and counted, and one that arrives afterwards meets the
// trigger `migrations/0016` puts on the ledger and is refused. That trigger is
// `FR-FOL-01`'s other half, and this file said where it would go — with the
// close that creates the state, which is here.
//
// **The policy refund reads before it writes for the same reason, and takes the
// same lock.** `FR-PAY-04` puts §4's grid on the ledger, and what the grid
// charges depends on the stay's own record — the plan, the nights it froze, and
// whether it was cancelled, never arrived or is ending early. None of that is a
// column on `folio_posting`, so no constraint can decide it and the read is
// unavoidable. What the lock buys is that the balance summed under it is still
// the balance when the two lines are written: the money handed back is what the
// stay is over-paid by once the charge stands against it, and a payment landing
// between the sum and the insert would be a guest refunded money they had just
// paid. It also serialises two desks refunding one cancellation, which is the
// arrangement that pays a guest twice for one stay.
//
// **The booking's own tables are read here, in SQL, through the caller's
// executor.** `booking.module.ts` imports this module to bind `FOLIO_PORT`, so
// this module cannot import that one back, and the figures §4 prices are the
// booking's: `booking_night`'s per-night prices and the state that says what
// ended the stay. `stay-quote.service.ts` reads across the same kind of boundary
// and gives the sharper half of the reason — the read has to be in the
// transaction that writes from it, and a service reached through Nest would
// answer from another connection with another snapshot.
//
// **What the close does not do is issue the invoice.** `FR-FOL-04` requires
// that a provider timeout never roll back a checkout, and nothing in this
// transaction can honour that if the transaction is also waiting on a provider.
// So the close commits the state and nothing else; `e-invoice.job.ts` reads the
// account it left behind and argues why that commit is the enqueue.

import { randomUUID } from "node:crypto";
import { parseDate } from "@internationalized/date";
import {
  type ChargeBasis,
  nightCount,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, asc, eq, or, sql } from "drizzle-orm";
import {
  type Database,
  type DbExecutor,
  DRIZZLE,
} from "../../database/database.module.js";
import { booking, bookingNight } from "../../database/schema/booking.js";
import { folio, folioPosting } from "../../database/schema/folio.js";
import { staffUser } from "../../database/schema/identity.js";
import { sqlStateOf } from "../../database/sql-state.js";
// The grid itself, imported as the pure function it is. `booking.module.ts`
// imports this module to bind the port and importing that module back would be
// a cycle — but `cancellation-calculator.ts` is no provider and reaches nothing:
// it selects and scales the stored nights and persists nothing, which is why it
// was written where §4's other rules live and why it can be called from here
// without either module learning about the other.
import {
  type PolicyCharge,
  type PolicyEvent,
  policyCharge,
} from "../booking/cancellation-calculator.js";
// A type, so it erases: `booking.module.ts` imports this module to bind the
// port, and a value imported back the other way would be a cycle. The port is
// the only thing the two modules share, which is what it is for.
import type { FolioPort } from "../booking/ports/folio.port.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { decomposeGross } from "./tax-decomposition.js";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
// This system's own, raised by the trigger `migrations/0016` puts on the ledger
// — five characters in a class the standard reserves for implementations, so a
// closed account is told apart from any other refusal without reading a message.
const CLOSED_FOLIO_VIOLATION = "MV002";

/** A line a folio is asked to write, less what every line carries. */
interface PostingRequest {
  readonly folioId: string;
  /** The trading day the line belongs to — `schema/folio.ts` on the pair. */
  readonly businessDate: StayDate;
  /** What the guest reads on the invoice, written now rather than resolved
   *  later from a row that may since have been renamed. */
  readonly description: string;
  /** Null for a line no person authored — the sweep and the gateway's IPN. */
  readonly postedBy?: string | null;
}

/**
 * A charge as the guest agreed to it: one gross figure, not three.
 *
 * §5 quotes gross and shows the folio net, so what arrives here is the figure
 * that was accepted and the three lines are derived from it. Adding a service
 * charge and a tax on top of a gross price bills the guest more than the price
 * they said yes to.
 */
export interface RoomChargeRequest extends PostingRequest {
  readonly grossAmount: VndAmount;
}

/**
 * Money the property has received.
 *
 * The amount is what the guest handed over — a positive figure — and the ledger
 * stores its negation. The sign convention lives in `schema/folio.ts` and is
 * applied in exactly one place, which is here: a caller that had to remember to
 * negate is a caller that will one day forget, and the `CHECK` would refuse it
 * as a fault rather than as an answer anybody could act on.
 */
export interface PaymentRequest extends PostingRequest {
  readonly amount: VndAmount;
}

/**
 * A correction — `FR-FOL-01`'s reversing entry.
 *
 * `postedBy` is required and the other requests' is not. The two writers with
 * nobody behind them post; neither reverses. Deciding that a line on a guest's
 * account was a mistake is somebody's judgement, and an invoice cannot say whose
 * if the column is null.
 */
export interface ReversalRequest {
  readonly postingId: string;
  readonly businessDate: StayDate;
  readonly postedBy: string;
}

/**
 * §4's grid, asked for by naming the stay and nothing else — `FR-PAY-04`.
 *
 * No amount and no event, which is the whole of the difference between this
 * request and {@link OverrideRefundRequest}. Both are read off the booking:
 * `contract/folio.ts` argues why a caller able to send either would be holding
 * the override's authority under the policy capability.
 *
 * The stay is named as well as its account, because both are read — the account
 * for its lines and the booking for what §4 prices. The caller resolves the pair
 * ({@link FolioService.ensureFolio} answers with the folio of the booking it was
 * given), so the two agree by construction rather than by a check here.
 *
 * `postedBy` is required, as a reversal's is. Applying the grid is a person
 * deciding that a stay ended and that the property may keep part of what was
 * paid for it — the last line on an account anybody should be able to file
 * without a name against it.
 */
export interface PolicyRefundRequest {
  readonly folioId: string;
  readonly bookingId: string;
  readonly businessDate: StayDate;
  readonly postedBy: string;
}

/**
 * Money handed back outside §4 — the manager's figure, and why.
 *
 * The amount is what the guest receives, positive, and stored positive: the
 * negation a payment takes is not applied here because a refund moves the
 * balance the other way. `schema/folio.ts` holds that convention and
 * `folio_posting_sign_matches_type` refuses the row that ignores it.
 *
 * The reason is required and becomes the line's description. `FR-PAY-04` gives
 * this route to `MANAGER`+ precisely because it departs from the property's own
 * policy, and an append-only ledger cannot have the explanation added later.
 */
export interface OverrideRefundRequest {
  readonly folioId: string;
  readonly amount: VndAmount;
  readonly reason: string;
  readonly businessDate: StayDate;
  readonly postedBy: string;
}

/**
 * A line as a reader of the account sees it.
 *
 * `businessDate` stays the ISO text the column holds rather than being parsed
 * into a `StayDate` and printed back out again — the same crossing
 * `search.service.ts` declines to make for a stay's boundaries, and for the same
 * reason: nothing between the query and the wire does arithmetic on it.
 *
 * `postedBy` is the member of staff by name and not by id, which is what the
 * question behind the column actually is: an accountant reading a correction
 * wants to know who filed it. Null for a line no person authored.
 */
export interface FolioLine {
  readonly id: string;
  readonly type: (typeof folioPosting.$inferSelect)["type"];
  readonly amount: VndAmount;
  readonly description: string;
  readonly businessDate: string;
  readonly reversesPostingId: string | null;
  readonly parentPostingId: string | null;
  /** Which row of §4's grid a policy charge is. Null on every other type. */
  readonly chargeBasis: (typeof folioPosting.$inferSelect)["chargeBasis"];
  readonly postedAt: Date;
  readonly postedBy: string | null;
}

/** The three figures `NFR-02` states, derived from the lines below them. */
export interface FolioSummary {
  readonly charged: VndAmount;
  readonly credited: VndAmount;
  readonly outstanding: VndAmount;
}

/**
 * The account as the close left it.
 *
 * The instant comes back because it is the invoice's date — `schema/folio.ts`
 * says the invoice is issued when the desk closed the folio — and because it is
 * Postgres' `now()` rather than this process's, so the caller that has to print
 * it should be told what was stored rather than guess.
 *
 * No invoice reference. There is not one yet, and there will not be for as long
 * as the queue takes: a field that was null on every close would read as a
 * document that failed to issue rather than one nobody has issued yet.
 */
export interface ClosedFolio {
  readonly id: string;
  readonly closedAt: Date;
}

/** One stay's account, whole. */
export interface FolioAccount {
  readonly id: string;
  readonly bookingId: string;
  readonly state: (typeof folio.$inferSelect)["state"];
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly summary: FolioSummary;
  readonly lines: readonly FolioLine[];
}

@Injectable()
export class FolioService implements FolioPort {
  constructor(
    // The client rather than an executor, and only `getBalance` uses it: the
    // port hands over a booking id and no transaction. Every write below takes
    // the caller's executor, for the reason `database.module.ts` gives.
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly configuration: SystemConfigService,
  ) {}

  /**
   * What the booking still owes, summed from its lines — the port's one method.
   *
   * Zero for a stay with no folio, and that is the true answer rather than a
   * convenience: an account nobody has opened has had nothing posted to it, so
   * there is nothing outstanding. The check-out guard reads `!== 0n`, so this
   * must not report a stay unsettled for never having been charged.
   *
   * The sum comes back as text because Postgres widens `sum(bigint)` to
   * `numeric` and the driver hands a numeric over as a string. Parsed to
   * `bigint` from that text, which is the one route that cannot lose a đồng —
   * `NFR-12`, and `schema/folio.ts` on why `number` is not an option.
   */
  async getBalance(bookingId: string): Promise<VndAmount> {
    const [summed] = await this.db
      .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
      .from(folioPosting)
      .innerJoin(folio, eq(folio.id, folioPosting.folioId))
      .where(eq(folio.bookingId, bookingId));

    // Null on an account with no lines, and on a booking with no account at
    // all: the aggregate answers once either way.
    return BigInt(summed?.balance ?? "0");
  }

  /**
   * The whole account: what it is, every line on it, and what they come to.
   *
   * Null when the stay has no account — which is both a booking nobody has
   * posted anything for and a booking id that names nothing. The two are one
   * answer here because the folio table is the only one this reads; the caller
   * turns it into the refusal a reader can act on.
   *
   * **The balance is summed from the rows being returned, not queried beside
   * them.** {@link getBalance} asks Postgres for the sum because the port hands
   * it a booking id and nothing else; here the lines are already in hand, and a
   * second `sum()` would be a figure that could disagree with the list printed
   * under it. `NFR-02`'s identity is the addition below and nothing stores its
   * result — `schema/folio.ts` refuses to hold the column that would.
   *
   * Two statements rather than a join, because a folio with no lines is an
   * ordinary answer — the account was opened and the first posting failed, or
   * the sweep has not run — and a join would return one row of nulls that the
   * caller has to tell apart from a real line.
   */
  async read(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<FolioAccount | null> {
    const [account] = await exec
      .select({
        id: folio.id,
        state: folio.state,
        openedAt: folio.createdAt,
        closedAt: folio.closedAt,
      })
      .from(folio)
      .where(eq(folio.bookingId, bookingId))
      .limit(1);

    if (!account) {
      return null;
    }

    // Left, not inner: `postedBy` is null on every line the sweep and the
    // gateway wrote, and an inner join would silently drop exactly the postings
    // nobody authored — which on a room-only stay is all of them.
    const lines = await exec
      .select({
        id: folioPosting.id,
        type: folioPosting.type,
        amount: folioPosting.amount,
        description: folioPosting.description,
        businessDate: folioPosting.businessDate,
        reversesPostingId: folioPosting.reversesPostingId,
        parentPostingId: folioPosting.parentPostingId,
        chargeBasis: folioPosting.chargeBasis,
        postedAt: folioPosting.postedAt,
        postedBy: staffUser.fullName,
      })
      .from(folioPosting)
      .leftJoin(staffUser, eq(staffUser.id, folioPosting.postedBy))
      .where(eq(folioPosting.folioId, account.id))
      // The trading day first, then the moment inside it, then the id so the
      // order is total. `FR-FOL-02`'s three lines go in as one statement and
      // therefore share an instant, so their order among themselves is the id's
      // and means nothing — `parentPostingId` is what ties the sale to what was
      // levied on it, and that is what a renderer groups on.
      .orderBy(
        asc(folioPosting.businessDate),
        asc(folioPosting.postedAt),
        asc(folioPosting.id),
      );

    return { ...account, bookingId, summary: summarise(lines), lines };
  }

  /**
   * The stay's account, opened if this is the first thing it needs one for.
   *
   * One statement rather than a read followed by an insert. Two requests
   * arriving together on a stay with no folio would both find nothing and both
   * insert, and `folio_booking_id_unique` would refuse the loser — a posting
   * failing because another posting happened first. `on conflict do update`
   * lets Postgres settle it and hand back the row either way, which is the
   * argument `housekeeping.service.ts` makes for the same shape. The update
   * writes the key back to itself: there is nothing to change, and the point is
   * to have a row returned rather than none.
   */
  async ensureFolio(exec: DbExecutor, bookingId: string): Promise<string> {
    try {
      const [ensured] = await exec
        .insert(folio)
        .values({ bookingId })
        .onConflictDoUpdate({ target: folio.bookingId, set: { bookingId } })
        .returning({ id: folio.id });

      return ensured!.id;
    } catch (error) {
      if (sqlStateOf(error) === FOREIGN_KEY_VIOLATION) {
        throw new ORPCError("NOT_FOUND", {
          message: "No booking with that id, so there is no stay to open an account for",
        });
      }

      throw error;
    }
  }

  /**
   * Agrees the account and stops it — `FR-FOL-01`, and the moment `FR-FOL-04`
   * hangs the invoice off.
   *
   * **The row is locked before the balance is read, and that order is the whole
   * guarantee.** `FOR UPDATE` on the folio conflicts with the share lock the
   * ledger's trigger takes when a posting is written, so the two acts cannot
   * interleave: a charge already being written is waited for and included in the
   * sum, and one that arrives after this commits reads `CLOSED` and is refused.
   * Reading the balance first and locking afterwards would close accounts that
   * settled a millisecond ago, which is the failure `NFR-02` reports weeks later
   * as a ledger that does not add up. The lock only lasts as long as the
   * caller's transaction, which every write in this tree is handed — a caller
   * that passed the client instead would be holding a row lock that Postgres
   * released at the end of the statement, and would get the balance it happened
   * to see. `database.module.ts` says whose job that boundary is.
   *
   * **A second close is refused rather than passed over.** It would be easy to
   * make idempotent — the account is already closed, which is what the caller
   * wanted — and it would be the wrong answer twice over. A desk that closes
   * twice has one stay it thinks is open, and `FR-FOL-04` reads a closed folio
   * as one invoice: a close that succeeded silently is a second act with a
   * legal document behind it, so the refusal carries the moment the first one
   * happened and lets a person work out which checkout they are looking at.
   *
   * The balance is summed here rather than through {@link getBalance} because
   * that method reads on the pool by a booking id, deliberately —
   * `booking/ports/folio.port.ts` says why — and a close that asked it would be
   * summing on a connection outside the lock it just took.
   */
  async close(exec: DbExecutor, bookingId: string): Promise<ClosedFolio> {
    const [account] = await exec
      .select({ id: folio.id, state: folio.state, closedAt: folio.closedAt })
      .from(folio)
      .where(eq(folio.bookingId, bookingId))
      .limit(1)
      .for("update");

    if (!account) {
      throw new ORPCError("NOT_FOUND", {
        message:
          "That stay has no account, so there is nothing to agree — " +
          "a folio is opened by the first thing posted to it",
      });
    }

    if (account.state === "CLOSED") {
      throw new ORPCError("CONFLICT", {
        message: `That account was already closed at ${account.closedAt?.toISOString()} and has an invoice of its own`,
      });
    }

    const [summed] = await exec
      .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
      .from(folioPosting)
      .where(eq(folioPosting.folioId, account.id));

    // Null on an account nobody posted to, which settles at nothing and closes
    // — a stay that ran up no charge owes none.
    const outstanding = BigInt(summed?.balance ?? "0");

    if (outstanding !== 0n) {
      throw new ORPCError("CONFLICT", {
        message:
          outstanding > 0n
            ? `That account is short by ${outstanding} ₫ and cannot be agreed until it is settled`
            : `That account is over-paid by ${-outstanding} ₫ — the difference is refunded before it is agreed`,
      });
    }

    // Postgres' clock and not this process's, for the reason `sweep-job.ts`
    // gives: inside a transaction `now()` is the transaction's own start, so the
    // instant stored is the one every statement of this close shares and is
    // identical on whichever connection took it.
    //
    // The state is named in the predicate as well as in the lock above. It costs
    // nothing and it is what makes the statement refuse rather than overwrite,
    // should this ever be called from a path that did not take the lock.
    const [closed] = await exec
      .update(folio)
      .set({ state: "CLOSED", closedAt: sql`now()` })
      .where(and(eq(folio.id, account.id), eq(folio.state, "OPEN")))
      .returning({ id: folio.id, closedAt: folio.closedAt });

    return { id: closed!.id, closedAt: closed!.closedAt! };
  }

  /**
   * A night, as the charge and the two percentages levied on it — `FR-FOL-02`.
   *
   * The rates are read here, inside the caller's executor, for the business date
   * being posted. Not at boot, not from a constant, and not held between
   * postings: §8 files the VAT rate, the relief window and the tax-base rule as
   * answers the accountant still owes, so a figure this method remembered would
   * be an `ADMIN`'s correction that the next invoice did not notice. A date the
   * configuration does not cover stops the posting rather than assuming a rate —
   * `system-config.service.ts` argues that refusal, and nothing is written when
   * it fires because the read comes first.
   *
   * Returns the charge's id. It is the id a correction is issued against: the
   * two derived lines name it, so `id = $1 or parent_posting_id = $1` is the
   * whole sale, and {@link reversePosting} undoes exactly that set.
   */
  async postRoomCharge(
    exec: DbExecutor,
    charge: RoomChargeRequest,
  ): Promise<string> {
    if (charge.grossAmount < 0n) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "A charge is money the guest owes, so it cannot be negative — " +
          "handing money back is a refund and taking a line off the account is a reversal",
      });
    }

    const lines = decomposeGross(
      charge.grossAmount,
      await this.configuration.taxRules(exec, charge.businessDate),
    );

    // Generated here rather than by the column's default, so the three rows go
    // in as one statement. The header says why that matters.
    const chargeId = randomUUID();
    const businessDate = charge.businessDate.toString();
    const postedBy = charge.postedBy ?? null;

    await this.write(exec, [
      {
        id: chargeId,
        folioId: charge.folioId,
        type: "ROOM_CHARGE",
        // The residual of the decomposition, never a fourth division of its
        // own: `tax-decomposition.ts` puts the odd đồng here precisely so the
        // three lines sum to the figure the guest agreed to.
        amount: lines.netCharge,
        description: charge.description,
        businessDate,
        postedBy,
      },
      {
        folioId: charge.folioId,
        type: "SERVICE_CHARGE_FEE",
        amount: lines.serviceCharge,
        description: `Service charge on ${charge.description}`,
        parentPostingId: chargeId,
        businessDate,
        postedBy,
      },
      {
        folioId: charge.folioId,
        type: "VAT",
        amount: lines.vat,
        description: `VAT on ${charge.description}`,
        parentPostingId: chargeId,
        businessDate,
        postedBy,
      },
    ]);

    // Both derived lines are written even at nothing. A property levying no
    // service charge, or a supply the configuration zero-rates, is a real
    // configuration — `schema/config.ts` says a rate of zero is not a mistake —
    // and a folio that showed two lines on one night and one on the next would
    // read as a night whose tax somebody forgot rather than as a night with
    // none. The sum is the same either way, so this costs a row and buys an
    // invoice that says what happened.
    return chargeId;
  }

  /**
   * Money in — the same append-only path every other line takes.
   *
   * Stored negative, so the balance stays a plain sum and zero stays settled.
   * A non-positive amount is refused here rather than at the `CHECK`, because
   * the constraint cannot tell a caller which of the two mistakes they made: a
   * payment of nothing is a receipt nobody issued, and a negative one is a
   * refund, which is a different line with a different sign and its own route.
   */
  async postPayment(exec: DbExecutor, payment: PaymentRequest): Promise<string> {
    if (payment.amount <= 0n) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "A payment is money the property has received, so the amount is what " +
          "the guest handed over — returning money is a refund",
      });
    }

    const [postingId] = await this.write(exec, [
      {
        folioId: payment.folioId,
        type: "PAYMENT",
        amount: -payment.amount,
        description: payment.description,
        businessDate: payment.businessDate.toString(),
        postedBy: payment.postedBy ?? null,
      },
    ]);

    return postingId!;
  }

  /**
   * `FR-FOL-01`'s correction: a new line, never an edit.
   *
   * **It undoes the sale and everything levied on it.** Reversing a room charge
   * alone would leave its service charge and its VAT standing on the account —
   * tax on a night the property has agreed did not happen. `schema/folio.ts`
   * names that set as `id = $1 or parent_posting_id = $1` and leaves the choice
   * of when to reverse it to this service; this is the choice. Pointed at a
   * derived line the set is that line alone, which is the narrower correction
   * somebody may also want.
   *
   * **The amount is read, not accepted.** A reversal whose figure the caller
   * supplied is a second chance to get the figure wrong, and the row it undoes
   * already holds the only correct one. The database refuses a second reversal
   * of the same line and this does not check for one first — a read followed by
   * an insert would pass while two of them raced, which is the one arrangement
   * under which a guest is credited twice for a single mistake.
   *
   * The business date is the caller's, not the reversed line's. A correction is
   * an act of the day it was made, and dating it back would move a figure inside
   * a trading day the property has already reconciled.
   */
  async reversePosting(
    exec: DbExecutor,
    reversal: ReversalRequest,
  ): Promise<readonly string[]> {
    const undone = await exec
      .select({
        id: folioPosting.id,
        folioId: folioPosting.folioId,
        amount: folioPosting.amount,
        description: folioPosting.description,
      })
      .from(folioPosting)
      .where(
        or(
          eq(folioPosting.id, reversal.postingId),
          eq(folioPosting.parentPostingId, reversal.postingId),
        ),
      );

    if (undone.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "No posting with that id, so there is no line to correct",
      });
    }

    const businessDate = reversal.businessDate.toString();

    return await this.write(
      exec,
      undone.map((line) => ({
        folioId: line.folioId,
        type: "REVERSAL" as const,
        // The exact negation, which is what makes the pair sum to nothing. The
        // sign rule exempts a reversal for this: undoing a payment is positive
        // and undoing a charge is negative, and both are one act.
        amount: -line.amount,
        description: `Reverses ${line.description}`,
        reversesPostingId: line.id,
        businessDate,
        postedBy: reversal.postedBy,
      })),
    );
  }

  /**
   * §4's grid, finally posted — `FR-PAY-04`.
   *
   * **Two lines, and the pair is what the grid actually means.**
   * `property-and-tariff.md` §4 is emphatic that every cell is a penalty and not
   * a settlement total: the figure is what the stay owes *on top of* whatever
   * the folio already carries. So the charge goes on as a `POLICY_CHARGE`
   * naming which row it is, and what the account is then over-paid by is the
   * money going back. Refunding a figure computed as "what they paid less the
   * penalty" would be the same arithmetic done where nothing can check it —
   * here the ledger does the subtraction, and a stay that had also run up a
   * minibar bill is refunded what it is actually owed rather than what it paid.
   *
   * **The basis rides on the charge because that is the only row that may carry
   * it.** `folio_posting_names_a_basis_exactly_when_a_policy_charge` makes the
   * column and the type a biconditional, so a `REFUND` line naming
   * `FIRST_NIGHT` is a row the database refuses. That constraint and this
   * arrangement want the same thing: the grid's decision is recorded once, on
   * the charge it decided, and the refund beside it is money — an amount, not a
   * classification. A free cancellation still posts the charge at nothing,
   * because `NONE` is a row of the grid and not the absence of one.
   *
   * **The charge is not decomposed.** `FR-FOL-02` splits a *sale* into a net
   * charge, a service charge and a tax line, and `schema/folio.ts` records that
   * whether a policy charge carries tax at all is §4's silence and `ASM-01`'s
   * unanswered question. A decomposition invented here would put a VAT line on
   * a penalty nobody has ruled is a taxable supply, on an invoice.
   *
   * **A waived stay is priced at nothing, and the booking is what says so.**
   * `booking.cancel-waiver` is `MANAGER`+ and this route is a receptionist's, so
   * the two decisions are made in different requests by different people; the
   * waiver columns on `booking` are the whole of what carries the first to the
   * second. Read here rather than in the grid, because §4's table has no waiver
   * cell — see the short-circuit below.
   *
   * **Applied once per account, and a second attempt is refused rather than
   * ignored.** The grid prices the whole of what ended the stay, so a second
   * application charges the same cancellation twice; the refusal names the
   * reversal and the override as the two honest ways forward. A charge that has
   * been reversed does not count — the desk took it back, and the account is
   * open to the grid again.
   */
  async postPolicyRefund(
    exec: DbExecutor,
    refund: PolicyRefundRequest,
  ): Promise<readonly string[]> {
    // The account's row, locked before anything is summed under it. `FOR
    // UPDATE` conflicts with the `FOR SHARE` the ledger's trigger takes on
    // every insert — `migrations/0016` argues that pairing where it is written
    // — so no posting can land between the balance read below and the lines
    // written from it, in this request or in another one. Nothing is selected
    // out of it: the caller resolved the id, and what is wanted is the lock.
    await exec
      .select({ id: folio.id })
      .from(folio)
      .where(eq(folio.id, refund.folioId))
      .limit(1)
      .for("update");

    const [found] = await exec
      .select({
        state: booking.state,
        plan: booking.ratePlanCode,
        checkInDate: booking.checkInDate,
        // The departure the stay currently claims, which an early one has
        // already moved back — `assignment.service.ts` writes it and leaves the
        // `booking_night` rows of the nights it released standing. The gap
        // between the two is the only record that a departure was brought
        // forward at all, and {@link policyEventOf} is the reader of it.
        departsOn: booking.checkOutDate,
        // When the stay ended, for the one row of the grid that is decided by
        // an instant. The cancellation's own column and not `updated_at`:
        // `CANCELLED` is terminal, but the *row* is not, and any later touch of
        // it — an audit backfill, a reference rewrite — would move a
        // cancellation across §4's 18:00 deadline without anybody cancelling
        // anything. Null on every stay that was not cancelled, which is exactly
        // the set of stays {@link policyEventOf} decides without an instant.
        endedAt: booking.cancelledAt,
        // The manager's decision to set §4 aside, read here because this is
        // where §4 is applied. `booking.cancel-waiver` admits the caller who
        // grants it and `folio.refund-policy` admits the caller who prices the
        // stay — two capabilities, two requests, and nothing but this column
        // carries the first decision to the second.
        penaltyWaivedAt: booking.penaltyWaivedAt,
      })
      .from(booking)
      .where(eq(booking.id, refund.bookingId))
      .limit(1);

    // `folio.booking_id` references this row, so the caller that resolved an
    // account resolved a stay with it.
    const stay = found!;

    const lines = await exec
      .select({
        id: folioPosting.id,
        type: folioPosting.type,
        amount: folioPosting.amount,
        reversesPostingId: folioPosting.reversesPostingId,
      })
      .from(folioPosting)
      .where(eq(folioPosting.folioId, refund.folioId));

    const reversed = new Set(
      lines.map((line) => line.reversesPostingId).filter((id) => id !== null),
    );
    const standing = lines.filter((line) => !reversed.has(line.id));

    if (standing.some((line) => line.type === "POLICY_CHARGE")) {
      throw new ORPCError("CONFLICT", {
        message:
          "§4's charge is already on this account, and the grid prices what " +
          "ended the stay once — reverse that line to price it again, or hand " +
          "money back at a manager's discretion",
      });
    }

    // Every night the booking sold, and not the range it currently covers. An
    // early departure shortens the stay and *keeps* the released
    // `booking_night` rows — `assignment.service.ts` says why, in as many words:
    // they are the basis of the charge. Bounding this by the booking's current
    // departure date would price the stay the guest is actually taking and
    // charge nothing for the nights they gave back, which is the one figure §4's
    // last row exists to state.
    const nights = await exec
      .select({ gross: bookingNight.standardGross })
      .from(bookingNight)
      .where(eq(bookingNight.bookingId, refund.bookingId))
      .orderBy(asc(bookingNight.stayDate));

    if (nights.length === 0) {
      // The calculator raises a `RangeError` on this, correctly — it is a
      // caller that assembled its input wrongly. Answered here instead, because
      // from a route it is a stay whose stored prices are missing and a 500
      // would say nothing about which stay or why.
      throw new ORPCError("CONFLICT", {
        message:
          "That stay has no stored night prices, so §4's grid has nothing to " +
          "scale — the per-night figures are frozen when the booking is taken",
      });
    }

    const arrival = parseDate(stay.checkInDate);

    // **The waiver is settled above the grid, not inside it.** §4's table is
    // keyed on the event and the rate plan and has no waiver column, and
    // `cancellation-calculator.ts` mirrors it exactly — teaching either of them
    // about an authority decision would make the code and the document disagree
    // about what the grid is. So a waived stay never reaches the calculator, and
    // what is posted is `NONE`: a row of the grid, and the same line a free
    // cancellation writes. The charge still goes on, because the account has to
    // say that §4 was applied and came to nothing; the refund below then hands
    // back the whole of what the account is over-paid by, which is what a waiver
    // means in money.
    const charge: PolicyCharge = stay.penaltyWaivedAt
      ? { amount: 0n, basis: "NONE" }
      : policyCharge({
          plan: stay.plan,
          checkInDate: arrival,
          nights: nights.map((night) => night.gross),
          event: policyEventOf({
            state: stay.state,
            endedAt: stay.endedAt,
            // Nights the folio has actually been charged for, which is what the
            // calculator asks for by name — never a date subtraction. A
            // reversed room charge is a night the property agreed did not
            // happen, so it is not one of them, and counting it would leave the
            // remaining-nights charge one night short.
            nightsSpent: standing.filter((line) => line.type === "ROOM_CHARGE")
              .length,
            // Nights the stay was sold, less the nights it still covers. An
            // early departure keeps the `booking_night` rows it gave back, so
            // this is above nothing exactly when a departure was brought
            // forward.
            nightsReleased:
              nights.length -
              nightCount({
                checkIn: arrival,
                checkOut: parseDate(stay.departsOn),
              }),
          }),
        });

    const businessDate = refund.businessDate.toString();

    const posting: (typeof folioPosting.$inferInsert)[] = [
      {
        folioId: refund.folioId,
        type: "POLICY_CHARGE",
        amount: charge.amount,
        chargeBasis: charge.basis,
        description: POLICY_CHARGE_DESCRIPTIONS[charge.basis],
        businessDate,
        postedBy: refund.postedBy,
      },
    ];

    // What the account comes to once the penalty stands against it. Negative is
    // the property holding money that is not its own — `schema/folio.ts` on the
    // sign convention — and that figure, exactly, is the refund. Zero or
    // positive is a stay that still owes, and there is nothing to hand back.
    const settled =
      lines.reduce<VndAmount>((total, line) => total + line.amount, 0n) +
      charge.amount;

    if (settled < 0n) {
      posting.push({
        folioId: refund.folioId,
        type: "REFUND",
        // Positive, undoing the payment it hands back. No `chargeBasis`: the
        // charge above carries the grid's decision, and the check constraint
        // permits it on no other row.
        amount: -settled,
        description: "Refund of the balance after the policy charge",
        businessDate,
        postedBy: refund.postedBy,
      });
    }

    // One statement, so the penalty and the money it decided are one act. Two
    // inserts would leave an account showing a charge the guest was never
    // refunded against for as long as the second took, and permanently if it
    // failed.
    return await this.write(exec, posting);
  }

  /**
   * Money handed back outside §4 — `FR-PAY-04`'s discretionary half.
   *
   * One line, and the caller's figure. Everything that makes the policy refund
   * long is absent here on purpose: no grid, no event, no reading of the stay,
   * because the amount is a manager's judgement and not something the record can
   * be asked for. `rbac-matrix.md` §2 is why the two are separate methods
   * reached by separate routes rather than one method with an optional amount —
   * the capability declaration is the guarantee, and it can only guard a route.
   *
   * Nothing here refuses a refund larger than the account's credit. It would be
   * a rule §4 does not state, and the two things it would stop are a manager
   * compensating a guest beyond what they paid — which is the judgement this
   * route exists for — and a typo, which the ledger already answers for: the
   * balance goes positive, the stay reads as owing money, and `close` refuses
   * the account until somebody reverses the line.
   */
  async postOverrideRefund(
    exec: DbExecutor,
    refund: OverrideRefundRequest,
  ): Promise<string> {
    if (refund.amount <= 0n) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "A refund is money the property is handing back, so the amount is " +
          "what the guest receives — taking money in is a payment",
      });
    }

    const [postingId] = await this.write(exec, [
      {
        folioId: refund.folioId,
        type: "REFUND",
        // Stored as it arrived, where a payment is negated. Handing money back
        // undoes a payment, so it increases what the stay owes and the sign
        // check refuses it any other way round.
        amount: refund.amount,
        description: `Discretionary refund — ${refund.reason}`,
        businessDate: refund.businessDate.toString(),
        postedBy: refund.postedBy,
      },
    ]);

    return postingId!;
  }

  /**
   * Writes lines and hands back their ids, with Postgres' refusal read as an
   * answer rather than a fault.
   *
   * Three SQLSTATEs are translated and the rest are re-thrown as they are.
   * `23503` is a key naming a row that is not there — the folio, or the staff
   * account a line is attributed to. `23505` can only be
   * `folio_posting_reversal_unique_key` on this table, because it is the only
   * uniqueness a posting can violate; every other column is free to repeat.
   * `MV002` is the account having been agreed and invoiced before this line
   * arrived, which is not a fault of the line and is why it is answered rather
   * than raised.
   */
  private async write(
    exec: DbExecutor,
    lines: (typeof folioPosting.$inferInsert)[],
  ): Promise<readonly string[]> {
    try {
      const written = await exec
        .insert(folioPosting)
        .values(lines)
        .returning({ id: folioPosting.id });

      return written.map((line) => line.id);
    } catch (error) {
      const state = sqlStateOf(error);

      if (state === FOREIGN_KEY_VIOLATION) {
        throw new ORPCError("NOT_FOUND", {
          message:
            "That folio, or the staff account the line is attributed to, does not exist",
        });
      }

      if (state === UNIQUE_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          message:
            "That line, or one of the lines levied on it, has already been " +
            "reversed — a mistake is corrected once",
        });
      }

      if (state === CLOSED_FOLIO_VIOLATION) {
        throw new ORPCError("CONFLICT", {
          message:
            "That account was closed and invoiced as it then stood, so it takes " +
            "no further lines — a change after the close is an invoice adjustment",
        });
      }

      throw error;
    }
  }
}

/**
 * What a policy charge says it is, on the invoice the guest reads.
 *
 * Keyed on the basis alone, and never on what ended the stay. A no-show and a
 * late cancellation are one row of §4's grid — both charge the first night — so
 * a wording that named the event would print two different sentences for one
 * decision, and an accountant reconciling them would have to know the grid to
 * see that they matched. The machine-readable half is the `charge_basis` column
 * beside it; this is the human half, and the two cannot drift because both come
 * from the same value.
 */
const POLICY_CHARGE_DESCRIPTIONS: Record<ChargeBasis, string> = {
  NONE: "No policy charge — cancelled inside the free window",
  FIRST_NIGHT: "Policy charge — the first night",
  FULL_STAY: "Policy charge — the whole stay",
  REMAINING_NIGHTS_HALF: "Policy charge — the remaining nights at 50%",
  REMAINING_NIGHTS_FULL: "Policy charge — the remaining nights in full",
};

/**
 * Which row of §4's grid the stay is under, read off its state.
 *
 * The state is the fact and the caller has no say in it, which is what makes
 * `folio.refund-policy` a cheaper capability than the override: the three
 * answers below price differently, and one that could be asserted in a request
 * body would let a receptionist choose the grid row that suited the guest in
 * front of them. `CANCELLED` is the sharpest of the three — the free window
 * turns on an instant, so a caller supplying it would be waiving the penalty
 * outright.
 *
 * The cancellation reason is deliberately not consulted. §4 prices the *event*
 * and `cancellation-calculator.ts` takes no reason; waiving the grid because the
 * property was at fault — a walk, a staff error, force majeure — is the
 * departure from §4 that `rbac-matrix.md` §2 gives `MANAGER`+ and its own route.
 * A refund that quietly charged nothing for some reason codes would be that
 * authority granted here by omission.
 *
 * **Being in the building is not on its own an early departure**, and the
 * difference is the whole of what makes the last row safe to grant a
 * receptionist. `state` says a guest is `CHECKED_IN` and says nothing about
 * whether they are leaving: `assignment.service.ts` shortens a stay by moving
 * `check_out_date` back and keeps the `booking_night` rows it released,
 * deliberately, because "they are the basis of the charge". So the nights sold
 * against the nights still covered is the record that a departure was brought
 * forward, and it is read here rather than assumed. Without it the grid prices
 * every guest mid-stay: the penalty lands, the balance settles to nothing while
 * the guest is still in the room, the night audit puts it back into arrears, and
 * the once-per-account rule below refuses the application the real departure
 * needed. `folio.reverse-posting` is not a receptionist's — `matrix.ts` — so
 * that first line is one they cannot take back either.
 *
 * The states left over are refused rather than priced. A stay still `HELD` or
 * `CONFIRMED` has not ended, so there is no row; a `CHECKED_OUT` one ended by
 * being slept and settled, and §4 has no cell for a guest who left on the day
 * they said they would.
 */
function policyEventOf(stay: {
  state: (typeof booking.$inferSelect)["state"];
  /** Null on every state but `CANCELLED`, which is the only one that reads it. */
  endedAt: Date | null;
  nightsSpent: number;
  nightsReleased: number;
}): PolicyEvent {
  switch (stay.state) {
    case "CANCELLED":
      // `booking_records_a_cancellation_instant_exactly_when_cancelled` makes
      // the state and the instant a biconditional, so a cancelled stay has one
      // and the database is what says so. The other two rows are decided
      // without a clock and never reach for it.
      return { kind: "CANCELLATION", cancelledAt: stay.endedAt! };

    case "NO_SHOW":
      return { kind: "NO_SHOW" };

    case "CHECKED_IN": {
      if (stay.nightsReleased <= 0) {
        throw new ORPCError("CONFLICT", {
          message:
            "This guest is in the building and still has every night they " +
            "booked — §4's last row prices the nights an early departure gave " +
            "back, so shorten the stay first, and a credit owed for any other " +
            "reason is a manager's to give",
        });
      }

      return { kind: "EARLY_DEPARTURE", nightsSpent: stay.nightsSpent };
    }

    default:
      throw new ORPCError("CONFLICT", {
        message:
          `§4 prices a stay that did not happen or stopped happening, and ` +
          `this booking is ${stay.state} — cancel it, mark it a no-show, or shorten ` +
          `it first, and a credit owed for any other reason is a manager's to give`,
      });
  }
}

/**
 * The account's three figures, split by what each line did to the balance.
 *
 * By sign and not by posting type, and that is the whole of the design. A
 * reversal carries whichever sign undoes the line it names — undoing a payment
 * is positive and undoing a charge is negative — so a split that read "payments"
 * off the `PAYMENT` rows would report an undone room charge as money the guest
 * handed over, and one that enumerated types would need editing every time
 * `posting_type` gained a member.
 *
 * `outstanding` is `charged - credited`, which is algebraically the plain sum of
 * the amounts. That is `NFR-02`'s identity, and it holds by construction rather
 * than by the three figures being computed to agree.
 */
function summarise(lines: readonly { amount: VndAmount }[]): FolioSummary {
  let charged = 0n;
  let credited = 0n;

  for (const line of lines) {
    if (line.amount >= 0n) {
      charged += line.amount;
    } else {
      credited -= line.amount;
    }
  }

  return { charged, credited, outstanding: charged - credited };
}
