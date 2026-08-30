import type { Page } from "@playwright/test";

/* Proof that no pointer was used, taken from the browser rather than asserted.
 *
 * `NFR-11` is written as "**0** mouse events end to end", so what this records
 * is mouse events — captured on the window before anything in the console can
 * see them, and counted in Node so the tally survives a navigation. A page-local
 * counter would be reset by every `addInitScript` re-run and would quietly
 * forget whatever happened on the login screen.
 *
 * ## What counts, and why a click sometimes does not
 *
 * `mousedown` and `mouseup` are only ever produced by a pointer. `mousemove` is
 * counted only while a button is held, because a bare move is the cursor
 * resting somewhere the page happens to scroll under — it is not an operator
 * driving the console with a mouse.
 *
 * `click` is the one that needs a rule, and it needs two.
 *
 * **A browser fires a click for keyboard activation too**: Space or Enter on a
 * button, and the implicit submission of a form with a submit button in it —
 * which is exactly how every step of the check-in sequence is finished. Those
 * carry `detail === 0` and no pointer type, because no pointer produced them; a
 * click from a mouse carries `detail >= 1` and `pointerType === "mouse"`.
 *
 * **And a script may dispatch one.** Radix's radio group answers an arrow key by
 * calling `click()` on the hidden input it keeps for the form, which arrives as
 * a plain `Event` named "click" — no coordinates, no button, no pointer, and
 * `detail` and `buttons` simply absent. It is not a `MouseEvent` at all, so the
 * `pointerType` fallback below would read it as a mouse and the requirement
 * would be unsatisfiable by any keyboard-operable radio group. `isTrusted` is
 * the browser's own statement about which of the two an event is: false for
 * anything a script dispatched, true for everything a device produced —
 * including the synthesised input Playwright drives Chromium with, which is why
 * a real pointer in a run is still caught.
 *
 * So the rule is: produced by a device, and pointer-origin. Everything else is
 * still recorded, for the run that needs to see it.
 */

export interface MouseEventRecord {
  readonly type: string;
  readonly target: string;
  readonly detail: number;
  readonly buttons: number;
  readonly pointerType: string;
  /** The browser's own answer to "did a device produce this, or a script?". */
  readonly trusted: boolean;
  /** Whether a pointing device produced it — see the note above. */
  readonly fromPointer: boolean;
}

export interface MouseWatch {
  /** Pointer-driven events, in the order they arrived. */
  pointerEvents(): readonly MouseEventRecord[];
  /** Everything seen, including the keyboard's own synthetic clicks. */
  allEvents(): readonly MouseEventRecord[];
  /**
   * Throws on the first pointer-driven event, naming it. Called between the
   * steps of a sequence so a stray pointer fails where it happened rather than
   * at the end of a run that has already moved on.
   */
  assertSilent(during: string): void;
}

/** Starts recording. Call before the first navigation. */
export async function watchMouse(page: Page): Promise<MouseWatch> {
  const seen: MouseEventRecord[] = [];

  await page.exposeFunction(
    "__marivaRecordMouseEvent",
    (record: MouseEventRecord) => {
      seen.push(record);
    },
  );

  await page.addInitScript(() => {
    const name = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) {
        return "(not an element)";
      }

      const id = target.id === "" ? "" : `#${target.id}`;
      const label = target.getAttribute("aria-label");

      return `${target.tagName.toLowerCase()}${id}${
        label === null ? "" : `[aria-label="${label}"]`
      }`;
    };

    const record = (event: MouseEvent): void => {
      // A bare move is the cursor sitting still while the page moves under it.
      if (event.type === "mousemove" && event.buttons === 0) {
        return;
      }

      const pointerType =
        event instanceof PointerEvent ? event.pointerType : "mouse";

      (
        window as unknown as {
          __marivaRecordMouseEvent(entry: unknown): void;
        }
      ).__marivaRecordMouseEvent({
        type: event.type,
        target: name(event.target),
        detail: event.detail,
        buttons: event.buttons,
        pointerType,
        trusted: event.isTrusted,
        fromPointer:
          event.isTrusted &&
          (event.type !== "click" ||
            event.detail > 0 ||
            pointerType === "mouse"),
      });
    };

    for (const type of ["click", "mousedown", "mouseup", "mousemove"]) {
      // Capture phase on the window, so the console cannot stop a press from
      // being counted by handling it first.
      window.addEventListener(type, record as EventListener, {
        capture: true,
        passive: true,
      });
    }
  });

  const pointerEvents = () => seen.filter((entry) => entry.fromPointer);

  return {
    pointerEvents,
    allEvents: () => seen,

    assertSilent(during) {
      const [first] = pointerEvents();

      if (first === undefined) {
        return;
      }

      throw new Error(
        `A mouse event was produced during ${during}: ${describe(first)}`,
      );
    },
  };
}

/** One event as a line a failure message can carry. */
export function describe(entry: MouseEventRecord): string {
  return `${entry.type} on ${entry.target} (detail ${entry.detail}, buttons ${entry.buttons}, pointerType "${entry.pointerType}", trusted ${entry.trusted})`;
}
