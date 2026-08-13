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
// **The dates step ends with the stay written down.** Round 2 answered the
// guest's second date press by replacing the entire screen with a price list,
// with no moment in between where what they had just chosen was stated back. So
// a complete range now opens the stay panel beside the calendar — one animated
// property, see `dates-stage.module.css` — and the guest presses on from there.
// The calendar stays mounted and selectable throughout, because the likeliest
// response to reading your dates back is to change one of them.
//
// That panel is **not** a third view, and `booking-view.ts` says why: it is the
// same screen wider, so it must not change the key `AnimatePresence` swaps on, or
// the calendar would be rebuilt under a guest who had only just finished using it.
//
// **The two steps no longer share a frame, and this file no longer holds one.**
// It held a bar, a step rail and a two-column stage that both views were poured
// into. Each step composes itself now — `dates-stage.tsx` and the block below —
// and what stays here is what belongs to neither: the search, the quote, and the
// three things that outlive a step swap.
//
// Both steps stand on a photograph, and that is the point rather than a
// coincidence: the dates step's head stands on a picture of the property with
// the calendar laid over its bottom edge, and the room step's picture *is* the
// room, edge to edge, with the list and the price laid on it. What they do not
// share is a geometry — one is a band with a plate under it and a foot below
// both, the other is a window with plates in its corners — and a frame that had
// to be either would be a frame with a `step` running through every rule in it.
//
// **Which view is open is derived, never stored.** It follows from what the URL
// holds — a complete range, and the step that range is at. A `useState` beside
// the URL is a second source of truth that can disagree with the address bar, and
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
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  plateMotion,
  stepMotion,
  stillMotion,
  stillPlateMotion,
  viewMotion,
} from "@/features/booking/lib/booking-motion";
import {
  readBookingSearch,
  writeBookingSearch,
} from "@/features/booking/lib/booking-search";
import {
  bookingView,
  isStayPanelOpen,
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
  isContactAnswered,
  NO_CONTACT,
  type StayContact,
  holdStay,
} from "@/features/booking/lib/stay-funnel";
import {
  indexNights,
  nightsInRange,
  type Party,
  partitionRoomTypes,
  quoteStay,
  stayNights,
} from "@/features/booking/lib/stay-quote";
import { apiMessage } from "@/lib/api";
import styles from "./booking-screen.module.css";
import { ConciergeNote } from "./concierge-note/concierge-note";
import { DatesStage } from "./dates-stage/dates-stage";
import { FunnelNav } from "./funnel-nav/funnel-nav";
import { NoAvailability } from "./no-availability/no-availability";
import { RoomGround } from "./room-ground/room-ground";
import { RoomStage } from "./room-stage/room-stage";
import { RoomsView } from "./rooms-view/rooms-view";
import { StepRail } from "./step-rail/step-rail";

/**
 * How far ahead the property sells, in nights from today.
 *
 * **It is the calendar's bound as well as the price window, and that is the
 * point.** This was four months — the two months on screen plus two ahead, sized
 * for the nearest-free-dates search — while nothing stopped the guest paging the
 * grid past it. Four presses forward drew a normal-looking calendar in which
 * every night was unpriced and therefore every cell refused the press, with
 * nothing on the screen saying why. A window the guest can leave is not a window.
 *
 * So it is a year, which is the window a hotel takes bookings in, and
 * `maxDate` below hands the same figure to the grid so the pager stops where the
 * property does. Every night in it is 31 numbers per plan, not 155 — the calendar
 * shows the lowest price across all five types, which is what keeps a year of
 * nights the size of a few months of anything else.
 */
const BOOKING_HORIZON_DAYS = 365;

export function BookingScreen() {
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const search = useMemo(
    () => readBookingSearch(new URLSearchParams(params.toString())),
    [params],
  );

  const [picked, setPicked] = useState<RoomTypeCode | null>(null);
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  /**
   * Who the confirmation goes to — state of this visit, and deliberately not of
   * the URL.
   *
   * Everything the guest answers about the *stay* is a search param, because
   * `/booking` is stateless and shareable. An address and a name are neither:
   * they belong to the person at the keyboard rather than to the search, and a
   * link that carried them would put a guest's own details into anything they
   * forwarded to somebody else.
   */
  const [contact, setContact] = useState<StayContact>(NO_CONTACT);
  const router = useRouter();

  /**
   * Takes the hold and leaves for the next step.
   *
   * **The range is checked rather than asserted**, even though the button that
   * calls this is only rendered once a room is staged and a room cannot be
   * staged without one. The alternative is a non-null assertion on a value that
   * comes out of the URL, which is to say out of anything a guest may type.
   *
   * **A press while one is in flight is dropped.** A hold consumes the nights,
   * so two presses are two stays on one guest's account for the same room —
   * and the second would be the one the funnel navigated to, leaving the first
   * to expire quietly against inventory nobody could sell in the meantime.
   *
   * **An unanswered contact pair is refused here rather than at the API.** The
   * refusal would be identical either way; what differs is that this one costs
   * no round trip and lands on the line the guest is already reading, where a
   * 400 arriving a second later reads as the property having gone wrong.
   */
  async function takeHold(roomType: RoomTypeCode): Promise<void> {
    if (holding || !search.range) {
      return;
    }

    if (!isContactAnswered(contact)) {
      setNextStep(
        "We need an email address and a name to hold the room — that is where the confirmation goes.",
      );
      return;
    }

    setHolding(true);
    setNextStep(null);

    try {
      const stay = await holdStay({
        roomType,
        checkIn: search.range.checkIn,
        checkOut: search.range.checkOut,
        plan: search.plan,
        adults: search.party.adults,
        childAges: search.party.children.map((child) => child.age),
        contact,
      });

      router.push(`/booking/${stay.id}/details`);
    } catch (error) {
      setHolding(false);
      setNextStep(
        apiMessage(
          error,
          "The room could not be held just now. Nothing has been charged — try again in a moment.",
        ),
      );
    }
  }

  // Today in the property's zone, never the browser's. A guest in Seoul at 00:30
  // is on tomorrow's date; offering them a night the property considers past would
  // fail at the API and look like a bug on the screen.
  const minDate = useMemo(() => propertyToday(), []);

  // The morning after the last night that can be sold, which is a day past the
  // last night priced: a departure buys no night, so the guest must be able to
  // leave on it. As an *arrival* it is still refused — there is no rate for it —
  // and `stay-availability.ts` answers both questions from the same index.
  const maxDate = useMemo(
    () => minDate.add({ days: BOOKING_HORIZON_DAYS }),
    [minDate],
  );

  const nights = useMemo(
    () =>
      indexNights(monthOfNights(minDate, BOOKING_HORIZON_DAYS, search.plan)),
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
      setPicked(null);
      // And it puts the guest back on the dates step, which is where they are
      // standing anyway — the calendar is only on screen there. Written out
      // rather than left to merge, because the one caller that changes a range
      // from the room step is `NoAvailability`, and it says the opposite below.
      commit({ range, step: "dates" });
    },
    [commit],
  );

  const onPartyChange = useCallback(
    (party: Party) => {
      setPicked(null);
      commit({ party });
    },
    [commit],
  );

  // Forward, to the rooms. The range and the party are already in the URL; this
  // press only says the guest has read them.
  //
  // The scroll reset is not cosmetic. The guest may have pressed this from the
  // foot of a two-month calendar, and the room list mounting under that offset
  // would open at its third card. `rooms-view.tsx` restores a remembered offset
  // and there is none to restore going forward, so the top is the answer.
  const onContinue = useCallback(() => {
    window.scrollTo(0, 0);
    commit({ step: "rooms" });
  }, [commit]);

  // Back to the dates, **keeping them**. This used to clear the range, because
  // clearing it was the only way to reopen the calendar; the step param means
  // going back can now show the guest what they chose, in the panel, with the
  // grid beside it. Where they had scrolled to in the list is put aside first —
  // the list is about to be unmounted, so this is the last moment its offset
  // exists anywhere.
  const onChangeDates = useCallback(() => {
    rememberRoomsScroll(window.scrollY);
    window.scrollTo(0, 0);
    commit({ step: "dates" });
  }, [commit]);

  // An alternative range offered when nothing was free, and the **one** range
  // change that does not go back to the calendar. The guest asked "what is free
  // near these dates" and pressed one of the answers; sending them to the date
  // step to press the same thing again would be a step backwards for a decision
  // they have already made.
  const onPickAlternative = useCallback(
    (range: StayRange) => {
      setPicked(null);
      commit({ range, step: "rooms" });
    },
    [commit],
  );

  const view = bookingView(search.range, search.step);
  const panelOpen = isStayPanelOpen(search.range, search.step);

  // What the guest can take, and what they cannot. Derived once here rather than
  // twice, because the screen and the list both need the same answer: the list
  // to draw it, and the screen to notice when there is nothing left to draw.
  const partition = useMemo(
    () => partitionRoomTypes(offers, search.party),
    [offers, search.party],
  );

  // Which room is on the stage — **derived, so it cannot be wrong.**
  //
  // The room is the ground of the screen and it is never empty: the guest
  // arrives on the first room the list can offer and moves along it from there.
  // That leaves one way for the state to go stale — a room picked and then
  // priced out by a change of dates or party — and this is why the answer is
  // computed rather than stored. `setPicked(null)` is already called on both of
  // those changes; this is the second line of defence, and it means no effect
  // anywhere has to keep a `useState` in step with a list that re-derives on
  // every render.
  //
  // The first room is the smallest and the cheapest, which is the only default
  // that cannot be read as the screen selling to the guest.
  const selected =
    partition.takeable.find((type) => type.code === picked)?.code ??
    partition.takeable[0]?.code ??
    null;
  const selectedOffer = offers.find((offer) => offer.code === selected) ?? null;
  const selectedType = selected ? roomType(selected) : null;

  // **The dates step returns here, before the room step's frame is built.**
  //
  // It used to be a view poured into the same two-column stage as the room list,
  // under the same bar and the same step rail. It is not that any more: it opens
  // on a photograph of the property with its head standing on the picture and a
  // plate laid over the picture's bottom edge, and its bands are sized to that
  // — a hero with a card under it and the small print below both, against the
  // room step's window full of plates. A frame that had to be either would be a
  // frame with a `step` running through every rule in it.
  //
  // So the two steps compose themselves and share the search rather than a
  // layout — `dates-stage.tsx` is the whole of this one. **The cost was the
  // crossfade between them**, which had been `AnimatePresence` swapping one view
  // inside a frame that stayed put. There is no frame that stays put now, and a
  // page that dissolves into a different page is a transition pretending two
  // compositions are one — so the step swap was a cut.
  //
  // **It is no longer a cut, and the paragraph above is still true.** What was
  // wrong with the cut was never that it failed to dissolve; it is that it gave
  // the guest no beat at all between two full-window compositions that share no
  // element, which reads as the screen being replaced out from under the press
  // rather than as an answer to it. What is here instead is not a crossfade and
  // must not become one: the outgoing step fades to the screen's own ground and
  // is *unmounted*, and only then is the next one built and its plates raised
  // into place. At no frame are both compositions on screen, which is the
  // property the cut was protecting. See `stepMotion`.
  //
  // `LazyMotion` used to be absent on this branch, because nothing under it was
  // a Motion component. The step's own arrival is one, so the provider moved up
  // to wrap both branches — `strict` still holds, and the one thing that travels
  // inside the step, the stay panel's column, is still a CSS transition on a
  // registered property rather than anything Motion touches.
  //
  // The `range === null` half of the test is redundant against `view` —
  // `bookingView` cannot answer "rooms" without a range — and it is written out
  // so everything below is narrowed by the compiler rather than by a non-null
  // assertion. A `!` there would be the one place this file asked to be trusted
  // about an invariant it has already stated in prose.
  // **The two steps' shared wrapper, written once and returned by both.**
  //
  // It is a function rather than two copies because the copies have to be
  // *identical* for this to work at all: React reconciles by type and position,
  // so an `AnimatePresence` at the same position in both branches is the same
  // instance across the swap, and it sees its child's key change from "dates" to
  // "rooms" rather than being torn down and rebuilt. Two hand-written wrappers
  // that drifted by one element would silently become two `AnimatePresence`
  // trees, each mounting and unmounting its own child with nothing in between —
  // which is the cut this exists to remove, back again and harder to see.
  //
  // `mode="wait"` is the whole shape of the swap: the outgoing step fades to the
  // screen's ground and is unmounted *before* the incoming one is built. That
  // matters beyond taste — the two steps have different scroll behaviour and
  // different palettes on the same bar, and a frame with both mounted would be a
  // frame with two `<h1>`s in it.
  //
  // `initial={false}`, so a guest arriving on a link does not watch the funnel
  // fade in over the content already arriving inside it.
  //
  // `LazyMotion` now wraps both branches, where it used to wrap only the rooms.
  // The dates step has a Motion component at its root as of the step swap, and
  // `strict` keeps the rule that made it cheap: `m` everywhere, never `motion.*`.
  const funnel = (step: ReactNode) => (
    <LazyMotion features={domAnimation} strict>
      {/* `I18nProvider` with a stated locale, not the browser's. `useLocale`
          otherwise reads `navigator.language`, which decides the first day of the
          week and how a date is spelled — so the same range renders as a
          different grid on two guests' phones and a visual baseline could never
          be stable. en-GB starts the week on Monday and writes "10 August 2026",
          which is what the copy assumes. */}
      <I18nProvider locale="en-GB">
        <AnimatePresence initial={false} mode="wait">
          {step}
        </AnimatePresence>
      </I18nProvider>
    </LazyMotion>
  );

  if (view === "when" || search.range === null) {
    return funnel(
      <m.main
        animate="animate"
        className={styles.screen}
        exit="exit"
        initial="initial"
        key="dates"
        variants={reduced ? stillMotion : stepMotion}
      >
        <DatesStage
          maxDate={maxDate}
          minDate={minDate}
          nights={nights}
          onContinue={onContinue}
          onPartyChange={onPartyChange}
          onRangeChange={onRangeChange}
          panelOpen={panelOpen}
          party={search.party}
          range={search.range}
          stayLength={stayLength}
        />
      </m.main>,
    );
  }

  // The room step and its own empty state. Built as a value rather than nested in
  // the tree below, because a ternary in JSX is the shape that hides a case.
  //
  // The heading is inside the branch rather than above it: the empty state
  // carries its own — `no-availability.tsx` states the fact in one sentence, and
  // a generic title above that sentence would be a heading contradicting the page
  // under it — and the rooms view's heading is the first line of a rail beside
  // the list rather than a banner over it (`rooms-view.tsx`). One `<h1>` either
  // way, which is the property that matters.
  let content: ReactNode;
  if (offers.length > 0 && partition.takeable.length === 0) {
    // Nothing the guest can take — sold out, too small, or some of each. The
    // view is replaced rather than shown as eight caps-labelled lines of what
    // they cannot have, which is a wall and not an answer.
    content = (
      <NoAvailability
        alternatives={alternatives(nights, search.range, stayLength)}
        onPick={onPickAlternative}
        party={search.party}
        requested={search.range}
      />
    );
  } else {
    content = (
      <RoomsView
        offers={offers}
        onChangeDates={onChangeDates}
        onSelect={setPicked}
        partition={partition}
        party={search.party}
        range={search.range}
        selected={selected}
      />
    );
  }

  // Whether there is a room to put on the stage at all.
  //
  // `selectedType` rather than the step is the test, and the difference is the
  // empty state: this branch is also where a range with nothing takeable in it
  // lands, and `NoAvailability` wants the whole width with no plate beside it.
  const staged = selectedType !== null && selectedOffer !== null;

  return funnel(
    // `data-panel` is the whole state machine as far as the stylesheet is
    // concerned, and it is on the screen rather than on a plate because every
    // plate's ground, palette and place in the grid answer to it — including the
    // bar's, which is ivory over the photograph and ink without one.
    //
    // The variants here are the step's own arrival and departure; the two plates
    // below carry the rise, staggered by this element. See `stepMotion`.
    <m.main
      animate="animate"
      className={styles.screen}
      data-panel={staged ? "rooms" : "shut"}
      exit="exit"
      initial="initial"
      key="rooms"
      variants={reduced ? stillMotion : stepMotion}
    >
      <div className={styles.frame}>
        {/* The bar, over the photograph. It used to span the window from
            `page.tsx`, then moved inside the list's column so its wordmark
            landed on the heading's vertical. The column has become a plate
            laid on a picture, and a bar inside a plate is a header on a
            card — so it is back to the width of the window, standing on the
            room, on the same margin every plate below it stands on. */}
        <FunnelNav />

        {/* The room, edge to edge, behind everything.
            **Not keyed by the room, and that is the fix rather than an
            oversight.** It was, so that changing rooms would reset the walk to
            the new room's lead — and a key change is a remount, which took the
            outgoing photograph out of the DOM in the same frame the incoming one
            arrived and turned the largest element on the screen into a cut. The
            reset is `room-ground.tsx`'s own now, the component stays mounted for
            the life of the step, and both ways of changing the picture — walking
            frames, and picking another room — go through one dissolve. */}
        {selectedType === null ? null : <RoomGround type={selectedType} />}

        <div className={styles.plates}>
          {/* The list plate: where the guest is, what they answered, the
              five rooms, and a person if none of it helped.

              A plate of the arriving step, so it rises rather than appearing —
              and it is the first of the two, because it is where the guest is
              reading. */}
          <m.div
            className={styles.rail}
            variants={reduced ? stillPlateMotion : plateMotion}
          >
            <StepRail current={view} onBack={onChangeDates} />

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

            <ConciergeNote />
          </m.div>

          {/* What the property says about the room, and what it costs.
              Absent rather than clipped when there is nothing to stage: the
              plates are placed in a grid the empty state re-lays anyway, so
              there is no column left holding zero pixels of tab order —
              which is what `inert` was guarding against while the stage was
              a collapsing track.

              **Two jobs, and neither of them may put a box between this element
              and the plate.** This element arrives with the step — the second of
              the stagger, and transform only. The *room inside it* being
              replaced, which is what happens every time a guest presses another
              row, is `room-stage.tsx`'s own fade, on its own root.

              An earlier cut put that fade on a wrapper here, and it cost two
              things at once: the plate the peek fades is this element, and
              Motion writes what it animates to the inline style, which beats the
              stylesheet — so a wrapper carrying `opacity: 1` sat between the
              hidden plate and the room and reported itself as visible. That is
              also exactly what `check-booking-screen.mjs` reads, by walking up
              one level from `[data-room-stage]`. One div in the wrong place
              broke a composition rule and the check that guards it. */}
          {selectedType && selectedOffer ? (
            <m.div
              className={styles.stage}
              variants={reduced ? stillPlateMotion : plateMotion}
            >
              <AnimatePresence initial={false} mode="wait">
                {/* Where the funnel leaves the URL behind. Pressing this takes
                    a hold — `FR-BOOK-02`'s door, the one the funnel is given —
                    and routes to `/booking/<hold>/details`. From here on the
                    stay is a record with a TTL running against it rather than a
                    search anybody can share, which is exactly why the id goes
                    in the path and the steps stop being search params.

                    **No sign-in stands in front of it.** `booking.create-own`
                    is a public row — a visitor books before they have an
                    account, not after — so what the door asks for is an address
                    to send the confirmation to and a name to put on it, which
                    is the pair collected beside the button. The account, if the
                    guest ever wants one, is offered after the money has landed.

                    The line under the button is what went wrong, when something
                    does, including the unanswered pair. */}
                <RoomStage
                  contact={contact}
                  holding={holding}
                  key={selectedType.code}
                  nights={stayLength}
                  note={nextStep}
                  offer={selectedOffer}
                  onContactChange={setContact}
                  onContinue={() => void takeHold(selectedType.code)}
                  plan={search.plan}
                  type={selectedType}
                />
              </AnimatePresence>
            </m.div>
          ) : null}
        </div>
      </div>
    </m.main>,
  );
}
