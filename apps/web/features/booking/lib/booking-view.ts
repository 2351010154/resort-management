// Which view the screen is on, and the one thing that has to survive the swap.
//
// **View identity is derived, never stored.** The screen asks two questions in
// sequence — when, then which room — and which one is open follows from whether
// the URL holds a complete range. A `useState<"when" | "rooms">` beside the URL
// is a second source of truth that can disagree with the address bar, and this
// screen was designed to be incapable of that: every control writes the search,
// and the search is the state.
//
// The one thing that cannot be derived is where the guest had scrolled to. The
// room list is unmounted while the calendar is open, so its scroll position
// exists nowhere once it leaves — and a guest who changes one date and comes
// back to the top of the list has been punished for correcting themselves. It is
// held here, at module scope, deliberately outside React: it belongs to the
// browser session rather than to any component, and every component that could
// own it is unmounted at the moment it is needed.

import type { StayRange } from "@mariva/shared";

export type BookingView = "when" | "rooms";

/**
 * The open question, from the search alone.
 *
 * A complete range is the only thing that opens the room list. An anchor with no
 * departure is a guest mid-sentence, and `readBookingSearch` already refuses to
 * call that a range.
 */
export function bookingView(range: StayRange | null): BookingView {
  return range === null ? "when" : "rooms";
}

let roomsScrollY = 0;

/** Called as the room list leaves, with the offset it is leaving at. */
export function rememberRoomsScroll(y: number): void {
  roomsScrollY = y;
}

/**
 * The offset to put the room list back at, consumed once.
 *
 * Consumed rather than read, so a later remount for some other reason does not
 * jump the page to a position from a search two changes ago.
 */
export function takeRoomsScroll(): number {
  const y = roomsScrollY;
  roomsScrollY = 0;
  return y;
}
