// The arguments a `pnpm` script actually receives, with the separator pnpm
// leaves behind removed.
//
// `pnpm run <script> -- --flag value` does not strip the `--`. It forwards it
// as a literal argv entry, so the script is invoked as
// `node dist/…/seed.script.js "--" "--from" "2027-03-01"`. Node's `parseArgs`
// reads `--` as the option terminator, which makes every argument after it a
// positional — and both scripts here are `strict` with no `positionals`
// configured, so the call throws `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` before
// a single option is read.
//
// The failure mode this prevents is worse than the crash it prevents.
// `allowPositionals: true` would stop the throw and would be the wrong fix: the
// arguments after `--` would still be positionals rather than options, so
// `values.from` would arrive `undefined` and the seed would silently open the
// calendar on the current month instead of the pinned one. A fixture that
// asserts a price on a named night would then fail somewhere else entirely.
//
// Dropping the separator is the whole of it, and it makes both documented forms
// work: `db:seed --from 2027-03-01` and `db:seed -- --from 2027-03-01` parse
// identically. Only the first entry is examined, so a `--` a caller meant as a
// terminator further along still terminates.

/**
 * `process.argv` past the script path, without pnpm's forwarded separator.
 *
 * Takes the argument list rather than reading `process.argv` inside, so the
 * behaviour can be asserted over both invocation forms without spawning a
 * process.
 */
export function scriptArgs(
  argv: readonly string[] = process.argv.slice(2),
): string[] {
  return argv[0] === "--" ? [...argv.slice(1)] : [...argv];
}
