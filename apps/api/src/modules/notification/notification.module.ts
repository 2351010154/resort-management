import { Module } from "@nestjs/common";
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
@Module({
  providers: [MailerService, OpsAlertService],
  exports: [MailerService, OpsAlertService],
})
export class NotificationModule {}
