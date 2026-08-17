/* The cache every screen in the console reads through.
 *
 * **Why the console caches and `apps/web` does not.** The guest site reaches the
 * same API through the same `@mariva/api-client` and deliberately puts nothing
 * in front of it: the funnel is linear — search, quote, hold, pay — each step
 * asks a question the previous answer does not contain, and a stale price is
 * the one thing that funnel must never show. The console is the opposite shape.
 * Eleven screens read overlapping facts, a check-in on Arrivals changes what
 * Housekeeping and Folios show, tables paginate and sort against the same
 * query, and a mutation should paint before the server answers. That is a cache
 * with invalidation, which is this file. The divergence is settled: do not
 * "unify" the two apps by putting TanStack Query into `apps/web` or by taking
 * it out of here.
 *
 * The client is a factory rather than a module singleton because Next renders
 * this app on a server as well as in a browser, and a module-level cache on the
 * server is one cache shared by every request that process handles — which is
 * one operator's arrivals list served to whoever rendered next. `providers.tsx`
 * calls this once per browser tab and once per server render.
 */

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiMessage, apiStatus } from "./api";

/**
 * What a screen attaches to a query or a mutation, and the only thing the
 * handlers below read from it.
 *
 * TanStack types `meta` as a free-form record, so this is the shape by
 * convention rather than by compiler — write `meta: { errorMessage: "…" } satisfies ConsoleMeta`
 * where it matters. {@link errorSentence} reads it defensively for the same
 * reason: a misspelled key falls back to the generic sentence instead of
 * putting an object where an operator expects words.
 */
export interface ConsoleMeta {
  /**
   * What to tell the operator when the call fails and the API said nothing
   * usable — "The arrivals list could not be loaded." Name the thing that
   * failed; the generic fallback cannot, because it does not know.
   */
  readonly errorMessage?: string;

  /**
   * Declared by a call that draws its own failure where the operator is
   * already looking, and the only thing that takes the central toast away.
   *
   * The toast below is a floor because a screen that forgets its `onError`
   * would otherwise fail silently, and that argument does not hold for a read
   * whose failure is a normal state of the property and is answered in place:
   * the check-in sequence asks for the account of a stay that has not checked
   * in, which correctly has none, and says so in a line beside the deposit. A
   * red toast over handling that is already correct puts an error in front of
   * the desk on every single check-in, which is how a property learns to read
   * past its own toasts. Narrow on purpose — a call that does not declare it
   * is reported, and a screen that stops drawing the failure has to come back
   * here and take this off.
   */
  readonly rendersFailureInline?: boolean;
}

function errorSentence(meta: unknown, fallback: string): string {
  const named = (meta as ConsoleMeta | undefined)?.errorMessage;

  return typeof named === "string" && named.trim() !== "" ? named : fallback;
}

/**
 * Whether the caller has taken the reporting of this failure on itself.
 *
 * Strictly `true`, and read defensively for {@link errorSentence}'s reason:
 * `meta` is a free-form record by convention, so a misspelled key or a value
 * that is merely truthy falls back to reporting the failure rather than to
 * swallowing it. Silence is the answer that has to be asked for exactly.
 */
function rendersFailureInline(meta: unknown): boolean {
  return (meta as ConsoleMeta | undefined)?.rendersFailureInline === true;
}

/**
 * How long an answer is trusted without asking again.
 *
 * Thirty seconds, and the number is the length of one desk interaction. Moving
 * from Arrivals to a booking and back inside a single check-in must not refetch
 * — that is a spinner in the middle of a conversation with a guest — while an
 * operator who returns to a screen after a minute of doing something else is
 * looking at a property that other people have been working on. Anything much
 * longer starts showing a room as dirty after housekeeping has released it.
 *
 * A screen with a stronger opinion overrides it: a rate calendar is edited by
 * one manager and can be trusted for longer, a payment's state after a redirect
 * is trusted for nothing at all.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

/** How many times a failed read is re-asked before the operator is told. */
const MAX_QUERY_RETRIES = 2;

/**
 * Whether asking again could plausibly produce a different answer.
 *
 * A 4xx is an answer: the input was wrong, the token was refused, the
 * capability is not granted, the row is gone, the state has moved on. Asking
 * three more times re-asks a settled question, delays the sentence the operator
 * needs by several seconds, and — on the routes that count attempts — looks
 * like someone hammering the door. A 5xx or a status of null (nothing answered
 * at all: a dropped wifi, an API mid-restart) is the case a retry exists for.
 *
 * 401 is included in the refusals rather than excepted, because the retry that
 * matters for an expired token already happened: `lib/api.ts` runs every call
 * through the session, which refreshes and re-sends once. A 401 that reaches
 * here has already survived a fresh token.
 */
export function isWorthRetrying(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }

  const status = apiStatus(error);

  return status === null || status >= 500;
}

const GENERIC_QUERY_FAILURE = "That could not be loaded.";
const GENERIC_MUTATION_FAILURE = "That could not be saved.";

/**
 * A cache for one browser tab, or for one server render.
 *
 * Failures are reported centrally rather than by each screen. A console
 * operator working a queue needs to be told the moment something did not
 * happen, and leaving that to per-call `onError` handlers means the one screen
 * that forgets fails silently — an arrivals list that quietly shows yesterday's
 * data is worse than one that says it could not load. A screen that wants to
 * render the failure inline still gets `error` from its own hook; the toast is
 * the floor, not the ceiling.
 *
 * The one way through that floor is {@link ConsoleMeta.rendersFailureInline},
 * declared on the call itself. It is not a default anything can drift into: a
 * call that says nothing about it is reported.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (rendersFailureInline(query.meta)) {
          return;
        }

        // Keyed by the query's hash so a screen polling a broken endpoint
        // replaces its own toast instead of stacking a column of identical
        // ones over the work.
        toast.error(
          apiMessage(error, errorSentence(query.meta, GENERIC_QUERY_FAILURE)),
          { id: `query:${query.queryHash}` },
        );
      },
    }),

    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        // Honoured on a write as well as on a read, because `ConsoleMeta` is
        // one channel: a field that worked in one cache and was quietly
        // ignored in the other would be a trap for whoever declared it next.
        if (rendersFailureInline(mutation.meta)) {
          return;
        }

        toast.error(
          apiMessage(
            error,
            errorSentence(mutation.meta, GENERIC_MUTATION_FAILURE),
          ),
          { id: `mutation:${mutation.mutationId}` },
        );
      },
    }),

    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: isWorthRetrying,
        // The console is left open on a desk all day beside other windows. A
        // tab returned to after lunch showing the state of the property at
        // 11:40 is the failure mode this prevents, and `staleTime` above keeps
        // it from firing on every alt-tab within a task.
        refetchOnWindowFocus: true,
      },

      mutations: {
        // Never automatically. A read is a question and a write is an act: the
        // API's writes are not all idempotent, and a "retry" of a payment or a
        // folio posting whose response was merely lost is a second one. Where a
        // retry is safe it is the operator pressing the button again, which is
        // a decision somebody made.
        retry: false,
      },
    },
  });
}
