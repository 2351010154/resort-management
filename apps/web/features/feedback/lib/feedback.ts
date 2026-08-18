// The two calls `/bookings/<reference>` makes about a finished stay.
//
// Both resolve rather than throw, in `stays.ts`'s and `booking-links.ts`'s
// shape, and here the distinction the shape carries is the whole of what the
// screen is drawn from. Three answers come back from one read:
//
// - a piece of feedback — the guest has already said their part, and it is shown
//   back to them;
// - `null` — the stay is over and nothing has been written, which is the one
//   case the form is offered for;
// - a refusal — the stay is not over, is not this browser's, or there is no
//   session at all. All three mean the same thing to this screen: there is
//   nothing to offer, and it draws no feedback surface at all.
//
// That is why a refusal carries no sentence here. Every other guest screen shows
// the API's own words, because the guest asked for something and did not get it;
// nobody asked for this, and an error message under a booking about a route the
// page decided to try would be the page apologising for its own probe.

import { api, apiMessage } from "@/lib/api";

/**
 * What one guest left about one stay, inferred from the client rather than
 * written out — the contract types both ends, so a field that changes shape
 * breaks this screen in the pull request that changed it.
 */
export type StayFeedback = NonNullable<
  Awaited<ReturnType<typeof api.feedback.readOwn>>
>;

/** What the guest is sending: a rating, and whatever they wrote beside it. */
export type FeedbackDraft = Omit<
  Parameters<typeof api.feedback.submit>[0],
  "reference"
>;

export type ReadOutcome =
  | { readonly ok: true; readonly feedback: StayFeedback | null }
  | { readonly ok: false };

export type SubmitOutcome =
  | { readonly ok: true; readonly feedback: StayFeedback }
  | { readonly ok: false; readonly message: string };

// Copy per design-foundations §6 — plain and blameless, no apology theatre and
// no exclamation marks.
const REFUSED =
  "That could not be sent just now. Check your connection and try again.";

/** What the guest already said about this stay, if this stay can be spoken
 *  about at all. */
export async function readFeedback(reference: string): Promise<ReadOutcome> {
  try {
    return { ok: true, feedback: await api.feedback.readOwn({ reference }) };
  } catch {
    return { ok: false };
  }
}

/**
 * The guest's word, sent once.
 *
 * The API's own sentence is preferred over anything invented here — a stay
 * already rated and a stay not yet finished are both refused, and both refusals
 * are written for the person who will read them.
 */
export async function submitFeedback(
  reference: string,
  draft: FeedbackDraft,
): Promise<SubmitOutcome> {
  try {
    return {
      ok: true,
      feedback: await api.feedback.submit({ reference, ...draft }),
    };
  } catch (error) {
    return { ok: false, message: apiMessage(error, REFUSED) };
  }
}
