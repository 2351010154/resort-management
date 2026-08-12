// The booking lifecycle as routes — `booking-state-machine.md` §2's transitions
// and §5's operations, one endpoint each.
//
// **One endpoint each is the requirement, not a style.** §5 opens by saying that
// every operation it lists "is a separate endpoint with its own
// `@RequiresCapability()` declaration", and `rbac-matrix.md` §2 says why in the
// case that would otherwise be tempting to collapse: policy and override are two
// endpoints with two capabilities, never one endpoint with an amount check
// inside it. So {@link booking.cancel} and {@link booking.cancelWithWaiver}
// exist twice over, and that reasoning is untouched.
//
// **The guard is not the record.** Which route a caller could reach is an
// authorisation event: it decides who is admitted and leaves nothing on the
// booking behind it, and no booking write files an `audit_entry` row — the
// table is real, system config and the pricing writes are the only things that
// put anything in it, and no trigger does it for anybody else. What separates a
// receptionist's cancellation from a manager's waiver afterwards is
// `penalty_waived_at` and `penalty_waived_by`, written only by
// {@link booking.cancelWithWaiver} and read by `folio.service.ts` when
// `property-and-tariff.md` §4's grid is priced on a later request, under a
// third capability that a receptionist holds.
//
// **Nothing here decides anything.** Every route is one service method, and the
// two schemas around it exist to say what may arrive and what leaves. The
// transition table, the guards, the inventory effects and the idempotency rule
// are `booking.service.ts`'s and `assignment.service.ts`'s; a contract that
// re-stated any of them would be a second opinion that could come to disagree.
//
// **Dates cross here, once.** A request carries `stayDateSchema`, which decodes
// `YYYY-MM-DD` into the `CalendarDate` a service takes; a response carries
// `isoStayDateSchema`, which is the text a client reads. `stay-date.ts` argues
// the asymmetry at length, and the controller performs the conversion where it
// can be seen. An instant — a hold's expiry — is ISO-8601 on the wire for the
// same reason, and is the one field here that is a moment rather than a day.
//
// **Amounts are `bigint` on the way out and text on the way in**, which is
// `money.ts`'s split for `money.ts`'s reason. Nothing here takes an amount:
// §8 freezes what a booking was quoted, and the one operation that adds nights
// prices them off the calendar rather than off a number a caller sent.
//
// What is deliberately NOT here:
//
// - **Reading a booking.** `booking.read-any` is a real row and its route is
//   `search.operational`'s neighbour at task 23; there is no read method on the
//   service to hang one off yet, and every route below already answers with the
//   booking it changed. `M7` routes on `/bookings/<reference>`, which is a
//   lookup by a different key again.
// - **`booking.read-own` and `booking.cancel-own`.** Both are `conditional` for
//   a guest, which `rbac-matrix.md` §2 defines as an ownership check the handler
//   still owes — and a booking has no owning account to check against. `guest`
//   rows are linked at registration, which happens at check-in, so a guest
//   cancelling their own hold has nothing to be matched on until `M6` gives a
//   booking an account. Creating one is different and is granted here: a caller
//   who has just been handed the reference is the owner of it.
// - **Change rate and post charge / payment.** §5 lists both, `prd-m4.md` puts
//   both outside `M4` in the same sentence, and `pricing.rate-override` and the
//   folio rows are their capabilities.
// - **Guest details.** §5's last row is `guest.read-record`'s and `M4` task 22's.

import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  checkInRefusalSchema,
  checkOutRefusalSchema,
} from "../booking-refusal.js";
import {
  bookingStateSchema,
  cancellationReasonSchema,
} from "../booking-state.js";
import { vndAmountSchema } from "../money.js";
import { chargeBasisSchema } from "../policy-charge.js";
import { ratePlanCodeSchema, roomTypeCodeSchema } from "../rate-calendar.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";
import { LARGEST_PLAUSIBLE_PARTY, OLDEST_CHILD_AGE } from "./availability.js";

/** The booking every route below acts on. */
const bookingIdFields = { bookingId: z.uuid() };

/**
 * A room as the desk speaks it — the same bound `closeRoomInput` puts on one.
 *
 * Whether the room exists, and whether it is of the type the booking was sold,
 * are `assignment.service.ts`'s refusals and not this schema's. It cannot know
 * either, and a length that happened to match would still be a room nobody has.
 */
const roomNumberSchema = z.string().trim().min(1).max(10);

/**
 * The party a stay is sold to, as a body carries it.
 *
 * `adults` plus `childAges` and not one head count, which is `availability.ts`'s
 * argument carried through to the booking: `FR-PRC-04` prices children in three
 * bands and a number cannot say which. The two shapes match on purpose — a guest
 * books the party they searched with, and a funnel that had to reshape it
 * between the two calls is a funnel that can reshape it wrongly.
 *
 * No `z.preprocess` here, unlike the query. A search arrives in a query string
 * where one child is a bare value and two are an array; a booking arrives as
 * JSON, where an array of one is an array.
 */
const partyFields = {
  adults: z.number().int().min(1).max(LARGEST_PLAUSIBLE_PARTY),
  childAges: z
    .array(z.number().int().min(0).max(OLDEST_CHILD_AGE))
    .max(LARGEST_PLAUSIBLE_PARTY)
    .default([]),
};

/**
 * A stay as it is sold — the body behind both of §2's creating transitions.
 *
 * One schema for the two, because §2's *(new)* row differs in the state reached
 * and in nothing else the caller states: a walk-in and a funnel booking name the
 * same type, the same nights, the same plan and the same party. What separates
 * them is which route was called, which is what makes "only the funnel can
 * create `HELD`" (`FR-BOOK-02`) a fact about the routing table rather than a
 * flag a caller could set.
 *
 * The stay's price is not a field. §8 has a booking freeze what it was quoted,
 * and the quote is computed inside the transaction that consumes the nights —
 * an amount arriving here would be a price the guest proposed.
 */
export const createBookingInput = z
  .object({
    roomType: roomTypeCodeSchema,
    checkIn: stayDateSchema,
    checkOut: stayDateSchema,
    // The plan the prices are quoted under, defaulted to the one the other two
    // are derived from — `availability.ts` defaults its search the same way.
    plan: ratePlanCodeSchema.default("STANDARD"),
    ...partyFields,
  })
  .refine((input) => input.checkIn.compare(input.checkOut) < 0, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  })
  .refine(
    (input) => input.adults + input.childAges.length <= LARGEST_PLAUSIBLE_PARTY,
    {
      message: `a party of more than ${LARGEST_PLAUSIBLE_PARTY} is not a booking`,
      path: ["childAges"],
    },
  );

/**
 * A booking as it leaves the API — the shape `booking.service.ts` returns,
 * crossed onto the wire.
 *
 * Every route below answers with one, including the ones that changed no state.
 * That is not padding: §4 makes idempotency a guard rather than an error, so a
 * retried transition answers with the current state, and a caller that got a
 * bare acknowledgement would have no way to tell the two apart.
 *
 * `holdExpiresAt` is set only while the booking is `HELD` —
 * `booking_hold_expiry_exactly_when_held` holds every writer to it — and it is
 * the one field here that is an instant. A TTL is a moment and not a day: a hold
 * taken at 14:00 dies twenty minutes later, which is a question no calendar date
 * can answer.
 */
export const bookingSchema = z.object({
  id: z.uuid(),
  /** Human-readable, and the key `M7` routes a guest's own booking on. */
  reference: z.string(),
  /**
   * The guest account that made it, or null when nobody was signed in.
   *
   * Null on every stay the front desk takes, which is most of them — a walk-in
   * is somebody at the counter and not an account. `z.string()` and not
   * `z.uuid()`, because the guest realm's ids are Better Auth's own 32-character
   * strings rather than generated by Postgres.
   */
  userId: z.string().nullable(),
  state: bookingStateSchema,
  cancellationReason: cancellationReasonSchema.nullable(),
  roomType: roomTypeCodeSchema,
  checkIn: isoStayDateSchema,
  checkOut: isoStayDateSchema,
  plan: ratePlanCodeSchema,
  adults: z.number().int().min(1),
  childAges: z.array(z.number().int().min(0)),
  /** The agreed total, frozen — §8. Decimal text on the wire, per `money.ts`. */
  stayTotalGross: vndAmountSchema,
  holdExpiresAt: z.iso.datetime().nullable(),
});

/**
 * Why a booking was cancelled, minus the one reason no caller may claim.
 *
 * `HOLD_EXPIRED` is the TTL sweep's — `booking-state.ts` says so, and §3 gives
 * it to the job that fires when the hold runs out. A desk sending it would be
 * filing a guest's change of mind as an abandoned cart, which is the field the
 * cancellation grid prices off: `property-and-tariff.md` §4 charges a request
 * inside the deadline nothing and one outside it the first night, and neither
 * row is the one an expiry takes.
 */
export const cancelInput = z.object({
  ...bookingIdFields,
  reason: cancellationReasonSchema.exclude(["HOLD_EXPIRED"]),
});

/**
 * Somebody to register at check-in: a person the property has met before, or a
 * record it is creating now.
 *
 * A union rather than an id and a pile of optional fields, mirroring
 * `guest.service.ts`'s `CheckInGuest` exactly — a returning guest already has a
 * row, and `guest_cccd_number_key` refuses a second one carrying the same
 * number, so a check-in that could only create would turn every repeat visit
 * into a conflict at the desk.
 *
 * Discriminated by which fields are present rather than by a tag, for the reason
 * that type gives: a new guest must have a name and this branch has none, so the
 * two cannot be confused. A body carrying both is read as the first branch and
 * its extra fields are dropped, which is the honest reading — a caller that
 * named a guest id has identified the person, and the details beside it would
 * silently create a duplicate of them.
 */
export const checkInGuestSchema = z.union([
  z.object({ guestId: z.uuid() }),
  z.object({
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).nullish(),
    email: z.email().nullish(),
    cccdNumber: z.string().trim().max(20).nullish(),
    dateOfBirth: stayDateSchema.nullish(),
    nationality: z.string().trim().max(60).nullish(),
  }),
]);

/**
 * The party going into the room — `CONFIRMED → CHECKED_IN`.
 *
 * At least one, because §1 files the registration record as a property of the
 * state rather than as a later step: `CHECKED_IN` is the row whose registration
 * column reads **Yes**, and a stay that reached it with nobody named would be a
 * statutory residence record with a hole in it. The service refuses an empty
 * list too — this refuses it as a `400` naming the field instead.
 *
 * The first is the booking holder. `registration_one_primary_per_booking_key`
 * allows exactly one, and taking it from the order the desk entered them is the
 * one rule that needs no extra field on the wire.
 */
export const checkInInput = z.object({
  ...bookingIdFields,
  guests: z.array(checkInGuestSchema).min(1),
});

/**
 * A late arrival after the night audit wrote the stay off — `NO_SHOW →
 * CHECKED_IN`, which §2 calls an ordinary event.
 *
 * `roomNumber` is optional here and required by the service when the booking
 * holds no room. The contract cannot know which of those it is — that is a row
 * in `room_assignment` — so the refusal is the service's, in the words the desk
 * acts on. What the field exists for is the case that has no other door: §5
 * makes assignment legal from `CONFIRMED` and `CHECKED_IN` only, so a stay
 * written off holding no room, or holding one that went out of order overnight,
 * cannot be given one any other way.
 */
export const reinstateInput = z.object({
  ...checkInInput.shape,
  roomNumber: roomNumberSchema.optional(),
});

/** The room a booking is put into, or moved to — §5's first two rows. */
export const assignRoomInput = z.object({
  ...bookingIdFields,
  roomNumber: roomNumberSchema,
});

/**
 * §5's "change room type (upgrade)".
 *
 * `roomNumber` is required when the booking holds a room and refused when it
 * does not, and both refusals are `assignment.service.ts`'s: a room of the old
 * type cannot stay held by a booking no longer sold as that type, and naming one
 * for a booking that holds none would be an assignment performed under this
 * operation's authority. Neither is a fact this schema can see.
 */
export const changeRoomTypeInput = z.object({
  ...bookingIdFields,
  roomType: roomTypeCodeSchema,
  roomNumber: roomNumberSchema.optional(),
});

/**
 * A new departure date — the body behind both of §5's stay-length operations.
 *
 * One shape and two routes, because the two are genuinely different acts with
 * different capabilities: an extension has to find inventory for the nights it
 * adds and fails cleanly without it, and an early departure gives nights back
 * and puts §4's charge on them. A single route branching on whether the date
 * moved forward or back would be one endpoint with a check inside it, which is
 * the shape `rbac-matrix.md` §2 refuses — and would hand a receptionist holding
 * only one of the two capabilities the other.
 */
export const changeDepartureInput = z.object({
  ...bookingIdFields,
  checkOut: stayDateSchema,
});

/** A room held for a booking, as the desk sees it. */
export const roomAssignmentSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  roomNumber: z.string(),
  checkIn: isoStayDateSchema,
  checkOut: isoStayDateSchema,
});

/** What a type change moved. `assignment` is null when the booking held none. */
export const roomTypeChangeSchema = z.object({
  bookingId: z.uuid(),
  from: roomTypeCodeSchema,
  to: roomTypeCodeSchema,
  /** Nights moved between the two counters — zero on a repeated request. */
  nights: z.number().int().min(0),
  assignment: roomAssignmentSchema.nullable(),
});

/** What a lengthened stay added, and the total with those nights in it. */
export const extendedStaySchema = z.object({
  bookingId: z.uuid(),
  checkOut: isoStayDateSchema,
  /** Zero when the stay already ran that far — §4's idempotency guard. */
  nightsAdded: z.number().int().min(0),
  stayTotalGross: vndAmountSchema,
  assignment: roomAssignmentSchema.nullable(),
});

/**
 * §4's amount, computed and never stored.
 *
 * `cancellation-calculator.ts` says why nothing persists it: a charge is a folio
 * posting and the folio is `M6`. It travels on the response because the desk
 * telling a guest what leaving early costs is the whole of the operation at
 * `M4`, and `basis` travels beside it because the number alone cannot say what
 * it is for — a free cancellation and a departure on the final night are both
 * zero.
 */
export const policyChargeSchema = z.object({
  amount: vndAmountSchema,
  basis: chargeBasisSchema,
});

/** What an early departure gave back, and what §4's grid charges for it. */
export const shortenedStaySchema = z.object({
  bookingId: z.uuid(),
  checkOut: isoStayDateSchema,
  /** Zero when the stay already ended there. */
  nightsReleased: z.number().int().min(0),
  charge: policyChargeSchema,
  assignment: roomAssignmentSchema.nullable(),
});

/**
 * §4's three check-in rejections, typed onto the error a client catches.
 *
 * `CONFLICT` and not a code of its own, because the state pair is legal — §2
 * permits `CONFIRMED → CHECKED_IN` — and it is the circumstances that refuse.
 * `check-in.guard.ts` puts the code in `data` for exactly this: the desk has a
 * different action behind each one, and matching on the message would tie the
 * screen to the wording.
 *
 * The same `CONFLICT` also carries an illegal transition, which has no code.
 * That error is undeclared and passes through as it is — a 409 either way, and a
 * client switching on the code simply finds none.
 */
const CHECK_IN_ERRORS = {
  CONFLICT: { data: z.object({ code: checkInRefusalSchema }) },
} as const;

/** §4's one check-out rejection, typed the same way. */
const CHECK_OUT_ERRORS = {
  CONFLICT: { data: z.object({ code: checkOutRefusalSchema }) },
} as const;

export const booking = {
  // ── §2's transitions ───────────────────────────────────────────────────────

  createHold: oc
    // 201, and a nested path rather than a flag on `/bookings`: `FR-BOOK-02`
    // gives the funnel this door and the desk the other, and two paths is what
    // makes "only the funnel can create `HELD`" enforceable by the capability
    // guard rather than by a check inside a handler.
    .route({ method: "POST", path: "/bookings/holds", successStatus: 201 })
    .input(createBookingInput)
    .output(bookingSchema),

  createConfirmed: oc
    .route({ method: "POST", path: "/bookings", successStatus: 201 })
    .input(createBookingInput)
    .output(bookingSchema),

  confirm: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/confirmation" })
    .input(z.object(bookingIdFields))
    .output(bookingSchema),

  cancel: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/cancellation" })
    .input(cancelInput)
    .output(bookingSchema),

  cancelWithWaiver: oc
    // The second door §2 of `rbac-matrix.md` insists on, and the reason it is a
    // path and not a field: the penalty a manager waives is computed off the
    // same grid either way, so an endpoint that took a `waive: true` would put
    // the authority to waive inside the body of a route a receptionist can
    // reach. What arrives is the body the policy route takes too; what differs
    // is what this route leaves behind — `penalty_waived_at`, and the manager
    // off the session in `penalty_waived_by`. `folio.service.ts` reads the pair
    // when it prices `property-and-tariff.md` §4's grid on a later request,
    // under a capability a receptionist holds, and posts `NONE` above the grid
    // rather than the penalty a manager had already set aside.
    .route({
      method: "POST",
      path: "/bookings/{bookingId}/cancellation-waiver",
    })
    .input(cancelInput)
    .output(bookingSchema),

  checkIn: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/check-in" })
    .errors(CHECK_IN_ERRORS)
    .input(checkInInput)
    .output(bookingSchema),

  checkOut: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/check-out" })
    .errors(CHECK_OUT_ERRORS)
    .input(z.object(bookingIdFields))
    .output(bookingSchema),

  markNoShow: oc
    .route({ method: "POST", path: "/bookings/{bookingId}/no-show" })
    .input(z.object(bookingIdFields))
    .output(bookingSchema),

  reinstate: oc
    // The same guards as a check-in, because it is one — §3 gives the late
    // arrival the same room-ready and arrival-window rules, read against the
    // room the guest is actually going into.
    .route({ method: "POST", path: "/bookings/{bookingId}/reinstatement" })
    .errors(CHECK_IN_ERRORS)
    .input(reinstateInput)
    .output(bookingSchema),

  // ── §5's operations, which change no state ─────────────────────────────────

  assignRoom: oc
    // PUT: the room a booking holds is a single fact, and naming the same room
    // twice leaves it holding that room. A move is not this — it keeps the
    // nights already slept, so it appends rather than replaces.
    .route({ method: "PUT", path: "/bookings/{bookingId}/room" })
    .input(assignRoomInput)
    .output(roomAssignmentSchema),

  moveRoom: oc
    // POST to a collection, because that is what a move writes: a new assignment
    // row with the old one closed at today's date. The guest slept in 304 on
    // Tuesday and 512 on Wednesday and both are true, so the moves accumulate.
    .route({ method: "POST", path: "/bookings/{bookingId}/room-moves" })
    .input(assignRoomInput)
    .output(roomAssignmentSchema),

  changeRoomType: oc
    .route({ method: "PUT", path: "/bookings/{bookingId}/room-type" })
    .input(changeRoomTypeInput)
    .output(roomTypeChangeSchema),

  extendStay: oc
    // PUT on the departure date: the same date sent twice leaves the stay
    // ending there, which is the property `assignment.service.ts` gives it.
    .route({ method: "PUT", path: "/bookings/{bookingId}/departure" })
    .input(changeDepartureInput)
    .output(extendedStaySchema),

  shortenStay: oc
    // POST, and a different path, because this one is not the same operation
    // with the date the other way round — see {@link changeDepartureInput}.
    .route({ method: "POST", path: "/bookings/{bookingId}/early-departure" })
    .input(changeDepartureInput)
    .output(shortenedStaySchema),
};
