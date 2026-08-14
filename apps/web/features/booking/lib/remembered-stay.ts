// What a guest was looking for, kept briefly so an interrupted visit does not
// start from nothing.
//
// **A search, not a person, and not a booking.** Two dates, how many people, the
// ages that price them, the rate plan and which room was picked — every one of
// them is already in the `/booking` url a guest can share with a friend, and none
// of them says who anybody is. Nothing about contact is stored here and nothing
// may be added: the name and the address are collected on the review screen, one
// press before the money, because that is where `contract/booking.ts` argues they
// belong. Neither is the booking reference kept, and that is deliberate — a
// reference is a credential of sorts, and one left in a lobby browser's
// `localStorage` is a stay somebody else can name.
//
// **The hold is not restored, and cannot be.** What comes back is the question
// the guest was asking; the room they were holding went back on sale within a
// grace of them closing the tab, which is the point of it having done so. So the
// return visit is a fresh search that takes a fresh hold, and it is fresh
// availability rather than a promise about a room the property may have sold.
//
// **A stale search is dropped rather than shown.** Fifteen minutes is enough to
// recover from a closed tab or an accidental navigation without turning a much
// later visit into a continuation the guest did not ask for. Dates that have
// gone past are also refused because the API would reject them at the hold.
//
// The reading and the writing are split from the storage for the reason
// `booking-search.ts` splits its codec from the url: the pair is what a spec can
// hold to account, and the two lines that touch `localStorage` are what a
// component calls.

import { parseDate } from "@internationalized/date";
import {
  RATE_PLAN_CODES,
  type RatePlanCode,
  ROOM_TYPE_CODES,
  type RoomTypeCode,
  type StayDate,
} from "@mariva/shared";
// The bounds on a party are the url codec's, so that a restored search lands
// inside the same limits a typed one does — there is one answer to how many
// people fit in a room, and `property-and-tariff.md` §1 is where it comes from.
import { MAX_ADULTS, MAX_CHILD_AGE, MAX_CHILDREN } from "./booking-search";
import type { Child, Party } from "./stay-quote";

/** Where it is kept. Versioned in the name, so a shape that changes is a key
 *  nothing reads rather than a value something mis-parses. */
const STORAGE_KEY = "mariva:booking-search:v2";

/** A remembered search is an interruption aid, not a default for a later visit. */
const REMEMBERED_STAY_TTL_MS = 15 * 60 * 1000;

/** What a guest was looking for when they last left the funnel. */
export interface RememberedStay {
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly party: Party;
  readonly plan: RatePlanCode;
  /** The room they had chosen, so the list opens where they left it. */
  readonly roomType: RoomTypeCode;
}

/** The stored text, which is JSON and is never trusted to be. */
interface StoredStay {
  readonly savedAt: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly childAges: readonly number[];
  readonly plan: string;
  readonly roomType: string;
}

/**
 * The search as the one string that is kept.
 *
 * Field by field rather than a spread of whatever the caller held, so that a
 * value this module was never asked to keep cannot arrive here by being attached
 * to something that was.
 */
export function encodeStay(stay: RememberedStay, savedAt = Date.now()): string {
  const stored: StoredStay = {
    savedAt,
    checkIn: stay.checkIn.toString(),
    checkOut: stay.checkOut.toString(),
    adults: stay.party.adults,
    childAges: stay.party.children.map((child) => child.age),
    plan: stay.plan,
    roomType: stay.roomType,
  };

  return JSON.stringify(stored);
}

/**
 * The search back, or nothing at all.
 *
 * Nothing for every way of being unusable, and each of them is ordinary: no
 * visit before this one, a value another version of this app wrote, a browser
 * where somebody edited the key by hand, and a stay whose arrival has been and
 * gone. A malformed value is dropped rather than partly believed — half a search
 * would put a guest on a screen quoting dates they did not choose.
 *
 * `today` is the property's own, passed in rather than read here: a browser in
 * Seoul at 00:30 is on tomorrow's date, and a search dropped or kept by the
 * device's calendar would be dropped or kept differently for two guests looking
 * at the same night.
 */
export function decodeStay(
  raw: string | null,
  today: StayDate,
  now = Date.now(),
): RememberedStay | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const stored = parsed as Partial<StoredStay>;

  // Values written before the time limit existed have no `savedAt`, so they are
  // deliberately refused too: the new fifteen-minute rule applies immediately
  // rather than only after this version has written the key once.
  if (
    typeof stored.savedAt !== "number" ||
    !Number.isSafeInteger(stored.savedAt) ||
    stored.savedAt > now ||
    now - stored.savedAt >= REMEMBERED_STAY_TTL_MS
  ) {
    return null;
  }

  const checkIn = readDate(stored.checkIn);
  const checkOut = readDate(stored.checkOut);
  const plan = readPlan(stored.plan);
  const roomType = readRoomType(stored.roomType);

  if (!checkIn || !checkOut || !plan || !roomType) {
    return null;
  }

  // Ordered, or it is not a stay — the same rule `booking-search.ts` applies to
  // a url, and for the same reason: a swapped pair is a typo rather than a
  // request to swap them back.
  if (checkIn.compare(checkOut) >= 0) {
    return null;
  }

  // The property has moved on. Offering these dates back would quote a night
  // that has happened and be refused at the hold, which reads on the screen as
  // the funnel being broken rather than as the search being old.
  if (checkIn.compare(today) < 0) {
    return null;
  }

  return {
    checkIn,
    checkOut,
    party: {
      adults: readAdults(stored.adults),
      children: readChildren(stored.childAges),
    },
    plan,
    roomType,
  };
}

/**
 * Keeps the search behind a hold the guest has just taken.
 *
 * Called as the funnel leaves the room list, which is the moment every part of
 * it is settled and the last moment the room they chose is known to this app.
 * Silent on failure: private browsing and a full quota both throw here, and
 * neither is a reason a guest cannot book a room.
 */
export function rememberStay(stay: RememberedStay): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStay(stay));
  } catch {
    // Nothing to say. The next visit starts from a blank search, which is what
    // every visit did before this existed.
  }
}

/** The search from a previous visit, if there is a usable one. */
export function recallStay(today: StayDate): RememberedStay | null {
  try {
    return decodeStay(window.localStorage.getItem(STORAGE_KEY), today);
  } catch {
    return null;
  }
}

function readDate(value: unknown): StayDate | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/**
 * The plan and the room type, checked against the contract's own tuples.
 *
 * Not a list written out here. A code the property retires is removed from
 * `@mariva/shared` and stops being restorable in the same commit it stops being
 * sellable, where a copy of the list in this file would go on offering it back
 * until somebody noticed.
 */
function readPlan(value: unknown): RatePlanCode | null {
  return RATE_PLAN_CODES.includes(value as RatePlanCode)
    ? (value as RatePlanCode)
    : null;
}

function readRoomType(value: unknown): RoomTypeCode | null {
  return ROOM_TYPE_CODES.includes(value as RoomTypeCode)
    ? (value as RoomTypeCode)
    : null;
}

/** Bounded rather than trusted: anything can be written into this key, and a
 *  party of nine restored out of it would be a screen quoting a stay the
 *  property has no room for. */
function readAdults(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(MAX_ADULTS, Math.max(1, value))
    : 2;
}

function readChildren(value: unknown): Child[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (age): age is number => typeof age === "number" && Number.isInteger(age),
    )
    .slice(0, MAX_CHILDREN)
    .map((age) => ({ age: Math.min(MAX_CHILD_AGE, Math.max(0, age)) }));
}
