// Why a transition was refused, in one place because three layers spell it: the
// guard that throws the code, the error `data` that carries it over the wire, and
// the front-desk screen that branches on it. `booking-state-machine.md` §4 is the
// authority for which circumstances refuse; this file is the authority for what
// those refusals are called.
//
// Here at the root and not in `contract/`, for the reason `housekeeping-status.ts`
// and `booking-state.ts` are: a refusal code is vocabulary, not a route. There is
// no booking contract yet, and `contract/index.ts` says why one must not be
// written ahead of the routes it promises — but the vocabulary is already needed,
// because a guard already throws these and a desk will already read them.
//
// No `z.enum` beside the tuples, unlike the files above. Nothing parses a refusal
// off the wire: the API produces it and the client reads it, so a schema here
// would be a validator with no input. It joins when a route declares its errors.

/**
 * Why a check-in was refused, as a string a caller may branch on.
 *
 * The message says what happened to a human; this says it to the front desk
 * screen, which has a different action behind each one — a manager override for
 * the window, the room grid for an assignment, housekeeping for a room that is
 * merely not cleaned yet, a different room for one with a fault in it. Matching
 * on prose would tie that screen to the wording.
 *
 * `ROOM_NOT_READY` and `ROOM_OUT_OF_ORDER` are two values for exactly that
 * reason. `housekeeping-status.ts` files `OUT_OF_ORDER` as a room that cannot be
 * occupied at all rather than one that is not ready yet, and the desk acts on the
 * difference: it calls housekeeping and retries the first room, and it moves the
 * guest out of the second. One code covering both would leave the screen reading
 * the message to tell which — the tie this list exists to cut.
 */
export const CHECK_IN_REFUSALS = [
  "ARRIVAL_WINDOW_EARLY",
  "ARRIVAL_WINDOW_LATE",
  "ROOM_NOT_ASSIGNED",
  "ROOM_NOT_READY",
  "ROOM_OUT_OF_ORDER",
] as const;

export type CheckInRefusal = (typeof CHECK_IN_REFUSALS)[number];

/**
 * Why a check-out was refused — one value, because §4 files exactly one guard
 * against `CHECKED_IN → CHECKED_OUT`.
 *
 * A one-element tuple and not a bare constant, so both refusal lists have the
 * same shape: a desk switching exhaustively over check-out refusals is written
 * the same way as one switching over check-in refusals, and the second guard §4
 * still owes here — the approved deferred settlement `check-out.guard.ts` cannot
 * write yet — adds a value rather than changing what kind of thing this is.
 */
export const CHECK_OUT_REFUSALS = ["FOLIO_NOT_SETTLED"] as const;

export type CheckOutRefusal = (typeof CHECK_OUT_REFUSALS)[number];
