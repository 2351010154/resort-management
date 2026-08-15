// The check that decides whether this process may start.
//
// Its two failure directions are opposite and both expensive. Refusing a
// database that is in fact current takes the application down for a reason that
// is not real — and the likeliest way to get there is comparing the wrong
// column, because `drizzle.__drizzle_migrations.id` is a serial that a rebuilt
// database renumbers. Accepting a database that is behind puts the 500 back
// where it was, one request deep into a funnel.
//
// So the happy path is asserted against the real database the suite owns,
// because only a real one proves the join between the journal's `when` and the
// table's `created_at` is a join at all. The drift cases are asserted against a
// stand-in, because the alternative is a test that drops a migration from a
// database another file is reading at the same moment.

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { assertMigrationsApplied } from "./migration-check.js";
import journal from "./migrations/meta/_journal.json" with { type: "json" };

/** A pool that answers the one query this file makes, and nothing else. */
function aPoolReturning(stamps: readonly number[]): pg.Pool {
  return {
    query: async () => ({ rows: stamps.map((when) => ({ created_at: String(when) })) }),
  } as unknown as pg.Pool;
}

/** A pool with no `drizzle` schema at all — a database nobody has migrated. */
function anUnmigratedPool(): pg.Pool {
  return {
    query: async () => {
      throw Object.assign(
        new Error('relation "drizzle.__drizzle_migrations" does not exist'),
        { code: "42P01" },
      );
    },
  } as unknown as pg.Pool;
}

const allStamps = journal.entries.map((entry) => entry.when);
const last = journal.entries[journal.entries.length - 1]!;

describe("refusing to start against a database that is behind", () => {
  it("names the missing migration and the command that applies it", async () => {
    await expect(
      assertMigrationsApplied(aPoolReturning(allStamps.slice(0, -1))),
    ).rejects.toThrow(
      new RegExp(`${last.tag}[\\s\\S]*pnpm db:migrate`),
    );
  });

  it("says the same thing when nothing has ever been migrated", async () => {
    await expect(assertMigrationsApplied(anUnmigratedPool())).rejects.toThrow(
      /pnpm db:migrate/,
    );
  });

  // The reason `id` is not the column compared. A dropped and rebuilt database
  // holds every migration under new serial ids, and calling that drift would
  // refuse to start a process whose schema is exactly right.
  it("accepts a database whose rows were renumbered by a rebuild", async () => {
    await expect(
      assertMigrationsApplied(aPoolReturning([...allStamps].reverse())),
    ).resolves.toBeUndefined();
  });

  // The few seconds of every deploy between the migration and the new process.
  // Refusing here would turn a normal rollout into an outage.
  it("accepts a database that is ahead of this build", async () => {
    await expect(
      assertMigrationsApplied(aPoolReturning([...allStamps, Date.now()])),
    ).resolves.toBeUndefined();
  });

  // Anything that is not a missing table is someone else's problem — an
  // unreachable database must not be reported as unapplied migrations.
  it("does not disguise a connection failure as drift", async () => {
    const unreachable = {
      query: async () => {
        throw Object.assign(new Error("connection refused"), {
          code: "ECONNREFUSED",
        });
      },
    } as unknown as pg.Pool;

    await expect(assertMigrationsApplied(unreachable)).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe("the database the suite runs against", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  // Real rows, real journal. If this fails, the database is behind and the rest
  // of the suite is about to fail for reasons that will look unrelated.
  it("is at the journal's head", async () => {
    await expect(assertMigrationsApplied(pool)).resolves.toBeUndefined();
  });
});
