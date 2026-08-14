// What makes a 500 findable.
//
// An unknown throw out of a handler leaves this process as
// `{"defined":false,"code":"INTERNAL_SERVER_ERROR","status":500,"message":"Internal server error"}`
// and nothing else — no message, no stack, no file. That body is correct and
// must stay exactly as it is, because the caller is a browser on the public
// internet and the detail behind a 500 is a description of the schema, the
// query or the credential that failed. The problem is not the body, it is that
// the detail was not written down *anywhere*. A missing column on
// `POST /bookings/holds` looked, from the outside and from the log, exactly
// like a bug in the booking rules.
//
// So the error is logged on the server and the response is left untouched.
//
// ## Where it is caught
//
// Not in a Nest exception filter, and that is measured rather than assumed.
// `@Implement` installs `ImplementInterceptor`, which builds an oRPC
// `StandardHandler` and calls `handle()`; that call catches everything the
// procedure throws, encodes it into a response and writes it to the socket
// itself. Nothing is rethrown, so neither a global Nest interceptor's
// `catchError` nor an exception filter is ever reached — the same boundary
// `health.controller.ts` documents from the other side when it explains why a
// `ServiceUnavailableException` there arrives as a 500.
//
// The place that does see the raw throw is oRPC's own client interceptor
// chain, which wraps the procedure call inside that handler. `ORPCModule` takes
// those in its `interceptors` option, so one `onError` there sees every error a
// handler raises, with its stack intact, before oRPC has rewritten it.
//
// Routes that are not oRPC — and the guards, pipes and middleware that run
// before an oRPC handler is reached — do throw into Nest, so
// `unknown-error.filter.ts` covers that half with the same predicate.
//
// ## Correlating it
//
// Nothing is passed by hand. nestjs-pino puts the request's child logger in an
// `AsyncLocalStorage` store, and that child carries the `req` binding pino-http
// gave it — including `req.id`, the id `app.module.ts` generates or reuses and
// echoes back as `x-request-id`. Logging through the injected `PinoLogger`
// inside the request's async context therefore lands on the same id the guest
// is quoting, which is the whole point of writing the line.

import { HttpException } from "@nestjs/common";
import { ORPCError, onError, type ORPCModuleConfig } from "@orpc/nest";
import type { PinoLogger } from "nestjs-pino";

/** One entry of what `ORPCModule` accepts, named so the factory below can state
 *  its return type. `onError`'s own generics infer from the callback, and a
 *  callback that returns nothing infers a result type the module rejects. */
type ClientInterceptor = NonNullable<ORPCModuleConfig["interceptors"]>[number];

/** The shared logger, narrowed to what is used — the shape `TransactionRunner`
 *  takes, so a test can pass a recorder rather than a pino instance. */
export type ErrorLogger = Pick<PinoLogger, "error">;

// Named on the line rather than set with `setContext`: the injected
// `PinoLogger` is the one instance the framework's own logger holds, and
// renaming it here would rename every line the application writes.
// `database.module.ts` makes the same argument for the same object.
const LOG_CONTEXT = "UnhandledError";

/**
 * Is this error a refusal the code chose, rather than a defect?
 *
 * The distinction is what keeps the error level meaning something. A guest
 * asking for a booking reference that does not exist, a hold that lost the race
 * for the last room, a receptionist reaching a MANAGER row — those are the
 * funnel working, they happen all day, and logging them as incidents would bury
 * the one line that is an incident.
 *
 * The rule is not "status < 500". Two of the deliberate refusals in this tree
 * are 5xx on purpose: `SERVICE_UNAVAILABLE` from the health probe when Postgres
 * is unreachable, and `BAD_GATEWAY` from the payment adapter when VNPay
 * answers with something that is not a signature. Both are already logged with
 * their own context by the code that raises them, and both would be logged
 * twice — and misattributed to this file — by a status test.
 *
 * The rule is instead about *who constructed the error*. Every `ORPCError` in
 * `src/modules/**` is written by hand at a refusal site, stating the code it
 * means: `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `UNAUTHORIZED`, `BAD_REQUEST`,
 * `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`, `BAD_GATEWAY`. None of them
 * writes `INTERNAL_SERVER_ERROR`, because "something broke" is not a decision a
 * handler makes — and oRPC's own wrapping of an unknown throw happens further
 * out, after this interceptor has already seen the original. So an `ORPCError`
 * arriving here was chosen, with one exception: oRPC itself raises
 * `ORPCError("INTERNAL_SERVER_ERROR")` when a handler's return value fails its
 * output schema. That is a bug in this codebase wearing an `ORPCError`'s
 * clothes, and it is exactly the kind of silent one this logging exists for.
 *
 * Nest's `HttpException` is judged by status because there the class is generic
 * — `UnauthorizedException` and `InternalServerErrorException` are the same
 * type — and everything a guard throws to refuse a caller is below 500.
 */
export function isDeliberateRefusal(error: unknown): boolean {
  if (error instanceof ORPCError) {
    return error.code !== "INTERNAL_SERVER_ERROR";
  }

  if (error instanceof HttpException) {
    return error.getStatus() < 500;
  }

  return false;
}

/**
 * Writes an unknown error to the server log, and nothing to the response.
 *
 * A deliberate refusal returns without a line. Anything else is logged at
 * `error` with the `err` serializer `app.module.ts` installs, which is what
 * puts the message and the stack in the output.
 */
export function logUnknownError(logger: ErrorLogger, error: unknown): void {
  if (isDeliberateRefusal(error)) {
    return;
  }

  logger.error(
    {
      // A throw is not required to be an `Error`, and a bare string thrown from
      // a dependency would otherwise serialize to nothing at all. Wrapping
      // keeps the message; the stack then points at this file, which is still
      // more than the alternative and is itself a clue about what threw.
      err: error instanceof Error ? error : new Error(String(error)),
      context: LOG_CONTEXT,
    },
    "request handler threw an error the client was told nothing about",
  );
}

/**
 * The oRPC client interceptor that does it — hand this to
 * `ORPCModule.forRoot({ interceptors: [...] })`.
 *
 * `onError` observes and rethrows; it cannot alter what the caller receives,
 * which is the property that makes this safe to install on every route in the
 * application at once.
 */
export function unknownErrorInterceptor(
  logger: ErrorLogger,
): ClientInterceptor {
  return onError((error: unknown) => {
    logUnknownError(logger, error);
  });
}
