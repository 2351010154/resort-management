import type { Page } from "@playwright/test";

/* How long the console takes to admit that it heard a key or a press.
 *
 * `NFR-04` is "< 150 ms" of interaction feedback, and the honest reading of
 * that is *input to the first frame the operator can see the answer in* — not
 * to the handler returning, and not to the network. So both ends of the
 * measurement are taken inside the browser, on one clock:
 *
 * - **The start** is the event's own `timeStamp`, read in a capture-phase
 *   listener on the window. It is a `DOMHighResTimeStamp` on the same origin as
 *   `performance.now()`, and it is the moment the browser created the event —
 *   earlier and truer than anything Node can observe across the wire.
 * - **The end** is the `requestAnimationFrame` timestamp of the first frame in
 *   which the acknowledgement is on screen. A rAF callback runs after the DOM
 *   is committed and before that frame is painted, so it is the frame the
 *   operator sees the change in.
 *
 * Measuring from Node instead would be measuring the CDP round trip, which is
 * neither the console's latency nor a constant.
 */

/** What "the console answered" looks like on screen for one interaction. */
export interface Acknowledgement {
  readonly selector: string;
  readonly state: "visible" | "gone" | "focused" | "value";
  /** Narrows `visible` to an element whose text carries this, and `value` to a
   *  field whose contents carry it. */
  readonly text?: string;
}

export interface Measurement {
  readonly what: string;
  /** Input event to the first frame carrying the answer. */
  readonly ms: number;
}

interface ProbeResult {
  readonly inputAt: number;
  readonly paintedAt: number;
  readonly timedOut: boolean;
}

interface Probe {
  inputAt: number | null;
  result: ProbeResult | null;
  watch(want: Acknowledgement, deadlineMs: number): void;
}

declare global {
  interface Window {
    __marivaFeedbackProbe?: Probe;
  }
}

/** How long one acknowledgement may take before the run stops waiting for it.
 *  Far above the budget, because a measurement over it is the finding. */
const WATCH_TIMEOUT_MS = 10_000;

/** Installs the probe for every document this page loads. Call before the
 *  first navigation. */
export async function installFeedbackProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const matches = (want: {
      selector: string;
      state: string;
      text?: string;
    }): boolean => {
      const found = [...document.querySelectorAll(want.selector)];

      if (want.state === "gone") {
        return found.length === 0;
      }

      if (want.state === "focused") {
        return document.activeElement?.matches(want.selector) === true;
      }

      if (want.state === "value") {
        // The property and not the attribute: a controlled React field writes
        // what the operator typed onto the property, and the attribute keeps
        // saying whatever the markup shipped with.
        return found.some(
          (element) =>
            element instanceof HTMLInputElement &&
            element.value === (want.text ?? ""),
        );
      }

      return found.some(
        (element) =>
          element.getClientRects().length > 0 &&
          (want.text === undefined ||
            (element.textContent ?? "").includes(want.text)),
      );
    };

    const probe: Probe = {
      inputAt: null,
      result: null,

      watch(want, deadlineMs) {
        probe.inputAt = null;
        probe.result = null;

        const givesUpAt = performance.now() + deadlineMs;

        const frame = (paintedAt: number): void => {
          if (probe.inputAt !== null && matches(want)) {
            probe.result = {
              inputAt: probe.inputAt,
              paintedAt,
              timedOut: false,
            };
            return;
          }

          if (performance.now() > givesUpAt) {
            probe.result = {
              inputAt: probe.inputAt ?? 0,
              paintedAt,
              timedOut: true,
            };
            return;
          }

          requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
      },
    };

    window.__marivaFeedbackProbe = probe;

    // Capture phase, so the moment recorded is the browser's and not whatever
    // is left after the console's own handlers have run.
    for (const type of ["keydown", "pointerdown", "click", "submit"]) {
      window.addEventListener(
        type,
        (event) => {
          if (probe.result === null && probe.inputAt === null) {
            probe.inputAt = event.timeStamp;
          }
        },
        { capture: true, passive: true },
      );
    }
  });
}

/**
 * One interaction, measured.
 *
 * The watch is armed in an awaited round trip *before* the act, so the frame
 * loop is already running when the key is pressed. Arming afterwards would
 * charge the console for however long the test runner took to get back to it.
 */
export async function measureFeedback(
  page: Page,
  what: string,
  act: () => Promise<void>,
  until: Acknowledgement,
): Promise<Measurement> {
  await page.evaluate(
    ({ want, deadline }) => {
      const probe = window.__marivaFeedbackProbe;

      if (probe === undefined) {
        throw new Error("The feedback probe is not installed on this page.");
      }

      probe.watch(want, deadline);
    },
    { want: until, deadline: WATCH_TIMEOUT_MS },
  );

  await act();

  const handle = await page.waitForFunction(
    () => window.__marivaFeedbackProbe?.result ?? null,
    undefined,
    { timeout: WATCH_TIMEOUT_MS + 5_000, polling: "raf" },
  );

  const result = (await handle.jsonValue()) as ProbeResult;

  if (result.timedOut) {
    throw new Error(
      `${what}: the console never showed ${describeWant(until)} — no acknowledgement to measure.`,
    );
  }

  // Floored at zero. A frame's `requestAnimationFrame` timestamp is the moment
  // that frame began, and input for the frame is dispatched after it — so an
  // answer committed in the very same frame as the keystroke reads a fraction of
  // a millisecond negative. That is "instant", and reporting it as −0.1 ms would
  // only make a reader distrust the number.
  return { what, ms: Math.max(0, result.paintedAt - result.inputAt) };
}

function describeWant(want: Acknowledgement): string {
  const text = want.text === undefined ? "" : ` carrying “${want.text}”`;

  return `\`${want.selector}\` ${want.state}${text}`;
}
