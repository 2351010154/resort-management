// The transport boundary — repository-structure.md §`packages/`.
//
// Every call the web app makes to the API goes through here, and the reason it
// is a package rather than a `fetch` in a component is that the contract in
// `@mariva/shared` is what types it. A route whose output shape changes breaks
// the caller at compile time, in the same pull request that changed it, rather
// than at runtime in whichever of the two was deployed second.
//
// Nothing is hand-written per endpoint: the client below is derived from the
// contract, so an endpoint added in `@mariva/shared` is callable from here the
// moment it exists, with no entry to add and none to forget.

import { type Contract, contract } from "@mariva/shared";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

/** The API, as the contract describes it. `client.health()` and, as M3 lands
 *  them, the inventory and pricing calls beside it. */
export type ApiClient = ContractRouterClient<Contract>;

export interface ApiClientOptions {
  /** Where the API lives. No trailing slash; the contract carries the paths. */
  readonly url: string;

  /**
   * The staff bearer token, read per request rather than captured once.
   *
   * A function and not a string because a token is refreshed mid-session, and a
   * client holding the string it was constructed with would keep presenting an
   * expired one until the page reloaded. Guests need none of this — their
   * session is the cookie `credentials: "include"` sends.
   */
  readonly staffToken?: () => string | null | undefined;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const link = new OpenAPILink(contract, {
    url: options.url,

    // Both realms, and only ever one of them per request. The cookie rides on
    // every call because `credentials: "include"` is what makes a guest session
    // work cross-origin; the bearer header is added only when a staff token
    // exists, because `AccessGuard` treats a request carrying both as staff and
    // sending an empty one would make every guest call a malformed staff call.
    fetch: (request, init) =>
      globalThis.fetch(request, { ...init, credentials: "include" }),

    headers: () => {
      const token = options.staffToken?.();

      return token ? { authorization: `Bearer ${token}` } : {};
    },
  });

  return createORPCClient(link);
}
