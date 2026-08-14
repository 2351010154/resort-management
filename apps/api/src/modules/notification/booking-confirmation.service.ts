// Composing and handing over the confirmation mail, and nothing else.
//
// The template in `templates/booking-confirmation-email.ts` decides what the
// guest reads; `MailerService` decides how it leaves the process. What is left
// is the seam between them, and this file is deliberately only that seam — one
// method, one call — so the confirmation has a name a caller can inject and a
// place a second recipient or a second body could later be argued about.
//
// ## Two ways out, and the confirmation takes the second
//
// {@link BookingConfirmationService.send} posts the message and waits for the
// vendor. It has one caller left — a test — and it is kept because "the template
// reached the mailer unaltered" is the claim the seam exists to make.
//
// {@link BookingConfirmationService.enqueue} is what confirmation actually uses.
// The send fires on the payment gateway's callback, inside the transaction that
// is confirming a stay somebody has just paid for, and two things follow from
// that. A round trip to Resend there is a callback the gateway may time out and
// redeliver; and a refusal there would roll back a booking the money has already
// been taken for. `mail-queue.service.ts` answers both — it hands the message
// over, never throws, and delivers from a worker — so the confirmation is queued
// and the waiting happens somewhere the guest's stay does not depend on it.
//
// ## It is told, not asked
//
// Both URLs arrive absolute and already signed. This service mints no tokens,
// touches no crypto and reads no database — including the question its own body
// branches on, whether the contact address already has an account. That lookup
// belongs to the caller, which is already holding the booking row.

import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
// Value imports rather than type-only ones: Nest reads the constructor's
// parameter types out of the emitted decorator metadata, and a type-only import
// is erased before it gets there.
import { MailQueue } from "./mail-queue.service.js";
import { MailerService } from "./mailer.service.js";
import { bookingConfirmation } from "./templates/booking-confirmation-email.js";

/**
 * Everything the confirmation mail needs, as the caller already knows it.
 *
 * `createAccountUrl` being optional is the contract's only branch: present when
 * the contact address has no account yet, absent when it has one. The template
 * argues why that branch is safe in an email and would not be safe on a page.
 */
export interface BookingConfirmationMail {
  /** The booking's contact email. */
  readonly to: string;

  /** The booking's contact name. */
  readonly guestName: string;

  /** The booking reference. */
  readonly reference: string;

  /** Absolute URL, already signed by the caller. */
  readonly stayUrl: string;

  /** Absolute URL, already signed by the caller, short-lived and single-use.
   *  Absent when the address already has an account. */
  readonly createAccountUrl?: string;
}

@Injectable()
export class BookingConfirmationService {
  constructor(
    private readonly mailer: MailerService,
    private readonly queue: MailQueue,
    @InjectPinoLogger(BookingConfirmationService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Composes the confirmation and hands it to the mailer, waiting for it.
   *
   * Rejects with whatever the mailer rejects with — a 502 when Resend refuses
   * the message. Not the path confirmation takes; {@link enqueue} is, and the
   * note at the top of this file says why.
   */
  async send(mail: BookingConfirmationMail): Promise<void> {
    await this.mailer.send(bookingConfirmation(mail));
  }

  /**
   * Composes the confirmation and puts it on the queue. Never rejects.
   *
   * **Never rejects, and that is a promise this method makes rather than one it
   * inherits.** `MailQueue.enqueue` already swallows a queue it cannot write to
   * and delivers from this process instead, so the catch below is for what is
   * left: the day that contract changes, or the queue is unavailable in a way
   * nobody anticipated. The alternative is a guest who paid and whose booking
   * was rolled back because the property could not send them an email about it.
   *
   * Nothing of the message is logged but its recipient. The body carries a live
   * link into the stay and a link that creates an account, and a log is read by
   * more people, for longer, than the mailbox it was addressed to.
   *
   * **The message and the facts it was made from are both handed over**, and
   * they are not the same handover. The message is what a process with no queue
   * sends now; the facts are what a job row may hold, because the two
   * credentials in the composed body exist nowhere else at rest and a queue is
   * storage. `queued-confirmation.ts` argues it, and `MailQueue` decides
   * between them — which of the two is written down is a property of the
   * queue, not of the message.
   */
  async enqueue(mail: BookingConfirmationMail): Promise<void> {
    try {
      await this.queue.enqueue(bookingConfirmation(mail), mail);
    } catch (error) {
      this.logger.error(
        { err: error, to: mail.to, reference: mail.reference },
        "the confirmation for a paid booking could not be handed over for delivery",
      );
    }
  }
}
