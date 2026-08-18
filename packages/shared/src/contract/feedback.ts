// What a guest says about a stay once it is over — two routes over one
// sub-resource of the stay they already own.
//
// **It hangs off `/bookings/mine/{reference}` and not off a collection of its
// own.** `screens.md` §Account puts cancelling a stay, providing the identity
// document and leaving feedback all on `/bookings/<reference>`, "the one surface
// that owns a stay's full context" — so the address a guest's opinion lives at
// is the address of the stay it is about. A top-level `/feedback` would have had
// to name the booking in a body, and a booking named in a body is one the
// ownership check has to be remembered for; named in the path, it goes through
// the same lookup every other route under `/bookings/mine/` uses.
//
// **`ownBookingInput` is reused rather than restated**, for the reason that
// schema gives about the guest's read and their cancellation: a guest reading
// their feedback, a guest leaving it and a guest calling the stay off all state
// exactly the same thing about which stay, and a second bound on the reference
// here would be a third copy of a format `reference-generator.ts` owns.
//
// **Singular, so it is a `POST` that can be refused rather than a `PUT` that
// cannot.** A stay is rated once. `PUT` promises that sending the same body
// twice leaves the same state, which would make a second, different rating an
// edit — and an opinion that can be rewritten after the property has read it is
// not a record of what the guest thought when they left. So creation is a
// `POST` to the singular resource and the second one is refused as a conflict.
//
// **The read answers `null` for a stay that has been checked out and nothing
// written on, and refuses outright for a stay that is not finished.** Those are
// two different facts and a screen does two different things with them: the
// first is the form, the second is no feedback surface at all. Folding both into
// `null` would leave the screen unable to tell "you may write" from "there is
// nothing to write about yet" without reading the booking a second time, and
// inventing an `eligible` flag beside the answer would put the same rule in two
// shapes. The refusal is the eligibility, stated once by the service that
// enforces it for the write.
//
// **No staff route is declared here.** The matrix gives `MANAGER` and `ADMIN` a
// 👁 over this row, so one may exist later; no screen reads it today, and
// `index.ts` refuses an entry with no implementation behind it — a route listed
// speculatively is a promise the type system holds every client to and nobody
// can keep.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { ownBookingInput } from "./booking.js";

/**
 * The top of the scale, and the only end of it worth naming.
 *
 * Exported because the form draws the scale and the service bounds it, and a
 * screen offering six stars against a column that stores five is the drift this
 * prevents. The bottom is 1 everywhere and needs no constant: a rating of zero
 * is not a quieter opinion, it is the absence of one, and the absence of one is
 * no row.
 */
export const HIGHEST_RATING = 5;

/**
 * How much a guest may write, in characters.
 *
 * Bounded rather than free text of any length, on `unmaskCccdInput`'s argument:
 * this is read by a person at the property, and a box that can absorb a pasted
 * document is a box nobody reads. Generous enough for a paragraph or two, which
 * is what a guest who liked or disliked something actually writes.
 */
export const LONGEST_FEEDBACK_COMMENT = 1000;

/**
 * One to five, whole.
 *
 * `.int()` rather than a bare range, because the wire carries JSON numbers and
 * 4.5 would otherwise reach a column typed `integer` and fail there as a fault
 * rather than here as an answer. The database repeats the range as a check for
 * the same reason `guest.ts` repeats its own: a bound stated only at the edge is
 * a bound any other writer can walk around.
 */
export const feedbackRatingSchema = z.number().int().min(1).max(HIGHEST_RATING);

/**
 * What one guest left about one stay.
 *
 * `reference` travels back although the caller sent it: it is what the screen
 * addresses the stay by, and echoing what somebody asked for tells them nothing
 * they did not already know. The booking's id is deliberately absent — a guest
 * never sees it on this route, and the reference is the handle they hold.
 *
 * `comment` is nullable because a rating with nothing written beside it is a
 * complete answer. It is the ordinary case, not a half-filled one.
 *
 * `submittedAt` is an instant and takes the full ISO-8601 form, unlike a stay's
 * dates: this is the moment somebody pressed a button, not a day in a place.
 */
export const feedbackSchema = z.object({
  reference: z.string(),
  rating: feedbackRatingSchema,
  comment: z.string().nullable(),
  submittedAt: z.iso.datetime(),
});

/**
 * A rating, optionally a sentence, about the stay named in the path.
 *
 * The blank comment is refused by the trim and the minimum rather than stored —
 * an empty box and a box somebody typed two spaces into are both "nothing
 * written", and storing either as a comment would put a row of whitespace in
 * front of whoever reads these. Absent and `null` both mean the same thing here
 * and both are accepted, because a form that clears its box and a form that
 * never sent one are the same guest saying nothing.
 *
 * Nothing else is taken. Who left it and when are the session's and the clock's,
 * and a field for either would be a guest filing an opinion under another name
 * or backdating one.
 */
export const submitFeedbackInput = ownBookingInput.extend({
  rating: feedbackRatingSchema,
  comment: z.string().trim().min(1).max(LONGEST_FEEDBACK_COMMENT).nullish(),
});

export const feedback = {
  readOwn: oc
    // A `GET` on the stay's own feedback, and the answer is nullable: a finished
    // stay nobody has written about yet is a resource that legitimately holds
    // nothing, where a 404 would be indistinguishable from the refusal a
    // stranger's stay gets.
    .route({ method: "GET", path: "/bookings/mine/{reference}/feedback" })
    .input(ownBookingInput)
    .output(feedbackSchema.nullable()),

  submit: oc
    // The same address, written to. One rating per stay is the storage layer's
    // guarantee rather than this route's promise, so a second press — a
    // double-tap, a retried request, two tabs — is refused rather than quietly
    // overwriting what the guest already said.
    .route({ method: "POST", path: "/bookings/mine/{reference}/feedback" })
    .input(submitFeedbackInput)
    .output(feedbackSchema),
};
