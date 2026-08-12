"use client";

import type * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import { isFormField } from "./form-field";
import {
  jumpFor,
  type Orientation,
  stepFor,
  targetIndex,
} from "./roving-geometry";

// Arrow keys through a list, one Tab stop for the whole thing.
//
// A queue of forty arrivals with forty tab stops is not keyboard-first, it is
// keyboard-hostile: reaching the control after the list costs forty presses.
// The pattern every list in the console uses instead is roving tabindex — the
// list is one stop, the arrows move within it, and Tab leaves.
//
// The active member is tracked by *value* rather than by index, because a queue
// re-sorts and re-filters under the operator. An index survives neither: filter
// the arrivals list and index 3 is a different guest, while a booking reference
// is still the row it always was. Rows in this console all have a stable
// identity — a reference, a room number, a folio id — so there is nothing to
// invent.
//
// Order comes from the DOM rather than from a registration array the members
// keep in sync. `querySelectorAll` returns document order, which is the order
// the operator sees, and it is right on the first render after a re-sort
// without anything having to tell it.
//
// Tracking by value has one failure mode that has to be handled rather than
// assumed away: the active row can *leave*. An operator arrows to a booking,
// checks the guest in, and the row drops out of the queue — at which point no
// member matches the remembered value, every member is `tabIndex={-1}`, and the
// list is no longer a Tab stop at all. The operator cannot get back into it
// without a mouse, which on a keyboard-first console is the whole screen lost.
// The group reconciles against the live DOM after every commit for exactly
// this.

interface RovingFocusContextValue {
  activeValue: string | null;
  /** The first member registers itself so the list has a Tab stop. */
  claimInitial(value: string): void;
  setActiveValue(value: string): void;
}

const RovingFocusContext = createContext<RovingFocusContextValue | null>(null);

const ITEM_SELECTOR = "[data-roving-item]:not([data-disabled])";

function itemsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/**
 * The member focus is inside, which is not always the member itself.
 *
 * A queue row is a `<tr>` holding buttons, and an operator who has tabbed into
 * one of those buttons is, as far as the arrows are concerned, on that row.
 * Comparing `activeElement` against the member list directly answers "not in
 * the list" for that case, and ArrowDown from row 12's button would jump to
 * row 1 instead of row 13.
 */
function memberOf(items: HTMLElement[], focused: Element | null): number {
  if (focused === null) {
    return -1;
  }

  const member = focused.closest<HTMLElement>("[data-roving-item]");
  return member === null ? -1 : items.indexOf(member);
}

export interface RovingFocusGroupProps extends React.ComponentProps<"div"> {
  /** Which arrows move focus. Vertical by default — most lists are rows. */
  orientation?: Orientation;
  /** Wrap from the last member to the first. On by default. */
  loop?: boolean;
}

/**
 * Owns the arrow keys for the list inside it.
 *
 * The handler sits on the group rather than on each member, so a member added
 * mid-session is steerable without registering anything.
 */
export function RovingFocusGroup({
  orientation = "vertical",
  loop = true,
  // A container that answers keys owes assistive technology a reason to exist,
  // and `group` is the honest default: it says "these belong together" and
  // claims nothing about what they are. A list with real semantics names its
  // own — a room grid is a `grid`, a nav rail a `menu` — and a queue of table
  // rows passes `presentation`, because the table already says what it is.
  role = "group",
  className,
  children,
  onKeyDown,
  ...props
}: RovingFocusGroupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const claimInitial = useCallback((value: string) => {
    setActiveValue((current) => current ?? value);
  }, []);

  // After every commit, make sure the remembered member is still on the page.
  // No dependency array on purpose: the list changes without this component's
  // props changing — a row is checked in, a filter is applied — and the DOM is
  // the only thing that knows. One `querySelector` per commit against a list
  // the operator is looking at is not a cost worth optimising away.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || activeValue === null) {
      return;
    }

    const stillThere = container.querySelector(
      `${ITEM_SELECTOR}[data-roving-value="${CSS.escape(activeValue)}"]`,
    );

    if (stillThere === null) {
      // Hand the Tab stop to the first surviving member. Focus is not moved
      // with it: the row left because the operator finished with it, and
      // pulling focus back into the list would fight wherever they went next.
      setActiveValue(itemsIn(container)[0]?.dataset.rovingValue ?? null);
    }
  });

  function move(step: number, jump: "first" | "last" | null) {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const items = itemsIn(container);
    const from = memberOf(items, document.activeElement);
    const target = targetIndex(from, step, jump, items.length, loop);

    if (target === null) {
      return;
    }

    const item = items[target];
    item.focus();

    // Only remember it if focus actually landed. A member the caller disabled
    // natively — `<button disabled>` rather than the hook's `disabled` option —
    // is still in the DOM and still matches the selector, but `.focus()` on it
    // is a silent no-op. Committing it as active would hand the Tab stop to a
    // control nothing can focus, and the list would stop being reachable.
    if (document.activeElement === item) {
      const value = item.dataset.rovingValue;
      if (value !== undefined) {
        setActiveValue(value);
      }
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);

    if (event.defaultPrevented) {
      return;
    }

    // A rate field in a room grid, a search box in a nav rail. The caret owns
    // the arrows and Home and End while focus is in one of them; the list can
    // have them back when the operator leaves.
    if (isFormField(event.target)) {
      return;
    }

    const step = stepFor(event.key, orientation);
    const jump = jumpFor(event.key);

    if (step === 0 && jump === null) {
      return;
    }

    event.preventDefault();
    move(step, jump);
  }

  // Memoized so a group that re-renders for its own reasons does not re-render
  // every member with it. `activeValue` changing has to reach them; a new
  // object identity on each render does not.
  const context = useMemo(
    () => ({ activeValue, claimInitial, setActiveValue }),
    [activeValue, claimInitial],
  );

  return (
    <RovingFocusContext.Provider value={context}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the element does
          carry a role — the `role` prop above, "group" unless the caller names
          a better one. Biome only resolves that attribute when it is written
          as a literal, and a literal here would instead be reported as a
          <fieldset> that should not be one: fieldset groups form controls and
          obliges a <legend>, while these members are rows, tiles and nav
          entries whose markup this component does not own. */}
      <div
        ref={containerRef}
        role={role}
        className={cn(className)}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </div>
    </RovingFocusContext.Provider>
  );
}

/**
 * The props a member of the list carries, ready to spread.
 *
 * A hook rather than a component because the console's lists are not all the
 * same element — a queue row is a `<tr>`, a housekeeping tile is a `<button>`,
 * a nav entry is an `<a>` — and a wrapper would either impose a tag or reach
 * for `cloneElement`.
 *
 * ```tsx
 * <tr {...useRovingFocusItem(booking.reference)}>…</tr>
 * ```
 *
 * Use the `disabled` option rather than the element's own `disabled` attribute
 * when a member is unreachable. This one takes it out of the list the arrows
 * walk; the attribute alone leaves it in, and the arrows would stop on a member
 * that cannot take focus.
 */
export function useRovingFocusItem(
  value: string,
  options: { disabled?: boolean } = {},
) {
  const context = useContext(RovingFocusContext);

  if (context === null) {
    throw new Error("useRovingFocusItem used outside a RovingFocusGroup");
  }

  const { activeValue, claimInitial, setActiveValue } = context;
  const disabled = options.disabled === true;

  // The first enabled member to mount claims the Tab stop, so the list is
  // reachable before anything has been arrowed to. In an effect rather than
  // during render because this sets state on the *group*, and React rejects a
  // component updating another one mid-render. Effects run in DOM order among
  // siblings, so the member that claims it is the one the operator sees first,
  // and `claimInitial` ignores every claim after it.
  useEffect(() => {
    if (!disabled) {
      claimInitial(value);
    }
  }, [claimInitial, disabled, value]);

  return {
    "data-roving-item": "",
    "data-roving-value": value,
    ...(disabled ? { "data-disabled": "" } : {}),
    tabIndex: activeValue === value && !disabled ? 0 : -1,
    // Clicking a member makes it the one Tab comes back to. Without this the
    // operator clicks row 12, tabs away, tabs back, and lands on row 1.
    // Focus from a child bubbles here too, which is what keeps the remembered
    // member right when the operator tabs into a button inside a row.
    onFocus: () => {
      if (!disabled) {
        setActiveValue(value);
      }
    },
  } as const;
}
