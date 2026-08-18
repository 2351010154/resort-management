// What the guest reads when a stay they were told was confirmed stops
// happening — the second of `FR-NTF-01`'s four transactional mails.
//
// A plain function of its arguments, for the reason `guest-auth-emails.ts`
// gives: no service, no DI, no template engine, so the whole body can be read
// here and asserted against without a running application. Text and HTML both,
// because a guest reading in a text-only client is owed the same figures.
//
// ## It carries no link, and that is a decision rather than an omission
//
// The confirmation beside it carries two signed credentials, which is why a
// confirmation waiting on the queue is reduced to facts — `queued-confirmation.ts`
// argues that at length. This message has nothing to reduce: a cancelled stay has
// no page worth opening, no payment to make and no account step to offer. So it
// is the one booking mail that may sit whole in a job row, and
// `booking-cancellation.service.ts` says so where it hands it over.
//
// ## Two figures, and neither is computed here
//
// The penalty is what `property-and-tariff.md` §4's grid actually charged, and
// the refund is what the account is over-paid by once that penalty stands. Both
// arrive as amounts from the caller, which is the only place they can honestly
// come from: §4's grid is `cancellation-calculator.ts`'s, the waiver that sets it
// aside is a column on the booking, and the ledger that hands the money back is
// the folio's. A template that recomputed a percentage would be a fourth opinion
// on a figure the property has already quoted.
//
// A penalty of nothing is said in words rather than printed as "0 ₫", because the
// two cases that produce it — §4's free window and a manager's waiver — are both
// good news and a zero on a line labelled "charge" reads as a fee nobody
// explained.

import {
  type CancellationReason,
  formatVnd,
  type VndAmount,
} from "@mariva/shared";
import type { OutgoingEmail } from "../mailer.service.js";
import { escapeHtml, PROPERTY } from "./guest-auth-emails.js";

export interface BookingCancellationEmailParams {
  /** The booking's contact address. */
  readonly to: string;

  /** The booking's contact name. Typed by whoever booked — hostile input, and
   *  escaped everywhere it is interpolated. */
  readonly guestName: string;

  /** The booking reference, as the guest will quote it if they write back. */
  readonly reference: string;

  /** Why the stay ended, as the record holds it. Put into words below. */
  readonly reason: CancellationReason;

  /** What §4's grid charged for calling the stay off — zero when the window was
   *  free or a manager waived it. */
  readonly penalty: VndAmount;

  /** Money going back to the guest, and `null` when there is none: a stay that
   *  paid nothing, or one whose penalty stands against the whole of what it
   *  paid. Absent rather than zero, so the message can leave the sentence out
   *  instead of promising a refund of nothing. */
  readonly refund: VndAmount | null;
}

/**
 * Why the stay ended, in words a guest can read.
 *
 * A total map rather than a lookup with a fallback, so a reason added to
 * `booking-state.ts` fails to compile here instead of reaching a mailbox as its
 * own enum member. Each line is written for the person the mail is addressed to:
 * the record's own vocabulary is for the property's screens.
 *
 * The two hold reasons are here for completeness of the type and not because
 * this message is sent for them — `booking.service.ts` announces a cancellation
 * only for a stay that had reached `CONFIRMED`, and a hold that ran out or was
 * swapped for another room type was never a stay the guest was told they had.
 */
const REASONS: Record<CancellationReason, string> = {
  HOLD_EXPIRED: "the room was not held long enough for the booking to complete",
  GUEST_REQUEST: "you asked us to cancel it",
  STAFF_ERROR: "we corrected a booking error at the property",
  PAYMENT_FAILED: "the payment for the stay was not completed",
  OVERBOOK_WALK: "the property could not honour the room that was booked",
  FORCE_MAJEURE: "of circumstances outside anyone's control",
  HOLD_REPLACED: "the room was changed before the booking completed",
};

/** A paragraph in the body voice of `guest-auth-emails.ts`. */
function paragraph(text: string): string {
  return `<p style="line-height:1.6;margin:0 0 24px">${escapeHtml(text)}</p>`;
}

/**
 * What the guest sees in their inbox list, from the one fact it is made of.
 *
 * Named separately for the reason the confirmation's subject is: a message can
 * need identifying before or without being composed — an alert about one that
 * could not be delivered still has to say which message it was.
 */
export function bookingCancellationSubject(reference: string): string {
  return `Booking ${reference} is cancelled — ${PROPERTY}`;
}

export function bookingCancellation(
  params: BookingCancellationEmailParams,
): OutgoingEmail {
  const heading = `Your stay is cancelled, ${params.guestName}`;
  const referenceLine = `Booking reference: ${params.reference}`;
  const intro = `Your booking with ${PROPERTY} has been cancelled because ${REASONS[params.reason]}.`;

  // Composed once and rendered into both bodies, so the text and the HTML
  // cannot disagree about what the guest was charged.
  const penaltyLine =
    params.penalty > 0n
      ? `Cancellation charge: ${formatVnd(params.penalty)}, under the rate plan's cancellation terms.`
      : "There is no cancellation charge for this booking.";

  const refundLine =
    params.refund === null
      ? null
      : `Refund: ${formatVnd(params.refund)}, returned to the card or account the payment came from.`;

  const closing =
    "If any of this is not what you expected, reply to this message with the reference above and the desk will look into it.";

  const text = [
    heading,
    "",
    intro,
    "",
    referenceLine,
    "",
    penaltyLine,
    ...(refundLine ? ["", refundLine] : []),
    "",
    closing,
    "",
  ].join("\n");

  const html = [
    '<div style="font-family:Georgia,serif;color:#1c1915;background:#f4efe6;padding:40px">',
    `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    paragraph(intro),
    paragraph(referenceLine),
    paragraph(penaltyLine),
    ...(refundLine ? [paragraph(refundLine)] : []),
    paragraph(closing),
    "</div>",
  ].join("");

  return {
    to: params.to,
    subject: bookingCancellationSubject(params.reference),
    text,
    html,
  };
}
