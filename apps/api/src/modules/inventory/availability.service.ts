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
// The price itself is assembled by `@mariva/shared` rather than by this file.
// §3's bands and the plan's percentage are the funnel's arithmetic too, and a
// server that reimplemented them would be a quote and an invoice free to
// disagree — so `stay-quote.ts` owns the order they apply in and this service
// supplies the calendar sum, the party and the rates. `modules/booking` calls
// the same function at the moment of sale, which is what stops a stay from
// being shown one figure here and frozen at another there.
//
// What this does NOT price, and deliberately:
//
// - **The extra bed.** An offer carries no field for one, and the absence is the
//   answer rather than a gap in it. §1 makes a bed mandatory when the heads
//   needing bedding exceed what the bedding sleeps, and makes that bed free: the
//   advertised maximum is a promise and the bed is how the property keeps it. §3's
//   extra-person charge — which this service does apply — is the whole price of
//   the extra head, so a party of three is quoted the same here whether or not a
//   bed has to be carried in. §6's priced extra bed is a desk posting for one a
//   guest asked for, and a folio line is not an offer.
// - **Promotions** (`FR-PRC-03`).

import {
  INCLUDED_OCCUPANCY,
  nightCount,
  type Party,
  partySize,
  type RateCalendar,
  type RatePlanCode,
  type RoomTypeCode,
  type RoomTypeOffer,
  type StayDate,
  type StayOffer,
  stayTotalGross,
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
  propertyTariff,
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

/**
 * The party the rate covers, for the grid that has no party yet — §1.
 *
 * The month view is asked for before the guest has said who is travelling, so
 * `BB` quotes breakfast for the included two and nobody is beyond the rate. The
 * stay step re-quotes against the party they actually enter.
 */
const INCLUDED_PARTY: Party = { adults: INCLUDED_OCCUPANCY, children: [] };

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
    adults: number;
    childAges: readonly number[];
  }): Promise<StayOffer> {
    const nights = nightCount({ checkIn: query.checkIn, checkOut: query.checkOut });
    // The wire carries the party flat, because a query string has no nesting.
    // It becomes the shape the bands are written against once, here, rather
    // than at each of the three places below that ask something of it.
    const party: Party = {
      adults: query.adults,
      children: query.childAges.map((age) => ({ age })),
    };
    const heads = partySize(party);
    const pricing = await this.planPricing(query.plan);
    const extraPersonGross = await this.extraPersonRate(party);
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
        const total = stayTotalGross({
          standardTotal: BigInt(row.standard_total),
          percentAdjustment: pricing.percentAdjustment,
          breakfastPerPersonGross: pricing.breakfastPerPersonGross,
          extraPersonPerNightGross: extraPersonGross,
          nights,
          party,
        });

        return {
          code: row.code,
          // The average, and display only — `rate-calendar.ts` says why both
          // numbers cross the wire. The total is the authoritative figure and
          // is never derived from this one.
          perNightGross: total / BigInt(nights),
          stayTotalGross: total,
          isAvailable:
            row.fewest_free > 0 &&
            // Every head, including the free ones. §3's bands decide what a
            // guest costs; the type's maximum decides whether the room holds
            // them, and an under-6 sleeping in existing bedding still occupies
            // the room they are sleeping in.
            row.max_occupancy >= heads &&
            !row.closed_to_arrival &&
            !row.closed_to_departure &&
            row.minimum_stay <= nights &&
            (row.maximum_stay === null || row.maximum_stay >= nights),
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
              : stayTotalGross({
                  standardTotal: BigInt(night.lowest_gross),
                  percentAdjustment: pricing.percentAdjustment,
                  breakfastPerPersonGross: pricing.breakfastPerPersonGross,
                  // Nobody is beyond the included two, so the rate is
                  // multiplied by no heads. Reading the tariff to pass it here
                  // would be a query for a number this call cannot use.
                  extraPersonPerNightGross: 0n,
                  nights: 1,
                  party: INCLUDED_PARTY,
                }),
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
   * The property's extra-person rate — §3, and the figure its bands are of.
   *
   * A missing row refuses, and refuses only for the parties it would have
   * priced. This is the opposite fallback to {@link planPricing}'s, and for the
   * same reason: there, quoting the calendar price is the safe direction
   * because a missing plan must never invent a discount. Here, zero *is* the
   * discount — it would sell a third bed for nothing and read in a report as a
   * reduction somebody granted. A party the rate already covers is unaffected,
   * so a search for two does not fail over a tariff it never needed.
   */
  private async extraPersonRate(party: Party): Promise<bigint> {
    const [row] = await this.db
      .select({ gross: propertyTariff.extraPersonPerNightGross })
      .from(propertyTariff)
      .limit(1);

    if (row) return row.gross;

    if (partySize(party) > INCLUDED_OCCUPANCY) {
      throw new Error(
        "property_tariff holds no row, so a party beyond the included occupancy has no extra-person rate to be priced at",
      );
    }

    return 0n;
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
