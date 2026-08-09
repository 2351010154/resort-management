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
// **The edit path is here rather than in a service of its own.** Reading a rate
// and changing one are opposite acts with opposite audiences — a posting and an
// `ADMIN` screen — and the argument for keeping them in one class is that the
// window's invariant belongs to whichever code writes the row. Split in two,
// the writer would either re-derive "a window that closes before it opens
// covers no date" or leave it to a `CHECK` to report as a 500. The reads are
// unaffected by the write's existence: only the edit takes a row lock, and a
// plain `SELECT` never queues behind one.
//
// **The edit files a change-log row, and files it here rather than at the
// controller.** `audit-actor.ts` states the failure it is avoiding: a mechanism
// whose omission is silent will not reach the coverage `FR-AUD-01` asks for,
// because a write that forgot to log still succeeds and still returns. Keeping
// the entry inside the method that performs the write leaves nothing for a
// later caller to remember. It also keeps the pre-image honest — it is captured
// by the statement that takes the lock, so it is the row this update overwrote
// and not one that was true a moment earlier.
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
import { getTableColumns, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/database.module.js";
import {
  systemConfig,
  type SystemConfigRow,
} from "../../database/schema/config.js";
import { AuditService } from "../audit/audit.service.js";

/** The row as it is written, which is the row as it is read minus the pin. */
type SystemConfigValues = typeof systemConfig.$inferInsert;

/** The physical table, as Postgres names it and as the log records it. */
const AUDITED_TABLE = "system_config";

const COLUMNS = getTableColumns(systemConfig);

/**
 * The row as the change log addresses and records it.
 *
 * **`state` is Postgres's own rendering of the whole row, as text, never
 * parsed.** `audit.service.ts` argues it: a `to_jsonb` of the table audits a
 * column a later migration adds on the day it exists, and text that nothing
 * reads cannot lose a digit on the way through a JavaScript `number`.
 *
 * **`id` is the derived address of a table that has no surrogate key.**
 * `audit_entry.row_id` is a `uuid` because every *many-rowed* table in this
 * schema addresses its rows by one. This table has no such column on purpose —
 * `schema/config.ts` pins its primary key to a boolean precisely so that a
 * second row cannot exist — so its address is its name, and `md5` is that name
 * in the shape the column requires. Nothing joins on `row_id`; the column has
 * no foreign key, and `table_name` alone already identifies this row
 * completely, so what is asked of the value is that it be the same one every
 * time.
 *
 * It is computed by Postgres rather than written out as a literal, and that is
 * the point of choosing a derivation over a constant somebody picked. A reader
 * confirms it with `select md5('system_config')::uuid`, the other single-row
 * table gets its own address from the same rule the day it needs one, and the
 * database-side backstop `FR-AUD-01` asks for can reach the identical value
 * from `md5(TG_TABLE_NAME)::uuid` — which a number living in this file could
 * not give it.
 */
const SNAPSHOT = {
  id: sql<string>`md5('system_config')::uuid`,
  state: sql<string>`to_jsonb(system_config)::text`,
};

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

/**
 * A change to the configuration, naming only the figures it changes.
 *
 * An absent field is one the caller did not mention and is left exactly as it
 * stands; a window end of `null` is one they unbounded. The two dates arrive
 * here as ISO text because that is what the columns hold — the crossing from
 * the wire's decoded calendar date happens at the controller, once, where it
 * can be seen.
 */
export interface ConfigurationEdit {
  readonly vatRateBps?: number;
  readonly reducedVatFrom?: string | null;
  readonly reducedVatTo?: string | null;
  readonly vatIncludesServiceCharge?: boolean;
  readonly serviceChargeRateBps?: number;
  readonly businessDateRolloverHour?: number;
}

@Injectable()
export class SystemConfigService {
  /**
   * `AuditService` is injected by the container and defaulted for everything
   * else, which is a decision and not a convenience.
   *
   * The reads on this class have no dependencies at all, and a dozen suites
   * rely on that: `BusinessDateService` and `FolioService` are constructed
   * directly in tests that never edit a figure, and each of them hands over a
   * `new SystemConfigService()`. Making the log a required argument would
   * rewrite fifteen files that have nothing to do with editing configuration,
   * to pass a collaborator none of them use.
   *
   * The default is not a stub. `AuditService` is stateless and takes no
   * constructor arguments of its own, so `new AuditService()` is the same
   * object `AuditModule` provides — and because that module is `@Global()`, the
   * container supplies it here without this module importing anything. A
   * missing provider would still be a boot failure rather than a silent
   * omission: the parameter's type is what Nest resolves against, default or
   * not.
   */
  constructor(private readonly audit: AuditService = new AuditService()) {}

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
   *
   * `BusinessDateService` is the only caller and every business date the
   * property stamps comes through it, so this is what decides what day the
   * property is on. It is read on each call for the same reason the tax figures
   * are: an hour held between calls is an hour an `ADMIN` changed and a night
   * audit that did not notice, and `business-date.service.ts` argues that at
   * length where the alternative was actually available.
   */
  async businessDateRolloverHour(exec: DbExecutor): Promise<number> {
    return (await this.configuration(exec)).businessDateRolloverHour;
  }

  /**
   * Every figure as it stands — what the `ADMIN` screen behind `system.config`
   * reads before it changes one of them.
   *
   * The whole row rather than the three a posting takes, because the screen has
   * to show the window and the clock as well, and because a screen that read
   * the figures in two calls could render half of one configuration beside half
   * of another.
   */
  async settings(exec: DbExecutor): Promise<SystemConfigRow> {
    return await this.configuration(exec);
  }

  /**
   * Changes the figures the caller named, leaves the rest where they stand, and
   * records who.
   *
   * **Read under a lock, then written, then logged — all in the caller's
   * transaction.** The pre-image is captured by the same statement that takes
   * the lock, which is what makes it the row this update actually overwrites
   * rather than one a concurrent editor replaced in between; `rate-plan.service.ts`
   * makes the identical argument for the identical device. The lock earns its
   * keep twice over here, because the window's invariant is a statement about
   * two columns and a `PATCH` may name only one of them — validating the pair
   * against a row somebody else is part-way through changing would let through
   * a window that closes before it opens. A plain `SELECT` is not blocked by
   * `for update`, so a posting reading the rates at the same moment waits for
   * nothing.
   *
   * **The log entry is written on this executor and therefore in this
   * transaction.** `audit.service.ts` argues why that matters more here than
   * anywhere: an entry that committed independently would describe a rate the
   * property never charged if the edit then rolled back, and a rate change with
   * no entry is a change nobody can find. Neither outcome reports itself. These
   * figures also decline an `updated_at`/`updated_by` pair of their own — the
   * `schema/audit.ts` header names this table as the promise made in exchange —
   * so this row is the only attribution a configuration change ever gets.
   *
   * **The bounds on each figure are not re-checked here.**
   * `updateSystemConfigInput` mirrors the three `CHECK` constraints
   * `schema/config.ts` puts on single columns, so a rate above 100% or an hour
   * of 24 is a 400 naming the field before it reaches this method — and the
   * constraints are what make that true of every writer, including a `psql`
   * session. The fourth constraint is the window's, and it is the one thing
   * neither the wire schema nor a single column can see.
   */
  async update(
    exec: DbExecutor,
    edit: ConfigurationEdit,
  ): Promise<SystemConfigRow> {
    const changes = namedIn(edit);

    // An edit that names nothing changes nothing, and takes no lock and files
    // no entry on the way. The contract already refuses an empty body; this is
    // here because Drizzle cannot build an empty `set`, and because a log row
    // for a gesture that moved no figure is an edit an investigation would have
    // to rule out. `rate-plan.service.ts` declines the same call for the same
    // two reasons.
    if (Object.keys(changes).length === 0) {
      return await this.configuration(exec);
    }

    const [before] = await exec
      .select({ ...SNAPSHOT, ...COLUMNS })
      .from(systemConfig)
      .limit(1)
      .for("update");

    if (!before) {
      throw new Error(NOTHING_IS_CONFIGURED);
    }

    const proposed = { ...before, ...changes };

    if (closesBeforeItOpens(proposed)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          `A reduced-VAT window opening ${proposed.reducedVatFrom} and closing ` +
          `${proposed.reducedVatTo} covers no date at all, so every posting ` +
          "inside it would be refused. Set the end on or after the start, or " +
          "clear one of them to leave that side of the window unbounded.",
      });
    }

    // No `where`: the table's primary key is a boolean a `CHECK` pins to true,
    // so there is one row to update and naming it would restate the constraint
    // rather than narrow anything.
    const [after] = await exec
      .update(systemConfig)
      .set(changes)
      .returning({ ...SNAPSHOT, ...COLUMNS });

    // The row is locked above, so the update cannot have found nothing.
    const written = after!;

    await this.audit.record(exec, AUDITED_TABLE, [
      {
        rowId: before.id,
        action: "UPDATE",
        before: before.state,
        after: written.state,
      },
    ]);

    // The two audit-only fields are dropped rather than handed back. They are
    // how the log addresses and stores the row, not figures the property set,
    // and a caller that spread this object onto a response would put a whole
    // row snapshot on the wire.
    const { id, state, ...configured } = written;

    return configured;
  }

  /**
   * The one row, or a refusal.
   *
   * No row means nobody has supplied the figures — the table has no defaults
   * precisely so that a half-configured property is not a row carrying a rate
   * nobody chose. The same shape `stay-quote.service.ts` takes for a missing
   * `property_tariff`, and a plain `Error` for the same reason: this is not a
   * request anybody could have made differently, it is a deployment that has not
   * been configured. That holds for the `ADMIN` screen too — the row arrives
   * from the environment at boot, so its absence is a database the seeder could
   * not write rather than a figure an operator forgot, and it is not repaired by
   * a `PATCH` against a row that is not there.
   */
  private async configuration(exec: DbExecutor): Promise<SystemConfigRow> {
    const [configured] = await exec.select().from(systemConfig).limit(1);

    if (!configured) {
      throw new Error(NOTHING_IS_CONFIGURED);
    }

    return configured;
  }
}

/** Said by the reads and by the edit alike, so it is written once. */
const NOTHING_IS_CONFIGURED =
  "system_config holds no row, so there is no VAT rate, no service-charge " +
  "rate and no tax-base rule to post against. An ADMIN must set the " +
  "system configuration — nothing here will assume one.";

/**
 * The columns an edit actually named, as the `SET` clause it becomes.
 *
 * Written out rather than filtered generically, because "the caller left this
 * alone" and "the caller cleared this" are different instructions that both
 * look like an absent value at a glance — and only the two window ends carry
 * the second. A spread of the whole edit would write `undefined` over a date
 * somebody set last week.
 */
function namedIn(edit: ConfigurationEdit): Partial<SystemConfigValues> {
  return {
    ...(edit.vatRateBps === undefined ? {} : { vatRateBps: edit.vatRateBps }),
    ...(edit.reducedVatFrom === undefined
      ? {}
      : { reducedVatFrom: edit.reducedVatFrom }),
    ...(edit.reducedVatTo === undefined
      ? {}
      : { reducedVatTo: edit.reducedVatTo }),
    ...(edit.vatIncludesServiceCharge === undefined
      ? {}
      : { vatIncludesServiceCharge: edit.vatIncludesServiceCharge }),
    ...(edit.serviceChargeRateBps === undefined
      ? {}
      : { serviceChargeRateBps: edit.serviceChargeRateBps }),
    ...(edit.businessDateRolloverHour === undefined
      ? {}
      : { businessDateRolloverHour: edit.businessDateRolloverHour }),
  };
}

/**
 * Whether the window an edit would leave behind covers no date at all.
 *
 * Mirrors `system_config_reduced_vat_window_opens_before_it_closes`, and is
 * checked here as well as there for the sake of the message: the constraint
 * refuses the write, but it refuses it as a 500 naming a constraint, and the
 * person reading that is the `ADMIN` who typed the two dates. Compared as ISO
 * text, which sorts as it reads — the columns hold `YYYY-MM-DD` and both ends
 * are inclusive, so equal ends are a window covering one day rather than none.
 */
function closesBeforeItOpens({
  reducedVatFrom,
  reducedVatTo,
}: SystemConfigValues): boolean {
  return (
    reducedVatFrom !== null &&
    reducedVatFrom !== undefined &&
    reducedVatTo !== null &&
    reducedVatTo !== undefined &&
    reducedVatTo < reducedVatFrom
  );
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
