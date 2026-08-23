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

import { type Contract, contract, reviveWireMoney } from "@mariva/shared";
import { createORPCClient } from "@orpc/client";
import {
  type ContractRouterClient,
  getContractRouter,
  isContractProcedure,
} from "@orpc/contract";
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

  return decodeWireMoney(createORPCClient<ApiClient>(link));
}

/**
 * The same client, with every answer read back through the contract.
 *
 * **Why the transport and not the screens.** The link's JSON serialiser writes
 * a `bigint` out as decimal text and has no matching hook to read one back —
 * `StandardOpenAPICustomJsonSerializer` carries `condition` and `serialize` and
 * nothing else — so an amount arrives as `"1850000"` wearing the `bigint` type
 * the contract inferred. Nothing in TypeScript can see that, which is why the
 * defect surfaces as a `TypeError` in a folio balance, a concatenation in a cash
 * drawer, and a variance that is never zero. Fixing it once here is the only
 * arrangement where a screen written tomorrow is right without its author having
 * heard of the problem.
 *
 * A proxy over the generated client, for the reason the client is generated at
 * all: there is no per-endpoint entry to add, so a route that lands in the
 * contract is decoded the moment it is callable. The proxy records the path it
 * was walked down, awaits the real call, and hands the result to
 * {@link reviveWireMoney} together with that procedure's declared output schema.
 * A path that is not a procedure, or a procedure that declares no output, is
 * returned untouched.
 */
function decodeWireMoney(client: ApiClient): ApiClient {
  return decodeAt(client, []) as ApiClient;
}

function decodeAt(node: unknown, path: readonly string[]): unknown {
  if (
    typeof node !== "function" &&
    (typeof node !== "object" || node === null)
  ) {
    return node;
  }

  // The target is a function so the `apply` trap is reachable: an oRPC client's
  // branches are callable as well as indexable, and a plain object target would
  // make `client.folio.read(...)` a TypeError.
  const shell = async (...args: unknown[]) => {
    const answer = await (node as (...a: unknown[]) => Promise<unknown>)(
      ...args,
    );

    return reviveWireMoney(outputSchemaAt(path), answer);
  };

  return new Proxy(shell, {
    get: (_shell, key) => {
      // `then` is answered as absent so the proxy is not mistaken for a
      // thenable. The oRPC client answers every string key with a callable, so
      // anything that awaited this object would otherwise call a procedure
      // named `then` and never settle. No contract procedure is called `then`;
      // if one ever is, this is the line that has to change.
      if (typeof key === "symbol" || key === "then") {
        return undefined;
      }

      return decodeAt((node as Record<string, unknown>)[key], [...path, key]);
    },
  });
}

/** What the contract says the procedure at this path returns, or nothing. */
function outputSchemaAt(path: readonly string[]): unknown {
  if (path.length === 0) {
    return undefined;
  }

  const procedure = getContractRouter(contract, path);

  return isContractProcedure(procedure)
    ? procedure["~orpc"].outputSchema
    : undefined;
}
