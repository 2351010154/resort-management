// Composing and handing over the pre-arrival reminder, and nothing else.
//
// The third seam of this shape, and the same split each time: the template in
// `templates/pre-arrival-reminder-email.ts` decides what the guest reads,
// `MailQueue` decides how it leaves the process, and this is one method between
// them so the reminder has a name a caller can inject.
//
// **Queued, and here the queue buys something the other two mails only benefit
// from.** The caller is `pre-arrival-reminder-sweep.ts`, which mails every
// arrival of a day in one run inside one transaction. Awaiting the vendor per
// message would make a night's reminders a serial walk of HTTPS round trips
// holding a database transaction open; and a single refused address would throw
// inside the runner, roll the whole run back and un-mark every booking it had
// already written to — so the next tick would send the ones that did go out a
// second time. Handing each message over is what keeps one bad address from
// costing the property that.
//
// **The whole message goes on the queue.** Same argument as the cancellation
// beside it: there is no credential in this body, so a job row holding it holds
// nothing that is not already in the booking row it was composed from.
// `queued-confirmation.ts` is where the opposite case is argued.

import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
// A value import rather than a type-only one: Nest reads the constructor's
// parameter types out of the emitted decorator metadata, and a type-only import
// is erased before it gets there.
import { MailQueue } from "./mail-queue.service.js";
import {
  preArrivalReminder,
  type PreArrivalReminderEmailParams,
} from "./templates/pre-arrival-reminder-email.js";

@Injectable()
export class PreArrivalReminderService {
  constructor(
    private readonly queue: MailQueue,
    @InjectPinoLogger(PreArrivalReminderService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Composes one guest's reminder and puts it on the queue. Never rejects.
   *
   * The sweep has already marked the booking as reminded by the time this is
   * called — it marks inside its transaction and hands the messages over after
   * the commit, because the mark is what makes a second run send nothing. So a
   * throw here would be a reminder nobody receives and nothing that will try
   * again, which is worth a log line and is not worth failing a run over: the
   * alternative is a sweep that reports failure having already released its
   * marks, and mails the rest of the night's arrivals twice.
   */
  async enqueue(mail: PreArrivalReminderEmailParams): Promise<void> {
    try {
      await this.queue.enqueue(preArrivalReminder(mail));
    } catch (error) {
      this.logger.error(
        { err: error, to: mail.to, reference: mail.reference },
        "a pre-arrival reminder could not be handed over for delivery",
      );
    }
  }
}
