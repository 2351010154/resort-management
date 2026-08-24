/* The keyboard layer, in one import site.
 *
 * `resetHotkeys` is deliberately absent. It clears every binding in the
 * process, which is what a spec wants between cases and what nothing else ever
 * wants; a screen that reached it through this barrel would silently unbind the
 * shell. It stays importable from `./hotkey-registry` for the specs that need
 * it.
 *
 * `lib/date-parser.ts` is also not re-exported. It is keyboard-adjacent — it
 * exists because operators type dates rather than pick them — but it is a
 * parser, not focus or key infrastructure, and a screen that wants it should
 * say so. */

export {
  type Chord,
  type ChordSource,
  chordId,
  detectPlatform,
  eventChordIds,
  hotkeyId,
  type Platform,
  parseChord,
} from "./chord";
export { captureFocus, type FocusRestorer } from "./focus-restore";
export { FocusTrap, type FocusTrapProps } from "./focus-trap";
export { isFormField } from "./form-field";
export {
  dispatchHotkey,
  type HotkeyHandler,
  type HotkeyOptions,
  registerHotkey,
} from "./hotkey-registry";
export { KeyboardLayer, useKeyboardLayer } from "./keyboard-layer";
export {
  RovingFocusGroup,
  type RovingFocusGroupProps,
  useRovingFocusItem,
} from "./roving-focus";
export type { Jump, Orientation } from "./roving-geometry";
export { type UseHotkeysOptions, useHotkeys } from "./use-hotkeys";
