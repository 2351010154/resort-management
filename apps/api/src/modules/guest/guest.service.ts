// The guest record, and who has looked at the number on it — `FR-GST-03`.
//
// Three operations, and the reason there are three rather than two is the whole
// requirement. A guest is created, a guest is read with the CCCD masked, and a
// guest's CCCD is *revealed* by a separate call that leaves a row behind saying
// who did it. Folding the reveal into a flag on the read — `getGuest(id, {
// unmasked: true })` — would put the audited path and the ordinary one behind
// one name, and the first caller to pass the flag by habit would be reading
// personal data through a method nobody reviews as if it were sensitive. The
// matrix already treats them as two things: `guest.read-record` is every staff
// role, `guest.unmask-cccd` is `MANAGER`, `ADMIN` and a conditional
// `RECEPTIONIST`. Two capabilities want two methods to hang off.
//
// **The plain number leaves here on exactly one path.** `GuestRecord` has no
// field that can carry it — `cccdMasked` is computed by `cccd-mask.ts` from a
// row that is read, masked and dropped inside `asRecord`. So a caller that
// forgets to mask cannot: there is nothing to forget. Only `unmaskCccd` returns
// `cccdNumber`, and it cannot return it without having written the audit row in
// the same statement sequence.
//
// **Both halves are the caller's transaction.** The executor is required, as
// `database.module.ts` insists, and it does more here than compose: the audit
// row and the read it accounts for have to commit or vanish together. A service
// opening its own transaction for the audit would leave an entry claiming
// somebody read a number in a request that was rolled back before they saw it —
// an audit trail with false positives in it, which is worse than a sparse one
// because it cannot be trusted to accuse. The opposite arrangement, auditing
// after the outer transaction commits, loses the entry whenever the process
// dies between the two, and those are exactly the reads worth having a record
// of.
//
// One consequence worth stating for the callers still to be written: a refused
// insert aborts the caller's transaction along with it. `CONFLICT` on a
// duplicate CCCD is an answer, but it is not an answer the caller can catch and
// carry on from — the connection is in `25P02` until it rolls back. Finding a
// returning guest is therefore a lookup that happens *before* the insert, or an
// `on conflict` clause, and not a caught exception. That belongs to the check-in
// path, which is the one that has a returning guest to find.

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import {
  cccdUnmaskAudit,
  guest,
  type GuestRow,
} from "../../database/schema/guest.js";
import { sqlStateOf } from "../../database/sql-state.js";
import { maskCccd } from "./cccd-mask.js";

/** Postgres' SQLSTATEs for the two refusals this service expects. */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

/**
 * What the desk knows about a person at the moment it identifies them.
 *
 * Only the name is required, and `schema/guest.ts` says why: a domestic guest
 * hands over a CCCD and no passport, a foreign guest the reverse, and a second
 * occupant may be registered on the first guest's word. A required field
 * satisfied with a placeholder cannot be told from real data afterwards.
 */
export interface NewGuest {
  readonly fullName: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly cccdNumber?: string | null;
  readonly dateOfBirth?: StayDate | null;
  readonly nationality?: string | null;
}

/** A guest as `guest.read-record` is allowed to see them. */
export interface GuestRecord {
  readonly id: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly email: string | null;
  /**
   * The last four characters and asterisks for the rest, or `null` when the
   * property never took a number. Never the number itself — `cccd-mask.ts`
   * argues the shape, including what happens to one too short to mask.
   */
  readonly cccdMasked: string | null;
  readonly dateOfBirth: StayDate | null;
  readonly nationality: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One reading of one number by one named person. */
export interface CccdReveal {
  readonly guestId: string;
  readonly cccdNumber: string;
  readonly unmaskedBy: string;
  readonly unmaskedAt: Date;
}

export interface UnmaskRequest {
  readonly guestId: string;
  /** A `staff_user`. Never optional and never a system actor — the audit column
   *  is `NOT NULL` for the reason `schema/guest.ts` gives on it. */
  readonly unmaskedBy: string;
  readonly reason?: string | null;
}

@Injectable()
export class GuestService {
  /**
   * Records a person the property has identified.
   *
   * Nothing is checked before the write. The two rules that matter — a guest
   * has a name, and one CCCD belongs to one person — are constraints in
   * Postgres, and a `select` that finds no guest on that number is a fact that
   * stops being true before the `insert` acting on it. So the row is written
   * and the refusal is translated.
   *
   * The `CONFLICT` on a duplicate number is not a fault: the property has met
   * this person before, and the answer is to use the record it already has.
   */
  async createGuest(exec: DbExecutor, input: NewGuest): Promise<GuestRecord> {
    try {
      const [created] = await exec
        .insert(guest)
        .values({
          fullName: input.fullName.trim(),
          phone: written(input.phone),
          email: written(input.email),
          cccdNumber: written(input.cccdNumber),
          dateOfBirth: input.dateOfBirth?.toString() ?? null,
          nationality: written(input.nationality),
        })
        .returning();

      return this.asRecord(created!);
    } catch (error) {
      throw this.asRefusal(error);
    }
  }

  /**
   * The record, masked — what `guest.read-record` grants.
   *
   * The plain number is selected, because computing the mask needs it, and it
   * reaches no further than `asRecord`. There is deliberately no option to skip
   * the masking: the unaudited path and the audited one are different methods,
   * not different arguments.
   */
  async getGuest(exec: DbExecutor, guestId: string): Promise<GuestRecord> {
    const [found] = await exec
      .select()
      .from(guest)
      .where(eq(guest.id, guestId))
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message: "No guest with that id",
      });
    }

    return this.asRecord(found);
  }

  /**
   * The number itself, and one audit row saying it was read.
   *
   * Exactly one row per call, because `FR-GST-03` audits per call and
   * `screens.md` reads that as per field and per visit — an entry means "this
   * person looked at this number once", so a second look is a second entry and
   * never an update to the first.
   *
   * The guest is resolved before the audit is written, for a reason beyond
   * tidiness: `cccd_unmask_audit.guest_id` is a foreign key, so auditing first
   * against an id nobody holds would abort the caller's transaction with a
   * `23503` instead of answering `404`.
   *
   * A guest with no CCCD on file is refused rather than audited. Nothing was
   * revealed, and a row claiming otherwise would put readings of numbers that
   * do not exist into the trail an investigation is counted from.
   */
  async unmaskCccd(
    exec: DbExecutor,
    input: UnmaskRequest,
  ): Promise<CccdReveal> {
    const [found] = await exec
      .select({ id: guest.id, cccdNumber: guest.cccdNumber })
      .from(guest)
      .where(eq(guest.id, input.guestId))
      .limit(1);

    if (!found) {
      throw new ORPCError("NOT_FOUND", {
        message: "No guest with that id",
      });
    }

    if (found.cccdNumber === null) {
      throw new ORPCError("NOT_FOUND", {
        message: "That guest has no CCCD on file — there is nothing to reveal",
      });
    }

    // Unguarded on purpose. The only refusal reachable here is the foreign key
    // on `unmasked_by`, which names an authenticated member of staff by the
    // time a request gets this far — translating it would be inventing a
    // friendly answer for a caller that passed an id it made up.
    const [entry] = await exec
      .insert(cccdUnmaskAudit)
      .values({
        guestId: found.id,
        unmaskedBy: input.unmaskedBy,
        reason: written(input.reason),
      })
      .returning({ unmaskedAt: cccdUnmaskAudit.unmaskedAt });

    return {
      guestId: found.id,
      cccdNumber: found.cccdNumber,
      unmaskedBy: input.unmaskedBy,
      unmaskedAt: entry!.unmaskedAt,
    };
  }

  /** The stored row as a caller is allowed to hold it. */
  private asRecord(row: GuestRow): GuestRecord {
    return {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      cccdMasked: maskCccd(row.cccdNumber),
      // `NFR-12`: a date crossing this boundary is a `CalendarDate`, and the
      // string is storage's business. A birthday read as an instant moves by a
      // day in UTC+7, which is the same off-by-one `stay-date.ts` exists to
      // stop and is harder to spot on a date nobody counts nights from.
      dateOfBirth: row.dateOfBirth === null ? null : parseDate(row.dateOfBirth),
      nationality: row.nationality,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Turns the two refusals this service expects into statuses a caller can act
   * on, and leaves everything else alone.
   *
   * The `else` matters as much as the branches: a deadlock, a lost connection
   * or a transaction already aborted are faults, and dressing one as a
   * `CONFLICT` would tell the desk to try different details for a problem that
   * has nothing to do with the details.
   */
  private asRefusal(error: unknown): unknown {
    const code = sqlStateOf(error);

    if (code === UNIQUE_VIOLATION) {
      return new ORPCError("CONFLICT", {
        message:
          "That CCCD is already on a guest record — the property has met this person before",
      });
    }

    // `guest_has_a_name`. The other check on the table,
    // `guest_cccd_present_when_set`, is unreachable from here: `written` turns
    // a number typed as blank into no number at all before the insert sees it.
    if (code === CHECK_VIOLATION) {
      return new ORPCError("BAD_REQUEST", {
        message: "A guest record needs a name",
      });
    }

    return error;
  }
}

/**
 * An optional detail as it should be stored, or nothing.
 *
 * Trimmed, because " 079301012345" and "079301012345" are one person and the
 * partial unique index on the column cannot see that — untrimmed, a stray space
 * from a barcode scanner creates the duplicate record the index exists to
 * prevent, and `FR-GST-01`'s stay history splits across the two.
 *
 * Blank becomes absent rather than an error. A field somebody tabbed through is
 * a field they had nothing to put in, and `guest_cccd_present_when_set` refuses
 * to store the difference anyway — so the normalisation happens here, once,
 * instead of arriving as a constraint violation the desk has to interpret.
 */
function written(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}
