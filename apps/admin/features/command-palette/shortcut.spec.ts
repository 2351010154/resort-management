import { describe, expect, it } from "vitest";

import { formatShortcut } from "./shortcut";

describe("formatShortcut", () => {
  it("resolves mod to the modifier the machine actually uses", () => {
    expect(formatShortcut("mod+k", "apple")).toBe("⌘K");
    expect(formatShortcut("mod+k", "other")).toBe("Ctrl+K");
  });

  it("sets Apple's glyphs solid and joins the words with a plus", () => {
    expect(formatShortcut("mod+shift+p", "apple")).toBe("⌘⇧P");
    expect(formatShortcut("mod+shift+p", "other")).toBe("Ctrl+Shift+P");
  });

  it("keeps a sequence's keys separated by the space that means 'then'", () => {
    expect(formatShortcut("g d", "apple")).toBe("G D");
    expect(formatShortcut("g d", "other")).toBe("G D");
  });

  it("prints the glyph on the key rather than the name in the source", () => {
    expect(formatShortcut("escape", "other")).toBe("Esc");
    expect(formatShortcut("alt+arrowdown", "other")).toBe("Alt+↓");
    expect(formatShortcut("enter", "apple")).toBe("↵");
  });

  it("leaves a multi-character key as written", () => {
    expect(formatShortcut("F5", "other")).toBe("F5");
  });

  it("reads spacing the way parseChord does", () => {
    // "mod + k" is one chord to the parser, so it must be one hint here.
    expect(formatShortcut("  mod + k  ", "other")).toBe("Ctrl+K");
    expect(formatShortcut("g   d", "other")).toBe("G D");
  });

  it("names the plus key by the alias the parser gave it", () => {
    expect(formatShortcut("mod+plus", "other")).toBe("Ctrl++");
  });

  it("is empty for an empty spec rather than throwing", () => {
    expect(formatShortcut("", "other")).toBe("");
    expect(formatShortcut("   ", "other")).toBe("");
  });
});
