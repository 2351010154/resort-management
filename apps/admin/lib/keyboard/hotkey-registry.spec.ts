import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChordSource } from "./chord";
import {
  dispatchHotkey,
  registerHotkey,
  resetHotkeys,
} from "./hotkey-registry";

// The registry attaches its listener to `document` when one exists and skips it
// otherwise, so everything below drives `dispatchHotkey` directly. That is the
// whole of the behaviour worth asserting here — which binding a press reaches,
// and which gates stop it — and a DOM would only add a second thing that could
// be wrong about it.

type Press = ChordSource &
  Partial<Pick<KeyboardEvent, "repeat" | "isComposing" | "target">> & {
    preventDefault?: () => void;
  };

function press(key: string, over: Partial<Press> = {}): Press {
  return {
    key,
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...over,
  };
}

/** Stands in for the element a press landed on, read by property. */
function field(tagName: string, type?: string) {
  return { tagName, type } as unknown as EventTarget;
}

afterEach(() => {
  resetHotkeys();
});

describe("registerHotkey", () => {
  it("runs the handler for its chord and nothing else", () => {
    const handler = vi.fn();
    registerHotkey("mod+k", handler);

    expect(dispatchHotkey(press("k", { ctrlKey: true }))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    expect(dispatchHotkey(press("j", { ctrlKey: true }))).toBe(false);
    expect(dispatchHotkey(press("k"))).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("binds several chords to one handler", () => {
    const handler = vi.fn();
    registerHotkey(["mod+k", "/"], handler);

    expect(dispatchHotkey(press("k", { ctrlKey: true }))).toBe(true);
    expect(dispatchHotkey(press("/"))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("stops answering once unregistered", () => {
    const handler = vi.fn();
    const release = registerHotkey("mod+k", handler);

    release();

    expect(dispatchHotkey(press("k", { ctrlKey: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("releases every chord a multi-chord binding took", () => {
    const handler = vi.fn();
    registerHotkey(["mod+k", "/"], handler)();

    expect(dispatchHotkey(press("k", { ctrlKey: true }))).toBe(false);
    expect(dispatchHotkey(press("/"))).toBe(false);
  });

  it("survives being released twice", () => {
    // React invokes an effect cleanup twice in development. A second release
    // must not pop a binding that belongs to whatever registered after it.
    const outer = vi.fn();
    const release = registerHotkey("escape", vi.fn());

    release();
    registerHotkey("escape", outer);
    release();

    expect(dispatchHotkey(press("Escape"))).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  describe("when two things want the same chord", () => {
    it("gives it to the one registered last", () => {
      const screen = vi.fn();
      const dialog = vi.fn();
      registerHotkey("escape", screen);
      registerHotkey("escape", dialog);

      dispatchHotkey(press("Escape"));

      expect(dialog).toHaveBeenCalledTimes(1);
      expect(screen).not.toHaveBeenCalled();
    });

    it("gives it to the deeper surface, whichever registered first", () => {
      // The case registration order cannot express. React flushes a child's
      // effects before its parent's, so a screen that mounts with a surface
      // already open — /arrivals?checkin=BK-5107, an SSR-hydrated route, a
      // Suspense reveal — registers the *inner* binding first. Ordered by
      // recency alone, Escape would leave the screen instead of closing the
      // sequence, discarding a half-finished check-in.
      const screen = vi.fn();
      const sequence = vi.fn();
      registerHotkey("escape", sequence, { layer: 1 });
      registerHotkey("escape", screen, { layer: 0 });

      dispatchHotkey(press("Escape"));

      expect(sequence).toHaveBeenCalledTimes(1);
      expect(screen).not.toHaveBeenCalled();
    });

    it("falls back to recency among surfaces at the same depth", () => {
      const first = vi.fn();
      const second = vi.fn();
      registerHotkey("escape", first, { layer: 2 });
      registerHotkey("escape", second, { layer: 2 });

      dispatchHotkey(press("Escape"));

      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });

    it("returns the key to the shallower surface when the deep one closes", () => {
      const screen = vi.fn();
      registerHotkey("escape", screen, { layer: 0 });
      const closeSequence = registerHotkey("escape", vi.fn(), { layer: 1 });

      closeSequence();
      dispatchHotkey(press("Escape"));

      expect(screen).toHaveBeenCalledTimes(1);
    });

    it("skips a deeper binding that is gated to reach a shallower one that is not", () => {
      const deepGated = vi.fn();
      const shallowOpen = vi.fn();
      registerHotkey("mod+s", shallowOpen, {
        layer: 0,
        enableInFormField: true,
      });
      registerHotkey("mod+s", deepGated, { layer: 3 });

      expect(
        dispatchHotkey(
          press("s", { ctrlKey: true, target: field("INPUT", "text") }),
        ),
      ).toBe(true);
      expect(deepGated).not.toHaveBeenCalled();
      expect(shallowOpen).toHaveBeenCalledTimes(1);
    });

    it("hands it back when the inner one unregisters", () => {
      // The defect a single handler per chord would cause: the dialog closes
      // and the screen underneath is left with no escape route at all.
      const screen = vi.fn();
      registerHotkey("escape", screen);
      const closeDialog = registerHotkey("escape", vi.fn());

      closeDialog();
      dispatchHotkey(press("Escape"));

      expect(screen).toHaveBeenCalledTimes(1);
    });
  });
});

describe("dispatchHotkey", () => {
  it("prevents the browser's default by default", () => {
    registerHotkey("mod+k", vi.fn());
    const event = press("k", { ctrlKey: true });

    dispatchHotkey(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("leaves other document listeners alone unless asked to stop them", () => {
    // Radix's dismissable layers listen for Escape on the document themselves.
    // Off by default, a console binding and a Radix overlay both act on one
    // press; on, the press stops here.
    const stopPropagation = vi.fn();
    registerHotkey("escape", vi.fn());
    dispatchHotkey({ ...press("Escape"), stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();

    resetHotkeys();

    registerHotkey("escape", vi.fn(), { stopPropagation: true });
    dispatchHotkey({ ...press("Escape"), stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("leaves the default alone when asked to", () => {
    registerHotkey("mod+k", vi.fn(), { preventDefault: false });
    const event = press("k", { ctrlKey: true });

    dispatchHotkey(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores a held key repeating", () => {
    const handler = vi.fn();
    registerHotkey("mod+k", handler);

    expect(dispatchHotkey(press("k", { ctrlKey: true, repeat: true }))).toBe(
      false,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a press still assembling in an IME", () => {
    // Vietnamese input sends keydown for every keystroke of a composition, and
    // those belong to the IME rather than to the console.
    const handler = vi.fn();
    registerHotkey("d", handler);

    expect(dispatchHotkey(press("d", { isComposing: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  describe("while the operator is typing", () => {
    it("stays out of text inputs, textareas and selects", () => {
      const handler = vi.fn();
      registerHotkey("n", handler);

      expect(
        dispatchHotkey(press("n", { target: field("INPUT", "text") })),
      ).toBe(false);
      expect(dispatchHotkey(press("n", { target: field("TEXTAREA") }))).toBe(
        false,
      );
      expect(dispatchHotkey(press("n", { target: field("SELECT") }))).toBe(
        false,
      );
      expect(handler).not.toHaveBeenCalled();
    });

    it("stays out of a contenteditable", () => {
      registerHotkey("n", vi.fn());
      const target = { isContentEditable: true } as unknown as EventTarget;

      expect(dispatchHotkey(press("n", { target }))).toBe(false);
    });

    it("still fires on the inputs that are not text", () => {
      const handler = vi.fn();
      registerHotkey("n", handler);

      expect(
        dispatchHotkey(press("n", { target: field("INPUT", "checkbox") })),
      ).toBe(true);
      expect(
        dispatchHotkey(press("n", { target: field("INPUT", "button") })),
      ).toBe(true);
      expect(dispatchHotkey(press("n", { target: field("BUTTON") }))).toBe(
        true,
      );
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("fires anyway for a binding that opted in", () => {
      const handler = vi.fn();
      registerHotkey("mod+enter", handler, { enableInFormField: true });

      expect(
        dispatchHotkey(
          press("Enter", { ctrlKey: true, target: field("INPUT", "text") }),
        ),
      ).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("always lets Escape through", () => {
      // The console's escape route from any surface. The person who has just
      // typed into the wrong field is exactly who needs it.
      const handler = vi.fn();
      registerHotkey("escape", handler);

      expect(
        dispatchHotkey(press("Escape", { target: field("INPUT", "text") })),
      ).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("skips a gated binding to reach one underneath that is not gated", () => {
      const gated = vi.fn();
      const open = vi.fn();
      registerHotkey("mod+s", open, { enableInFormField: true });
      registerHotkey("mod+s", gated);

      expect(
        dispatchHotkey(
          press("s", { ctrlKey: true, target: field("INPUT", "text") }),
        ),
      ).toBe(true);
      expect(gated).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
    });
  });
});
