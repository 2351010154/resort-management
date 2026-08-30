import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  goByPalette,
  QUEUE_ROW,
  signIn,
  tabIntoQueue,
} from "./support/console-keyboard";
import { ensureArrivalsWaiting } from "./support/desk-provisioning";
import { sayTheMoneyArrivedByTransfer } from "./support/money-method";
import { describe, watchMouse } from "./support/mouse-watch";

/* `NFR-11` — a guest is walked into a room with no pointer at all.
 *
 * `docs/product-requirements.md` §NFR states the target as **0 mouse events end
 * to end**. This is the run that proves it and CI's `console-e2e` job is what
 * executes it; it is deliberately one test rather than several: the requirement is about a whole
 * check-in, and a suite that proved each control keyboard-reachable in isolation
 * would still miss the thing that actually strands an operator — a step that
 * drops focus on its way to the next one.
 *
 * So every press below goes through `page.keyboard`, which drives Chromium's
 * real input pipeline, and nothing anywhere calls `click()`. Where the test
 * needs to know something — which room is on offer, which stay the queue has
 * focus on — it reads the DOM, because reading is not an input device.
 *
 * The path is the one the screens document: `g a` to the queue, Tab into it,
 * arrows to a stay, Enter to open it, and Enter through each step of the
 * sequence. It writes: a guest is registered, a room is assigned, a deposit is
 * posted if one is owed, and a booking becomes `CHECKED_IN`. That is what
 * checking somebody in is, and a run that faked it would not be evidence.
 */

/** How many steps the sequence may take before the run gives up on it. Five is
 *  the whole of `sequenceSteps`; the margin is for a step that refuses once. */
const SEQUENCE_LIMIT = 8;

/** How far down the queue the run will walk before concluding the property has
 *  no room to put anybody in. That is a finding about the data, not about the
 *  keyboard, and the failure says so. The arrows wrap, so this is also what
 *  stops a full property from being walked forever. */
const QUEUE_ROWS_TO_VISIT = 25;

/** What happened to one stay: it was checked in, or it was left in the queue
 *  and why. `soldOut` separates the two ways a room step can fail — a type the
 *  board has nothing ready of, which is true of every other stay sold that type
 *  too, from rooms that were offered and refused, which is about these nights
 *  and this stay. */
type Outcome =
  | { readonly done: true }
  | { readonly done: false; readonly soldOut: boolean; readonly why: string };

test("a stay is checked in end to end without a single mouse event", async ({
  page,
}) => {
  // Two arrivals, because the run arrows between rows before it opens one, and
  // because a queue of exactly one leaves nothing to move on to when the
  // property cannot house the first. The property is asked for them through its
  // own routes — `support/desk-provisioning.ts` — rather than the run hoping the
  // seed left enough on the day it happens to be executed.
  await ensureArrivalsWaiting(2);

  const mouse = await watchMouse(page);
  const refusals = watchApiRefusals(page);

  await signIn(page);
  mouse.assertSilent("signing in");

  await goByPalette(page, "Arrivals", "/arrivals");
  mouse.assertSilent("reaching the arrivals queue");

  const queue = await tabIntoQueue(page);
  mouse.assertSilent("tabbing into the queue");

  // The arrows are what choose the stay. Down then up, so both directions are
  // exercised and the run lands on a row it can name.
  await page.keyboard.press("ArrowDown");
  await expect(queue.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(queue.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(queue.nth(1)).toBeFocused();
  mouse.assertSilent("choosing a stay with the arrow keys");

  // The stay that gets worked is the first one the property can actually house.
  // A queue whose next arrival was sold a type with no ready room left is an
  // ordinary afternoon, and a receptionist meeting one abandons it and takes the
  // next — with the same two keys, which is the whole point. What must not
  // happen is a run that calls that a keyboard failure.
  const passedOver: string[] = [];
  // Types the board has nothing ready of. Once a SUPERIOR has been refused for
  // want of a clean room, the next SUPERIOR in the queue will be too, and an
  // operator does not open it to find that out.
  const soldOut = new Set<string>();
  const tried = new Set<string>();
  let row = page.locator("tr[data-roving-value]").first();
  let admitted = false;

  for (let visited = 0; visited < QUEUE_ROWS_TO_VISIT && !admitted; visited++) {
    const bookingId = await focusedRowValue(page);
    row = page.locator(`tr[data-roving-value="${bookingId}"]`);
    const soldAs = await soldAsColumn(row);

    // The arrows wrap at the end of the queue, so a property with nothing free
    // would otherwise have the run opening the same stays over and over.
    if (soldOut.has(soldAs) || tried.has(bookingId)) {
      await page.keyboard.press("ArrowDown");
      continue;
    }

    tried.add(bookingId);

    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    mouse.assertSilent("opening the check-in");

    const outcome = await workTheSequence(
      page,
      mouse.assertSilent.bind(mouse),
      refusals,
    );

    if (outcome.done) {
      admitted = true;
      break;
    }

    if (outcome.soldOut) {
      soldOut.add(soldAs);
    }

    passedOver.push(`${soldAs} ${bookingId}: ${outcome.why}`);

    // Escape abandons the sequence and hands focus back to the row it was
    // opened from, so the arrow moves on to the next stay.
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await page.keyboard.press("ArrowDown");
    mouse.assertSilent("moving on to the next arrival");
  }

  expect(
    admitted,
    `No arrival in the queue could be given a room, so no check-in was walked. ${passedOver.join("; ")}`,
  ).toBe(true);

  // The stay is in the building: its row has left the queue of people waiting
  // to be checked in.
  await expect(
    row,
    "The check-in finished but the stay is still in the arrivals queue.",
  ).toHaveCount(0);

  // And the operator is back where the next arrival is worked from, without
  // having reached for anything. A sequence that dropped focus on `<body>` here
  // is a keyboard-first screen that has quietly become unusable.
  await expect(page.locator(`${QUEUE_ROW}:focus`)).toHaveCount(1);

  const stray = mouse.pointerEvents();

  expect(
    stray.map(describe),
    "NFR-11 requires zero mouse events across the whole check-in.",
  ).toEqual([]);
  expect(stray).toHaveLength(0);
});

/** What the stay was sold as — the queue's third column. */
async function soldAsColumn(row: Locator): Promise<string> {
  return ((await row.locator("td").nth(2).textContent()) ?? "").trim();
}

async function focusedRowValue(page: Page): Promise<string> {
  const value = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-roving-value"),
  );

  expect(value, "No queue row has focus.").not.toBeNull();

  return value as string;
}

/**
 * The step the sequence is showing, or null once it has closed.
 *
 * One evaluation, and that is the whole point of it. Counting the trail and
 * then reading it is two round trips with the sequence's own lifetime in
 * between: the trail is unmounted the instant the check-in succeeds, and a
 * locator read whose element has gone since the count waits for it to come
 * back — with no action timeout configured, forever. That turned a check-in the
 * API had already answered `200` into "the Check in step did not advance", the
 * poll below reporting its own timeout while the queue behind it had already
 * lost the row. Reading the DOM once cannot land in that gap.
 *
 * `textContent` and not `innerText`: the trail is set in small caps by a
 * `uppercase` rule, and rendered text would have this comparing "GUEST" against
 * a label the component actually carries as "Guest".
 */
async function currentStep(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector('li[aria-current="step"]')?.textContent?.trim() ??
      null,
  );
}

/**
 * Enter, Tab and typing, until the guest is in the room.
 *
 * Driven by which step is showing rather than by a fixed script, because the
 * sequence's own length is decided by its answers: a folio with nothing
 * outstanding drops the deposit step. The document step is always shown — a
 * returning guest's card is read onto the record they already have, which is
 * `FR-GST-02`'s transcription — so this run answers it whether the guest was
 * registered here or found.
 */
async function workTheSequence(
  page: Page,
  assertSilent: (during: string) => void,
  refusals: () => readonly string[],
): Promise<Outcome> {
  const taken: string[] = [];

  for (let step = 0; step < SEQUENCE_LIMIT; step += 1) {
    const showing = await currentStep(page);

    if (showing === null) {
      expect(
        taken,
        "The sequence closed without the review step being answered.",
      ).toContain("Check in");

      // Which steps this check-in actually consisted of, into the run's output.
      // The sequence's length is decided by its own answers — a folio with
      // nothing outstanding drops the deposit step — so a run that reported only
      // "ok" would leave nobody able to tell which of them were demonstrated.
      const walked = taken.join(" → ");

      console.log(`  Check-in walked by keyboard: ${walked}`);
      test.info().annotations.push({ type: "sequence", description: walked });

      return { done: true };
    }

    taken.push(showing);

    switch (showing) {
      case "Guest":
        await nameANewGuest(page);
        break;
      case "Document":
        await takeTheParticulars(page);
        break;
      case "Room": {
        const room = await assignARoom(page);

        if (room !== null) {
          return room;
        }

        break;
      }
      case "Deposit":
        // The two text fields arrive filled and the method does not, which is
        // the one thing on this step no default may answer. The departures
        // sequence's balance step asks it through the same control, so the keys
        // that answer it are shared rather than written out twice.
        await sayTheMoneyArrivedByTransfer(page);
        break;
      case "Check in":
        // The review step has no field of its own — what it asks for is the
        // press — so the sequence puts focus on the confirming button. Asserted
        // rather than assumed: a step that arrives with focus somewhere else
        // leaves the operator with nothing Enter does, which is exactly the
        // failure NFR-11 exists to catch, and a bare Enter here would report it
        // as a mysterious stall instead.
        await expect(
          page.getByRole("button", { name: "Check in" }),
          "The review step did not place focus on its confirming button.",
        ).toBeFocused();
        await page.keyboard.press("Enter");
        break;
      default:
        throw new Error(`The sequence showed an unknown step: ${showing}`);
    }

    assertSilent(`the ${showing.toLowerCase()} step`);

    try {
      await expect
        .poll(() => currentStep(page), { timeout: 20_000 })
        .not.toBe(showing);
    } catch (failure) {
      // Read after the wait rather than before it: what the step is complaining
      // about, and what the API refused, both arrive from a round trip.
      throw new Error(
        `The ${showing} step did not advance. ${await problemText(page)} ${apiText(refusals())}`,
        { cause: failure },
      );
    }
  }

  throw new Error(
    `The sequence did not finish in ${SEQUENCE_LIMIT} steps: ${taken.join(" → ")}`,
  );
}

/**
 * A person the property has never seen, registered by typing their name.
 *
 * Unique on purpose. The lookup offers matching guests above the "register this
 * one" row, and a name the property already holds would make which row is
 * highlighted a fact about the database rather than about the keyboard.
 */
async function nameANewGuest(page: Page): Promise<void> {
  const name = `E2E Keyboard ${Date.now()}`;

  await page.keyboard.type(name);

  const register = page.getByRole("option", { name: /^Register/ });

  await expect(
    register,
    "The lookup offered no way to register the typed name.",
  ).toHaveCount(1);

  // Arrowed to rather than assumed to be first. The lookup is debounced and may
  // still put a matching guest above this row, and the arrows are how an
  // operator gets past one.
  for (let moved = 0; moved < 20; moved += 1) {
    if ((await register.getAttribute("aria-selected")) === "true") {
      await page.keyboard.press("Enter");
      return;
    }

    await page.keyboard.press("ArrowDown");
  }

  throw new Error("Twenty arrow presses never highlighted the register row.");
}

/** The document step: the scanner is a keyboard, so this is typing. */
async function takeTheParticulars(page: Page): Promise<void> {
  // The name arrives already filled from the step before it. Tab reaches the
  // number, which is what a desk actually adds here.
  await page.keyboard.press("Tab");
  await page.keyboard.type(cccdNumber());
  // Enter in a field of the step's form finishes the step — no button to find.
  await page.keyboard.press("Enter");
}

/** Twelve digits nobody else in the database is holding. The column carries a
 *  unique index, so a fixed number would pass once and refuse ever after. */
function cccdNumber(): string {
  return `${Date.now()}`.slice(-12).padStart(12, "9");
}

/**
 * The room step: type to narrow the list, then take what is left.
 *
 * Tries the offered rooms in turn rather than only the first, because the
 * console's own design says it must: `check-in-sequence.tsx` assigns the room at
 * this control precisely so that "a room somebody else took thirty seconds ago"
 * is refused here, where the operator picks another. The board this list is
 * drawn from knows a room is ready and unoccupied; it does not know the room is
 * held by another stay across these nights, and the API does. Picking another is
 * what a receptionist does with that refusal, and it costs no pointer.
 */
async function assignARoom(
  page: Page,
): Promise<Extract<Outcome, { done: false }> | null> {
  const options = page.getByRole("option");
  // The control's own answer to an empty list, which names why rather than
  // saying the list is empty.
  const nothingFree = page.getByText(/^No ready /);

  await expect(
    options.first().or(nothingFree),
    "The room step showed neither a room nor a reason there is none.",
  ).toBeVisible();

  if (await nothingFree.isVisible()) {
    return {
      done: false,
      soldOut: true,
      why: await nothingFree.innerText(),
    };
  }

  // The rows' own labels, not the whole rows: what follows each is the floor and
  // the housekeeping state, which are not what gets typed.
  const offered = await page
    .locator('[role="option"] > span:first-child')
    .allTextContents();

  for (const number of offered.map((one) => one.trim())) {
    // Select what is in the field and type over it. The refused attempt left its
    // number behind, and a desk trying the next room types over it too.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(number);

    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");

    if (await leftTheStep(page, "Room")) {
      return null;
    }
  }

  // Every room on offer was refused by the API — each held by another stay
  // across these nights. That is about this stay's dates, not about the type, so
  // the next arrival sold the same type is still worth opening.
  return {
    done: false,
    soldOut: false,
    why: `every room offered was refused (${offered.join(", ")})`,
  };
}

/** Whether the sequence has moved off `step` within a round trip's worth of
 *  time. A refusal leaves it exactly where it was, which is the answer. */
async function leftTheStep(page: Page, step: string): Promise<boolean> {
  try {
    await expect
      .poll(() => currentStep(page), { timeout: 8_000 })
      .not.toBe(step);
    return true;
  } catch {
    return false;
  }
}

/** Whatever the sequence is complaining about, for a failure message. */
async function problemText(page: Page): Promise<string> {
  const problem = page.locator("p.text-destructive");

  return (await problem.count()) === 0
    ? "The screen reported no problem."
    : `The screen says: ${await problem.first().innerText()}`;
}

/**
 * Every refusal the API sent back, kept for the failure message.
 *
 * The console reports a refused write through a toast that dismisses itself, so
 * by the time a step's timeout expires the only account of why is gone. This
 * keeps it: a check-in that stalls is nearly always the API declining a write,
 * and a run that could only say "the step did not advance" would send the next
 * person to the trace to find out something the response already said.
 */
function watchApiRefusals(page: Page): () => readonly string[] {
  const refused: { line: string }[] = [];

  page.on("response", (response) => {
    if (response.status() < 400) {
      return;
    }

    // Recorded now and enriched when the body arrives. Reading the body is
    // asynchronous, and a refusal that only appeared in the list once its text
    // had been fetched would be missing from exactly the failure it explains.
    const entry = { line: `${response.status()} ${response.url()}` };
    refused.push(entry);

    void response
      .text()
      .then((body) => {
        entry.line += ` — ${body.slice(0, 300)}`;
      })
      .catch(() => {
        entry.line += " — (no body)";
      });
  });

  return () => refused.map((entry) => entry.line);
}

function apiText(refused: readonly string[]): string {
  return refused.length === 0
    ? "The API refused nothing."
    : `The API refused: ${refused.join(" | ")}`;
}
