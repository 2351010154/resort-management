// A folio with nothing on it, for the suites that are not about money.
//
// This was the binding. `M4` had no ledger — `cancellation-calculator.ts` opens
// by saying it computes charges and persists none of them, and
// `schema/booking.ts` argues the storage side of it — so zero was the true state
// of the system rather than a value chosen to let the guard pass. The
// alternative was to leave the check-out guard uncalled until there was a
// ledger, and it is the worse one: a guard wired in at the end is a guard whose
// first exercise is in production.
//
// `booking.module.ts` now points `FOLIO_PORT` at `FolioService`, which sums the
// postings. **This class stays as the port's simplest implementation**, and it
// is the one four lifecycle suites and the guard's own spec construct: those
// files drive holds, no-shows, stay lengths and the transition table, and none
// of them has a folio, a `system_config` row or an application booted to reach
// either. A stand-in written afresh in each of them would be five copies of this
// file with no name, and the day the port grows a method the compiler would
// point at five places instead of one.

import type { VndAmount } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import type { FolioPort } from "./folio.port.js";

/** Reports every folio settled, because it has no lines to sum. */
@Injectable()
export class FolioStubService implements FolioPort {
  // Not `async`, though the port is: there is nothing here to await, and a
  // resolved promise is what an `async` body returning a literal produces
  // anyway. The signature is the port's and is satisfied either way.
  getBalance(_bookingId: string): Promise<VndAmount> {
    return Promise.resolve(0n);
  }
}
