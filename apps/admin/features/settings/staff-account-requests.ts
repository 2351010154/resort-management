/* The two staff-account calls, as plain requests.
 *
 * A bare `fetch` rather than `@mariva/api-client`, and — like
 * `lib/auth/staff-auth-requests.ts` — that is not a shortcut. `GET` and `POST
 * /identity/staff-accounts` are a plain Nest controller: there is no `identity`
 * module in `packages/shared/src/contract/`, so the generated client has no
 * procedure to call and `lib/api-query.ts` has no `queryOptions` to offer. The
 * routes exist, they are the only ones that answer `FR-IDN-02`, and this is the
 * thinnest thing that reaches them.
 *
 * It is inside `features/settings/` rather than in `lib/` because this screen is
 * their only caller. If a second screen ever needs staff accounts, or if the
 * routes join the contract, this file is what disappears.
 *
 * **Three things are borrowed rather than reinvented, so the console keeps one
 * error channel.** The failure carries a `status`, which is what `lib/api.ts`
 * reads to decide whether asking again could produce a different answer; its
 * `message` is what `apiMessage` prefers over anything a screen invents; and
 * every call is wrapped by the caller in `withStaffSession`, so a token inside
 * its expiry margin is replaced before the request leaves and a 401 is retried
 * exactly once behind a fresh one. Nothing here raises a toast: the caches in
 * `lib/query-client.ts` do that for every read and every write in the console.
 *
 * There is no `credentials: "include"` on either call, and that is the
 * difference from the staff-auth requests beside them: those set and clear the
 * httpOnly refresh cookie, while these are ordinary bearer-token routes.
 */

import { staffSession } from "@/lib/auth";

import {
  type NewStaffAccount,
  type StaffAccount,
  staffAccountFrom,
  staffAccountsFrom,
} from "./settings-form";

// The same variable the contract client, the staff-auth requests and `apps/web`
// read. One name for the API's location, so a deployment configures it once.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** `@Controller("identity/staff-accounts")` — both routes are this one path. */
const STAFF_ACCOUNTS_PATH = "/identity/staff-accounts";

/**
 * Why a staff-account call did not answer with an account.
 *
 * `status` is the HTTP status when the API answered and null when it did not,
 * which is exactly the distinction `isWorthRetrying` in `lib/query-client.ts`
 * draws: a 4xx is a settled answer and asking again re-asks it, while nothing
 * at all is the case a retry exists for. Shaped so that `apiStatus` and
 * `apiMessage` read it structurally, without either of them knowing this class.
 */
export class StaffAccountError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "StaffAccountError";
  }
}

/** Every staff account the property has, as the administrator's list. */
export async function requestStaffAccounts(): Promise<readonly StaffAccount[]> {
  const answered = await send("GET");
  const accounts = staffAccountsFrom(answered);

  if (accounts === null) {
    throw new StaffAccountError(
      null,
      "The API answered with something other than a list of staff accounts.",
    );
  }

  return accounts;
}

/**
 * Creates one account, with exactly the one role it was given.
 *
 * The body is `createStaffAccountSchema`'s four fields and no more. The password
 * travels once, on this call, and is never in a response — the API's own `view()`
 * is built by naming the fields it answers with rather than by deleting the hash
 * from the row.
 */
export async function requestNewStaffAccount(
  account: NewStaffAccount,
): Promise<StaffAccount> {
  const created = staffAccountFrom(await send("POST", account));

  if (created === null) {
    throw new StaffAccountError(
      null,
      "The account may have been created, but the API answered with something other than an account. Reload the list before trying again.",
    );
  }

  return created;
}

async function send(
  method: "GET" | "POST",
  body?: NewStaffAccount,
): Promise<unknown> {
  const token = staffSession.token();
  let response: Response;

  try {
    response = await fetch(`${API_URL}${STAFF_ACCOUNTS_PATH}`, {
      method,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StaffAccountError(null, "The API could not be reached.");
  }

  if (!response.ok) {
    throw new StaffAccountError(response.status, await refusalFrom(response));
  }

  try {
    return await response.json();
  } catch {
    throw new StaffAccountError(
      response.status,
      "The API answered with nothing where an account was expected.",
    );
  }
}

/**
 * What the API said, in the sentence the administrator should read.
 *
 * The handler's own words are preferred over anything invented here, for
 * `apiMessage`'s reason: the API's refusals are written for the person waiting
 * on them. `ZodValidationPipe` answers a 400 as `{ message: "Validation
 * failed", issues: [{ path, message }] }`, so the first issue is named rather
 * than the generic heading over it — "password: too small" is actionable and
 * "Validation failed" is not. The console checks the same four rules before
 * sending, so reaching this at all means the two sides disagree about them,
 * which is worth reading precisely.
 */
async function refusalFrom(response: Response): Promise<string> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return `The API refused with ${response.status}.`;
  }

  if (typeof body !== "object" || body === null) {
    return `The API refused with ${response.status}.`;
  }

  const { message, issues } = body as {
    message?: unknown;
    issues?: unknown;
  };

  if (Array.isArray(issues)) {
    const first = issues[0] as
      | { path?: unknown; message?: unknown }
      | undefined;

    if (typeof first?.path === "string" && typeof first.message === "string") {
      return `${first.path}: ${first.message}`;
    }
  }

  return typeof message === "string" && message.trim() !== ""
    ? message
    : `The API refused with ${response.status}.`;
}
