// What `booking` is allowed to know about money it does not own.
//
// `booking-state-machine.md` §4 refuses a check-out whose folio does not
// balance, and §3 makes the same demand — "Folio must balance". The ledger that
// would answer it is `M6`'s: `cancellation-calculator.ts` and
// `schema/booking.ts` both say why no balance is stored today, and the reason
// applies here unchanged. A balance this module computed would be a second place
// for a balance to live.
//
// So the dependency is inverted at the boundary instead. `booking` declares the
// one question it needs answered; `M6` arrives with a service that answers it
// from the ledger, and `booking.module.ts` swaps which one is bound. Nothing in
// the check-out path changes when that happens, which is the point — the guard,
// its spec and the transition around it are written once, against the interface,
// and the milestone that brings the folio does not reopen them.

import type { VndAmount } from "@mariva/shared";

/**
 * The folio, as the check-out path sees it.
 *
 * One method, and deliberately not a fuller ledger interface. A port is the
 * caller's list of needs, not the provider's list of capabilities: the moment it
 * grew a `postCharge` this module had no use for, `M6` would be shaped by
 * `booking`'s guess at it rather than by the folio it is actually building.
 */
export interface FolioPort {
  /**
   * What the booking still owes, in đồng. Zero is a settled folio.
   *
   * Signed, for the reason `money.ts` gives: an over-payment awaiting refund is
   * a negative balance, and §4 refuses that too — "Balance ≠ 0", not "> 0". A
   * guest owed money at the desk is as unsettled as one who owes it.
   */
  getBalance(bookingId: string): Promise<VndAmount>;
}

/** DI token. An interface is a type and erases; the binding needs a value. */
export const FOLIO_PORT = Symbol("FOLIO_PORT");
