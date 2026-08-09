// Waking somebody up. One method, two behaviours, chosen by configuration
// rather than by an environment check scattered through the callers —
// `mailer.service.ts` is the same shape for the same reason, and this is the
// other half of "how does the property hear about something".
//
// With `OPS_ALERT_WEBHOOK_URL` set the page is POSTed there. Without it, it is
// written to the log at `warn`, whole, so a developer sees exactly what would
// have been dispatched without an endpoint to point at.
//
// ## Why a URL and not a vendor
//
// `FR-PAY-05` says a discrepancy "pages a phone" and names no product. What
// actually rings at 03:00 is an operations decision with its own escalation
// policy, its own quiet hours and its own idea of who is on call this week —
// none of which belong in this tree. A URL keeps all of it on the property's
// side of the line: no client library to keep current, no credential beyond the
// endpoint itself, and a change of tooling is a change of environment variable.
//
// The body below is a plain JSON object and is documented as a contract because
// receivers disagree about shape. `text` is a finished human sentence, which is
// what a Slack-style incoming webhook renders as-is and what a generic collector
// shows in a list; the structured fields beside it are what a rule can branch
// on. PagerDuty's Events API wants its own envelope with a routing key in it, so
// a property paging through PagerDuty puts a transform in front — that is a
// configuration step and it is deliberately not smuggled in here as a second
// vendor-shaped code path.
//
// ## It does not throw, and that is the whole point
//
// An alerter that throws is an alerter that can take down the thing it was
// watching. `ReconciliationJob` calls this from inside `JobRunner`'s
// transaction: a thrown page would roll the run back, and the run's rollback
// would destroy the `payment_discrepancy` rows — the durable record of the
// disagreement — in order to protect the notification about them. That trade is
// backwards. The rows are what a screen reads and what a manager acts on
// tomorrow morning; the page is how they hear about it sooner.
//
// So a send that fails logs the page at `error`, in full, and returns. The
// content always lands somewhere durable, which is the guarantee worth making.
// What it does not do is retry: `job-scheduler.service.ts` sets `RETRY_LIMIT` to
// zero on the reasoning that "the next tick is the retry", and for a nightly
// sweep the next tick is a day away over a different business date — so a page
// that failed is not re-attempted by re-running the night either, because the
// discrepancy rows already exist by then and a re-run reports none as new. The
// error log is the backstop, and it carries everything the page carried.

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";

// Short. Nothing is waiting on this — it is called from a background sweep — but
// a receiver that has stopped answering must not hold the runner's transaction,
// and its locks, open while it does so.
const PAGE_TIMEOUT_MS = 5_000;

/**
 * One thing somebody needs to know about now.
 *
 * `details` is deliberately an open record rather than a union of the things
 * that can page. The alerter's job is delivery; what is worth saying about a
 * payment discrepancy belongs to whoever found one, and a type here would have
 * to grow a member every time something else earns the right to wake a person.
 */
export interface OpsAlert {
  /** A finished sentence a human reads first. */
  readonly text: string;

  /** Stable slug for what kind of thing this is, for a receiver's routing. */
  readonly kind: string;

  /** Whatever a responder needs in order to act without opening a console. */
  readonly details: Readonly<Record<string, string | number | null>>;
}

@Injectable()
export class OpsAlertService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(OpsAlertService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Sends the page, or records that it could not be sent. Never throws.
   *
   * The return value says which happened, for a caller that wants to count
   * them — not for one that wants to branch on it and retry, which is the thing
   * the top of this file argues against.
   */
  async page(alert: OpsAlert): Promise<boolean> {
    const endpoint = this.env.OPS_ALERT_WEBHOOK_URL;

    if (!endpoint) {
      this.logger.warn(
        { kind: alert.kind, ...alert.details },
        `no OPS_ALERT_WEBHOOK_URL — logging the page instead: ${alert.text}`,
      );

      return false;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: alert.text,
          kind: alert.kind,
          ...alert.details,
        }),
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        // The body is read for the log and not surfaced anywhere else. A
        // receiver that refuses a page usually says why, and that sentence is
        // the whole diagnosis.
        const detail = await response.text().catch(() => "");

        this.logger.error(
          {
            kind: alert.kind,
            status: response.status,
            detail,
            ...alert.details,
          },
          `the on-call endpoint refused the page, so it was not delivered: ${alert.text}`,
        );

        return false;
      }

      return true;
    } catch (error) {
      // A timeout, a DNS failure, a refused connection. Caught for the reason at
      // the top of this file: the caller is inside a transaction holding rows
      // that matter more than this request did.
      this.logger.error(
        { err: error, kind: alert.kind, ...alert.details },
        `the on-call endpoint could not be reached, so the page was not delivered: ${alert.text}`,
      );

      return false;
    }
  }
}
