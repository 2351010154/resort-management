// Reading Postgres' answer out of a thrown error.
//
// Writes across this codebase are deliberately unguarded: the invariants live in
// the database, so a service writes the row and lets a constraint refuse it.
// That makes the SQLSTATE the return value of a failed write rather than a
// diagnostic, and every service that writes needs to read it.
//
// It sits beside the executor rather than inside one of the modules that reads
// it. Postgres' error codes are the database's vocabulary and not any one
// module's — `guest`, `inventory` and everything that writes after them ask the
// same question, and a helper owned by whichever module happened to need it
// first would have the others importing across a boundary for a concern neither
// of them owns.

/**
 * The SQLSTATE out of a thrown error.
 *
 * Drizzle wraps the driver's error in one of its own, so the code sits on a
 * cause one or more levels down. The chain is walked rather than assumed to be
 * one deep — the day a layer is added, this should still read the code rather
 * than start returning `undefined` and turning every conflict into a 500.
 */
export function sqlStateOf(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code } = current as Error & { code?: unknown };

    if (typeof code === "string") {
      return code;
    }
  }

  return undefined;
}
