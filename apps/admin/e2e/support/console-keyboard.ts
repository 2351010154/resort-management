import { expect, type Locator, type Page } from "@playwright/test";

/* Getting around the console the way an operator does: with keys.
 *
 * Both requirement runs need the same three things — a session, a screen, and
 * focus inside the queue on it — and both need them by keyboard, so they are
 * here once rather than twice.
 *
 * The console's session is deliberately unreachable from a saved storage state:
 * `lib/auth/staff-session-store.ts` keeps the access token in a closure that
 * dies with the tab and the refresh half in an httpOnly cookie, so there is no
 * token to seed and no local storage to restore. Every context signs in for
 * itself.
 *
 * Which account is a run's business, not this file's. It is read from the
 * environment so the same spec runs against a developer's own staff record and
 * against whatever CI provisions, and it refuses loudly rather than falling
 * back to a guess: a hardcoded password would be a credential in the
 * repository, and a silent skip would be a green run that proved nothing.
 */

export const STAFF_EMAIL = process.env.ADMIN_E2E_EMAIL ?? "";
export const STAFF_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";

const MISSING_CREDENTIALS = [
  "No staff account was given to the run.",
  "Set ADMIN_E2E_EMAIL and ADMIN_E2E_PASSWORD to an active console account",
  "(`pnpm --filter @mariva/api staff:create` makes one).",
].join(" ");

/** Any row of any of the console's queues. One Tab stop, arrows within it. */
export const QUEUE_ROW = "tr[data-roving-item]";

/** Signs in and returns once the console's own shell is on screen. */
export async function signIn(page: Page): Promise<void> {
  expect(STAFF_EMAIL, MISSING_CREDENTIALS).not.toBe("");
  expect(STAFF_PASSWORD, MISSING_CREDENTIALS).not.toBe("");

  await page.goto("/login");

  // The form focuses the email field itself. Waiting for that rather than
  // focusing it here is the point: a console that stopped doing it would make
  // the first keystroke land on `<body>`, and the run would say so.
  await expect(page.locator("#email")).toBeFocused();

  await page.keyboard.type(STAFF_EMAIL);
  await page.keyboard.press("Tab");
  await page.keyboard.type(STAFF_PASSWORD);
  await page.keyboard.press("Enter");

  const rail = page.getByRole("navigation", { name: "Console sections" });

  try {
    await expect(rail).toBeVisible();
  } catch (failure) {
    // Read after the wait, not before it. The refusal arrives from a round trip,
    // so a message composed up front would report the empty screen that was
    // there before the API answered.
    throw new Error(
      `Sign-in did not reach the console. ${await refusalText(page)}`,
      { cause: failure },
    );
  }
}

/** Whatever the login screen said about it, for the failure message. */
async function refusalText(page: Page): Promise<string> {
  const alert = page.getByRole("alert");

  return (await alert.count()) === 0
    ? "The login screen reported nothing."
    : `The login screen said: ${await alert.first().innerText()}`;
}

/**
 * To a console family by its `g` sequence, and nothing else.
 *
 * `features/shell/nav-inventory.ts` owns the letters; this only presses them.
 * The two keys go through `page.keyboard`, which drives Chromium's real input
 * pipeline, so a binding that silently stopped working fails here rather than
 * being papered over by a `page.goto`.
 */
export async function goByHotkey(
  page: Page,
  key: string,
  path: string,
): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press(key);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/**
 * Tab until the queue on this screen has focus.
 *
 * The list is one Tab stop, so this is a small number of presses — but counting
 * them here would encode the shell's current layout into two requirements that
 * are not about the shell.
 */
export async function tabIntoQueue(page: Page): Promise<Locator> {
  const rows = page.locator(QUEUE_ROW);

  await expect(
    rows.first(),
    "The queue on this screen is empty, so there is nothing to work.",
  ).toBeVisible();

  for (let pressed = 0; pressed < 30; pressed += 1) {
    if ((await page.locator(`${QUEUE_ROW}:focus`).count()) > 0) {
      return rows;
    }

    await page.keyboard.press("Tab");
  }

  throw new Error("Thirty Tab presses never reached the queue.");
}
