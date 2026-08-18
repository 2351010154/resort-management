// Composing and handing over the cancellation mail, and nothing else.
//
// The seam `booking-confirmation.service.ts` is, for the message that closes a
// stay instead of opening one: `templates/booking-cancellation-email.ts` decides
// what the guest reads, `MailQueue` decides how it leaves the process, and this
// is one method between them so the cancellation has a name a caller can inject.
//
// **Queued, never sent inline, and the argument is the confirmation's.** The
// send happens inside `BookingService.cancel`, which is reached from three
// places: a receptionist's request, a guest cancelling their own stay, and the
// hold-expiry sweep. A round trip to Resend on any of them is a caller waiting on
// a third party, and a refusal on any of them would roll back a cancellation that
// has already released the property's inventory — the room back off the shelf
// because the property could not send an email about it.
//
// **The whole message goes on the queue, and this is the mail that may.**
// `queued-confirmation.ts` refuses to store a composed confirmation because its
// body is the only at-rest copy of two spendable credentials. There is no such
// thing here: a cancelled stay has no page worth opening and no account step to
// offer, so this body carries no link at all. What a job row holds is a name, a
// reference and two amounts the property has already decided — the same class of
// fact as the row the mail was composed from.
//
// **It is told, not asked.** The penalty and the refund arrive as amounts. §4's
// grid is `cancellation-calculator.ts`'s, the waiver that sets it aside is a
// column on the booking, and the money is the folio's; a service that worked any
// of them out here would be a second answer to a figure the guest has already
// been quoted.

import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
// A value import rather than a type-only one: Nest reads the constructor's
// parameter types out of the emitted decorator metadata, and a type-only import
// is erased before it gets there.
import { MailQueue } from "./mail-queue.service.js";
import {
  bookingCancellation,
  type BookingCancellationEmailParams,
} from "./templates/booking-cancellation-email.js";

@Injectable()
export class BookingCancellationService {
  constructor(
    private readonly queue: MailQueue,
    @InjectPinoLogger(BookingCancellationService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Composes the cancellation and puts it on the queue. Never rejects.
   *
   * **Never rejects, and that is a promise this method makes rather than one it
   * inherits.** `MailQueue.enqueue` already swallows a queue it cannot write to
   * and delivers from this process instead, so the catch below is for the day
   * that contract changes. The alternative is a cancellation that failed —
   * either a guest who pressed cancel and was told the stay is still live, or a
   * sweep that gave up a night's expired holds — because the property could not
   * write to somebody about it.
   *
   * Nothing of the message is logged but its recipient and the reference. The
   * body says what a guest was charged and what is coming back to them, and a
   * log is read by more people, for longer, than the mailbox it was addressed
   * to.
   */
  async enqueue(mail: BookingCancellationEmailParams): Promise<void> {
    try {
      await this.queue.enqueue(bookingCancellation(mail));
    } catch (error) {
      this.logger.error(
        { err: error, to: mail.to, reference: mail.reference },
        "the cancellation for a stay could not be handed over for delivery",
      );
    }
  }
}
