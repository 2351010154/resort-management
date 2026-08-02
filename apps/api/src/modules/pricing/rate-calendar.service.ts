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

import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Database, DRIZZLE } from "../../database/database.module.js";
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

@Injectable()
export class RateCalendarService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Every night of the range, including the ones with no row.
   *
   * A gap is the answer this view exists to give. The guest-facing calendar
   * renders an unpublished night as unavailable — which is correct for a guest
   * and useless for a manager, who needs to know the night is unpriced rather
   * than taken. Returning only the rows that exist would leave them counting
   * dates to find the hole.
   */
  async read(range: NightRange): Promise<CalendarNight[]> {
    const roomTypeId = await roomTypeIdFor(this.db, range.roomType);

    const { rows } = await this.db.execute<NightRow>(sql`
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
   */
  async set(
    range: NightRange & { grossPerNight: VndAmount },
  ): Promise<number> {
    const roomTypeId = await roomTypeIdFor(this.db, range.roomType);

    const { rows } = await this.db.execute(sql`
      insert into rate_calendar (room_type_id, stay_date, gross_per_night)
      select ${roomTypeId}, night::date, ${range.grossPerNight.toString()}::bigint
      from generate_series(
        ${range.from.toString()}::date,
        ${range.to.toString()}::date,
        interval '1 day'
      ) as night
      on conflict (room_type_id, stay_date)
        do update set gross_per_night = excluded.gross_per_night
      returning id
    `);

    return rows.length;
  }
}
