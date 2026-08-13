"use client";

// Keeping a hold alive while the guest is on it, and giving it back when they
// are not.
//
// **The room comes off the shelf the moment it is picked, and used to stay off
// for the whole TTL.** A guest who closed the tab thirty seconds into a
// ten-minute hold cost the property the other nine and a half — and on a busy
// night that is the room the next guest is turned away from. So the funnel says
// it is still open every twenty seconds and the API releases a hold at the
// earlier of its TTL and a grace after the last of those arrived.
//
// **It is not a per-screen rule and this is not a per-screen hook.** It runs
// wherever the funnel is standing on a live hold, which is why `use-held-stay.ts`
// calls it rather than each of the three screens remembering to. There is nothing
// to keep alive on `/booking` itself: the hold is taken as the guest *leaves* the
// room list, so while they are browsing rooms no room is held.
//
// **It stops the moment the stay stops being a hold.** A stay that has been paid
// for or called off has no deadline this could bring forward, and a page that
// went on pinging one would be a timer running for nothing on the confirmation
// screen.
//
// **Nothing it does is reported to the guest.** A ping that fails is presence not
// recorded, and the grace is generous against the interval precisely so a handful
// of them can go missing without costing anybody a room. A line on the screen
// saying "we could not tell the property you are here" would be an alarm about a
// mechanism the guest never agreed to think about.

import { useEffect } from "react";
import { markDeparture, markPresence } from "./stay-funnel";

/**
 * How often the funnel says it is still open.
 *
 * Twenty seconds against a grace of two minutes, so four consecutive failures —
 * a lift, a tunnel, a lock screen, a phone changing networks — are still inside
 * the grace. Tightening this to reclaim rooms faster is the wrong lever: the
 * grace is the one the property configures, and this only decides how much of it
 * is spent on a single missed request.
 */
const PING_INTERVAL_MS = 20_000;

/**
 * Says the guest is still on this hold, for as long as the screen is open.
 *
 * `alive` is what turns it on: a screen that has not read its stay yet, or whose
 * stay has been paid for or released, passes false and nothing is sent. It is a
 * flag rather than the stay itself because this hook has no business reading a
 * booking — what it needs is an id and whether there is still a hold behind it.
 */
export function useHoldPresence(bookingId: string, alive: boolean): void {
  useEffect(() => {
    if (!alive) {
      return;
    }

    // The effect owns the timer, the listeners and their removal together — the
    // rule `use-held-stay.ts` states about its own poll, and it matters more
    // here: a ping that outlived its screen would keep a room held for a guest
    // who has already left it, which is precisely the thing this exists to stop.
    let live = true;

    // Fired and forgotten. Every rejection this can produce is one the grace
    // already absorbs — a refused rate limit, a stay that has just been
    // confirmed, a network that was not there — and a rejected promise nobody
    // catches is an unhandled rejection in the console of a guest who is trying
    // to book a room.
    const announce = () => {
      if (live) {
        void markPresence(bookingId).catch(() => undefined);
      }
    };

    // Said once on arrival rather than only on the first tick. A guest who has
    // just reloaded the page has told the API on the way out that they were
    // leaving, and waiting a full interval to take that back would leave the
    // hold due for the length of the reload.
    announce();

    const timer = window.setInterval(announce, PING_INTERVAL_MS);

    // A backgrounded tab has its timers throttled to about once a minute, so a
    // guest who switches apps and comes back is several intervals behind the
    // moment they return. Announcing on the way back in is what makes the
    // returning guest current immediately instead of at the next tick — the same
    // reason `hold-timer.tsx` recomputes here rather than trusting its interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        announce();
      }
    };

    // The tab going away. `pagehide` rather than `beforeunload`, which is not
    // fired at all on a mobile browser killing a backgrounded tab and which
    // exists to ask a question this page has no business asking.
    const onLeaving = () => markDeparture(bookingId);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeaving);

    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeaving);
    };
  }, [bookingId, alive]);
}
