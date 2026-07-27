"use client";

// `/booking` — pick dates and guests, see what is free, choose a room type.
//
// One search band, one list, one summary. No third region.
//
// The screen holds no search state of its own. Everything a guest answers is
// written to the URL and read back from it, per `repository-structure.md`: this
// route is stateless, so it is shareable, a marketing link can land straight on a
// date range, and back and refresh work without being implemented. The only local
// state is which room they have picked, because that belongs to the *next* step and
// becomes a hold id in the path.

import type { RoomTypeCode, StayRange } from "@mariva/shared";
import { I18nProvider } from "@react-aria/i18n";
import { domAnimation, LazyMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  readBookingSearch,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";
import { alternatives } from "@/features/booking/lib/nearest-availability";
import {
  monthOfNights,
  propertyToday,
  roomRateTable,
  soldOutTypes,
  TARIFF_RATES,
} from "@/features/booking/lib/rate-calendar-fixture";
import {
  indexNights,
  nightsInRange,
  type Party,
  partySize,
  quoteStay,
  stayNights,
} from "@/features/booking/lib/stay-quote";
import { NoAvailability } from "./no-availability/no-availability";
import { RoomTypeList } from "./room-type-list/room-type-list";
import { SearchBand } from "./search-band/search-band";
import { SummaryBar } from "./summary-bar/summary-bar";
import styles from "./booking-screen.module.css";

/**
 * Days of calendar to price at once.
 *
 * Four months: the two on screen plus two ahead, so the nearest-free-dates search
 * has somewhere to look and paging forward does not wait on anything. Every night
 * in it is 31 numbers per plan, not 155 — the calendar shows the lowest price
 * across all five types, which is what keeps the payload the size of a month.
 */
const PRICED_DAYS = 124;

export function BookingScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const search = useMemo(
    () => readBookingSearch(new URLSearchParams(params.toString())),
    [params],
  );

  const [chosen, setChosen] = useState<RoomTypeCode | null>(null);
  const [nextStep, setNextStep] = useState<string | null>(null);

  // Today in the property's zone, never the browser's. A guest in Seoul at 00:30
  // is on tomorrow's date; offering them a night the property considers past would
  // fail at the API and look like a bug on the screen.
  const minDate = useMemo(() => propertyToday(), []);

  const nights = useMemo(
    () => indexNights(monthOfNights(minDate, PRICED_DAYS, search.plan)),
    [minDate, search.plan],
  );

  const stayLength = search.range ? stayNights(search.range) : 0;

  const offers = useMemo(() => {
    if (!search.range) return [];

    const rangeNights = nightsInRange(search.range);
    return quoteStay({
      range: search.range,
      party: search.party,
      plan: search.plan,
      rates: TARIFF_RATES,
      roomRates: roomRateTable(rangeNights),
      nights,
      soldOutTypes: soldOutTypes(rangeNights),
    });
  }, [search.range, search.party, search.plan, nights]);

  // Every control goes through here, so there is one writer to the URL. `replace`
  // rather than `push`: changing a date is refining one search, not navigating, and
  // pushing would make the back button walk every keystroke of a party size.
  const commit = useCallback(
    (next: Partial<typeof search>) => {
      const merged = { ...search, ...next };
      router.replace(`/booking${writeBookingSearch(merged)}`, {
        scroll: false,
      });
    },
    [router, search],
  );

  const onRangeChange = useCallback(
    (range: StayRange | null) => {
      // A new range invalidates the room already picked: the price it was picked at
      // no longer exists. Silently keeping it is how a guest continues to a step
      // quoting a different number than the one they agreed to.
      setChosen(null);
      commit({ range });
    },
    [commit],
  );

  const onPartyChange = useCallback(
    (party: Party) => {
      setChosen(null);
      commit({ party });
    },
    [commit],
  );

  const fitsNobody =
    search.range !== null &&
    offers.length > 0 &&
    offers.every((offer) => !offer.isAvailable);

  const chosenOffer = offers.find((offer) => offer.code === chosen) ?? null;

  return (
    // Two providers, and each one is a decision about weight.
    //
    // `LazyMotion` with `domAnimation`, and the `m` component at every call site
    // instead of `motion.*`. `motion.div` bundles every feature Motion has — layout
    // projection, drag, scroll, SVG path morphing — because the component cannot
    // know which a page will use. This funnel animates opacity and transform and
    // nothing else. `strict` makes that enforceable: a `motion.*` component
    // anywhere inside throws rather than quietly pulling the full bundle back in.
    //
    // `I18nProvider` with a stated locale, not the browser's. `useLocale` otherwise
    // reads `navigator.language`, which decides the first day of the week and how a
    // date is spelled — so the same range renders as a different grid on two
    // guests' phones and a visual baseline could never be stable. en-GB starts the
    // week on Monday and writes "10 August 2026", which is what the copy assumes.
    <LazyMotion features={domAnimation} strict>
      <I18nProvider locale="en-GB">
        <main className={styles.screen}>
          <header className={styles.head}>
            <h1 className={`${styles.title} font-display`}>Your stay</h1>
            <p className={styles.subtitle}>
              Choose the nights you are here, and the room you would like.
              Prices include VAT and service.
            </p>
          </header>

          <SearchBand
            minDate={minDate}
            nights={nights}
            onPartyChange={onPartyChange}
            onPlanChange={(plan) => {
              setChosen(null);
              commit({ plan });
            }}
            onRangeChange={onRangeChange}
            party={search.party}
            plan={search.plan}
            range={search.range}
          />

          <div className={styles.results}>
            {fitsNobody && search.range ? (
              // Nothing free at all. The list is replaced rather than shown empty,
              // because five cards each saying "not free" is a wall, not an answer.
              <NoAvailability
                alternatives={alternatives(nights, search.range, stayLength)}
                onPick={onRangeChange}
                party={search.party}
                requested={search.range}
              />
            ) : (
              // Partly free is the common case with five types and forty rooms,
              // and it is handled inside the list: a sold-out type keeps its
              // position and says so where its price was.
              <RoomTypeList
                chosen={chosen}
                nights={stayLength}
                offers={offers}
                onChoose={setChosen}
                party={search.party}
                range={search.range}
              />
            )}
          </div>

          {/* Where the funnel stops today, said out loud.
              `Continue` should post to the booking module, take a hold, and route
              to `/booking/<hold>/details`. That module is M7 and none of it exists
              — so the button reports the truth rather than navigating to a 404 or,
              worse, appearing to hold a room it has not held. */}
          {nextStep ? (
            <p className={styles.nextStep} role="status">
              {nextStep}
            </p>
          ) : null}

          <SummaryBar
            guests={partySize(search.party)}
            nights={stayLength}
            offer={chosenOffer}
            onContinue={() =>
              setNextStep(
                "Your room is chosen. The next step opens when payments are connected — nothing is held and nothing is charged yet.",
              )
            }
          />

          {/* The bar is fixed, so the last card needs room to clear it. */}
          {chosenOffer ? <div className={styles.barSpacer} /> : null}
        </main>
      </I18nProvider>
    </LazyMotion>
  );
}
