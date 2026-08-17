import { expect, type Locator, type Page, test } from "@playwright/test";

import { goByHotkey, signIn, tabIntoQueue } from "./support/console-keyboard";
import {
  describeSighting,
  entranceAnimations,
  installAnimationWatch,
} from "./support/entrance-animation";
import {
  installFeedbackProbe,
  type Measurement,
  measureFeedback,
} from "./support/feedback-probe";

/* `NFR-04` — the console answers inside 150 ms and does not make an entrance.
 *
 * `docs/product-requirements.md` §NFR: "**< 150 ms**, no entrance animation on
 * operational screens", verified by E2E timing at M7. Both halves are here,
 * across the four screens the front desk actually works — Dashboard, Arrivals,
 * Departures, Bookings — and across the three ways an operator touches them: a
 * key, a press, and a form.
 *
 * ## What is being timed
 *
 * Input event to the first painted frame carrying the answer, measured on the
 * browser's own clock — see `support/feedback-probe.ts` for why neither end can
 * honestly be taken from Node. The budget is the requirement's, unrounded, and
 * every measurement is printed whether it passes or fails: a run that says only
 * "ok" tells the next person nothing about how much headroom is left.
 *
 * ## What is deliberately not being timed
 *
 * Not the network. A search that answers in 400 ms has not failed `NFR-04`; a
 * search that leaves the operator with no sign it heard them for 400 ms has.
 * So each acknowledgement below is the console's own first visible answer — the
 * caret arriving, the row's sequence opening, the pending line appearing — and
 * never the arrival of a payload the API owns the timing of.
 *
 * ## Running this
 *
 * Against an already-serving console: `ADMIN_E2E_EMAIL` and
 * `ADMIN_E2E_PASSWORD` name a staff account, `ADMIN_E2E_BASE_URL` the console.
 * One worker and no retries, both fixed in `playwright.config.ts`, because a
 * millisecond budget measured on a contended machine or re-run until it passes
 * is not measured at all.
 */

/** `NFR-04`, exactly as the requirement writes it. */
const BUDGET_MS = 150;

test.beforeEach(async ({ page }) => {
  await installFeedbackProbe(page);
});

test("the dashboard answers a keystroke and a press inside the budget", async ({
  page,
}) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  const measurements: Measurement[] = [];

  // Tabbed to rather than counted to. What sits before the rail is not the
  // console's business — a development build puts its own control there — and a
  // press counted from the top of the document would be measuring the harness.
  await tabUntilFocused(page, 'nav a[href="/dashboard"]');

  measurements.push(
    await measureFeedback(
      page,
      "Dashboard · Tab leaves the rail for the account control",
      () => page.keyboard.press("Tab"),
      {
        selector: 'nav[aria-label="Console sections"] button',
        state: "focused",
      },
    ),
  );

  measurements.push(
    await measureFeedback(
      page,
      "Dashboard · Tab reaches the first count card",
      () => page.keyboard.press("Tab"),
      { selector: 'main a[href="/arrivals"]', state: "focused" },
    ),
  );

  measurements.push(
    await measureFeedback(
      page,
      "Dashboard · the account menu opens on a press",
      () =>
        page
          .locator('nav[aria-label="Console sections"] button')
          .first()
          .click(),
      { selector: '[role="menu"]', state: "visible" },
    ),
  );

  reportAndAssert(measurements);
});

test("the arrivals queue answers the keyboard inside the budget", async ({
  page,
}) => {
  await signIn(page);
  await goByHotkey(page, "a", "/arrivals");

  const rows = await tabIntoQueue(page);
  const second = await rowSelector(rows.nth(1));
  const measurements: Measurement[] = [];

  measurements.push(
    await measureFeedback(
      page,
      "Arrivals · the arrow key moves the queue's focus",
      () => page.keyboard.press("ArrowDown"),
      { selector: second, state: "focused" },
    ),
  );

  await expect(rows.nth(1)).toBeFocused();

  measurements.push(
    await measureFeedback(
      page,
      "Arrivals · Enter opens the check-in sequence",
      () => page.keyboard.press("Enter"),
      { selector: 'li[aria-current="step"]', state: "visible" },
    ),
  );

  // Abandoned rather than worked. What this spec is about is the console's
  // answer to the press; walking a guest into a room is `NFR-11`'s run.
  await page.keyboard.press("Escape");

  reportAndAssert(measurements);
});

test("the departures queue answers the keyboard inside the budget", async ({
  page,
}) => {
  await signIn(page);
  await goByHotkey(page, "e", "/departures");

  const rows = await tabIntoQueue(page);
  const second = await rowSelector(rows.nth(1));
  const measurements: Measurement[] = [];

  measurements.push(
    await measureFeedback(
      page,
      "Departures · the arrow key moves the queue's focus",
      () => page.keyboard.press("ArrowDown"),
      { selector: second, state: "focused" },
    ),
  );

  await expect(rows.nth(1)).toBeFocused();

  measurements.push(
    await measureFeedback(
      page,
      "Departures · Enter opens the checkout sequence",
      () => page.keyboard.press("Enter"),
      { selector: 'li[aria-current="step"]', state: "visible" },
    ),
  );

  await page.keyboard.press("Escape");

  reportAndAssert(measurements);
});

test("the bookings screen answers typing, a submission and a press inside the budget", async ({
  page,
}) => {
  await signIn(page);
  await goByHotkey(page, "b", "/bookings");

  const reference = page.locator('input[placeholder="BK-1042"]');

  await expect(reference).toBeVisible();

  const measurements: Measurement[] = [];

  measurements.push(
    await measureFeedback(
      page,
      "Bookings · / puts the caret in the search",
      () => page.keyboard.press("/"),
      { selector: 'input[placeholder="BK-1042"]', state: "focused" },
    ),
  );

  measurements.push(
    await measureFeedback(
      page,
      "Bookings · the search field echoes a keystroke",
      () => page.keyboard.press("B"),
      { selector: 'input[placeholder="BK-1042"]', state: "value", text: "B" },
    ),
  );

  // A reference alone is a valid search — `booking-search.ts` only refuses one
  // with nothing at all to go on.
  await page.keyboard.type("K-");

  measurements.push(
    await measureFeedback(
      page,
      "Bookings · the search form acknowledges a submission",
      () => page.keyboard.press("Enter"),
      { selector: "main button", state: "visible", text: "Back to today" },
    ),
  );

  measurements.push(
    await measureFeedback(
      page,
      "Bookings · the new-booking panel opens on a press",
      () => page.getByRole("button", { name: "New booking" }).click(),
      { selector: "main form label", state: "visible", text: "Arriving" },
    ),
  );

  reportAndAssert(measurements);
});

test("no operational screen plays an entrance animation", async ({ page }) => {
  await installAnimationWatch(page);
  await signIn(page);

  const sighted: string[] = [];

  for (const screen of [
    "/dashboard",
    "/arrivals",
    "/departures",
    "/bookings",
  ]) {
    await page.goto(screen);
    await expect(page.locator("main h1")).toBeVisible();
    // A queue draws once its data has arrived, and that commit is the moment an
    // entrance animation would play — so the screen is waited out to there
    // rather than to the load event, which happens long before it.
    await expect(page.locator("main [aria-busy]")).toHaveCount(0);
    // Then a window for the recorder to watch that commit settle. It has been
    // sampling every frame since before the document existed; this is only so
    // an animation that starts on the last commit has somewhere to be seen.
    await page.waitForTimeout(500);

    for (const sighting of await entranceAnimations(page)) {
      sighted.push(`${screen}: ${describeSighting(sighting)}`);
    }
  }

  expect(
    sighted,
    "NFR-04 forbids entrance animation on operational screens.",
  ).toEqual([]);
});

/**
 * Every measurement into the run's output, then the budget.
 *
 * Printed before it is asserted, and printed whether or not it passes: the
 * number is the evidence, and a run that only says "ok" leaves nobody able to
 * tell 12 ms of headroom from 140.
 */
function reportAndAssert(measurements: readonly Measurement[]): void {
  const line = (one: Measurement) => `${one.what} — ${one.ms.toFixed(1)} ms`;

  for (const one of measurements) {
    console.log(`  ${line(one)}`);
    test.info().annotations.push({ type: "feedback", description: line(one) });
  }

  const over = measurements.filter((one) => one.ms >= BUDGET_MS);

  expect(
    over.map(line),
    `NFR-04's budget is ${BUDGET_MS} ms. Measured: ${measurements.map(line).join("; ")}`,
  ).toEqual([]);
}

/** Tab until the named control holds focus, so a measurement starts from a
 *  known place without asserting how many stops precede it. */
async function tabUntilFocused(page: Page, selector: string): Promise<void> {
  for (let pressed = 0; pressed < 30; pressed += 1) {
    if ((await page.locator(`${selector}:focus`).count()) > 0) {
      return;
    }

    await page.keyboard.press("Tab");
  }

  throw new Error(`Thirty Tab presses never reached \`${selector}\`.`);
}

/** A queue row addressed by the booking it is, not by its position. The
 *  sequence a row opens is a `<tr>` of its own, so counting rows is a selector
 *  that stops being true the moment the screen is used. */
async function rowSelector(row: Locator): Promise<string> {
  const value = await row.getAttribute("data-roving-value");

  expect(value, "A queue row carries no identity.").not.toBeNull();

  return `tr[data-roving-value="${value}"]`;
}
