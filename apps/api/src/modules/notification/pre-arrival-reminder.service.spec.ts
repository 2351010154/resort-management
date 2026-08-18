// The seam between the reminder template and the queue.
//
// The behaviour that matters is the refusal that is swallowed. This service's
// caller is a sweep that has already marked every booking it is about to write
// to — the mark is inside the transaction and the messages are handed over after
// it commits, because the mark is what stops the next tick sending again. So a
// rejection reaching the sweep would either fail a run whose marks are already
// durable or, worse, take the marks with it and mail the rest of the night's
// arrivals twice.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import type { MailQueue } from "./mail-queue.service.js";
import { PreArrivalReminderService } from "./pre-arrival-reminder.service.js";
import {
  preArrivalReminder,
  type PreArrivalReminderEmailParams,
} from "./templates/pre-arrival-reminder-email.js";

const MAIL: PreArrivalReminderEmailParams = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  arrival: parseDate("2027-06-11"),
  roomType: "Junior Suite",
};

function recordingLogger() {
  return { error: vi.fn() } as unknown as PinoLogger & {
    error: ReturnType<typeof vi.fn>;
  };
}

function queueing(
  enqueue: MailQueue["enqueue"],
  logger: PinoLogger = recordingLogger(),
) {
  return new PreArrivalReminderService({ enqueue } as MailQueue, logger);
}

describe("handing a reminder over", () => {
  it("queues the message the template composed, and nothing else", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(preArrivalReminder(MAIL));
  });

  it("hands over no second argument, so the whole message is what is stored", async () => {
    // No link in this body either, so nothing to reduce to facts — see the
    // cancellation's spec, which makes the same assertion for the same reason.
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    expect(enqueue.mock.calls[0]).toHaveLength(1);
  });
});

describe("a queue that will not take it", () => {
  it("does not reject, because the booking is already marked as reminded", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("no queue"));

    await expect(queueing(enqueue).enqueue(MAIL)).resolves.toBeUndefined();
  });

  it("records which guest was not reached", async () => {
    const logger = recordingLogger();
    const enqueue = vi.fn().mockRejectedValue(new Error("no queue"));

    await queueing(enqueue, logger).enqueue(MAIL);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toMatchObject({
      to: MAIL.to,
      reference: MAIL.reference,
    });
  });
});
