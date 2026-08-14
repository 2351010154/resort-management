// Does the database this process is about to serve have the schema this build
// was written against?
//
// Nothing asked that question until now, and the cost of not asking is
// specific: a migration that was generated but never run does not fail at boot,
// it fails on the first request that touches the column it added. Drizzle's
// `.returning()` enumerates every column the schema declares, so a table that
// is one column behind raises `42703` on a write that names none of it — and
// oRPC encodes that as `INTERNAL_SERVER_ERROR`. What the operator sees is one
// step of one funnel returning 500 while everything around it works. What is
// actually true is that the whole process is pointed at the wrong schema.
//
// So it is asked once, at boot, and a process that would answer wrongly does
// not start. That is the same trade `main.ts` already makes for the
// environment: a misconfigured process is more useful stopped, with one line
// naming the fix, than running and refusing a guest at the moment they pay.
//
// ## What is compared
//
// `drizzle.__drizzle_migrations` has three columns — `id`, `hash`, `created_at`
// — and only one of them can be joined to the journal. `id` is a serial and is
// *not* the journal's `idx`: a database that has been dropped and rebuilt has
// the same migrations under different ids, and counting rows or reading the
// highest id would call a rebuilt-but-current database drifted. `hash` is a
// digest of the migration's SQL text and the journal does not record it.
// `created_at` is the journal entry's `when`, written through unchanged by
// drizzle-kit, so it is the identity the two sides share and it is what is
// compared here.
//
// Only one direction is an error. A journal entry with no row is a migration
// this build needs and the database has not run — the failure this file exists
// for. A row with no journal entry is a database that has run something this
// build does not know about, which is what every deploy looks like for the few
// seconds between the migration and the new process, and refusing to start then
// would turn a normal rollout into an outage.

import type pg from "pg";
// Imported rather than read off disk: `dist/` has no `src/` under it, and a
// path resolved from `import.meta.url` would work in development and fail in
// production. `tsc` copies an imported JSON file into `outDir`, so the built
// artifact carries its own journal.
import journal from "./migrations/meta/_journal.json" with { type: "json" };

// `undefined_table`. A database that has never been migrated at all has no
// `drizzle` schema, and that is the same fault as a database missing one
// migration — it should print the same actionable line rather than a Postgres
// error about a relation nobody outside this file has heard of.
const UNDEFINED_TABLE = "42P01";

/**
 * Refuses to continue when the database is behind this build's migrations.
 *
 * Throws a single-sentence `Error` naming what is missing and how to apply it;
 * `main.ts` prints that message and exits non-zero. Returns silently when the
 * database is at or ahead of the journal.
 */
export async function assertMigrationsApplied(pool: pg.Pool): Promise<void> {
  const applied = await appliedStamps(pool);

  const missing = journal.entries
    .filter((entry) => !applied.has(String(entry.when)))
    .map((entry) => entry.tag);

  if (missing.length === 0) {
    return;
  }

  // One line, naming every missing migration rather than only the first: an
  // operator who has to run the command anyway is better served knowing how far
  // behind the database is than being told again after the next boot.
  throw new Error(
    `Database is behind this build by ${missing.length} of ${journal.entries.length} migrations ` +
      `(${missing.join(", ")}) — run \`pnpm db:migrate\` in apps/api against DATABASE_URL, then start again.`,
  );
}

/**
 * The `created_at` stamps of every migration the database has run.
 *
 * `bigint` comes back from `pg` as a string, and the journal's `when` is a
 * number below `Number.MAX_SAFE_INTEGER`; the set is keyed on the string form
 * so the comparison never goes through a float.
 */
async function appliedStamps(pool: pg.Pool): Promise<Set<string>> {
  try {
    const result = await pool.query<{ created_at: string }>(
      "select created_at from drizzle.__drizzle_migrations",
    );

    return new Set(result.rows.map((row) => row.created_at));
  } catch (error) {
    if ((error as { code?: unknown }).code === UNDEFINED_TABLE) {
      return new Set();
    }

    throw error;
  }
}
