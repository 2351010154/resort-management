// The seam between the template and the two ways out.
//
// There is one behaviour to hold and it is that nothing is added: the composed
// message reaches the port it was sent to exactly once, unaltered. What differs
// between the two methods is what a failure means — `send` lets a refusal reach
// its caller, and `enqueue` must not, because its caller is a transaction
// confirming a booking somebody has already paid for. A service that quietly
// retried, or quietly resolved on failure, would pass a "it called the mailer"
// assertion and still lose a guest's confirmation without anyone hearing.

import "reflect-metadata";

import { HttpException } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import {
  BookingConfirmationService,
  type BookingConfirmationMail,
} from "./booking-confirmation.service.js";
import type { MailQueue } from "./mail-queue.service.js";
import type { MailerService } from "./mailer.service.js";
import { bookingConfirmation } from "./templates/booking-confirmation-email.js";

const MAIL: BookingConfirmationMail = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  stayUrl: "https://mariva.test/bookings/abc?t=stay-token",
};

/** Records what the service logs, so "it said nothing about the body" is a
 *  question this file can ask. */
function recordingLogger() {
  return { error: vi.fn() } as unknown as PinoLogger & {
    error: ReturnType<typeof vi.fn>;
  };
}

function confirmer(send: MailerService["send"]) {
  return new BookingConfirmationService(
    { send } as MailerService,
    undefined as unknown as MailQueue,
    recordingLogger(),
  );
}

function queueing(
  enqueue: MailQueue["enqueue"],
  logger: PinoLogger = recordingLogger(),
) {
  return new BookingConfirmationService(
    undefined as unknown as MailerService,
    { enqueue } as MailQueue,
    logger,
  );
}

describe("sending a confirmation", () => {
  it("hands the mailer the message the template composed, and nothing else", async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await confirmer(send).send(MAIL);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(bookingConfirmation(MAIL));
  });

  it("passes the create link through when the caller supplied one", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const withAccount = {
      ...MAIL,
      createAccountUrl: "https://mariva.test/account/create?t=create-token",
    };

    await confirmer(send).send(withAccount);

    // Asserted through the mailer rather than by re-reading the template: the
    // failure being guarded is a service that drops the optional field on its
    // way past, which a template-level test cannot see.
    const sent = send.mock.calls[0]![0];

    expect(sent.text).toContain(withAccount.createAccountUrl);
    expect(sent.html).toContain(withAccount.createAccountUrl);
  });

  it("lets a refusal reach the caller instead of swallowing or retrying it", async () => {
    const send = vi.fn().mockRejectedValue(new HttpException("Could not send the email", 502));

    await expect(confirmer(send).send(MAIL)).rejects.toBeInstanceOf(HttpException);

    // Once. The caller decides what a failed confirmation means — the guest has
    // already paid by the time this runs, so it is not this service's call.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("queueing a confirmation", () => {
  it("hands the queue the message the template composed, and the facts behind it", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    // Two things, one handover. The message is what a process with no queue
    // sends now; the facts are what a job row may hold instead, because the
    // links in the composed body are credentials that exist nowhere else at
    // rest. Which of the two is written down is `mail-queue.service.ts`'s
    // decision, not this service's — so both go over.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(bookingConfirmation(MAIL), MAIL);
  });

  it("resolves even when the queue refuses the message", async () => {
    const logger = recordingLogger();
    const enqueue = vi.fn().mockRejectedValue(new Error("no queue"));

    await expect(
      queueing(enqueue, logger).enqueue(MAIL),
      "A confirmation that could not be handed over must not reach the caller. " +
        "It is queued from inside the transaction confirming a booking the " +
        "guest has already paid for, so a rejection here rolls that booking back.",
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("keeps the message out of the log when it gives up on it", async () => {
    const logger = recordingLogger();
    const withCreateLink = {
      ...MAIL,
      createAccountUrl: "https://mariva.test/account/create?t=create-token",
    };

    await queueing(
      vi.fn().mockRejectedValue(new Error("no queue")),
      logger,
    ).enqueue(withCreateLink);

    const logged = JSON.stringify(logger.error.mock.calls[0]);

    // Both links are live credentials at the moment this runs. A log is read by
    // more people, for longer, than the mailbox the message was addressed to.
    expect(logged).not.toContain(withCreateLink.createAccountUrl);
    expect(logged).not.toContain(withCreateLink.stayUrl);
  });
});
