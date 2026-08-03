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

import type { RoomTypeCode } from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { type Database, DRIZZLE } from "../../database/database.module.js";
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

@Injectable()
export class StayRestrictionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The nights in the range that carry a rule, and only those. */
  async read(range: NightRange): Promise<RestrictedNight[]> {
    const roomTypeId = await roomTypeIdFor(this.db, range.roomType);

    return await this.db
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
   */
  async apply(range: NightRange, rule: StayRule): Promise<number> {
    const roomTypeId = await roomTypeIdFor(this.db, range.roomType);

    const { rows } = await this.db.execute(sql`
      insert into stay_restriction (
        room_type_id, stay_date,
        minimum_stay, maximum_stay, closed_to_arrival, closed_to_departure
      )
      select
        -- Cast for the reason rate-calendar.service.ts gives: the series steps
        -- in an interval and hands back timestamps.
        ${roomTypeId}, night::date,
        ${rule.minimumStay}, ${rule.maximumStay},
        ${rule.closedToArrival}, ${rule.closedToDeparture}
      from generate_series(
        ${range.from.toString()}::date,
        ${range.to.toString()}::date,
        interval '1 day'
      ) as night
      on conflict (room_type_id, stay_date) do update set
        minimum_stay = excluded.minimum_stay,
        maximum_stay = excluded.maximum_stay,
        closed_to_arrival = excluded.closed_to_arrival,
        closed_to_departure = excluded.closed_to_departure
      returning id
    `);

    return rows.length;
  }

  /**
   * Lifts every rule in the range.
   *
   * The count is rows removed, so it is the nights that were restricted and not
   * the nights in the range — which is the useful number: a manager clearing a
   * fortnight and being told "3" has learnt which of their rules were actually
   * there.
   */
  async clear(range: NightRange): Promise<number> {
    const roomTypeId = await roomTypeIdFor(this.db, range.roomType);

    const removed = await this.db
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
