// The account link on its own, sent because somebody at the property was asked
// for it.
//
// A plain function of its arguments, for the reason `guest-auth-emails.ts`
// gives and `booking-confirmation-email.ts` repeats: no service, no DI, no
// template engine, so the whole body can be read here and asserted against
// without a running application. Text and HTML both, because a link that only
// exists inside HTML is a link a text-only client cannot follow.
//
// ## Why this is a second template rather than the confirmation resent
//
// The confirmation is a receipt. It carries the stay link, the reference and —
// in the branch that offers one — the account link, and every part of it says
// *your booking is paid for*. None of that is true of this message: nothing has
// been paid this minute, the stay link is not being reissued, and a guest who
// asked the desk for a way into their account does not need to be told a second
// time what their room cost. Reusing the confirmation would also mail a fresh
// seven-day stay credential to an address whose owner has just demonstrated
// that they cannot find the last one, which is a second live key in a mailbox
// for a request that asked for one.
//
// So this carries the account link and nothing else spendable. The reference is
// here because a guest needs to know which stay is being spoken about, and it is
// not a credential — it is eight characters printed on their own confirmation
// and quoted at the desk.
//
// ## Why it says the desk sent it
//
// An unexplained link to create an account is what a phishing message looks
// like. This one arrives without a payment behind it and often minutes after a
// telephone call, so the body names the occasion: somebody at the property was
// asked for it. A guest who was not on that call learns, from the message
// itself, that they should ring the property — which is the only way this flow's
// one weakness, a member of staff talked into sending it, is ever noticed.
//
// The hour and the single use are stated for `booking-confirmation-email.ts`'s
// reason: a guest who reads the mail late has to be told why it no longer works
// rather than discovering it at a dead page.

import type { OutgoingEmail } from "../mailer.service.js";
import { escapeHtml, PROPERTY } from "./guest-auth-emails.js";

export interface AccountLinkEmailParams {
  /** The booking's contact address. Read off the stay, never off a caller. */
  readonly to: string;

  /** The booking's contact name. Typed by an anonymous, unauthenticated caller
   *  at hold time — hostile input, escaped everywhere it is interpolated. */
  readonly guestName: string;

  /** The booking reference, as the guest will quote it at the desk. */
  readonly reference: string;

  /** Absolute, already signed by the caller, good for an hour and one use. The
   *  only thing in this message anybody can spend. */
  readonly createAccountUrl: string;
}

/** A paragraph in the body voice of `booking-confirmation-email.ts`. */
function paragraph(text: string): string {
  return `<p style="line-height:1.6;margin:0 0 24px">${escapeHtml(text)}</p>`;
}

/** The dark button both booking mails use, plus the paste-it-yourself line under
 *  it that exists for clients which strip anchors. */
function action(label: string, url: string): string {
  return [
    `<p><a href="${escapeHtml(url)}" style="background:#3a332b;color:#f4efe6;padding:12px 24px;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-size:12px">${escapeHtml(label)}</a></p>`,
    `<p style="color:#645c51;font-size:12px;line-height:1.6;margin-top:24px">If the button does not work, paste this into your browser:<br>${escapeHtml(url)}</p>`,
  ].join("");
}

/**
 * What the guest sees in their inbox list, from the one fact it is made of.
 *
 * Named separately for the reason `bookingConfirmationSubject` is: a message
 * held on the queue as its facts has a reference and no body, and an alert about
 * one that could not be delivered still has to say which message it was.
 */
export function accountLinkSubject(reference: string): string {
  return `Your account for booking ${reference} — ${PROPERTY}`;
}

export function accountLinkEmail(
  params: AccountLinkEmailParams,
): OutgoingEmail {
  const heading = `Set up your account, ${params.guestName}`;
  const referenceLine = `Booking reference: ${params.reference}`;
  const intro = `Somebody at ${PROPERTY} was asked to send you this, so that booking ${params.reference} can live in an account of your own. If you did not ask for it, please ring the property — and follow nothing in this message.`;
  const expiry = `This link expires in 1 hour and works only once. Ask the desk again if it has run out.`;

  const text = [
    heading,
    "",
    intro,
    "",
    referenceLine,
    "",
    "Set up your account:",
    params.createAccountUrl,
    "",
    expiry,
    "",
  ].join("\n");

  const html = [
    '<div style="font-family:Georgia,serif;color:#1c1915;background:#f4efe6;padding:40px">',
    `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    paragraph(intro),
    paragraph(referenceLine),
    action("Set up your account", params.createAccountUrl),
    paragraph(expiry),
    "</div>",
  ].join("");

  return {
    to: params.to,
    subject: accountLinkSubject(params.reference),
    text,
    html,
  };
}
