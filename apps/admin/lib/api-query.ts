/* The contract, as query options.
 *
 * `createTanstackQueryUtils` mirrors the client's shape one-for-one, so every
 * procedure in `@mariva/shared` arrives here with `queryOptions`,
 * `mutationOptions` and a cache key already typed from the contract. Nothing is
 * written per endpoint, which is the same property `packages/api-client` has
 * and for the same reason: a route added tomorrow is usable from a screen the
 * moment it exists, with no entry to add here and none to forget.
 *
 * It is built over the client from `lib/api.ts`, so every read and every write
 * a screen makes through this carries the operator's session and its refresh.
 *
 * ## What a screen author writes
 *
 * A hook per question, in the feature that asks it — not a call inside a
 * component. `features/housekeeping/board-queries.ts` is the worked example of
 * everything below.
 *
 * ```ts
 * export function useOperationalSearch(criteria: SearchCriteria) {
 *   return useQuery(
 *     orpc.search.operational.queryOptions({
 *       input: criteria,
 *       meta: {
 *         errorMessage: "The search could not be run.",
 *       } satisfies ConsoleMeta,
 *     }),
 *   );
 * }
 * ```
 *
 * `input` is checked against the contract's own schema, and so is what comes
 * back — a field renamed in `@mariva/shared` breaks the screen in the pull
 * request that renamed it. `meta.errorMessage` is the sentence the operator
 * reads when the API itself said nothing usable; the toast is raised centrally
 * by `lib/query-client.ts`, so no hook needs an `onError` merely to report a
 * failure.
 *
 * ## Keys, and what to invalidate
 *
 * `orpc.<path>.key()` is the partial key — everything under it. `.queryKey({ input })`
 * is the exact one. Invalidate the widest thing an act can have changed rather
 * than the narrowest thing it touched: a check-in changes the arrivals list, the
 * housekeeping board and the folio, and a screen that invalidated only its own
 * query would leave the other two showing a guest still waiting.
 */

import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { api } from "./api";

export const orpc = createTanstackQueryUtils(api);
