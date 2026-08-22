// Pricing a range of nights — the write side of `property-and-tariff.md` §3.
//
// §3's shape is a calendar and not a formula, and `schema/pricing.ts` says why:
// "Peak" is what the property calls the fortnight it charged more for, and
// moving that fortnight has to be a data edit rather than a deploy. This is the
// edit. A season is named by selecting its nights and giving them a price, and
// nothing in the tree learns when Peak begins.
//
// One price across the range rather than a list of prices. That is the gesture
// the funnel's own comment describes from the other side — the property decides
// a figure for a band of nights — and a week of differing prices is one call per
// band, which is how the figures were arrived at anyway.
//
// The range is expanded by Postgres. `generate_series` is what makes the insert
// one statement: a night at a time would be 400 round trips for a season, and a
// failure halfway through would leave the property advertising two prices for
// one Christmas.
//
// Every method takes a `DbExecutor` rather than reaching for the client.
// `database.module.ts` gives the general argument; the one that applies here is
// `FR-AUD-01`: the row recording a reprice and the reprice itself have to be one
// commit, and a service holding its own client cannot be composed into the
// caller's transaction to make them one.
//
// **Nothing here files that row any more, and the reprice is still audited.**
// The change log is written by a trigger on `rate_calendar` itself, inside the
// statement below and therefore inside the caller's transaction — the same
// commit, reached without this file remembering. What it removes is the pre-image
// this method used to capture by hand: an upsert destroys what it overwrites, so
// the previous price had to be read in the statement that destroyed it, which
// was a CTE, a left join and a mapping function held together by an argument
// about `read committed` snapshots. Postgres has `OLD` in front of it and needs
// none of that. Filing it here as well would put a second, identical entry in
// the log for every night repriced, and `FR-AUD-02`'s viewer would show every
// price change twice.

import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import { roomTypeIdFor } from "./room-type-id.js";

/** One night of the range, priced or not yet published. */
export interface CalendarNight {
  readonly date: string;
  readonly grossPerNight: VndAmount | null;
}

export interface NightRange {
  readonly roomType: RoomTypeCode;
  readonly from: StayDate;
  readonly to: StayDate;
}

interface NightRow extends Record<string, unknown> {
  readonly stay_date: string;
  readonly gross_per_night: string | null;
}

/** One night the upsert wrote. Only the count is used; the column is there
 *  because a statement has to return something to be counted. */
interface PricedRow extends Record<string, unknown> {
  readonly row_id: string;
}

@Injectable()
export class RateCalendarService {
  /**
   * Every night of the range, including the ones with no row.
   *
   * A gap is the answer this view exists to give. The guest-facing calendar
   * renders an unpublished night as unavailable — which is correct for a guest
   * and useless for a manager, who needs to know the night is unpriced rather
   * than taken. Returning only the rows that exist would leave them counting
   * dates to find the hole.
   */
  async read(exec: DbExecutor, range: NightRange): Promise<CalendarNight[]> {
    const roomTypeId = await roomTypeIdFor(exec, range.roomType);

    const { rows } = await exec.execute<NightRow>(sql`
      select
        -- generate_series over two dates steps in an interval and so yields
        -- timestamps. Cast back, or every date on the wire carries a midnight
        -- the calendar does not have.
        night::date::text as stay_date,
        rc.gross_per_night
      from generate_series(
        ${range.from.toString()}::date,
        ${range.to.toString()}::date,
        interval '1 day'
      ) as night
      left join rate_calendar rc
        on rc.room_type_id = ${roomTypeId} and rc.stay_date = night::date
      order by night
    `);

    return rows.map((row) => ({
      date: row.stay_date,
      // `bigint` all the way out. `pg` hands back a numeric column as text
      // rather than risk a float, which is the behaviour `money.ts` wants —
      // parsing it to a `number` here is the one conversion that would make a
      // rate unrepresentable.
      grossPerNight: row.gross_per_night === null ? null : BigInt(row.gross_per_night),
    }));
  }

  /**
   * Sets one price across the range, over whatever was there.
   *
   * An upsert and not an insert: repricing a season the property has already
   * published is the common edit, and a caller made to delete first would have
   * a window where the nights are unpriced and the funnel is quoting nothing.
   * The same body sent twice leaves the same prices, which is what makes the
   * route a PUT.
   *
   * **The previous price is not read here, and it is still recorded.** It used
   * to be, in this same statement, because the `do update` below is what
   * destroys it and a separate `select` under `read committed` could have been
   * overtaken by a concurrent reprice. The trigger on the table is handed `OLD`
   * by Postgres, in the statement, under no snapshot but its own — which is the
   * property that argument was reaching for, held by the database rather than by
   * the shape of a query.
   *
   * Repricing a night to the figure it already carries writes the row and files
   * nothing, because the row it wrote is the row that was there. An entry whose
   * two sides agree records that something happened and declines to say what,
   * which is an edit an investigation would have to rule out before it could
   * rule anything in.
   */
  async set(
    exec: DbExecutor,
    range: NightRange & { grossPerNight: VndAmount },
  ): Promise<number> {
    const roomTypeId = await roomTypeIdFor(exec, range.roomType);

    const { rows } = await exec.execute<PricedRow>(sql`
      with nights as (
        select night::date as stay_date
        from generate_series(
          ${range.from.toString()}::date,
          ${range.to.toString()}::date,
          interval '1 day'
        ) as night
      )
      insert into rate_calendar (room_type_id, stay_date, gross_per_night)
      select ${roomTypeId}, n.stay_date, ${range.grossPerNight.toString()}::bigint
      from nights n
      on conflict (room_type_id, stay_date)
        do update set gross_per_night = excluded.gross_per_night
      returning id as row_id
    `);

    return rows.length;
  }
}
