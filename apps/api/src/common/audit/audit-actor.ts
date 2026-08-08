// Who the current request is, reachable from a service that was never handed
// them.
//
// The problem this solves is arithmetic. Twenty-three routes in this
// application change state; two of them read `@CurrentPrincipal()` today, and
// both do it because the row they write has an actor column. Threading an actor
// argument down to every write that will be audited means changing every
// controller, every service signature between it and the write, and every test
// that constructs one — and the failure mode of forgetting is a write that
// still succeeds, still returns, and files nothing. `FR-AUD-01` asks for 100%
// coverage; a mechanism whose omission is silent will not reach it.
//
// So the actor is ambient rather than passed. `AsyncLocalStorage` carries it
// from the interceptor that reads the guard's decision down to whatever
// eventually writes, across every `await` in between, without any intermediate
// function naming it.
//
// **It is read from the guard's decision and never from the request body.**
// `guest.controller.ts` states the reason at the point it does the same thing
// by hand: an id a caller could state is an attribution a caller could choose,
// and an audit trail that records the name it was handed accuses whoever the
// writer typed. Nothing in this file accepts an actor from an argument that
// crossed the network.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The acting member of staff, as the guard resolved them.
 *
 * A `staff_user.id`, and never a guest's. `audit_entry.actor_id` references
 * `staff_user`, and every capability behind an audited write denies the guest
 * realm outright — so a guest principal has no row to name and is not narrowed
 * to one here. The day a guest-initiated write is audited, that column learns
 * about a second realm before this type does.
 */
export interface AuditActor {
  readonly staffUserId: string;
}

const storage = new AsyncLocalStorage<AuditActor>();

/**
 * Runs `work` with `actor` as the current one.
 *
 * Everything `work` starts inherits it, including continuations that resume
 * long after this call returned. Nothing outside it can see it, so two requests
 * in flight on one process cannot read each other's.
 */
export function withAuditActor<T>(actor: AuditActor, work: () => T): T {
  return storage.run(actor, work);
}

/** The current actor, or `undefined` outside a request that carries one. */
export function currentAuditActor(): AuditActor | undefined {
  return storage.getStore();
}
