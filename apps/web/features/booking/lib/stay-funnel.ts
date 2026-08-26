// The four calls the funnel makes after a guest has chosen a room, and the
// vocabulary the screens read them in.
//
// `booking-search.ts` owns everything before this point — the dates and the room
// are search params, because `/booking` is stateless and shareable. From the
// hold onward there is a record on the server, and this file is how the screens
// reach it. Nothing below holds state: every screen reads the stay from the API
// rather than from whatever the tab was carrying, which is what makes refresh
// and the browser's back button work on steps that can expire.
//
// **The contact pair goes up after the hold, not with it.** It used to travel
// with the hold, which meant the room step asked a guest for their name and
// address in order to reserve twenty minutes of a room they had not yet seen a
// total for. What has to have somebody to write to is a stay that gets
// confirmed, so the pair is collected on the review screen and written through
// `saveContact` — one call, one press before the money. It is an address and a
// name and nothing else; the phone is checked against a document at check-in.
//
// **The amount is never sent up.** `createHold` takes the room, the nights, the
// party and that pair, and the API prices them — `contract/booking.ts` is explicit that an
// amount arriving with the request would be a price the guest proposed. So the
// figure the payment step collects is `stayTotalGross` off the hold the API
// wrote, and the fixture prices `/booking` renders from cannot leak into money.
//
// **The gateway's captions are read here rather than trusted here.** The API
// hands the payer back with `?payment=…`, and `payment.controller.ts` is careful
// that this is a caption and not a fact about money: the redirect and the IPN
// are two independent deliveries and the browser can win. So `confirming/` reads
// the caption to decide what to *say* while it waits, and reads the stay's state
// to decide what is *true*.

import type {
  GatewayPaymentMethod,
  Presentment,
  RatePlanCode,
  RoomTypeCode,
  StayDate,
} from "@mariva/shared";
import { API_URL, api, apiMessage } from "@/lib/api";

/**
 * A stay as the API answers it — the shape every screen after the hold reads.
 *
 * Inferred from the client rather than written out, which is the whole reason
 * `packages/api-client` exists: the contract in `@mariva/shared` types both
 * ends, so a field that changes shape breaks these screens in the pull request
 * that changed it. A hand-written mirror of this would be a second declaration
 * of the same thing, agreeing until one of them was edited.
 */
export type HeldStay = Awaited<ReturnType<typeof api.booking.readOwnHold>>;

/**
 * The stay's total as money — the only type it may be arithmetic in.
 *
 * **Normalised rather than trusted, and that is deliberate.** `money.ts` holds
 * đồng as `bigint` inside both processes and crosses them as decimal text,
 * because JSON has no integer wide enough for money; the contract declares the
 * `bigint`, and what a given transport hands back is the transport's business.
 * `BigInt` accepts either, so this reads the same figure whichever arrives —
 * and a widening or narrowing of that boundary cannot silently turn a total
 * into a number that has lost đồng.
 */
export function stayTotal(stay: HeldStay): bigint {
  return BigInt(stay.stayTotalGross);
}

/**
 * Who the confirmation goes to, and what to call them.
 *
 * Collected after the hold rather than at it — `contract/booking.ts` argues the
 * move at `createHold` and `setOwnHoldContact`. The short of it: a hold that
 * expires unpaid is inventory coming back and the property has nothing to send
 * anybody about it, so the obligation belongs one press before the money rather
 * than one press before the room is reserved.
 *
 * No phone. It is checked against a document at check-in, where the desk already
 * asks for it, and a number typed into a funnel is neither verified nor needed
 * before the guest arrives.
 */
export interface StayContact {
  readonly email: string;
  readonly name: string;
}

/** Nothing entered yet — the value a screen starts a fresh funnel from. */
export const NO_CONTACT: StayContact = { email: "", name: "" };

/**
 * The pair already on the stay, as a form's starting value.
 *
 * The API answers both as nullable, because a stay the desk took has neither and
 * a hold has neither until the review screen writes them. A screen wants two
 * strings either way, so the nulls become the empty fields they mean rather than
 * `value={null}` and a React warning about an input changing from uncontrolled
 * to controlled halfway down the funnel.
 */
export function stayContact(stay: HeldStay): StayContact {
  return { email: stay.contactEmail ?? "", name: stay.contactName ?? "" };
}

/**
 * The bare shape of an address, and nothing cleverer.
 *
 * The API's schema is the authority and will refuse what this lets through, so a
 * stricter rule here would be a second opinion that turns away a guest the
 * property would have accepted. What it is for is answering *before* the
 * request, so an unfinished field is a line beside it rather than a round trip
 * that consumes nothing and reads like a failure.
 */
export function isEmailAnswered(contact: StayContact): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim());
}

/** Something to put at the top of the confirmation. Blank is the only refusal. */
export function isNameAnswered(contact: StayContact): boolean {
  return contact.name.trim().length > 0;
}

/**
 * Whether the pair is answered well enough to send.
 *
 * **Composed rather than written out, because the halves are now asked for
 * separately.** The review screen marks the offending field and moves the cursor
 * into it, which means it has to know *which* of the two is unfinished — and a
 * screen that re-derived that with its own regex would be a third opinion about
 * an address, disagreeing with this one the first time either was edited.
 */
export function isContactAnswered(contact: StayContact): boolean {
  return isEmailAnswered(contact) && isNameAnswered(contact);
}

/** What the funnel knows when it asks for a hold. */
export interface StayRequest {
  readonly roomType: RoomTypeCode;
  readonly checkIn: StayDate;
  readonly checkOut: StayDate;
  readonly plan: RatePlanCode;
  readonly adults: number;
  readonly childAges: readonly number[];
}

/**
 * Takes the hold — `FR-BOOK-02`'s door, the one the funnel is given.
 *
 * The nights are consumed at this point rather than at payment, so two guests
 * cannot both reach a payment page for the last room. What comes back carries
 * the id the next three screens are addressed by and the expiry they count
 * down to.
 */
export async function holdStay(request: StayRequest): Promise<HeldStay> {
  return await api.booking.createHold({
    roomType: request.roomType,
    // The nine characters the contract's codec decodes back into a
    // `CalendarDate` on the other side. A `Date` here would be an instant, and
    // an instant is what a stay date is deliberately not.
    checkIn: request.checkIn.toString(),
    checkOut: request.checkOut.toString(),
    plan: request.plan,
    adults: request.adults,
    childAges: [...request.childAges],
  });
}

/**
 * The two sentences the funnel writes itself, for the failures that carry none.
 *
 * The API's own refusals are preferred over both — `booking.service.ts` writes
 * them for the person who will read them, and only that side knows how long a
 * hold lasts or which night was short. These are for what never reached a
 * handler: a network that was not there, an API that is not up, a refusal whose
 * body arrived empty.
 *
 * Copy per `design-foundations.md` §6 — plain, blameless, no apology theatre.
 * Neither of them quotes a number, and that is deliberate: the hold TTL and the
 * limiter's window are the property's configuration, and a figure hard-coded
 * into this app would be a hotel fact invented in the browser.
 */
const HOLD_MESSAGES = {
  waiting:
    "Rooms cannot be held from here at the moment. Nothing has been charged — try again in a few minutes.",
  failed:
    "The room could not be held just now. Nothing has been charged — try again in a moment.",
} as const;

/**
 * Why the room was not held, in the one line the room step has to say it in.
 *
 * **The distinction is a wait against a fault, and it is read off the status.**
 * The same pattern the sign-in screens keep: 429 on this door is the property
 * saying "not yet" — three of them, and every one of them is a caller who asked
 * more often, or held more rooms, or took more of a night than an address
 * without an account may. None of that is broken and none of it is the guest's
 * doing, so the funnel must not answer it with "try again in a moment", which is
 * both wrong about the wait and shaped like an outage.
 *
 * What it does instead is hand the refusal through whole. Those sentences name
 * the wait in minutes and, where signing in is a real escape, they say so — and
 * the only side that can say either is the one holding the configuration. A
 * message invented here would be a second, vaguer opinion about the property's
 * own rules.
 *
 * Everything else keeps the funnel's own fallback, because a 500, a CORS pair
 * that does not agree and a dead network are faults rather than answers, and
 * "nothing has been charged" is the fact a guest wants first.
 */
export function holdRefusal(error: unknown): string {
  return apiMessage(
    error,
    isRefusedForNow(error) ? HOLD_MESSAGES.waiting : HOLD_MESSAGES.failed,
  );
}

/**
 * Whether the API answered "not yet" rather than failing.
 *
 * Read off the status the transport carries and never off the sentence, for the
 * reason `sign-in.ts` gives at the same test: the status is the API's configured
 * behaviour stated once, and re-deriving it by matching words in a body is a
 * second thing that can be wrong — and it would break the first time a refusal
 * was reworded, which is exactly what has just happened to all three of them.
 *
 * Duck-typed rather than instance-checked. oRPC's error class is the transport's
 * and `packages/api-client` is deliberately the only place this app depends on
 * it; what crosses into here is an object carrying the status the API answered
 * with, and a shape check is what reads it without pulling the package in.
 */
function isRefusedForNow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 429
  );
}

/**
 * Names who the confirmation goes to, against a hold the guest already has.
 *
 * Called by the review screen immediately before the payment attempt is opened,
 * and by nothing else. Two round trips rather than one because they are two
 * different writes to two different resources — the stay's contact and a payment
 * attempt against it — and folding the pair into `openAttempt` would put a
 * guest's address in the body of the call that reaches the gateway.
 *
 * Answers with the stay, so the screen that called it keeps reading the API
 * rather than the value it just typed.
 */
export async function saveContact(
  stay: HeldStay,
  contact: StayContact,
): Promise<HeldStay> {
  return await api.booking.setOwnHoldContact({
    bookingId: stay.id,
    // Trimmed here rather than at the input, so the field a guest is typing in
    // never has characters removed under the cursor.
    contactEmail: contact.email.trim(),
    contactName: contact.name.trim(),
  });
}

/**
 * The stay behind a funnel url, read back under the guest's own session.
 *
 * Every screen from `details` on starts here rather than from anything it was
 * handed, which is what `repository-structure.md` §`(booking)` means by making
 * back and refresh deterministic. A stay that is not the caller's answers 404,
 * so a guest who edits the id in the address bar sees the same thing as one who
 * invented it.
 */
export async function readStay(bookingId: string): Promise<HeldStay> {
  return await api.booking.readOwnHold({ bookingId });
}

/**
 * Says the guest is still standing on this hold.
 *
 * **What it is for.** A hold used to cost the property its whole TTL whether the
 * guest was reading the total or had closed the tab eight minutes ago. The API
 * releases a hold at the earlier of its TTL and a grace after the last of these,
 * so a funnel that keeps saying it is open keeps its room and one nobody is
 * looking at gives it back in a couple of minutes.
 *
 * **It cannot buy the guest longer than the property gave them.** The deadline
 * the API takes is the *earlier* of the two, so a tab left open overnight holds
 * its room for one TTL exactly as an abandoned one does. Nothing this sends is
 * an argument the funnel can make for more time.
 *
 * A failure is not a caller's problem and is deliberately not reported to one:
 * see {@link use-hold-presence}. The grace is generous against the interval
 * precisely so that a few of these going missing costs nobody a room.
 */
export async function markPresence(bookingId: string): Promise<void> {
  // `leaving` is sent rather than left to a default, and the contract requires
  // it for that reason: with the id in the path it is the only thing left to put
  // in a body, and a request with no body carries no `content-type` — which is
  // the one shape `json-request.guard.ts` refuses. Saying it is what makes this
  // a JSON request at all.
  await api.booking.markHoldPresence({ bookingId, leaving: false });
}

/**
 * Says the guest has gone, on the way out of the page.
 *
 * **`sendBeacon` and not `fetch`, because the page is leaving.** A request
 * started in a `pagehide` handler is abandoned with the document unless the
 * browser has been told to keep it; the beacon is that instruction, and it sends
 * the booking cookie with it — which this needs, because a release keyed on
 * nothing but an id in a url would let any page drop a hold it could name.
 *
 * **A `Blob` typed `application/json`, deliberately.** The route refuses the
 * three content types a cross-site `<form>` can post, so a beacon that took the
 * default type would be refused on arrival — and the type is also what forces
 * this into a preflight the API's origin allowlist answers, which is the whole
 * of why the route can be trusted to a cookie the browser attaches by itself.
 *
 * **It is an optimisation and never the mechanism.** Unload events do not fire
 * on a crash, a force-quit, a phone killing a backgrounded tab or a network that
 * has already gone, which are exactly the departures this feature exists for —
 * and a preflight started as a document is torn down is one the browser may not
 * finish. So this only shortens what the guest's silence would have achieved
 * anyway: the ping stops, the grace runs out, and the sweep takes the hold.
 *
 * **It marks a departure; it does not release anything.** The API backdates the
 * last sighting and its sweep does the rest, so the rules about when a room may
 * be given back — never one with money in flight, always through the transition
 * that puts the nights back — are stated in one place instead of once per caller.
 * The room comes back within a sweep's cadence rather than instantly, which is
 * the trade.
 */
export function markDeparture(bookingId: string): void {
  if (typeof navigator?.sendBeacon !== "function") {
    return;
  }

  navigator.sendBeacon(
    `${API_URL}/bookings/holds/${encodeURIComponent(bookingId)}/presence`,
    new Blob([JSON.stringify({ leaving: true })], {
      type: "application/json",
    }),
  );
}

/** What opening an attempt hands back — where to send the payer, and, for a
 *  gateway that cannot take đồng, exactly what it will charge. */
export interface OpenedPayment {
  readonly paymentUrl: string;
  readonly reference: string;
  /**
   * What the payer will actually be charged, present only when
   * {@link openPayment} was asked for a gateway that settles in something
   * other than đồng.
   *
   * **This is the one read a screen may ever quote a payer from.** The
   * property converts at its configured rate the moment the attempt opens
   * and freezes the result onto the row before anything is asked of the
   * gateway — `payment.service.ts` argues why — and this is that same
   * figure, handed back rather than computed a second time. There is no
   * route that answers "what would PayPal charge" ahead of an attempt, and
   * this file must never grow one: a quote read before the row exists is a
   * second read of the configured rate, and an `ADMIN` editing it between
   * the two would quote the guest one figure and charge them another.
   */
  readonly presentment?: Presentment;
}

/**
 * Opens a payment attempt against the stay and hands back where to send the
 * payer — `FR-PAY-02`.
 *
 * The amount is the stay's own total, read off the record rather than passed
 * through the browser, so the figure the gateway collects is the figure the API
 * priced. Nothing about money has happened when this answers: the attempt is
 * `PENDING` until a callback resolves it, which is why the screen that follows
 * is called `confirming` and not `paid`.
 *
 * **The gateway is the caller's explicit choice and never inferred.** A guest
 * abroad may hold a Vietnamese card and a guest here may hold a PayPal
 * balance, so a locale or a currency guessed from the browser would get both
 * of them wrong in a way that cannot be undone once the payer has been sent
 * to the wrong gateway's page.
 */
export async function openPayment(
  stay: HeldStay,
  method: GatewayPaymentMethod,
): Promise<OpenedPayment> {
  return await api.payment.openAttempt({
    bookingId: stay.id,
    // The figure the API priced, handed straight back — not re-derived, not
    // rounded, and never read off the screen. `payment.service.ts` writes the
    // attempt's row with it and compares every callback against that row, so
    // this is the number the whole reconciliation hangs on. The contract's
    // codec takes it as text; `stayTotal` is what makes the crossing explicit
    // rather than leaving a `toString` on whatever type happened to arrive.
    amount: stayTotal(stay).toString(),
    description: `Mariva stay ${stay.reference}`,
    method,
  });
}

/**
 * What the gateway told the browser on the way back, as the API captions it.
 *
 * The four `payment.controller.ts` sends, and `unknown` for a landing that
 * carries none — somebody who bookmarked the page, or arrived at it directly.
 * A caption is never read as an outcome: `confirming` means the gateway claims
 * it took the money and this property has not finished agreeing.
 */
export type PaymentCaption =
  | "confirming"
  | "refused"
  | "unfinished"
  | "unverified"
  | "unknown";

export function readCaption(value: string | null): PaymentCaption {
  switch (value) {
    case "confirming":
    case "refused":
    case "unfinished":
    case "unverified":
      return value;
    default:
      return "unknown";
  }
}

/**
 * Whether a stay has stopped being a hold, which is the only thing that means
 * the money arrived.
 *
 * Read off the state rather than off the caption, because the caption is the
 * gateway's word to a browser and this is the property's own record. The IPN is
 * what moves it — `payment.service.ts` confirms the stay in the same commit as
 * the payment — so a screen watching this is watching for the callback to land.
 */
export function isSettled(stay: HeldStay): boolean {
  return stay.state !== "HELD";
}

/** A stay nobody can pay for any more — the hold expired, or it was called off. */
export function isLost(stay: HeldStay): boolean {
  return stay.state === "CANCELLED";
}

/**
 * A stay that became a booking — the only reading of "not held any more" that a
 * screen may congratulate somebody on.
 *
 * **Both halves, and the second is the one worth naming.** `isSettled` asks
 * whether the stay stopped being a hold, and a cancellation stops it exactly as
 * a payment does: `hold-expiry-sweep.ts` releases a hold whose TTL ran out while
 * its guest was away at the gateway, and the stay it leaves behind satisfies
 * `isSettled` while meaning the opposite of it. A screen reading the one
 * predicate alone thanks that guest for a payment and sends them to a
 * confirmation for a room that is back on sale.
 *
 * Written here rather than as an expression on each screen because it is the
 * distinction the funnel turns on at its most expensive moment, and this is the
 * file the screens read their vocabulary from — and the only one of the two
 * places a `.spec.ts` can hold it to account.
 */
export function isBooked(stay: HeldStay): boolean {
  return isSettled(stay) && !isLost(stay);
}
