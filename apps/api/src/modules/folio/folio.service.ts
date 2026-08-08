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
// **Nothing is refused for being posted to a closed folio, yet.** `FR-FOL-01`
// says a closed account takes no further lines, and that rule belongs with the
// close that creates the state — the same reason the trigger that would enforce
// it is not in the ledger's migration. Nothing in the tree closes a folio today,
// so the state is unreachable rather than unguarded.

import { randomUUID } from "node:crypto";
import type { StayDate, VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { asc, eq, or, sql } from "drizzle-orm";
import {
  type Database,
  type DbExecutor,
  DRIZZLE,
} from "../../database/database.module.js";
import { folio, folioPosting } from "../../database/schema/folio.js";
import { staffUser } from "../../database/schema/identity.js";
import { sqlStateOf } from "../../database/sql-state.js";
// A type, so it erases: `booking.module.ts` imports this module to bind the
// port, and a value imported back the other way would be a cycle. The port is
// the only thing the two modules share, which is what it is for.
import type { FolioPort } from "../booking/ports/folio.port.js";
import { SystemConfigService } from "../system-config/system-config.service.js";
import { decomposeGross } from "./tax-decomposition.js";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

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
  readonly postedAt: Date;
  readonly postedBy: string | null;
}

/** The three figures `NFR-02` states, derived from the lines below them. */
export interface FolioSummary {
  readonly charged: VndAmount;
  readonly credited: VndAmount;
  readonly outstanding: VndAmount;
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
   * Writes lines and hands back their ids, with Postgres' refusal read as an
   * answer rather than a fault.
   *
   * Two SQLSTATEs are translated and the rest are re-thrown as they are. `23503`
   * is a key naming a row that is not there — the folio, or the staff account a
   * line is attributed to. `23505` can only be
   * `folio_posting_reversal_unique_key` on this table, because it is the only
   * uniqueness a posting can violate; every other column is free to repeat.
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

      throw error;
    }
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
