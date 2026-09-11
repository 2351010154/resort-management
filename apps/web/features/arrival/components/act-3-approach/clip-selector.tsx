"use client";

// The column of four labels that chooses which passage Act 3 plays.
//
// Presentational on purpose: which clip is showing, and the crossfade between
// them, belong to the act — this only reports intent. Hover and tap commit the
// same way, so the reader never has to learn that one of them is a preview.

import type { ApproachClip } from "./approach-clips";
import styles from "./clip-selector.module.css";

interface ClipSelectorProps {
  readonly clips: readonly ApproachClip[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
}

export function ClipSelector({
  clips,
  activeIndex,
  onSelect,
}: ClipSelectorProps) {
  return (
    <div className={styles.panel}>
      {/* A real grouping element rather than a div wearing the role: the four
          are one choice with one answer, and a screen reader should hear that
          before it hears the first label. The legend carries the name and is
          hidden visually — the column's meaning is obvious to anyone who can
          see it sitting on the picture. `aria-current` marks the winner rather
          than radio semantics: these act the moment they are reached, they do
          not hold a value pending submission. */}
      <fieldset className={styles.column}>
        <legend className={styles.legend}>Choose the view</legend>
        {clips.map((clip, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={clip.id}
              type="button"
              aria-current={active || undefined}
              // The visible label is two words; the description is what makes
              // it a choice between views rather than four nouns.
              aria-label={`${clip.label} — ${clip.description}`}
              className={`${styles.label} caps-label`}
              data-active={active || undefined}
              // Pointer rather than mouse, so a pen commits like a cursor does.
              // A touch tap fires this and then the click; both ask for the same
              // clip and the act ignores a request for what is already playing,
              // so the second one costs nothing.
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                onSelect(index);
              }}
              onClick={() => onSelect(index)}
              // Keyboard arrives here by tabbing, and focus alone is enough:
              // moving through the four plays each in turn, which is the same
              // bargain the cursor gets.
              onFocus={() => onSelect(index)}
            >
              <span className={styles.rule} aria-hidden />
              <span className={styles.text}>{clip.label}</span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
