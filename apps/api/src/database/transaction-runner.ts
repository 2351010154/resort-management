// Where a transaction boundary is opened, and the only place it is.
//
// Services take a `DbExecutor` and never open a transaction themselves, so
// something has to. That something is here rather than in each controller for
// two reasons: a controller that injects the Drizzle client can also run a
// query, which is the boundary this codebase keeps; and the day a write needs
// `serializable` or a retry on a `40001` serialization failure, it is one
// method that changes rather than every call site that remembered.
//
// Being the boundary is also what makes this the only place that knows when a
// commit happened, which is why `afterCommit` lives here: everything a rollback
// cannot take back has to wait for that moment, and nothing else in the process
// can see it.

// The `database.module.js` import is type-only, and has to stay that way:
// imports this file to provide it, so a value imported back — the `DRIZZLE`
// token — is a cycle that leaves the token undefined when this decorator runs,
// and Nest reports it as a dependency it cannot resolve. `DatabaseModule`
// constructs this from a factory for that reason.
import { Logger } from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import type { Database, DbExecutor } from "./database.module.js";

/**
 * Where the fallback below is reported.
 *
 * Nest's own logger rather than an injected one, because the code that falls
 * back is a free function with no container around it — `main.ts` hands this
 * class to `app.useLogger`, so a line written here reaches the same pino stream
 * as everything else once the application is up.
 */
const logger = new Logger("afterCommit");

/** Something to do once the transaction it was registered in has committed. */
type PostCommitWork = () => Promise<void>;

/**
 * What each open transaction has been asked to do after it commits.
 *
 * Keyed by the executor rather than handed to `run`'s callback, because the
 * code with something to say afterwards is rarely the code that opened the
 * boundary: a confirmation email is registered by a booking service called by
 * a payment service called by the controller that ran the transaction, and the
 * executor is the only thing that makes that whole journey. Weak, and emptied
 * on the way out of `run`, so an executor somebody kept a reference to cannot
 * collect work nobody will ever drain.
 */
const pendingByExecutor = new WeakMap<object, PostCommitWork[]>();

/**
 * Holds `work` back until the transaction `exec` belongs to has committed.
 *
 * For anything a rollback cannot take back: a message handed to a queue, a
 * call to a payment gateway, a webhook. Written through `exec` it would commit
 * with everything else — but pg-boss writes on its own connection, so a
 * confirmation enqueued inside the transaction survives that transaction being
 * rolled back and advertises rows that no longer exist.
 *
 * Awaiting this is not awaiting the work. Inside a transaction it registers
 * and returns; the caller learns nothing about how the work went, and `run`
 * makes sure a failure stays with the work rather than reaching the caller
 * whose commit is already durable.
 *
 * **Outside a transaction this file opened, the work runs here and now.**
 * There is no commit for it to be hung on, so the choice is between the old
 * failure — work that can outlive a rollback — and silently dropping it, and
 * the first is the lesser one. Every path that must not have it goes through
 * `run`. It is also logged: running inline is safe for a caller that never had
 * a transaction, and is the bug this mechanism exists to prevent for one that
 * does, and nothing in the call itself tells the two apart. A line is what
 * makes the second visible rather than invisible.
 */
export async function afterCommit(
  exec: DbExecutor,
  work: PostCommitWork,
): Promise<void> {
  const pending = pendingByExecutor.get(exec);

  if (!pending) {
    // Warn rather than debug, and on every occurrence: if this executor did
    // belong to an open transaction — a savepoint from `exec.transaction`, a
    // service handed the raw client, a refactor that stopped going through
    // `run` — then the work is about to be handed over before the rows it
    // advertises are durable, and a rollback afterwards leaves a guest holding
    // a confirmation for a booking that does not exist.
    logger.warn(
      "work was registered for after a commit outside any transaction this " +
        "file opened, so it ran immediately; if the caller was in fact inside " +
        "a transaction, it has just escaped that transaction's rollback",
    );

    await work();

    return;
  }

  pending.push(work);
}

export class TransactionRunner {
  /**
   * @param logger Absent where this is constructed by hand in a test. Nothing
   *   but a post-commit failure is reported through it, and that failure has
   *   nowhere else to be seen.
   */
  constructor(
    private readonly db: Database,
    private readonly logger?: Pick<PinoLogger, "error">,
  ) {}

  /**
   * Runs `work` inside one transaction, and commits only if it returns.
   *
   * Anything thrown rolls the whole thing back — including the `ORPCError` a
   * service raises for a sold-out night, which is the point: a refusal on the
   * third night must not leave the first two consumed. Whatever `afterCommit`
   * was given during that attempt is thrown away with it, unrun.
   *
   * The signature is the one every call site already passes: a callback taking
   * the executor. Work for after the commit is registered against that
   * executor rather than through a second argument nobody in the chain below
   * the caller could have been handed.
   *
   * This opens a transaction on the pool rather than a savepoint on one it was
   * handed — `db` here is the client, never a caller's executor — so `run`
   * inside `run` is two transactions on two connections, each committing on
   * its own and each draining its own queue. A savepoint would be
   * `exec.transaction(...)`, which nothing in this codebase calls.
   */
  async run<T>(work: (exec: DbExecutor) => Promise<T>): Promise<T> {
    let pending: PostCommitWork[] = [];

    const result = await this.db.transaction(async (exec) => {
      // A fresh queue for each attempt, and the reason is the `40001` retry the
      // top of this file anticipates: a serialization failure runs this
      // callback again, and work registered by the attempt that rolled back
      // belongs to a transaction that never committed. Carried forward, it
      // would be sent once for the attempt that failed and once for the one
      // that succeeded.
      pending = [];

      pendingByExecutor.set(exec, pending);

      try {
        return await work(exec);
      } finally {
        // While the transaction is still open rather than after it closes:
        // registering against an executor whose work has already returned
        // would be work this file runs as though it had been part of the
        // transaction, and by then nothing else can be.
        pendingByExecutor.delete(exec);
      }
    });

    // Sequential, in the order the work was registered, and only once the
    // commit above returned.
    for (const task of pending) {
      try {
        await task();
      } catch (error) {
        // The commit stands and so does the caller's result — the transaction
        // is durable and cannot be taken back on account of what happens out
        // here. The rest of the queue still runs for the same reason: one
        // caller's failed message is not another's. Only the error is logged;
        // what the work was about is a guest's address or a live link.
        this.logger?.error(
          { err: error, context: TransactionRunner.name },
          "work registered for after the commit failed; the commit stands",
        );
      }
    }

    return result;
  }
}
