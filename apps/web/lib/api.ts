// The API, as this app reaches it.
//
// `packages/api-client` is the transport boundary and this is the one place the
// browser's instance of it is built — `repository-structure.md` §`packages/`
// says why the boundary exists at all: the client is derived from the contract
// in `@mariva/shared`, so a route whose shape changes breaks this app at compile
// time rather than at runtime in whichever side was deployed second.
//
// **One client, built once.** A module constant rather than a hook or a
// provider: it holds no session and nothing per-render — the guest's session is
// an httpOnly cookie the API set on its own origin, and `credentials: "include"`
// inside the package is what sends it. A provider would put a value in every
// route's tree to hand back something that never varies.
//
// **No staff token is passed, and that is the realm rather than an omission.**
// This is the guest site; `apps/admin` is where a bearer token exists at all.
// The package treats a request carrying both credentials as staff, so a token
// function here that returned anything would turn every guest call into a
// malformed staff one.
//
// The url is `NEXT_PUBLIC_API_URL` because this call is made from the browser,
// and it is one half of a pair: the API's own `WEB_ORIGIN` has to name this app
// back, or the cookie the session rides on is refused by CORS and a signed-in
// guest reads as a stranger. `apps/web/.env.example` states the pair.

import { type ApiClient, createApiClient } from "@mariva/api-client";

/**
 * Where the API answers, as the browser sees it.
 *
 * The same default the auth screens carry, and the same reason: a developer who
 * has copied no `.env` at all still gets the API this repository's own dev
 * script starts. Read at module scope because `NEXT_PUBLIC_` values are
 * substituted at build time — there is nothing to re-read per call.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const api: ApiClient = createApiClient({ url: API_URL });

/**
 * What a call to the API failed with, in a sentence a guest can read.
 *
 * oRPC raises an error carrying the `message` the handler wrote, and those are
 * written for the person who will see them — `payment.service.ts`'s refusals say
 * what to do about the money, and `booking.service.ts`'s say which stay is being
 * talked about. So the handler's sentence is preferred over anything invented
 * here, and the fallback is only for what never reached a handler: a network
 * that was not there, a CORS pair that does not agree, an API that is not up.
 *
 * Deliberately not a status code. A guest reading "409" learns nothing, and the
 * screens that call this have somewhere better to put the distinction — the
 * caller catches the error and decides, and this only turns whatever it caught
 * into words.
 */
export function apiMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }

  return fallback;
}
