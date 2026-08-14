// Whether an address already has a guest account, asked in SQL.
//
// A function rather than a service, and it is deliberate. Two callers need the
// answer and they sit either side of a module boundary that must not become an
// import: the booking module decides which of the confirmation mail's two
// bodies to compose, and the attach flow beside this file decides whether to
// create an account or to reuse the one already there. A Nest provider would
// have made the booking module import the auth module for one `select`, and a
// second copy of the query would have been two answers to one question.
//
// **Case-insensitively, because the index is.** `schema/guest-auth.ts` puts the
// unique key on `lower(email)`, so `Anh@` and `anh@` are one account there; a
// comparison here that used `=` on the raw column would report "no account" for
// an address that cannot be registered again — and the confirmation mail would
// offer to create one that the unique index then refuses. Written as `lower(…)
// = lower(…)` so the planner uses that index rather than scanning.
//
// **It answers about existence and never about identity to a caller.** Nothing
// derived from this reaches an HTTP response: `booking-confirmation.service.ts`
// argues why the branch is safe in a mail and would be an enumeration oracle on
// a page, and the two callers here are the mail and a flow whose credential is
// the link that mail carried.

import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../database/database.module.js";
import { user as guestUser } from "../../../database/schema/guest-auth.js";

/** The account registered under this address, or `null`. */
export async function accountForAddress(
  exec: DbExecutor,
  address: string,
): Promise<{ readonly id: string } | null> {
  const [row] = await exec
    .select({ id: guestUser.id })
    .from(guestUser)
    .where(sql`lower(${guestUser.email}) = lower(${address})`)
    .limit(1);

  return row ?? null;
}
