// The one message a guest who booked anonymously ever receives.
//
// A plain function of its arguments, for the reason `guest-auth-emails.ts`
// gives: no service, no DI, no template engine, so the whole body can be read
// here and asserted against without a running application. Text and HTML both,
// because a link that only exists inside HTML is a link a text-only client
// cannot follow.
//
// ## Why the account step branches *here* and nowhere else
//
// The mail carries two things: a link to the stay, always, and — only when the
// contact address has no account yet — a link that creates one. Whether the
// address is registered is decided by the caller and handed in; this file never
// looks it up.
//
// That branch is safe in an email and would not be safe on a page. The differing
// content is delivered to the address being asked about and to nobody else, so
// probing it means reading the victim's mailbox; the HTTP response that
// triggered the send reveals nothing either way. The stay page cannot make the
// same claim: a hold is unauthenticated and only rate-limited, so anyone can
// create a HELD booking naming a victim's address as contact, receive a booking
// cookie without paying, open the stay page and read off whether that address
// has an account. Same branch, one place it is a courtesy and another it is an
// enumeration oracle. It lives in the mail. The stay page stays neutral.
//
// The two links also have two lifetimes, which is why the create link says so in
// the body: the stay link lives to checkout plus a week, and the create link is
// good for an hour and one use. A guest who reads the mail late must be told why
// the second one no longer works rather than discovering it at a dead page.

import type { OutgoingEmail } from "../mailer.service.js";
import { escapeHtml, PROPERTY } from "./guest-auth-emails.js";

export interface BookingConfirmationEmailParams {
  /** The booking's contact address. */
  readonly to: string;

  /** The booking's contact name. Typed by an anonymous, unauthenticated caller
   *  at hold time — hostile input, escaped everywhere it is interpolated. */
  readonly guestName: string;

  /** The booking reference, as the guest will quote it at the desk. */
  readonly reference: string;

  /** Absolute, already signed by the caller. Opens the booking. */
  readonly stayUrl: string;

  /** Absolute, already signed by the caller, good for an hour and one use.
   *  Absent when the contact address already has an account — that absence is
   *  the whole branch. */
  readonly createAccountUrl?: string;
}

/** A paragraph in the body voice of `guest-auth-emails.ts`. */
function paragraph(text: string): string {
  return `<p style="line-height:1.6;margin:0 0 24px">${escapeHtml(text)}</p>`;
}

/** The dark button both mails use, plus the paste-it-yourself line under it that
 *  exists for clients which strip anchors. */
function action(label: string, url: string): string {
  return [
    `<p><a href="${escapeHtml(url)}" style="background:#3a332b;color:#f4efe6;padding:12px 24px;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-size:12px">${escapeHtml(label)}</a></p>`,
    `<p style="color:#645c51;font-size:12px;line-height:1.6;margin-top:24px">If the button does not work, paste this into your browser:<br>${escapeHtml(url)}</p>`,
  ].join("");
}

/**
 * What the guest sees in their inbox list, from the one fact it is made of.
 *
 * Named separately because a message can need identifying before it can be
 * composed: a confirmation held on the queue as its facts has a reference and
 * no body, and an alert about one that could not be delivered still has to say
 * which message it was.
 */
export function bookingConfirmationSubject(reference: string): string {
  return `Booking ${reference} is confirmed — ${PROPERTY}`;
}

export function bookingConfirmation(params: BookingConfirmationEmailParams): OutgoingEmail {
  const heading = `Your stay is confirmed, ${params.guestName}`;
  const referenceLine = `Booking reference: ${params.reference}`;
  const intro = `Thank you — your booking with ${PROPERTY} is paid and confirmed. Keep the reference below; the desk will ask for it on arrival.`;

  // The account half of the message, composed once and rendered into both
  // bodies, so the text and the HTML cannot disagree about which variant a
  // guest was sent.
  const accountText = params.createAccountUrl
    ? `Set a password and this stay — and every one after it — lives in one place. This link expires in 1 hour and works only once.`
    : `Sign in to add this stay to your account.`;

  const text = [
    heading,
    "",
    intro,
    "",
    referenceLine,
    "",
    "View your booking:",
    params.stayUrl,
    "",
    accountText,
    ...(params.createAccountUrl ? ["", params.createAccountUrl] : []),
    "",
  ].join("\n");

  const html = [
    '<div style="font-family:Georgia,serif;color:#1c1915;background:#f4efe6;padding:40px">',
    `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    paragraph(intro),
    paragraph(referenceLine),
    action("View your booking", params.stayUrl),
    paragraph(accountText),
    ...(params.createAccountUrl ? [action("Set a password", params.createAccountUrl)] : []),
    "</div>",
  ].join("");

  return {
    to: params.to,
    subject: bookingConfirmationSubject(params.reference),
    text,
    html,
  };
}
