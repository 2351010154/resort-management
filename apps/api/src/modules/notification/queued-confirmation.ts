// A confirmation waiting on the queue is the facts it is composed from, and
// never the message itself.
//
// ## Why the body cannot sit in the job row
//
// The confirmation carries two signed credentials: a stay link good for seven
// days past checkout, which opens a booking to read, to cancel and to pay
// against, and a create link good for an hour, which turns a mailbox into an
// account. Neither exists anywhere else at rest. `booking_link` holds an opaque
// row id and the deadline; the signature over that id is computed from a key
// HKDF derives at boot and is written down nowhere. So a composed body in the
// job table would be the *only* copy of a spendable credential in the database
// — readable from any backup, replica or ad-hoc query for as long as the row is
// kept, and kept before the guest has even opened the mail.
//
// This is what separates the confirmation from the verification and reset mail
// beside it on the same queue. Those carry Better Auth's own token, which is
// already a row in `guest_verification` and is checked against it; queueing the
// body puts that secret in a second place in the same database rather than in a
// new one. The confirmation has no such row, so it gets this treatment instead.
//
// What is stored is what `booking_link` already stores — a row id — and the
// worker asks {@link LinkCredentials.signLink} for the text again at the moment
// it delivers. The key is in the process, not in the payload.
//
// ## Why the landing address travels rather than being rebuilt
//
// Which page a mailed link lands on, and which fragment parameter carries the
// credential, is the booking module's decision: it mints the link and it owns
// the route. A second copy of that shape here would be a second answer to one
// question, and the two would drift the day either moved. So what travels is
// the address with its credential cut off — everything up to and including the
// `=` it followed — which is the part this module cannot derive and the part
// that is not a secret. Rejoining the two is one concatenation, and
// {@link keyless} refuses to store anything it cannot prove rejoins to exactly
// the address the guest would otherwise have been sent.

import {
  bookingConfirmation,
  type BookingConfirmationEmailParams,
  bookingConfirmationSubject,
} from "./templates/booking-confirmation-email.js";
import type { OutgoingEmail } from "./mailer.service.js";

/**
 * The half of `BookingTokenService` this file needs: a signature it can take
 * off a link and put back on.
 *
 * Narrowed to two methods rather than taken whole, so that what the queue is
 * trusted with is legible — it re-signs an id it was given and reads an id off
 * a text it was given, and it mints, redeems and revokes nothing.
 */
export interface LinkCredentials {
  /** The `booking_link` row a signed text names, if this deployment signed it. */
  linkIdOf(presented: string | undefined): string | null;

  /** The signed text addressing a link row. Deterministic. */
  signLink(linkId: string): string;
}

/** What marks a job row as facts rather than a message. Renaming it orphans
 *  whatever is still queued under the old name at the moment of the deploy. */
export const QUEUED_CONFIRMATION = "booking-confirmation";

/** A landing address, and the row id whose signature completes it. */
export interface KeylessLink {
  /** The address up to and including the `=` its credential followed. */
  readonly url: string;

  /** The `booking_link` row. Opaque, and already at rest in that table. */
  readonly linkId: string;
}

/** A confirmation as the job row holds it: everything but the two signatures. */
export interface QueuedConfirmation {
  readonly kind: typeof QUEUED_CONFIRMATION;
  readonly to: string;
  readonly guestName: string;
  readonly reference: string;
  readonly stay: KeylessLink;

  /** The variant, and the only branch the message has: a link that offers an
   *  account when the address had none, and `null` when it had one. */
  readonly account: KeylessLink | null;
}

/**
 * The facts a composed confirmation reduces to, or a refusal.
 *
 * Throws rather than returning null, and the caller that catches it is
 * `MailQueue.enqueue`, which then delivers from its own process. That is the
 * right pair: this cannot fail for anything a guest did, only for a link whose
 * shape stopped matching what this file can take apart, and the answer to that
 * is to send the message now rather than to store a credential.
 *
 * Neither the address nor the credential appears in what is thrown. An error
 * quoting the URL it could not reduce would put the credential in a log, which
 * is the thing this file exists to prevent.
 */
export function queuedConfirmation(
  mail: BookingConfirmationEmailParams,
  links: LinkCredentials,
): QueuedConfirmation {
  return {
    kind: QUEUED_CONFIRMATION,
    to: mail.to,
    guestName: mail.guestName,
    reference: mail.reference,
    stay: keyless(mail.stayUrl, links),
    account: mail.createAccountUrl ? keyless(mail.createAccountUrl, links) : null,
  };
}

/** The message those facts compose to, with both signatures put back on. */
export function composeQueuedConfirmation(
  job: QueuedConfirmation,
  links: LinkCredentials,
): OutgoingEmail {
  return bookingConfirmation({
    to: job.to,
    guestName: job.guestName,
    reference: job.reference,
    stayUrl: addressed(job.stay, links),
    createAccountUrl: job.account ? addressed(job.account, links) : undefined,
  });
}

/** Enough to say which message it was, without composing it. */
export function describeQueuedConfirmation(job: QueuedConfirmation): {
  to: string;
  subject: string;
} {
  return { to: job.to, subject: bookingConfirmationSubject(job.reference) };
}

/**
 * The payload as facts, `null` when it is not this kind of job at all, and a
 * refusal when it says it is and then is not.
 *
 * What comes off the queue is JSON a previous build of this process wrote, so
 * it is checked rather than trusted — the same argument the message reader
 * makes, with one addition: a deploy that changed this shape must fail loudly
 * on the rows the old one left rather than compose a confirmation with holes in
 * it. Nothing of the payload is quoted in the refusal; the row ids are not
 * credentials, but the address they complete is one line away from being one.
 */
export function readQueuedConfirmation(
  data: unknown,
): QueuedConfirmation | null {
  const fields = data as { readonly kind?: unknown } | null;

  if (fields?.kind !== QUEUED_CONFIRMATION) {
    return null;
  }

  const job = data as Partial<QueuedConfirmation>;

  if (
    typeof job.to !== "string" ||
    typeof job.guestName !== "string" ||
    typeof job.reference !== "string"
  ) {
    throw new Error(
      "A queued confirmation is missing at least one of to, guestName or reference.",
    );
  }

  const offersAnAccount = job.account !== null && job.account !== undefined;
  const stay = keylessIn(job.stay);
  const account = offersAnAccount ? keylessIn(job.account) : null;

  if (!stay || (offersAnAccount && !account)) {
    throw new Error(
      "A queued confirmation carries a link that is not an address and a row id.",
    );
  }

  return {
    kind: QUEUED_CONFIRMATION,
    to: job.to,
    guestName: job.guestName,
    reference: job.reference,
    stay,
    account,
  };
}

/** The value if it is a link the worker can complete, and nothing if not. */
function keylessIn(value: unknown): KeylessLink | null {
  const link = value as Partial<KeylessLink> | null | undefined;

  if (typeof link?.url !== "string" || typeof link.linkId !== "string") {
    return null;
  }

  return { url: link.url, linkId: link.linkId };
}

/**
 * An address split from the credential it carries, proved by putting it back.
 *
 * The round trip is the whole check. It is not enough that a credential could
 * be read off the end: what has to be true is that this row id, signed again by
 * this key and appended to this prefix, is the very address the guest would
 * have been sent. Anything less and the queue would be holding a message that
 * delivers a link nobody can follow.
 *
 * Exported for `queued-account-link.ts`, which reduces a different message with
 * the same credential in it. Two copies of this would be two answers to the one
 * question this file exists to answer — what a job row may contain — and the
 * second copy is the one that would be written without the round trip.
 */
export function keyless(url: string, links: LinkCredentials): KeylessLink {
  const fragment = url.indexOf("#");
  const separator = fragment === -1 ? -1 : url.indexOf("=", fragment);

  if (separator === -1) {
    throw new Error(
      "A confirmation's link does not carry its credential in a fragment parameter, so the queue cannot hold the message without holding the credential too.",
    );
  }

  const linkId = links.linkIdOf(
    decodeURIComponent(url.slice(separator + 1)),
  );

  if (linkId === null) {
    throw new Error(
      "A confirmation's link was not signed by this deployment, so its row id is not something the worker could sign back into it.",
    );
  }

  const link = { url: url.slice(0, separator + 1), linkId };

  if (addressed(link, links) !== url) {
    throw new Error(
      "A confirmation's link cannot be recomposed from its row id, so storing the row id would queue a message the guest could not follow.",
    );
  }

  return link;
}

/** The address with its signature back on it. */
export function addressed(link: KeylessLink, links: LinkCredentials): string {
  return link.url + encodeURIComponent(links.signLink(link.linkId));
}
