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

import type { RoomTypeCode, StayDate, VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import {
  type AuditEntryInput,
  AuditService,
} from "../audit/audit.service.js";
import { roomTypeIdFor } from "./room-type-id.js";

/** The table these edits are filed against. */
const AUDITED_TABLE = "rate_calendar";

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

/** What one upserted night was, and is. Both snapshots are Postgres's own
 *  rendering of the row, carried as text — `audit.service.ts` on why. */
interface PricedRow extends Record<string, unknown> {
  readonly row_id: string;
  readonly before_state: string | null;
  readonly after_state: string;
}

@Injectable()
export class RateCalendarService {
  constructor(private readonly audit: AuditService) {}

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
   * Sets one price across the range, over whatever was there, and records who.
   *
   * An upsert and not an insert: repricing a season the property has already
   * published is the common edit, and a caller made to delete first would have
   * a window where the nights are unpriced and the funnel is quoting nothing.
   * The same body sent twice leaves the same prices, which is what makes the
   * route a PUT.
   *
   * **The previous price is read in the same statement that overwrites it.**
   * `FR-AUD-01` wants the before as well as the after, and this is the only
   * statement in which the before still exists — the `do update` at the foot of
   * it is what destroys it. A separate `select` first would be a second
   * statement under `read committed`, so a concurrent reprice landing between
   * the two would be recorded as having been overwritten by this one when it was
   * the other way round. Both branches of the `case` below are reachable and
   * mean different things: a night nobody had priced is an `INSERT`, and a night
   * with a price is an `UPDATE` whose `before` is the figure the property was
   * advertising until this call.
   *
   * `FOR UPDATE` is deliberately absent from the `before` branch, and it is not
   * an oversight — it was tried. Locking a row that this same statement's upsert
   * has already touched yields no row at all, so the pre-image comes back empty
   * and every reprice files as though the night had never been priced. The
   * snapshot the CTE already shares with the upsert is what makes the pair
   * consistent; the lock would only have narrowed a window it cannot see anyway.
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
      ),
      -- What the property was charging for these nights, read under the same
      -- snapshot the upsert below runs against.
      before as (
        select rc.stay_date, to_jsonb(rc)::text as state
        from rate_calendar rc
        join nights n on n.stay_date = rc.stay_date
        where rc.room_type_id = ${roomTypeId}
      ),
      upserted as (
        insert into rate_calendar (room_type_id, stay_date, gross_per_night)
        select ${roomTypeId}, n.stay_date, ${range.grossPerNight.toString()}::bigint
        from nights n
        on conflict (room_type_id, stay_date)
          do update set gross_per_night = excluded.gross_per_night
        returning id, stay_date, to_jsonb(rate_calendar)::text as state
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
}

/** One upserted night as the log records it. */
function asEntry(row: PricedRow): AuditEntryInput {
  return {
    rowId: row.row_id,
    action: row.before_state === null ? "INSERT" : "UPDATE",
    before: row.before_state,
    after: row.after_state,
  };
}
