// Transactional email. One method, two behaviours, chosen by configuration
// rather than by an environment check scattered through the callers.
//
// With `RESEND_API_KEY` set the message is sent through Resend. Without it the
// message is written to the log at info, complete with the link it carries, so
// a developer can finish a verification flow locally without a mail account and
// without a fake inbox to maintain. Production cannot take that path: env.ts
// refuses to boot without the key.
//
// Resend is reached with `fetch` rather than its SDK. The whole surface used
// here is one POST, and the SDK would be a dependency to keep current in
// exchange for an object literal.

import { HttpException, Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Long enough for a cold Resend connection, short enough that a sign-up does
// not hang on it. The caller is a user waiting on a form.
const SEND_TIMEOUT_MS = 10_000;

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

@Injectable()
export class MailerService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(MailerService.name) private readonly logger: PinoLogger,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    if (!this.env.RESEND_API_KEY) {
      this.logger.info(
        { to: email.to, subject: email.subject, body: email.text },
        "email not sent — RESEND_API_KEY is unset, logging it instead",
      );

      return;
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.env.MAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");

      // Logged with the recipient and thrown without it: the caller turns this
      // into a 500, and a response body that echoed the address would confirm
      // account existence to whoever triggered the send.
      this.logger.error(
        { to: email.to, status: response.status, detail },
        "Resend rejected the message",
      );

      throw new HttpException("Could not send the email", 502);
    }
  }
}
