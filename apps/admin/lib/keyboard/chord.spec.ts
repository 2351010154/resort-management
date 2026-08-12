import { describe, expect, it } from "vitest";

import { type ChordSource, eventChordIds, hotkeyId, parseChord } from "./chord";

/** A key press, with the flags nobody set defaulted to off. */
function press(key: string, over: Partial<ChordSource> = {}): ChordSource {
  return {
    key,
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...over,
  };
}

describe("parseChord", () => {
  it("resolves mod to the platform's primary modifier", () => {
    expect(parseChord("mod+k", "apple")).toMatchObject({
      key: "k",
      meta: true,
      ctrl: false,
    });
    expect(parseChord("mod+k", "other")).toMatchObject({
      key: "k",
      ctrl: true,
      meta: false,
    });
  });

  it("puts a chord under one id however the modifiers are ordered", () => {
    expect(hotkeyId("shift+alt+k", "other")).toBe(
      hotkeyId("alt+shift+k", "other"),
    );
  });

  it("treats mod and the platform's own modifier as the same binding", () => {
    expect(hotkeyId("mod+k", "apple")).toBe(hotkeyId("meta+k", "apple"));
    expect(hotkeyId("mod+k", "other")).toBe(hotkeyId("ctrl+k", "other"));
    // And keeps them apart on the platform where they differ.
    expect(hotkeyId("mod+k", "apple")).not.toBe(hotkeyId("ctrl+k", "apple"));
  });

  it("accepts the abbreviations a person actually writes", () => {
    expect(parseChord("esc", "other").key).toBe("escape");
    expect(parseChord("up", "other").key).toBe("arrowup");
    expect(parseChord("cmd+return", "other")).toMatchObject({
      key: "enter",
      meta: true,
    });
    expect(parseChord("mod+plus", "other").key).toBe("+");
  });

  it("is indifferent to case and stray space", () => {
    expect(hotkeyId(" Mod + Shift + K ", "other")).toBe(
      hotkeyId("mod+shift+k", "other"),
    );
  });

  it("refuses a spec that names no key or two", () => {
    expect(() => parseChord("mod+shift", "other")).toThrow(/no key/);
    expect(() => parseChord("mod+k+j", "other")).toThrow(/more than one key/);
  });
});

describe("eventChordIds", () => {
  it("matches a plain press", () => {
    expect(eventChordIds(press("k"))).toContain(hotkeyId("k", "other"));
  });

  it("normalizes the key's case", () => {
    // Shift+A arrives as "A". Without lowering, "shift+a" never matches.
    expect(eventChordIds(press("A", { shiftKey: true }))).toContain(
      hotkeyId("shift+a", "other"),
    );
  });

  it("offers punctuation with and without the shift that reached it", () => {
    // "?" is Shift+/ on a US layout: the event carries shiftKey, a binding
    // written "?" does not, and the two have to meet somewhere.
    const ids = eventChordIds(press("?", { shiftKey: true }));

    expect(ids).toContain(hotkeyId("shift+?", "other"));
    expect(ids).toContain(hotkeyId("?", "other"));
  });

  it("does not drop shift from a letter", () => {
    // Dropping it here would make "shift+a" and "a" the same binding.
    expect(eventChordIds(press("A", { shiftKey: true }))).not.toContain(
      hotkeyId("a", "other"),
    );
  });

  it("falls back to the physical key when a modifier rewrote the typed one", () => {
    // macOS Alt+A types "å". Only the code says which key was struck.
    const ids = eventChordIds(press("å", { altKey: true, code: "KeyA" }));

    expect(ids).toContain(hotkeyId("alt+a", "other"));
  });

  it("prefers the typed key over the physical one", () => {
    const ids = eventChordIds(press("å", { altKey: true, code: "KeyA" }));

    expect(ids[0]).toBe(hotkeyId("alt+å", "other"));
  });

  it("reads a digit's physical key too", () => {
    const ids = eventChordIds(press("¡", { altKey: true, code: "Digit1" }));

    expect(ids).toContain(hotkeyId("alt+1", "other"));
  });

  it("offers no duplicate when the two names agree", () => {
    const ids = eventChordIds(press("a", { code: "KeyA" }));

    expect(ids).toEqual([hotkeyId("a", "other")]);
  });
});
