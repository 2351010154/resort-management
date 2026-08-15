// A resent account link waiting on the queue is the facts it is composed from,
// and never the message itself.
//
// The argument is `queued-confirmation.ts`'s, whole and unweakened: the account
// link exists nowhere else at rest. `booking_link` holds an opaque row id and a
// deadline, and the signature over that id is computed from a key HKDF derives
// at boot and is written down nowhere — so a composed body in the job table
// would be the only copy of a spendable credential in the database, readable
// from any backup, replica or ad-hoc query, and readable before the guest has
// opened the mail.
//
// It bites harder here than there, because of who caused the send. This message
// is mailed on a member of staff's say-so to a guest who has lost every other
// way in, and the credential in it creates the account that will own the stay.
// A row holding that body would be a second, unattended way to become the guest,
// sitting in a table the desk never looks at.
//
// So the same three moves as the confirmation: the row id travels, the landing
// address travels with its credential cut off, and the worker asks
// {@link LinkCredentials.signLink} for the text again at the moment it delivers.
// {@link keyless} and {@link addressed} are imported rather than rewritten —
// what a job row may contain is one decision, made in one file.

import {
  addressed,
  keyless,
  type KeylessLink,
  type LinkCredentials,
} from "./queued-confirmation.js";
import type { OutgoingEmail } from "./mailer.service.js";
import {
  accountLinkEmail,
  type AccountLinkEmailParams,
  accountLinkSubject,
} from "./templates/account-link-email.js";

/** What marks a job row as facts rather than a message. Renaming it orphans
 *  whatever is still queued under the old name at the moment of the deploy. */
export const QUEUED_ACCOUNT_LINK = "booking-account-link";

/** A resent account link as the job row holds it: everything but the signature. */
export interface QueuedAccountLink {
  readonly kind: typeof QUEUED_ACCOUNT_LINK;
  readonly to: string;
  readonly guestName: string;
  readonly reference: string;
  readonly account: KeylessLink;
}

/**
 * The facts a composed message reduces to, or a refusal.
 *
 * Throws rather than returning null, and the caller that catches it is
 * `MailQueue.enqueue`, which then delivers from its own process. That is the
 * right pair for the reason `queued-confirmation.ts` gives: this cannot fail for
 * anything a guest or a receptionist did, only for a link whose shape stopped
 * matching what {@link keyless} can take apart, and the answer to that is to
 * send the message now rather than to store a credential.
 *
 * Neither the address nor the credential appears in what is thrown.
 */
export function queuedAccountLink(
  mail: AccountLinkEmailParams,
  links: LinkCredentials,
): QueuedAccountLink {
  return {
    kind: QUEUED_ACCOUNT_LINK,
    to: mail.to,
    guestName: mail.guestName,
    reference: mail.reference,
    account: keyless(mail.createAccountUrl, links),
  };
}

/** The message those facts compose to, with the signature put back on. */
export function composeQueuedAccountLink(
  job: QueuedAccountLink,
  links: LinkCredentials,
): OutgoingEmail {
  return accountLinkEmail({
    to: job.to,
    guestName: job.guestName,
    reference: job.reference,
    createAccountUrl: addressed(job.account, links),
  });
}

/** Enough to say which message it was, without composing it. */
export function describeQueuedAccountLink(job: QueuedAccountLink): {
  to: string;
  subject: string;
} {
  return { to: job.to, subject: accountLinkSubject(job.reference) };
}

/**
 * The payload as facts, `null` when it is not this kind of job at all, and a
 * refusal when it says it is and then is not.
 *
 * What comes off the queue is JSON a previous build of this process wrote, so it
 * is checked rather than trusted — and a deploy that changed this shape must
 * fail loudly on the rows the old one left rather than mail a guest a message
 * with holes in it. Nothing of the payload is quoted in the refusal.
 */
export function readQueuedAccountLink(data: unknown): QueuedAccountLink | null {
  const fields = data as { readonly kind?: unknown } | null;

  if (fields?.kind !== QUEUED_ACCOUNT_LINK) {
    return null;
  }

  const job = data as Partial<QueuedAccountLink>;

  if (
    typeof job.to !== "string" ||
    typeof job.guestName !== "string" ||
    typeof job.reference !== "string"
  ) {
    throw new Error(
      "A queued account link is missing at least one of to, guestName or reference.",
    );
  }

  const account = job.account as Partial<KeylessLink> | null | undefined;

  if (typeof account?.url !== "string" || typeof account.linkId !== "string") {
    throw new Error(
      "A queued account link carries a link that is not an address and a row id.",
    );
  }

  return {
    kind: QUEUED_ACCOUNT_LINK,
    to: job.to,
    guestName: job.guestName,
    reference: job.reference,
    account: { url: account.url, linkId: account.linkId },
  };
}
