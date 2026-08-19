// The two calls this panel makes about calling a stay off.
//
// Both resolve rather than throw, in `booking-links.ts`'s and `feedback.ts`'s
// shape, and the difference between the two shapes below is the whole of what
// the panel is drawn from.
//
// **The quote's refusal carries no sentence, and the cancellation's does.**
// Nobody asked for the quote — the panel probes on arrival to find out whether
// there is anything to offer — and an error message under a booking about a
// route the page decided to try would be the page apologising for its own
// probe. The cancellation is the opposite: the guest pressed a button, did not
// get what they pressed for, and is owed the API's own words about why.
//
// **The panel never decides eligibility itself.** `state-machine.ts` is where a
// stay's remaining transitions live and `booking.service.ts` is what reads them;
// a predicate here over the booking's state would be a second copy of §2's
// table, agreeing with the first until one of them was edited. So the quote is
// asked, and a refusal means there is nothing to offer — whether that is a stay
// already called off, one the guest is standing inside, or one this browser
// cannot prove is theirs.

import { api, apiMessage } from "@/lib/api";

/**
 * What calling this stay off would cost — `policyChargeSchema`, inferred from
 * the client rather than written out, so a field that changes shape breaks this
 * panel in the pull request that changed it.
 */
export type CancellationQuote = Awaited<
  ReturnType<typeof api.booking.cancellationQuote>
>;

/** The stay as it stands once it has been called off. The API answers the whole
 *  booking, so the panel reads the new state off the response rather than
 *  assuming the transition it asked for is the one that happened. */
export type CancelledStay = Awaited<ReturnType<typeof api.booking.cancelOwn>>;

export type QuoteOutcome =
  | { readonly ok: true; readonly quote: CancellationQuote }
  | { readonly ok: false };

export type CancelOutcome =
  | { readonly ok: true; readonly stay: CancelledStay }
  | { readonly ok: false; readonly message: string };

// Copy per design-foundations §6 — plain and blameless, and quoting no figure
// the property owns. Reached only by what never got to a handler: a network
// that was not there, an API that is not up, a refusal whose body arrived empty.
const REFUSED =
  "This stay could not be cancelled just now. Check your connection and try again.";

/** What §4's grid charges for calling this stay off, asked before deciding to.
 *  A question and not an act: nothing is reserved and no state moves. */
export async function quoteCancellation(
  reference: string,
): Promise<QuoteOutcome> {
  try {
    return {
      ok: true,
      quote: await api.booking.cancellationQuote({ reference }),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * The stay, called off at the guest's own request.
 *
 * The API's own sentence is preferred over anything invented here — a stay that
 * moved out from under the guest between the quote and the press is refused in
 * words written for the person who will read them.
 */
export async function cancelStay(reference: string): Promise<CancelOutcome> {
  try {
    return { ok: true, stay: await api.booking.cancelOwn({ reference }) };
  } catch (error) {
    return { ok: false, message: apiMessage(error, REFUSED) };
  }
}
