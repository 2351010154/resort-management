// What the queue is for, asserted as four properties.
//
// - Handing a message over is not sending it. This is the account-enumeration
//   fix: if `enqueue` could deliver on the caller's stack, a request with mail
//   to send would take longer than one without, and that difference is readable
//   from a single response.
// - A message that fails is tried again. `MailerService` throws and has no
//   retry of its own, so the only thing standing between a vendor's blip and a
//   guest who never receives their verification link is pg-boss being told.
// - A message given up on wakes somebody, and does not take the worker with it.
// - Without a queue — a developer's machine, a test process — mail still goes,
//   and still not on the caller's stack.
//
// pg-boss itself is a stand-in here rather than a live queue. What is under
// test is the handler and what `enqueue` does with it, and the real
// installation is exercised where it belongs, in `job-infrastructure.e2e-spec.ts`.

import "reflect-metadata";

import type { PinoLogger } from "nestjs-pino";
import type { JobWithMetadata, PgBoss, Queue, WorkOptions } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env.js";
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import {
  MAIL_QUEUE,
  MailQueue,
  UNDELIVERABLE_MAIL_ALERT,
} from "./mail-queue.service.js";
import type { MailerService, OutgoingEmail } from "./mailer.service.js";
import type { OpsAlertService } from "./ops-alert.service.js";
import { QUEUED_CONFIRMATION } from "./queued-confirmation.js";
import {
  bookingConfirmation,
  type BookingConfirmationEmailParams,
} from "./templates/booking-confirmation-email.js";

const A_MESSAGE: OutgoingEmail = {
  to: "khach@example.test",
  subject: "Confirm your email — Mariva",
  text: "Confirm your email\n\nhttps://mariva.test/verify?token=secret-token\n",
  html: '<a href="https://mariva.test/verify?token=secret-token">Confirm</a>',
};

const SECRET = "a-secret-at-least-thirty-two-characters-long";

/** The real thing, because what is under test is that a stored row id signs
 *  back into the exact address the guest was going to be sent. A stand-in that
 *  agreed with itself would prove nothing about that. */
const links = new BookingTokenService({
  BETTER_AUTH_SECRET: SECRET,
  NODE_ENV: "test",
} as Env);

/** A `booking_link` row id, as `mintLink` returns one. */
const STAY_LINK_ROW = "6b1f2c94-0d3a-4f57-9c21-8ac0e5f7b912";
const ACCOUNT_LINK_ROW = "0e4a77d2-51bb-4c8e-9f30-2d6c1a9e4471";

/** The confirmation as `booking.service.ts` composes it: two absolute
 *  addresses, each carrying its credential in the fragment. */
function aConfirmation(): BookingConfirmationEmailParams {
  return {
    to: "khach@example.test",
    guestName: "Nguyễn An",
    reference: "MRV-20270510-0001",
    stayUrl: `https://mariva.test/bookings/MRV-20270510-0001#stay=${encodeURIComponent(
      links.signLink(STAY_LINK_ROW),
    )}`,
    createAccountUrl: `https://mariva.test/bookings/MRV-20270510-0001/account#invitation=${encodeURIComponent(
      links.signLink(ACCOUNT_LINK_ROW),
    )}`,
  };
}

const logged: { detail: Record<string, unknown>; message: string }[] = [];

// A stand-in for the same reason the alerter's suite gives one: what is
// asserted is that the content survived, and this is where it survives.
const log = {
  info: () => {},
  error: (detail: Record<string, unknown>, message: string) => {
    logged.push({ detail, message });
  },
} as unknown as PinoLogger;

/** The handler pg-boss was given, and the options it was given with it. */
interface AttachedQueue {
  readonly boss: PgBoss;
  readonly created: Omit<Queue, "name">;
  readonly workOptions: WorkOptions;
  deliver(job: JobWithMetadata<unknown>): Promise<void>;
}

function build(
  mailer: { send: (email: OutgoingEmail) => Promise<void> },
  page: (alert: unknown) => Promise<unknown> = async () => true,
): {
  queue: MailQueue;
  pages: ReturnType<typeof vi.fn>;
} {
  const pages = vi.fn(page);

  return {
    queue: new MailQueue(
      mailer as MailerService,
      { page: pages } as unknown as OpsAlertService,
      links,
      log,
    ),
    pages,
  };
}

/** Attaches a stand-in pg-boss and keeps hold of what it was handed. */
async function attach(queue: MailQueue): Promise<AttachedQueue> {
  let created: Omit<Queue, "name"> = {};
  let workOptions: WorkOptions = {};
  let handler: (jobs: JobWithMetadata<unknown>[]) => Promise<void> = async () => {};

  const boss = {
    createQueue: vi.fn(async (_name: string, options: Omit<Queue, "name">) => {
      created = options;
    }),
    work: vi.fn(
      async (
        _name: string,
        options: WorkOptions,
        given: (jobs: JobWithMetadata<unknown>[]) => Promise<void>,
      ) => {
        workOptions = options;
        handler = given;

        return "worker-id";
      },
    ),
    send: vi.fn().mockResolvedValue("job-id"),
  } as unknown as PgBoss;

  await queue.attach(boss);

  return {
    boss,
    get created() {
      return created;
    },
    get workOptions() {
      return workOptions;
    },
    deliver: (job) => handler([job]),
  };
}

/** A job as pg-boss hands one over, on whichever attempt is asked for. */
function jobOf(
  data: unknown,
  attempt: { retryCount: number; retryLimit: number },
): JobWithMetadata<unknown> {
  return {
    id: "job-id",
    name: MAIL_QUEUE,
    data,
    ...attempt,
  } as JobWithMetadata<unknown>;
}

/** A promise this test resolves, so "did it wait?" is not a question of timing. */
function held(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

afterEach(() => {
  logged.length = 0;
});

describe("handing a message over", () => {
  it("puts it on the queue and sends nothing itself", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await queue.enqueue(A_MESSAGE);

    expect(attached.boss.send).toHaveBeenCalledWith(MAIL_QUEUE, {
      ...A_MESSAGE,
    });

    // The property the whole file exists for. A send on this stack is time the
    // caller spends, and time the caller spends is time an attacker measures.
    expect(
      send,
      "The message was delivered on the caller's own stack. A request that had " +
        "mail to send then takes measurably longer than one that did not, which " +
        "tells anyone with a stopwatch whether the address was already registered.",
    ).not.toHaveBeenCalled();
  });

  it("declares a queue that retries, backs off, and does not keep the link for a fortnight", async () => {
    const { queue } = build({ send: vi.fn() });
    const attached = await attach(queue);

    // The retry is the second half of the change: `MailerService` throws and
    // has no attempt of its own to give.
    expect(attached.created.retryLimit).toBeGreaterThanOrEqual(1);
    expect(attached.created.retryBackoff).toBe(true);
    expect(attached.created.policy).toBe("standard");

    // The payload carries a one-hour link, so the row does not outlive the
    // question it can still answer by more than a day.
    expect(attached.created.deleteAfterSeconds).toBe(24 * 60 * 60);

    // Without the metadata the handler cannot tell a retry from the last
    // attempt, and would either page four times or never.
    expect(attached.workOptions.includeMetadata).toBe(true);
    expect(attached.workOptions.batchSize).toBe(1);
  });

  it("falls back to delivering here when the queue refuses the insert, and still does not throw", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    vi.mocked(attached.boss.send).mockRejectedValueOnce(
      new Error("could not connect"),
    );

    // Thrown at the caller, this would be a 500 on exactly the branch that had
    // a message to send — the oracle again, in a different colour.
    await expect(queue.enqueue(A_MESSAGE)).resolves.toBeUndefined();
    await queue.beforeApplicationShutdown();

    expect(send).toHaveBeenCalledWith(A_MESSAGE);
    expect(logged).toHaveLength(1);
    expect(logged[0]!.detail).toMatchObject({ to: A_MESSAGE.to });
  });
});

describe("the worker", () => {
  it("delivers the message the queue gives it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await attached.deliver(
      jobOf({ ...A_MESSAGE }, { retryCount: 0, retryLimit: 3 }),
    );

    expect(send).toHaveBeenCalledWith(A_MESSAGE);
  });

  it("gives a failure back to pg-boss while attempts remain, and pages nobody yet", async () => {
    const send = vi.fn().mockRejectedValue(new Error("502 from the vendor"));
    const { queue, pages } = build({ send });
    const attached = await attach(queue);

    // Rejecting is how pg-boss is told to retry. Swallowing it here would mark
    // the job completed and lose the message.
    await expect(
      attached.deliver(jobOf({ ...A_MESSAGE }, { retryCount: 0, retryLimit: 3 })),
    ).rejects.toThrow("502 from the vendor");

    expect(
      pages,
      "A transient failure paged the on-call. Three retries later it would have " +
        "gone out, and a page for every blip is a page nobody reads.",
    ).not.toHaveBeenCalled();
  });

  it("pages when the last attempt fails, without the body it could not deliver", async () => {
    const send = vi.fn().mockRejectedValue(new Error("502 from the vendor"));
    const { queue, pages } = build({ send });
    const attached = await attach(queue);

    await expect(
      attached.deliver(jobOf({ ...A_MESSAGE }, { retryCount: 3, retryLimit: 3 })),
    ).rejects.toThrow("502 from the vendor");

    expect(pages).toHaveBeenCalledTimes(1);

    const alert = pages.mock.calls[0]![0];

    expect(alert.kind).toBe(UNDELIVERABLE_MAIL_ALERT);
    expect(alert.details).toMatchObject({
      to: A_MESSAGE.to,
      subject: A_MESSAGE.subject,
      attempts: 4,
    });

    // The link is still live for an hour. It does not belong in a page or in a
    // log, and neither carries it.
    const everythingSaid = JSON.stringify([alert, logged]);

    expect(everythingSaid).not.toContain("secret-token");
  });

  it("keeps working after a message it could not deliver", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("502 from the vendor"))
      .mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await expect(
      attached.deliver(jobOf({ ...A_MESSAGE }, { retryCount: 3, retryLimit: 3 })),
    ).rejects.toThrow();

    // The same handler, the next message. A worker that stopped at the first
    // undeliverable address would silently hold every message behind it.
    await attached.deliver(
      jobOf({ ...A_MESSAGE }, { retryCount: 0, retryLimit: 3 }),
    );

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refuses a payload that is not a whole message rather than sending half of one", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue, pages } = build({ send });
    const attached = await attach(queue);

    await expect(
      attached.deliver(
        jobOf({ to: A_MESSAGE.to, subject: "Confirm" }, { retryCount: 3, retryLimit: 3 }),
      ),
    ).rejects.toThrow(/queued message/i);

    expect(send).not.toHaveBeenCalled();

    // Still identified as far as it can be, so the page names the address that
    // did not get its mail even though the payload was unusable.
    expect(pages.mock.calls[0]![0].details).toMatchObject({
      to: A_MESSAGE.to,
      subject: "Confirm",
    });
  });
});

/**
 * The job row for a confirmation, and the credential that must not be in it.
 *
 * The stay link opens a paid booking for seven days past checkout and the
 * create link turns a mailbox into an account, and neither signature exists
 * anywhere else at rest — `booking_link` holds the row id and the deadline, and
 * nothing holds the text. So a composed body on the queue would be the only
 * copy of a live credential in the database, sitting there for a day before the
 * guest has opened the mail. What goes on instead is what the table already
 * has.
 */
describe("a confirmation waiting on the queue", () => {
  it("carries the row ids and neither signature", async () => {
    const mail = aConfirmation();
    const { queue } = build({ send: vi.fn() });
    const attached = await attach(queue);

    await queue.enqueue(bookingConfirmation(mail), mail);

    const payload = vi.mocked(attached.boss.send).mock.calls[0]![1];
    const stored = JSON.stringify(payload);

    for (const url of [mail.stayUrl, mail.createAccountUrl!]) {
      const credential = url.slice(url.indexOf("=") + 1);

      expect(
        stored,
        "The job row is the only place this credential exists at rest. " +
          "Anybody with a backup, a replica or a psql session can spend it " +
          "until the row is deleted a day later.",
      ).not.toContain(decodeURIComponent(credential));
      expect(stored).not.toContain(credential);
    }

    // What is there instead: the two row ids, which `booking_link` already
    // holds and which open nothing without the key.
    expect(stored).toContain(STAY_LINK_ROW);
    expect(stored).toContain(ACCOUNT_LINK_ROW);
    expect(payload).toMatchObject({ kind: QUEUED_CONFIRMATION });
  });

  it("is delivered whole, by a worker that signs the links again", async () => {
    const mail = aConfirmation();
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await queue.enqueue(bookingConfirmation(mail), mail);

    const payload = vi.mocked(attached.boss.send).mock.calls[0]![1];

    await attached.deliver(jobOf(payload, { retryCount: 0, retryLimit: 3 }));

    // Byte for byte the message the composing process would have sent. Storing
    // less than the whole body is only safe if the worker rebuilds all of it.
    expect(send).toHaveBeenCalledWith(bookingConfirmation(mail));
  });

  it("keeps the variant, so a guest with an account is not offered a second one", async () => {
    const mail = { ...aConfirmation(), createAccountUrl: undefined };
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await queue.enqueue(bookingConfirmation(mail), mail);

    const payload = vi.mocked(attached.boss.send).mock.calls[0]![1];

    await attached.deliver(jobOf(payload, { retryCount: 0, retryLimit: 3 }));

    const delivered = send.mock.calls[0]![0] as OutgoingEmail;

    expect(delivered).toEqual(bookingConfirmation(mail));
    expect(delivered.text).not.toContain("invitation=");
    expect(delivered.html).not.toContain("invitation=");
  });

  it("is delivered from this process rather than stored whole when its links cannot be reduced", async () => {
    // What a change to the landing address would look like from here: a URL
    // with no fragment parameter, so there is no credential to lift out of it.
    const mail = {
      ...aConfirmation(),
      stayUrl: "https://mariva.test/bookings/MRV-20270510-0001",
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    await expect(
      queue.enqueue(bookingConfirmation(mail), mail),
    ).resolves.toBeUndefined();
    await queue.beforeApplicationShutdown();

    expect(
      attached.boss.send,
      "The body went on the queue after all, which is the one outcome this is " +
        "written to prevent: a live stay credential at rest in the job table.",
    ).not.toHaveBeenCalled();

    // The guest still gets the message — the send happens here, and nothing is
    // written down anywhere.
    expect(send).toHaveBeenCalledWith(bookingConfirmation(mail));
  });

  it("names the address when it is given up on, and quotes no link", async () => {
    const mail = aConfirmation();
    const send = vi.fn().mockRejectedValue(new Error("502 from the vendor"));
    const { queue, pages } = build({ send });
    const attached = await attach(queue);

    await queue.enqueue(bookingConfirmation(mail), mail);

    const payload = vi.mocked(attached.boss.send).mock.calls[0]![1];

    await expect(
      attached.deliver(jobOf(payload, { retryCount: 3, retryLimit: 3 })),
    ).rejects.toThrow("502 from the vendor");

    expect(pages.mock.calls[0]![0].details).toMatchObject({
      to: mail.to,
      subject: bookingConfirmation(mail).subject,
      attempts: 4,
    });

    const everythingSaid = JSON.stringify([pages.mock.calls, logged]);

    expect(everythingSaid).not.toContain(links.signLink(STAY_LINK_ROW));
    expect(everythingSaid).not.toContain(links.signLink(ACCOUNT_LINK_ROW));
  });

  it("refuses a payload that says it is a confirmation and then is not", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue, pages } = build({ send });
    const attached = await attach(queue);

    await expect(
      attached.deliver(
        jobOf(
          {
            kind: QUEUED_CONFIRMATION,
            to: "khach@example.test",
            guestName: "Nguyễn An",
            reference: "MRV-20270510-0001",
            stay: { url: "https://mariva.test/bookings/x#stay=" },
          },
          { retryCount: 3, retryLimit: 3 },
        ),
      ),
    ).rejects.toThrow(/queued confirmation/i);

    expect(send).not.toHaveBeenCalled();

    // A deploy that changed the shape must still say whose mail it was.
    expect(pages.mock.calls[0]![0].details).toMatchObject({
      to: "khach@example.test",
    });
  });
});

describe("a process with no queue", () => {
  it("delivers the message anyway, and not on the caller's stack", async () => {
    const gate = held();
    const send = vi.fn().mockReturnValue(gate.promise);
    const { queue } = build({ send });

    expect(queue.queued).toBe(false);

    // `send` is called and never settles until this test says so. If `enqueue`
    // awaited delivery, this line would hang rather than fail — which is the
    // failure mode being ruled out.
    await queue.enqueue(A_MESSAGE);

    expect(send).toHaveBeenCalledWith(A_MESSAGE);

    const drained = queue.beforeApplicationShutdown();
    gate.release();

    // And shutdown waits for it: a message dropped because the process was on
    // its way out is a guest who never receives their link.
    await expect(drained).resolves.toBeUndefined();
  });

  it("pages on a failure it has no retry for", async () => {
    const send = vi.fn().mockRejectedValue(new Error("no such host"));
    const { queue, pages } = build({ send });

    await queue.enqueue(A_MESSAGE);
    await queue.beforeApplicationShutdown();

    expect(pages).toHaveBeenCalledTimes(1);
    expect(pages.mock.calls[0]![0].details).toMatchObject({
      to: A_MESSAGE.to,
      attempts: 1,
    });
  });

  it("survives an alerter that fails too, rather than leaving a rejection nobody holds", async () => {
    const send = vi.fn().mockRejectedValue(new Error("no such host"));
    const { queue } = build({ send }, async () => {
      throw new Error("the alerting webhook is down as well");
    });

    // Nothing awaits this send until shutdown, so a rejection escaping it has
    // no handler for as long as the process runs — which under Node's default
    // is an exit, not a warning. Reporting a failed email must not be able to
    // take the application down.
    await queue.enqueue(A_MESSAGE);
    await expect(queue.beforeApplicationShutdown()).resolves.toBeUndefined();

    expect(
      logged.map((line) => line.message),
      "The failure of the alerter went unhandled. It is reported here or it " +
        "is reported by Node, on its way out.",
    ).toContain("an undelivered email could not be reported either");
  });

  it("is what a queue that has been given back leaves behind", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { queue } = build({ send });
    const attached = await attach(queue);

    expect(queue.queued).toBe(true);

    queue.detach();
    await queue.enqueue(A_MESSAGE);
    await queue.beforeApplicationShutdown();

    // Shutting down is not a reason to lose the message that arrived during it.
    expect(attached.boss.send).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(A_MESSAGE);
  });
});
