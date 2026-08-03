// Where a transaction boundary is opened, and the only place it is.
//
// Services take a `DbExecutor` and never open a transaction themselves, so
// something has to. That something is here rather than in each controller for
// two reasons: a controller that injects the Drizzle client can also run a
// query, which is the boundary this codebase keeps; and the day a write needs
// `serializable` or a retry on a `40001` serialization failure, it is one
// method that changes rather than every call site that remembered.

// The import is type-only, and has to stay that way: `database.module.ts`
// imports this file to provide it, so a value imported back — the `DRIZZLE`
// token — is a cycle that leaves the token undefined when this decorator runs,
// and Nest reports it as a dependency it cannot resolve. `DatabaseModule`
// constructs this from a factory for that reason.
import type { Database, DbExecutor } from "./database.module.js";

export class TransactionRunner {
  constructor(private readonly db: Database) {}

  /**
   * Runs `work` inside one transaction, and commits only if it returns.
   *
   * Anything thrown rolls the whole thing back — including the `ORPCError` a
   * service raises for a sold-out night, which is the point: a refusal on the
   * third night must not leave the first two consumed.
   */
  async run<T>(work: (exec: DbExecutor) => Promise<T>): Promise<T> {
    return await this.db.transaction(work);
  }
}
