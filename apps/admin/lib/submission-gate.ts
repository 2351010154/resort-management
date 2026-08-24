/* The one lock every console write is admitted through.
 *
 * In `lib` rather than beside any one screen because four families now hold a
 * mutation behind it — a stay action, a folio posting, a refund and a room
 * reopen — and a copy of the protocol per screen is how one of them ends up
 * checking only `isPending` and taking the double press.
 *
 * A `useRef` satisfies {@link SubmissionGate} as it stands, so the caller keeps
 * holding its gate the way it holds any other mutable box across renders.
 */

/** A synchronous lock shared by every console submission path. */
export interface SubmissionGate {
  current: boolean;
}

/**
 * Admits exactly one caller until that caller releases the gate.
 *
 * React mutation state updates on a later render; this gate changes in the
 * same JavaScript turn, so a second Enter/click cannot reach the mutation.
 */
export function enterSubmissionGate(gate: SubmissionGate): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

export function leaveSubmissionGate(gate: SubmissionGate): void {
  gate.current = false;
}
