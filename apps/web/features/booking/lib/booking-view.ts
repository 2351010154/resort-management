// Which view the screen is on, and the one thing that has to survive the swap.
//
// **View identity is derived, never stored.** The screen asks two questions in
// sequence — when, then which room — and which one is open follows from the URL:
// whether it holds a complete range, and which step that range is at. A
// `useState<"when" | "rooms">` beside the URL is a second source of truth that
// can disagree with the address bar, and this screen was designed to be
// incapable of that: every control writes the search, and the search is the
// state.
//
// **The dates step has two readings, and they are one view.** A complete range
// no longer means the room list; it means the stay is stated back to the guest in
// the panel beside the calendar, with the way forward in it. That panel is an
// expansion of the screen the guest is already on rather than a screen of its
// own — the calendar stays exactly where it is, mounted and selectable — so it
// must not be a third `BookingView`. If it were, the view key would change and
// `AnimatePresence` would unmount and rebuild the calendar underneath a guest who
// had only just finished using it.
//
// So: two views, and a panel flag over the first of them.
//
// The one thing that cannot be derived is where the guest had scrolled to. The
// room list is unmounted while the calendar is open, so its scroll position
// exists nowhere once it leaves — and a guest who changes one date and comes
// back to the top of the list has been punished for correcting themselves. It is
// held here, at module scope, deliberately outside React: it belongs to the
// browser session rather than to any component, and every component that could
// own it is unmounted at the moment it is needed.

import type { StayRange } from "@mariva/shared";
import type { BookingStep } from "./booking-search";

export type BookingView = "when" | "rooms";

/**
 * The open question, from the search alone.
 *
 * A complete range *and* the room step is the only thing that opens the room
 * list. An anchor with no departure is a guest mid-sentence, and
 * `readBookingSearch` already refuses to call that a range — it also refuses to
 * call a step "rooms" without one, so the range check here is belt and braces
 * rather than the load-bearing guard.
 */
export function bookingView(
  range: StayRange | null,
  step: BookingStep,
): BookingView {
  return range !== null && step === "rooms" ? "rooms" : "when";
}

/**
 * Whether the stay panel is expanded.
 *
 * The panel confirms an answer, so it is open exactly when there is an answer to
 * confirm and the guest has not yet moved past it. On the room step it collapses:
 * the stay is restated by the summary row at the top of the list, and the list
 * wants the width back.
 */
export function isStayPanelOpen(
  range: StayRange | null,
  step: BookingStep,
): boolean {
  return range !== null && bookingView(range, step) === "when";
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
