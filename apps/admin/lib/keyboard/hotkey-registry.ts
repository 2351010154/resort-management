import {
  type ChordSource,
  detectPlatform,
  eventChordIds,
  hotkeyId,
  type Platform,
} from "./chord";
import { isFormField } from "./form-field";

// One listener on the document, and a map from chord to the things that want
// it. Screens do not add key handlers of their own; they register here through
// `use-hotkeys.ts` and get an unregister function back.
//
// Three departures from the obvious implementation, each fixing a defect rather
// than adding a feature:
//
// **A chord holds a stack, not a handler.** `Map<string, Handler>` reads well
// until two things want the same chord. Arrivals binds Escape to "leave the
// check-in sequence"; a dialog opens over it and binds Escape to "close me".
// With one handler per chord the dialog overwrites the screen's, and when the
// dialog unmounts it deletes an entry that was never its own — Escape is dead
// on a screen that is still mounted, and nothing reports it. A stack gives the
// innermost binding the key and hands it back on unmount, which is the
// behaviour every layered surface already assumes.
//
// **Depth outranks recency.** Registration order is a good proxy for "which
// surface is innermost" only while surfaces open one after another. React
// flushes a child's effects before its parent's, so two surfaces mounting in
// one commit register in exactly the wrong order — see `keyboard-layer.tsx`,
// which is where a surface declares its depth. A binding's layer is compared
// first and its position in the stack only breaks the tie.
//
// **The listener attaches on the first binding and detaches on the last.**
// There is no mount step for the shell to remember, and a server render adds no
// listener because it registers nothing.

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyOptions {
  /**
   * Fire even while focus is in a text field. Off by default — a receptionist
   * typing a guest name into search must not trigger the "n"ew booking command
   * on every letter of "Nguyen".
   */
  enableInFormField?: boolean;
  /** Call `preventDefault` when the binding fires. On by default. */
  preventDefault?: boolean;
  /**
   * Also stop the press reaching anything else listening on the document. Off
   * by default, because most bindings are the console's own and nothing else
   * wants them.
   *
   * Turn it on where a press would otherwise be acted on twice. Radix's
   * dismissable layers listen for Escape on the document themselves, so a
   * screen that closes its own surface on Escape while a Radix overlay is open
   * gets both — the surface closes and the overlay dismisses on one press.
   */
  stopPropagation?: boolean;
  /**
   * How deep the surface owning this binding is. Higher wins. Supplied by
   * `use-hotkeys.ts` from `keyboard-layer.tsx`; callers reaching the registry
   * directly are on the screen itself and leave it at 0.
   */
  layer?: number;
}

interface Binding {
  handler: HotkeyHandler;
  enableInFormField: boolean;
  preventDefault: boolean;
  stopPropagation: boolean;
  layer: number;
}

const bindings = new Map<string, Binding[]>();

let listenerTarget: Document | null = null;
let platform: Platform | null = null;

/**
 * The platform, decided once per session.
 *
 * Cached because every registration parses `mod` against it, and because a
 * value that changed between two registrations would put the same written
 * hotkey under two different ids.
 */
function currentPlatform(): Platform {
  if (platform === null) {
    platform = detectPlatform();
  }

  return platform;
}

function onKeyDown(event: KeyboardEvent): void {
  dispatchHotkey(event);
}

function attach(): void {
  if (listenerTarget !== null || typeof document === "undefined") {
    return;
  }

  listenerTarget = document;
  // Capture phase: the binding is meant to be global, and a screen that stops
  // propagation on its own container should not silently disable the console's
  // escape route.
  listenerTarget.addEventListener("keydown", onKeyDown, true);
}

function detach(): void {
  if (listenerTarget === null) {
    return;
  }

  listenerTarget.removeEventListener("keydown", onKeyDown, true);
  listenerTarget = null;
}

/**
 * Registers a hotkey and returns the function that takes it back.
 *
 * `spec` may name several chords for one handler — `["mod+k", "/"]` — and the
 * returned function removes all of them.
 */
export function registerHotkey(
  spec: string | readonly string[],
  handler: HotkeyHandler,
  options: HotkeyOptions = {},
): () => void {
  const specs = typeof spec === "string" ? [spec] : spec;
  const binding: Binding = {
    handler,
    enableInFormField: options.enableInFormField ?? false,
    preventDefault: options.preventDefault ?? true,
    stopPropagation: options.stopPropagation ?? false,
    layer: options.layer ?? 0,
  };
  const ids = specs.map((one) => hotkeyId(one, currentPlatform()));

  for (const id of ids) {
    const stack = bindings.get(id);
    if (stack === undefined) {
      bindings.set(id, [binding]);
    } else {
      stack.push(binding);
    }
  }

  attach();

  let released = false;
  return () => {
    // Guarded because React can call a cleanup twice in development's double
    // invocation, and a second removal would pop a binding belonging to
    // whatever registered after this one.
    if (released) {
      return;
    }
    released = true;

    for (const id of ids) {
      const stack = bindings.get(id);
      if (stack === undefined) {
        continue;
      }

      const at = stack.lastIndexOf(binding);
      if (at !== -1) {
        stack.splice(at, 1);
      }

      if (stack.length === 0) {
        bindings.delete(id);
      }
    }

    if (bindings.size === 0) {
      detach();
    }
  };
}

/**
 * Runs the innermost binding that will accept this press. Returns whether one
 * did, which is what the specs assert on.
 *
 * Exported separately from the listener so it can be exercised with a plain
 * object: what matters here is chord matching and the gates, and a DOM adds
 * nothing to that evidence.
 */
export function dispatchHotkey(
  event: ChordSource &
    Partial<Pick<KeyboardEvent, "repeat" | "isComposing" | "target">> & {
      preventDefault?: () => void;
    },
): boolean {
  // A held key repeats. Commands fire once per press; a receptionist leaning on
  // a key should not open twenty dialogs.
  if (event.repeat === true) {
    return false;
  }

  // Mid-composition. Vietnamese input methods send keydown for every keystroke
  // that is still assembling a character, and those presses belong to the IME,
  // not to the console.
  if (event.isComposing === true) {
    return false;
  }

  const typing = isFormField(event.target ?? null);
  // Escape is exempt. It is the console's escape route from any surface, and a
  // person who has just typed into the wrong field is exactly who needs it.
  const escaping = event.key === "Escape";

  // Candidate ids are tried in order — what was typed before what was struck —
  // because a different id is a different *key*, and no depth should let one
  // surface's binding for a physical key beat another's for the key the
  // operator actually typed. Depth decides only among bindings on the same key.
  for (const id of eventChordIds(event)) {
    const stack = bindings.get(id);
    if (stack === undefined) {
      continue;
    }

    let chosen: Binding | null = null;

    for (let at = stack.length - 1; at >= 0; at -= 1) {
      const binding = stack[at];

      if (typing && !escaping && !binding.enableInFormField) {
        continue;
      }

      // Strictly greater, so the walk from the top of the stack downward makes
      // registration order the tie-break: among equal layers the first eligible
      // binding met is the most recently registered, and it keeps the key.
      if (chosen === null || binding.layer > chosen.layer) {
        chosen = binding;
      }
    }

    if (chosen === null) {
      continue;
    }

    if (chosen.preventDefault) {
      event.preventDefault?.();
    }

    if (chosen.stopPropagation) {
      (event as Partial<KeyboardEvent>).stopPropagation?.();
    }

    chosen.handler(event as KeyboardEvent);
    return true;
  }

  return false;
}

/** Test seam: drops every binding and the listener with them. */
export function resetHotkeys(): void {
  bindings.clear();
  detach();
  platform = null;
}
