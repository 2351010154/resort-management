// The two reads `/booking` opens on: a window of priced nights, and one offer
// per room type once the guest has both dates.
//
// **This is where the funnel stopped inventing prices.** The screen used to
// render a deterministic stand-in — a base rate per type, a weekend uplift, a
// pseudo-random occupancy — because the read procedures did not exist. They do:
// `contract/availability.ts` declares both, `availability.search` is the one
// unauthenticated row in the RBAC matrix, and a stranger opening the calendar is
// exactly the caller that row was written for. So the tariff on the screen is
// the property's, the sold-out cells are its inventory, and the total the room
// card quotes is the number the hold will be written at.
//
// **Neither call prices anything here, and that is the point.** §3's bands, the
// plan's percentage and the breakfast line are applied once, by the API, against
// rows a manager edits — where a second copy in the browser would be a card and
// an invoice free to disagree. What this file does is ask, decode and hand back.
//
// **Money and dates are normalised on the way in.** The contract declares đồng
// as `bigint` and a stay boundary as a `CalendarDate`; what the transport
// actually hands back is decimal text and nine characters, because JSON has
// neither type — `money.ts` and `stay-date.ts` both say so at length. So every
// amount crosses `BigInt` and every date crosses `parseDate` at this boundary,
// and nothing downstream has to wonder which form it is holding.

import { type CalendarDate, parseDate, today } from "@internationalized/date";
import {
  type NightRate,
  PROPERTY_TIME_ZONE,
  type RatePlanCode,
  type RoomTypeOffer,
  type StayRange,
} from "@mariva/shared";
import { api } from "@/lib/api";
import type { Party } from "./stay-quote";

/** Today, in the property's zone — never the browser's. */
export function propertyToday(): CalendarDate {
  return today(PROPERTY_TIME_ZONE);
}

/** One night, as the wire spells it, in the form the screen reasons in. */
function decodeNight(night: {
  date: string;
  lowestGross: bigint | null;
  isSoldOut: boolean;
  isClosedToArrival: boolean;
  minimumStay: number;
}): NightRate {
  return {
    date: parseDate(night.date),
    lowestGross: night.lowestGross === null ? null : BigInt(night.lowestGross),
    isSoldOut: night.isSoldOut,
    isClosedToArrival: night.isClosedToArrival,
    minimumStay: night.minimumStay,
  };
}

/**
 * Every night of the priced window, from `from` for `days` nights.
 *
 * **All of it, and not only what is on screen.** The grid pages within the
 * window, the foot counts the free nights in it, and `nearest-availability.ts`
 * scans two months past a range that could not be sold — so a hook that fetched
 * the visible month would leave three features reading gaps and calling them
 * sold out.
 *
 * **One request, and so one refusal for the whole window.** The route takes the
 * window itself — half-open [from, to), the convention every range in the
 * system keeps — so the year the funnel opens on is one GET rather than the
 * thirteen month calls this used to fan out on first paint. It is also the
 * honest failure shape: a calendar missing an August nobody asked about yet is
 * a calendar that will refuse a press in August with "not yet priced", and a
 * guest cannot tell that from a property that is full. Nothing partial can be
 * rendered as if complete, and no trim is needed either — the answer is exactly
 * the nights that were asked for.
 */
export async function readNightRates(
  from: CalendarDate,
  days: number,
  plan: RatePlanCode,
): Promise<NightRate[]> {
  const grid = await api.availability.calendar({
    // Nine characters at the boundary, per `stay-date.ts` — the contract's
    // codec decodes them back into a `CalendarDate` on the other side.
    from: from.toString(),
    to: from.add({ days }).toString(),
    plan,
  });

  return grid.nights.map(decodeNight);
}

/**
 * What each type costs for the chosen range, and whether it can be sold.
 *
 * The party goes up flat — adults and the ages travelling with them — because
 * §3 prices a third head by age and a count cannot say which band it falls in.
 * A type the property has not published every night of is absent from the
 * answer rather than quoted as sold out; `partitionRoomTypes` reads an absent
 * type as unavailable, which is the conservative direction.
 */
export async function readStayOffers(
  range: StayRange,
  party: Party,
  plan: RatePlanCode,
): Promise<RoomTypeOffer[]> {
  const answer = await api.availability.search({
    // Nine characters, which is what the contract's codec decodes back into a
    // `CalendarDate` on the other side. A `Date` here would be an instant, and
    // an instant is what a stay boundary is deliberately not.
    checkIn: range.checkIn.toString(),
    checkOut: range.checkOut.toString(),
    plan,
    adults: party.adults,
    childAges: party.children.map((child) => child.age),
  });

  return answer.offers.map((offer) => ({
    ...offer,
    perNightGross: BigInt(offer.perNightGross),
    stayTotalGross: BigInt(offer.stayTotalGross),
  }));
}

/**
 * What the screen says when a read did not come back.
 *
 * Two sentences rather than one, because the guest is standing in a different
 * place for each: the calendar failing means there are no dates to choose, and
 * the offers failing means dates are chosen and the prices for them are missing.
 * Neither apologises and neither invents a wait — the API's own message is
 * preferred over both wherever it wrote one, per `apiMessage`.
 */
export const AVAILABILITY_MESSAGES = {
  calendar:
    "The property's prices could not be read just now. Check your connection and try again.",
  offers:
    "These nights could not be priced just now. Check your connection and try again.",
} as const;
