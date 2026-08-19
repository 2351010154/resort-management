"use client";

// The stay, and the panel that can change what state it is in.
//
// **These two are composed rather than left side by side, and the reason is the
// credential.** `page.tsx` keeps the feedback panel a sibling of the screen
// because the two answer to different credentials — the stay reads with
// whatever opens the booking, and feedback is an account's statement. That
// argument does not reach this pair: the cancellation reads and writes the same
// row, with the same credential, that the screen above it is rendering. A
// writer that moves the very fact its neighbour is displaying has to be able to
// make that neighbour look again, or the page ends up saying "the property is
// expecting you" directly above "this stay is cancelled".
//
// **Re-keying rather than a message.** The screen reads its stay once, on
// mount, which is right for a screen whose whole input is a reference; teaching
// it to accept a booking from outside would make a second source of truth for
// the same row. A change of key is this repository's structural answer to that
// — the same move `page.tsx` makes on the feedback panel — and the server stays
// the authority, because what the remounted screen shows is what it reads back.
//
// The remount spends no credential. The mailed link is exchanged once for the
// whole route and stripped from the address before the exchange even answers, so
// a second mount finds an empty fragment and falls through to an ordinary read
// on the cookie the first one was issued.
//
// **And the arrival is forgotten before the screen is asked again.** An arrival
// is remembered so it is not made twice, which is right until the booking moves:
// a cancellation is the one act on this route that changes the row the arrival
// answered with, so a remounted screen that joined it would render the stay as
// it stood before the press — the "expecting you" this composition exists to
// prevent, arrived at by a shorter path.

import { Suspense, useReducer } from "react";
import { StayScreen } from "@/features/booking/components/stay-screen/stay-screen";
import {
  addressWithoutLink,
  announceArrival,
  forgetArrival,
} from "@/lib/booking-links";
import { StayCancellationPanel } from "./stay-cancellation";

/**
 * The parameter the confirmation redirect leaves behind, named here because the
 * screen reads it to decide whether to greet.
 *
 * A stay booked and then called off in the same visit still carries it, and a
 * page that kept it would greet a guest with "You are booked" over a booking
 * that no longer exists. Taken off the address rather than argued with, for the
 * reason the mailed credential is: the parameter describes an arrival, and once
 * the stay has moved it describes an arrival that is no longer what happened.
 */
const JUST_BOOKED_PARAM = "booked";

export function CancellableStay({ reference }: { readonly reference: string }) {
  const [generation, readAgain] = useReducer((count: number) => count + 1, 0);

  // **The arrival is announced here, and the reason is that this runs first.**
  // The screen below holds the credential and starts the arrival; the panel
  // below waits on it. Both do that from effects, and effects put the two in an
  // order only while they mount in the same commit — which is true of this
  // route and is true of no route by rule. Announced during this render, the
  // thing the panel waits on exists before any child of this component has run
  // at all, whatever the boundary beneath does.
  //
  // Called on every render rather than once, because this component survives a
  // change of route parameter — the panel's key says so — and the booking after
  // a change must be announced as surely as the one before it. Saying a stay is
  // coming twice is saying it once: the second finds the first.
  announceArrival(reference);

  return (
    <>
      <Suspense fallback={null}>
        <StayScreen key={generation} reference={reference} />
      </Suspense>

      {/* Keyed by the stay, so moving to another booking takes the whole of
          this one's panel with it — the price already read, a confirmation
          armed and not answered, a cancellation still in flight. A stay is
          called off once and cannot be brought back, so a confirmation that
          survived onto the next booking would be aimed at the wrong stay. */}
      <StayCancellationPanel
        key={reference}
        onCancelled={() => {
          forgetTheGreeting();
          forgetArrival(reference);
          readAgain();
        }}
        reference={reference}
      />
    </>
  );
}

/**
 * The address without the confirmation's parameter, written back in place.
 *
 * Replaced and not navigated to, which is what makes this cost no request and
 * leave no entry the back button can return to — `use-presented-link.ts` makes
 * the same move for the same reasons. Next reads the router's state back off
 * the history entry, so the screen mounted immediately after this sees the
 * shortened address.
 */
function forgetTheGreeting(): void {
  window.history.replaceState(
    null,
    "",
    addressWithoutLink(window.location, JUST_BOOKED_PARAM),
  );
}
