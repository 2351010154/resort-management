import { expect, type Page, test } from "@playwright/test";

import {
  goByPalette,
  QUEUE_ROW,
  signIn,
  tabIntoQueue,
} from "./support/console-keyboard";
import { ensureDeparturesOwing } from "./support/desk-provisioning";
import { sayTheMoneyArrivedByTransfer } from "./support/money-method";
import { describe, watchMouse } from "./support/mouse-watch";

/* A stay is checked out with no pointer at all.
 *
 * `checkout-sequence.tsx` states that its keyboard contract is "identical to the
 * arrivals sequence, deliberately — the desk works both in one shift", and
 * `nfr-11-keyboard-checkin.spec.ts` is the run that holds the arrivals half to
 * it. This is the other half, and it exists because the checkout has a control
 * the check-in's own version of the step shares and nothing else in the console
 * does: how the money arrived, which has no default and therefore cannot be
 * answered by a press the operator was going to make anyway.
 *
 * So the run works the balance step the way a desk works it — Tab to the
 * methods, arrows between them, Enter to post, in `support/money-method.ts`
 * where the arrivals sequence's identical step reads it too — and it works a
 * stay that actually owes something, because a settled account skips that step
 * and would leave the run proving nothing about it. What it owes is provisioned
 * rather than hoped for; `support/desk-provisioning.ts` says why.
 *
 * Every press goes through `page.keyboard`, and nothing anywhere calls
 * `click()`. Where the run needs to know something it reads the DOM, because
 * reading is not an input device.
 */

/** How far down the queue the run will walk before concluding the property has
 *  nobody leaving with a balance. The arrows wrap, so this is also what stops a
 *  fully settled queue from being walked forever. */
const QUEUE_ROWS_TO_VISIT = 25;

test("a stay with a balance is checked out without a single mouse event", async ({
  page,
}) => {
  // Two departures with something still to collect, put there through the desk's
  // own routes before the run opens the screen. Without them the run depended on
  // the seeded property happening to have somebody leaving today who had not
  // already paid, which on an ordinary date it does not —
  // `support/desk-provisioning.ts` carries the argument.
  //
  // Two and not one, because the last assertion below is about where focus goes
  // when a stay leaves the queue. A queue of exactly one has nowhere honest to
  // put it — `departureAfter` returns null and says so — and asserting against
  // that would be asserting the console does something it deliberately does not.
  await ensureDeparturesOwing(2);

  const mouse = await watchMouse(page);

  await signIn(page);
  await goByPalette(page, "Departures", "/departures");

  // One Tab stop for the whole list, and it returns with a row focused.
  await tabIntoQueue(page);
  mouse.assertSilent("reaching the departures queue");

  const passedOver: string[] = [];
  const tried = new Set<string>();
  let row = page.locator(QUEUE_ROW).first();
  let settled = false;

  for (let visited = 0; visited < QUEUE_ROWS_TO_VISIT && !settled; visited++) {
    const bookingId = await focusedRowValue(page);

    row = page.locator(`tr[data-roving-value="${bookingId}"]`);

    // The arrows wrap at the end of the queue, so a morning where everybody has
    // already paid would otherwise have the run opening the same stays forever.
    if (tried.has(bookingId)) {
      await page.keyboard.press("ArrowDown");
      continue;
    }

    tried.add(bookingId);

    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    mouse.assertSilent("opening the checkout");

    // The charges step arrives with its confirming press focused — it has no
    // field of its own, so a step that focused something else would leave the
    // operator with nothing Enter does. The words on it say whether this stay
    // owes anything, which is the same answer that decides whether the balance
    // step exists at all.
    const takeTheBalance = page.getByRole("button", {
      name: "Take the balance",
    });
    const chargesAgreed = page.getByRole("button", { name: "Charges agreed" });

    await expect(
      takeTheBalance.or(chargesAgreed),
      "The charges step showed neither of its two confirming presses.",
    ).toBeFocused();

    if (await chargesAgreed.isVisible()) {
      // Nothing to collect, so this stay cannot exercise the method choice.
      // Escape hands focus back to the row it was opened from.
      passedOver.push(`${bookingId}: the account was already settled`);
      await page.keyboard.press("Escape");
      await expect(row).toBeFocused();
      await page.keyboard.press("ArrowDown");
      mouse.assertSilent("moving on to the next departure");
      continue;
    }

    await page.keyboard.press("Enter");
    await expect
      .poll(() => currentStep(page), { timeout: 20_000 })
      .toBe("Balance");
    mouse.assertSilent("agreeing the charges");

    // The amount arrives filled with the whole of what the account is short and
    // the line beside it is filled too. What is not filled is how the money
    // arrived, and nothing may fill it: an append-only ledger cannot be told
    // afterwards which of the two a line was, so the step asks and this run
    // answers with keys.
    await sayTheMoneyArrivedByTransfer(page);
    mouse.assertSilent("posting the balance");

    try {
      await expect
        .poll(() => currentStep(page), { timeout: 20_000 })
        .toBe("Check out");
    } catch (failure) {
      // Read after the wait rather than before it: what the step is complaining
      // about arrives from a round trip.
      throw new Error(
        `The balance step did not post. ${await problemText(page)}`,
        { cause: failure },
      );
    }

    settled = true;
  }

  expect(
    settled,
    `No departure in the queue had a balance to collect, so the method choice was never worked. ${passedOver.join("; ")}`,
  ).toBe(true);

  // The last step has no field of its own either, and the same rule applies to
  // where its focus is.
  const closeAndCheckOut = page.getByRole("button", {
    name: "Close and check out",
  });

  await expect(
    closeAndCheckOut,
    "The settlement step did not place focus on its confirming button.",
  ).toBeFocused();

  await page.keyboard.press("Enter");

  // The stay is over: its row has left the queue of people leaving today.
  await expect(
    row,
    "The checkout finished but the stay is still in the departures queue.",
  ).toHaveCount(0);

  // And the operator is back where the next departure is worked from, without
  // having reached for anything.
  await expect(page.locator(`${QUEUE_ROW}:focus`)).toHaveCount(1);

  const stray = mouse.pointerEvents();

  expect(
    stray.map(describe),
    "A checkout is worked with no pointer at all.",
  ).toEqual([]);
  expect(stray).toHaveLength(0);
});

/** Which stay the queue has focus on. */
async function focusedRowValue(page: Page): Promise<string> {
  const value = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-roving-value"),
  );

  expect(value, "No queue row has focus.").not.toBeNull();

  return value as string;
}

/** The step the sequence is showing, or null once it has closed. One
 *  evaluation, for the reason the check-in run gives about its own: the trail is
 *  unmounted the instant the checkout succeeds, and a count followed by a read
 *  can land in that gap. */
async function currentStep(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector('li[aria-current="step"]')?.textContent?.trim() ??
      null,
  );
}

/** Whatever the sequence is complaining about, for a failure message. */
async function problemText(page: Page): Promise<string> {
  const problem = page.locator("p.text-destructive");

  return (await problem.count()) === 0
    ? "The screen reported no problem."
    : `The screen says: ${await problem.first().innerText()}`;
}
