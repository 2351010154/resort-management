// Composing and handing over the account link the desk resends, and nothing
// else.
//
// The seam `booking-confirmation.service.ts` is, for the other booking message:
// `templates/account-link-email.ts` decides what the guest reads, `MailQueue`
// decides how it leaves the process, and this is one method between them so the
// message has a name a caller can inject.
//
// **Queued and never sent inline**, and the argument is not the confirmation's.
// That one is queued because it fires inside the transaction a payment callback
// is confirming a stay in. This one fires on a receptionist's request, so what
// it buys is different and no smaller: a retry when the vendor blips, and a
// refusal that cannot take down the request. A round trip to Resend on the
// desk's path would make a member of staff wait on a third party while a guest
// stands at the counter, and a rejection there would turn "the link is on its
// way" into a 502 for a link that was already minted.
//
// **It is told, not asked.** The URL arrives absolute and already signed, and
// the address arrives read off the booking. This service mints no tokens,
// touches no crypto and reads no database — above all it never decides who the
// message is addressed to, which is the whole safety property of the flow behind
// it.

import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
// A value import rather than a type-only one: Nest reads the constructor's
// parameter types out of the emitted decorator metadata, and a type-only import
// is erased before it gets there.
import { MailQueue } from "./mail-queue.service.js";
import {
  accountLinkEmail,
  type AccountLinkEmailParams,
} from "./templates/account-link-email.js";

@Injectable()
export class AccountLinkMailService {
  constructor(
    private readonly queue: MailQueue,
    @InjectPinoLogger(AccountLinkMailService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Composes the message and puts it on the queue. Never rejects.
   *
   * `MailQueue.enqueueAccountLink` already swallows a queue it cannot write to
   * and delivers from this process instead; the catch below is for the day that
   * contract changes. The alternative is a member of staff told the resend
   * failed for a link that exists — they would press it again, and the second
   * press mints a second link and invalidates nothing.
   *
   * Nothing of the message is logged but its recipient and the reference. The
   * body carries a link that creates the account which will own the stay, and a
   * log is read by more people, for longer, than the mailbox it was addressed
   * to.
   */
  async enqueue(mail: AccountLinkEmailParams): Promise<void> {
    try {
      await this.queue.enqueueAccountLink(accountLinkEmail(mail), mail);
    } catch (error) {
      this.logger.error(
        { err: error, to: mail.to, reference: mail.reference },
        "an account link the desk resent could not be handed over for delivery",
      );
    }
  }
}
