/* The arrivals queue, and the shape of the check-in that is worked out of it.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/dashboard/day-counts.ts` gives: everything below is a decision the
 * API does not make for the console — which of today's confirmed stays belong
 * in the queue, which rooms a guest may actually be walked into, how many steps
 * the sequence has for this particular arrival, and where focus goes when a row
 * leaves. Those are the parts that can be wrong in a way nobody notices until a
 * receptionist is standing in front of a guest.
 *
 * Three rules hold throughout, and `arrival-queue.spec.ts` holds this file to
 * them:
 *
 * 1. **The day is the property's, not the browser's.** Nothing here reads a
 *    clock. The business date arrives on the housekeeping board, resolved by
 *    the API against `system_config.business_date_rollover_hour`, and the queue
 *    is cut against that string. A console computing its own 04:00 would work a
 *    queue for a day the desk is not on.
 * 2. **A list nobody could compute is not an empty list.** `todaysArrivals`
 *    answers `null` rather than `[]` when the search came back narrowed to a
 *    scope with no stays in it, because "nobody is arriving" is a real and
 *    reassuring sentence and printing it over a refusal is the console lying
 *    about the property.
 * 3. **A capped answer says it was capped.** `search.operational` returns at
 *    most {@link SEARCH_RESULT_LIMIT} stays, so a queue cut from it can be
 *    short, and the screen has to say so rather than let a receptionist believe
 *    they have reached the end of the morning.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  CHECK_IN_REFUSALS,
  type CheckInRefusal,
  SEARCH_RESULT_LIMIT,
} from "@mariva/shared";

import type { BoardRoom } from "@/features/housekeeping";

/* The shapes, read off the client rather than restated — `day-counts.ts` and
 * `board-queries.ts` both make the same argument: `@mariva/shared` types the
 * client from the contract's own schemas, so a field renamed there breaks this
 * file in the pull request that renamed it, where a hand-written interface
 * would compile until it was wrong. */
export type SearchResults = Awaited<
  ReturnType<ApiClient["search"]["operational"]>
>;
type FullResults = Extract<SearchResults, { scope: "everything" }>;

/** One stay in the queue, as the search answers it. */
export type Arrival = FullResults["bookings"][number];

/** A person the property has met before, as the search answers them. */
export type GuestHit = FullResults["guests"][number];

/** The stay's account, as `folio.read` answers it. */
export type Folio = Awaited<ReturnType<ApiClient["folio"]["read"]>>;

/** The queue, and whether the answer it was cut from had been cut short. */
export interface ArrivalQueue {
  readonly arrivals: Arrival[];
  /**
   * True when the search hit its own ceiling, so there are arrivals this queue
   * does not contain. Measured against what came back rather than against what
   * survived the filter: the cap is applied by the API before this file sees
   * anything.
   */
  readonly truncated: boolean;
}

/**
 * Today's confirmed arrivals, in the order the desk works them.
 *
 * The state is filtered again here even though `arrivalCriteria` already asks
 * for `CONFIRMED` only. That is not belt-and-braces about the API: the same
 * cached answer is shared with the dashboard's count and is re-read from the
 * cache while a refetch is in flight, and a stay a colleague checked in ten
 * seconds ago must not be offered to a second receptionist as still waiting.
 *
 * The date filter is what separates an arrival from an occupant. The window the
 * search is run over is the whole business day and the API matches a stay to it
 * by overlap, so a confirmed stay that arrived on Tuesday and was never checked
 * in is still in the answer on Wednesday — that is a no-show for the night
 * audit, not somebody at the counter.
 *
 * Ordered by reference rather than left in the API's order, because the queue
 * is walked with the arrow keys and re-rendered on every refetch: an order that
 * depends on how the rows came back is an order that can move under the
 * operator between two presses.
 */
export function todaysArrivals(
  results: SearchResults,
  businessDate: string,
): ArrivalQueue | null {
  if (results.scope !== "everything") {
    return null;
  }

  const arrivals = results.bookings
    .filter(
      (stay) => stay.state === "CONFIRMED" && stay.checkIn === businessDate,
    )
    .sort((left, right) => left.reference.localeCompare(right.reference));

  return {
    arrivals,
    truncated: results.bookings.length >= SEARCH_RESULT_LIMIT,
  };
}

/**
 * The row focus should land on once this one has been checked in.
 *
 * The next arrival, so a desk working ten guests at two o'clock presses Enter,
 * finishes, and is already on the following stay. The one *before* it when the
 * finished row was last, because the alternative is focus landing nowhere at
 * the end of a queue — and null only when the queue is now empty, which is the
 * one case where there is honestly nothing to move to.
 *
 * Computed against the queue as it stood before the check-in, because that is
 * the only list that still contains the row being left.
 */
export function arrivalAfter(
  arrivals: readonly Arrival[],
  bookingId: string,
): string | null {
  const at = arrivals.findIndex((stay) => stay.id === bookingId);

  if (at === -1) {
    return arrivals[0]?.id ?? null;
  }

  return arrivals[at + 1]?.id ?? arrivals[at - 1]?.id ?? null;
}

/**
 * The rooms this stay may actually be walked into, narrowed by what was typed.
 *
 * Four conditions, and each is a refusal the desk would otherwise meet at the
 * check-in call instead of at the control that caused it:
 *
 * - **The type the stay was sold.** A booking is sold as a room type and the
 *   nights are counted against that type's inventory, so putting the guest in
 *   another one is an upgrade — `PUT /bookings/{id}/room-type`, its own
 *   operation — and not something an assignment control may do quietly.
 * - **Ready.** `isReady` is the API's own answer to `booking-state-machine.md`
 *   §4's room-ready guard, so this reads the flag rather than deciding for
 *   itself that `INSPECTED` counts. Out-of-order rooms fall out here too, which
 *   is right: they are not ready.
 * - **Not occupied.** A clean room with somebody still in it is a room the
 *   morning's departure has not left yet.
 * - **Not already refused for this stay.** See below.
 *
 * The first three are questions about **tonight**, because the board is a
 * reading of the property on one business date: `isOccupied` is true when some
 * assignment covers that date and false otherwise. The API asks a wider
 * question. A room is held by a `room_assignment` over the whole of a stay's
 * nights and an exclusion constraint refuses an overlap, so a room standing
 * empty this afternoon and taken by a stay arriving tomorrow is free on the
 * board and refused by `PUT /bookings/{id}/room` for any arrival staying past
 * tonight.
 *
 * Nothing in the contract answers the wider question ahead of the press:
 * `GET /availability` counts a *type's* inventory across the nights and names
 * no room, and the board carries no future hold. So the refusal is the answer,
 * and `refused` is what the room step has learned from it — the numbers this
 * stay has already been declined, kept off the list so the operator is never
 * offered the same refusal twice. It is per stay because the question is about
 * these nights: a room refused for a guest staying to Thursday is still the
 * right room for the one leaving in the morning.
 *
 * The typed fragment matches anywhere in the number, the way the search matches
 * a room fragment — a desk typing `20` is looking for 201 through 210.
 */
export function assignableRooms(
  rooms: readonly BoardRoom[],
  roomType: string,
  typed: string,
  refused: ReadonlySet<string>,
): BoardRoom[] {
  const fragment = typed.trim().toLowerCase();

  return rooms
    .filter(
      (room) =>
        room.roomType === roomType &&
        room.isReady &&
        !room.isOccupied &&
        !refused.has(room.roomNumber) &&
        (fragment === "" || room.roomNumber.toLowerCase().includes(fragment)),
    )
    .sort((left, right) =>
      left.roomNumber.localeCompare(right.roomNumber, undefined, {
        numeric: true,
      }),
    );
}

/** What a refused assignment costs the operator, and costs the list. */
export interface RoomRefusal {
  /** What the desk is told, in words that name the next act. */
  readonly sentence: string;
  /**
   * True when the room is spoken for across these nights. It has to leave the
   * offered list: the hold will not lift while this guest is standing there,
   * so offering the room again only buys the same refusal a second time.
   */
  readonly spokenFor: boolean;
}

/** The HTTP answer behind the exclusion constraint over `room_assignment`. */
const ROOM_IS_HELD = 409;

/**
 * What the assignment was refused for, read off the thrown value.
 *
 * The status and not a code, unlike {@link checkInRefusal}: `booking.assignRoom`
 * declares no errors in the contract, so the conflict arrives undefined —
 * `{"defined":false,"code":"CONFLICT","status":409,"message":"Room 501 is
 * already held across part of 2026-08-17 to 2026-08-20"}` — and there is no
 * `data` to read a name off. A 409 from that route is the exclusion constraint
 * and nothing else, which makes the status the honest structural reading.
 *
 * Read here rather than through `lib/api.ts`'s `apiStatus` so this module stays
 * what its header says it is: no transport, no session, no client — the same
 * reason `checkInRefusal` reads `data.code` by hand.
 *
 * Anything else — a room housekeeping has just soiled, a network that was not
 * there — keeps the room on the list, because pressing again is a reasonable
 * thing for the operator to do with it.
 */
export function roomRefusal(error: unknown, roomNumber: string): RoomRefusal {
  const status =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : null;

  return status === ROOM_IS_HELD
    ? {
        sentence: `Room ${roomNumber} is already held by another stay across these nights. It is off the list — pick another.`,
        spokenFor: true,
      }
    : {
        sentence: `Room ${roomNumber} could not be assigned. Try it again, or pick another.`,
        spokenFor: false,
      };
}

/**
 * What the guest owes on arrival, or nothing.
 *
 * The deposit the sequence offers is the account's own outstanding balance and
 * never a figure this file invents: a stay booked through the funnel is paid in
 * full before it is ever confirmed, and one the desk took by telephone is not.
 * `outstanding` is derived by the API from the postings on every read, so this
 * is a reading of the ledger rather than a second opinion about it.
 *
 * A negative balance is an over-paid stay and is not a deposit due. Money going
 * back to a guest is a refund, which is two other routes and two other
 * capabilities.
 */
export function depositDue(folio: Folio): bigint {
  const { outstanding } = folio.summary;

  return outstanding > 0n ? outstanding : 0n;
}

/** The steps a check-in can have, in the order they are worked. */
export const CHECK_IN_STEPS = [
  "guest",
  "identity",
  "room",
  "deposit",
  "review",
] as const;

export type CheckInStep = (typeof CHECK_IN_STEPS)[number];

/** What decides how many steps this particular arrival has. */
export interface SequenceFacts {
  /** True when the account is short — see {@link depositDue}. */
  readonly depositDue: boolean;
}

/**
 * The steps this arrival actually has.
 *
 * A sequence with a fixed five steps would make the desk press Enter through
 * one that has nothing on it, which at ten guests is ten presses spent on
 * nothing. The deposit is the step that can honestly have nothing on it: a stay
 * booked through the funnel arrived paid, and asking a receptionist for money
 * the guest has already handed over is worse than a wasted press.
 *
 * The other three are always there, the document step included — and it did not
 * used to be. It was dropped for a guest the property already held, on the
 * reasoning that their particulars were taken the last time they stayed. That
 * is true of a guest whose document was read and false of the rest: a second
 * occupant registered on the first guest's word has a name and nothing else,
 * and check-in names a returning guest by id ever after, so the step being
 * skipped was the only place their record could ever have been filled in.
 * Nghị định 96/2016/NĐ-CP Điều 44 wants the particulars before *this* room
 * changes hands, not before some earlier one. What the step costs a guest whose
 * record is complete is one press on a form that shows what is already on file
 * and asks for nothing — {@link documentTranscription} is what makes that press
 * cost no request.
 */
export function sequenceSteps(facts: SequenceFacts): CheckInStep[] {
  return CHECK_IN_STEPS.filter(
    (step) => step !== "deposit" || facts.depositDue,
  );
}

/** Which guest is going on the residence record. */
export type ChosenGuest =
  | {
      readonly kind: "known";
      readonly id: string;
      readonly name: string;
      /**
       * The property's number for them, masked, as the search answered it —
       * `FR-GST-03` allows a queue no more than this. It is what the document
       * step shows so that a receptionist is not retyping a number already on
       * file; there is no reveal control here, because that is a route with its
       * own capability and its own audit row, and the Guests screen has it.
       */
      readonly cccdMasked: string | null;
    }
  | { readonly kind: "new"; readonly name: string };

/** What the document step collects, before any of it is trimmed or read. */
export interface Particulars {
  fullName: string;
  cccdNumber: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
}

/** The particulars of one document, for one guest the property already holds. */
export interface DocumentTranscription {
  readonly guestId: string;
  readonly cccdNumber?: string;
  readonly dateOfBirth?: string;
  readonly nationality?: string;
}

/**
 * What the document step owes `guest.transcribeDocument`, or nothing.
 *
 * Nothing for a guest being registered now: their particulars travel with the
 * check-in that creates the record, in that transition's transaction, and there
 * is no id yet for a separate call to name.
 *
 * Nothing when the desk typed nothing either — which is the ordinary case for a
 * returning guest whose record is already complete, and is why the step costs
 * that arrival a press and not a request. A body naming no particular is a
 * transcription nobody performed and the contract refuses it, so the honest
 * place to decide there is nothing to send is here, before anything is sent.
 *
 * Every blank box is left out rather than sent as null. The route reads absent
 * as "this document was not read for that fact" and has no spelling for
 * clearing one, which is the whole difference between a desk recording what a
 * card says and a guest editing their own profile.
 */
export function documentTranscription(
  guest: ChosenGuest | null,
  typed: Particulars,
): DocumentTranscription | null {
  if (guest === null || guest.kind === "new") {
    return null;
  }

  const cccdNumber = orNothing(typed.cccdNumber);
  // Already known to parse: the step refuses to advance past a birth date it
  // cannot read, so an unreadable one never reaches here and a null is a box
  // nobody filled in.
  const dateOfBirth = parseBirthDate(typed.dateOfBirth);
  const nationality = orNothing(typed.nationality);

  if (cccdNumber === null && dateOfBirth === null && nationality === null) {
    return null;
  }

  return {
    guestId: guest.id,
    ...(cccdNumber === null ? {} : { cccdNumber }),
    ...(dateOfBirth === null ? {} : { dateOfBirth }),
    ...(nationality === null ? {} : { nationality }),
  };
}

/** The HTTP answer behind `guest_cccd_number_key`, the one index this write
 *  can collide with. */
const NUMBER_IS_ON_ANOTHER_RECORD = 409;

/**
 * What a refused transcription costs the operator, in words that name the next
 * act.
 *
 * The status and not a code, for {@link roomRefusal}'s reason: the route
 * declares no errors in the contract, so the conflict arrives undefined and
 * there is no `data` to read a name off. A 409 from this route is the unique
 * index over the CCCD and nothing else, which makes the status the honest
 * structural reading.
 *
 * The conflict is not a fault and the sentence says so — the property has met
 * this person before, so either the digits are wrong or the guest standing
 * there is the other record. Anything else is worth pressing again for, which
 * is safe: the same three facts sent twice leave the same record.
 */
export function transcriptionRefusal(error: unknown): string {
  const status =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : null;

  return status === NUMBER_IS_ON_ANOTHER_RECORD
    ? "That number is already on another guest's record. Check the digits, or go back and pick the guest it belongs to."
    : "The particulars could not be recorded. Try again — sending them twice records them once.";
}

/**
 * An optional detail as it should be sent, or nothing.
 *
 * The empty string is the dishonest one. Every optional field on the contract
 * takes both, and `guest.service.ts` writes a blank straight into a column the
 * partial unique index over the CCCD then treats as a value — while a
 * registration carrying `""` for a telephone number claims a fact nobody gave.
 */
export function orNothing(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * The step after this one, or null at the end of the sequence.
 *
 * Found by the declared order rather than by the answered step's position in
 * the list, because answering a step is what can remove it: a deposit posted
 * settles the account, so the sequence the operator is routed against no longer
 * has a deposit step in it. Reading a position in that list would find nothing
 * and send them back to the first step of a check-in they are most of the way
 * through.
 */
export function stepAfter(
  steps: readonly CheckInStep[],
  step: CheckInStep,
): CheckInStep | null {
  const answered = CHECK_IN_STEPS.indexOf(step);

  return steps.find((one) => CHECK_IN_STEPS.indexOf(one) > answered) ?? null;
}

/**
 * The refusal code behind a rejected check-in, or null.
 *
 * Read structurally off `data.code` and checked against the contract's own
 * list, because that is what `contract/booking.ts` declares and what
 * `booking-refusal.ts` exists for: the desk has a different action behind each
 * one, and matching on the message would tie this screen to the wording. An
 * error carrying no code — an illegal transition, a network that was not there
 * — answers null and is left to the central toast.
 */
export function checkInRefusal(error: unknown): CheckInRefusal | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const data = (error as { data?: unknown }).data;

  if (typeof data !== "object" || data === null) {
    return null;
  }

  const code = (data as { code?: unknown }).code;

  return CHECK_IN_REFUSALS.includes(code as CheckInRefusal)
    ? (code as CheckInRefusal)
    : null;
}

/**
 * Where the sequence goes when the API refuses the check-in.
 *
 * The three room refusals send the operator back to the assignment control,
 * which is where the fix is: call housekeeping and pick the room again, or pick
 * a different one. The two window refusals have no fix inside this sequence —
 * an early arrival needs a manager and a late one is a stay the night audit has
 * already written off — so the operator stays on the review step, where the
 * sentence is.
 */
export function refusalStep(code: CheckInRefusal): CheckInStep {
  return code === "ARRIVAL_WINDOW_EARLY" || code === "ARRIVAL_WINDOW_LATE"
    ? "review"
    : "room";
}

/** What the desk is told, per refusal, in words that name the next act. */
export function refusalSentence(code: CheckInRefusal): string {
  switch (code) {
    case "ARRIVAL_WINDOW_EARLY":
      return "The stay does not start today. A manager can reinstate or move it; the queue cannot.";
    case "ARRIVAL_WINDOW_LATE":
      return "The night audit has already written this stay off. A manager reinstates a late arrival.";
    case "ROOM_NOT_ASSIGNED":
      return "The stay holds no room. Assign one and check in again.";
    case "ROOM_NOT_READY":
      return "That room is not clean yet. Ask housekeeping to release it, or pick another.";
    case "ROOM_OUT_OF_ORDER":
      return "That room is out of order. The guest needs a different one.";
  }
}

/**
 * A whole number of đồng typed by an operator, or null.
 *
 * `bigint`, because that is what the ledger is counted in and what the contract
 * takes — `money.ts` chose it precisely so an amount cannot be added to a night
 * or a percentage by accident.
 *
 * Spaces and full stops are dropped and a comma is not, which is the vi-VN
 * grouping mark and the vi-VN decimal mark respectively: a receptionist reading
 * "1.500.000 ₫" off the screen types the stops they can see, while a comma in a
 * đồng figure is somebody typing a minor unit the currency does not have — and
 * silently reading it as a grouping mark would post a hundredfold of what was
 * meant.
 *
 * Zero and less are refused. A deposit is money handed over, which is the same
 * refusal `postPaymentInput` states, applied where the operator can still fix
 * it rather than as a `400` after the press.
 */
export function parseAmount(typed: string): bigint | null {
  const digits = typed.replaceAll(/[\s.]/g, "");

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const amount = BigInt(digits);

  return amount > 0n ? amount : null;
}

/**
 * A date of birth as the contract takes it, or null when it is not one.
 *
 * `YYYY-MM-DD` and nothing more liberal, which is `lib/date-parser.ts`'s own
 * instruction rather than a shortcut: every two-digit year that parser accepts
 * resolves to this century because every date it was written for is a stay
 * date, and the same rule turns a guest born in 1985 into one born in 2085.
 *
 * The day is checked against the calendar and not only against the pattern.
 * "1990-02-30" matches the shape and `Date.UTC` rolls it into 2 March without
 * complaint, so a typo would be filed on the residence record as a real and
 * different birthday.
 */
export function parseBirthDate(typed: string): string | null {
  const trimmed = typed.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const walked = new Date(Date.UTC(year, month - 1, day));

  const real =
    walked.getUTCFullYear() === year &&
    walked.getUTCMonth() === month - 1 &&
    walked.getUTCDate() === day;

  return real ? trimmed : null;
}
