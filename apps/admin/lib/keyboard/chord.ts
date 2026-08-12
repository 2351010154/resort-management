// Turning a key press into something a registry can look up.
//
// A hotkey is written as a string — "mod+k", "shift+/", "alt+arrowdown" — and
// a `KeyboardEvent` is a set of flags plus two different names for the key that
// was struck. This module is the one place that reconciles the two, so the
// registry can be a plain Map lookup and nothing else in the console has to
// think about `event.key` versus `event.code` again.
//
// Three platform facts drive the shape of it, and each one is a defect if
// ignored rather than a nicety:
//
//   1. The primary modifier is Cmd on Apple hardware and Ctrl everywhere else.
//      `mod` is the spelling that means "whichever one this machine uses", and
//      it resolves once, at parse time, against the running platform.
//   2. `event.key` carries the *typed character*, so on macOS Alt+A arrives as
//      "å" and Shift+/ arrives as "?" with no "/" anywhere in sight. Matching
//      only on `key` loses every Alt binding on one platform and forces the
//      other bindings to be written in their shifted spelling.
//   3. `event.code` carries the *physical key*, which fixes (2) but is wrong on
//      any non-QWERTY layout, where KeyA is not where "a" is.
//
// So neither name is authoritative alone. An event yields a short list of
// candidate ids — the typed one first, the physical one last — and the registry
// takes the first that has a binding. Costs a Map miss; buys bindings that work
// on a Vietnamese receptionist's laptop and a manager's MacBook alike.

/** Which primary modifier this machine uses. */
export type Platform = "apple" | "other";

/** A hotkey reduced to its four flags and one normalized key name. */
export interface Chord {
  /** Lowercase, normalized: "k", "escape", "arrowdown", "/". */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

// Spellings a person reaches for, mapped to the name `event.key` actually uses.
// Deliberately short: it covers the abbreviations, not every key on the board.
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  del: "delete",
  ins: "insert",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  pgup: "pageup",
  pgdn: "pagedown",
  // "+" is the separator, so the plus key needs a name that is not itself.
  plus: "+",
};

const MODIFIER_TOKENS = new Set([
  "mod",
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
  "meta",
  "cmd",
  "command",
  "super",
  "win",
]);

/**
 * Whether this machine's primary modifier is Cmd.
 *
 * Returns "other" when there is no navigator at all, which is the server. That
 * is the safe answer rather than a guess: nothing on the server dispatches a
 * key press, and every binding is parsed again in the browser when the hook
 * that owns it mounts.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") {
    return "other";
  }

  // `userAgentData.platform` is the un-deprecated source and reports "macOS".
  // `navigator.platform` is the fallback and reports "MacIntel". Neither is
  // typed as present in every runtime, hence the widening.
  const agent = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const source = agent.userAgentData?.platform ?? agent.platform ?? "";

  return /mac|iphone|ipad|ipod/i.test(source) ? "apple" : "other";
}

function normalizeKeyName(raw: string): string {
  const lowered = raw.toLowerCase();
  return KEY_ALIASES[lowered] ?? lowered;
}

/**
 * Reads a written hotkey — "mod+shift+k" — into its flags and key.
 *
 * `mod` resolves here rather than at match time so the registry's keys are
 * concrete: on a Mac "mod+k" and "meta+k" are the same entry, and a binding
 * written either way collides as it should.
 *
 * Throws on a spec with no key or more than one, because both are typos in
 * source rather than states a running console can reach.
 */
export function parseChord(spec: string, platform: Platform): Chord {
  const chord: Chord = {
    key: "",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  let keySeen = false;

  for (const token of spec.split("+")) {
    const part = token.trim().toLowerCase();

    if (part === "") {
      continue;
    }

    if (MODIFIER_TOKENS.has(part)) {
      switch (part) {
        case "mod":
          if (platform === "apple") {
            chord.meta = true;
          } else {
            chord.ctrl = true;
          }
          break;
        case "ctrl":
        case "control":
          chord.ctrl = true;
          break;
        case "alt":
        case "option":
          chord.alt = true;
          break;
        case "shift":
          chord.shift = true;
          break;
        default:
          chord.meta = true;
          break;
      }
      continue;
    }

    if (keySeen) {
      throw new Error(`hotkey "${spec}" names more than one key`);
    }

    chord.key = normalizeKeyName(part);
    keySeen = true;
  }

  if (!keySeen) {
    throw new Error(`hotkey "${spec}" names no key`);
  }

  return chord;
}

/** The canonical string a chord is stored and looked up under. */
export function chordId(chord: Chord): string {
  return [
    chord.ctrl ? "ctrl" : "",
    chord.alt ? "alt" : "",
    chord.shift ? "shift" : "",
    chord.meta ? "meta" : "",
    chord.key,
  ]
    .filter(Boolean)
    .join("+");
}

/** Convenience for the common "write it, look it up" path. */
export function hotkeyId(spec: string, platform: Platform): string {
  return chordId(parseChord(spec, platform));
}

// "KeyA" -> "a", "Digit1" -> "1", and nothing else.
//
// Letters and digits are the codes worth reading, because they are the ones a
// modifier or a layout rewrites: Alt+A types "å" and the physical name is the
// only way back. Every other code is either already the same as `event.key`
// once lowercased ("Escape", "ArrowUp") or a name for a character that no
// modifier moves ("Space" for " ", "Slash" for "/"), and in both cases the
// typed candidate has already matched. Returning null leaves those to it.
function keyFromCode(code: string): string | null {
  if (code.length === 4 && code.startsWith("Key")) {
    return code.charAt(3).toLowerCase();
  }

  if (code.length === 6 && code.startsWith("Digit")) {
    return code.charAt(5);
  }

  return null;
}

/** The minimal event shape this module reads, so specs need no DOM. */
export type ChordSource = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

/**
 * Every id a key press could reasonably have been bound as, best first.
 *
 * 1. What was typed. "?" is "?", and "å" is "å".
 * 2. The same, with Shift dropped — but only for a single character that is
 *    neither a letter nor a digit. "?" is *reached* with Shift, so a binding
 *    written "?" carries no shift flag while the event does; without this
 *    candidate the two never meet. Restricted to punctuation because dropping
 *    Shift on a letter would make "shift+a" and "a" the same binding.
 * 3. What was struck, for the layouts and modifiers that rewrite (1). This is
 *    what makes Alt+A on macOS find a binding written "alt+a".
 */
export function eventChordIds(event: ChordSource): string[] {
  const base = {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
  const typed = normalizeKeyName(event.key);
  const ids = [chordId({ ...base, key: typed })];

  const punctuation = typed.length === 1 && !/[a-z0-9]/.test(typed);
  if (event.shiftKey && punctuation) {
    ids.push(chordId({ ...base, shift: false, key: typed }));
  }

  const struck = keyFromCode(event.code);
  if (struck !== null && struck !== typed) {
    ids.push(chordId({ ...base, key: struck }));
  }

  return ids;
}
