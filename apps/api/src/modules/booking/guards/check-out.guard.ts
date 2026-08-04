// §4's one rejection against `CHECKED_IN → CHECKED_OUT`: the folio has to
// balance — `booking-state-machine.md`, and §3's transition row says the same.
//
// Pure, like the check-in guards beside it, and for the same reason: the balance
// arrives as an argument. Who produced it is `folio.port.ts`'s question, and the
// answer changes at `M6` without this file changing at all.
//
// §4's full sentence is "Balance ≠ 0 and no approved deferred settlement". The
// second clause is **not implemented**, and its absence is not an omission being
// deferred quietly: an approved deferred settlement is a record — who approved
// it, against which booking, for how much — and there is no table holding one at
// `M4`, nor a capability in `rbac-matrix.md` granting the approval. Writing the
// clause now would mean inventing both. It belongs with the folio.

import { formatVnd, type VndAmount } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";

/**
 * Why a check-out was refused — the counterpart to `CHECK_IN_REFUSALS`, and one
 * value rather than a list because §4 files exactly one guard here.
 */
export const FOLIO_NOT_SETTLED = "FOLIO_NOT_SETTLED" as const;

export type CheckOutRefusal = typeof FOLIO_NOT_SETTLED;

/**
 * Refuses a check-out over an unsettled folio.
 *
 * `!== 0n` and not `> 0n`. §4 says "Balance ≠ 0", and the two directions are
 * both real: a guest who has overpaid is owed a refund at the desk, and a
 * check-out that walked past it would close the stay on money the property is
 * holding and the guest has left without. `money.ts` chose a signed amount for
 * exactly this.
 */
export function validateFolioSettled(balance: VndAmount): void {
  if (balance !== 0n) {
    throw new ORPCError("CONFLICT", {
      message: `The folio is not settled — the balance is ${formatVnd(balance)}`,
      data: { code: FOLIO_NOT_SETTLED },
    });
  }
}
