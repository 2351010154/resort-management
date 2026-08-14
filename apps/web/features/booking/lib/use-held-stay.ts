"use client";

// Reading the stay a funnel url names, with the two answers a screen has to
// tell apart: still loading, and refused.
//
// Every screen after the hold starts here rather than from anything it was
// handed by the step before, which is what `repository-structure.md` §`(booking)`
// means by back and refresh being deterministic. A hold can expire while a guest
// is reading the page, and a screen rendering from a value it captured on the
// way in would keep offering to collect for a stay that no longer exists.
//
// **A `NOT_FOUND` is not an error state here, it is a fact about the stay.** The
// API answers the same 404 for a stay that is not the caller's and for one that
// is not there — `booking.service.ts` says why, and it is so that the id space
// cannot be walked. So the screens say "this stay is not yours to pay for"
// rather than guessing which of the two happened.
//
// The poll exists for one screen. `confirming/` waits for the gateway's callback
// to land, which arrives at the API rather than at the browser, so the only way
// the page learns of it is by asking again.
//
// **Reading a hold is also what keeps it.** A held room used to stay off the
// shelf for its whole TTL whether or not anybody was still on the page, so this
// hook is where the funnel says otherwise — `use-hold-presence.ts` owns the
// saying, and it lives behind this one so that "the funnel is open on a live
// hold" is a fact about reading a stay rather than three screens each
// remembering to announce themselves.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiMessage } from "@/lib/api";
import { type HeldStay, isSettled, readStay } from "./stay-funnel";
import { useHoldPresence } from "./use-hold-presence";

/** How often `confirming/` asks again while it waits for the callback. */
const POLL_INTERVAL_MS = 2_000;

/**
 * How long it waits before saying so.
 *
 * Not a timeout on the payment — the IPN is the authority and it arrives when it
 * arrives, retried by the gateway until this property acknowledges it. This is
 * only how long the *screen* keeps asking before it stops spinning and tells the
 * guest where their stay is, which it can do because the reference is already
 * on the page.
 */
const POLL_CEILING_MS = 90_000;

export interface StayRead {
  readonly stay: HeldStay | undefined;
  /** Nothing has come back yet — neither the stay nor a refusal. */
  readonly loading: boolean;
  /** Why it could not be read, in the API's own words. */
  readonly refusal: string | undefined;
  /** True once the poll has stopped asking without the stay settling. */
  readonly gaveUp: boolean;
  /** Ask again now, for a screen with a button that offers to. */
  readonly reread: () => void;
}

/**
 * The stay behind a funnel url.
 *
 * `until` is what turns the read into a poll: while it answers false the hook
 * keeps asking, and it stops the moment it answers true. A screen that only
 * needs the stay once passes nothing and gets one read.
 */
export function useHeldStay(
  bookingId: string,
  until?: (stay: HeldStay) => boolean,
): StayRead {
  const [stay, setStay] = useState<HeldStay>();
  const [loading, setLoading] = useState(true);
  const [refusal, setRefusal] = useState<string>();
  const [gaveUp, setGaveUp] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Held in a ref so that a caller passing an inline arrow — which every one of
  // them does — does not restart the poll on each render. What the predicate
  // reads is the stay it is handed, so the latest one is always the right one.
  const settled = useRef(until);
  settled.current = until;

  const reread = useCallback(() => {
    setRefusal(undefined);
    setGaveUp(false);
    setLoading(true);
    setAttempt((count) => count + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is not read in here, and that is exactly its job — it is what `reread` increments to start the effect again. Removing it would leave the retry button setting three pieces of state and asking the API nothing.
  useEffect(() => {
    // The effect owns the loop and the cancellation together. A stay read that
    // resolves after the guest has navigated away must not write to a component
    // that is gone, and a poll must not outlive the screen that started it.
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const startedAt = Date.now();

    async function ask(): Promise<void> {
      try {
        const answer = await readStay(bookingId);

        if (!live) {
          return;
        }

        setStay(answer);
        setLoading(false);

        if (!settled.current || settled.current(answer)) {
          return;
        }

        if (Date.now() - startedAt >= POLL_CEILING_MS) {
          setGaveUp(true);
          return;
        }

        timer = setTimeout(ask, POLL_INTERVAL_MS);
      } catch (error) {
        if (!live) {
          return;
        }

        // The poll stops on a refusal rather than retrying it. A 404 here does
        // not become a 200 by being asked again, and a screen that kept asking
        // would turn one wrong id into a request every two seconds forever.
        setRefusal(
          apiMessage(
            error,
            "That stay could not be read just now. Check your connection and try again.",
          ),
        );
        setLoading(false);
      }
    }

    void ask();

    return () => {
      live = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [bookingId, attempt]);

  // Every screen that reads a hold also keeps it alive, and it happens here so
  // that no screen has to remember to — `use-hold-presence.ts` argues why that is
  // the whole rule rather than a habit three components share. It runs only while
  // there is a hold to keep: until the first read answers there is nothing to say
  // anything about, and once the stay is paid for or released there is no
  // deadline left for presence to bring forward.
  useHoldPresence(bookingId, stay !== undefined && !isSettled(stay));

  return { stay, loading, refusal, gaveUp, reread };
}
