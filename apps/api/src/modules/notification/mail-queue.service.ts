// Outbound mail, off the request that composed it.
//
// ## Why a queue and not an awaited send
//
// A sign-up that awaits the verification email answers in the time one HTTPS
// round trip to the mail vendor takes, and a sign-up for an address that is
// already registered sends nothing and answers immediately. The response body
// is generic either way — Better Auth makes sure of that — but the clock is
// not, and a difference measured in hundreds of milliseconds is an
// account-existence oracle readable from a single request. The fix is not to
// pad the fast branch to match the slow one; it is that neither branch
// delivers mail, so there is no difference left to measure.
//
// The second thing this buys is a retry. `MailerService` throws when the
// vendor refuses, and a caller who was awaiting it had exactly one attempt: a
// transient 503 lost a guest their verification link with nothing but a log
// line to show for it. pg-boss keeps the message and comes back to it.
//
// ## Why here rather than in `jobs/`
//
// `notification.module.ts` is where "how anything leaves this process on its
// way to a person" is decided, and this is that decision for the second time —
// the same message, delivered later. It also has to be reachable from the auth
// module, which must not import the sweep scheduler and the four domain
// modules behind it in order to send an email.
//
// pg-boss's own `send`/`work` are the primitives rather than `SweepJob`: a
// sweep is an idempotent question asked of the database on a cron, and an
// outbound email is neither scheduled nor idempotent nor a question.
//
// ## When there is no queue
//
// The scheduler is off under `NODE_ENV=test` and can be off in any process
// that is not running the sweeps, so `attach` may never be called. Delivery
// still leaves the request path — it is started and not awaited, and the
// shutdown hook waits for whatever is in flight — because a developer must be
// able to sign up locally without a queue, and because the timing property
// above has to hold in every process rather than only in the one that happens
// to run the workers. What that path does not have is the retry, which is why
// it is the fallback and not the design.
//
// ## What is on the queue
//
// For a verification or reset mail: the message, whole. The link in it carries
// Better Auth's own one-hour token, which is the same secret, in the same
// database, as the `guest_verification` row the link is checked against — so
// the queue is not a new place for it to live, though it is a reason the
// completed job is deleted in a day rather than kept for a week the way a
// sweep's is.
//
// For a booking confirmation: the facts, and not the message. That argument
// does not transfer, and `queued-confirmation.ts` sets out why — the signature
// over a mailed booking link exists nowhere in the database, so a composed body
// in the job table would be the only at-rest copy of a live stay credential.
// The worker signs the link's row id again when it delivers, which is why this
// file is handed the token service: the key stays in the process, and the job
// row holds an id that was already in `booking_link`.
//
// For the account link the desk resends: the facts again, and for the same
// reason with one more behind it — `queued-account-link.ts` sets it out. The
// two reductions share `keyless`, so what a job row may hold is one decision.
//
// No credential ever goes in a payload, either way. The vendor's API key is
// read from the environment by `MailerService`, in the process that delivers.

import {
  type BeforeApplicationShutdown,
  Injectable,
} from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import type { JobWithMetadata, PgBoss } from "pg-boss";
// A value import rather than a type-only one: Nest reads the constructor's
// parameter types out of the emitted decorator metadata, and a type-only import
// is erased before it gets there.
import { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import { MailerService, type OutgoingEmail } from "./mailer.service.js";
import { OpsAlertService } from "./ops-alert.service.js";
import {
  composeQueuedAccountLink,
  describeQueuedAccountLink,
  queuedAccountLink,
  readQueuedAccountLink,
} from "./queued-account-link.js";
import {
  composeQueuedConfirmation,
  describeQueuedConfirmation,
  queuedConfirmation,
  readQueuedConfirmation,
} from "./queued-confirmation.js";
import type { AccountLinkEmailParams } from "./templates/account-link-email.js";
import type { BookingConfirmationEmailParams } from "./templates/booking-confirmation-email.js";

/** The pg-boss queue outbound mail waits on. Renaming it orphans whatever is
 *  still queued under the old name at the moment of the deploy. */
export const MAIL_QUEUE = "outbound-email";

/** Stable slug for the page raised when a message is given up on. */
export const UNDELIVERABLE_MAIL_ALERT = "email-undeliverable";

// Four attempts in total. Enough to outlast a vendor's blip or a DNS wobble,
// and short enough that the last one still happens inside the hour a
// verification link is valid for — a fifth attempt tomorrow would deliver a
// link that is already dead.
const RETRY_LIMIT = 3;
const RETRY_DELAY_SECONDS = 5;
const RETRY_DELAY_MAX_SECONDS = 300;

// `MailerService` gives up on the vendor after ten seconds, so a job still
// active a minute later is a worker that died holding it. Failing it that
// quickly is safe because nothing has been sent.
const EXPIRE_IN_SECONDS = 60;

// A day, not the fortnight pg-boss keeps a job by default. Long enough to
// answer "what happened to that email" the next morning, short enough that the
// one-hour verification token an auth payload carries is long dead before the
// row is. A confirmation's payload carries no credential at all, so this is
// only a retention question for it and not a containment one.
const DELETE_AFTER_SECONDS = 24 * 60 * 60;

// A guest is watching an inbox, so this is the two-second default rather than
// the thirty seconds a sweep polls on. One query every two seconds against a
// pool sized for request traffic is not a cost worth trading a guest's wait for.
//
// With a batch of one it is also the throughput: thirty messages a minute from
// this process, and a burst above that drains rather than blocks. That is far
// more than a property this size sends, and it is the price of the batch size
// — which buys something worth more here, that a message nobody can deliver
// fails on its own.
const POLLING_INTERVAL_SECONDS = 2;

/** Enough of a message to say which one it was, without its body. */
interface MailDescription {
  readonly to: string | null;
  readonly subject: string | null;
}

@Injectable()
export class MailQueue implements BeforeApplicationShutdown {
  /** The running queue, or nothing when this process has none. */
  private boss: PgBoss | null = null;

  /** Sends started without a queue and not yet finished. */
  private readonly delivering = new Set<Promise<void>>();

  constructor(
    private readonly mailer: MailerService,
    private readonly opsAlerts: OpsAlertService,
    private readonly links: BookingTokenService,
    @InjectPinoLogger(MailQueue.name) private readonly logger: PinoLogger,
  ) {}

  /** Whether messages are being put on a queue rather than sent from here. */
  get queued(): boolean {
    return this.boss !== null;
  }

  /**
   * Declares the queue and starts a worker on it.
   *
   * Called by `JobScheduler` with the instance it started, so the mail worker
   * borrows the same pool and stops before it is closed, and so there is one
   * pg-boss in the process rather than two supervising each other's tables.
   */
  async attach(boss: PgBoss): Promise<void> {
    // Created once and then left alone — pg-boss inserts the queue row on
    // conflict-do-nothing, so these options describe the queue the first time
    // this name is seen and are ignored on every boot after. Changing one
    // later is `updateQueue`, deliberately.
    await boss.createQueue(MAIL_QUEUE, {
      // Every message is its own job. Not `singleton`, which is right for a
      // sweep and would here mean two guests signing up at once are one send.
      policy: "standard",
      retryLimit: RETRY_LIMIT,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
      retryDelayMax: RETRY_DELAY_MAX_SECONDS,
      expireInSeconds: EXPIRE_IN_SECONDS,
      deleteAfterSeconds: DELETE_AFTER_SECONDS,
    });

    // No explicit type argument: pg-boss reads `includeMetadata: true` off the
    // options literal to decide which handler shape it wants, and naming one
    // argument makes it fall back to defaults for the rest — the handler would
    // then be typed without the retry counters it is written around. The
    // payload is `unknown` here on purpose, and checked below.
    await boss.work(
      MAIL_QUEUE,
      {
        // One at a time, so a message that fails fails alone: a thrown handler
        // fails every job in its batch, and a batch here would be several
        // guests' links retried because one address was refused.
        batchSize: 1,
        // For `retryCount`, which is how the handler knows whether the attempt
        // it just lost was the last one.
        includeMetadata: true,
        pollingIntervalSeconds: POLLING_INTERVAL_SECONDS,
      },
      (jobs: JobWithMetadata<unknown>[]) => this.deliverBatch(jobs),
    );

    this.boss = boss;

    this.logger.info(
      { queue: MAIL_QUEUE, retryLimit: RETRY_LIMIT },
      "outbound mail is being delivered from the queue",
    );
  }

  /** Gives the queue back. Messages after this are sent from this process. */
  detach(): void {
    this.boss = null;
  }

  /**
   * Hands a message over for delivery, and returns without waiting for it.
   *
   * Never throws, and that is the point rather than tidiness: a caller that
   * could see this fail would answer differently depending on whether there
   * was a message to send, which is the oracle the queue exists to close. A
   * queue that cannot be written to falls back to delivering here.
   *
   * **A send whose acknowledgement is lost delivers the message twice.** If the
   * insert commits in Postgres and the connection then drops before this call
   * learns of it, the job is on the queue *and* the branch below delivers from
   * this process. There is no honest way to tell that apart from an insert that
   * never happened, and the two costs are not symmetric: the duplicate is a
   * guest reading the same confirmation twice, and the alternative — trusting a
   * failed call and staying quiet — is a guest who paid and heard nothing. The
   * only real cure is an outbox written inside the caller's own transaction,
   * which is a different design and a larger one than the fault it removes. The
   * window is left open, deliberately, and named here so it is not rediscovered
   * as a mystery.
   *
   * @param confirmation When present, what the job row holds *instead* of
   *   `email`: the facts it is composed from, reduced here rather than by the
   *   caller because what a job row may contain is this file's decision.
   *   `email` is still what a process with no queue delivers, and what the
   *   fallback below sends — neither writes anything down.
   */
  async enqueue(
    email: OutgoingEmail,
    confirmation?: BookingConfirmationEmailParams,
  ): Promise<void> {
    await this.hand(
      email,
      confirmation ? () => queuedConfirmation(confirmation, this.links) : null,
    );
  }

  /**
   * The same handover for the account link the desk resends. Never rejects.
   *
   * A method of its own rather than a second optional parameter, because what
   * differs is not the message but how it is reduced — and the two reductions
   * are two files with two payload markers, which is what lets the worker tell
   * a job row apart from a job row of the other kind. `queued-account-link.ts`
   * argues why this message may no more sit whole in a job row than a
   * confirmation may.
   */
  async enqueueAccountLink(
    email: OutgoingEmail,
    link: AccountLinkEmailParams,
  ): Promise<void> {
    await this.hand(email, () => queuedAccountLink(link, this.links));
  }

  /**
   * Hands one message over, reduced to facts when it carries a credential.
   *
   * The shared half of the two methods above, and the reason `reduce` is a
   * function rather than a value: the reduction happens inside the `try`, so a
   * message whose links stopped being reducible ends up delivered from this
   * process rather than stored whole. That is exactly what the catch does.
   */
  private async hand(
    email: OutgoingEmail,
    reduce: (() => object) | null,
  ): Promise<void> {
    const boss = this.boss;

    if (!boss) {
      this.deliverFromThisProcess(email);

      return;
    }

    try {
      await boss.send(MAIL_QUEUE, reduce ? { ...reduce() } : { ...email });
    } catch (error) {
      this.logger.error(
        { err: error, to: email.to, subject: email.subject },
        "the message could not be queued — delivering it from this process instead",
      );

      this.deliverFromThisProcess(email);
    }
  }

  /**
   * Waits for sends this process started itself.
   *
   * `beforeApplicationShutdown` for the reason `job-scheduler.service.ts`
   * gives: every hook of this kind runs before `DatabaseModule` ends the pool.
   * Nothing here uses the pool, but a message dropped because the process was
   * on its way out is a guest who never receives their link.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.delivering.size === 0) return;

    await Promise.allSettled([...this.delivering]);
  }

  /** Delivers the batch pg-boss handed over, one message at a time. */
  private async deliverBatch(
    jobs: readonly JobWithMetadata<unknown>[],
  ): Promise<void> {
    for (const job of jobs) {
      try {
        await this.mailer.send(this.messageIn(job.data));
      } catch (error) {
        // The last attempt is the one where no retry is left, and it is the
        // only one worth waking somebody for — paging on the first would page
        // for every blip the retry then absorbed.
        if (job.retryCount >= job.retryLimit) {
          await this.giveUp(this.describe(job.data), error, job.retryCount + 1);
        }

        // Rethrown so pg-boss owns what happens next: another attempt, or a
        // failed job that stays on the queue long enough to be read. It does
        // not stop the worker, which goes on polling for the next message.
        throw error;
      }
    }
  }

  /**
   * Sends without a queue behind it, off the caller's path.
   *
   * Deliberately not awaited by `enqueue`: what the caller must not be able to
   * measure is the send, and holding a reference in `delivering` is what stops
   * "not awaited here" becoming "abandoned at shutdown".
   */
  private deliverFromThisProcess(email: OutgoingEmail): void {
    const delivery = this.deliver(email).finally(() => {
      this.delivering.delete(delivery);
    });

    this.delivering.add(delivery);
  }

  /**
   * One attempt, and a promise that settles rather than rejects.
   *
   * **Nothing here may reject, and that is what the inner catch is for.** The
   * promise is held in a set and nothing awaits it until shutdown, so a
   * rejection has no handler for as long as the process runs — which under
   * Node's default is not a warning but an exit. `OpsAlertService.page` is
   * written never to throw; this makes the guarantee the caller's rather than
   * the collaborator's, because the process must not be taken down by the code
   * that reports a failed email.
   *
   * One attempt because there is no queue to hold a second, so the page is
   * raised on the first failure rather than the fourth.
   */
  private async deliver(email: OutgoingEmail): Promise<void> {
    try {
      await this.mailer.send(email);
    } catch (error) {
      try {
        await this.giveUp(this.describe(email), error, 1);
      } catch (alerting: unknown) {
        this.logger.error(
          { err: alerting, to: email.to, subject: email.subject },
          "an undelivered email could not be reported either",
        );
      }
    }
  }

  /**
   * The message a job row stands for — read, or composed from its facts.
   *
   * The three shapes are told apart by the markers `queued-confirmation.ts` and
   * `queued-account-link.ts` put on two of them, and a payload carrying none of
   * the three is a refusal rather than half a message.
   */
  private messageIn(data: unknown): OutgoingEmail {
    const confirmation = readQueuedConfirmation(data);

    if (confirmation) {
      return composeQueuedConfirmation(confirmation, this.links);
    }

    const accountLink = readQueuedAccountLink(data);

    return accountLink
      ? composeQueuedAccountLink(accountLink, this.links)
      : readOutgoingEmail(data);
  }

  /**
   * Enough to say which message a payload was, without composing it.
   *
   * Composing could itself be what failed — a confirmation whose facts no
   * longer parse — so the page that names the address has to be reachable from
   * the payload alone.
   */
  private describe(data: unknown): MailDescription {
    try {
      const confirmation = readQueuedConfirmation(data);

      if (confirmation) {
        return describeQueuedConfirmation(confirmation);
      }

      const accountLink = readQueuedAccountLink(data);

      if (accountLink) {
        return describeQueuedAccountLink(accountLink);
      }
    } catch {
      // A payload that says what it is and then does not parse. Its `to` is
      // still worth reporting, and the fields below are where it is.
    }

    const fields = data as Partial<Record<keyof OutgoingEmail, unknown>> | null;

    return { to: textOrNull(fields?.to), subject: textOrNull(fields?.subject) };
  }

  /** Records a message nobody is going to receive, and pages about it. */
  private async giveUp(
    mail: MailDescription,
    error: unknown,
    attempts: number,
  ): Promise<void> {
    // The body is left out here and below on purpose: it carries the
    // verification or reset link, and a log is the wrong place for a token
    // somebody could still use.
    this.logger.error(
      { err: error, to: mail.to, subject: mail.subject, attempts },
      "an email was not delivered and will not be attempted again",
    );

    // `OpsAlertService` never throws, which is what makes this safe to await
    // on the failure path of a worker and on the failure path of a send.
    await this.opsAlerts.page({
      kind: UNDELIVERABLE_MAIL_ALERT,
      text:
        `An email to ${mail.to ?? "an unrecorded address"} was not delivered ` +
        `after ${attempts} attempt(s) and has been given up on: ` +
        `"${mail.subject ?? "no subject"}".`,
      details: {
        to: mail.to,
        subject: mail.subject,
        attempts,
        queue: MAIL_QUEUE,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** The value if it is a string, and nothing if it is anything else. */
function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The payload as a message, or a refusal.
 *
 * What comes back off the queue is JSON that a previous build of this process
 * wrote, so it is checked rather than trusted: a deploy that changed the shape
 * must fail loudly on the messages the old one left behind instead of handing
 * `undefined` to the mail vendor. The message is not quoted in the error —
 * it carries a link somebody could still follow.
 */
function readOutgoingEmail(data: unknown): OutgoingEmail {
  const fields = data as Partial<Record<keyof OutgoingEmail, unknown>> | null;

  const to = textOrNull(fields?.to);
  const subject = textOrNull(fields?.subject);
  const text = textOrNull(fields?.text);
  const html = textOrNull(fields?.html);

  if (to === null || subject === null || text === null || html === null) {
    throw new Error(
      "A queued message is not one: it is missing at least one of to, subject, text or html.",
    );
  }

  return { to, subject, text, html };
}
