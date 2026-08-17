// What the booking path asks about §7's ladder, for the suites that are not
// about it.
//
// `BookingService` derives a tier at the moment of sale so
// `stay-quote.service.ts` can gate the member discount on it. That reaches
// `TierDerivationService` on one path and one only — a stay whose
// `booking.user_id` is set — so a suite either sells to a signed-in guest or it
// does not.
//
// The real service either way, rather than a stand-in. It is two indexed reads
// and a configuration lookup on the executor the caller already has; a stub
// would leave every suite here proving that a booking prices against a
// collaborator production does not hand it, and the one thing worth proving —
// that a desk sale derives nothing and a guest's sale derives their own tier —
// is exactly what a stub would answer for.
//
// A suite that sells to a signed-in guest therefore needs a `system_config` row,
// because that is where the thresholds live. Without one the derivation says so
// by name rather than assuming a ladder, which is `system-config.service.ts`'s
// rule and not this file's to soften.

import type { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { TierDerivationService } from "../src/modules/guest/tier-derivation.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/**
 * The derivation, over the same day the suite's own clock reports.
 *
 * The clock is the caller's because §7's window runs to the property's today,
 * and a suite that stopped the clock to book a stay in 2027 must measure the
 * trailing twelve months from the same date — a derivation reading the wall
 * clock would look at a window a decade away from the fixture.
 */
export function tiersAt(clock: BusinessDateService): TierDerivationService {
  return new TierDerivationService(new SystemConfigService(), clock);
}
