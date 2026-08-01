"use client";

// Who is staying, as rows in the panel.
//
// Round 1 of this panel put a bordered stepper, a repeated "Adults" label and a
// three-line pricing note inside each row, and it read as a form dropped into a
// summary. What the row actually has to do is state one answer and get out of the
// way, so:
//
// - **The row's own value is its label.** "2 adults", not "Adults: 2" — that is
//   `date-summary.tsx`'s rule applied a third time, because a caps label beside a
//   value is two strings for one fact and the day one is edited the other is a lie.
// - **The stepper is three glyphs, not three boxes.** Bordered buttons drew a
//   control the size of the panel's own action for something that adjusts a count
//   by one. The border went; the 44px target did not.
// - **`<details>`, not a scripted disclosure.** A row that reveals a control needs
//   no state a component has to hold, and the browser already knows how a summary
//   answers to a keyboard. It also survives a re-render for free, so changing a
//   party does not close the row you changed it in.
//
// Two things survive unchanged from the fieldset this replaced, because they were
// right:
//
// **The ages are not optional.** `property-and-tariff.md` §3 prices under-6 free,
// 6–11 at half the extra-person rate and 12-plus as an adult, so a child's age
// changes the total — and a number that changes the price cannot be collected at
// the next step, or the price the guest agreed to was not the price.
//
// **Native `<select>` for the ages.** Resy uses plain selects for party size,
// verified, and on a phone that buys the platform's own picker for free — better
// than any custom wheel and impossible to get wrong.

import type { ReactNode } from "react";
import {
  MAX_ADULTS,
  MAX_CHILD_AGE,
  MAX_CHILDREN,
} from "@/features/booking/lib/booking-search";
import type { Child, Party } from "@/features/booking/lib/stay-quote";
import styles from "./stay-panel.module.css";

/** Every age a child can be booked as. 12 and over is an adult — §3. */
const CHILD_AGES = Array.from(
  { length: MAX_CHILD_AGE + 1 },
  (_unused, age) => age,
);

export function PartyRows({
  party,
  nights,
  onChange,
}: {
  readonly party: Party;
  readonly nights: number;
  readonly onChange: (party: Party) => void;
}) {
  const setChildren = (children: Child[]) => onChange({ ...party, children });
  const childCount = party.children.length;

  return (
    <div className={styles.rows}>
      <Row value={party.adults === 1 ? "1 adult" : `${party.adults} adults`}>
        <Stepper
          noun="adults"
          max={MAX_ADULTS}
          min={1}
          onChange={(adults) => onChange({ ...party, adults })}
          value={party.adults}
        />
      </Row>

      <Row value={childrenLine(childCount)}>
        <Stepper
          noun="children"
          max={MAX_CHILDREN}
          min={0}
          onChange={(count) => {
            // Growing keeps the ages already given and defaults the new child to
            // the middle band, which is the one that needs a decision — a default
            // of 0 would silently price a teenager as free.
            const children = Array.from(
              { length: count },
              (_unused, index) => party.children[index] ?? { age: 8 },
            );
            setChildren(children);
          }}
          value={childCount}
        />

        {childCount > 0 ? (
          <div className={styles.ages}>
            {/* Keyed by position. A child in this control is an ordered slot with
                no identity of its own — there is no name and no id to key on, the
                stepper only ever adds or removes from the end, and nothing
                reorders them. */}
            {party.children.map((child, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a child slot has no identity but its position, and the stepper only appends or truncates.
              <label className={styles.ageField} key={index}>
                <span className={styles.ageLabel}>Child {index + 1}</span>
                <select
                  className={styles.ageSelect}
                  onChange={(event) => {
                    const next = [...party.children];
                    next[index] = { age: Number(event.target.value) };
                    setChildren(next);
                  }}
                  value={child.age}
                >
                  {CHILD_AGES.map((age) => (
                    <option key={age} value={age}>
                      {age === 0 ? "Under 1" : `Age ${age}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            {/* The bands, stated once, where the ages are collected — a guest
                should meet the rule as they answer it rather than discover it in
                the total. Three sentences became one: the numbers are the part
                that changes a price. */}
            <p className={styles.ageNote}>
              Under 6 free, 6 to 11 half the extra-person rate, 12 and over as
              adults.
            </p>
          </div>
        ) : null}
      </Row>

      {/* Not a row that opens. The length of the stay is a fact about the two
          dates above it, and the way to change it is the calendar that is still on
          screen — a stepper here would be a second, worse date picker. */}
      <p className={styles.rowStatic}>
        {nights === 1 ? "1 night" : `${nights} nights`}
      </p>
    </div>
  );
}

function childrenLine(count: number): string {
  if (count === 0) return "No children";
  return count === 1 ? "1 child" : `${count} children`;
}

/** One collapsed answer, and the control that changes it. */
function Row({
  value,
  children,
}: {
  readonly value: string;
  readonly children: ReactNode;
}) {
  return (
    <details className={styles.row}>
      <summary className={styles.rowHead}>
        <span className={styles.rowValue}>{value}</span>
        <span aria-hidden="true" className={styles.chevron} />
      </summary>

      <div className={styles.rowBody}>{children}</div>
    </details>
  );
}

function Stepper({
  noun,
  value,
  min,
  max,
  onChange,
}: {
  /** Plural, lower case: it only ever appears inside an accessible name. */
  readonly noun: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className={styles.stepper}>
      <button
        aria-label={`One fewer ${noun}`}
        className={styles.step}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        type="button"
      >
        −
      </button>

      {/* The count is the live part, so it is the thing announced when it changes
          rather than the whole control being re-read. Its name is the noun, which
          the row above states as well — said here because a stepper read on its
          own would otherwise announce a bare number. */}
      <output
        aria-label={noun}
        aria-live="polite"
        className={styles.stepperValue}
      >
        {value}
      </output>

      <button
        aria-label={`One more ${noun}`}
        className={styles.step}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
