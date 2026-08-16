/* The four numbers on the launchpad, derived from what the API answered.
 *
 * Pure, and separate from the hooks beside it, because every one of these is a
 * question the API does not answer directly: there is no `GET /dashboard`, and
 * there should not be — a route per screen is a second description of facts the
 * operational routes already own. So the counts are cut out of three existing
 * answers, and cutting them is the part that can be wrong in a way nobody
 * notices. A miscounted arrivals card sends a receptionist to a queue that does
 * not match the number they were promised, which is worse than no card at all.
 *
 * Three rules hold throughout, and `day-counts.spec.ts` holds this file to
 * them:
 *
 * 1. **A count nobody could compute is not zero.** Every derivation below
 *    returns `null` rather than `0` when the answer it was handed cannot speak
 *    to the question, and {@link countReading} turns that into a card that says
 *    so. Zero is a real and reassuring number — "nobody is waiting" — and
 *    printing it over a failure is the console lying about the property.
 * 2. **The day is the property's, not the browser's.** Nothing here reads a
 *    clock. The business date arrives on the housekeeping board, resolved by
 *    the API against `system_config.business_date_rollover_hour`, and every
 *    window below is built from that string. A console computing its own 04:00
 *    would count arrivals against a different day than the desk is working.
 * 3. **A capped answer says it was capped.** `search.operational` returns at
 *    most {@link SEARCH_RESULT_LIMIT} stays, so a count taken from it can be
 *    short. The reading carries that, and the card prints `50+` rather than a
 *    figure it cannot stand behind.
 */

import type { ApiClient } from "@mariva/api-client";
import { SEARCH_RESULT_LIMIT } from "@mariva/shared";

import type { HousekeepingBoard } from "@/features/housekeeping";

/* The shapes, taken from the client rather than restated — the same argument
 * `features/housekeeping/board-queries.ts` makes for reading its board type off
 * the client: `@mariva/shared` types the client from the contract's own
 * schemas, so a field renamed there breaks this file in the pull request that
 * renamed it, where a hand-written interface would compile until it was
 * wrong. */
export type SearchResults = Awaited<
  ReturnType<ApiClient["search"]["operational"]>
>;
export type SearchCriteria = Parameters<ApiClient["search"]["operational"]>[0];
export type BookingHit = Extract<
  SearchResults,
  { scope: "everything" }
>["bookings"][number];
export type FolioPage = Awaited<ReturnType<ApiClient["folio"]["list"]>>;
export type FolioListQuery = Parameters<ApiClient["folio"]["list"]>[0];

/** A figure, and whether the answer it came out of had been cut short. */
export interface DayCount {
  readonly count: number;
  /**
   * True when the source answer hit its own ceiling, so the real figure is this
   * one or larger. Only the search can be capped; the board is the whole
   * property and the folio total is counted under the filter rather than over
   * the page.
   */
  readonly truncated: boolean;
}

/**
 * What one card knows about its own number.
 *
 * A union and not a number beside two booleans, because the three states are
 * exclusive and the compiler should be the thing that says so: there is no
 * `count` to read on a card that failed, so no render path can reach for one
 * and find the `0` a numeric default would have left there.
 */
export type CountReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | ({ readonly status: "counted" } & DayCount);

/** Where a count is read from, as {@link countReading} needs it. */
export interface CountSource<T> {
  /**
   * Whether this number cannot be produced — the query's own error, or the
   * failure of something it was waiting on. Arrivals and departures are both
   * keyed to the day the board resolves, so a board that did not load is a
   * failure of three cards and not of one, and a card left spinning forever on
   * a dependency nobody can see is the state this flag exists to prevent.
   */
  readonly failed: boolean;
  /** The answer, once there is one. */
  readonly data: T | undefined;
}

/**
 * One card's state, folded out of one query and whatever it depended on.
 *
 * A derivation returning `null` is treated as a failure rather than as a count
 * of zero, and that case is real: `search.operational` answers a narrowed
 * `rooms` scope to a caller whose grant covers rooms only, and a rooms-scoped
 * answer contains no stays to count. "This session cannot answer that" is what
 * the operator needs to read; "0 arrivals" is a different and false statement.
 */
export function countReading<T>(
  source: CountSource<T>,
  derive: (data: T) => DayCount | null,
): CountReading {
  if (source.failed) {
    return { status: "failed" };
  }

  if (source.data === undefined) {
    return { status: "pending" };
  }

  const answer = derive(source.data);

  return answer === null
    ? { status: "failed" }
    : { status: "counted", ...answer };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The calendar date `days` either side of an ISO one — "2026-08-16" plus one.
 *
 * Walked at UTC midnight rather than in the property's zone, for the reason
 * `packages/shared/src/stay-date.ts` gives for measuring nights the same way:
 * Vietnam keeps no daylight saving, so the two agree, and anchoring to a zone
 * that has none keeps the arithmetic right if that ever stops being true. Going
 * through `Date.UTC` also normalises 1 March minus a day into 28 or 29 February
 * without either being a case anybody wrote.
 */
export function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`not a YYYY-MM-DD calendar date: ${isoDate}`);
  }

  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);

  return shifted.toISOString().slice(0, 10);
}

/**
 * The search that finds the stays arriving today.
 *
 * `CONFIRMED` is the state an arrival waits in: a hold has not been paid for
 * and a stay already checked in is not awaiting anything. The window is the one
 * business day, and the API matches a stay against it by overlap — half-open on
 * both sides — so `[today, tomorrow)` is every stay occupying today. The hits
 * that are today's *arrivals* are picked out of that by
 * {@link arrivalsAwaitingCheckIn}, because a confirmed stay that arrived
 * yesterday and was never checked in still occupies today and is a no-show for
 * the night audit rather than a guest at the desk.
 */
export function arrivalCriteria(businessDate: string): SearchCriteria {
  return {
    state: "CONFIRMED",
    from: businessDate,
    to: shiftDate(businessDate, 1),
  };
}

/**
 * The search that finds the stays due out today.
 *
 * The window is *yesterday*, and that is the half-open convention rather than
 * an off-by-one: a stay departing today owns nights up to but not including
 * today, so `[today, tomorrow)` — the window arrivals use — excludes exactly
 * the stays this card is about. `[yesterday, today)` catches every one of them,
 * because a checked-in stay leaving today slept last night, and it is the
 * narrowest window that does, which is what keeps the answer clear of the
 * search's cap.
 */
export function departureCriteria(businessDate: string): SearchCriteria {
  return {
    state: "CHECKED_IN",
    from: shiftDate(businessDate, -1),
    to: businessDate,
  };
}

/** Stays arriving today that nobody has checked in yet. */
export function arrivalsAwaitingCheckIn(
  results: SearchResults,
  businessDate: string,
): DayCount | null {
  return countStays(results, (stay) => stay.checkIn === businessDate);
}

/** Stays due out today that nobody has checked out yet. */
export function departuresAwaitingCheckout(
  results: SearchResults,
  businessDate: string,
): DayCount | null {
  return countStays(results, (stay) => stay.checkOut === businessDate);
}

function countStays(
  results: SearchResults,
  matches: (stay: BookingHit) => boolean,
): DayCount | null {
  if (results.scope !== "everything") {
    return null;
  }

  return {
    count: results.bookings.filter(matches).length,
    // Measured against what came back rather than against what survived the
    // filter: the cap is applied by the API before this file sees anything, so
    // a full page means stays were left behind and the filtered figure below is
    // a floor.
    truncated: results.bookings.length >= SEARCH_RESULT_LIMIT,
  };
}

/**
 * Rooms a guest cannot be walked into.
 *
 * `isReady` is the API's own answer to `booking-state-machine.md` §4's
 * room-ready guard, so this counts the negation rather than listing statuses —
 * a console deciding for itself that `INSPECTED` is ready is a second opinion
 * about a rule the check-in route already enforces. Out-of-order rooms are in
 * the count because they are not ready, which is the question the card asks.
 */
export function roomsNotReady(board: HousekeepingBoard): DayCount {
  return {
    count: board.rooms.filter((room) => !room.isReady).length,
    truncated: false,
  };
}

/**
 * Accounts still short, out of a page asked for the total and nothing else.
 *
 * `total` is counted by the API under the same filter the page was cut from, so
 * the figure is the whole set rather than the length of one page — which is why
 * `useUnsettledFolios` asks for a single row and reads this.
 */
export function unsettledFolios(page: FolioPage): DayCount {
  return { count: page.total, truncated: false };
}
