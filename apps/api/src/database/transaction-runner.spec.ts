// What `afterCommit` promises and the four ways it could quietly break it, and
// what every transaction tells Postgres about who opened it.
//
// The promise is narrow: work registered inside a transaction runs once that
// transaction has committed, in the order it was registered, and never at all
// if the transaction rolled back. Everything a rollback cannot take back
// depends on it — a confirmation email above all, because pg-boss writes on its
// own connection and a message enqueued inside a transaction outlives the
// rollback that took back the rows it advertises.
//
// The database here is a stand-in rather than a real Postgres, and that is the
// point of this file: what is under test is control flow — when the queue is
// drained, in what order, and what happens to a caller when a piece of it
// throws — and a stand-in is the only way to observe the commit itself as an
// event. That the same holds against real Drizzle over real Postgres, with real
// rows going back, is what `modules/booking/booking-confirmation.spec.ts`
// asserts.

import { Logger } from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withAuditActor } from "../common/audit/audit-actor.js";
import type { Database, DbExecutor } from "./database.module.js";
import { afterCommit, TransactionRunner } from "./transaction-runner.js";

/**
 * The renderer the real client would use.
 *
 * Statements are asserted as the text and parameters Postgres would receive
 * rather than as the builder object, because what matters about the announcement
 * below is that the id travels as a parameter: interpolated into the text it
 * would be SQL assembled from a value, which is the one thing a setting carrying
 * an account id must never be.
 */
const postgres = new PgDialect();

/** The fallback branch's only signal. Silenced here because several cases take
 *  that branch on purpose, and read where it is the thing under test. */
const warned = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

beforeEach(() => {
  warned.mockClear();
});

/**
 * The executor a transaction hands its work.
 *
 * It carries `execute` because `run` calls it before the caller's work starts —
 * that is where the acting member of staff is announced to Postgres — and
 * everything it is given lands in `said` for a case that wants to read it back.
 * Nothing else on a real executor is reached from this file.
 */
function anExecutor(said: SQL[] = []): DbExecutor {
  return {
    execute: async (statement: SQL) => {
      said.push(statement);
    },
  } as unknown as DbExecutor;
}

/**
 * A client whose `transaction` keeps Drizzle's contract and records the commit.
 *
 * Commits when the work returns, rolls back when it throws, and either way the
 * caller sees what the work did. `log` receives `"commit"` at the moment the
 * transaction ends, so a post-commit callback appending to the same array shows
 * which side of that moment it ran on.
 */
function aDatabase(log: string[], exec: DbExecutor = anExecutor()): Database {
  return {
    transaction: async <T>(work: (exec: DbExecutor) => Promise<T>) => {
      const result = await work(exec);

      log.push("commit");

      return result;
    },
  } as unknown as Database;
}

describe("work registered for after the commit", () => {
  it("runs once the transaction has committed, in the order it was registered", async () => {
    const log: string[] = [];
    const runner = new TransactionRunner(aDatabase(log));

    await runner.run(async (exec) => {
      await afterCommit(exec, async () => {
        log.push("first");
      });
      await afterCommit(exec, async () => {
        log.push("second");
      });

      log.push("work");
    });

    // Registration order, and both after the commit rather than at the point
    // they were registered.
    expect(log).toEqual(["work", "commit", "first", "second"]);
  });

  it("is registered by whatever holds the executor, not only by the caller of run", async () => {
    const log: string[] = [];
    const runner = new TransactionRunner(aDatabase(log));

    // The shape the confirmation actually has: the transaction is opened by a
    // controller, and the code with something to say afterwards is two calls
    // below it and was handed nothing but the executor.
    const aServiceDeepInTheStack = async (exec: DbExecutor): Promise<void> => {
      await afterCommit(exec, async () => {
        log.push("mail");
      });
    };

    await runner.run((exec) => aServiceDeepInTheStack(exec));

    expect(log).toEqual(["commit", "mail"]);
  });

  it("does not run when the transaction rolls back", async () => {
    const log: string[] = [];
    const runner = new TransactionRunner(aDatabase(log));

    await expect(
      runner.run(async (exec) => {
        await afterCommit(exec, async () => {
          log.push("mail");
        });

        throw new Error("the folio would not take the posting");
      }),
    ).rejects.toThrow("the folio would not take the posting");

    // No commit, so nothing to announce. This is the whole reason the queue
    // exists rather than the message being handed over where it is composed.
    expect(log).toEqual([]);
  });

  it("is not collected against an executor once its transaction has ended", async () => {
    const log: string[] = [];
    const exec = anExecutor();
    const runner = new TransactionRunner(aDatabase(log, exec));

    await runner.run(async () => undefined);

    // Whoever kept the executor is outside the transaction now, so there is no
    // commit left to wait for and the work runs where it stands rather than
    // joining a queue nothing will drain.
    await afterCommit(exec, async () => {
      log.push("late");
    });

    expect(log).toEqual(["commit", "late"]);
  });

  it("runs where it stands when nothing opened a transaction around it", async () => {
    const log: string[] = [];

    await afterCommit(anExecutor(), async () => {
      log.push("mail");
    });

    expect(log).toEqual(["mail"]);
  });

  it("says so when it runs inline, because that branch is also how the bug comes back", async () => {
    await afterCommit(anExecutor(), async () => {});

    // Running inline is correct for a caller that never had a transaction and
    // is the original fault for one that does — a savepoint executor, a service
    // handed the raw client, a refactor that stopped going through `run`. The
    // call cannot tell them apart, so the line is what makes the second one
    // findable instead of silent.
    expect(
      warned,
      "Post-commit work escaped to the inline branch without a word. The next " +
        "time a confirmation is enqueued before its commit, nothing in the " +
        "logs will say so.",
    ).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the work is held for a real commit", async () => {
    const runner = new TransactionRunner(aDatabase([]));

    await runner.run(async (exec) => {
      await afterCommit(exec, async () => {});
    });

    // A warning on the ordinary path is a warning nobody reads on the path
    // that matters.
    expect(warned).not.toHaveBeenCalled();
  });
});

/**
 * A transaction that is attempted twice.
 *
 * The shape the top of `transaction-runner.ts` anticipates: a `40001`
 * serialization failure is retried by re-running the callback, and Drizzle's
 * contract allows a client to do that. What must not survive the retry is the
 * failed attempt's post-commit queue — that work belongs to a transaction which
 * never committed, and draining it after the second attempt's commit sends
 * everything twice.
 */
describe("a transaction whose work is attempted more than once", () => {
  it("drains only the attempt that committed", async () => {
    const log: string[] = [];
    let attempts = 0;

    const retrying = {
      transaction: async <T>(work: (exec: DbExecutor) => Promise<T>) => {
        try {
          return await work(anExecutor());
        } catch {
          attempts += 1;

          const result = await work(anExecutor());

          log.push("commit");

          return result;
        }
      },
    } as unknown as Database;

    const runner = new TransactionRunner(retrying);

    await runner.run(async (exec) => {
      await afterCommit(exec, async () => {
        log.push("mail");
      });

      if (attempts === 0) {
        throw new Error("could not serialize access due to concurrent update");
      }
    });

    expect(
      log,
      "The message registered by the attempt that rolled back was sent as " +
        "well, so the guest heard about one booking twice.",
    ).toEqual(["commit", "mail"]);
  });
});

describe("a piece of that work that throws", () => {
  it("is contained: the caller keeps its result and the rest still runs", async () => {
    const log: string[] = [];
    const logger = { error: vi.fn() };
    const runner = new TransactionRunner(aDatabase(log), logger);

    const answer = await runner.run(async (exec) => {
      await afterCommit(exec, async () => {
        throw new Error("the queue is unavailable");
      });
      await afterCommit(exec, async () => {
        log.push("second");
      });

      return "the booking is confirmed";
    });

    // The transaction committed. Nothing that happens out here can take that
    // back, so the caller's answer stands.
    expect(answer).toBe("the booking is confirmed");

    // And one caller's failed message is not another's.
    expect(log).toEqual(["commit", "second"]);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("the callers that were here before any of this", () => {
  it("hand run one callback taking the executor, and get their value back", async () => {
    const log: string[] = [];
    const exec = anExecutor();
    const runner = new TransactionRunner(aDatabase(log, exec));

    const seen: DbExecutor[] = [];

    const answer = await runner.run(async (transaction) => {
      seen.push(transaction);

      return 7;
    });

    expect(answer).toBe(7);
    expect(seen).toEqual([exec]);
    expect(log).toEqual(["commit"]);
  });

  it("still have everything rolled back by anything thrown", async () => {
    const log: string[] = [];
    const runner = new TransactionRunner(aDatabase(log));

    await expect(
      runner.run(async () => {
        throw new Error("the third night is sold out");
      }),
    ).rejects.toThrow("the third night is sold out");

    expect(log).toEqual([]);
  });
});

/**
 * Who Postgres is told is acting.
 *
 * The row-audit triggers attribute every entry they file from a
 * transaction-local setting, and this is the only code that establishes it. What
 * is on trial here is the announcement itself — that it happens, what it carries
 * and when it is made — because each of the three fails silently: an actor never
 * announced credits a manager's reprice to the property's own machinery, an
 * actor announced after the caller's first write leaves that write attributed to
 * nobody, and an actor left standing from a previous request accuses whoever
 * held the connection before.
 *
 * The ambient scope is established by hand here because there is no request. In
 * production `common/audit/audit.interceptor.ts` does it, off the access guard's
 * decision.
 */
describe("the actor a transaction is opened by", () => {
  const A_MANAGER = "3f1d3e4b-8b1f-4a3a-9c2e-1f6a1b2c3d4e";

  it("is announced to Postgres before the caller's work runs", async () => {
    const said: SQL[] = [];
    const exec = anExecutor(said);
    const runner = new TransactionRunner(aDatabase([], exec));

    let saidBeforeTheWork = 0;

    await withAuditActor({ staffUserId: A_MANAGER }, () =>
      runner.run(async () => {
        saidBeforeTheWork = said.length;
      }),
    );

    // Not merely at some point during the transaction. A write in the caller's
    // first line fires an audit trigger, and a trigger reading a setting that
    // has not been made yet files the change against nobody.
    expect(saidBeforeTheWork).toBe(1);

    expect(postgres.sqlToQuery(said[0]!)).toMatchObject({
      sql: "select set_config($1, $2, true)",
      params: ["app.audit_actor", A_MANAGER],
    });
  });

  it("is local to the transaction, so the next one on the connection is not it", async () => {
    const said: SQL[] = [];
    const exec = anExecutor(said);
    const runner = new TransactionRunner(aDatabase([], exec));

    await withAuditActor({ staffUserId: A_MANAGER }, () =>
      runner.run(async () => undefined),
    );

    // The sweep, the job, the gateway callback — the ordinary case, and the one
    // that shares a pooled connection with the request before it. The setting is
    // released by Postgres when a transaction ends, and it is stated again here
    // anyway: the cost of being wrong about the release is a change credited to
    // somebody who did not make it.
    await runner.run(async () => undefined);

    expect(said).toHaveLength(2);
    expect(postgres.sqlToQuery(said[1]!).params).toEqual(["app.audit_actor", ""]);
  });

  it("is stated again by an attempt that follows one that rolled back", async () => {
    const said: SQL[] = [];
    let attempts = 0;

    // The `40001` retry the top of `transaction-runner.ts` anticipates. The
    // second attempt is a second transaction, so it holds none of the first
    // one's settings.
    const retrying = {
      transaction: async <T>(work: (exec: DbExecutor) => Promise<T>) => {
        try {
          return await work(anExecutor(said));
        } catch {
          attempts += 1;

          return await work(anExecutor(said));
        }
      },
    } as unknown as Database;

    await withAuditActor({ staffUserId: A_MANAGER }, () =>
      new TransactionRunner(retrying).run(async () => {
        if (attempts === 0) {
          throw new Error("could not serialize access due to concurrent update");
        }
      }),
    );

    expect(said).toHaveLength(2);
    expect(postgres.sqlToQuery(said[1]!).params).toEqual([
      "app.audit_actor",
      A_MANAGER,
    ]);
  });
});
