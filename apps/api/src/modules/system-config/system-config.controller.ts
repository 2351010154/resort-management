// The two routes behind `system.config` — `FR-IDN-03`, which says the VAT rate
// and its applicability window, the tax-base rule, the retention floor, the
// business-date rollover and the gateway credentials are "data, editable by
// ADMIN without a deploy".
//
// The matrix row gives `MANAGER` 👁 and `ADMIN` ✅, and that split is the second
// argument to `@RequiresCapability` and nothing else. No role is named in this
// file and no handler asks who is calling: a manager may open the screen and
// read what a posting will charge, and only an `ADMIN` may change it.
//
// **Two figures the row's words promise are not here, and their absence is the
// honest answer rather than an omission.** The retention floor `N` is `ASM-02`,
// the lawyer's unanswered question, and `schema/config.ts` argues that seeding a
// provisional retention window either deletes records the law requires kept or
// keeps ID scans past the window `R3#6` asserts is empty. Gateway credentials
// stay in the environment by the same file's decision: a secret in a table an
// `ADMIN` screen reads is a secret with a wider audience than the process that
// spends it. There is therefore no credential this route could mask, because
// there is none it could reach — and `onWire` below states the six fields it
// answers with by name, so a column added to that table later does not join the
// response by being spread into it.
//
// **A read opens a transaction too.** `database.module.ts` draws the boundary at
// the controller and hands one a `TransactionRunner` rather than the Drizzle
// client, precisely so that a controller cannot quietly run a query of its own.
// The read gains nothing from the boundary and pays almost nothing for it; the
// edit genuinely needs it, because it locks the row it is about to overwrite.
//
// **Nothing is cached, here or under here.** That is the requirement rather
// than an implementation detail: an edit has to be read by the next posting and
// not by the next restart, and there is nowhere on this path for a value to be
// held between the two. It holds for all six figures. The tax rates are read by
// `folio.service.ts` at the moment it splits a gross figure, and the rollover
// hour is read by `BusinessDateService` on every question about what day it is
// — so a `PATCH` here moves the property's own day on the very next request,
// which is what §2 means by "changes one row, not a deploy".

import { contract, type StayDate } from "@mariva/shared";
import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { RequiresCapability } from "../../common/auth/access.decorators.js";
import type { SystemConfigRow } from "../../database/schema/config.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import { SystemConfigService } from "./system-config.service.js";

@Controller()
export class SystemConfigController {
  constructor(
    private readonly configuration: SystemConfigService,
    private readonly transactions: TransactionRunner,
  ) {}

  /** Every figure a posting will read, as the screen shows them. */
  @RequiresCapability("system.config", "read")
  @Implement(contract.systemConfig.read)
  read() {
    return implement(contract.systemConfig.read).handler(async () =>
      onWire(
        await this.transactions.run((exec) => this.configuration.settings(exec)),
      ),
    );
  }

  /**
   * The figures the caller named, changed — and the whole configuration back.
   *
   * The two window ends cross from the wire's decoded calendar date to the ISO
   * text the column holds here, at the controller, which is where `stay-date.ts`
   * says the crossing belongs. `undefined` and `null` survive that crossing as
   * themselves, because the difference between them is the difference between
   * leaving an end alone and unbounding it.
   */
  @RequiresCapability("system.config")
  @Implement(contract.systemConfig.update)
  update() {
    return implement(contract.systemConfig.update).handler(async ({ input }) =>
      onWire(
        await this.transactions.run((exec) =>
          this.configuration.update(exec, {
            ...input,
            reducedVatFrom: onColumn(input.reducedVatFrom),
            reducedVatTo: onColumn(input.reducedVatTo),
          }),
        ),
      ),
    );
  }
}

/**
 * A window end as its column holds it: nine characters, or null, or nothing at
 * all.
 */
function onColumn(
  date: StayDate | null | undefined,
): string | null | undefined {
  if (date === undefined) {
    return undefined;
  }

  return date === null ? null : date.toString();
}

/**
 * The configuration as the wire carries it — the six figures, named.
 *
 * Named rather than spread, and that is the whole security property of this
 * file. A spread of the row would carry `is_the_configuration`, which is a
 * primary-key pin and not a setting, and it would carry whatever column the
 * table gains next — including, if somebody ever disagrees with
 * `schema/config.ts`, a credential. A stated list cannot leak a column that did
 * not exist when it was written.
 */
function onWire(configured: SystemConfigRow) {
  return {
    vatRateBps: configured.vatRateBps,
    reducedVatFrom: configured.reducedVatFrom,
    reducedVatTo: configured.reducedVatTo,
    vatIncludesServiceCharge: configured.vatIncludesServiceCharge,
    serviceChargeRateBps: configured.serviceChargeRateBps,
    businessDateRolloverHour: configured.businessDateRolloverHour,
  };
}
