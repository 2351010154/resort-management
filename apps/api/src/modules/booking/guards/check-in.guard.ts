// The three rejections `booking-state-machine.md` §4 files against
// `CONFIRMED → CHECKED_IN` — the ones that are not about the state pair.
//
// `state-machine.ts` says why they are not in it: the table answers a question
// about two strings, and these read a business date, an assignment row and a
// housekeeping status. They are pure functions here rather than methods on the
// service that holds those things, so that the transition can be tested at every
// boundary — the day before arrival, the departure date, a room mid-clean —
// without a database standing behind each case.
//
// Two of the three carry the ⚑ that §7 marks. §7 is the authority for what the
// default is (blocked, both), `config/env.ts` is where the property says
// otherwise, and neither fact is decided here: each guard takes the answer as an
// argument and applies it. A guard that read the environment would be a guard no
// spec could put on the other side of the decision.
//
// **No relaxation reaches the late half of the arrival window.** Early check-in
// is a property's call; admitting a guest after their departure date is not a
// policy but a booking nobody may still walk into, and §4 marks only the early
// side with a ⚑.

import type {
  CheckInRefusal,
  HousekeepingStatus,
  StayDate,
} from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import type { RoomAssignmentRow } from "../../../database/schema/inventory.js";

/**
 * Refuses with the code the desk branches on — `booking-refusal.ts` names them
 * and argues why they are separate values.
 *
 * The code travels in the error's `data` and not in its `code`, which is oRPC's
 * own and is the HTTP-shaped `CONFLICT` every one of these carries: the state
 * pair is legal, and it is the circumstances that refuse.
 */
function refuse(refusal: CheckInRefusal, message: string): never {
  throw new ORPCError("CONFLICT", { message, data: { code: refusal } });
}

export interface ArrivalWindow {
  /** The property's own day — `business-date.service.ts`, never `new Date()`. */
  readonly businessDate: StayDate;
  readonly arrivalDate: StayDate;
  readonly departureDate: StayDate;
  /** §7's first ⚑ — `BOOKING_EARLY_CHECK_IN_ENABLED`. */
  readonly earlyCheckInEnabled: boolean;
}

/**
 * §4's arrival window: not before the arrival date unless the property allows
 * it, and never after the departure date.
 *
 * Named fields rather than three positional dates. All three are `StayDate`, so
 * an arrival and a departure passed the wrong way round would compile and would
 * refuse exactly the stays it should admit.
 *
 * The comparison is `CalendarDate.compare`, which is a comparison of days.
 * Against an instant it would be a comparison of moments, and a guest arriving
 * at 09:00 on their arrival date would be turned away for being early — the
 * off-by-one-night bug `stay-date.ts` and `business-date.service.ts` both exist
 * to keep uncompilable.
 */
export function validateArrivalWindow({
  businessDate,
  arrivalDate,
  departureDate,
  earlyCheckInEnabled,
}: ArrivalWindow): void {
  if (businessDate.compare(arrivalDate) < 0 && !earlyCheckInEnabled) {
    refuse(
      "ARRIVAL_WINDOW_EARLY",
      `The business date is ${businessDate.toString()} and this stay arrives on ${arrivalDate.toString()} — early check-in is not enabled`,
    );
  }

  // On the departure date is still inside the window, and that is the half-open
  // convention `stay-date.ts` sets rather than a leniency: the departure date is
  // not a night sold, so a guest checking in on it has no night left to occupy.
  // Past it there is not even a booking to walk into.
  if (businessDate.compare(departureDate) > 0) {
    refuse(
      "ARRIVAL_WINDOW_LATE",
      `The business date is ${businessDate.toString()} and this stay departed on ${departureDate.toString()} — it can no longer be checked in`,
    );
  }
}

/**
 * §4's room requirement: a booking without an assignment cannot be checked in.
 *
 * §1's table states it as a property of the state — `CHECKED_IN` is the one row
 * whose "room assigned" column reads **Yes** — so this is not a workflow step
 * that could be deferred to after the guest is in the building.
 *
 * The *other* half of §4's row, "or assignment violates the `EXCLUDE USING gist`
 * constraint", is not checkable here and is not meant to be: that constraint is
 * Postgres's, it is enforced when the assignment row is written, and a pure
 * function re-deriving it would be a second opinion about a guarantee the
 * database already gives. This asks only whether a row exists.
 */
export function validateRoomAssigned(
  assignment: RoomAssignmentRow | null,
): void {
  if (!assignment) {
    refuse(
      "ROOM_NOT_ASSIGNED",
      "This booking has no room assigned — assign one before checking the guest in",
    );
  }
}

/**
 * §4's room-ready rule: `CLEAN` or `INSPECTED`, and nothing else.
 *
 * `INSPECTED` is admitted beside `CLEAN` rather than above it —
 * `housekeeping-status.ts` argues the point: the supervisor pass is optional,
 * and requiring it would stop check-in at every property that does not run one.
 *
 * The two refusals are two rooms the desk cannot use for different reasons, and
 * §7's second ⚑ reaches only the first: a `ROOM_NOT_READY` room is ready once
 * someone cleans it, a `ROOM_OUT_OF_ORDER` one is not until it is repaired. So
 * the flag is asked about `DIRTY` alone — §7 asks about "check-in into a `DIRTY`
 * room", and a flag that admitted both would answer a question nobody asked, in
 * the direction that puts a guest in a room with a fault in it.
 */
export function validateRoomReady(
  housekeepingStatus: HousekeepingStatus,
  dirtyRoomCheckInEnabled: boolean,
): void {
  if (housekeepingStatus === "CLEAN" || housekeepingStatus === "INSPECTED") {
    return;
  }

  if (housekeepingStatus === "DIRTY" && dirtyRoomCheckInEnabled) {
    return;
  }

  if (housekeepingStatus === "OUT_OF_ORDER") {
    refuse(
      "ROOM_OUT_OF_ORDER",
      "The room is out of order and cannot take a guest until it is repaired — assign a different room",
    );
  }

  refuse(
    "ROOM_NOT_READY",
    `The room is ${housekeepingStatus} and is not ready for a guest`,
  );
}
