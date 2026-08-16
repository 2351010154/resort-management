"use client";

// The two reads of `availability.ts`, as state a screen can render: what came
// back, whether it is still coming, and why it did not.
//
// **The same shape `use-held-stay.ts` set, for the same reason.** A read that
// resolves after the guest has navigated away must not write to a component
// that is gone, a refusal stops the asking rather than retrying it into a loop,
// and the retry is a button the caller can offer rather than a timer nobody can
// see. Nothing polls: the calendar and the offers change when the guest changes
// the search, not on a clock.
//
// **No query library, deliberately.** This app calls the oRPC client directly —
// `stay-funnel.ts` and `use-held-stay.ts` are the pattern, and there are two
// reads on one screen here rather than a cache anybody shares. A dependency that
// exists to deduplicate and revalidate would be earning nothing.
//
// **What a failed read must never do is fall back to a price.** There is no
// stand-in tariff left in this app, and the absence is the feature: a calendar
// that cannot be read draws no cell prices and refuses every press with "not yet
// priced", and the screens above say so in a sentence with a way to ask again.

import type { CalendarDate } from "@internationalized/date";
import type { RatePlanCode, RoomTypeOffer, StayRange } from "@mariva/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiMessage } from "@/lib/api";
import {
  AVAILABILITY_MESSAGES,
  readNightRates,
  readStayOffers,
} from "./availability";
import { indexNights, type NightIndex, type Party } from "./stay-quote";

/** Nothing read yet — the value every consumer starts from. */
const NO_NIGHTS: NightIndex = new Map();

const NO_OFFERS: readonly RoomTypeOffer[] = [];

export interface CalendarRead {
  /** The window's nights, by date. Empty until the first read answers. */
  readonly nights: NightIndex;
  /** Nothing has come back yet — neither the nights nor a refusal. */
  readonly loading: boolean;
  /** Why the window could not be read, in the API's own words where it wrote them. */
  readonly refusal: string | undefined;
  readonly reread: () => void;
}

/**
 * The priced window, from `from` for `days` nights, under one plan.
 *
 * Re-read when the plan changes rather than annotated: the three plans price
 * differently, so the cheapest night under one is not the cheapest under
 * another — `rate-calendar.ts` in `@mariva/shared` makes that argument.
 */
export function useRateCalendar(
  from: CalendarDate,
  days: number,
  plan: RatePlanCode,
): CalendarRead {
  const [nights, setNights] = useState<NightIndex>(NO_NIGHTS);
  const [loading, setLoading] = useState(true);
  const [refusal, setRefusal] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const reread = useCallback(() => {
    setRefusal(undefined);
    setLoading(true);
    setAttempt((count) => count + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is not read in the body, and that is its job — it is what `reread` increments to run the effect again. `from` is listed as the date it names rather than as the object: a `CalendarDate` is rebuilt on any render that recomputes it, and depending on the identity would re-fetch a year of nights for a value that had not changed.
  useEffect(() => {
    let live = true;

    async function ask(): Promise<void> {
      try {
        const window = await readNightRates(from, days, plan);

        if (!live) {
          return;
        }

        setNights(indexNights(window));
        setLoading(false);
      } catch (error) {
        if (!live) {
          return;
        }

        // The window is cleared rather than left standing. A grid still drawing
        // last plan's prices under a line saying the prices could not be read is
        // a screen contradicting itself, and the stale half is the half a guest
        // would act on.
        setNights(NO_NIGHTS);
        setRefusal(apiMessage(error, AVAILABILITY_MESSAGES.calendar));
        setLoading(false);
      }
    }

    void ask();

    return () => {
      live = false;
    };
  }, [from.toString(), days, plan, attempt]);

  return { nights, loading, refusal, reread };
}

export interface OffersRead {
  /** One offer per type the property has published every night of the range. */
  readonly offers: readonly RoomTypeOffer[];
  /** Nothing has come back yet. False when there is no range to price. */
  readonly loading: boolean;
  readonly refusal: string | undefined;
  readonly reread: () => void;
}

/**
 * What the range costs, per type, for the party the guest entered.
 *
 * A null range is not a pending read: the guest is still on the calendar, so
 * this answers no offers and no loading rather than a spinner nobody asked for.
 */
export function useStayOffers(
  range: StayRange | null,
  party: Party,
  plan: RatePlanCode,
): OffersRead {
  const [offers, setOffers] = useState<readonly RoomTypeOffer[]>(NO_OFFERS);
  const [loading, setLoading] = useState(range !== null);
  const [refusal, setRefusal] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const reread = useCallback(() => {
    setRefusal(undefined);
    setAttempt((count) => count + 1);
  }, []);

  // What the search actually asks, as one string. The screen rebuilds its range
  // and its party every time the URL changes at all — including the step, which
  // changes on every press of Continue and Change dates — so depending on those
  // objects would re-price identical nights each way through the funnel.
  const query =
    range === null
      ? null
      : [
          range.checkIn.toString(),
          range.checkOut.toString(),
          plan,
          party.adults,
          party.children.map((child) => child.age).join("-"),
        ].join("|");

  // Read through a ref so the effect can depend on the question rather than on
  // the objects that spell it. The latest render's values are always the ones
  // the key was computed from.
  const asked = useRef({ range, party, plan });
  asked.current = { range, party, plan };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the whole of what the API is asked, and `asked` is the ref carrying the values it was built from — listing the range and the party as well would re-fetch on a step change that asks the same question. `attempt` is what `reread` increments to run this again.
  useEffect(() => {
    const wanted = asked.current.range;

    if (query === null || wanted === null) {
      setOffers(NO_OFFERS);
      setRefusal(undefined);
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    // The range travels as an argument rather than as a closed-over value: it is
    // the one the key was built from, and a hoisted function reads the wider
    // `StayRange | null` the ref is typed as. The party and the plan are read
    // from the ref beside it, so all three describe one question.
    async function ask(wantedRange: StayRange): Promise<void> {
      try {
        const priced = await readStayOffers(
          wantedRange,
          asked.current.party,
          asked.current.plan,
        );

        if (!live) {
          return;
        }

        setOffers(priced);
        setRefusal(undefined);
        setLoading(false);
      } catch (error) {
        if (!live) {
          return;
        }

        // Cleared, for the reason the calendar clears its window: an offer
        // priced for dates the guest has since changed is a number they would
        // press Choose on.
        setOffers(NO_OFFERS);
        setRefusal(apiMessage(error, AVAILABILITY_MESSAGES.offers));
        setLoading(false);
      }
    }

    void ask(wanted);

    return () => {
      live = false;
    };
  }, [query, attempt]);

  return { offers, loading, refusal, reread };
}
