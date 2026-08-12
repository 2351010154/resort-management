import type { Platform } from "@/lib/keyboard";

/* Turning a written hotkey into the hint on the right of a palette row.
 *
 * A command declares its shortcut the way every binding in the console is
 * written — "mod+k", "g d", "shift+/" — because that spelling is what
 * `useHotkeys` takes, and a command that wrote its hint separately from its
 * binding would eventually advertise a key it does not answer to. So the hint
 * is derived rather than authored, and this is the derivation.
 *
 * It is presentation and lives here rather than in `lib/keyboard/`: the
 * registry has no interest in what a chord looks like, and a symbol table is
 * exactly the kind of thing that grows a brand opinion later.
 */

// Apple's modifier glyphs are read as a unit and are what a Mac operator
// expects; spelled-out names are what everyone else's keyboard has printed on
// it. `mod` is not in either table because it is resolved before lookup.
const APPLE_SYMBOLS: Record<string, string> = {
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  meta: "⌘",
  cmd: "⌘",
  command: "⌘",
};

const OTHER_NAMES: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Win",
  cmd: "Win",
  command: "Win",
};

// Keys whose written name is not what is printed on the key.
const KEY_GLYPHS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  spacebar: "Space",
  // "+" is the separator, so `chord.ts` gives the plus key a name of its own.
  // The hint has to give it back.
  plus: "+",
};

function formatChord(chord: string, platform: Platform): string {
  const modifiers = platform === "apple" ? APPLE_SYMBOLS : OTHER_NAMES;
  const parts: string[] = [];

  for (const raw of chord.split("+")) {
    const token = raw.trim().toLowerCase();

    if (token === "") {
      continue;
    }

    if (token === "mod") {
      parts.push(platform === "apple" ? "⌘" : "Ctrl");
      continue;
    }

    const modifier = modifiers[token];
    if (modifier !== undefined) {
      parts.push(modifier);
      continue;
    }

    const glyph = KEY_GLYPHS[token];
    // A single character is upper-cased and everything longer is left as
    // written: "k" is printed K on the key, and "F5" is not "F5uppercased" in
    // any useful sense.
    parts.push(
      glyph ?? (token.length === 1 ? token.toUpperCase() : raw.trim()),
    );
  }

  // Apple's glyphs are set solid — ⌘K, not ⌘+K — and the words need the plus
  // between them or "CtrlShiftK" is one word.
  return parts.join(platform === "apple" ? "" : "+");
}

/**
 * Formats a written shortcut for display.
 *
 * Sequences — "g d", the two-key press that goes to the dashboard — are chords
 * separated by spaces, and each is formatted on its own. The space survives
 * into the hint because it is the thing that says these are pressed one after
 * the other rather than together.
 */
export function formatShortcut(spec: string, platform: Platform): string {
  return (
    spec
      // Space around a plus is closed up before the sequence is split, because
      // `parseChord` trims each side of a "+" and so reads "mod + k" as one
      // chord. Splitting on whitespace first would read it as three, and the hint
      // would describe a binding the console does not have.
      .replace(/\s*\+\s*/g, "+")
      .trim()
      .split(/\s+/)
      .filter((chord) => chord !== "")
      .map((chord) => formatChord(chord, platform))
      .join(" ")
  );
}
