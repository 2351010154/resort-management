import { Module } from "@nestjs/common";
import { BookingTokenModule } from "../auth/booking-token/booking-token.module.js";
import { BookingConfirmationService } from "./booking-confirmation.service.js";
import { MailQueue } from "./mail-queue.service.js";
import { MailerService } from "./mailer.service.js";
import { OpsAlertService } from "./ops-alert.service.js";

// How anything leaves this process on its way to a person —
// docs/architecture/repository-structure.md §"Domain modules". A caller composes
// the message and hands it over, so the decision of *how* it is delivered is
// made once, here.
//
// Two audiences and therefore two services, and the split is the audience rather
// than the transport. `MailerService` writes to a guest or a member of staff
// about something they asked for and are waiting on. `OpsAlertService` wakes
// whoever is on call about something nobody asked for and everybody would rather
// were not true — which is why one of them throws when it cannot deliver and the
// other refuses to; each file argues its own half.
//
// `BookingConfirmationService` sits on the guest side of that split and is named
// rather than left to the caller to compose, because the message it sends is the
// only thing an anonymous guest receives after paying — so the booking module
// injects a confirmation, not a mailer and a template it has to remember to
// pair correctly.
//
// `MailQueue` is the mailer again with the waiting taken out of it: the caller
// hands over a message and the send happens somewhere else, so how long a
// request took stops depending on whether it had mail to send. It belongs to
// this module and not to `jobs/` for the reason at the top of its own file —
// the auth module has to reach it, and must not import the sweep scheduler to
// send an email. `JobScheduler` lends it the queue once one is running.
//
// `BookingTokenModule` is imported for one thing `MailQueue` does with it: sign
// a booking link's row id back into the address it belongs in, at the moment of
// delivery. That is why a confirmation can sit on the queue without its
// credentials sitting there too — `queued-confirmation.ts` sets the argument
// out. The module is the small standalone one for exactly this reason; nothing
// of the auth surface comes with it.
@Module({
  imports: [BookingTokenModule],
  providers: [
    MailerService,
    MailQueue,
    OpsAlertService,
    BookingConfirmationService,
  ],
  exports: [
    MailerService,
    MailQueue,
    OpsAlertService,
    BookingConfirmationService,
  ],
})
export class NotificationModule {}
