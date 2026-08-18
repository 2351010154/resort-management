// The emails the guest realm sends. Plain functions of their arguments —
// no service, no DI, no template engine — so they can be read in full and
// asserted against in a test without a running application.
//
// Both carry a text part as well as an HTML one. A verification link that only
// exists inside HTML is a link a text-only client cannot follow, and the guest
// who cannot follow it is the guest who cannot complete a booking.

import type { OutgoingEmail } from "../mailer.service.js";

export const PROPERTY = "Mariva";

/**
 * Where the property is, as a guest would write it on an envelope or read it to
 * a taxi driver.
 *
 * Here beside the name rather than in the one template that prints it, because
 * it is the same kind of fact and the two would otherwise be edited in different
 * files on the day the property moves. `property-and-tariff.md` §1 is the
 * authority — the whole of that section is the developer's call until there is a
 * building, and this line is no more settled than the rest of it.
 */
export const PROPERTY_ADDRESS = "12 Trần Phú, Lộc Thọ, Nha Trang, Khánh Hòa";

/**
 * When the property opens a room to an arriving guest —
 * `property-and-tariff.md` §2's operating clock.
 *
 * Printed in a mail and read by nothing: it is the published time the desk
 * honours, not a guard. Early arrival is `BOOKING_EARLY_CHECK_IN_ENABLED` and
 * the arrival window is a comparison of business dates, so no code path decides
 * anything by this string — which is exactly why it may be a constant here
 * rather than configuration.
 */
export const CHECK_IN_TIME = "14:00";

/** Minimal escaping for the two values these templates interpolate. Neither is
 *  attacker-free: a display name comes from a sign-up form.
 *
 *  Exported because every template in this directory needs exactly this, and a
 *  second copy is how one of them ends up a version behind the other. An
 *  escaper that differs between two files is an escaper nobody can audit. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function layout(heading: string, body: string, action: string, url: string): string {
  return [
    '<div style="font-family:Georgia,serif;color:#1c1915;background:#f4efe6;padding:40px">',
    `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    `<p style="line-height:1.6;margin:0 0 24px">${escapeHtml(body)}</p>`,
    `<p><a href="${escapeHtml(url)}" style="background:#3a332b;color:#f4efe6;padding:12px 24px;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-size:12px">${escapeHtml(action)}</a></p>`,
    `<p style="color:#645c51;font-size:12px;line-height:1.6;margin-top:24px">If the button does not work, paste this into your browser:<br>${escapeHtml(url)}</p>`,
    "</div>",
  ].join("");
}

export function verifyEmail(params: {
  readonly to: string;
  readonly name: string;
  readonly url: string;
}): OutgoingEmail {
  const heading = `Confirm your email, ${params.name}`;
  const body = `One step and your ${PROPERTY} account is ready. This link expires in an hour.`;

  return {
    to: params.to,
    subject: `Confirm your email — ${PROPERTY}`,
    text: `${heading}\n\n${body}\n\n${params.url}\n`,
    html: layout(heading, body, "Confirm email", params.url),
  };
}

export function resetPassword(params: {
  readonly to: string;
  readonly name: string;
  readonly url: string;
}): OutgoingEmail {
  const heading = "Reset your password";
  // Deliberately says nothing about whether an account exists — this template
  // is only reached when one does, but the wording is what a forwarded email
  // shows, and "your account" reads as confirmation to whoever received it.
  const body =
    "Use the link below to choose a new password. It expires in an hour. If you did not ask for this, nothing has changed and you can ignore this message.";

  return {
    to: params.to,
    subject: `Reset your password — ${PROPERTY}`,
    text: `${heading}\n\n${body}\n\n${params.url}\n`,
    html: layout(heading, body, "Choose a new password", params.url),
  };
}

/**
 * Sent to the address a guest wants to move to, not to the one they hold.
 *
 * The new address is the unproven half of the change — the old one is already
 * confirmed and is still the sign-in identifier while this link is unused. So
 * this message is the proof that the person asking can also read mail at the
 * destination, and it goes there.
 *
 * It names neither the account's current address nor whether the destination
 * already has an account of its own. A stranger who typed this address into
 * somebody else's session would otherwise be told, by the copy in the inbox of
 * the person they targeted, which account they had reached.
 */
export function confirmEmailChange(params: {
  readonly to: string;
  readonly name: string;
  readonly url: string;
}): OutgoingEmail {
  const heading = `Confirm this address, ${params.name}`;
  const body = `Someone asked to use this address for their ${PROPERTY} account. Confirm below and it becomes the address you sign in with. This link expires in an hour and works once. If this was not you, ignore this message — nothing changes until the link is used.`;

  return {
    to: params.to,
    subject: `Confirm your new email address — ${PROPERTY}`,
    text: `${heading}\n\n${body}\n\n${params.url}\n`,
    html: layout(heading, body, "Confirm this address", params.url),
  };
}
