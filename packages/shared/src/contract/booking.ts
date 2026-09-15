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
// authorisation event: it decides who is admitted. Migration 0041's row
// triggers separately record booking writes with the request actor, so the
// audit trail does not depend on each transition remembering to insert it.
// What separates a
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
// **The guest's own routes address a stay by its reference**, and they are the
// only routes here that do — the read, the cancellation and the quote that
// prices it, with `/bookings/mine` naming no stay at all because the question it
// answers is which stays there are. Every other one names a `bookingId`, which is a
// uuid the desk holds and a guest never sees; what a guest was given is the
// eight characters printed on their confirmation. Putting them under
// `/bookings/mine/` rather than at `/bookings/{reference}` is the same choice
// {@link booking.createHold} makes with `/bookings/holds`: a static segment
// marks the door, so the guest's key and the desk's cannot arrive at one path
// pattern and be told apart by their shape. `rbac-matrix.md` grants both rows
// `⚠` — the guard admits the caller and the handler still owes the ownership
// check — and `booking.controller.ts` is where that check is paid.
//
// What is deliberately NOT here:
//
// - **Reading any booking.** `booking.read-any` is a real row and its route is
//   `search.operational`'s neighbour at task 23; there is no staff read method
//   on the service to hang one off yet, and every transition below already
//   answers with the booking it changed. The guest's read is a different row
//   under a different key again, which is why it sits beside it rather than
//   being the same route narrowed by a grant.
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
import {
  isoStayDateSchema,
  type StayDate,
  stayDateSchema,
} from "../stay-date.js";
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

/** The stay itself, as both creating transitions state it. */
const stayFields = {
  roomType: roomTypeCodeSchema,
  checkIn: stayDateSchema,
  checkOut: stayDateSchema,
  // The plan the prices are quoted under, defaulted to the one the other two
  // are derived from — `availability.ts` defaults its search the same way.
  plan: ratePlanCodeSchema.default("STANDARD"),
  ...partyFields,
};

/**
 * Who to write to about the stay, and what to call them.
 *
 * **The name is the half that can stand alone.** No door below takes an address
 * with nobody's name on it: that is not half a contact, it is an unusable one —
 * a message needs somebody at the top of it. A name with no address is the
 * opposite, and it is the ordinary telephone booking: somebody rang, the desk
 * wrote down who was on the other end, and there is no mailbox to send anything
 * to. Refusing that pair threw away the only thing the desk had been given.
 * {@link createBookingInput} makes both halves optional and holds that
 * asymmetry; {@link setHoldContactInput} requires both outright, because a
 * funnel one press from taking money is asking where the confirmation goes.
 *
 * **On the booking and not on `registration`.** A registration row is the legal
 * check-in record — `schema/guest.ts` gives it `is_primary` and `registered_at`,
 * allows one primary per booking and feeds the residence report — so writing one
 * at hold time would file somebody as having checked in to a room they have not
 * seen, and corrupt the occupancy the property reports on. This pair is a far
 * smaller claim: an address the confirmation goes to and a name to put at the
 * top of it.
 *
 * **No phone.** It is verified against a document at check-in, where the desk
 * already collects it, and a number typed into a funnel is neither verified nor
 * needed before the guest arrives.
 *
 * Bounded at the lengths `checkInGuestSchema` bounds the same two facts at, so
 * a guest who books and later registers is not refused at the desk for a name
 * the funnel accepted.
 */
const contactFields = {
  contactEmail: z.email().max(254),
  contactName: z.string().trim().min(1).max(120),
};

/**
 * A departure after an arrival, and a party a room could hold.
 *
 * Predicates rather than two copies of each `.refine()`, because both creating
 * inputs below are the same stay and a rule that drifted between them would let
 * the funnel sell a night the desk refuses. They are structural on purpose —
 * each takes the fields it judges and nothing else, so either schema's inferred
 * type satisfies them without either being named here.
 */
const departsAfterArrival = (stay: { checkIn: StayDate; checkOut: StayDate }) =>
  stay.checkIn.compare(stay.checkOut) < 0;

const partyFitsARoom = (stay: {
  adults: number;
  childAges: readonly unknown[];
}) => stay.adults + stay.childAges.length <= LARGEST_PLAUSIBLE_PARTY;

/**
 * An address never travels without a name.
 *
 * Structural like the two above, and asymmetric on purpose — it used to refuse
 * either half on its own, and half of that rule was wrong. A name with no
 * address is the ordinary telephone booking: the guest is on the line, the desk
 * has written down who they are, and {@link contactFields} says why there is no
 * number to keep beside it. The property can still say whose stay it is and can
 * still hand the confirmation over at the counter, so refusing the pair
 * discarded the one fact the call had produced.
 *
 * An address with no name is the half the original rule was written about, and
 * it stays refused. Nothing composes a message from it: `booking.service.ts`
 * puts a name at the top of the confirmation, the cancellation and the
 * pre-arrival reminder, and a mailbox with nobody's name against it is a
 * recipient the property cannot address rather than a contact it has half of.
 */
const addressIsNeverNameless = (stay: {
  contactEmail?: string;
  contactName?: string;
}) => stay.contactEmail === undefined || stay.contactName !== undefined;

const DEPARTURE_MESSAGE = {
  message: "checkOut must fall after checkIn",
  path: ["checkOut"],
};

const PARTY_MESSAGE = {
  message: `a party of more than ${LARGEST_PLAUSIBLE_PARTY} is not a booking`,
  path: ["childAges"],
};

const CONTACT_MESSAGE = {
  // Against the name and not the address, because the name is the field that is
  // missing: an address arrived, and what it needs is somebody to put at the top
  // of the message. A name on its own is a complete answer and is refused
  // nowhere below.
  message: "an address needs a name to put at the top of the message",
  path: ["contactName"],
};

/**
 * A stay as the desk sells it — the body behind §2's *(new)* → `CONFIRMED`.
 *
 * The stay's price is not a field. §8 has a booking freeze what it was quoted,
 * and the quote is computed inside the transaction that consumes the nights —
 * an amount arriving here would be a price the guest proposed.
 *
 * **The contact pair is optional here, and this is the only creating door that
 * takes it at all.** A stay taken at the desk is `CONFIRMED` from birth, so it
 * never passes through `HELD` and can never reach {@link setHoldContactInput} —
 * without this the property would hold a telephone booking it cannot write to
 * about a cancellation or an arrival, for the whole life of the stay.
 *
 * **Optional and not required, because this one door takes two conversations.**
 * A walk-in is somebody at the counter: the property has them in front of it,
 * takes their document at check-in, and has nowhere to send a confirmation the
 * desk is not already handing over — so an address is genuinely absent rather
 * than forgotten. A telephone booking is the opposite and is the case this
 * field exists for. Nothing on the wire tells the two apart, and a `kind` field
 * would not: it would be a claim the caller makes freely, so the requirement it
 * governed could always be escaped by making the other claim. Which
 * conversation the operator is in is known at the screen and nowhere else, so
 * the desk's own form is where the telephone path insists — `new-booking-form.tsx`.
 *
 * What is *not* optional is a name beside an address —
 * {@link addressIsNeverNameless}. A name on its own is taken, because that is
 * what the telephone leaves behind.
 */
export const createBookingInput = z
  .object({
    ...stayFields,
    contactEmail: contactFields.contactEmail.optional(),
    contactName: contactFields.contactName.optional(),
  })
  .refine(departsAfterArrival, DEPARTURE_MESSAGE)
  .refine(partyFitsARoom, PARTY_MESSAGE)
  .refine(addressIsNeverNameless, CONTACT_MESSAGE);

/**
 * The same stay, from a funnel — §2's *(new)* → `HELD`.
 *
 * **The contact pair is not here, and where it moved to is the point.** It used
 * to be the difference between this door and the desk's: a funnel booking named
 * somebody to write to and a walk-in did not. What that arrangement actually
 * required was a name and an address typed before the guest had seen a total,
 * because the hold is taken the moment a room is chosen — the funnel was asking
 * who you are in order to reserve twenty minutes.
 *
 * The obligation was never the hold's. A hold that expires unpaid is inventory
 * coming back, and the property has nothing to send anybody about it. What must
 * have somebody to write to is a stay that gets **confirmed**, so the pair is
 * collected on the review screen instead — {@link setOwnHoldContact} — and it is
 * there, one press before the money, that the funnel refuses to go on without
 * it.
 *
 * **The desk's door takes the pair and this one still does not, and the
 * asymmetry is the argument above rather than an inconsistency.** What the move
 * refused was asking a stranger who they are in order to reserve twenty
 * minutes; the review screen is one press before the money and is where the
 * funnel asks. A stay taken at the desk has no such screen — it is `CONFIRMED`
 * from birth and never `HELD` — so its only chance to record an address is the
 * creating call, and {@link createBookingInput} is where it takes it. Adding
 * the pair here would put the question back in front of the total for the
 * caller who has not seen one, which is the whole of what the move was for.
 *
 * The stay is {@link createBookingInput}'s, spread from the same fields so the
 * two doors cannot come to disagree about what a stay is. What separates them
 * is the TTL, who may call them, and the contact the desk has no later door
 * for — the first two being what §2 says they are.
 */
export const createHoldInput = z
  .object(stayFields)
  .refine(departsAfterArrival, DEPARTURE_MESSAGE)
  .refine(partyFitsARoom, PARTY_MESSAGE);

/**
 * Naming who the confirmation goes to, against a hold already taken.
 *
 * The other half of the move described on {@link createHoldInput}: the stay
 * exists, the nights are consumed, and this is the guest saying where to write.
 * It is a `PUT` and not a `PATCH` because the pair is one fact — an address with
 * no name to put at the top of it is not half a contact, it is an unusable one —
 * so the body always carries both and always replaces both.
 *
 * Bounded at the same lengths `checkInGuestSchema` bounds the same two facts at,
 * so a guest who books and later registers is not refused at the desk for a name
 * the funnel accepted.
 */
export const setHoldContactInput = z.object({
  bookingId: z.uuid(),
  ...contactFields,
});

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
  /**
   * Who to write to about the stay, once somebody has said — null until then.
   *
   * Answered rather than write-only, and the funnel is why. The pair is named on
   * the review screen, and that screen reads the stay from the API on every
   * paint rather than from anything the tab was carrying — so a guest who types
   * an address, refreshes, and comes back has to find it still there. A field
   * the API took and would not say back is a form that empties itself.
   *
   * Null on the walk-in, which is most stays the desk takes: somebody at the
   * counter has nowhere for a confirmation to go. Set on a telephone booking,
   * which the desk's own door collects it for —
   * {@link createBookingInput} — and `schema/booking.ts` records why the column
   * is shared by every door and required by none.
   */
  contactEmail: z.email().max(254).nullable(),
  contactName: z.string().max(120).nullable(),
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
 * Why a booking was cancelled, minus the two reasons no caller may claim.
 *
 * `HOLD_EXPIRED` is the TTL sweep's — `booking-state.ts` says so, and §3 gives
 * it to the job that fires when the hold runs out. A desk sending it would be
 * filing a guest's change of mind as an abandoned cart, which is the field the
 * cancellation grid prices off: `property-and-tariff.md` §4 charges a request
 * inside the deadline nothing and one outside it the first night, and neither
 * row is the one an expiry takes.
 *
 * `HOLD_REPLACED` is refused on the same grounds and belongs to the same kind of
 * writer. It is the funnel releasing the room a guest just moved off, written
 * inside the transaction that takes the new one, and nothing a person decides —
 * so a desk that could send it would be filing a real cancellation as funnel
 * churn.
 */
export const cancelInput = z.object({
  ...bookingIdFields,
  reason: cancellationReasonSchema.exclude(["HOLD_EXPIRED", "HOLD_REPLACED"]),
});

/**
 * The stay a guest names, addressed by the handle they were given.
 *
 * One schema for both of the guest's own routes, because a guest reading their
 * booking and a guest calling it off state exactly the same thing: which stay.
 * The cancellation carries no reason — `booking.controller.ts` files it as
 * `GUEST_REQUEST`, which is what it is, and a guest who could choose the code
 * could file their own change of mind as the property's mistake.
 *
 * The bound is loose on purpose. `reference-generator.ts` owns the shape and
 * `schema/booking.ts` deliberately does not pin it in the column, so a length
 * spelled out here would be a third copy of a format the property is free to
 * change; what this refuses is an empty string and an unbounded one, which are
 * the two things no generator will ever produce.
 */
export const ownBookingInput = z.object({
  reference: z.string().trim().min(1).max(32),
});

/**
 * The hold a guest is part-way through paying for, named the way the funnel
 * knows it.
 *
 * **By id, because the reference is not what the funnel is holding.**
 * `repository-structure.md` §`(booking)` puts the hold id in the path from the
 * third step on and addresses the finished booking by its reference — two
 * identifiers on purpose, because the steps before payment are about a stay
 * that may never become one. `createHold` answers with both, and this is the
 * address the funnel already has when a guest refreshes `/booking/<hold>/details`
 * or comes back to `/booking/<hold>/payment` an hour later.
 *
 * A uuid rather than the short reference, and that is what makes the two routes
 * different rather than redundant. A reference is eight readable characters a
 * guest reads down a telephone, and `readOwn` answers `NOT_FOUND` for one that
 * is not theirs precisely so that the space cannot be walked; a uuid is not
 * walkable and is what the funnel's own url carries.
 *
 * Scoped to the requester exactly as `readOwn` is — `booking.read-own` is one
 * capability and one condition, and the account comes off the session in both.
 */
export const ownHoldInput = z.object({
  bookingId: z.uuid(),
});

/**
 * The funnel saying the guest is still standing on their hold — or has gone.
 *
 * **A hold used to cost the property the whole of its TTL whatever the guest
 * did.** Somebody who closed the tab thirty seconds in kept a room off the shelf
 * for the remaining nine and a half minutes, and on a night at the anonymous
 * share cap those are the minutes a later guest is refused over. So the funnel
 * says it is still open while it is open, and the sweep releases a hold at the
 * *earlier* of its TTL and a grace after the last of these.
 *
 * **It can only ever shorten a hold.** Nothing here moves the expiry, so a tab
 * left open with a ping running holds its room for one TTL and not a second
 * longer — the abuse the hold caps exist to prevent is not reachable by saying
 * this more often, which is why the sweep takes the earlier of two instants
 * rather than the later.
 *
 * **`leaving` is the same call and not a second door.** A browser can say two
 * useful things on its way past — *still here*, repeated, and *gone*, once, as
 * the tab closes — and both are the same write to the same column. A separate
 * release endpoint would be a second implementation of when a hold may be given
 * back, with its own idea of what to do about money in flight, and the two would
 * agree right up until one of them changed.
 *
 * **Nothing here is a security control.** The door is public and this is a caller
 * volunteering something about themselves, so anybody automating the funnel
 * simply never sends it and keeps their rooms for a full TTL exactly as they do
 * today. No cap was widened in exchange.
 */
export const holdPresenceInput = z.object({
  bookingId: z.uuid(),
  // **Required, and it used to be defaulted.** Every other field of this input
  // is in the path, so a defaulted `leaving` left the ordinary heartbeat with
  // nothing to put in a body — and a request with no body carries no
  // `content-type`, which `json-request.guard.ts` refuses because that is the
  // shape a cross-site form post has. The heartbeat 401'd every twenty seconds,
  // presence was never recorded, and holds fell due a grace after they were
  // taken with their guest still reading the page.
  //
  // Making it required is what keeps the two ends honest: the body cannot
  // vanish on the wire while both sides still typecheck, and a caller that
  // forgets the field fails to compile rather than at a guard. It is a boolean
  // either way — *still here* is `false` and the tab closing is `true`.
  leaving: z.boolean(),
});

/**
 * What a recorded ping answers with — the stay it was recorded against.
 *
 * Not the booking. This route runs every twenty seconds per open funnel and is
 * one `update` by primary key; answering with a stay would mean joining the room
 * type and re-reading a row the caller already has on screen. The id is what the
 * statement already returned, so it costs nothing and it is enough to tell an
 * acknowledgement from an empty 200.
 */
export const holdPresenceSchema = z.object({
  bookingId: z.uuid(),
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
 * A link out of a confirmation email, as the page that received it presents it.
 *
 * The whole credential travels in the body and never in the path or the query.
 * A URL is written to the access log, kept in the browser's history and sent on
 * in a `Referer`; a body is none of those. The page reads the link off its own
 * address and posts it here once.
 *
 * **The address it reads it off carries it in the fragment**, which is the other
 * half of the same rule rather than an exception to it: `booking.service.ts`
 * mints `…/bookings/<reference>#stay=…`, and a fragment is the one part of a URL
 * the browser never puts in a request — so no server between the mailbox and the
 * page, the web tier's own access log included, ever sees it. The page strips it
 * from the address as soon as it has been read.
 *
 * The bound is what `booking-token.service.ts` will look at before it spends a
 * connection: comfortably above the ~150 bytes it mints, and far below what a
 * header used as a buffer carries.
 */
export const bookingLinkInput = z.object({
  link: z.string().min(1).max(512),
});

/**
 * The same link, plus the password the guest may or may not want.
 *
 * **Optional, and it stays optional.** The mail proved the address, so the
 * account can exist without a password at all — and a guest who never sets one
 * still owns the stay. The recovery path is a reset to the address that has
 * already been verified, which creates the credential the sign-up never wrote.
 *
 * No length is stated here on purpose. The floor and the ceiling are the guest
 * realm's, configured in `guest-auth.factory.ts`, and a second copy of them in
 * this file would be a policy that could disagree with the one sign-up enforces.
 */
export const accountFromLinkInput = bookingLinkInput.extend({
  password: z.string().max(256).optional(),
});

/**
 * The stay a redeemed link opens, named both ways it can be.
 *
 * Not the booking. Redeeming a stay link hands the browser the credential and
 * nothing else has happened yet — the page navigates to the stay it names and
 * reads it under the ordinary `read-own` route, where the ownership check lives.
 */
export const redeemedLinkSchema = z.object({
  bookingId: z.uuid(),
  reference: z.string(),
});

/**
 * The same stay, plus the one thing a page that has just followed an account
 * link has to know about itself: whether this browser came away holding a
 * session.
 *
 * **It is not the branch the screen must never make.** Nothing here says
 * whether the address already had an account; it says what happened to *this*
 * request, which the browser is about to discover anyway the moment it asks for
 * anything a session opens. And it is told only to whoever redeemed the link,
 * which is whoever holds the mailbox it was delivered to — a hold created in a
 * stranger's name mints a link that goes to the stranger, so nobody else ever
 * reaches this answer at all.
 *
 * Without it the screen has to guess, and it guessed. `guest-attach.service.ts`
 * signs the browser in on the path that creates the account and deliberately
 * does not on the two that find one already there, so a page that sent every
 * guest on to their profile sent those two to a door their browser cannot open
 * — and took away the sentence offering them the log-in the older account is
 * the only thing that speaks for.
 *
 * Named for what it means rather than for how it travels: the cookies are
 * Better Auth's business, and a field naming them would put the transport on
 * the wire.
 */
export const redeemedAccountLinkSchema = redeemedLinkSchema.extend({
  signedIn: z.boolean(),
});

/**
 * What the desk is told after an account link has been sent again.
 *
 * The address, and it is an answer rather than an echo: the caller never sent
 * one. A receptionist on the telephone has to be able to say where the message
 * went — "it is on its way to a…@gmail.com, look for it now" — and reading it
 * back off the booking is the only way that sentence is about the address the
 * mail was actually addressed to rather than the one the guest just recited.
 *
 * No link, no token and no expiry. Everything spendable is in the mailbox, which
 * is the whole point of a flow whose identity check is a human at a counter: a
 * response carrying the credential would let anyone the desk answers the phone
 * to acquire a stay by talking a receptionist into reading it out.
 */
export const resentAccountLinkSchema = z.object({
  to: z.email(),
  reference: z.string(),
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
    .input(createHoldInput)
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

  // ── The guest's own stay — `FR-GST-01` ─────────────────────────────────────

  readOwn: oc
    .route({ method: "GET", path: "/bookings/mine/{reference}" })
    .input(ownBookingInput)
    .output(bookingSchema),

  readOwnHold: oc
    // A member of the collection the funnel posts to. `POST /bookings/holds`
    // is the door `FR-BOOK-02` gives the funnel and this is the thing that door
    // returned, read back at the address it was given — which is the address
    // `/booking/<hold>/…` already carries. Under `/bookings/mine/` it would
    // have had to be `/bookings/mine/by-id/{bookingId}`, a segment that exists
    // only to say the next one is a different kind of name.
    //
    // It answers a stay in any state, not only `HELD`. The screen that reads it
    // is waiting for exactly the moment it stops being a hold — `confirming/`,
    // where the gateway's redirect lands — and a route that refused a
    // `CONFIRMED` booking would refuse at the instant its caller was waiting for.
    .route({ method: "GET", path: "/bookings/holds/{bookingId}" })
    .input(ownHoldInput)
    .output(bookingSchema),

  setOwnHoldContact: oc
    // A sub-resource of the hold and not a second creating door: the stay is
    // already there, and what this names is one part of it. `PUT` because the
    // pair replaces whatever was on the row — a guest correcting a typo sends
    // both fields again, and the second send is not a second contact.
    //
    // **Only while the stay is `HELD`.** After payment the address is what a
    // confirmation was sent to and what the desk will match a guest against, and
    // a route that could still rewrite it would let a booking's paper trail be
    // edited after the fact. The service refuses any other state.
    .route({
      method: "PUT",
      path: "/bookings/holds/{bookingId}/contact",
    })
    .input(setHoldContactInput)
    .output(bookingSchema),

  markHoldPresence: oc
    // A sub-resource of the hold, beside the contact, and **under `/bookings`**
    // because that is where the credential is. `booking-token.service.ts` scopes
    // the cookie to that path so it is not attached to the availability search or
    // to anything Better Auth mounts — which means a presence route mounted
    // anywhere else would be a route the guest's browser never sends a
    // credential to, and every ping would arrive anonymous.
    //
    // `POST` and not `PUT`. A ping is an event and the resource is the sighting,
    // not a fact about the stay that this replaces: two pings twenty seconds
    // apart are two different things having happened, where two identical
    // contacts are one contact sent twice.
    .route({ method: "POST", path: "/bookings/holds/{bookingId}/presence" })
    .input(holdPresenceInput)
    .output(holdPresenceSchema),

  listOwn: oc
    // The collection the two routes above are members of, and the only one of
    // the guest's routes that names no stay — the question is which stays there
    // are, so there is nothing to put in the path.
    //
    // A bare array and not a page. `FR-GST-01`'s stay history is one account's
    // own bookings at a forty-room property: a guest who has stayed enough times
    // to need a cursor does not exist yet, and a shape that promised paging
    // would have to be honoured by a service that has none.
    //
    // **Reachable by a session and never by a booking token.** A credential
    // scoped to one stay must not enumerate the others — that is the whole of
    // what scoping it means — so this route is the one guest read that a token
    // is refused on. `access.guard.ts` is where that is enforced.
    .route({ method: "GET", path: "/bookings/mine" })
    .output(z.array(bookingSchema)),

  cancellationQuote: oc
    // What calling the stay off would cost, read before deciding to — a GET
    // under the cancellation's own address, because it is that operation's
    // price and not a resource of its own.
    //
    // **A read that writes nothing and holds nothing.** No figure is reserved
    // and no state moves; the number is `cancellation-calculator.ts`'s, computed
    // from the same booking at the same instant the cancellation would be priced
    // at, and a second implementation here would be a quote that could disagree
    // with the charge the folio later posts.
    //
    // It matters because of full prepay. The guest has already paid the stay in
    // full, so the question they are actually asking is how much comes back, and
    // stating only `property-and-tariff.md` §4's rule would leave them
    // subtracting a figure they have never seen.
    //
    // `policyChargeSchema` rather than a shape of its own, and `basis` travels
    // with the amount for the reason that schema gives: a free cancellation and
    // a zero charge are the same number and different facts.
    .route({
      method: "GET",
      path: "/bookings/mine/{reference}/cancellation-quote",
    })
    .input(ownBookingInput)
    .output(policyChargeSchema),

  cancelOwn: oc
    // The same sub-resource the desk's cancellation is a POST to, under the
    // guest's own door. One transition and one price: `booking.cancel-own` and
    // `booking.cancel-policy` are two rows because two different people hold
    // them, not because a guest's cancellation costs something else —
    // `property-and-tariff.md` §4 prices the event against the rate plan and
    // reads neither the reason nor who asked. So this reaches the service method
    // the desk's route reaches, at the grid's price and with no waiver, and the
    // charge is posted later under `folio.refund-policy` exactly as it is for a
    // stay the desk called off.
    .route({ method: "POST", path: "/bookings/mine/{reference}/cancellation" })
    .input(ownBookingInput)
    .output(bookingSchema),

  // ── The confirmation email's two links, and the account they lead to ───────

  redeemStayLink: oc
    // The mailed half of the credential the hold issued — one booking, read and
    // cancel, and never a login. A guest who cleared their cookies, changed
    // device or closed the tab on a shared machine has this and needs nothing
    // else, which is why the cookie's own life can stay bounded.
    //
    // `POST` because it spends something. The link is good once: a mailbox is
    // copied, forwarded and left open, so following it consumes the row that
    // says it has not been followed yet. A `GET` would invite a prefetching mail
    // client to spend it before the guest ever pressed anything.
    .route({ method: "POST", path: "/bookings/stay-links/redemption" })
    .input(bookingLinkInput)
    .output(redeemedLinkSchema),

  createAccountFromLink: oc
    // The other link in the same envelope, and the only place the funnel
    // branches on whether an address is registered. It is mailed only to an
    // address that has none, so the account it creates arrives with the address
    // already verified — the message went there, and following it from there is
    // the proof a second verification mail would ask for twice.
    //
    // The address is read off the booking and is never sent. A caller who could
    // name the address would be naming which account this creates, which is the
    // whole of what the link is for.
    .route({
      method: "POST",
      path: "/bookings/account-links/redemption",
      successStatus: 201,
    })
    .input(accountFromLinkInput)
    .output(redeemedAccountLinkSchema),

  attachToAccount: oc
    // The registered guest's path, which needs no mail at all: the session
    // proves the account and the booking cookie proves the stay, and both
    // present on one request is the trigger. Nothing about which stay is in the
    // body beyond the id the credential must already name.
    //
    // A sub-resource of the booking, singular, because a stay has one owner —
    // and the service refuses to move one that is already set.
    .route({ method: "POST", path: "/bookings/{bookingId}/attachment" })
    .input(z.object(bookingIdFields))
    .output(bookingSchema),

  resendAccountLink: oc
    // The desk's answer to a guest who has lost both the confirmation email and
    // the browser that held the stay. Every self-serve way back in is gone by
    // then — `booking.service.ts`'s `scopedTo` opens a stay to an anonymous
    // caller by the booking id in the cookie and by nothing else, and a
    // reference alone deliberately opens nothing — so what is left is somebody
    // at the property identifying the guest and pressing this.
    //
    // **By `bookingId`, like every other route the desk reaches.** The comment
    // at the top of this file draws that line: a uuid is what the desk holds and
    // a reference is what a guest was given, and the two are kept at different
    // paths so a guest's key and the desk's cannot arrive at one pattern and be
    // told apart by their shape. The desk has the stay open in front of it here,
    // which is exactly the circumstance in which it has the id.
    //
    // **The address is not in the input and must never be.** It is read off the
    // booking, the way `guest-attach.service.ts` reads it: a caller who could
    // name where the link goes could hand any stay to any mailbox, and a member
    // of staff persuaded by a plausible telephone call is precisely the attack
    // the out-of-band identity check is supposed to be. Changing where a stay's
    // post goes is a different act with its own authority.
    //
    // A sub-resource, plural, and a `POST`: each call mints a new link. That is
    // the difference between this and the redemption above, which spends one.
    .route({
      method: "POST",
      path: "/bookings/{bookingId}/account-links",
      successStatus: 201,
    })
    .input(z.object(bookingIdFields))
    .output(resentAccountLinkSchema),
};
