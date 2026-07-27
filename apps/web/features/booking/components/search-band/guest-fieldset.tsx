"use client";

// Who is staying.
//
// Adults, children, and an age for every child. The ages are **not optional**:
// `property-and-tariff.md` §3 prices under-6 free, 6–11 at half the extra-person
// rate and 12-plus as an adult, so a child's age changes the total — and a number
// that changes the price cannot be collected at the next step, or the price the
// guest agreed to was not the price.
//
// Native `<select>` for the ages. Resy uses plain selects for party size and time,
// verified, and on a phone that buys the platform's own picker for free — better
// than any custom wheel and impossible to get wrong. The steppers are buttons
// because a two-way count of two things reads faster than two dropdowns.

import {
  MAX_ADULTS,
  MAX_CHILD_AGE,
  MAX_CHILDREN,
} from "@/features/booking/lib/booking-search";
import type { Child, Party } from "@/features/booking/lib/stay-quote";
import styles from "./search-band.module.css";

/** Every age a child can be booked as. 12 and over is an adult — §3. */
const CHILD_AGES = Array.from(
  { length: MAX_CHILD_AGE + 1 },
  (_unused, age) => age,
);

export function GuestFieldset({
  party,
  onChange,
}: {
  readonly party: Party;
  readonly onChange: (party: Party) => void;
}) {
  const setChildren = (children: Child[]) => onChange({ ...party, children });

  return (
    <fieldset className={styles.fieldset}>
      <legend className={`${styles.legend} caps-label`}>Who is staying</legend>

      <Stepper
        label="Adults"
        max={MAX_ADULTS}
        min={1}
        onChange={(adults) => onChange({ ...party, adults })}
        value={party.adults}
      />

      <Stepper
        label="Children"
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
        value={party.children.length}
      />

      {party.children.length > 0 ? (
        <div className={styles.ages}>
          {/* Keyed by position. A child in this control is an ordered slot with no
              identity of its own — there is no name and no id to key on, the
              stepper only ever adds or removes from the end, and nothing reorders
              them. */}
          {party.children.map((child, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a child slot has no identity but its position, and the stepper only appends or truncates.
            <label className={styles.ageField} key={index}>
              <span className={styles.ageLabel}>Child {index + 1}, age</span>
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
                    {age === 0 ? "Under 1" : age}
                  </option>
                ))}
              </select>
            </label>
          ))}

          {/* The bands, stated once, where the ages are collected. A guest should
              meet the rule as they answer it, not discover it in the total. */}
          <p className={styles.ageNote}>
            Under 6 stay free, sharing the beds in the room. 6 to 11 are half
            the extra-person rate. 12 and over count as adults.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className={styles.stepper}>
      <span className={styles.stepperLabel} id={`stepper-${label}`}>
        {label}
      </span>
      <div className={styles.stepperControls}>
        <button
          aria-label={`One fewer ${label.toLowerCase()}`}
          className={styles.step}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          −
        </button>
        {/* The count is the live part, so it is the thing announced when it
            changes rather than the whole control being re-read. */}
        <output
          aria-labelledby={`stepper-${label}`}
          aria-live="polite"
          className={styles.stepperValue}
        >
          {value}
        </output>
        <button
          aria-label={`One more ${label.toLowerCase()}`}
          className={styles.step}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
