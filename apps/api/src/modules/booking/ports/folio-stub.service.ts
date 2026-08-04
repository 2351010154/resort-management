// The `M4` answer to "what does this booking owe": nothing, because there is no
// ledger yet to owe it to.
//
// A stub and not a stand-in. `M4` computes cancellation, no-show and early-
// departure charges and persists none of them — `cancellation-calculator.ts`
// opens with that and `schema/booking.ts` argues the storage side of it — so
// there is genuinely no outstanding balance in the system to report. Zero here
// is the true state of a milestone with no folio, not a value chosen to let the
// guard pass.
//
// The alternative was to leave the check-out guard uncalled until `M6`, and it
// is the worse one: a guard wired in at the end is a guard whose first exercise
// is in production. This way the transition calls it, the spec proves it refuses
// a non-zero balance, and `M6` changes one line in `booking.module.ts`.

import type { VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import type { FolioPort } from "./folio.port.js";

/**
 * Reports every folio settled. **`M6` replaces the binding, not this class** —
 * `booking.module.ts` is where `FOLIO_PORT` points at it.
 */
@Injectable()
export class FolioStubService implements FolioPort {
  // Not `async`, though the port is: there is nothing here to await, and a
  // resolved promise is what an `async` body returning a literal produces
  // anyway. The signature is the port's and is satisfied either way.
  getBalance(_bookingId: string): Promise<VndAmount> {
    return Promise.resolve(0n);
  }
}
