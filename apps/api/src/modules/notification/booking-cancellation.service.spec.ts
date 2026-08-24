// The seam between the cancellation template and the queue.
//
// Two behaviours, and the second is the one worth a file. Nothing is added on the
// way past: the composed message reaches the queue exactly once, unaltered, with
// what §4 charged still on it. And a queue that refuses is swallowed — because the
// caller is `BookingService.cancel`, which has already released the stay's
// inventory by the time this is reached, so a rejection here would put a room
// back off the shelf because the property could not write to somebody about it.
//
// The whole message goes over rather than the facts it was made from, and that is
// asserted rather than assumed: the day this mail grows a link, queueing the body
// would put a credential in the job table, and `queued-confirmation.ts` argues
// exactly that. The assertion is the reminder.

import "reflect-metadata";

import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import { BookingCancellationService } from "./booking-cancellation.service.js";
import type { MailQueue } from "./mail-queue.service.js";
import {
  bookingCancellation,
  type BookingCancellationEmailParams,
} from "./templates/booking-cancellation-email.js";

const MAIL: BookingCancellationEmailParams = {
  to: "guest@example.test",
  guestName: "Trần Minh",
  reference: "MRV-2027-0042",
  reason: "GUEST_REQUEST",
  penalty: 1_850_000n,
};

/** Records what the service logs, so "it said nothing about the body" is a
 *  question this file can ask. */
function recordingLogger() {
  return { error: vi.fn() } as unknown as PinoLogger & {
    error: ReturnType<typeof vi.fn>;
  };
}

function queueing(
  enqueue: MailQueue["enqueue"],
  logger: PinoLogger = recordingLogger(),
) {
  return new BookingCancellationService({ enqueue } as MailQueue, logger);
}

describe("handing a cancellation over", () => {
  it("queues the message the template composed, and nothing else", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(bookingCancellation(MAIL));
  });

  it("hands over no second argument, so the whole message is what is stored", async () => {
    // `MailQueue.enqueue`'s second parameter is the reduction to facts, and it
    // exists because a confirmation's body is the only at-rest copy of two
    // credentials. This body has no link in it, so there is nothing to reduce —
    // and the day this mail grows one, the reduction has to arrive with it.
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    expect(enqueue.mock.calls[0]).toHaveLength(1);
  });

  it("carries the charge through to the message, and no promise of money back", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await queueing(enqueue).enqueue(MAIL);

    const sent = enqueue.mock.calls[0]![0];

    expect(sent.text).toContain("1.850.000");
    // Returning money is a staff act taken out of band, and nothing this
    // service can reach performs one. What goes on the queue may not say
    // otherwise.
    expect(sent.text).not.toMatch(/refund/i);
  });
});

describe("a queue that will not take it", () => {
  it("does not reject, because the cancellation has already happened", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("no queue"));

    await expect(queueing(enqueue).enqueue(MAIL)).resolves.toBeUndefined();
  });

  it("records the failure without putting the message in the log", async () => {
    const logger = recordingLogger();
    const enqueue = vi.fn().mockRejectedValue(new Error("no queue"));

    await queueing(enqueue, logger).enqueue(MAIL);

    expect(logger.error).toHaveBeenCalledTimes(1);

    const [context] = logger.error.mock.calls[0]!;

    expect(context).toMatchObject({ to: MAIL.to, reference: MAIL.reference });
    // What a guest was charged is not something a log needs a copy of.
    expect(JSON.stringify(context)).not.toContain("1850000");
    expect(JSON.stringify(context)).not.toContain("Cancellation charge");
  });
});
