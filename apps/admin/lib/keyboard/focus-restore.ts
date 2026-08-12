// Putting focus back where it was.
//
// A keyboard-first console moves focus constantly — into a dialog, into a
// check-in sequence, into the palette — and every one of those has to hand it
// back. Left alone, the browser drops focus onto `<body>` when the element
// holding it is removed, and a receptionist who pressed Escape is returned to
// the top of the document with the queue's position lost. That is the single
// most common way a keyboard-first screen becomes unusable without anything
// looking broken on screen.
//
// Two things a naive "save and re-focus" gets wrong, both handled here:
// the saved element may have been removed from the document by the time the
// surface closes (a row that was re-rendered while a dialog was open), and
// focusing it may scroll the page under the operator.

/** A saved focus position, and the one thing you can do with it. */
export interface FocusRestorer {
  /**
   * Returns focus to where it was. Returns whether it landed there — false
   * when the element is gone, so the caller can put focus somewhere sensible
   * instead of assuming it worked.
   */
  restore(): boolean;
}

function isFocusable(element: HTMLElement | null): element is HTMLElement {
  if (element?.isConnected !== true) {
    // A row that was re-rendered while a dialog was open is still an element,
    // just no longer in the document.
    return false;
  }

  if (element === document.body) {
    return true;
  }

  // Still in the document but no longer shown — a collapsed panel's control, a
  // step of a sequence that has moved on. Focusing one silently does nothing
  // while every check short of reading `activeElement` says it worked.
  //
  // `checkVisibility` rather than `offsetParent !== null`: that shortcut
  // reports null for anything `position: fixed`, so it would refuse a perfectly
  // good target in an app shell whose nav rail and action bar are fixed — and
  // refusing means dropping the operator on `<body>`, which is the exact
  // failure this file exists to prevent.
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      checkOpacity: false,
      checkVisibilityCSS: true,
    });
  }

  return element.getClientRects().length > 0;
}

/**
 * Remembers what has focus right now.
 *
 * Call at the moment a surface opens, keep the result, and `restore()` when it
 * closes. Safe to call on a server render, where it captures nothing and
 * restores nothing.
 */
export function captureFocus(): FocusRestorer {
  const saved =
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null);

  return {
    restore() {
      if (!isFocusable(saved)) {
        return false;
      }

      // `preventScroll`: the element is where it was, so the viewport should be
      // too. Without it a row far down a long arrivals queue jumps the page.
      saved.focus({ preventScroll: true });
      return document.activeElement === saved;
    },
  };
}
