/** A synchronous lock shared by every booking-action submission path. */
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
