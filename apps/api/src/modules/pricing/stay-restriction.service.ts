// Whether a stay may begin, end or run across a night — `FR-PRC-02`.
//
// `schema/pricing.ts` makes a row the exception rather than the rule: a
// type-date with no row is unrestricted, so the table holds the nights the
// property actually constrained instead of 73,000 rows a year saying "no rule".
// Both halves of this service exist to keep that true from the outside.
//
// Reading returns only the nights that carry a rule. Filling a year of the
// range with the unrestricted value would put those 73,000 rows on the wire
// instead of in the table, which is the same mistake one layer up.
//
// Writing the unrestricted value deletes. A minimum of one night, no ceiling
// and neither flag set is not a rule — it is the absence of one — and storing
// it would leave the table with rows that constrain nothing and a reader unable
// to tell "the property lifted the Christmas minimum" from "somebody saved the
// form without changing it".
//
// That deletion is why this table's audit rows matter more than either of its
// neighbours'. A reprice overwrites a figure and leaves a row behind; a clear
// removes the row entirely, and `closed_to_arrival` on a peak weekend is a night
// the property stopped selling. Without the `DELETE` entries below there is
// nothing anywhere — not in this table, not in a booking — saying the rule was
// ever there, and the calendar renders the night as a rule rather than as an
// error either way.

import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { stayRestriction } from "../../database/schema/pricing.js";
import {
  type AuditEntryInput,
  AuditService,
} from "../audit/audit.service.js";
import type { NightRange } from "./rate-calendar.service.js";
import { roomTypeIdFor } from "./room-type-id.js";

/** The table these edits are filed against. */
const AUDITED_TABLE = "stay_restriction";

/** One night's rule, as `FR-PRC-02` states it. */
export interface StayRule {
  readonly minimumStay: number;
  readonly maximumStay: number | null;
  readonly closedToArrival: boolean;
  readonly closedToDeparture: boolean;
}

export interface RestrictedNight extends StayRule {
  readonly date: string;
}

/** What one night's rule was, and is — `audit.service.ts` on why both are
 *  carried as text and never parsed. */
interface RuledRow extends Record<string, unknown> {
  readonly row_id: string;
  readonly before_state: string | null;
  readonly after_state: string;
}

@Injectable()
export class StayRestrictionService {
  constructor(private readonly audit: AuditService) {}

  /** The nights in the range that carry a rule, and only those. */
  async read(exec: DbExecutor, range: NightRange): Promise<RestrictedNight[]> {
    const roomTypeId = await roomTypeIdFor(exec, range.roomType);

    return await exec
      .select({
        date: stayRestriction.stayDate,
        minimumStay: stayRestriction.minimumStay,
        maximumStay: stayRestriction.maximumStay,
        closedToArrival: stayRestriction.closedToArrival,
        closedToDeparture: stayRestriction.closedToDeparture,
      })
      .from(stayRestriction)
      .where(
        and(
          eq(stayRestriction.roomTypeId, roomTypeId),
          gte(stayRestriction.stayDate, range.from.toString()),
          lte(stayRestriction.stayDate, range.to.toString()),
        ),
      )
      .orderBy(asc(stayRestriction.stayDate));
  }

  /**
   * Puts one rule on every night of the range, replacing whatever was there,
   * and records who.
   *
   * The range is expanded by Postgres for the reason the rate calendar's is: a
   * statement per night is a round trip per night, and a failure partway
   * through would leave half a Christmas closed to arrival.
   *
   * The pre-image is captured inside the upserting statement rather than by a
   * `select` before it, and without `for update` —
   * `rate-calendar.service.ts#set` argues both, and the argument is the same one
   * here because the statement is the same shape.
   */
  async apply(
    exec: DbExecutor,
    range: NightRange,
    rule: StayRule,
  ): Promise<number> {
    const roomTypeId = await roomTypeIdFor(exec, range.roomType);

    const { rows } = await exec.execute<RuledRow>(sql`
      with nights as (
        select night::date as stay_date
        from generate_series(
          ${range.from.toString()}::date,
          ${range.to.toString()}::date,
          interval '1 day'
        ) as night
      ),
      before as (
        select sr.stay_date, to_jsonb(sr)::text as state
        from stay_restriction sr
        join nights n on n.stay_date = sr.stay_date
        where sr.room_type_id = ${roomTypeId}
      ),
      upserted as (
        insert into stay_restriction (
          room_type_id, stay_date,
          minimum_stay, maximum_stay, closed_to_arrival, closed_to_departure
        )
        select
          -- Cast for the reason rate-calendar.service.ts gives: the series steps
          -- in an interval and hands back timestamps.
          ${roomTypeId}, n.stay_date,
          ${rule.minimumStay}, ${rule.maximumStay},
          ${rule.closedToArrival}, ${rule.closedToDeparture}
        from nights n
        on conflict (room_type_id, stay_date) do update set
          minimum_stay = excluded.minimum_stay,
          maximum_stay = excluded.maximum_stay,
          closed_to_arrival = excluded.closed_to_arrival,
          closed_to_departure = excluded.closed_to_departure
        returning id, stay_date, to_jsonb(stay_restriction)::text as state
      )
      select
        u.id as row_id,
        b.state as before_state,
        u.state as after_state
      from upserted u
      left join before b on b.stay_date = u.stay_date
      order by u.stay_date
    `);

    await this.audit.record(exec, AUDITED_TABLE, rows.map(asEntry));

    return rows.length;
  }

  /**
   * Lifts every rule in the range, and records what each of them was.
   *
   * The count is rows removed, so it is the nights that were restricted and not
   * the nights in the range — which is the useful number: a manager clearing a
   * fortnight and being told "3" has learnt which of their rules were actually
   * there.
   *
   * The same three rows are the whole of what the log will ever know about
   * those rules, because after this statement the table holds nothing that says
   * they existed. `returning` is what makes the `DELETE` entries possible at
   * all, and it is the reason this method reads the row out rather than counting
   * it.
   */
  async clear(exec: DbExecutor, range: NightRange): Promise<number> {
    const roomTypeId = await roomTypeIdFor(exec, range.roomType);

    const removed = await exec
      .delete(stayRestriction)
      .where(
        and(
          eq(stayRestriction.roomTypeId, roomTypeId),
          gte(stayRestriction.stayDate, range.from.toString()),
          lte(stayRestriction.stayDate, range.to.toString()),
        ),
      )
      .returning({
        id: stayRestriction.id,
        state: sql<string>`to_jsonb(stay_restriction)::text`,
      });

    await this.audit.record(
      exec,
      AUDITED_TABLE,
      removed.map((row) => ({
        rowId: row.id,
        action: "DELETE" as const,
        before: row.state,
        after: null,
      })),
    );

    return removed.length;
  }
}

/** One upserted night as the log records it. */
function asEntry(row: RuledRow): AuditEntryInput {
  return {
    rowId: row.row_id,
    action: row.before_state === null ? "INSERT" : "UPDATE",
    before: row.before_state,
    after: row.after_state,
  };
}
