"use client";

import type * as React from "react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* A control an operator types at and chooses from without leaving the keys.
 *
 * The two things a check-in has to pick — the person and the room — are both
 * "one of a set the property already has", and a `<select>` is the wrong shape
 * for either: forty rooms in a dropdown is a list an operator scrolls, and the
 * desk already knows the number. So the field is a text input, what is typed
 * narrows the list underneath it, and the arrows and Enter choose from what is
 * left. Nothing here needs a pointer, which is `NFR-11` at the level of a single
 * control.
 *
 * **Focus stays in the input while the arrows move the highlight**, which is why
 * the list is a `listbox` addressed by `aria-activedescendant` rather than a set
 * of buttons focus travels through. Two reasons, and the first is not
 * cosmetic: `RovingFocusGroup` hands the arrow keys back to whatever is being
 * typed into — `isFormField` — so a highlight that lived on the focused element
 * would fight the queue's own arrow handling the moment the list emptied. The
 * second is that continuing to type is the normal next act: "20", see three
 * rooms, type "4", press Enter.
 *
 * The pointer still works. `NFR-11` requires that no pointer is *needed*, not
 * that clicking is taken away from the operator who reaches for the mouse.
 */

export interface FilterOption {
  /** What is handed back when this row is chosen. */
  readonly id: string;
  /** The row's own words — a room number, a guest's name. */
  readonly label: string;
  /** What tells two similar rows apart, printed beside the label. */
  readonly detail?: string;
}

export interface FilterListProps {
  /** What the operator is choosing, as the field's label. */
  label: string;
  /** A line under the label, for the rule that decides what is in the list. */
  hint?: string;
  placeholder?: string;
  query: string;
  onQueryChange(query: string): void;
  options: readonly FilterOption[];
  onPick(id: string): void;
  /** What to say when nothing matches — name why, not that the list is empty. */
  emptyMessage: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function FilterList({
  label,
  hint,
  placeholder,
  query,
  onQueryChange,
  options,
  onPick,
  emptyMessage,
  inputRef,
}: FilterListProps) {
  const listId = useId();
  const fieldId = useId();
  // The highlight is an index into a list that re-filters under it on every
  // keystroke, so what is remembered is the index *and* the query it was
  // chosen against. A new query starts at the top — typing narrows, and the
  // first match is what the operator is reaching for — and that is adjusted
  // during the render rather than in an effect, so there is no frame in which
  // the highlight is on a row the new query no longer contains.
  const [chosen, setChosen] = useState({ query, index: 0 });
  const highlighted = chosen.query === query ? chosen.index : 0;

  // Clamped as well, because the list can also shrink without the query
  // changing: a room somebody else took disappears when the board refetches.
  const within =
    options.length === 0 ? 0 : Math.min(highlighted, options.length - 1);

  function highlight(index: number) {
    setChosen({ query, index });
  }

  const active = options[within];

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (options.length === 0) {
        return;
      }

      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, like every other list in the console: at the bottom of three
      // rooms the next press is the first one again.
      highlight((within + step + options.length) % options.length);
      return;
    }

    if (event.key === "Enter") {
      // Always swallowed, whether or not there is something to choose. The
      // control sits inside the step's form, and an Enter that fell through
      // with nothing highlighted would submit a step that has not been answered.
      event.preventDefault();

      if (active !== undefined) {
        onPick(active.id);
      }
    }
  }

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      {hint === undefined ? null : (
        <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      )}
      <Input
        id={fieldId}
        ref={inputRef}
        className="mt-2"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          active === undefined ? undefined : `${listId}-${active.id}`
        }
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />

      {options.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">{emptyMessage}</p>
      ) : (
        <div
          id={listId}
          // A real listbox, because the highlight is not focus: assistive
          // technology reads the active row off `aria-activedescendant`, and it
          // can only do that if this element says what it is.
          role="listbox"
          aria-label={label}
          className="border-border mt-2 max-h-48 overflow-y-auto rounded-md border"
        >
          {options.map((option, at) => (
            // A button, so the row a pointer can press is a row that is
            // natively pressable — and `tabIndex={-1}` keeps it out of the Tab
            // order, because the operator's focus belongs in the field above
            // for as long as they are still typing.
            <button
              type="button"
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={at === within}
              className={cn(
                "flex w-full items-baseline justify-between gap-4 px-3 py-2 text-left text-sm",
                at === within && "bg-accent text-accent-foreground",
              )}
              onClick={() => {
                onPick(option.id);
              }}
              onMouseMove={() => {
                highlight(at);
              }}
            >
              <span>{option.label}</span>
              {option.detail === undefined ? null : (
                <span className="text-muted-foreground text-sm">
                  {option.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
