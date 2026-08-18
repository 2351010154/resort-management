// The message that goes out the day before a guest arrives — the third of
// `FR-NTF-01`'s four transactional mails.
//
// A plain function of its arguments, for the reason `guest-auth-emails.ts`
// gives: no service, no DI, no template engine, so the whole body can be read
// here and asserted against without a running application.
//
// ## What it is for, and why each line is in it
//
// A guest who booked weeks ago has forgotten the room type they chose, has not
// looked up where the property is, and does not know the desk cannot hand over a
// room before 14:00. Each of those is a conversation at the counter that this
// message prevents. The identity document is the one that costs more than time:
// `FR-GST-02` has the desk read a document and transcribe it *before* the room is
// handed over — Nghị định 96/2016/NĐ-CP Điều 44 — so a guest who arrives without
// one cannot be checked in at all, and being told at the counter is being told
// too late.
//
// ## It carries no link, and no credential
//
// Like the cancellation beside it and unlike the confirmation, there is nothing
// signed in this body: the facts are the guest's own booking as the property
// holds it. That is what lets the whole message sit in a job row —
// `queued-confirmation.ts` sets out the argument that a composed body may not,
// when there is a credential in it.
//
// ## The date is formatted here, in one locale and one zone
//
// A reminder that says "2027-06-11" is a reminder written for a database. The
// zone is the property's, because the arrival is a `StayDate` — a calendar day at
// the property and never an instant — and formatting it against the server's zone
// is the off-by-one-night the whole `StayDate` type exists to keep uncompilable.

import { DateFormatter } from "@internationalized/date";
import { PROPERTY_TIME_ZONE, type StayDate } from "@mariva/shared";
import type { OutgoingEmail } from "../mailer.service.js";
import {
  CHECK_IN_TIME,
  escapeHtml,
  PROPERTY,
  PROPERTY_ADDRESS,
} from "./guest-auth-emails.js";

export interface PreArrivalReminderEmailParams {
  /** The booking's contact address. */
  readonly to: string;

  /** The booking's contact name. Hostile input, escaped where interpolated. */
  readonly guestName: string;

  /** The booking reference, as the desk will ask for it on arrival. */
  readonly reference: string;

  /** The arrival day, as the property counts days. */
  readonly arrival: StayDate;

  /** The room type's own name — "Junior Suite" — and not its code. The guest
   *  chose it by name and the mail has to be readable beside the funnel. */
  readonly roomType: string;
}

// A fixed locale, because the message is written in English and a date set in
// whatever the server's default happened to be would be the one line of it in
// another language. `en-GB` for day-before-month, which is how the rest of the
// world the property sells to reads a date.
const ARRIVAL_DATE = new DateFormatter("en-GB", {
  dateStyle: "full",
  timeZone: PROPERTY_TIME_ZONE,
});

/** A paragraph in the body voice of `guest-auth-emails.ts`. */
function paragraph(text: string): string {
  return `<p style="line-height:1.6;margin:0 0 24px">${escapeHtml(text)}</p>`;
}

/** What the guest sees in their inbox list. Named separately for the reason the
 *  confirmation's subject is: a message can need identifying without being
 *  composed. */
export function preArrivalReminderSubject(reference: string): string {
  return `Your stay at ${PROPERTY} is tomorrow — ${reference}`;
}

export function preArrivalReminder(
  params: PreArrivalReminderEmailParams,
): OutgoingEmail {
  const arrival = ARRIVAL_DATE.format(params.arrival.toDate(PROPERTY_TIME_ZONE));

  const heading = `See you tomorrow, ${params.guestName}`;
  const intro = `Your stay at ${PROPERTY} begins on ${arrival}. Check-in opens at ${CHECK_IN_TIME}.`;
  const details = `${params.roomType} · booking reference ${params.reference}`;
  const address = `We are at ${PROPERTY_ADDRESS}.`;
  const document =
    "Please bring the identity document you will check in with — a CCCD for Vietnamese guests, a passport otherwise. The desk has to read it and record the particulars before a room can be handed over, and we cannot complete check-in without it. Nothing is copied or kept: it is read at the counter and handed straight back.";

  const text = [
    heading,
    "",
    intro,
    "",
    details,
    "",
    address,
    "",
    document,
    "",
  ].join("\n");

  const html = [
    '<div style="font-family:Georgia,serif;color:#1c1915;background:#f4efe6;padding:40px">',
    `<h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    paragraph(intro),
    paragraph(details),
    paragraph(address),
    paragraph(document),
    "</div>",
  ].join("");

  return {
    to: params.to,
    subject: preArrivalReminderSubject(params.reference),
    text,
    html,
  };
}
