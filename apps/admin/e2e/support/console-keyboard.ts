import { expect, type Locator, type Page } from "@playwright/test";

import {
  CONSOLE_RAIL,
  MISSING_CREDENTIALS,
  PALETTE_PLACEHOLDER,
  QUEUE_ROW,
  refusalText,
  STAFF_EMAIL,
  STAFF_PASSWORD,
} from "./console-surface.mjs";

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
 * Which account, what a queue row is called, what the shell's landmark is
 * named: all of that comes from `console-surface.mjs`, which the thesis figure
 * script reads too. What stays here is the half that only means anything inside
 * the test runner — every `expect` below is an assertion the requirements are
 * about, not a wait dressed up as one.
 */

export { QUEUE_ROW, STAFF_EMAIL, STAFF_PASSWORD };

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

  const rail = page.getByRole("navigation", { name: CONSOLE_RAIL });

  try {
    await expect(rail).toBeVisible();
  } catch (failure) {
    throw new Error(
      `Sign-in did not reach the console. ${await refusalText(page)}`,
      { cause: failure },
    );
  }
}

/**
 * To a console family through the command palette, and nothing else.
 *
 * ⌘K, the family's name, Enter. `features/shell/nav-inventory.ts` owns the
 * labels; this only types one. Every key goes through `page.keyboard`, which
 * drives Chromium's real input pipeline, so navigation that silently stopped
 * working by keyboard fails here rather than being papered over by a
 * `page.goto`.
 */
export async function goByPalette(
  page: Page,
  label: string,
  path: string,
): Promise<void> {
  // The palette resolves `mod` against the machine it runs on, and so does
  // Playwright: one spelling, right on a Linux runner and on a Mac.
  await page.keyboard.press("ControlOrMeta+k");

  const search = page.getByPlaceholder(PALETTE_PLACEHOLDER);

  // The dialog focuses its own input. Waiting for that rather than clicking it
  // is the point — a palette that stopped doing it would drop the name on the
  // screen underneath.
  await expect(search).toBeFocused();
  await search.pressSequentially(label);

  // The row has to be on screen before Enter, or the press lands while the
  // list is still the unfiltered one and runs whatever was highlighted in it.
  await expect(
    page.getByRole("option", { name: label, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");

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
