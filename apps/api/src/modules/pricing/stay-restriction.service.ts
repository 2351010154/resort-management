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
// the property stopped selling. Without a `DELETE` entry there is nothing
// anywhere — not in this table, not in a booking — saying the rule was ever
// there, and the calendar renders the night as a rule rather than as an error
// either way.
//
// **That entry is filed by a trigger on the table, and no longer here.** It
// fires on the delete itself, so it is handed the row Postgres is removing
// rather than one this file had to remember to read back first, and it covers a
// psql session clearing a fortnight by hand as well as it covers this method.
// Filing here as well would put two identical entries in the log for one lifted
// rule.

import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { stayRestriction } from "../../database/schema/pricing.js";
import type { NightRange } from "./rate-calendar.service.js";
import { roomTypeIdFor } from "./room-type-id.js";

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

/** One night the upsert wrote. Only the count is used; the column is there
 *  because a statement has to return something to be counted. */
interface RuledRow extends Record<string, unknown> {
  readonly row_id: string;
}

@Injectable()
export class StayRestrictionService {
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
   * Puts one rule on every night of the range, replacing whatever was there.
   *
   * The range is expanded by Postgres for the reason the rate calendar's is: a
   * statement per night is a round trip per night, and a failure partway
   * through would leave half a Christmas closed to arrival.
   *
   * A night that already carried this exact rule is written again and files
   * nothing: the row after is the row before, and an entry whose two sides agree
   * is an edit an investigation would have to rule out before it could rule
   * anything in. `rate-calendar.service.ts#set` says the same about a reprice to
   * the price already published.
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
      )
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
      returning id as row_id
    `);

    return rows.length;
  }

  /**
   * Lifts every rule in the range.
   *
   * The count is rows removed, so it is the nights that were restricted and not
   * the nights in the range — which is the useful number: a manager clearing a
   * fortnight and being told "3" has learnt which of their rules were actually
   * there. `returning` is what makes the count the rows that went rather than
   * the dates asked for.
   *
   * What each of those rules was is in the log and nowhere else, because after
   * this statement the table holds nothing saying they existed. The header says
   * why that entry is the database's to write and not this method's.
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
      .returning({ id: stayRestriction.id });

    return removed.length;
  }
}
