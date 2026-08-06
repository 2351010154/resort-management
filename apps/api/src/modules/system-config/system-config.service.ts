// The tax figures a posting reads, and the refusal it makes when they do not
// cover the date it is posting on — `FR-IDN-03`, `FR-FOL-02`, and
// `property-and-tariff.md` §8.
//
// Four things here are decisions rather than mechanics.
//
// **It is `SystemConfigService` and it lives under `modules/`, deliberately not
// beside `src/config/`.** That folder owns the *environment*: one zod schema
// parsed once at boot, ambient, and identical for the whole life of the process.
// This owns the `system_config` row: database-backed, edited by an `ADMIN`
// without a deploy, and legitimately different on the next read. They are
// opposite in lifetime and in who may change them, so a second class called
// `ConfigService` would be a name every call site had to disambiguate — and the
// place it would first be got wrong is a posting path reading a rate. The class
// is named after the table, which is the only unambiguous name available.
//
// **Nothing is cached, and there is nowhere for a cache to go.** `FR-FOL-02`
// says the rates are "read from config at posting time"; a value held between
// postings is a rate an `ADMIN` changed and an invoice that did not notice.
//
// **Every read takes the caller's executor.** A posting decomposes one gross
// figure into charge, service charge and tax inside one transaction, and those
// lines must sum back to the figure exactly. Reading through the caller's
// executor is what puts the rate in the same snapshot as the rows it is applied
// to; a service that reached for the pool itself would read a second connection's
// view of a row somebody is editing.
//
// **The three tax values come back together, from one row, in one query.** They
// are not three getters, and that is the same argument `schema/config.ts` makes
// for one row rather than three keys: two reads can straddle a committed `ADMIN`
// edit — `READ COMMITTED` takes a fresh snapshot per statement, so being inside
// one transaction does not prevent it — and produce a posting computed half
// under the old configuration and half under the new. That is the silent
// mis-invoice §8 exists to prevent, arriving by a different door.

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type { DbExecutor } from "../../database/database.module.js";
import {
  systemConfig,
  type SystemConfigRow,
} from "../../database/schema/config.js";

/**
 * What a posting needs to split a gross figure — all of it, read at once.
 *
 * Rates are basis points, whole integers: 800 is 8%. Never a float, for the
 * reason `NFR-12` puts money on integers.
 */
export interface TaxRules {
  readonly vatRateBps: number;
  readonly serviceChargeRateBps: number;
  /** Whether the VAT base includes the service-charge line — §8, `ASM-01`. */
  readonly vatIncludesServiceCharge: boolean;
}

@Injectable()
export class SystemConfigService {
  /**
   * The tax figures that apply on one business date.
   *
   * **Refuses rather than assumes**, and the refusal is the whole point of the
   * method taking a date at all. The row carries one VAT rate and a window of
   * dates it covers. With the window unset — both ends null, which is how a
   * property with no relief-period answer runs — the configured rate applies to
   * every date and nothing is refused. With the window *set* and the date
   * outside it, there is no second rate to fall back to: `ASM-01` files the rate
   * and the relief period as two answers the accountant still owes, so inventing
   * a standard rate here would settle that question by guessing.
   *
   * A stopped posting is recoverable at a front desk in the time it takes an
   * `ADMIN` to edit a row. A mis-issued invoice is a legal document a third
   * party cannot quietly reissue.
   */
  async taxRules(exec: DbExecutor, on: StayDate): Promise<TaxRules> {
    const configured = await this.configuration(exec);

    if (!covers(configured, on)) {
      throw new ORPCError("CONFLICT", {
        message:
          `No VAT rate is configured for ${on.toString()}: the reduced-VAT window ` +
          `${describeWindow(configured)}, and this date falls outside it. Nothing ` +
          "will assume a rate for it — an ADMIN must set the system configuration " +
          "to cover this date before anything can be charged on it.",
      });
    }

    return {
      vatRateBps: configured.vatRateBps,
      serviceChargeRateBps: configured.serviceChargeRateBps,
      vatIncludesServiceCharge: configured.vatIncludesServiceCharge,
    };
  }

  /**
   * The hour the property's own day rolls over — §2's operating clock.
   *
   * A separate read from {@link taxRules} rather than a fourth field on it,
   * because it answers a different question at a different moment: what day it
   * is, asked before a posting exists. It has no window and no date, so nothing
   * about it can be refused for a date.
   */
  async businessDateRolloverHour(exec: DbExecutor): Promise<number> {
    return (await this.configuration(exec)).businessDateRolloverHour;
  }

  /**
   * The one row, or a refusal.
   *
   * No row means nobody has supplied the figures — the table has no defaults
   * precisely so that a half-configured property is not a row carrying a rate
   * nobody chose. The same shape `stay-quote.service.ts` takes for a missing
   * `property_tariff`, and a plain `Error` for the same reason: this is not a
   * request anybody could have made differently, it is a deployment that has not
   * been configured.
   */
  private async configuration(exec: DbExecutor): Promise<SystemConfigRow> {
    const [configured] = await exec.select().from(systemConfig).limit(1);

    if (!configured) {
      throw new Error(
        "system_config holds no row, so there is no VAT rate, no service-charge " +
          "rate and no tax-base rule to post against. An ADMIN must set the " +
          "system configuration — nothing here will assume one.",
      );
    }

    return configured;
  }
}

/**
 * Whether the configured rate applies on a date.
 *
 * Both ends are inclusive, and null is *unbounded* rather than missing: a window
 * with neither end set covers every date, which is the seeded state.
 */
function covers(configured: SystemConfigRow, on: StayDate): boolean {
  const { reducedVatFrom, reducedVatTo } = configured;

  if (reducedVatFrom !== null && on.compare(parseDate(reducedVatFrom)) < 0) {
    return false;
  }

  return reducedVatTo === null || on.compare(parseDate(reducedVatTo)) <= 0;
}

/** The window as an operator would read it back, whichever ends are set. */
function describeWindow({
  reducedVatFrom,
  reducedVatTo,
}: SystemConfigRow): string {
  if (reducedVatFrom !== null && reducedVatTo !== null) {
    return `runs ${reducedVatFrom} to ${reducedVatTo}`;
  }

  return reducedVatFrom !== null
    ? `opens ${reducedVatFrom} and has no end`
    : `has no start and closes ${reducedVatTo}`;
}
