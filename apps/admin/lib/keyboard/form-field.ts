// Whether a key press landed somewhere a person is typing.
//
// Two things need this answer and would otherwise each carry their own copy:
// the hotkey registry, which must not fire the "n"ew-booking command on the
// first letter of "Nguyen", and the roving-focus group, which must not steal
// ArrowLeft from a caret in a rate field sitting inside the list.

/**
 * True for the controls a person types into. Buttons, checkboxes and radios are
 * inputs that are not text, so they are not counted — an operator tabbing
 * across a row of buttons still gets the console's keys.
 */
export function isFormField(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }

  // Read as properties rather than tested with `instanceof HTMLElement`. The
  // console renders inside one document today, but `instanceof` is per-realm
  // and answers false for an element from an iframe or a portal in another
  // window — and it throws outright where `HTMLElement` is not defined, which
  // is every environment these gates are exercised in.
  const element = target as Partial<HTMLElement & HTMLInputElement>;

  if (element.isContentEditable === true) {
    return true;
  }

  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  if (tag !== "INPUT") {
    return false;
  }

  // Everything else an `<input>` can be — text, search, number, date, range,
  // file — takes keys of its own. A date field is the one worth naming: the
  // console's date fields are typed rather than picked, which is what
  // `lib/date-parser.ts` exists for, and arrows and Home belong to the caret
  // in them.
  const type = element.type;
  return type !== "button" && type !== "checkbox" && type !== "radio";
}
