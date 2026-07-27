// A STUB. It stands in for reads `apps/api` has not built.
//
// `/booking` needs three things that do not exist yet as public endpoints:
// a per-date lowest price across all types for a month, per-date restriction
// flags, and per-type availability for a range. The report that specified this
// screen lists all three as unbuilt, and the `pricing` module owns them —
// `repository-structure.md`'s domain table, "Rate plans, rate calendar, stay
// restrictions, promotions".
//
// What is real and permanent is the *contract*: `packages/shared/rate-calendar.ts`
// declares the shapes, and everything below satisfies them. When the endpoints
// land, this module is deleted and `packages/api-client` returns the same types —
// no component changes, because no component knows where the data came from.
//
// It is deterministic rather than random: a fixture that reshuffles on every
// render cannot be screenshotted, cannot be reasoned about in review, and turns
// a visual baseline into noise. Every value derives from the date itself.
//
// The ⚑ tariff values are the ones `property-and-tariff.md` leaves unset. They
// live here, not in the components, because they are data the database will own.

import {
  type CalendarDate,
  getLocalTimeZone,
  today,
} from "@internationalized/date";
import {
  type NightRate,
  PROPERTY_TIME_ZONE,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { ROOM_TYPES } from "./room-types";
import type { TariffRates } from "./stay-quote";

/**
 * ⚑ Proposed. `property-and-tariff.md` §3 names the extra-person band and §6
 * the service catalog, and leaves every price unset — these are the numbers this
 * screen cannot render without. Gross, per §5.
 */
export const TARIFF_RATES: TariffRates = {
  extraPersonPerNight: 600_000n,
  breakfastPerPersonPerNight: 250_000n,
  extraBedPerNight: 350_000n,
};

/** ⚑ Proposed base gross rate per type, on a low-season weeknight. */
const BASE_RATE: Record<RoomTypeCode, VndAmount> = {
  SUPERIOR: 1_850_000n,
  DELUXE: 2_450_000n,
  PREMIER: 3_200_000n,
  JUNIOR_SUITE: 4_600_000n,
  PANORAMA_SUITE: 6_800_000n,
};

/**
 * Friday and Saturday nights price as weekend — `property-and-tariff.md` §3.
 * `dayOfWeek` on a `CalendarDate` is 1 = Monday through 7 = Sunday.
 */
function isWeekendNight(date: CalendarDate): boolean {
  const day = date.toDate(PROPERTY_TIME_ZONE).getDay();
  return day === 5 || day === 6;
}

/**
 * A stable pseudo-random in [0, 1) from a date, so a night looks the same twice.
 *
 * `Math.imul` and `>>>` throughout, deliberately. The obvious version —
 * `(seed * 2654435761) % 1000` — overflows: a 2026 date seeds around 20 million,
 * times Knuth's constant is 5.4e16, and `Number.MAX_SAFE_INTEGER` is 9.0e15. The
 * product loses its low bits, which are the only bits `% 1000` reads, and the
 * function collapses onto a handful of values. It looked random and was very
 * nearly constant — the whole calendar came out with no sold-out nights at all.
 */
function noise(date: CalendarDate, salt: number): number {
  let hash = Math.imul(
    date.year * 10_000 + date.month * 100 + date.day,
    0x9e3779b1,
  );
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b + salt);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32;
}

/**
 * How full the property is that night, as a probability any one type is gone.
 *
 * Modelled as one figure per night rather than five independent draws, because
 * that is how a hotel actually fills: pressure is a property of the date. It also
 * makes the two states reachable in the right proportion — a type sells out often,
 * and every type selling out is rare but does happen on a peak weekend, which is
 * exactly the mix the room list has to handle.
 */
function occupancyPressure(date: CalendarDate): number {
  if (noise(date, 11) < 0.06) return 0.94; // A handful of full nights.
  return isWeekendNight(date) ? 0.42 : 0.14;
}

/** Gross room rate for one type on one night. */
export function roomRate(code: RoomTypeCode, date: StayDate): VndAmount {
  const base = BASE_RATE[code];
  return isWeekendNight(date) ? (base * 125n) / 100n : base;
}

/** Whether a given type has a room free that night. */
function isTypeSoldOut(code: RoomTypeCode, date: StayDate): boolean {
  // Salted by the type's position in the mix, so the twelve Superiors and the four
  // Panorama Suites do not sell out together — and so a type's own answer is
  // stable rather than depending on how long its code happens to be.
  const rank = ROOM_TYPES.findIndex((type) => type.code === code);
  return noise(date, rank + 1) < occupancyPressure(date);
}

/** Types with no room free on at least one night of a range. */
export function soldOutTypes(nights: readonly StayDate[]): Set<RoomTypeCode> {
  const sold = new Set<RoomTypeCode>();
  for (const type of ROOM_TYPES) {
    if (nights.some((date) => isTypeSoldOut(type.code, date))) {
      sold.add(type.code);
    }
  }
  return sold;
}

/** Per-type, per-night gross rates for a set of nights. */
export function roomRateTable(
  nights: readonly StayDate[],
): Map<RoomTypeCode, Map<string, VndAmount>> {
  return new Map(
    ROOM_TYPES.map((type) => [
      type.code,
      new Map(
        nights.map((date) => [date.toString(), roomRate(type.code, date)]),
      ),
    ]),
  );
}

/**
 * The plan's effect on the *cheapest* night, for the calendar cell only.
 *
 * `BB` adds breakfast for the booked occupancy, which the calendar does not know
 * — the grid is drawn before a party is settled and must stay one number per
 * night. So the cell shows the room half of the plan, and the legend says the
 * price is a from-figure. The card is where a party-aware total appears.
 */
function planRoomRate(gross: VndAmount, plan: RatePlanCode): VndAmount {
  return plan === "NONREF" ? (gross * 9n) / 10n : gross;
}

/**
 * One month of nights, priced and restricted.
 *
 * Restrictions are sparse on purpose. A calendar where a third of the cells
 * carry a rule teaches nothing; the states have to be rare enough that hitting
 * one is informative.
 */
export function monthOfNights(
  firstVisibleDay: CalendarDate,
  dayCount: number,
  plan: RatePlanCode,
): NightRate[] {
  const nights: NightRate[] = [];

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = firstVisibleDay.add({ days: offset });
    const isSoldOut = ROOM_TYPES.every((type) =>
      isTypeSoldOut(type.code, date),
    );

    const cheapest = ROOM_TYPES.filter(
      (type) => !isTypeSoldOut(type.code, date),
    ).reduce<VndAmount | null>((lowest, type) => {
      const rate = roomRate(type.code, date);
      return lowest === null || rate < lowest ? rate : lowest;
    }, null);

    nights.push({
      date,
      lowestGross:
        isSoldOut || cheapest === null ? null : planRoomRate(cheapest, plan),
      isSoldOut,
      // A stay may run through this night but not begin on it. Rare, and always
      // on a weekend, which is when a property protects a two-night pattern.
      isClosedToArrival:
        !isSoldOut && isWeekendNight(date) && noise(date, 3) < 0.18,
      minimumStay: isWeekendNight(date) && noise(date, 5) < 0.3 ? 2 : 1,
    });
  }

  return nights;
}

/** Today, in the property's zone — never the browser's. */
export function propertyToday(): CalendarDate {
  return today(PROPERTY_TIME_ZONE);
}

/**
 * Today in the *browser's* zone, for the one thing that legitimately needs it.
 *
 * Exported so the calendar can name the gap. A guest in Seoul at 00:30 is on a
 * different calendar date than the property, and the honest thing is to say
 * which clock the dates belong to rather than silently pick one.
 */
export function browserToday(): CalendarDate {
  return today(getLocalTimeZone());
}
