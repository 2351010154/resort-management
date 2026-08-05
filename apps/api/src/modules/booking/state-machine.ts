// The transition table `booking-state-machine.md` §2 draws, as the one thing
// that decides whether a booking may move — `FR-BOOK-01`.
//
// The table is data here rather than a chain of `if`s, and that is the whole
// design. §2 is a 7×6 grid with 42 cells, and a grid checked by control flow is
// a grid whose gaps nobody can see: the cell that was never written reads
// exactly like the cell that was deliberately closed. Written as a map from a
// state to the states it may reach, every cell is either present or absent, and
// the spec walks the same grid the document draws rather than trusting that
// somebody thought of `CHECKED_OUT`.
//
// The states themselves are `@mariva/shared`'s and are not restated. That file
// says why: the Postgres enum, this table and the wire schema are three spellings
// of one vocabulary, and deriving them from one tuple is what stops the database
// and the code from drifting. A local copy of six strings would compile.
//
// What is deliberately NOT here:
//
// - **The guards.** §4's arrival window, room-ready and folio-settled rejections
//   are not about the state pair — they read a business date, a housekeeping
//   status and a folio balance, none of which this file can see. They belong to
//   the service that has those things, and mixing them in would make a pure
//   table need a database to answer a question about two strings.
// - **The cancellation reason.** §3 requires one on every `→ CANCELLED`, and
//   `schema/booking.ts` holds every writer to it with
//   `booking_reason_exactly_when_cancelled`. It is a fact about the row being
//   written, not about whether the move is allowed, so it is checked where the
//   row is written.

import { type BookingState, BOOKING_STATES } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";

/**
 * The states a booking may be *created* in — §2's *(new)* row.
 *
 * Two, and they are two different acts. The public funnel starts at `HELD` and
 * runs a TTL; the front desk writes `CONFIRMED` directly for a walk-in or a
 * phone reservation (`FR-BOOK-02`). Creation straight into `CHECKED_IN` is
 * refused because a stay nobody booked has no inventory behind it.
 */
export const CREATABLE_STATES: readonly BookingState[] = ["HELD", "CONFIRMED"];

/**
 * §2, transcribed: for each state, every state it may move to.
 *
 * `Record<BookingState, …>` rather than a partial map, so the two terminal
 * states have to say so with an empty list. A missing key would compile and
 * read as an oversight; `[]` reads as the document's row of `✘`.
 */
export const LEGAL_TRANSITIONS: Readonly<
  Record<BookingState, readonly BookingState[]>
> = {
  HELD: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  // Not `CANCELLED`. The guest is in the building and the stay happened;
  // shortening it is an early departure, which posts a policy charge and
  // settles a folio. Cancelling here would erase a stay that consumed a room.
  CHECKED_IN: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  CANCELLED: [],
  // A guest landing at 02:00 after the night audit ran is an ordinary event,
  // not a data-entry error. `MANAGER` only, and it fails if the room was
  // resold — neither of which is this table's to enforce. The first is the
  // `booking.reinstate-no-show` declaration on the route, the second is
  // `room_assignment_no_double_booking` refusing the hold.
  NO_SHOW: ["CHECKED_IN"],
};

/**
 * Whether §2 permits the move. `null` asks the *(new)* row.
 *
 * Re-applying the state a booking already holds is legal and is not a move —
 * §4's idempotency guard. A retried request, a double-clicked button and a job
 * that ran twice all arrive as the transition that already happened, and
 * answering them with a 409 would make a caller that did nothing wrong retry
 * forever.
 */
export function isLegalTransition(
  from: BookingState | null,
  to: BookingState,
): boolean {
  if (from === null) return CREATABLE_STATES.includes(to);
  if (from === to) return true;

  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * The state the booking ends in, or `409 IllegalTransition` — §2.
 *
 * Returns rather than asserts, because the answer for an already-applied
 * transition is the *current* state and a caller that discarded the return
 * value would then write the state it asked for. Today those are the same
 * string; they are returned separately so that a future guard which redirects a
 * transition does not need every call site revisited.
 */
export function applyTransition(
  from: BookingState | null,
  to: BookingState,
): BookingState {
  if (!isLegalTransition(from, to)) {
    throw new ORPCError("CONFLICT", {
      message: `IllegalTransition: a booking cannot go from ${
        from ?? "new"
      } to ${to}`,
    });
  }

  return from === to ? from : to;
}

/**
 * Every state, for a caller that has to enumerate them — a diagram generator,
 * a filter on a list screen.
 *
 * Re-exported rather than re-typed so that `BOOKING_STATES` stays the single
 * tuple §6's diagram, the Postgres enum and this table are all built from.
 */
export { BOOKING_STATES };
