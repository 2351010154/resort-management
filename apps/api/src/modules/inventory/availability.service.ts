// "What can I book, and for how much" — `FR-INV-03`.
//
// Two questions with one answer underneath. The funnel opens on a month of
// nights and asks for a number per night before the guest has chosen anything;
// once it has both dates it asks for a number per type. Both read the same
// three tables, and both are shaped by the same budget: `NFR-03` gives the
// answer 300 ms at p95 over a twelve-month calendar.
//
// That budget is the reason `type_inventory` is a stored counter rather than a
// count derived from bookings. A derived count would have to visit every
// booking overlapping the range on every search — thirty-one nights across five
// types is 155 rows here, and an unbounded join there. The aggregate below runs
// off `type_inventory(stay_date)`, `rate_calendar(stay_date)` and
// `stay_restriction(stay_date)`, which is why all three carry that index.
//
// Restrictions reject HERE and not at the booking attempt — `FR-PRC-02` is
// explicit, and the reason is that a guest told at the payment step that their
// chosen night has a two-night minimum has been made to do the work twice. An
// offer that fails a restriction still carries its price; it carries
// `isAvailable: false` beside it, so the funnel can grey a cell and say why
// rather than hide a room and say nothing.
//
// What this does NOT price, and deliberately:
//
// - **The extra-person charge** (`FR-PRC-04`). A party above the type's maximum
//   is refused — §3 makes that a rejection and not a price — but a third head
//   inside the maximum is quoted at the rate. §9 records that the owner has not
//   settled whether an extra bed is mandatory or whether its charge stacks, and
//   states that no pricing path may infer the rule from bed capacity.
// - **`extraBedPerNightGross`**, for the same reason. §6 makes the extra bed a
//   service-catalog item, and §9 leaves when it is charged unanswered. The
//   field is nullable precisely so an offer can be quoted without asserting it.
// - **Promotions** (`FR-PRC-03`).

import {
  INCLUDED_OCCUPANCY,
  nightCount,
  type RateCalendar,
  type RatePlanCode,
  type RoomTypeCode,
  type RoomTypeOffer,
  type StayDate,
  type StayOffer,
} from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { type CalendarDate, parseDate } from "@internationalized/date";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Database, DRIZZLE } from "../../database/database.module.js";
import {
  roomType,
  typeInventory,
} from "../../database/schema/inventory.js";
import {
  rateCalendar,
  ratePlan,
  stayRestriction,
} from "../../database/schema/pricing.js";

// The aggregates below are hand-written SQL, and their identifiers still come
// from the schema objects.
//
// Two of these tables belong to `pricing`, and a column renamed there would
// otherwise typecheck here and fail at runtime against a route a stranger can
// call. Interpolating the objects makes the rename a build error in this file:
// `alias()` renders as `"rate_calendar" "rc"` in the join and `"rc"."gross_per_night"`
// everywhere the column is read, so the alias and the column it qualifies have
// one source. The statement is otherwise unchanged — same joins, same grouping,
// same plan.
const rt = alias(roomType, "rt");
const ti = alias(typeInventory, "ti");
const rc = alias(rateCalendar, "rc");
const sr = alias(stayRestriction, "sr");
// The arrival night and the departure date are two reads of one table, so they
// need two aliases — a minimum stay governs where a stay may begin, and
// closed-to-departure where it may end.
const arrival = alias(stayRestriction, "arrival");
const departure = alias(stayRestriction, "departure");

/**
 * A row shape Drizzle's `execute` will accept.
 *
 * `execute` is typed for arbitrary SQL and so requires an index signature, but
 * an interface without one is what makes a mistyped column name an error rather
 * than `undefined` at the call site. The intersection satisfies the constraint
 * and keeps the named fields checked.
 */
type Row<TRow> = TRow & Record<string, unknown>;

/** How a plan's price is derived from the calendar — `property-and-tariff.md` §3. */
interface PlanPricing {
  readonly percentAdjustment: number;
  readonly breakfastPerPersonGross: bigint | null;
}

/** One type's totals over the requested range, as Postgres aggregated them. */
interface TypeAggregate {
  readonly code: RoomTypeCode;
  readonly max_occupancy: number;
  /** The tightest night in the range — 0 or less means the type is not sellable. */
  readonly fewest_free: number;
  /** Sum of the `STANDARD` gross across the range, un-rounded. */
  readonly standard_total: string;
  /** Nights that had both an inventory row and a price. */
  readonly nights_priced: string;
  readonly closed_to_arrival: boolean;
  readonly closed_to_departure: boolean;
  readonly minimum_stay: number;
  readonly maximum_stay: number | null;
}

/** One night of the grid, as Postgres aggregated it across the five types. */
interface NightAggregate {
  readonly stay_date: string;
  readonly lowest_gross: string | null;
  readonly free_types: string;
  readonly arrivable_types: string;
  readonly minimum_stay: number | null;
}

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * One offer per type for a chosen range.
   *
   * A type is omitted entirely when the range is not fully priced and opened —
   * that is a calendar the property has not published yet, which is a different
   * thing from a room it has sold, and quoting it as sold out would tell the
   * guest the wrong thing about a date they could ask about by telephone.
   */
  async search(query: {
    checkIn: StayDate;
    checkOut: StayDate;
    plan: RatePlanCode;
    occupancy: number;
  }): Promise<StayOffer> {
    const nights = nightCount({ checkIn: query.checkIn, checkOut: query.checkOut });
    const pricing = await this.planPricing(query.plan);
    const checkIn = query.checkIn.toString();
    const checkOut = query.checkOut.toString();

    // One statement rather than a query per type. The restriction joins read the
    // arrival night and the departure date only: a minimum stay and a
    // closed-to-arrival flag govern where a stay may BEGIN, and
    // closed-to-departure governs where it may END. Nights in between carry no
    // rule a stay running across them can break.
    const { rows } = await this.db.execute<Row<TypeAggregate>>(sql`
      select
        ${rt.code},
        ${rt.maxOccupancy},
        min(${ti.totalRooms} - ${ti.soldRooms}) as fewest_free,
        sum(${rc.grossPerNight}) as standard_total,
        count(*) as nights_priced,
        coalesce(bool_or(${arrival.closedToArrival}), false) as closed_to_arrival,
        coalesce(bool_or(${departure.closedToDeparture}), false) as closed_to_departure,
        coalesce(max(${arrival.minimumStay}), 1) as minimum_stay,
        max(${arrival.maximumStay}) as maximum_stay
      from ${roomType} ${rt}
      join ${typeInventory} ${ti} on ${ti.roomTypeId} = ${rt.id}
      join ${rateCalendar} ${rc}
        on ${rc.roomTypeId} = ${rt.id} and ${rc.stayDate} = ${ti.stayDate}
      left join ${stayRestriction} ${arrival}
        on ${arrival.roomTypeId} = ${rt.id} and ${arrival.stayDate} = ${checkIn}
      left join ${stayRestriction} ${departure}
        on ${departure.roomTypeId} = ${rt.id} and ${departure.stayDate} = ${checkOut}
      where ${ti.stayDate} >= ${checkIn}
        and ${ti.stayDate} < ${checkOut}
      group by ${rt.id}, ${rt.code}, ${rt.maxOccupancy}, ${rt.displayOrder}
      order by ${rt.displayOrder}
    `);

    const offers = rows
      .filter((row) => Number(row.nights_priced) === nights)
      .map((row): RoomTypeOffer => {
        const stayTotalGross = this.applyPlan(
          BigInt(row.standard_total),
          pricing,
          nights,
          query.occupancy,
        );

        return {
          code: row.code,
          // The average, and display only — `rate-calendar.ts` says why both
          // numbers cross the wire. The total is the authoritative figure and
          // is never derived from this one.
          perNightGross: stayTotalGross / BigInt(nights),
          stayTotalGross,
          isAvailable:
            row.fewest_free > 0 &&
            row.max_occupancy >= query.occupancy &&
            !row.closed_to_arrival &&
            !row.closed_to_departure &&
            row.minimum_stay <= nights &&
            (row.maximum_stay === null || row.maximum_stay >= nights),
          extraBedPerNightGross: null,
        };
      });

    return { plan: query.plan, offers };
  }

  /**
   * A month of nights, each carrying the cheapest room still free.
   *
   * Nights the property has not opened for sale are absent from
   * `type_inventory` and would fall out of the aggregate entirely, so the month
   * is generated here and the gaps filled as sold out. A grid that is thirty-one
   * cells one month and twenty-two the next is a grid that has to explain
   * itself.
   */
  async calendar(query: {
    year: number;
    month: number;
    plan: RatePlanCode;
  }): Promise<RateCalendar> {
    const pricing = await this.planPricing(query.plan);
    const first = new CalendarDateOfMonth(query.year, query.month);

    const { rows } = await this.db.execute<Row<NightAggregate>>(sql`
      select
        ${ti.stayDate},
        min(${rc.grossPerNight}) filter (where ${ti.totalRooms} > ${ti.soldRooms})
          as lowest_gross,
        count(*) filter (where ${ti.totalRooms} > ${ti.soldRooms}) as free_types,
        count(*) filter (
          where ${ti.totalRooms} > ${ti.soldRooms}
            and coalesce(${sr.closedToArrival}, false) = false
        ) as arrivable_types,
        min(coalesce(${sr.minimumStay}, 1)) filter (
          where ${ti.totalRooms} > ${ti.soldRooms}
            and coalesce(${sr.closedToArrival}, false) = false
        ) as minimum_stay
      from ${typeInventory} ${ti}
      join ${rateCalendar} ${rc}
        on ${rc.roomTypeId} = ${ti.roomTypeId} and ${rc.stayDate} = ${ti.stayDate}
      left join ${stayRestriction} ${sr}
        on ${sr.roomTypeId} = ${ti.roomTypeId} and ${sr.stayDate} = ${ti.stayDate}
      where ${ti.stayDate} >= ${first.firstDay} and ${ti.stayDate} <= ${first.lastDay}
      group by ${ti.stayDate}
    `);

    const byDate = new Map(rows.map((row) => [row.stay_date, row]));

    return {
      plan: query.plan,
      nights: first.dates().map((date) => {
        const night = byDate.get(date.toString());
        const freeTypes = night ? Number(night.free_types) : 0;
        const isSoldOut = freeTypes === 0;

        return {
          date,
          // The grid has no occupancy yet, so `BB` quotes breakfast for the
          // occupancy the rate covers — §1's included two. The stay step
          // re-quotes against the party the guest actually enters.
          lowestGross:
            isSoldOut || night?.lowest_gross == null
              ? null
              : this.applyPlan(
                  BigInt(night.lowest_gross),
                  pricing,
                  1,
                  INCLUDED_OCCUPANCY,
                ),
          isSoldOut,
          // A sold-out night is not also reported as closed to arrival. They
          // are separate cell states — `rate-calendar.ts` — and a night nobody
          // can book for want of a room has not taught the guest a rule.
          isClosedToArrival:
            !isSoldOut && Number(night?.arrivable_types ?? 0) === 0,
          minimumStay: night?.minimum_stay ?? 1,
        };
      }),
    };
  }

  /**
   * The plan's derivation, read rather than compiled in.
   *
   * A plan absent from the table prices as the calendar does. That is the
   * `STANDARD` behaviour by definition, and it is the only safe failure: a
   * missing row must never quote a discount nobody configured.
   */
  private async planPricing(code: RatePlanCode): Promise<PlanPricing> {
    const [row] = await this.db
      .select({
        percentAdjustment: ratePlan.percentAdjustment,
        breakfastPerPersonGross: ratePlan.breakfastPerPersonGross,
      })
      .from(ratePlan)
      .where(eq(ratePlan.code, code))
      .limit(1);

    return row ?? { percentAdjustment: 0, breakfastPerPersonGross: null };
  }

  /**
   * `property-and-tariff.md` §3, as arithmetic: a percentage off the calendar
   * price, then breakfast for the booked occupancy.
   *
   * Applied to the summed total rather than night by night. §5 forbids rounding
   * inside a calculation, and integer đồng means every division truncates —
   * doing it once at the end costs at most one đồng over the whole stay, where
   * doing it per night costs one per night. Breakfast is added after the
   * percentage because §3 makes `BB` "`STANDARD` + breakfast": the discount
   * belongs to the room, and a plan that discounted the meal too would post a
   * folio line that does not match the menu.
   */
  private applyPlan(
    standardTotal: bigint,
    pricing: PlanPricing,
    nights: number,
    occupancy: number,
  ): bigint {
    const adjusted =
      (standardTotal * BigInt(100 + pricing.percentAdjustment)) / 100n;

    if (pricing.breakfastPerPersonGross === null) {
      return adjusted;
    }

    return (
      adjusted +
      pricing.breakfastPerPersonGross * BigInt(occupancy) * BigInt(nights)
    );
  }
}

/**
 * The dates of one calendar month.
 *
 * Built from `@internationalized/date` rather than `Date`, for the reason
 * `stay-date.ts` gives: a month boundary read through a `Date` is a UTC
 * midnight, and in UTC+7 that is the previous night.
 */
class CalendarDateOfMonth {
  private readonly start: CalendarDate;

  constructor(year: number, month: number) {
    this.start = parseDate(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    );
  }

  get firstDay(): string {
    return this.start.toString();
  }

  get lastDay(): string {
    return this.start
      .add({ days: this.start.calendar.getDaysInMonth(this.start) - 1 })
      .toString();
  }

  dates(): CalendarDate[] {
    const days = this.start.calendar.getDaysInMonth(this.start);

    return Array.from({ length: days }, (_, offset) =>
      this.start.add({ days: offset }),
    );
  }
}
