import { expect, type Page } from "@playwright/test";

/* How the money arrived, answered with nothing but keys.
 *
 * The arrivals sequence's deposit step and the departures sequence's balance
 * step ask one question through one control — `lib/desk-payment.ts` owns the
 * list of methods and `MethodChoice` draws it in both — so the run works it
 * here rather than in two copies that agree only until somebody edits one. It
 * was two copies, and they had both gone stale in the same way.
 *
 * ## Why this step is the one worth a helper
 *
 * It is the only control in either sequence with no default. Every other step
 * can be finished by a press the operator was going to make anyway; this one
 * cannot, because an append-only ledger cannot be told afterwards which of the
 * two a line was. So the step asks, and a keyboard-only desk has to be able to
 * answer — which is exactly the thing `NFR-11` is about.
 *
 * ## What the keys do
 *
 * Both steps arrive with the amount filled and focused and the line beside it
 * filled too, so two Tabs is the way past both and onto the group. A radio group
 * is one Tab stop: focus lands on a method, and the arrows are how an operator
 * reaches the one they were actually paid by. In a radio group the arrow chooses
 * as it moves — WAI-ARIA's pattern rather than this console's invention — and
 * Space is what chooses when there was nowhere to move to. Both are accepted
 * below, because which of them applies is a fact about how many methods the
 * property currently offers rather than about the keyboard.
 *
 * The desk is settled by bank transfer and not by whichever method comes first,
 * deliberately: `folio.postPayment` refuses `CASH` from an operator with no
 * drawer open, and the console answers that refusal by offering to open one in
 * place. That is a worthwhile run and it is not this one — it would prove the
 * drawer flow, and what is being proved here is that a method can be chosen at
 * all without a pointer.
 */

/** How far the run will walk the group before concluding the arrows do not move
 *  within it. Above any number of methods the contract could plausibly grow. */
const ARROWS_ACROSS_THE_GROUP = 6;

/**
 * How long a key is held down, in milliseconds.
 *
 * Not decoration and not a sleep. Radix moves focus inside a radio group from a
 * `setTimeout` scheduled on `keydown`, and the item checks itself on arrival
 * only while an arrow is *still down* — it keeps a ref that `keyup` clears. A
 * press with no duration, which is what `page.keyboard.press` sends by default,
 * lets `keyup` land before the deferred focus runs: focus moves and nothing is
 * chosen. Measured on this console, arrowing from `CASH` to `BANK_TRANSFER`:
 * **0 of 15** presses chose the method at 0 ms, **12 of 12** at 50 ms.
 *
 * It is a keystroke no operator can produce. A human press is tens of
 * milliseconds and even a USB keyboard's report interval is longer than a task
 * queue turn, so any duration at all lets the timer go first. So the run holds
 * the key for as long as a person does. Making the input realistic is the
 * correction; loosening what is asserted about the result would have hidden the
 * one thing this control has to do.
 */
const KEY_HELD_MS = 50;

/**
 * Two Tabs onto the method group, then the keys that answer it.
 *
 * Leaves the step submitted: Enter finishes it from the group as it does from
 * every field of every other step — WAI-ARIA leaves a radio group inert to
 * Enter, and `MethodChoice` puts the press back.
 */
export async function sayTheMoneyArrivedByTransfer(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  await expect(
    page.locator('[role="radio"]:focus'),
    "Tab from the step's fields never reached how the money arrived.",
  ).toHaveCount(1);

  for (const method of await page.getByRole("radio").all()) {
    await expect(
      method,
      "A method arrived already chosen, which is a default wearing a radio button.",
    ).not.toBeChecked();
  }

  const transfer = page.getByRole("radio", { name: "Bank transfer" });

  // Arrowed to rather than assumed to be where focus landed. Which method the
  // group opens on is `postPaymentInput`'s ordering, and a run that encoded it
  // would be asserting the contract's list order from a keyboard test.
  for (let moved = 0; moved < ARROWS_ACROSS_THE_GROUP; moved += 1) {
    if (await transfer.evaluate((radio) => radio === document.activeElement)) {
      break;
    }

    await page.keyboard.press("ArrowRight", { delay: KEY_HELD_MS });
  }

  await expect(
    transfer,
    "The arrows never reached the method the desk was paid by.",
  ).toBeFocused();

  // The arrow chooses as it moves, so a group with a second method to walk to is
  // already answered here. A group with one method has nowhere to walk, and then
  // Space is the key the operator presses on purpose.
  if (!(await transfer.isChecked())) {
    await page.keyboard.press("Space", { delay: KEY_HELD_MS });
  }

  await expect(
    transfer,
    "Neither the arrow that reached the method nor Space chose it, so the group cannot be answered by keys at all.",
  ).toBeChecked();

  await page.keyboard.press("Enter");
}
