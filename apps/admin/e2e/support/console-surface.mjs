/* What the console looks like from outside it, in plain JavaScript.
 *
 * Two very different things drive this console with a browser: the Playwright
 * specs beside this file, and `scripts/shoot-thesis-figures.mjs`, a hand-run
 * node tool that photographs six screens for the thesis. They drive it for
 * opposite reasons — the specs assert that the console answers a keyboard, the
 * script only needs to arrive somewhere and hold still long enough for a
 * screenshot — so their flows are deliberately not the same code, and merging
 * them would make each one carry the other's obligations.
 *
 * What they cannot be allowed to disagree about is what the console *is*: which
 * account they sign in as, what a queue row is called, what the shell's landmark
 * is named, what the palette's field says. Those are the parts that drift when
 * the console changes and only one caller is updated, and they live here so
 * there is one answer to update.
 *
 * Plain `.mjs` on purpose, and the only file in `e2e/` that is. The script runs
 * under bare `node` against the `playwright` package, with no test runner and no
 * TypeScript loader in front of it, so anything it shares with the specs has to
 * be something node can import as it stands. Nothing here imports
 * `@playwright/test`; the `expect`-shaped half of the specs' vocabulary stays in
 * `console-keyboard.ts`, which only the runner ever loads.
 */

/* Which account is a run's business, not this file's. It is read from the
 * environment so the same code runs against a developer's own staff record and
 * against whatever CI provisions, and both callers refuse loudly rather than
 * falling back to a guess: a hardcoded password would be a credential in the
 * repository, and a silent skip would be a green run that proved nothing. */
export const STAFF_EMAIL = process.env.ADMIN_E2E_EMAIL ?? "";
export const STAFF_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";

/** Said to whoever started a run without an account, with both of the ways they
 *  might have meant to supply one. */
export const MISSING_CREDENTIALS = [
  "No staff account was given to the run.",
  "Set ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD to an active console account —",
  "`pnpm --filter @mariva/api staff:create` makes one, and a developer's own",
  "already sits in the gitignored apps/admin/.env.local.",
  "Neither caller guesses or hardcodes a password, because that would put a",
  "credential in the repository.",
].join(" ");

/** Any row of any of the console's queues. One Tab stop, arrows within it. */
export const QUEUE_ROW = "tr[data-roving-item]";

/** The shell's own landmark, and so the sign that a session exists at all. */
export const CONSOLE_RAIL = "Console sections";

/** The command palette's field, which is also how you know it opened. */
export const PALETTE_PLACEHOLDER = "Type a command…";

/** The scroll box every console table sits in — `components/console/
 *  data-table-frame.tsx` stamps the slot on it. Named here because a caller
 *  that needs to undo a sideways scroll has to address that box and nothing
 *  else. */
export const DATA_TABLE_FRAME = '[data-slot="data-table-frame"]';

/**
 * Whatever the login screen said about it, for a failure message.
 *
 * Read after the wait that failed, never before it. The refusal arrives from a
 * round trip, so a message composed up front would report the empty screen that
 * was there before the API answered.
 */
export async function refusalText(page) {
  const alert = page.getByRole("alert");

  return (await alert.count()) === 0
    ? "The login screen reported nothing."
    : `The login screen said: ${await alert.first().innerText()}`;
}
