// Where the acting member of staff enters the request —
// docs/architecture/repository-structure.md §apps/api names this file's home.
//
// Registered globally, so it runs on every route, including ones written months
// from now by someone who has not read this file. That is the same argument
// `access.guard.ts` makes for itself, and this runs immediately after it: the
// guard has by then resolved the caller into a `Principal` and left it on the
// request, and this lifts it into the ambient scope `audit-actor.ts` describes.
//
// **It does not write anything, and that is the design rather than an
// omission.** An interceptor sees a handler start and finish; it does not hold
// the handler's transaction. `TransactionRunner` is the only place a boundary is
// opened, and by the time `next.handle()` has produced a value that transaction
// has already committed. An audit row written here would therefore be an
// after-commit row, and after-commit is the wrong half of the trade:
//
//   - After commit, an emitter that throws — or a process that stops between
//     the commit and the emit — leaves a change that happened and a log that
//     does not mention it. A hole is worse than an absence, because the coverage
//     `NFR-09` asserts still passes over it and nothing reports the gap.
//   - In the transaction, an aborted edit takes its audit row with it. That is
//     the behaviour `transaction-runner.ts` already argues for in the other
//     direction — "a refusal on the third night must not leave the first two
//     consumed" — and `guest.service.ts` argues for in this one: a guest with no
//     CCCD is refused rather than audited, because a row claiming otherwise
//     would put readings that never happened into the trail an investigation is
//     counted from. A price that was refused must not appear as a price that was
//     set.
//
// So the write belongs where the executor is, which is the service — `AuditService`
// takes a `DbExecutor` like every other write in the tree, and the caller's
// transaction is the one it lands in. This interceptor's whole job is to make
// the actor reachable from there without twenty-three controllers passing it
// down by hand.

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import {
  ACCESS_DECISION,
  type RequestWithAccess,
} from "../auth/principal.js";
import { type AuditActor, withAuditActor } from "./audit-actor.js";

@Injectable()
export class AuditActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const actor = actorFor(context);

    // No actor is the ordinary case, not an error: the availability search, the
    // liveness probe and VNPay's IPN all reach handlers with no member of staff
    // behind them. A write that needs one refuses on its own — `AuditService`
    // says so in the sentence it throws — and refusing here instead would 500
    // every unauthenticated read in the application.
    if (!actor) {
      return next.handle();
    }

    // `next.handle()` is lazy: the handler body runs when the returned
    // observable is subscribed to, not when `handle()` is called. Wrapping only
    // the call would therefore establish the scope, return, and leave the scope
    // before the handler ever ran — the actor would be reachable from nowhere
    // and every audited write would refuse. Subscribing *inside* `run` is what
    // puts the handler and every continuation it awaits under the store.
    return new Observable((subscriber) =>
      withAuditActor(actor, () => next.handle().subscribe(subscriber)),
    );
  }
}

/**
 * The staff member the guard resolved, if the caller is one.
 *
 * Read from `AccessGuard`'s decision and from nowhere else. The guard is the
 * only thing that produces a `Principal` — `principal.ts` says so — and a
 * second reader of the raw request would be code that knows the difference
 * between a Better Auth session and a Passport payload, which is code that
 * breaks when a realm changes.
 */
function actorFor(context: ExecutionContext): AuditActor | undefined {
  if (context.getType() !== "http") {
    return undefined;
  }

  const request = context.switchToHttp().getRequest<RequestWithAccess>();
  const principal = request[ACCESS_DECISION]?.principal;

  return principal?.realm === "staff"
    ? { staffUserId: principal.userId }
    : undefined;
}
