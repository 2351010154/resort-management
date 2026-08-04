// `FR-BOOK-01`'s acceptance is that every illegal transition is refused, and
// "every" is 42 cells. So the grid is transcribed from
// `booking-state-machine.md` §2 and the suite is generated from it, rather than
// written as the handful of cases somebody thought of.
//
// The transcription is deliberately a second copy of the table and not an import
// of `LEGAL_TRANSITIONS`. A spec that read the same structure the code reads
// would assert that the code agrees with itself, which every implementation
// does. This one asserts it agrees with the document, and it is written in the
// document's own notation so the two can be compared by eye.

import { BOOKING_STATES, type BookingState } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import {
  applyTransition,
  CREATABLE_STATES,
  isLegalTransition,
} from "./state-machine.js";

/** `✔` legal · `✘` rejected with 409 · `—` the diagonal, an idempotent re-apply. */
type Cell = "✔" | "✘" | "—";

const COLUMNS = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly BookingState[];

/** `null` is §2's *(new)* row — a booking that does not exist yet. */
const ROWS = [null, ...COLUMNS] as const;

// §2, cell for cell. Columns in the order of COLUMNS above.
const GRID: readonly (readonly Cell[])[] = [
  /* (new)       */ ["✔", "✔", "✘", "✘", "✘", "✘"],
  /* HELD        */ ["—", "✔", "✘", "✘", "✔", "✘"],
  /* CONFIRMED   */ ["✘", "—", "✔", "✘", "✔", "✔"],
  /* CHECKED_IN  */ ["✘", "✘", "—", "✔", "✘", "✘"],
  /* CHECKED_OUT */ ["✘", "✘", "✘", "—", "✘", "✘"],
  /* CANCELLED   */ ["✘", "✘", "✘", "✘", "—", "✘"],
  /* NO_SHOW     */ ["✘", "✘", "✔", "✘", "✘", "—"],
];

function thrownBy(from: BookingState | null, to: BookingState): unknown {
  try {
    applyTransition(from, to);
    return null;
  } catch (error) {
    return error;
  }
}

describe("the transition table", () => {
  // A seventh state, or a renamed one, has to break something. Without this the
  // grid above would simply stop covering the vocabulary and nothing would say
  // so — the new state's row would be missing and every existing assertion
  // would still pass.
  it("covers every state the vocabulary declares", () => {
    expect([...COLUMNS]).toStrictEqual([...BOOKING_STATES]);
    expect(GRID).toHaveLength(ROWS.length);
    for (const row of GRID) {
      expect(row).toHaveLength(COLUMNS.length);
    }
  });

  it("agrees with §2 on which states a booking may be created in", () => {
    const creatable = COLUMNS.filter((_, column) => GRID[0][column] === "✔");
    expect([...CREATABLE_STATES]).toStrictEqual(creatable);
  });
});

describe.each(
  ROWS.flatMap((from, row) =>
    COLUMNS.map((to, column) => ({
      from,
      to,
      cell: GRID[row][column],
      label: `${from ?? "(new)"} → ${to}`,
    })),
  ),
)("$label", ({ from, to, cell }) => {
  if (cell === "✔") {
    it("is legal, and lands in the state asked for", () => {
      expect(isLegalTransition(from, to)).toBe(true);
      expect(applyTransition(from, to)).toBe(to);
    });
    return;
  }

  if (cell === "—") {
    // §4's idempotency guard. A retried request, a double-clicked button and a
    // job that ran twice all arrive as the transition that already happened.
    it("is already applied, so it returns the current state rather than erroring", () => {
      expect(isLegalTransition(from, to)).toBe(true);
      expect(applyTransition(from, to)).toBe(to);
    });
    return;
  }

  it("is rejected with 409 IllegalTransition", () => {
    expect(isLegalTransition(from, to)).toBe(false);

    const error = thrownBy(from, to);
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe("CONFLICT");
    expect((error as ORPCError<string, unknown>).message).toContain(
      "IllegalTransition",
    );
  });
});
