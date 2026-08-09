// The row's first values, from the environment — §8: the four inputs are
// "system-configuration rows, seeded from environment at boot".
//
// **Not `database/seed/`.** That is `FR-INV-05`'s demo seed: it empties the
// property and every stay standing against it, and `seed.script.ts` refuses to
// run under `NODE_ENV=production` for exactly that reason. This row has to exist
// in production above all, and it destroys nothing, so it cannot live behind
// that refusal.
//
// **It writes once and never again.** `on conflict do nothing`, so a second boot
// leaves an `ADMIN`'s edit exactly where it is — the environment supplies the
// figures a property starts with, and the row is the authority from then on.
// That is what makes restarts safe rather than merely tolerable: a seed that
// wrote on every boot would silently roll back every configuration change at the
// next deploy, which is §8's mis-invoice arriving through a restart.
//
// **A failure here is logged and does not stop the boot.** The tempting
// alternative — throw, and let the process die — trades a recoverable state for
// an unrecoverable one. Unseeded, `SystemConfigService` refuses every posting
// loudly and an `ADMIN` can still set the row; dead, the API answers nothing at
// all, including the health endpoint and every route that has nothing to do with
// money. It is also the honest behaviour for a database whose migrations have
// not run yet, which is a state the process cannot fix and should report rather
// than crash on. Nothing is swallowed: the failure is an `error` line, and the
// first posting says the same thing again.

import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../../config/env.js";
import { type Database, DRIZZLE } from "../../database/database.module.js";
import { systemConfig } from "../../database/schema/config.js";

@Injectable()
export class SystemConfigSeeder implements OnApplicationBootstrap {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    // Contextualised here rather than declared with `@InjectPinoLogger`, on the
    // grounds `job-scheduler.service.ts` gives for the same choice.
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("SystemConfigSeeder");
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // `returning` is what distinguishes "written" from "already there". A
      // conflict that did nothing returns no rows, and an operator who changed
      // `REDUCED_VAT_RATE_BPS` and restarted needs to be told that it had no
      // effect rather than left to infer it from an invoice.
      const written = await this.db
        .insert(systemConfig)
        .values({
          standardVatRateBps: this.env.STANDARD_VAT_RATE_BPS,
          reducedVatRateBps: this.env.REDUCED_VAT_RATE_BPS,
          reducedVatFrom: this.env.REDUCED_VAT_FROM ?? null,
          reducedVatTo: this.env.REDUCED_VAT_TO ?? null,
          vatIncludesServiceCharge: this.env.VAT_INCLUDES_SERVICE_CHARGE,
          serviceChargeRateBps: this.env.SERVICE_CHARGE_RATE_BPS,
          businessDateRolloverHour: this.env.BUSINESS_DATE_ROLLOVER_HOUR,
        })
        .onConflictDoNothing()
        .returning({ seeded: systemConfig.isTheConfiguration });

      this.logger.info(
        written.length > 0
          ? "system configuration seeded from the environment"
          : "system configuration already set — the environment's figures were not applied, and the row is the authority from here on",
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        "could not seed the system configuration — every posting refuses until an ADMIN sets it",
      );
    }
  }
}
