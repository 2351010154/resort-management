"use client";

// The one search the arrival is composing, before it becomes a URL.
//
// Two places on this page ask for the same stay: the dates form in the Menu
// sheet, and the `Choose dates` links in Act 2. They are not separate questions
// — a reader who types a range into the sheet and then presses an Act 2 link has
// already answered, and asking again would be the page forgetting. So the draft
// lives here and both read it. (Act 4's and Act 5's booking links are still bare
// `/booking` and do not carry it.)
//
// It is a *draft*, not a `BookingSearch`. The controls hold what a guest has
// typed so far — an empty date, a half range, an unfilled child slot — none of
// which `BookingSearch` can represent, because that type is the funnel's
// finished state. `validateDraft` is the one crossing between the two, and
// `booking-search.ts` stays the only module that knows the param names: this one
// never touches a query string except through `writeBookingSearch`.

import { type CalendarDate, parseDate, today } from "@internationalized/date";
import { PROPERTY_TIME_ZONE } from "@mariva/shared";
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  type BookingSearch,
  DEFAULT_PLAN,
  MAX_ADULTS,
  MAX_CHILDREN,
  MAX_CHILD_AGE,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";

export interface ArrivalBookingDraft {
  /** `yyyy-mm-dd` as a date input gives it, or "" for unanswered. */
  readonly from: string;
  readonly to: string;
  readonly adults: number;
  /** One slot per child the codec can carry; `null` is a slot left empty. */
  readonly childAges: readonly (number | null)[];
}

export type DraftField = "from" | "to" | "adults" | "children";
export type DraftErrors = Partial<Record<DraftField, string>>;

export type DraftValidation =
  | { readonly ok: true; readonly search: BookingSearch }
  | { readonly ok: false; readonly errors: DraftErrors };

/**
 * What the card says when a field cannot be sent.
 *
 * Each one states the rule `booking-search.ts` enforces and nothing else — the
 * limits are read from that module, so a changed ceiling changes the sentence.
 */
const MESSAGE = {
  from: "Add an arrival date.",
  to: "Add a departure date.",
  order: "Departure must be after arrival.",
  past: "Arrival cannot be before today.",
  adults: `Between 1 and ${MAX_ADULTS} adults.`,
  children: `Up to ${MAX_CHILDREN} children, aged ${MAX_CHILD_AGE} or under.`,
} as const;

/** Same discipline as the codec: a date that will not parse is not a date. */
function parseDay(raw: string): CalendarDate | null {
  if (!raw) return null;
  try {
    return parseDate(raw);
  } catch {
    return null;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function isAge(age: number | null): age is number {
  return age !== null;
}

function party(draft: ArrivalBookingDraft) {
  return {
    adults: clamp(
      Number.isFinite(draft.adults) ? Math.round(draft.adults) : 1,
      1,
      MAX_ADULTS,
    ),
    children: draft.childAges
      .filter(isAge)
      .slice(0, MAX_CHILDREN)
      .map((age) => ({ age: clamp(Math.round(age), 0, MAX_CHILD_AGE) })),
  };
}

/**
 * The draft as a search, or the reasons it is not one yet.
 *
 * The same four rules `readBookingSearch` applies on the far side — ordered
 * range, one to `MAX_ADULTS` adults, at most `MAX_CHILDREN` children, no age
 * above `MAX_CHILD_AGE` — plus the calendar's floor: arrival is no earlier than
 * the property's today. The date inputs carry `min`, but the form submits with
 * `noValidate` and a typed date ignores `min` anyway, so the floor has to be
 * checked here or a past range reaches the room step and fails at the API.
 * Checked here so the guest is told in the sheet rather than having the funnel
 * silently drop half of what they typed.
 */
export function validateDraft(draft: ArrivalBookingDraft): DraftValidation {
  const errors: DraftErrors = {};
  const checkIn = parseDay(draft.from);
  const checkOut = parseDay(draft.to);

  if (!checkIn) errors.from = MESSAGE.from;
  if (!checkOut) errors.to = MESSAGE.to;
  if (checkIn && checkIn.compare(today(PROPERTY_TIME_ZONE)) < 0) {
    errors.from = MESSAGE.past;
  }
  if (checkIn && checkOut && checkIn.compare(checkOut) >= 0) {
    errors.to = MESSAGE.order;
  }

  if (
    !Number.isInteger(draft.adults) ||
    draft.adults < 1 ||
    draft.adults > MAX_ADULTS
  ) {
    errors.adults = MESSAGE.adults;
  }

  const ages = draft.childAges.filter(isAge);
  if (
    ages.length > MAX_CHILDREN ||
    ages.some((age) => !Number.isInteger(age) || age < 0 || age > MAX_CHILD_AGE)
  ) {
    errors.children = MESSAGE.children;
  }

  if (!checkIn || !checkOut || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    search: {
      range: { checkIn, checkOut },
      party: party(draft),
      plan: DEFAULT_PLAN,
      // The arrival has asked the funnel's first question, so the funnel opens
      // on the room list. `readBookingSearch` normalises this back to the dates
      // screen if the range ever fails to survive the trip.
      step: "rooms",
    },
  };
}

/**
 * A link to the funnel that carries whatever the draft already holds.
 *
 * For the `Choose dates` links in Act 2 — addresses rather than submits: they
 * cannot refuse to navigate, so they never validate. An incomplete or past range
 * is simply not written, and the guest lands on the calendar with their party
 * intact — which is the difference between this and a bare `/booking` that
 * throws the party away.
 */
export function draftHref(draft: ArrivalBookingDraft): string {
  const checkIn = parseDay(draft.from);
  const checkOut = parseDay(draft.to);
  const ordered =
    checkIn &&
    checkOut &&
    checkIn.compare(today(PROPERTY_TIME_ZONE)) >= 0 &&
    checkIn.compare(checkOut) < 0;

  return `/booking${writeBookingSearch({
    range: ordered ? { checkIn, checkOut } : null,
    party: party(draft),
    plan: DEFAULT_PLAN,
    step: ordered ? "rooms" : "dates",
  })}`;
}

interface ArrivalBookingDraftState extends ArrivalBookingDraft {
  setFrom: (from: string) => void;
  setTo: (to: string) => void;
  setAdults: (adults: number) => void;
  /** `slot` is a zero-based index into `childAges`; `null` empties it. */
  setChildAge: (slot: number, age: number | null) => void;
}

export const useArrivalBookingDraftStore = create<ArrivalBookingDraftState>(
  (set) => ({
    from: "",
    to: "",
    // The funnel's own default party, so a reader who touches nothing and
    // presses Book arrives on the search they would have had anyway.
    adults: 2,
    childAges: Array.from({ length: MAX_CHILDREN }, () => null),
    setFrom: (from) => set({ from }),
    setTo: (to) => set({ to }),
    setAdults: (adults) => set({ adults }),
    setChildAge: (slot, age) =>
      set((state) => ({
        childAges: state.childAges.map((current, index) =>
          index === slot ? age : current,
        ),
      })),
  }),
);

/**
 * The earliest arrival a date input should offer, as `min` wants it.
 *
 * The property's calendar day, not the browser's: a guest in Paris at 23:00 is
 * already tomorrow at the desk, and the desk's day is the one a stay is sold in.
 * Empty on the server and on the first client paint, so the markup hydrates
 * against itself, and the floor arrives one effect later — a guest cannot have
 * opened the picker by then.
 */
export function useEarliestArrival(): string {
  const [floor, setFloor] = useState("");
  useEffect(() => setFloor(today(PROPERTY_TIME_ZONE).toString()), []);
  return floor;
}

/**
 * The draft, field by field.
 *
 * Four separate selectors rather than one that builds an object: a selector
 * returning a fresh literal is a new reference on every store read, which is a
 * re-render loop under `useSyncExternalStore`.
 */
export function useArrivalDraft(): ArrivalBookingDraft {
  const from = useArrivalBookingDraftStore((s) => s.from);
  const to = useArrivalBookingDraftStore((s) => s.to);
  const adults = useArrivalBookingDraftStore((s) => s.adults);
  const childAges = useArrivalBookingDraftStore((s) => s.childAges);
  return { from, to, adults, childAges };
}
