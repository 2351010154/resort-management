"use client";

// `/booking` — two questions, in order: when, then which room.
//
// **Only one of them is ever mounted.** Round 1 asked both at once: the calendar
// opened on arrival and five room cards sat under it, each of them saying
// "Choose your dates for prices." The band collapsing to a summary was never the
// problem — the list never left. So the screen is two views now, and the
// inactive one is not in the DOM. Not hidden, not collapsed, not `inert`:
// unmounted, which is how "one open decision at a time" is guaranteed by the
// tree rather than by CSS discipline nobody can enforce.
//
// **Which view is open is derived, never stored.** It follows from whether the
// URL holds a complete range — see `booking-view.ts`. A `useState` beside the
// URL is a second source of truth that can disagree with the address bar, and
// this screen was designed to be incapable of that.
//
// The screen still holds no search state of its own. Everything a guest answers
// is written to the URL and read back from it, per `repository-structure.md`:
// this route is stateless, so it is shareable, a marketing link can land
// straight on a date range, and back and refresh work without being implemented.
// The two pieces of local state belong to *this* visit and to nothing else —
// which room is picked, and which room is being looked at.
//
// **The rate plan is no longer chosen here.** `/booking` quotes `STANDARD`; the
// choice, its three cancellation sentences and the live re-pricing of five cards
// move to `/details`, where the guest is already reading terms. The `plan`
// search param and its codec survive untouched: `/details` will write it, and a
// link carrying `plan=NONREF` must not start quoting something else. What went
// is the control, not the parameter.

import type { RoomTypeCode, StayRange } from "@mariva/shared";
import { I18nProvider } from "@react-aria/i18n";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { stillMotion, viewMotion } from "@/features/booking/lib/booking-motion";
import {
  readBookingSearch,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";
import {
  bookingView,
  rememberRoomsScroll,
} from "@/features/booking/lib/booking-view";
import { alternatives } from "@/features/booking/lib/nearest-availability";
import {
  monthOfNights,
  propertyToday,
  roomRateTable,
  soldOutTypes,
  TARIFF_RATES,
} from "@/features/booking/lib/rate-calendar-fixture";
import { roomType } from "@/features/booking/lib/room-types";
import {
  indexNights,
  nightsInRange,
  type Party,
  partitionRoomTypes,
  partySize,
  quoteStay,
  stayNights,
} from "@/features/booking/lib/stay-quote";
import styles from "./booking-screen.module.css";
import { NoAvailability } from "./no-availability/no-availability";
import { RoomSheet } from "./room-sheet/room-sheet";
import { RoomsView } from "./rooms-view/rooms-view";
import { SummaryBar } from "./summary-bar/summary-bar";
import { WhenView } from "./when-view/when-view";

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
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const search = useMemo(
    () => readBookingSearch(new URLSearchParams(params.toString())),
    [params],
  );

  const [chosen, setChosen] = useState<RoomTypeCode | null>(null);
  const [looking, setLooking] = useState<RoomTypeCode | null>(null);
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

  // Every control goes through here, so there is one writer to the URL.
  //
  // **Replacing, not pushing.** Changing a date is refining one search rather
  // than navigating, and pushing would make the back button walk every keystroke
  // of a party size.
  //
  // **`history.replaceState`, not `router.replace`** — and this one is a bug fix
  // rather than a preference. `router.replace("/booking")` from
  // `/booking?from=…&to=…` is a **no-op**: the App Router treats a href with no
  // query as the route it is already on and never updates the address bar, so
  // the search cannot be cleared. Nothing in round 1 produced an empty query, so
  // nothing surfaced it; `[Change]` produces one every time it is pressed, and
  // without this the guest presses it and the screen does not move.
  //
  // It is also the right call on its own terms. Next patches `pushState` and
  // `replaceState` so `useSearchParams` sees them, this route is static and
  // fully client-rendered, and its state *is* the query string — so a router
  // navigation would fetch an RSC payload that cannot differ, on every date
  // pressed. This writes the URL and re-renders, which is the whole job. It also
  // never scrolls, which is what `scroll: false` was asking for.
  const commit = useCallback(
    (next: Partial<typeof search>) => {
      const merged = { ...search, ...next };
      window.history.replaceState(
        null,
        "",
        `/booking${writeBookingSearch(merged)}`,
      );
    },
    [search],
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

  // Back to View A. Clearing the range is what opens it, and where the guest had
  // scrolled to is put aside first — the list is about to be unmounted, so this
  // is the last moment its offset exists anywhere.
  const onChangeDates = useCallback(() => {
    rememberRoomsScroll(window.scrollY);
    onRangeChange(null);
  }, [onRangeChange]);

  const view = bookingView(search.range);
  const chosenOffer = offers.find((offer) => offer.code === chosen) ?? null;

  // What the guest can take, and what they cannot. Derived once here rather than
  // twice, because the screen and the list both need the same answer: the list
  // to draw it, and the screen to notice when there is nothing left to draw.
  const partition = useMemo(
    () => partitionRoomTypes(offers, search.party),
    [offers, search.party],
  );

  // The room the sheet is showing, held one beat past the close.
  //
  // `looking` is the open flag and goes null the moment the guest closes the
  // sheet — but the sheet has to animate out, and a panel whose contents vanish
  // on the first frame of its own exit reads as a crash. So the last room looked
  // at is kept, and the sheet renders it until it has finished leaving.
  const lastLooked = useRef<RoomTypeCode | null>(null);
  if (looking) lastLooked.current = looking;
  const sheetCode = looking ?? lastLooked.current;
  const sheetType = sheetCode ? roomType(sheetCode) : null;
  const sheetOffer = offers.find((offer) => offer.code === sheetCode) ?? null;

  // The two views, and View B's own empty state. Built as a value rather than
  // nested in the tree below, because the branch is three-way and a nested
  // ternary in JSX is the shape that hides the third case.
  let content: ReactNode;
  if (search.range === null) {
    content = (
      <WhenView
        minDate={minDate}
        nights={nights}
        onPartyChange={onPartyChange}
        onRangeChange={onRangeChange}
        party={search.party}
        range={search.range}
      />
    );
  } else if (offers.length > 0 && partition.takeable.length === 0) {
    // Nothing the guest can take — sold out, too small, or some of each. The
    // view is replaced rather than shown as eight caps-labelled lines of what
    // they cannot have, which is a wall and not an answer.
    content = (
      <NoAvailability
        alternatives={alternatives(nights, search.range, stayLength)}
        onPick={onRangeChange}
        party={search.party}
        requested={search.range}
      />
    );
  } else {
    content = (
      <RoomsView
        chosen={chosen}
        nights={stayLength}
        offers={offers}
        onChangeDates={onChangeDates}
        onChoose={setChosen}
        onLookCloser={setLooking}
        partition={partition}
        party={search.party}
        range={search.range}
      />
    );
  }

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
          </header>

          {/* `mode="wait"` so the outgoing view is gone before the incoming one
              mounts: at no frame are both decisions in the tree. `initial={false}`
              so a guest arriving on a link does not watch the whole screen fade
              in over the room cascade that is already arriving inside it. */}
          <div className={styles.views}>
            <AnimatePresence initial={false} mode="wait">
              <m.div
                animate="animate"
                exit="exit"
                initial="initial"
                key={view}
                variants={reduced ? stillMotion : viewMotion}
              >
                {content}
              </m.div>
            </AnimatePresence>
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

          {/* Look closer. Choosing from inside it closes it, because the guest
              has answered the question the sheet was opened to answer. */}
          <RoomSheet
            isChosen={chosen === sheetCode}
            isOpen={looking !== null}
            offer={sheetOffer}
            onChoose={() => {
              if (sheetCode) setChosen(sheetCode);
              setLooking(null);
            }}
            onClose={() => setLooking(null)}
            plan={search.plan}
            type={sheetType}
          />

          {/* The bar is fixed, so the last card needs room to clear it. */}
          {chosenOffer ? <div className={styles.barSpacer} /> : null}
        </main>
      </I18nProvider>
    </LazyMotion>
  );
}
