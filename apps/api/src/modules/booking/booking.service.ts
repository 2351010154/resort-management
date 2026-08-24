// Taking a booking, confirming it and giving it back — `FR-BOOK-01`,
// `FR-BOOK-02`, and the first four cells of `booking-state-machine.md` §2.
//
// Everything here is one shape: read the current state, ask the table in
// `state-machine.ts` whether the move is allowed, apply §3's inventory effect,
// then write the row. What makes it correct is what it does NOT do.
//
// **It does not open a transaction.** `database.module.ts` says why a write
// takes its executor: a transition consumes inventory, writes a booking and its
// nights, and at `M6` will post a folio line and record a payment beside them.
// All of that is one commit, and only the caller can draw a boundary that wide.
// The `TransactionRunner` sits at the controller.
//
// **It does not touch `type_inventory`.** Every night consumed or released goes
// through `InventoryService`, which is the only path that takes the row locks in
// stay-date order and lets `type_inventory_sold_at_most_total` refuse an
// oversell. `NFR-01` is a claim about fifty simultaneous requests, and a second
// path to the counter is how that claim quietly stops being true.
//
// **It does not check-then-write.** The reference's uniqueness is the unique
// index's to enforce, the cancellation reason's presence is a `CHECK`'s, and a
// sold-out night is the counter's. This reads their answers rather than
// anticipating them.
//
// Idempotency is a guard and not an error — §4. A retried request, a
// double-clicked button and a job that ran twice all arrive as the transition
// that already happened, and each returns the current state without repeating
// the effect. That last part is the whole of it: a second `cancel` that answered
// politely and released the nights again would credit the property with
// inventory it never sold.
//
// Check-in and check-out are here and the operations of §5 are not, which is the
// line §5 itself draws: those change no state and are `assignment.service.ts`'s.
// These two do, and each is the transition plus the effects §3 gives it — so
// they read a business date, an assignment, a housekeeping status and a folio
// balance, and hand each answer to the pure guard that judges it. The guards
// stay pure and this file stays the one place a booking's state changes.

import { parseDate } from "@internationalized/date";
import {
  PROPERTY_TIME_ZONE,
  type BookingState,
  type CancellationReason,
  type LoyaltyTier,
  type Party,
  type RatePlanCode,
  type RoomTypeCode,
  type StayDate,
  type VndAmount,
} from "@mariva/shared";
import { Inject, Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { and, asc, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { ENV, type Env } from "../../config/env.js";
import type { DbExecutor } from "../../database/database.module.js";
import {
  booking,
  type BookingRow,
  bookingNight,
} from "../../database/schema/booking.js";
import { folio } from "../../database/schema/folio.js";
import { registration } from "../../database/schema/guest.js";
import { roomAssignment, roomType } from "../../database/schema/inventory.js";
import { payment } from "../../database/schema/payment.js";
import { afterCommit } from "../../database/transaction-runner.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import { accountForAddress } from "../auth/guest/registered-address.js";
import { GuestService, type NewGuest } from "../guest/guest.service.js";
import { TierDerivationService } from "../guest/tier-derivation.service.js";
import { BookingCancellationService } from "../notification/booking-cancellation.service.js";
import { BookingConfirmationService } from "../notification/booking-confirmation.service.js";
import { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { AssignmentService, type HeldRoom } from "./assignment.service.js";
import { BusinessDateService } from "./business-date.service.js";
import { hashedCaller } from "./caller-key.js";
import { type PolicyCharge, policyCharge } from "./cancellation-calculator.js";
import {
  validateArrivalWindow,
  validateRoomAssigned,
  validateRoomReady,
} from "./guards/check-in.guard.js";
import { validateFolioSettled } from "./guards/check-out.guard.js";
// The one thing this file borrows from the limiter in front of it: how a wait is
// spelled. The two 429s on this door quote two different configured figures and
// have to say them the same way — see {@link minutesInWords}.
import { minutesInWords } from "./hold-rate-limit.guard.js";
import {
  accountLinkUrl,
  bookingPageUrl,
  stayLinkUrl,
} from "./mailed-link-urls.js";
import { FOLIO_PORT, type FolioPort } from "./ports/folio.port.js";
import { applyTransition, LEGAL_TRANSITIONS } from "./state-machine.js";
import { retryOnCollision } from "./reference-generator.js";
import { assertFunnelMaySell } from "./stay-restriction-guard.js";
import { StayQuoteService } from "./stay-quote.service.js";

const MS_PER_MINUTE = 60_000;

/**
 * How many rooms one caller may be holding at once through the public funnel.
 *
 * Three, and the figure is about what a person does rather than about what a
 * script cannot. A guest takes one hold; the guest who changes their mind about
 * a room type takes a second while the first runs out its TTL, and a household
 * behind one address does that twice over. Past three the caller is not
 * shopping — they are keeping rooms off the shelf, which at a forty-room
 * property is a measurable share of a night for the ten minutes it lasts.
 *
 * This is the bound `hold-rate-limit.guard.ts` cannot state. That limiter is a
 * rate, so it says how often a caller may ask and nothing about how much is
 * outstanding when they stop asking; and it lives in one process, so a restart
 * or a second machine forgets it. A count of live rows forgets nothing.
 */
const CONCURRENT_HOLDS_PER_CALLER = 3;

/**
 * The fewest anonymous holds a night must admit however full it is.
 *
 * The floor is deliberate, and the plain "half of what is left" rule is what it
 * is protecting against. On a night with two rooms free, half is one, and the
 * second genuine guest of the evening would be turned away on the busiest and
 * most valuable night the property has — to stop an abuser from holding a
 * single room. The share cap exists to stop a stranger taking a night's
 * inventory wholesale; it must not become the reason a nearly-full night stops
 * selling.
 */
const ANONYMOUS_HOLD_FLOOR = 2;

/**
 * How much of the grace a browser saying goodbye keeps.
 *
 * A departing tab backdates its own last sighting so the hold falls due almost
 * at once — see {@link BookingService.markPresence} — and this is the "almost".
 * It is not the grace in miniature and it is not configuration: it is the width
 * of one event the browser cannot describe honestly. `pagehide` fires on a close,
 * on a reload and on a back-forward navigation alike, so a departure that fell
 * due the instant it landed would let the sweep take a hold in the second between
 * a guest pressing refresh and the reloaded page saying it is still there.
 *
 * Twenty seconds, which is a reload, a bad connection's worth of one, and a
 * page-restore from the back button — and which still leaves a genuinely closed
 * tab reclaimed in a fraction of the grace it would otherwise have run out.
 */
const DEPARTED_HOLD_REPRIEVE_SECONDS = 20;

/**
 * How much of a night's remaining rooms may be held by callers who are not
 * signed in.
 *
 * A half, so a night is never more than about half-held by people the property
 * cannot contact, and never below {@link ANONYMOUS_HOLD_FLOOR}. A signed-in
 * guest is outside this entirely: an account is a name, an address the property
 * verified and a stay history, so a hold behind one is a booking that can be
 * chased rather than an anonymous claim on a room.
 */
function anonymousHoldCeiling(remaining: number): number {
  return Math.max(ANONYMOUS_HOLD_FLOOR, Math.floor(remaining / 2));
}

/** What a stay is sold as. The price is not in here — see `stay-quote.service.ts`. */
export interface CreateBookingInput {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly party: Party;
  /**
   * The signed-in account that made the booking, when there was one.
   *
   * Optional, and absent on most of them. The desk takes a walk-in from
   * somebody who has never logged in and never will, and `schema/booking.ts`
   * keeps the column nullable for exactly that stay. What it is *not* is a
   * field a caller may choose: `booking.controller.ts` takes it off the
   * session, because an account id arriving in a body is a guest claiming
   * somebody else's bookings.
   */
  readonly userId?: string | null;
  /**
   * Where the confirmation goes and what to call the person it goes to.
   *
   * Absent on a walk-in, which is `contract/booking.ts`'s split carried down
   * here: somebody at the counter has nowhere to send anything. Present on a
   * telephone booking, which the desk's door is the only chance to record one
   * for — that stay is `CONFIRMED` from birth and never reaches
   * {@link BookingService.setHoldContact}. Absent on every hold, because the
   * funnel names the pair a press before the money instead.
   *
   * Unlike {@link CreateBookingInput.userId} this *is* a value the caller
   * sends, and it is not authority — it is an address to write to, claimed by
   * whoever booked, and nothing is granted by holding it. `schema/booking.ts`
   * says why it is not a `registration` row.
   *
   * A {@link ClaimedBookingContact} and not a {@link BookingContact}, because
   * the address is the half a telephone call does not always produce. A name on
   * its own is recorded as it arrived; what cannot arrive is an address with
   * nobody's name against it, which `contract/booking.ts` refuses at the door.
   */
  readonly contact?: ClaimedBookingContact | null;
}

/**
 * The same stay, from the one door a stranger can write through.
 *
 * The extra field is not about the booking: it is who asked for it, and it is
 * there because the two limits on that door — a rate in this process and a count
 * of live holds in SQL — have to agree about who a caller is. `caller-key.ts`
 * is that definition, and `booking.controller.ts` reads it off the request the
 * proxy handed over.
 */
export interface CreateHoldInput extends CreateBookingInput {
  /**
   * The caller key, or null when nothing asked over HTTP.
   *
   * Null is a real answer and not a missing value: a seed, a fixture and a
   * service call have no request behind them, and a hold taken that way is
   * outside the concurrent cap because there is no caller to count it against.
   * The raw key crosses this boundary and never reaches a column —
   * {@link BookingService.createHold} hashes it, for the reason
   * `caller-key.ts` gives.
   */
  readonly caller?: string | null;
  /**
   * The hold this browser is already carrying, released once the new one is
   * taken — {@link BookingService.createHold}.
   *
   * **Not a field of the wire contract, and it must not become one.** It is the
   * booking the caller's own credential names, read off the `mariva_booking`
   * cookie by `booking.controller.ts` and never off the body: a booking id a
   * caller could send would be a way to ask the property to cancel a stay they
   * merely know the id of. The cookie is already on the wire here because
   * `booking-token.service.ts` scopes it to `/bookings`, so nothing had to be
   * added to the request for this to be readable.
   *
   * Null on every other path. The desk takes no hold, a seed carries no cookie,
   * and a guest's first room pick has nothing to move off.
   */
  readonly replaces?: string | null;
}

/** Somebody to write to about a stay. No phone — it is taken against a
 *  document at check-in, where the desk already asks for it. */
export interface BookingContact {
  readonly email: string;
  readonly name: string;
}

/**
 * Somebody the desk was told about, which is not always somebody it can write
 * to.
 *
 * A second shape rather than a widened {@link BookingContact}, because the two
 * doors are genuinely asking different questions and only one of them can insist
 * on an answer. The funnel names its guest on the review screen, one press before
 * the money, so {@link SetHoldContact} can require an address and does — keeping
 * that rule in the type means no future caller of
 * {@link BookingService.setHoldContact} can pass half a contact, whatever a
 * comment asks them to remember. The desk's creating door is the telephone: a
 * call produces a name reliably and an address only when the guest has one to
 * give, and `contract/booking.ts` argues why a name alone is worth recording
 * rather than refusing — the property can still say whose stay it is.
 *
 * The name is what is required here. An address with nobody's name against it is
 * the half nothing can compose a message from, and the contract refuses it before
 * anything reaches this module.
 */
export interface ClaimedBookingContact {
  readonly email?: string | null;
  readonly name: string;
}

/**
 * A booking as the rest of the application sees it.
 *
 * Dates come back as `StayDate` and not as the ISO text the column holds —
 * `NFR-12`, and the same crossing `closure.service.ts` performs. The controller
 * encodes them for the wire, once, where it can be seen.
 */
export interface Booking {
  readonly id: string;
  readonly reference: string;
  /** The account that booked it, or null on every stay the desk took. */
  readonly userId: string | null;
  /**
   * Who the confirmation goes to, or null while nobody has said.
   *
   * Null is the ordinary state of a fresh hold now, not an anomaly: the funnel
   * takes the room first and asks who is taking it on the review screen —
   * {@link BookingService.setHoldContact}. It stays null forever on a walk-in,
   * which is most of what the desk takes, and is set at creation on the
   * telephone booking that has nowhere else to record one.
   */
  readonly contactEmail: string | null;
  readonly contactName: string | null;
  readonly state: BookingState;
  readonly cancellationReason: CancellationReason | null;
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly adults: number;
  readonly childAges: readonly number[];
  readonly stayTotalGross: VndAmount;
  /** Set only while the booking is `HELD`. */
  readonly holdExpiresAt: Date | null;
}

/**
 * A reference the unique index already holds.
 *
 * Not exported, because it never leaves the retry loop below. It exists so that
 * `retryOnCollision` — which is written around a thrown error — can be driven by
 * an insert that deliberately does not throw one. See {@link BookingService}'s
 * `create` for why the insert cannot.
 */
class ReferenceTaken extends Error {
  constructor(reference: string) {
    super(`booking reference ${reference} is already issued`);
    this.name = "ReferenceTaken";
  }
}

/**
 * Somebody to register at check-in: a person the property has met before, or a
 * record it is creating now.
 *
 * Both, because the property genuinely has both. A returning guest already has
 * a row — `guest.ts` refuses a second one carrying the same CCCD, and rightly —
 * so a check-in that could only create would turn every repeat visit into a
 * duplicate-number conflict at the desk. Discriminated by the presence of an id
 * rather than by a tag field: `NewGuest` requires a name and this does not have
 * one, so the two shapes cannot be confused by a caller or by the compiler.
 */
export type CheckInGuest = { readonly guestId: string } | NewGuest;

/**
 * One stay, named the way its guest names it and scoped to the account asking.
 *
 * The two travel together because neither is an address on its own. A reference
 * identifies a booking to whoever holds it, and the account is what makes the
 * request about *their* booking rather than about that one — so the pair is the
 * lookup key, and there is no method here that takes the reference alone.
 */
export interface OwnBooking {
  readonly reference: string;
  readonly owner: BookingOwner;
}

/**
 * What makes a stay the caller's — an account, or one stay they have proved.
 *
 * Two credentials and one `where` clause, which is the point of the union. A
 * signed-in guest owns every booking filed under their account, so the scope is
 * the account; a guest who booked without one holds a credential naming a
 * single stay, so the scope is that stay's id. Neither is a comparison made
 * after the row arrives, and neither is a value a caller may send:
 * `booking.controller.ts` builds this from what the guard resolved and from
 * nothing in the body.
 *
 * `proven` carries the id rather than the reference even where the route
 * addresses the stay by reference, because the id is what the credential was
 * minted against and the reference is what the caller typed. The two must agree
 * for a row to come back, and that is the whole of the ownership check on this
 * branch.
 */
export type BookingOwner =
  | { readonly kind: "account"; readonly userId: string }
  | { readonly kind: "proven"; readonly bookingId: string };

/**
 * The same pair, keyed by the id the funnel carries instead of the reference.
 *
 * A separate shape rather than a reference that is sometimes a uuid, so that a
 * caller cannot pass one where the other is meant and have it fail as an empty
 * result. The scope half is identical and identical for the same reason: the
 * account is the session's, and it is what makes this a request about the
 * caller's own stay rather than about that id.
 */
export interface OwnHold {
  readonly bookingId: string;
  readonly owner: BookingOwner;
}

/** Naming who to write to, against a hold the caller has already proved. */
export interface SetHoldContact extends OwnHold {
  readonly contact: BookingContact;
}

/**
 * The funnel saying whether the guest is still standing on their hold.
 *
 * Two facts and not one, because the browser can say two useful things and only
 * one of them is a heartbeat: *still here*, repeated while the funnel is open,
 * and *gone*, sent once as the tab closes. Both are the same write to the same
 * column — see {@link BookingService.markPresence} — which is what keeps the
 * departure from being a second release path with its own idea of the rules.
 */
export interface HoldPresence extends OwnHold {
  /** True on the way out of the page, false on an ordinary heartbeat. */
  readonly leaving: boolean;
}

/**
 * The stay money landed on, as {@link BookingService.confirmPaidHold} found it.
 *
 * The reference rather than the id, because the one thing read off this is a
 * sentence somebody has to act on: the reference is what the desk searches by
 * and what the guest quotes, and a uuid would send a responder to a console to
 * turn it into one.
 *
 * Nothing constructs this outside that method. It is a report and not a request
 * — which is why it carries no amount and no gateway id: those belong to the
 * payment, and the payment is the caller.
 */
export interface PaidStay {
  readonly reference: string;

  /** The state the money arrived at, before any transition it caused. */
  readonly state: BookingState;
}

@Injectable()
export class BookingService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly quotes: StayQuoteService,
    private readonly businessDate: BusinessDateService,
    private readonly assignments: AssignmentService,
    private readonly guests: GuestService,
    private readonly housekeeping: HousekeepingService,
    @Inject(FOLIO_PORT) private readonly folio: FolioPort,
    @Inject(ENV) private readonly env: Env,
    // The two the confirmation mail needs, and they arrive last so that adding
    // them moved no existing argument. One mints the pair of links the message
    // carries; the other composes the message and hands it to the queue.
    private readonly bookingTokens: BookingTokenService,
    private readonly confirmations: BookingConfirmationService,
    // §7's ladder, read at the moment of sale and nowhere else in this file.
    // The tier is what gates the member discount `stay-quote.service.ts`
    // applies, and this is the only place in the booking path that knows which
    // guest — if any — is buying.
    private readonly tiers: TierDerivationService,
    // The message that closes a stay, and last for the reason the confirmation's
    // two arrived last: adding it moved no existing argument. Separate from the
    // confirmation rather than a second method on it —
    // `notification.module.ts` argues that a caller which could reach for
    // either would eventually reach for the wrong one.
    private readonly cancellations: BookingCancellationService,
  ) {}

  /**
   * The public funnel's booking — §2's *(new)* → `HELD`, with a TTL running.
   *
   * `FR-BOOK-02` gives only the funnel this door. The nights are consumed in
   * full at this point and not at payment, because a hold that did not consume
   * them would be a room two guests could reach the payment step for.
   *
   * This is also the only door the property's stay restrictions close.
   * `stay-restriction-guard.ts` argues the split at length: the funnel obeys the
   * published minimum stay and the closed dates, and the desk below overrides
   * them the way a desk does.
   *
   * It is the door an account most often arrives at, and still not always: the
   * funnel takes a booking from somebody who never signed in, and that stay is
   * reachable by its reference and by nothing else. When the caller *is* signed
   * in, `input.userId` is what {@link isOwner} will later match on.
   *
   * **Two refusals stand in front of the sale, and the order they run in is the
   * argument for them being here at all.** `hold-rate-limit.guard.ts` opens by
   * saying that a refused call must not have priced a stay, consumed a night or
   * spent a reference — that is why the rate is a guard rather than a check
   * inside the handler — and these two keep the same property by running before
   * anything below them reads a rate or moves a counter. What they add is the
   * two things a rate cannot say: how much one caller may be holding at once,
   * and how much of a night may be held by people the property cannot contact.
   *
   * The property's own published rules sit between them, deliberately. A stay
   * that breaks a two-night minimum is refused for breaking it rather than for
   * the anonymous share of a night the guest was never going to be sold — the
   * refusal a guest can act on is the one they should get.
   *
   * **Picking a room is a move and not only a creation.** A guest comparing
   * three room types used to leave three rooms held, because nothing released
   * the one they had walked away from — so a person browsing normally reached
   * the cap above that exists for people who are not. The room the caller's own
   * cookie names is released here, in this transaction, and
   * {@link BookingService.releaseReplacedHold} is where the two conditions on
   * that are argued.
   */
  async createHold(exec: DbExecutor, input: CreateHoldInput): Promise<Booking> {
    // Hashed once, here, and passed down. The raw key is the address the proxy
    // reported and it goes no further than this line — `caller-key.ts` argues
    // why a digest is enough for a cap whose only question is whether two
    // requests came from the same caller.
    const heldBy = input.caller
      ? hashedCaller(input.caller, this.env.BETTER_AUTH_SECRET)
      : null;

    await this.assertCallerHoldsFewEnough(exec, heldBy);
    await assertFunnelMaySell(exec, input);
    await this.assertAnonymousShareIsFree(exec, input);

    // Taken first, released second, and the order is the whole of the safety
    // here. A guest whose new room is refused — sold out, or past the anonymous
    // share of that night — still holds the room they had, and their cookie
    // still names it: the refusal rolls this transaction back, and there is
    // nothing to roll back if the release ran first and the creation then
    // failed. The cost is that the caller counts two live holds for the length
    // of this transaction, which is what the headroom in
    // {@link CONCURRENT_HOLDS_PER_CALLER} absorbs.
    const taken = await this.create(exec, input, "HELD", heldBy);

    await this.releaseReplacedHold(exec, input.replaces ?? null, heldBy);

    return taken;
  }

  /**
   * The room the guest just moved off, put back on the shelf.
   *
   * **Two conditions, and neither is redundant.** The cookie is the authority
   * for "mine" — it is signed, it is `httpOnly`, and it names one stay — so it
   * decides *which* hold is being moved off. The caller digest is the second
   * lock: a cookie copied out of one browser and replayed from another network
   * would otherwise cancel a hold the copier is not holding, and the digest is
   * the one fact about the original request that a lifted cookie does not carry.
   * On a shared address the digests agree and the cookie is what keeps two
   * guests behind one router out of each other's rooms.
   *
   * **Only a row that is still `HELD`.** A stay the guest has paid for is
   * `CONFIRMED` and a stay the sweep has reached is `CANCELLED`, and neither is
   * a room this caller is holding. `for update` rather than a plain read, for
   * the reason `hold-expiry-sweep.ts` gives at the same statement: under `read
   * committed` Postgres re-evaluates the predicate once it has the row's lock,
   * so a hold that a concurrent payment confirmed while this statement waited
   * drops out of the result instead of being cancelled a moment later — and §3
   * would have allowed that cancellation, since `CONFIRMED → CANCELLED` is
   * legal. Getting that wrong cancels a room out from under a guest who has
   * just paid for it.
   *
   * **And never a stay whose anonymous credential has been given up.** The
   * cookie above is verified by arithmetic and reads no row, so it goes on
   * naming a stay long after the guest surrendered it — and a stay is
   * surrendered by being attached to an account, which `attachToAccount` does
   * without waiting for it to leave `HELD`. Without this conjunct, a guest who
   * claimed their stay in a lobby browser and walked away leaves a cookie that
   * releases their room for the next person on that address, whose digest
   * matches because the digest is of the address. `scopedTo` carries the same
   * column for the same reason, and it costs the same here: another conjunct on
   * a `where` that was already going to read this row.
   *
   * **And never a hold with money in flight.** The state above answers for money
   * that has *arrived*; it says nothing about money on its way. A guest sent to
   * the gateway is looking at a QR code in a banking app while their tab still
   * sits on the funnel, so coming back to compare one more room is an ordinary
   * thing to do — and releasing that room would hand it to somebody else while
   * the guest is paying for it. A room the guest may already have paid for is
   * not a room they have moved off, and the cost of reading that wrong is money
   * arriving for inventory the property has given away. `PENDING` is the whole
   * of "in flight": `schema/payment.ts` defines it as money claimed and not yet
   * confirmed, and the other three members are what became of money that
   * settled.
   *
   * Silent when nothing matches, because every way of not matching is ordinary:
   * a first room pick, a cookie from a stay that has since been paid for or
   * expired, a browser whose cookie outlived the hold it named, a guest who left
   * an attempt open. None of them is a reason to refuse the room the guest is
   * asking for now — the abandoned one runs out its TTL and the sweep takes it,
   * which is a hold nobody is worse off for.
   */
  private async releaseReplacedHold(
    exec: DbExecutor,
    replaces: string | null,
    heldBy: string | null,
  ): Promise<void> {
    // Nothing to move off, or nobody to match against — a hold taken with no
    // request behind it has no caller for the digest half of the check, so the
    // cookie would be standing on its own.
    if (!replaces || !heldBy) {
      return;
    }

    const [previous] = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(
        and(
          eq(booking.id, replaces),
          eq(booking.state, "HELD"),
          eq(booking.heldBy, heldBy),
          isNull(booking.anonAccessRevokedAt),
        ),
      )
      .limit(1)
      .for("update");

    if (!previous) {
      return;
    }

    // Asked after the row above is locked, so an attempt opened while this
    // statement waited is one this transaction can still see. The lock is on the
    // booking and not on the attempt, so it does not stop `payment.service.ts`
    // inserting one a moment later — what it buys is that the two decisions
    // about one stay cannot interleave in the window that matters, and the
    // property's answer to the rest is the reconciliation `FR-PAY-05` runs.
    if (await this.hasPaymentInFlight(exec, previous.id)) {
      return;
    }

    // Never `GUEST_REQUEST`. The guest cancelled nothing — they changed rooms —
    // and `booking-state.ts` argues why the property's cancellation rate must
    // not become a count of how many room types people compare.
    //
    // **It costs the guest nothing, and it costs them nothing the way
    // `HOLD_EXPIRED` does.** This is the same {@link BookingService.cancel} the
    // sweep calls, and that method releases nights and writes a row — it posts
    // no money at all. §4's charge is `folio.refund-policy`'s, which a manager
    // raises against a folio, and `cancellation-calculator.ts` prices it from a
    // plan, an arrival and a count of nights — it is handed no reason at all, so
    // there is no branch a reason could steer into a charge. That is the
    // structural argument and not "a hold has no folio": a hold whose payment
    // attempt failed does have one, has no `PENDING` payment, and is therefore
    // still a hold this method releases. So a room change cannot reach a charge,
    // which is the one failure this whole transition must not have.
    //
    // Not waived either, for the reason the sweep gives: a waiver is an
    // authority a manager exercises, and recording one here would say a penalty
    // had been set aside when there was never a penalty.
    await this.cancel(exec, {
      bookingId: previous.id,
      reason: "HOLD_REPLACED",
      waivedBy: null,
    });
  }

  /**
   * Whether money for this stay is on its way but has not arrived.
   *
   * The one definition of "in flight" in the tree, because two of them would
   * drift and the failure that drift produces is a room sold twice: every path
   * that releases a hold — the room a guest moved off, the hold whose guest
   * stopped being present — has to refuse the same set of stays, and a second
   * copy of this join would be a second opinion about which those are.
   *
   * `PENDING` is the whole of it. `schema/payment.ts` defines it as money claimed
   * and not yet confirmed, and the other three members are what became of money
   * that settled — so a stay whose only attempt failed is not in flight and is
   * releasable, which is right: nothing is coming for it.
   *
   * Read through the tables rather than through a service. `payment.service.ts`
   * depends on this file, so asking it would be a cycle, and a port for one
   * predicate would be a port with one caller; the schema is dependency-free and
   * is the same shape both readers agree on.
   *
   * It takes no lock of its own. A caller that has to act on the answer locks the
   * booking first — {@link BookingService.releaseReplacedHold} and
   * `hold-expiry-sweep.ts` both do — because what has to be impossible is the two
   * decisions about one stay interleaving, not the attempt table standing still.
   */
  async hasPaymentInFlight(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<boolean> {
    const [inFlight] = await exec
      .select({ id: payment.id })
      .from(payment)
      .innerJoin(folio, eq(folio.id, payment.folioId))
      .where(and(eq(folio.bookingId, bookingId), eq(payment.status, "PENDING")))
      .limit(1);

    return inFlight !== undefined;
  }

  /**
   * Refuses a caller already holding {@link CONCURRENT_HOLDS_PER_CALLER} rooms.
   *
   * The count is of live holds and not of holds taken: `hold_expires_at > now()`
   * is what makes an abandoned funnel session stop costing the caller their
   * allowance the moment the TTL passes, whether or not `hold-expiry-sweep.ts`
   * has reached the row yet. Between the expiry and the sweep a booking is
   * `HELD` and holding nothing anybody should be charged for, and a cap that
   * counted it would make the sweep's cadence part of the policy.
   *
   * No lock, and no `for update`. Two requests from one caller arriving together
   * can both read three and both be admitted, which is a fourth room held for
   * one TTL by a caller who worked for it — and the alternative is every hold on
   * the public door serialising against every other hold from the same address.
   * This is a cost imposed on automation, not an invariant, and
   * `type_inventory_sold_at_most_total` is still the thing that cannot be raced.
   *
   * 429 rather than 409, because the answer is "not yet" rather than "not this
   * stay": the same room is sellable to this caller ten minutes from now, and
   * `hold-rate-limit.guard.ts` already teaches the funnel what that status means
   * on this route.
   *
   * **Who reads this refusal decided how it is written.** It used to tell the
   * caller they were holding three rooms and to finish or drop one of them,
   * which was addressed to somebody working through the funnel three times over.
   * Since {@link BookingService.releaseReplacedHold} made a room pick a move,
   * one browser holds one room however many types it compares — so a person
   * browsing normally cannot reach this any more, and the caller who does is
   * three strangers behind one router. Telling them they hold three rooms is
   * false, and telling them to drop one is an instruction they cannot carry out.
   *
   * So the sentence claims nothing about the reader and nothing about who else
   * is behind their address: it says holding is closed here for now, and it says
   * how long that lasts. The wait is real and it is bounded — the count above is
   * of *live* holds, so the allowance comes back as each one's `hold_expires_at`
   * passes and not when the sweep gets to the row, which puts the whole of it
   * within one TTL — or within a TTL and a payment window on a hold whose guest
   * has been sent to a gateway, since {@link extendHoldForPayment} is what moves
   * that deadline. The sentence quotes the TTL because that is the wait a caller
   * who is not paying for anything faces, and it is the figure the funnel's other
   * refusals already name. Signing in is not offered, because it is not an escape from
   * this one: the cap counts a caller's rows whether or not an account is behind
   * them, and only `assertAnonymousShareIsFree` lets an account through.
   */
  private async assertCallerHoldsFewEnough(
    exec: DbExecutor,
    heldBy: string | null,
  ): Promise<void> {
    if (!heldBy) {
      return;
    }

    const [live] = await exec
      .select({ holds: count() })
      .from(booking)
      .where(
        and(
          eq(booking.heldBy, heldBy),
          eq(booking.state, "HELD"),
          gt(booking.holdExpiresAt, sql`now()`),
        ),
      );

    if ((live?.holds ?? 0) >= CONCURRENT_HOLDS_PER_CALLER) {
      // The reply says nothing about the property's inventory, because a
      // refused call has not looked at any — the same line the limiter's own
      // message keeps. It says nothing about the caller's neighbours either:
      // "three rooms are held from your address" is a fact about strangers, and
      // a refused caller is owed the wait rather than the reason for it.
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: `Rooms cannot be held from this connection at the moment. A hold lasts at most ${minutesInWords(this.env.BOOKING_HOLD_TTL_MINUTES)}, so try again after that.`,
      });
    }
  }

  /**
   * Refuses a hold that would take more of a night than callers without an
   * account may hold between them.
   *
   * The cap is per night and per room type, which is the unit inventory is sold
   * in — a stay is refused on the first of its nights that is already at the
   * ceiling, because that is the night the guest would have to move.
   *
   * **A signed-in guest is not subject to it, and that is the message.** An
   * account is a verified address and a stay history; a hold behind one can be
   * chased, reminded and read back. So the refusal is not "the property is
   * full" — it is not, or `reserve` would be the one refusing — it is an
   * invitation to become somebody the property can contact, and the sentence has
   * to say so or the guest reads a sell-out where there is inventory left.
   *
   * The two figures come from the two modules that own them.
   * `inventory.service.ts` owns what a free room is and reads it through this
   * transaction; the count of anonymous holds is read off `booking` here,
   * because a hold is a booking and this file is where §3's effects live. What
   * is *not* recomputed anywhere is availability: no `sold_rooms` arithmetic
   * appears in this file, for the reason `hold-expiry-sweep.ts` gives at length
   * about restating §3 in a second place.
   *
   * **The one sentence on this door that may name other guests**, and it names
   * them because the escape depends on it: a refusal that hid why signing in
   * takes the room would be an invitation with no argument behind it. What it
   * still does not do is describe the property — it says the night is short of
   * *anonymous* room rather than short of rooms, which is why a guest reads an
   * invitation here instead of a sell-out. The wait beside it is the same TTL
   * the concurrent cap quotes: every hold being counted is a live one, so each
   * of them is gone within a TTL of now, and the guest who would rather not sign
   * in is given the figure instead of "a few minutes".
   */
  private async assertAnonymousShareIsFree(
    exec: DbExecutor,
    input: CreateHoldInput,
  ): Promise<void> {
    if (input.userId) {
      return;
    }

    const free = await this.inventory.remaining(exec, input);
    const anonymous = await this.anonymousHoldsPerNight(exec, input);

    for (const [night, remaining] of free) {
      const held = anonymous.get(night) ?? 0;

      if (held + 1 > anonymousHoldCeiling(remaining)) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: `Too many rooms of that type on ${night} are held by guests who have not signed in. Sign in and this hold is yours, or try again in ${minutesInWords(this.env.BOOKING_HOLD_TTL_MINUTES)}.`,
        });
      }
    }
  }

  /**
   * How many live anonymous holds cover each night of the requested stay.
   *
   * The overlapping holds are read whole and counted here rather than being
   * grouped per night in SQL, and the reason is the join that would take: a
   * count per night means one row per night per hold, which is `type_inventory`
   * joined back to `booking` on a range — and this file would then be reading
   * the inventory table for something other than the counter it is not allowed
   * to reimplement. A hold is one row and there are at most a night's worth of
   * them, so the tally is cheap and the query stays a plain overlap.
   *
   * Half-open on both sides, the convention the whole system keeps: a stay
   * departing on the morning of the night this one arrives holds nothing that
   * night.
   */
  private async anonymousHoldsPerNight(
    exec: DbExecutor,
    input: CreateHoldInput,
  ): Promise<ReadonlyMap<string, number>> {
    const checkIn = input.checkIn.toString();
    const checkOut = input.checkOut.toString();

    const overlapping = await exec
      .select({
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
      })
      .from(booking)
      .innerJoin(roomType, eq(roomType.id, booking.roomTypeId))
      .where(
        and(
          eq(roomType.code, input.roomType),
          eq(booking.state, "HELD"),
          isNull(booking.userId),
          gt(booking.holdExpiresAt, sql`now()`),
          lt(booking.checkInDate, checkOut),
          gt(booking.checkOutDate, checkIn),
        ),
      );

    const perNight = new Map<string, number>();

    for (const held of overlapping) {
      for (
        let night = input.checkIn;
        night.compare(input.checkOut) < 0;
        night = night.add({ days: 1 })
      ) {
        const date = night.toString();

        // ISO dates compare as text, which is what lets a night be tested
        // against a stored range without parsing either end of it.
        if (held.checkInDate <= date && date < held.checkOutDate) {
          perNight.set(date, (perNight.get(date) ?? 0) + 1);
        }
      }
    }

    return perNight;
  }

  /**
   * The front desk's booking — §2's *(new)* → `CONFIRMED`, no TTL.
   *
   * A walk-in or a phone reservation is confirmed by the person taking it, so
   * there is nothing for a sweep to expire and
   * `booking_hold_expiry_exactly_when_held` refuses an expiry on it.
   *
   * Stay restrictions are deliberately not applied here — see `createHold`. What
   * still binds this path is everything the property cannot physically do: the
   * room type's occupancy, a priced calendar, and the arrival guard in `create`.
   *
   * No account, ordinarily. A walk-in is somebody at the counter, and the stay
   * is stored with `user_id` null rather than with a placeholder account nobody
   * can sign in to.
   *
   * A contact when the desk was given one, and this is the only moment it can
   * be. The stay is `CONFIRMED` the instant it exists, so it never becomes the
   * hold {@link BookingService.setHoldContact} acts on — and a telephone
   * booking with no address is a stay the property cannot write to about its
   * own cancellation or its arrival.
   */
  async createConfirmed(
    exec: DbExecutor,
    input: CreateBookingInput,
  ): Promise<Booking> {
    return await this.create(exec, input, "CONFIRMED");
  }

  /**
   * `HELD` → `CONFIRMED` — §3, and the one transition that moves no inventory.
   *
   * The nights were consumed when the hold was taken. Reserving them again here
   * would sell the stay twice to the guest who was already holding it.
   *
   * **The confirmation email is sent from here, because this is where the
   * transition happens.** A stay reaches `CONFIRMED` from a hold by two routes —
   * a gateway callback through {@link confirmPaidHold}, and a receptionist
   * confirming a transfer the property received off-line — and the guest is owed
   * the same message either way: it carries the only credential that re-opens
   * their stay in a browser that has lost its cookie. Announcing from one of the
   * two callers instead would leave the other silent, which is exactly what it
   * did.
   *
   * **Exactly once, because the transition is once.** The row is locked by the
   * read above and a stay already `CONFIRMED` returns before the update, so a
   * repeated call — a redelivered callback, a receptionist pressing twice —
   * changes nothing and says nothing. `confirmPaidHold` inherits that rather
   * than re-deriving it.
   */
  async confirm(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CONFIRMED");

    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    // The expiry goes with the state. A confirmed stay carrying a stale TTL is
    // a date the sweep could act on, and what it would do with it is cancel a
    // room the property has sold.
    //
    // The caller key goes with it, and for the mirror-image reason: the stay is
    // sold, so the room it occupies is no longer one its caller is *holding*.
    // Left behind, it would count against the three that caller may hold until
    // the guest checked out — a guest who paid for their room punished by the
    // limit that exists to stop a guest who never will.
    const [confirmed] = await exec
      .update(booking)
      .set({
        state: next,
        holdExpiresAt: null,
        heldBy: null,
        updatedAt: new Date(),
      })
      .where(eq(booking.id, bookingId))
      .returning();

    await this.announce(exec, confirmed!);

    return this.asBooking({
      booking: confirmed!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * The stay a gateway has just paid for, confirmed if it was still being held.
   *
   * §3's `HELD → CONFIRMED` is captioned "deposit taken", and until this existed
   * nothing took it: `confirm` above is behind `booking.write`, which is
   * `RECEPTIONIST` and up, so a guest paying their own hold had no path to the
   * transition their payment is the whole reason for. What that cost is not an
   * unconfirmed booking. It is `hold-expiry-sweep.ts` reaching a stay a minute
   * later, finding it `HELD` past its TTL, and cancelling a room the guest has
   * paid for.
   *
   * **Only from `HELD`, and every other state is a no-op rather than a
   * refusal.** Money reaches a stay at more than one moment — a deposit against
   * a hold, a balance against a guest already in the building — and only the
   * first is a transition. `confirm` would answer a `CHECKED_IN` stay with
   * `409 IllegalTransition`, and the caller is inside the transaction that
   * posts the payment, so the refusal would roll back money the gateway has
   * already taken. A stay whose hold the sweep cancelled before the callback
   * arrived is the same shape and the same answer: the payment posts, the
   * cancellation stands, and `FR-PAY-05`'s nightly sweep is what surfaces the
   * pair to somebody who can hand the money back. Neither is a state this
   * method may decide on its own.
   *
   * The read is `for update` and the write goes through `confirm`, so the
   * booking is locked before its state is read and the answer cannot change
   * underneath — two callbacks delivered together find the row in the order
   * they take its lock, and the second sees `CONFIRMED` and does nothing.
   *
   * **The confirmation email is not sent from here**, and that is deliberate:
   * {@link confirm} sends it, because that is where `HELD → CONFIRMED` actually
   * happens. This path inherits the message rather than owning it, so the desk's
   * own confirmation of a transfer is announced by the same code and a second
   * callback still says nothing.
   *
   * **It reports the state the money landed on, and decides nothing about
   * it.** A no-op that returned nothing was a no-op nobody could see: the
   * caller posted the payment, this said nothing, and a stay the property had
   * already cancelled kept the money in silence until `FR-PAY-05`'s nightly
   * comparison found it. Which of these states is worth waking somebody for is
   * a question about money rather than about the state machine, so it is
   * answered where the money is — `payment.service.ts` — and what is returned
   * here is the fact, not the judgement.
   *
   * The state is the one that was *found*, before any transition this made, so
   * a hold that was confirmed reports `HELD`. It is read off the row this
   * method already locked, which is what makes it the state the payment
   * actually landed on rather than one a second read might have seen change.
   */
  async confirmPaidHold(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<PaidStay> {
    const current = await this.forUpdate(exec, bookingId);
    const found = {
      reference: current.booking.reference,
      state: current.booking.state,
    };

    if (current.booking.state !== "HELD") {
      return found;
    }

    await this.confirm(exec, bookingId);

    return found;
  }

  /**
   * Gives a hold long enough left to survive the gateway round trip about to
   * start — `BOOKING_PAYMENT_WINDOW_MINUTES`.
   *
   * **The second writer to `hold_expires_at`, and the only one that moves it
   * forward.** {@link createHold} sets it, {@link confirm} and {@link cancel}
   * clear it, and until this existed nothing in the tree extended it. What that
   * cost is the whole of the payment race: the TTL is a clock that starts when a
   * room is picked, paying is the last thing that happens under it, and a guest
   * who opens checkout near the end of it has `hold-expiry-sweep.ts` cancel the
   * stay mid-flight. The callback then finds a booking that is no longer `HELD`,
   * {@link confirmPaidHold} correctly declines to resurrect it, and the property
   * is holding money for a room it has put back on sale.
   *
   * **`state = 'HELD'` is in the `where` clause, which is what makes the write
   * safe.** `booking_hold_expiry_exactly_when_held` refuses an expiry on any
   * other row, and this is called from inside the transaction that opens a
   * payment attempt — a constraint violation would abort that transaction and
   * take the attempt down with it, on the one path where a payer has already
   * been sent to a gateway. So a stay that is no longer being held is a no-op
   * here rather than a refusal: nothing matches, nothing is written, and the
   * attempt goes in beside a booking whose state this method has no opinion
   * about. Money reaches a stay at more than one moment — a balance on a
   * `CHECKED_IN` guest, a payment landing on a hold the sweep already took — and
   * only one of those has a hold to extend.
   *
   * One conditional `UPDATE` rather than a read and a write, for the reason
   * `payment.service.ts` gives about resolving an attempt: under `read
   * committed` Postgres re-evaluates the predicate after it takes the row's
   * lock, so a `confirm` or a `cancel` that committed while this statement
   * waited leaves it matching nothing. A version that had read the state first
   * would write an expiry onto the row those had just cleared.
   *
   * **`greatest`, so this can only ever lengthen a hold.** A stay whose expiry
   * already runs past the window keeps it — a desk hold with a long TTL, or a
   * second attempt opened a minute after the first — and the extension is
   * therefore not a way to *shorten* anybody's hold by pressing pay.
   *
   * Postgres' clock and not this process's, unlike {@link holdExpiry}. This
   * deadline has to beat the `now()` the sweep compares it against, and a node
   * whose clock had drifted behind would otherwise hand out a window shorter
   * than the one configured — the same argument `last_seen_at` carries at
   * {@link createHold}, where the two ends of one comparison are kept on one
   * clock.
   */
  async extendHoldForPayment(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<void> {
    const window = sql`${`${this.env.BOOKING_PAYMENT_WINDOW_MINUTES} minutes`}::interval`;

    await exec
      .update(booking)
      .set({
        holdExpiresAt: sql`greatest(${booking.holdExpiresAt}, now() + ${window})`,
        updatedAt: new Date(),
      })
      .where(and(eq(booking.id, bookingId), eq(booking.state, "HELD")));
  }

  /**
   * Telling the guest their stay is paid for — the one message an anonymous
   * booking ever receives.
   *
   * **Nothing here can cost the guest their booking.** The message is handed to
   * the queue and never sent from this call: `booking-confirmation.service.ts`
   * argues it, and the shape of the argument is the harshest of the two callers
   * — a payment gateway's callback, inside the transaction that took the money,
   * which the desk's own confirmation then rides for free. A round trip
   * to the mail vendor here is a callback the gateway may time out and
   * redeliver, and a refusal here would roll back a stay that has been paid for.
   * `enqueue` waits for neither and rejects for nothing.
   *
   * **The two links are minted in the confirming transaction and the message is
   * handed over after it commits.** The links are rows, and rows written here
   * exist exactly when the confirmation does — a transaction that rolls back
   * after this point takes the links with it. The queue is not in that
   * transaction: pg-boss writes on its own connection and commits on its own, so
   * a message enqueued from here would survive a rollback and advertise two
   * credentials that no longer exist. The caller's transaction posts a folio line
   * after this returns and that posting can refuse, which is not a rare shape —
   * it is the ordinary one. `afterCommit` is what makes "the guest was told"
   * follow from "the stay was confirmed" rather than merely accompany it.
   *
   * **No address, no message.** `contact_email` and `contact_name` are written
   * as a pair by the funnel's review screen and are null together on every stay
   * the desk took — a walk-in is somebody at the counter, and there is nowhere
   * to write. Narrowed rather than asserted: an assertion would turn the
   * ordinary desk booking into a 500 on the payment callback.
   *
   * **A stay somebody has already claimed is mailed no link at all.** Attaching
   * a booking to an account gives up its anonymous credential, and
   * `booking_revokes_anonymous_access_only_with_an_account` is what makes this
   * column being set mean the stay has an owner. Both links would be wrong for
   * it, and wrong in different ways: `liveLink` refuses a re-issue on that same
   * column, so the mail would advertise a credential nobody can spend, and an
   * account link would offer to create the account the stay already has. What
   * is left is the page itself, which its owner reaches by signing in — which
   * is the way in the guest already took to claim it.
   */
  private async announce(exec: DbExecutor, row: BookingRow): Promise<void> {
    const to = row.contactEmail;
    const guestName = row.contactName;

    if (to === null || guestName === null) {
      return;
    }

    const claimed = row.anonAccessRevokedAt !== null;

    const stayUrl = claimed
      ? this.bookingUrl(row.reference)
      : this.stayUrl(
          row.reference,
          await this.bookingTokens.mintStayLink(exec, {
            bookingId: row.id,
            // Property-local midnight of the departure date, which is the
            // instant the cookie issued at the hold was measured from —
            // `booking.controller.ts` performs the same crossing, so the mailed
            // copy and the browser's copy of one credential die together.
            checkOut: parseDate(row.checkOutDate).toDate(PROPERTY_TIME_ZONE),
          }),
        );

    // The one branch in the whole flow, and the only place it is safe. The two
    // bodies differ, and the difference is delivered to the address being asked
    // about and to nobody else; the same branch on a page would be an
    // enumeration oracle, because a hold is unauthenticated and anyone can take
    // one naming somebody else's address. `booking-confirmation-email.ts` and
    // `registered-address.ts` both carry the argument.
    //
    // Asked only of a stay nobody has claimed. A claimed one has an account
    // already, whatever this address would answer.
    const registered = claimed || (await accountForAddress(exec, to));

    const createAccountUrl = registered
      ? undefined
      : this.accountUrl(
          row.reference,
          await this.bookingTokens.mintAccountLink(exec, { bookingId: row.id }),
        );

    const mail = {
      to,
      guestName,
      reference: row.reference,
      stayUrl,
      createAccountUrl,
    };

    // Composed now, from rows read inside the transaction, and handed over only
    // once those rows are durable.
    await afterCommit(exec, () => this.confirmations.enqueue(mail));
  }

  /**
   * Where a mailed link points, delegated to `mailed-link-urls.ts`.
   *
   * The shape of the three addresses and the argument for the fragment live
   * there rather than here, because the desk composes the account link too —
   * `account-link-resend.service.ts` — and two senders reading two copies of one
   * route is how a page moves and a mail keeps pointing at where it was.
   */
  private stayUrl(reference: string, link: string): string {
    return stayLinkUrl(this.env.WEB_ORIGIN, reference, link);
  }

  private accountUrl(reference: string, link: string): string {
    return accountLinkUrl(this.env.WEB_ORIGIN, reference, link);
  }

  private bookingUrl(reference: string): string {
    return bookingPageUrl(this.env.WEB_ORIGIN, reference);
  }

  /**
   * `HELD` or `CONFIRMED` → `CANCELLED`, releasing every night — §3.
   *
   * One method for both rows of the table, because §3 gives them one inventory
   * effect and different reason codes. An expired hold arrives here from the TTL
   * sweep carrying `HOLD_EXPIRED`; a guest arrives carrying `GUEST_REQUEST`.
   *
   * `CHECKED_IN` → `CANCELLED` is refused by the table above, on purpose: the
   * guest is in the building and the stay happened. Shortening it is an early
   * departure, which is §5's and posts a policy charge.
   *
   * The refund is not computed here. `cancellation-calculator.ts` prices §4's
   * grid and persists nothing, and `folio.refund-policy` and
   * `folio.refund-override` are two endpoints with two capabilities — a service
   * that returned an amount from the cancellation itself would collapse them
   * into one.
   *
   * What *is* recorded here is the waiver, when the caller reached the route
   * that grants one. The amount stays the folio's; whether the grid applies at
   * all is a manager's decision, and this is the only moment it can be written
   * down — `booking.controller.ts` says why a capability guard cannot stand in
   * for the column.
   *
   * The guest is written to from here rather than from either route above it, so
   * that both of them say the same thing — {@link announceCancellation}, which
   * also says which of this method's callers are not a cancellation the guest was
   * ever told about.
   */
  async cancel(
    exec: DbExecutor,
    cancellation: {
      bookingId: string;
      reason: CancellationReason;
      /** The manager who set §4's penalty aside, or null at the policy price. */
      waivedBy: string | null;
    },
  ): Promise<Booking> {
    const { bookingId, reason, waivedBy } = cancellation;

    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CANCELLED");

    // §4's idempotency guard, and the release is what makes it matter. A second
    // cancellation that answered politely and put the nights back again would
    // credit the property with inventory it never sold — the row would then read
    // as availability that does not exist, which is the refusal
    // `type_inventory_sold_not_negative` is there to catch when it goes further.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    await this.inventory.release(exec, {
      roomType: current.roomTypeCode,
      checkIn: parseDate(current.booking.checkInDate),
      checkOut: parseDate(current.booking.checkOutDate),
    });

    // The second row a cancellation has to close, now that `assignment.service.ts`
    // writes them. An assignment left behind holds its room against
    // `room_assignment_no_double_booking`, so the room could be given to nobody
    // else and would read as occupied on the housekeeping board for a stay that
    // is not happening — the counter saying the room is free and the exclusion
    // constraint saying it is taken.
    //
    // Deleted rather than closed off. A cancelled stay slept no night, so there
    // is no history to keep and no row that could cover one; the guest never
    // arrived, which is the whole difference from a check-out.
    await this.releaseRooms(exec, bookingId);

    const [cancelled] = await exec
      .update(booking)
      .set({
        state: next,
        cancellationReason: reason,
        // Postgres' clock and not this process's. §4's free window is decided by
        // this instant against an 18:00 deadline, and a node that has drifted
        // would move a cancellation across it — the same argument
        // `schema/folio.ts` makes for `posted_at` defaulting to `now()`. The
        // executor is inside the caller's transaction, so this is the instant
        // the transaction started and the same one every row it writes carries.
        cancelledAt: sql`now()`,
        // Both columns or neither —
        // `booking_names_a_waiver_authority_exactly_when_waived`. The instant is
        // the cancellation's own, because the waiver is granted in the act of
        // cancelling rather than afterwards: there is no route that waives a
        // penalty on a stay that is already cancelled.
        penaltyWaivedAt: waivedBy === null ? null : sql`now()`,
        penaltyWaivedBy: waivedBy,
        // A cancelled hold no longer holds anything, and
        // `booking_hold_expiry_exactly_when_held` refuses the row that kept its
        // expiry. The caller key goes the same way under
        // `booking_held_by_only_while_held`, which is what returns the
        // allowance to whoever was holding this room — including on the sweep's
        // own path, so a caller who abandoned three funnel sessions is free to
        // book again as soon as their rooms are back on the shelf.
        holdExpiresAt: null,
        heldBy: null,
        updatedAt: new Date(),
      })
      .where(eq(booking.id, bookingId))
      .returning();

    await this.announceCancellation(exec, {
      row: cancelled!,
      was: current.booking.state,
      reason,
    });

    return this.asBooking({
      booking: cancelled!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * Telling the guest their stay is off — `FR-NTF-01`'s cancellation mail.
   *
   * **Both of the guest-facing cancellation paths reach this**, because both
   * reach {@link cancel}: the desk's route and {@link cancelOwn}, which is the
   * same method with `waivedBy` null. One place to send from rather than two, so
   * a stay cancelled by its guest and the same stay cancelled at the counter
   * cannot come to say different things about what it cost.
   *
   * **Only a stay that had reached `CONFIRMED`.** The third caller of
   * {@link cancel} is the hold-expiry sweep, and a fourth is the funnel releasing
   * the room a guest moved off — `HOLD_EXPIRED` and `HOLD_REPLACED`. Neither is a
   * cancellation as far as the guest is concerned: nothing was confirmed, nothing
   * was paid, and the property never told them they had a stay. Announcing those
   * would mail a guest about a booking they do not believe they made, once a
   * minute, from a sweep. The gate is the previous state rather than a list of
   * reasons, because it is one sentence that stays true as reasons are added —
   * `booking-state.ts` adds them without changing any price.
   *
   * **No address, no message**, exactly as {@link announce} has it: the pair is
   * null together on every stay the desk took from somebody standing at the
   * counter.
   *
   * **The penalty is §4's, priced through the one calculator.**
   * `cancellation-calculator.ts` is asked with the instant Postgres just wrote
   * to the row, which is the same instant `folio.service.ts` will price the
   * charge from when the desk posts it — so the figure in the mail is the figure
   * on the account rather than a second reading of the deadline. A waived stay
   * skips the grid and is priced at nothing, which is what that file does with
   * the same two columns and for the reason it gives: §4's table has no waiver
   * cell.
   *
   * **The refund is read after the commit, and so is the balance it comes
   * from.** What goes back to the guest is what the account is over-paid by once
   * the penalty stands — the folio's own arithmetic, not a subtraction invented
   * here — and asking for it out here has two properties worth the odd shape. It
   * cannot fail the cancellation: `TransactionRunner` logs a post-commit failure
   * and the commit stands, whereas a refused balance read inside the transaction
   * would put the room back off the shelf because a mail could not be composed.
   * And it is the balance as it stands once this cancellation is durable, which
   * is the state the desk's later posting will read.
   */
  private async announceCancellation(
    exec: DbExecutor,
    cancellation: {
      readonly row: BookingRow;
      /** The state the stay was in before it was cancelled. */
      readonly was: BookingState;
      readonly reason: CancellationReason;
    },
  ): Promise<void> {
    const { row, was, reason } = cancellation;
    const to = row.contactEmail;
    const guestName = row.contactName;

    if (was !== "CONFIRMED" || to === null || guestName === null) {
      return;
    }

    // `booking_records_a_cancellation_instant_exactly_when_cancelled` puts the
    // instant on every cancelled row, so this is narrowing rather than a
    // possibility. Narrowed and not asserted: a caller that ever arrives here
    // with a live booking sends nothing, instead of pricing §4's deadline
    // against this process's clock.
    const cancelledAt = row.cancelledAt;

    if (cancelledAt === null) {
      return;
    }

    const charge: PolicyCharge | null = row.penaltyWaivedAt
      ? { amount: 0n, basis: "NONE" }
      : await this.priceCancellation(exec, row, cancelledAt);

    // A stay with no stored night prices is one §4 cannot be applied to at all.
    // `cancellationQuote` answers that with a refusal because a guest asked it a
    // question; here it is a message that cannot state what it exists to state,
    // so nothing is sent and the cancellation itself is untouched.
    if (charge === null) {
      return;
    }

    // What §4 charged is the whole of what this mail states. The folio is not
    // read for a balance to promise back: §4's entitlement stands, but returning
    // money is a staff act taken at the desk and out of band, and no code path
    // here starts one. A message that quoted a refund would commit the property,
    // in the guest's inbox, to something nothing in this process performs.
    await afterCommit(exec, async () => {
      await this.cancellations.enqueue({
        to,
        guestName,
        reference: row.reference,
        reason,
        penalty: charge.amount,
      });
    });
  }

  /**
   * `CONFIRMED` → `CHECKED_IN` — the guest is in the building.
   *
   * All three of §4's guards run, in the order §4 lists them, and the order is
   * not cosmetic: it is the order the desk can act on. A stay that is a day
   * early is refused for being early rather than for the room not being ready,
   * because sending a housekeeper to a room the guest may not have yet is work
   * nobody needed. The room is then required before its condition is asked
   * about, since there is no status to read without one.
   *
   * §3's other effect is the registration record, and §1 files it as a property
   * of the state rather than as a later step: `CHECKED_IN` is the row whose
   * "registration" column reads **Yes**. It is written in this transaction for
   * the reason `guest.module.ts` gives — a stay that moved to `CHECKED_IN` and
   * failed to record who is in the room would be a statutory residence record
   * with a hole in it.
   *
   * The housekeeping status is read and not written. §3 gives check-in no
   * housekeeping effect, and that is right: the room was `CLEAN` before the
   * guest walked in and it is `CLEAN` after. It stops being clean when they
   * leave, which is {@link checkOut}'s line.
   */
  async checkIn(
    exec: DbExecutor,
    input: {
      bookingId: string;
      /** At least one, and the first is the booking holder — see below. */
      guests: readonly CheckInGuest[];
    },
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, input.bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_IN");

    // §4's idempotency row. A double-clicked button must not register the same
    // party twice — `registration_booking_guest_key` would refuse the second
    // row, but as a constraint violation rather than as the polite answer §4
    // asks for.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    await this.admissible(
      exec,
      current,
      await this.assignments.current(exec, input.bookingId),
    );

    return await this.admit(exec, current, input.guests);
  }

  /**
   * `CONFIRMED` → `NO_SHOW` — the guest never came.
   *
   * §3 releases "the nights **after** the arrival night" and keeps that first
   * one, which is not an arbitrary split: the no-show charge is levied against
   * it, and a night the property is charging for is a night it has not resold.
   * The rest go back on sale, because nobody is coming for them.
   *
   * The room follows the counter. The hold is cut back to the arrival night for
   * the reason `checkOut` cuts it back on an early departure — a room still held
   * to the original departure date across nights the counter now reads as free
   * is a room nothing can be given, on a board that shows it occupied.
   *
   * When the charge is levied is not decided here, and the amount is not
   * computed here. §3 has the night audit write this transition and
   * `cancellation-calculator.ts` says why no money is persisted from a state
   * change — `D3` in `plans/backlog.md` still owes the no-show amount itself.
   */
  async markNoShow(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "NO_SHOW");

    // §4's idempotency row. A sweep that ran twice over the same night must not
    // release the remaining nights twice — `type_inventory_sold_not_negative`
    // would catch it as a fault, and by then the counter has already lied.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    const arrival = parseDate(current.booking.checkInDate);
    const departure = parseDate(current.booking.checkOutDate);
    const today = await this.businessDate.current(exec);

    // §1 defines the state as "arrival night passed without check-in", so a stay
    // the property has not reached yet cannot be one. Without this a booking
    // arriving next week could be written off today: every night after an
    // arrival nobody has come for would go back on sale and the room hold would
    // be cut back to a night the guest is still expected on — the counter wrong
    // in the direction that oversells, and no later guard to catch it, since §4
    // governs check-in rather than this.
    //
    // The comparison is strictly-before, and the 04:00 rollover is the reason.
    // `business-date.service.ts` puts an instant before the rollover back on the
    // previous date, so the audit that runs at 03:00 to close the night of `D`
    // reads business date `D` — the same date the stay it is writing off arrives
    // on. Refusing `today == arrival` would refuse §3's own caller, and with it
    // the 02:00 reinstatement §2 calls an ordinary event.
    if (today.compare(arrival) < 0) {
      throw new ORPCError("CONFLICT", {
        message: `The business date is ${today.toString()} and this stay arrives on ${current.booking.checkInDate} — a guest cannot have failed to arrive for a night the property has not reached`,
      });
    }

    const afterArrival = arrival.add({ days: 1 });

    // A one-night stay has nothing after its arrival night, so the release is
    // skipped rather than asked for an empty range — `inventory.service.ts`
    // refuses a movement of no nights, and rightly.
    if (afterArrival.compare(departure) < 0) {
      await this.inventory.release(exec, {
        roomType: current.roomTypeCode,
        checkIn: afterArrival,
        checkOut: departure,
      });

      await exec
        .update(roomAssignment)
        .set({ checkOutDate: afterArrival.toString() })
        .where(
          and(
            eq(roomAssignment.bookingId, bookingId),
            isNull(roomAssignment.closureReason),
          ),
        );
    }

    return await this.setState(exec, current, next);
  }

  /**
   * `NO_SHOW` → `CHECKED_IN` — the guest landed at 02:00 after all.
   *
   * §2 calls this an ordinary event rather than a data-entry error, and §3 gives
   * it one inventory effect: "re-consume remaining nights, fail if unavailable".
   * Failing is the interesting half. The nights went back on sale the moment the
   * audit ran, so somebody else may hold them — and then the honest answer is
   * that this stay cannot be reinstated, not that the counter should go past
   * what the property owns. `type_inventory_sold_at_most_total` is what says so,
   * surfaced as the `409` the desk acts on by finding the guest another room.
   *
   * Which nights are "remaining" depends on when the guest turns up. Landing on
   * the arrival date — the ordinary case, hours after the audit — the arrival
   * night is still held and it is the rest that are re-consumed. Turning up two
   * days later, the nights in between were never slept and are not bought back;
   * the stay resumes from today.
   *
   * Only from `NO_SHOW`. §2 lets `CONFIRMED` reach `CHECKED_IN` as well, and
   * that path is {@link checkIn} — arriving here it would re-consume nights the
   * booking already holds, which is the property selling itself the same room
   * twice.
   *
   * **The room may travel with the reinstatement, and sometimes must.** §1 makes
   * an assignment optional in `CONFIRMED`, so a booking can reach `NO_SHOW`
   * having never held a room; and the room a no-show did hold can have gone out
   * of order in the hours since. Neither is repairable through §5's assignment
   * operations, which are legal from `CONFIRMED` and `CHECKED_IN` only — so
   * without a room named here, §2's "ordinary event" would be a transition the
   * manager cannot reach and the guest standing at the desk would have to be
   * cancelled and rebooked. Named, it wins over the one the booking holds; the
   * old row keeps the arrival night it was charged for, exactly as the late
   * arrival below leaves the nights nobody slept unclaimed.
   */
  async reinstate(
    exec: DbExecutor,
    input: {
      bookingId: string;
      guests: readonly CheckInGuest[];
      /** Required when the booking holds no room — see above. */
      roomNumber?: string;
    },
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, input.bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_IN");

    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    if (current.booking.state !== "NO_SHOW") {
      throw new ORPCError("CONFLICT", {
        message: `Only a no-show is reinstated — this booking is ${current.booking.state}, so checking the guest in is the transition`,
      });
    }

    const arrival = parseDate(current.booking.checkInDate);
    const departure = parseDate(current.booking.checkOutDate);
    const today = await this.businessDate.current(exec);

    const held = await this.assignments.current(exec, input.bookingId);

    // Refused here rather than by §4's room requirement below, because the two
    // are different answers: that guard tells a desk to assign a room, and a
    // no-show is the one state §5 will not let them assign one from.
    if (!held && !input.roomNumber) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "This booking was written off holding no room — name the room the guest is going into",
      });
    }

    // The guards run before the counters move. A room that is not ready is an
    // answer the desk gets without the property having bought back nights it is
    // about to give up again — the transaction would undo them either way, but
    // the refusal is the same refusal and this way it costs nothing.
    const target = await this.admissible(exec, current, held, input.roomNumber);

    // Never the arrival night: the no-show kept it on the counter, and buying it
    // a second time is the property selling itself a room it already holds.
    const buyBackFrom =
      today.compare(arrival) > 0 ? today : arrival.add({ days: 1 });

    if (buyBackFrom.compare(departure) < 0) {
      await this.inventory.reserve(exec, {
        roomType: current.roomTypeCode,
        checkIn: buyBackFrom,
        checkOut: departure,
      });
    }

    // The hold starts a night earlier than the purchase when the no-show held no
    // room, and only then. The counter kept the arrival night either way, but a
    // booking that never had a room has nothing holding that night against the
    // exclusion constraint — so §1's "arrival night only" is a row that has yet
    // to be written, and writing it from the arrival is what makes the two
    // layers agree. It is also what keeps a one-night stay from being reinstated
    // into no room at all: there, the purchase covers nothing and the hold is
    // the whole of the operation.
    const holdFrom =
      today.compare(arrival) > 0
        ? today
        : held
          ? arrival.add({ days: 1 })
          : arrival;

    if (holdFrom.compare(departure) < 0) {
      // A second row rather than the first one stretched back out, which is the
      // shape `assignment.service.ts` gives a room move and for the same reason:
      // the arrival night the property charged for stays a night that room was
      // held, and the nights nobody slept in between are not claimed at all.
      //
      // Written through the assignment service rather than here, because §2's
      // "it fails if the room was resold" is `room_assignment_no_double_booking`
      // refusing this insert, and that file is where the `23P01` is turned into
      // the `409` the desk acts on. Reaching for the table directly would leave
      // an occupied room arriving at the desk as a fault.
      await this.assignments.hold(exec, {
        bookingId: input.bookingId,
        roomId: target.roomId,
        roomNumber: target.roomNumber,
        checkInDate: holdFrom.toString(),
        checkOutDate: departure.toString(),
      });
    }

    return await this.admit(exec, current, input.guests);
  }

  /**
   * §4's three guards against `→ CHECKED_IN`, in the order §4 lists them.
   *
   * Returns the room, because the caller that passed needs it and reading it
   * again would be a second answer to a question already asked. The order is not
   * cosmetic: it is the order the desk can act on. A stay that is a day early is
   * refused for being early rather than for the room not being ready, because
   * sending a housekeeper to a room the guest may not have yet is work nobody
   * needed. The room is then required before its condition is asked about, since
   * there is no status to read without one.
   *
   * The assignment is the caller's rather than read here, because both callers
   * have already had to look at it: one to refuse a check-in without a room, the
   * other to refuse a reinstatement that names none. A second read would be a
   * second answer to that question, taken after the first was acted on.
   *
   * `roomNumber` is the room the guest is going into when it is not the one the
   * booking holds — {@link reinstate} for the two shapes that need it. It is the
   * room §4's condition guard is asked about, and that is the whole point of
   * accepting it: reading the condition of the room they are *leaving* would
   * admit a guest into an out-of-order room on the strength of the clean one
   * they are not going to be in.
   */
  private async admissible(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
    held: HeldRoom | null,
    roomNumber?: string,
  ): Promise<{ roomId: string; roomNumber: string }> {
    validateArrivalWindow({
      businessDate: await this.businessDate.current(exec),
      arrivalDate: parseDate(current.booking.checkInDate),
      departureDate: parseDate(current.booking.checkOutDate),
      earlyCheckInEnabled: this.env.BOOKING_EARLY_CHECK_IN_ENABLED,
    });

    // Resolved against the type the stay was sold as, through the file that owns
    // that refusal. A Superior booking handed a Deluxe key leaves the two
    // inventory layers disagreeing, and `assignment.service.ts` says so in the
    // words the desk needs — that giving the guest another type is a room type
    // change, which moves the counters with the key.
    const named = roomNumber
      ? await this.assignments.roomOfType(
          exec,
          roomNumber,
          current.booking.roomTypeId,
          current.roomTypeCode,
        )
      : null;

    if (!named) {
      validateRoomAssigned(held?.row ?? null);
    }

    const target =
      named && roomNumber
        ? { roomId: named.id, roomNumber }
        : { roomId: held!.row.roomId, roomNumber: held!.roomNumber };

    validateRoomReady(
      await this.housekeeping.statusOf(exec, target.roomId),
      this.env.BOOKING_DIRTY_ROOM_CHECK_IN_ENABLED,
    );

    return target;
  }

  /**
   * The party into the residence record, and the booking into `CHECKED_IN`.
   *
   * Shared by {@link checkIn} and {@link reinstate} because §1 files the
   * registration record as a property of the state rather than of the route that
   * reached it: a guest who arrives at 14:00 and one who arrives at 02:00 the
   * next morning are equally in the building, and a stay that recorded who was
   * in the room only on one of those paths would be a statutory residence record
   * with a hole in it.
   */
  private async admit(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
    guests: readonly CheckInGuest[],
  ): Promise<Booking> {
    // Nobody in the room is not a check-in. The residence record is the reason
    // the transition exists at all, and a stay that reached `CHECKED_IN` with an
    // empty party would be one the property cannot say who was in.
    if (guests.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Check-in registers at least one guest",
      });
    }

    // The first is the holder. §3 calls it "the booking holder, as against the
    // other occupants", `registration_one_primary_per_booking_key` allows
    // exactly one, and taking it from the order the desk entered them is the
    // one rule that needs no extra field on the wire.
    let primary = true;

    for (const person of guests) {
      const guestId =
        "guestId" in person
          ? person.guestId
          : (await this.guests.createGuest(exec, person)).id;

      await exec.insert(registration).values({
        bookingId: current.booking.id,
        guestId,
        isPrimary: primary,
      });

      primary = false;
    }

    return await this.setState(exec, current, "CHECKED_IN");
  }

  /** The state written, and the booking read back in the application's shape. */
  private async setState(
    exec: DbExecutor,
    current: { booking: BookingRow; roomTypeCode: RoomTypeCode },
    state: BookingState,
  ): Promise<Booking> {
    const [written] = await exec
      .update(booking)
      .set({ state, updatedAt: new Date() })
      .where(eq(booking.id, current.booking.id))
      .returning();

    return this.asBooking({
      booking: written!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /** Every room this booking holds, given up. */
  private async releaseRooms(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<void> {
    await exec
      .delete(roomAssignment)
      .where(
        and(
          eq(roomAssignment.bookingId, bookingId),
          isNull(roomAssignment.closureReason),
        ),
      );
  }

  /**
   * `CHECKED_IN` → `CHECKED_OUT` — the stay is over.
   *
   * §4's one guard, asked through `folio.port.ts` so that the ledger could
   * answer it without this transition changing. It now does: the port resolves
   * to `FolioService`, which sums the postings. That the swap cost this method
   * nothing is the whole return on asking through a port in the first place.
   *
   * §3's inventory effect is "release unspent nights", and which nights those
   * are is the one judgement in this method. A guest leaving on business date
   * `D` has slept the nights up to `D` and will not occupy `D` itself — the
   * night of `D` runs from `D` into tomorrow, and at any hour of the property's
   * day it has not happened yet. So the release covers `[D, departure)`, which
   * puts tonight back on sale for a walk-in. The same reading makes an ordinary
   * departure release nothing at all: on the departure date the range is empty,
   * and there was never an unspent night to give back.
   *
   * The room goes back as `DIRTY` — §3's "Other" column, and `FR-HK-01`. It is
   * attributed to nobody, because `housekeeping.service.ts` says why: the
   * property is not making a cleaning judgement about the room, it is stating
   * that somebody has been in it.
   */
  async checkOut(exec: DbExecutor, bookingId: string): Promise<Booking> {
    const current = await this.forUpdate(exec, bookingId);
    const next = applyTransition(current.booking.state, "CHECKED_OUT");

    // §4's idempotency row, and the release below is what makes it matter. A
    // second check-out that answered politely and released the nights again
    // would credit the property with inventory it never sold — the same reason
    // `cancel` guards it.
    if (next === current.booking.state) {
      return this.asBooking(current);
    }

    validateFolioSettled(await this.folio.getBalance(bookingId));

    const departure = parseDate(current.booking.checkOutDate);
    const arrival = parseDate(current.booking.checkInDate);
    const today = await this.businessDate.current(exec);

    // Clamped to the arrival, because early check-in is §7's first ⚑ and a
    // guest admitted before their arrival date can leave before it too. The
    // unclamped range would release nights the booking never consumed, which
    // `type_inventory_sold_not_negative` refuses — correctly, and as a fault
    // rather than as the answer it is.
    const from = today.compare(arrival) > 0 ? today : arrival;

    if (from.compare(departure) < 0) {
      await this.inventory.release(exec, {
        roomType: current.roomTypeCode,
        checkIn: from,
        checkOut: departure,
      });
    }

    const held = await this.assignments.current(exec, bookingId);

    // A checked-in booking has a room — §4's second guard is what guarantees it
    // — so this is the shape of the one case that would leave a room held for a
    // stay that has ended, rather than a condition worth refusing a departure
    // over. The guest is leaving either way.
    if (held) {
      // The hold ends when the stay does. Left running to the original
      // departure date, an early check-out would keep the room against
      // `room_assignment_no_double_booking` for nights the counter has just
      // put back on sale — the two layers `schema/inventory.ts` describes
      // disagreeing, with the room unsellable and the type reading free.
      if (from.toString() === held.row.checkInDate) {
        await exec
          .delete(roomAssignment)
          .where(eq(roomAssignment.id, held.row.id));
      } else if (from.compare(departure) < 0) {
        await exec
          .update(roomAssignment)
          .set({ checkOutDate: from.toString() })
          .where(eq(roomAssignment.id, held.row.id));
      }

      // A fault outlasts the stay it was reported during. `setCondition` writes
      // `DIRTY` with the note cleared, so handing back a room that was withdrawn
      // mid-stay would erase both the status and the reason for it, and leave a
      // room nobody has repaired one cleaning round away from the next arrival.
      // `assignment.service.ts` refuses it on a room move for the same reason.
      if (
        (await this.housekeeping.statusOf(exec, held.row.roomId)) !==
        "OUT_OF_ORDER"
      ) {
        await this.housekeeping.setCondition(exec, {
          roomNumber: held.roomNumber,
          status: "DIRTY",
        });
      }
    }

    const [departed] = await exec
      .update(booking)
      .set({ state: next, updatedAt: new Date() })
      .where(eq(booking.id, bookingId))
      .returning();

    return this.asBooking({
      booking: departed!,
      roomTypeCode: current.roomTypeCode,
    });
  }

  /**
   * Every booking one account made — `FR-GST-01`'s stay history, scoped to the
   * requester's own record.
   *
   * The scope is the `where` clause and not a filter a caller applies
   * afterwards. `rbac-matrix.md` calls the guest's own rows `conditional`, which
   * means the guard admits the caller and the handler still owes the ownership
   * check; a method that returned every booking and left the narrowing to its
   * caller would be one forgotten `.filter()` away from showing a guest
   * somebody else's stays.
   *
   * Newest arrival first, because that is the order a guest reads their own
   * bookings in — the stay they are about to take, then the ones they have
   * taken. Cancelled and expired stays are included: they happened to this
   * account, and a list that silently dropped them would answer "where did my
   * booking go?" with nothing at all.
   */
  async getOwnBookings(
    exec: DbExecutor,
    userId: string,
  ): Promise<readonly Booking[]> {
    const rows = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(eq(booking.userId, userId))
      .orderBy(desc(booking.checkInDate), desc(booking.createdAt));

    return rows.map((row) => this.asBooking(row));
  }

  /**
   * Whether this account made this booking — the condition the matrix leaves to
   * the handler, asked as a question rather than answered by reading a row.
   *
   * False when the booking does not exist, and that is the honest answer rather
   * than an oversight: a guest who is not the owner and a guest naming an id
   * nobody holds must be told the same thing, or the difference between the two
   * replies is a way to discover which references are real.
   *
   * False on every stay the desk took, too. `user_id` is null there, and SQL's
   * equality never matches a null — so a walk-in belongs to nobody rather than
   * to whoever asks about it.
   */
  async isOwner(
    exec: DbExecutor,
    bookingId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(and(eq(booking.id, bookingId), eq(booking.userId, userId)))
      .limit(1);

    return row !== undefined;
  }

  /**
   * Giving a stay an owner, and giving up its anonymous credential in the same
   * breath.
   *
   * **The order is the whole method.** `user_id` is written first and the
   * revocation second, because
   * `booking_revokes_anonymous_access_only_with_an_account` refuses the reverse
   * — a stay with its anonymous access given up and nobody able to sign in to it
   * is a guest locked out of a room they paid for, and the constraint states
   * that rather than trusting this file to remember it. Written the other way
   * round the database raises `23514` and the transaction rolls back, which is
   * the safe failure and still a failure.
   *
   * **One transaction, because they are one act.** The caller's executor, like
   * every other write here: an attach that committed without its revocation
   * would leave a loose cookie opening a stay that now has an owner, and a
   * revocation that committed without its attach cannot exist at all.
   *
   * **A stay that already has an owner is never reassigned.** The row is read
   * `for update` and the account compared before anything is written, so the
   * answer cannot change underneath. The same account attaching twice is the
   * attach that already happened — it writes nothing, and still revokes, because
   * the stay may have been filed under that account at the hold and never had
   * its cookie given up. A *different* account is refused: a booking has one
   * owner, and moving it would take a stay out of somebody's history.
   */
  async attachToAccount(
    exec: DbExecutor,
    attachment: { readonly bookingId: string; readonly userId: string },
  ): Promise<Booking> {
    const current = await this.forUpdate(exec, attachment.bookingId);
    const owner = current.booking.userId;

    if (owner !== null && owner !== attachment.userId) {
      throw new ORPCError("CONFLICT", {
        message: "This stay already belongs to an account",
      });
    }

    if (owner === null) {
      await exec
        .update(booking)
        .set({ userId: attachment.userId, updatedAt: sql`now()` })
        .where(
          and(
            eq(booking.id, attachment.bookingId),
            // Redundant under the lock above and kept anyway: it is the clause
            // that makes "never reassigned" true of the statement itself rather
            // than of the comparison that precedes it.
            isNull(booking.userId),
          ),
        );
    }

    await this.revokeAnonymousAccess(exec, attachment.bookingId);

    return await this.ownHold(exec, {
      bookingId: attachment.bookingId,
      owner: { kind: "account", userId: attachment.userId },
    });
  }

  /**
   * Who the confirmation for a stay was addressed to, or `null` when nobody was
   * named.
   *
   * The address the attach flow creates an account under, read off the booking
   * rather than taken from the caller — which is what makes "the account is for
   * the address the mail went to" a fact rather than a check somebody has to
   * remember to make.
   */
  async contactOn(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<BookingContact | null> {
    const [row] = await exec
      .select({ email: booking.contactEmail, name: booking.contactName })
      .from(booking)
      .where(eq(booking.id, bookingId))
      .limit(1);

    if (!row || row.email === null || row.name === null) {
      return null;
    }

    return { email: row.email, name: row.name };
  }

  /**
   * Giving up the anonymous credential for one stay, permanently.
   *
   * The act attach performs, and the reason `booking-token.service.ts` stopped
   * describing revocation as a gap. A stay attached to an account is reachable
   * through that account; the cookie copy of it — left in a lobby browser, sat
   * in a mail thread, synced to a device the guest has sold — is a second key to
   * a door that now has an owner, and this is what stops it turning.
   *
   * **Idempotent by the `where` and not by a check beforehand.** The second call
   * matches no row and writes nothing, so a retried request and a job that ran
   * twice are both the revocation that already happened. Keeping the first
   * instant matters: it is when access was surrendered, and a call that
   * overwrote it would move the fact each time anybody asked again. That is also
   * why `updated_at` is left where the first call put it — nothing changed.
   *
   * **Takes the caller's executor, like every other write here.** Attach sets
   * `user_id` and this runs beside it, in the caller's transaction, so a stay
   * cannot end up with its anonymous access revoked and no account behind it —
   * `booking_revokes_anonymous_access_only_with_an_account` refuses that row
   * outright, which is why the account is written first.
   *
   * Nothing is thrown for a stay that does not exist, and nothing is returned to
   * distinguish the cases. Every one of them leaves the same thing true: no
   * anonymous credential opens that booking after this call.
   */
  async revokeAnonymousAccess(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<void> {
    await exec
      .update(booking)
      .set({ anonAccessRevokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(booking.id, bookingId), isNull(booking.anonAccessRevokedAt)),
      );
  }

  /**
   * One stay of this account's, read the way its guest addresses it —
   * `FR-GST-01`, narrowed from the history above to the single booking.
   *
   * The account is half of the `where` clause and not a comparison made after
   * the row arrives. `rbac-matrix.md` calls the guest's own rows `⚠`, which
   * means the guard admits the caller and the scope is still owed; paying it
   * here, in SQL, is what makes it unforgettable — a query that fetched by
   * reference and then compared would be one early return away from handing a
   * stranger's stay to whoever guessed the eight characters.
   *
   * It is also what keeps a walk-in out. `user_id` is null on every stay the
   * desk took and SQL's equality never matches a null, so those rows cannot be
   * selected by any account at all — where a comparison in TypeScript would
   * have to remember that `null` and `undefined` are both falsy and neither is
   * an account.
   */
  async ownBooking(exec: DbExecutor, own: OwnBooking): Promise<Booking> {
    return this.asBooking(await this.findOwn(exec, own));
  }

  /**
   * The same stay, named by the id the funnel is carrying rather than by the
   * reference — `booking.read-own`, for the steps between a hold and a booking.
   *
   * `repository-structure.md` §`(booking)` puts the hold id in the path from the
   * third step on, so this is the address `/booking/<hold>/details` and the two
   * screens after it already hold. Everything else about it is
   * {@link ownBooking}: the account comes off the session, the scope is a
   * `where` clause rather than a comparison afterwards, and a stay that is not
   * this account's is the same `NOT_FOUND` as a stay that is not there.
   *
   * The refusal names nothing back. A reference is short enough that repeating
   * it helps the guest see which stay was refused; a uuid in a sentence helps
   * nobody, and the one who would be reading it is a caller trying ids.
   */
  async ownHold(
    exec: DbExecutor,
    { bookingId, owner }: OwnHold,
  ): Promise<Booking> {
    const [row] = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(and(eq(booking.id, bookingId), scopedTo(owner)))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking of yours has that id",
      });
    }

    return this.asBooking(row);
  }

  /**
   * Who the confirmation goes to, written against a hold the guest already has.
   *
   * **The funnel asks after the room is held, not before.** `createHold` used to
   * require the pair, which meant the second step of the funnel asked a guest
   * for their name in order to reserve twenty minutes of a room they were still
   * deciding about. What actually needs somebody to write to is a stay that gets
   * confirmed, so the ask moved to the review screen and this is the door it
   * writes through. `contract/booking.ts` argues the move at the two inputs it
   * changed.
   *
   * **Only while the stay is `HELD`, and the refusal is a `CONFLICT` rather than
   * a validation error.** After payment the address is what a confirmation went
   * to and what the desk will match a guest against at check-in; a route that
   * could still rewrite it would let the paper trail be edited after the fact.
   * The state is read inside the same transaction that writes, under the row
   * lock {@link forUpdate} takes, so a hold the sweep is releasing this instant
   * cannot be given a contact on its way out.
   *
   * **Scoped like every other own-stay route** — the `where` carries
   * {@link scopedTo}, so a stay that is not the caller's is the same `NOT_FOUND`
   * as one that does not exist, and the id space stays unwalkable.
   */
  async setHoldContact(
    exec: DbExecutor,
    { bookingId, owner, contact }: SetHoldContact,
  ): Promise<Booking> {
    const [scoped] = await exec
      .select({ id: booking.id })
      .from(booking)
      .where(and(eq(booking.id, bookingId), scopedTo(owner)))
      .limit(1);

    if (!scoped) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking of yours has that id",
      });
    }

    const locked = await this.forUpdate(exec, bookingId);

    if (locked.booking.state !== "HELD") {
      throw new ORPCError("CONFLICT", {
        message:
          "This stay is no longer a hold, so the address it was booked with cannot be changed here",
      });
    }

    const [updated] = await exec
      .update(booking)
      .set({ contactEmail: contact.email, contactName: contact.name })
      .where(eq(booking.id, bookingId))
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking of yours has that id",
      });
    }

    return this.asBooking({
      booking: updated,
      roomTypeCode: locked.roomTypeCode,
    });
  }

  /**
   * The guest saying they are still on their hold — or that they have gone.
   *
   * **What it buys.** A hold used to cost the property its whole TTL whether the
   * guest was reading the review screen or had closed the tab eight minutes ago,
   * and on a busy night those minutes are what turn later guests away at the
   * anonymous share of a night. So the funnel says it is still open every twenty
   * seconds, and `hold-expiry-sweep.ts` releases a hold at the earlier of its TTL
   * and `BOOKING_HOLD_GRACE_SECONDS` after the last of these arrived.
   *
   * **It can only ever shorten a hold, and that is not a property of this method
   * — it is a property of the sweep taking the earlier of two instants.** Nothing
   * written here can move `hold_expires_at`, so a tab left open with a heartbeat
   * running holds its room for exactly as long as a tab nobody is watching: one
   * TTL. Building it the other way round would be a way for one caller to pin a
   * room indefinitely, which is the whole of what the caps in this file exist to
   * prevent.
   *
   * **It is a courtesy and never a defence.** The door is public and the write is
   * a caller volunteering something about themselves, so anybody automating this
   * will simply not send it and will keep their rooms for the full TTL exactly as
   * they do today. That costs nothing, because nothing was ever relaxed in
   * exchange: `CONCURRENT_HOLDS_PER_CALLER`, the anonymous share and the rate in
   * front of the door are all unchanged, and a future reader tempted to trade one
   * of them against "holds release themselves now" should read that sentence
   * again — they release themselves only for the callers who choose to say so.
   *
   * **Leaving is a mark rather than a release**, and the sweep is still the only
   * thing that cancels anything. That is what keeps the three rules — the earlier
   * of two clocks, never a hold with money in flight, and §3's inventory effect
   * through `cancel` — stated once instead of once per caller. It costs up to the
   * sweep's cadence in reclaim time, and buys a departure that cannot be a
   * cancellation route with its own set of conditions to keep in step.
   *
   * The reprieve is why leaving does not simply expire the grace. A reload fires
   * the same page-hide event a close does and there is no way to tell them apart,
   * so a departure that fell due immediately would let a sweep tick land in the
   * second between a guest pressing refresh and the reloaded page saying it is
   * there — a hold lost to a keystroke.
   *
   * **One statement, and the scope is in its `where`.** Not a read and then a
   * write: this runs every twenty seconds per open funnel, so it is one update by
   * primary key with {@link scopedTo} beside it, exactly as the other own-stay
   * routes are scoped — a stay that is not the caller's is the same `NOT_FOUND`
   * as one that does not exist, so the id space stays unwalkable. `updated_at` is
   * deliberately not touched: a guest looking at a page has not modified their
   * booking.
   *
   * A stay that has stopped being a hold is not refused, and it is not a case
   * either. The column means nothing on a `CONFIRMED` row and nothing reads it
   * there, and answering a guest whose payment landed a moment ago with "no
   * booking of yours has that id" would be a lie told to the only person entitled
   * to ask.
   */
  async markPresence(
    exec: DbExecutor,
    { bookingId, owner, leaving }: HoldPresence,
  ): Promise<void> {
    const [seen] = await exec
      .update(booking)
      .set({ lastSeenAt: leaving ? this.departedAt() : sql`now()` })
      .where(and(eq(booking.id, bookingId), scopedTo(owner)))
      .returning({ id: booking.id });

    if (!seen) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking of yours has that id",
      });
    }
  }

  /**
   * What a departing browser's last sighting is backdated to — far enough that
   * the hold falls due almost at once, near enough that a reload can undo it.
   *
   * Written as an interval Postgres subtracts from its own `now()`, so the mark
   * and the sweep's comparison are on one clock. Floored at nothing, because a
   * property that sets the grace to its own floor would otherwise be handing out
   * a *future* last sighting — harmless, since the hold still dies at its TTL,
   * but a value in the column that has not happened yet.
   */
  private departedAt() {
    const backdated = Math.max(
      0,
      this.env.BOOKING_HOLD_GRACE_SECONDS - DEPARTED_HOLD_REPRIEVE_SECONDS,
    );

    return sql`now() - ${`${backdated} seconds`}::interval`;
  }

  /**
   * What calling that stay off would cost, asked before calling it off —
   * `property-and-tariff.md` §4's grid, priced and not posted.
   *
   * **The calculator, and no second opinion.** `folio.service.ts` prices the
   * charge the same way when the cancellation actually happens, and a quote
   * assembled from §4's sentences instead of from `policyCharge` would be a
   * figure the property quoted and a different figure it charged. So this
   * gathers exactly what that call gathers — the plan, the arrival, the stored
   * per-night prices in stay order — and hands them over.
   *
   * **The instant is now, because that is what the guest is deciding at.** §4's
   * free window closes at a wall-clock time, so the quote and the cancellation
   * agree only while the guest is still on the same side of 18:00; a quote is a
   * question and holds nothing, which is the honest shape of that and the
   * reason nothing here is written down.
   *
   * **Only from a state a cancellation could reach.** `state-machine.ts` owns
   * which those are, asked here rather than restated: a guest already in the
   * building or a stay already called off has no cancellation to price, and
   * answering them with a number they cannot act on would read as an offer.
   */
  async cancellationQuote(
    exec: DbExecutor,
    own: OwnBooking,
  ): Promise<PolicyCharge> {
    const { booking: row } = await this.findOwn(exec, own);

    // The table and not `isLegalTransition`, and the difference is the whole of
    // this line. That function answers §4's idempotency rule as well as §2's
    // grid, so it calls `CANCELLED → CANCELLED` legal — which is right for a
    // retried cancellation and wrong here: a stay already called off has
    // nothing left to price, and quoting it would put a figure on a screen
    // beside a button that does nothing.
    if (!LEGAL_TRANSITIONS[row.state].includes("CANCELLED")) {
      throw new ORPCError("CONFLICT", {
        message: `A booking that is ${row.state} cannot be cancelled, so there is nothing to quote`,
      });
    }

    const charge = await this.priceCancellation(exec, row, new Date());

    if (charge === null) {
      // `folio.service.ts` answers this the same way and says why: the
      // calculator's `RangeError` is right about the input being malformed, and
      // from a route it is a stay whose stored prices are missing, which a 500
      // would say nothing useful about.
      throw new ORPCError("CONFLICT", {
        message:
          "That stay has no stored night prices, so §4's grid has nothing to " +
          "scale — the per-night figures are frozen when the booking is taken",
      });
    }

    return charge;
  }

  /**
   * §4's price for calling this stay off at that instant, or `null` when the
   * stay has no stored night prices to scale.
   *
   * One reader of the grid for the two callers that need one — the quote a guest
   * asks for before deciding, and the mail they are sent afterwards. Written once
   * so those two cannot disagree: a quote that said the cancellation was free and
   * a mail that charged the first night would both be right about their own
   * arithmetic and wrong about the property.
   *
   * `null` rather than a refusal, because the two callers owe the guest different
   * answers for the same missing rows. A question gets a 409 naming what is
   * missing; a message that cannot state the figure it exists to state is simply
   * not sent, and must not take a cancellation down with it.
   *
   * The instant is the caller's, and it is the whole of what they differ on. A
   * quote is asked at `new Date()` because that is what the guest is deciding at;
   * the mail is priced at the `cancelled_at` Postgres wrote, because that is when
   * the stay actually ended and it is the instant the folio will read.
   */
  private async priceCancellation(
    exec: DbExecutor,
    stay: Pick<BookingRow, "id" | "ratePlanCode" | "checkInDate">,
    cancelledAt: Date,
  ): Promise<PolicyCharge | null> {
    // Every night the stay sold, in stay order, which is the basis §4 charges
    // against — "the first night" is `booking_night`'s first row and never the
    // total over the count, because a weekend night costs more than a Tuesday.
    const nights = await exec
      .select({ gross: bookingNight.standardGross })
      .from(bookingNight)
      .where(eq(bookingNight.bookingId, stay.id))
      .orderBy(asc(bookingNight.stayDate));

    if (nights.length === 0) {
      return null;
    }

    return policyCharge({
      plan: stay.ratePlanCode,
      checkInDate: parseDate(stay.checkInDate),
      nights: nights.map((night) => night.gross),
      event: { kind: "CANCELLATION", cancelledAt },
    });
  }

  /**
   * A guest calling their own stay off — §2's `HELD`/`CONFIRMED` → `CANCELLED`,
   * at `property-and-tariff.md` §4's price.
   *
   * The same {@link cancel} the desk's route reaches, with `waivedBy` null.
   * That is the whole of "the guest pays the policy": §4's grid is keyed on the
   * event and the rate plan and reads neither the reason nor who asked, so a
   * separate calculation for this path could only ever come to disagree with the
   * one `folio.service.ts` prices the charge from. The reason is
   * `GUEST_REQUEST` because that is what it is — the route is only reachable by
   * the account that made the booking.
   *
   * A stay that is not this account's is the same refusal a read of it gets,
   * and nothing is written before that refusal: {@link findOwn} runs first, so a
   * caller naming somebody else's reference has released no inventory and
   * cancelled nothing.
   */
  async cancelOwn(exec: DbExecutor, own: OwnBooking): Promise<Booking> {
    const { booking: row } = await this.findOwn(exec, own);

    return await this.cancel(exec, {
      bookingId: row.id,
      reason: "GUEST_REQUEST",
      waivedBy: null,
    });
  }

  /**
   * The row behind both of the guest's own routes, or the refusal they share.
   *
   * **`NOT_FOUND` and not `FORBIDDEN`, for both absences.** A reference is short
   * and readable — that is what it is for — so a reply that separated "this
   * stay is not yours" from "no such stay" would answer, one guess at a time,
   * which references the property has issued. {@link isOwner} takes the same
   * line in as many words, and `folio.controller.ts` gives one sentence to a
   * missing booking and an unopened account for the same reason. The 403 that
   * file *does* raise is a different act: it refuses every guest before it looks
   * anything up, so it tells a caller nothing about which stays exist.
   */
  private async findOwn(
    exec: DbExecutor,
    { reference, owner }: OwnBooking,
  ): Promise<{ booking: BookingRow; roomTypeCode: RoomTypeCode }> {
    const [row] = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(and(eq(booking.reference, reference), scopedTo(owner)))
      .limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: `No booking of yours answers to ${reference}`,
      });
    }

    return row;
  }

  /**
   * The two creating transitions, which differ only in the state and the TTL.
   *
   * The order is deliberate. The stay is priced first, so a range the property
   * has not published rates for is refused before its rooms are taken; then the
   * nights are consumed, so a sold-out night is refused before a reference is
   * spent on it; then the row is written. A failure at any of the three rolls
   * back the whole transition — the caller's transaction is what guarantees no
   * booking row survives an inventory refusal, and no consumed night survives a
   * failed insert.
   *
   * `heldBy` arrives already hashed and only from the funnel's door. The desk's
   * path passes null, which is `booking_held_by_only_while_held` satisfied by
   * the state it writes and by the value it does not: a walk-in is confirmed on
   * the spot, so there is nothing outstanding for a cap to count.
   */
  private async create(
    exec: DbExecutor,
    input: CreateBookingInput,
    state: BookingState,
    heldBy: string | null = null,
  ): Promise<Booking> {
    // §2's *(new)* row, enforced rather than assumed. Creation straight into
    // `CHECKED_IN` is refused because a stay nobody booked has no inventory
    // behind it.
    applyTransition(null, state);

    // A stay cannot begin before the property's own day — `property-and-tariff.md`
    // §2 for what that day is, and `business-date.service.ts` for why it is not
    // the calendar date. The seeded calendar prices a year ahead and says nothing
    // about the past, so without this a request naming a date already gone would
    // price, consume inventory on nights that have happened and write a real
    // booking against them. Held, the sweep would clear it; confirmed, it would
    // sit in the property's numbers as a room it never sold.
    //
    // Both creating paths, and the same date for each. §4's arrival window
    // governs check-in and is a different guard on a different transition, so
    // nothing downstream would catch this one.
    //
    // Arriving *today* is the walk-in this system exists to take, so the
    // comparison is strictly-before and not before-or-equal. A back-dated
    // correction is `M6`'s audited path and not a side effect of taking a
    // booking.
    const today = await this.businessDate.current(exec);

    if (input.checkIn.compare(today) < 0) {
      throw new ORPCError("CONFLICT", {
        message: `A stay cannot arrive on ${input.checkIn.toString()}, which is before the business date ${today.toString()}`,
      });
    }

    const quote = await this.quotes.quote(exec, {
      ...input,
      loyaltyTier: await this.loyaltyTier(exec, input.userId),
    });

    await this.inventory.reserve(exec, {
      roomType: input.roomType,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });

    const held = await retryOnCollision(
      async (reference) => {
        // `on conflict do nothing` rather than catching the `23505`, and the
        // reason is the transaction this runs inside. A constraint violation
        // aborts a Postgres transaction outright — every statement after it
        // fails with `25P02` — so an insert that threw on a taken reference
        // would take the inventory movement above down with it and leave
        // nothing to retry into. Not raising the error is what makes a second
        // attempt possible at all.
        const [inserted] = await exec
          .insert(booking)
          .values({
            reference,
            state,
            // Null when nobody was signed in, which is the ordinary case at a
            // desk. The key refuses an account that does not exist, so a
            // mistyped id fails the transition rather than writing a booking
            // nobody can be shown.
            userId: input.userId ?? null,
            // Null unless a caller named somebody. The desk's door takes the
            // contact optionally — a walk-in is handed their confirmation at the
            // counter and has none — and the funnel's takes it not at all,
            // naming it on the review screen instead through
            // {@link BookingService.setHoldContact}.
            //
            // The two columns are independent here and that is deliberate: a
            // telephone booking often produces a name and no address, and
            // `contract/booking.ts` records why that is kept rather than
            // refused. What cannot happen is the other way round — an address
            // with nobody's name against it is refused at the door, so a row
            // with an email and no name is not a shape this writes.
            contactEmail: input.contact?.email ?? null,
            contactName: input.contact?.name ?? null,
            roomTypeId: quote.roomTypeId,
            checkInDate: input.checkIn.toString(),
            checkOutDate: input.checkOut.toString(),
            ratePlanCode: input.plan,
            adults: input.party.adults,
            childAges: input.party.children.map((child) => child.age),
            quotedStayTotalGross: quote.stayTotalGross,
            quotedPercentAdjustment: quote.percentAdjustment,
            quotedBreakfastPerPersonGross: quote.breakfastPerPersonGross,
            quotedExtraPersonPerNightGross: quote.extraPersonPerNightGross,
            // Frozen beside the plan's percentage and for the same reason: the
            // promotion is an input to the total, so a later edit to the
            // campaign must not be able to reprice a stay that was agreed under
            // it. All three null together on a stay no promotion reduced, which
            // `booking_quoted_promotion_is_whole_or_absent` holds them to.
            quotedPromotionCode: quote.promotion?.code ?? null,
            quotedPromotionType: quote.promotion?.type ?? null,
            quotedPromotionValue: quote.promotion?.value ?? null,
            holdExpiresAt: state === "HELD" ? this.holdExpiry() : null,
            // Written on the same condition as the expiry above, because the
            // two die together: the check constraint refuses a caller key on
            // anything that is not a hold, and a hold is the only row a cap has
            // any business counting.
            heldBy: state === "HELD" ? heldBy : null,
            // A hold is taken by somebody who is there, so the first instant of
            // presence is the hold's own. Without it a hold would be born
            // already absent and the sweep would take it on its next tick,
            // whatever the funnel went on to say — the guard the grace exists
            // to be is only a guard if the clock starts running here.
            //
            // Postgres' `now()` rather than this process's, because the sweep
            // compares it against Postgres' — the two ends of one comparison on
            // one clock, so a drifted node cannot shorten a hold. The expiry
            // beside it is the application's for the historical reason
            // {@link holdExpiry} carries; that one is only ever compared with
            // itself.
            lastSeenAt: state === "HELD" ? sql`now()` : null,
          })
          .onConflictDoNothing({ target: booking.reference })
          .returning();

        if (!inserted) throw new ReferenceTaken(reference);

        return inserted;
      },
      (error) => error instanceof ReferenceTaken,
    );

    // Written with the booking and in the same transaction, because §4's grid
    // charges "the first night" and refunds "the remaining nights at 50%", and
    // neither may be approximated by dividing a total by a count when a weekend
    // night costs more than a Tuesday. A booking without its nights is a stay
    // no cancellation could be priced from.
    await exec.insert(bookingNight).values(
      quote.nights.map((night) => ({
        bookingId: held.id,
        stayDate: night.stayDate.toString(),
        standardGross: night.standardGross,
      })),
    );

    return this.asBooking({ booking: held, roomTypeCode: input.roomType });
  }

  /**
   * The booking, locked for the rest of the transaction.
   *
   * `for update` and not a plain read. Two requests cancelling one booking would
   * otherwise both see it live, both pass the transition check and both release
   * the nights — the idempotency guard above only holds if the state it read
   * cannot change under it. `of booking` keeps the lock off `room_type`, which
   * is joined for its code and is not being decided about.
   */
  private async forUpdate(
    exec: DbExecutor,
    bookingId: string,
  ): Promise<{ booking: BookingRow; roomTypeCode: RoomTypeCode }> {
    const [row] = await exec
      .select({ booking, roomTypeCode: roomType.code })
      .from(booking)
      .innerJoin(roomType, eq(booking.roomTypeId, roomType.id))
      .where(eq(booking.id, bookingId))
      .limit(1)
      .for("update", { of: booking });

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "No booking with that id",
      });
    }

    return row;
  }

  /**
   * The tier the buyer holds, in the form the quote gates a discount on.
   *
   * Null for a stay nobody signed in for — a walk-in, a telephone booking, a
   * funnel hold taken before the guest attached an account — because there is
   * no history to derive from and §7's ladder is about a guest's own stays.
   *
   * `MEMBER` becomes null too, and that is `rate-calendar.ts`'s rule rather than
   * a convenience: the base tier carries no discount, so a promotion gated on it
   * would be gated on nothing, and `LOYALTY_TIERS` deliberately does not hold
   * the word. Derived here and not stored anywhere — `FR-GST-04` makes the tier
   * a derived value, and what the booking freezes is the *discount* it produced,
   * never the tier itself.
   *
   * A stay attached to an account after the fact keeps the price it was sold at.
   * §8 freezes a quote at the moment of sale, and a guest who signed in
   * afterwards was not quoted a member rate to be given one retrospectively.
   */
  private async loyaltyTier(
    exec: DbExecutor,
    userId: string | null | undefined,
  ): Promise<LoyaltyTier | null> {
    if (!userId) {
      return null;
    }

    const tier = await this.tiers.deriveTier(exec, userId);

    return tier === "MEMBER" ? null : tier;
  }

  /** When a hold stops holding — `FR-BOOK-02`, at the configured length. */
  private holdExpiry(now: Date = new Date()): Date {
    return new Date(
      now.getTime() + this.env.BOOKING_HOLD_TTL_MINUTES * MS_PER_MINUTE,
    );
  }

  /** The stored row as the application's shape — ISO text back into `StayDate`. */
  private asBooking({
    booking: row,
    roomTypeCode,
  }: {
    booking: BookingRow;
    roomTypeCode: RoomTypeCode;
  }): Booking {
    return {
      id: row.id,
      reference: row.reference,
      userId: row.userId,
      contactEmail: row.contactEmail,
      contactName: row.contactName,
      state: row.state,
      cancellationReason: row.cancellationReason,
      roomType: roomTypeCode,
      checkIn: parseDate(row.checkInDate),
      checkOut: parseDate(row.checkOutDate),
      plan: row.ratePlanCode,
      adults: row.adults,
      childAges: row.childAges,
      stayTotalGross: row.quotedStayTotalGross,
      holdExpiresAt: row.holdExpiresAt,
    };
  }
}

/**
 * The half of the `where` clause that makes a lookup about the caller's own
 * stay — {@link BookingOwner}, as SQL.
 *
 * An account is compared to `user_id`, and SQL's equality never matches a null,
 * so every stay the desk took stays unreachable by any account at all. A proven
 * booking is compared to the primary key, which is the narrowest clause there
 * is: it can select one row and that row is the one the credential was minted
 * for. Either way the scope is in the query rather than in a comparison
 * afterwards, which is what makes it unforgettable.
 *
 * **The anonymous branch carries one more column, and this is the only place it
 * is read.** `booking-token.service.ts` verifies its credential by arithmetic
 * and reads no row, which is what keeps it cheap on a cookie sent with every
 * request under `/bookings` — and leaves it unable to say whether that
 * credential has since been surrendered. `anon_access_revoked_at` is that
 * instant, and testing it here costs nothing at all: it is another conjunct on
 * a `where` that was already going to fetch this row, so a revoked stay comes
 * back as no row rather than as a second query's answer. `access.guard.ts` still
 * takes no round trip, which was the point.
 *
 * A revoked stay is then indistinguishable from one that does not exist, which
 * is the same refusal a stranger's booking gets and is right for the same
 * reason. The account branch is untouched — revocation kills the loose copy of
 * an anonymous credential and says nothing about who owns the booking, so a
 * guest who has just attached this stay reads it through their session exactly
 * as before.
 */
function scopedTo(owner: BookingOwner) {
  return owner.kind === "account"
    ? eq(booking.userId, owner.userId)
    : and(eq(booking.id, owner.bookingId), isNull(booking.anonAccessRevokedAt));
}
