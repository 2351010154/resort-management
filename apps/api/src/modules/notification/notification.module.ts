import { Module } from "@nestjs/common";
import { MailerService } from "./mailer.service.js";

// Transactional email and its templates — docs/architecture/repository-structure.md
// §"Domain modules". Only the mailer is exported: a caller composes a message
// from the templates and hands it over, so the decision of *how* mail leaves
// the process is made once, here.
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class NotificationModule {}
