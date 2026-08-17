// What a folio close hands its points to, for the suites that are not about
// points.
//
// `FolioService` reaches `LoyaltyService` on one path and one only — the close,
// once it has committed — so a suite either agrees accounts or it does not, and
// the two want opposite stand-ins. Both are here rather than in each file
// because the choice between them is the interesting part and it should read as
// a choice.
//
// Neither is `undefined as unknown as LoyaltyService`. That cast would switch
// off checking at exactly the seam that has just moved, and the day a sweep
// started closing, the failure would be `Cannot read properties of undefined`
// from inside it rather than a sentence naming what changed —
// `no-announcement.ts` makes the same argument about the same kind of cast.

import type { Database } from "../src/database/database.module.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { LoyaltyService } from "../src/modules/guest/loyalty.service.js";
import type { OpsAlertService } from "../src/modules/notification/ops-alert.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/**
 * Points nobody in this suite earns — for a suite that agrees no account.
 *
 * Typed through `Pick`, so the method name and its signature are still checked
 * against the real class: a rename that leaves this file behind is a compile
 * error rather than a runtime one. The widening that follows is to the class
 * itself, which is as far as it can go — `FolioService` takes the concrete
 * type, and a class with private members has no structural stand-in.
 */
export const noAccrual = {
  accruePoints: () => {
    throw new Error(
      "LoyaltyService.accruePoints was reached from a suite that agrees no " +
        "folio, so no stay has finished and there is nothing to have earned. " +
        "Either a path started closing accounts, or this suite now needs a " +
        "real accrual.",
    );
  },
} satisfies Pick<LoyaltyService, "accruePoints"> as unknown as LoyaltyService;

/**
 * The real accrual, wired to an on-call endpoint that must never be reached —
 * for a suite that agrees accounts and is about something else.
 *
 * Real because the close is what these suites drive, and a stand-in there would
 * leave them proving that a close works against a collaborator that is not the
 * one production hands it. The stays they close are the desk's own — no
 * `booking.user_id`, so nothing is credited and nothing is written — and that
 * is itself worth running rather than stubbing out.
 *
 * The alerter throws by name because a page here means the accrual failed, and
 * a suite about closing folios should hear about that rather than carry on.
 */
export function accrualOn(db: Database): LoyaltyService {
  return new LoyaltyService(
    new TransactionRunner(db),
    new SystemConfigService(),
    {
      page: () => {
        throw new Error(
          "OpsAlertService.page was reached because a loyalty accrual failed " +
            "after a folio close in a suite that is not about loyalty",
        );
      },
    } as unknown as OpsAlertService,
  );
}
