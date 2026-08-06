// One run at a time against the one database the suite owns.
//
// Every e2e file here truncates or re-seeds tables the other files also read,
// and `fileParallelism: false` in `vitest.config.ts` is what stops two of them
// doing that at the same moment. That setting orders files *within* a single
// vitest process and says nothing about a second `vitest run` started while the
// first is still going — the ordinary case of two people, or two agents, or a
// watch mode left open, working in one repository.
//
// Two runs against one database interleave a truncate with a seed, and the
// failure then surfaces a long way from its cause. `seedDatabase` inserts the
// room types, the other run truncates them a moment later, and the rates that
// reference those types fail with a foreign-key violation inside a file that
// did nothing wrong. A handful of files fail, which ones differ from run to
// run, and running again once the other has finished passes — a signature that
// reads as flakiness or as leftover state, and is neither.
//
// So a run takes a lock and holds it for its whole duration; a second run waits
// for the first instead of corrupting it. The lock is session-scoped, so
// Postgres drops it when this connection goes: a cancelled or crashed run
// leaves nothing behind for the next one to wait on.

import pg from "pg";

// Any number would serve — it only has to be one that every run of this suite
// agrees on, and unlikely to collide with a lock some other tool takes on the
// same server. Advisory locks share one namespace per database.
const SUITE_LOCK_KEY = "8140251063009112";

// How long a run waits before deciding the holder is not going to finish. Long
// enough for a full suite plus coverage to run twice over, because the honest
// reason for a wait is that somebody else's run is simply still going.
const WAIT_CEILING_MS = 10 * 60 * 1000;

const POLL_INTERVAL_MS = 500;

export default async function setup(): Promise<() => Promise<void>> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  const client = new pg.Client({ connectionString });

  await client.connect();

  const startedWaitingAt = Date.now();
  let announced = false;

  while (!(await tryLock(client))) {
    if (Date.now() - startedWaitingAt > WAIT_CEILING_MS) {
      await client.end();

      throw new Error(
        "Another test run has held this database for ten minutes. If no run " +
          "is going, a connection is still open against it — check for a " +
          "watch mode or a stopped debugger before running again.",
      );
    }

    // Said once rather than every poll: the point is to explain the pause, and
    // a line every half second would bury the run that follows it.
    if (!announced) {
      announced = true;
      console.log(
        "Waiting for another test run to finish with this database — the " +
          "suite truncates shared tables and cannot share them.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return async () => {
    // Ending the connection would release the lock on its own. It is unlocked
    // explicitly first so that a teardown which fails to close cleanly still
    // frees the next run, rather than leaving it to the server noticing.
    await client.query("select pg_advisory_unlock($1)", [SUITE_LOCK_KEY]);
    await client.end();
  };
}

async function tryLock(client: pg.Client): Promise<boolean> {
  const held = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1) as locked",
    [SUITE_LOCK_KEY],
  );

  return held.rows[0]!.locked;
}
