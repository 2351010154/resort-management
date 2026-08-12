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
// **The amount is never sent up.** `createHold` takes the room, the nights and
// the party, and the API prices them — `contract/booking.ts` is explicit that an
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

import type { RatePlanCode, RoomTypeCode, StayDate } from "@mariva/shared";
import { api } from "@/lib/api";

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
 * Opens a payment attempt against the stay and hands back where to send the
 * payer — `FR-PAY-02`.
 *
 * The amount is the stay's own total, read off the record rather than passed
 * through the browser, so the figure the gateway collects is the figure the API
 * priced. Nothing about money has happened when this answers: the attempt is
 * `PENDING` until a callback resolves it, which is why the screen that follows
 * is called `confirming` and not `paid`.
 */
export async function openPayment(stay: HeldStay): Promise<{
  readonly paymentUrl: string;
  readonly reference: string;
}> {
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
