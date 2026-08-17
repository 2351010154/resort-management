// The tax figures a posting reads, and which of the two VAT rates applies on the
// date it is posting on — `FR-IDN-03`, `FR-FOL-02`, and
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
  /**
   * The VAT rate that applies on the date this was read for — the reduced one
   * inside the relief window, the standard one everywhere else.
   *
   * Which of the two it came from is deliberately not carried. The consumer is
   * `decomposeGross`, and it multiplies; a field naming the provenance would be
   * a second thing a posting path could branch on and get wrong.
   */
  readonly vatRateBps: number;
  readonly serviceChargeRateBps: number;
  /** Whether the VAT base includes the service-charge line — §8, `ASM-01`. */
  readonly vatIncludesServiceCharge: boolean;
}

/**
 * What an accrual needs to turn a stay's net room revenue into points —
 * `FR-GST-05`, and `property-and-tariff.md` §7.
 *
 * The rate arrives as its two halves rather than as one ratio, because that is
 * how §7 states it and because a single number could not say what a stay below
 * one unit earns. Points per unit is a count and the unit is money, which is
 * why one is a `number` and the other a `bigint`: `money.ts` keeps amounts on
 * `bigint` precisely so an amount cannot be added to a count by accident, and
 * an accrual divides revenue by the unit before it multiplies by the count.
 */
export interface LoyaltyRules {
  readonly pointsPerUnit: number;
  /** The đồng of net room revenue one lot of {@link pointsPerUnit} costs. */
  readonly earnUnitVnd: bigint;
  /**
   * Whether points expire on 31 December of the year after they were earned.
   *
   * False is the property withdrawing that rule and not a second rule: nothing
   * here says what date an accrual would carry instead, and
   * `loyalty_ledger.expires_at` is `NOT NULL`. Whatever accrues is the only code
   * that knows the date it was about to write, so it is where that has to be
   * answered.
   */
  readonly pointsExpireAtYearEnd: boolean;
}

/**
 * The rungs a tier is derived from — `FR-GST-04`, and §7's ladder.
 *
 * **Thresholds, and never a tier.** `FR-GST-04` makes the tier a derived value
 * recomputed at business-date rollover over a trailing twelve months, so it is
 * an answer that stops being true when the window moves; these are the figures
 * that answer is derived *from*, and they hold until somebody edits them.
 * Nothing in this schema stores a tier, and `schema/loyalty.ts` and
 * `schema/guest.ts` each refuse a column for one.
 *
 * Each rung is reachable by stays **or** by revenue, which is why the two
 * figures of a rung come back together: a caller that read them separately
 * could resolve the count against one configuration and the money against the
 * next.
 */
export interface TierThresholds {
  readonly silverStays: number;
  readonly silverRevenueVnd: bigint;
  readonly goldStays: number;
  readonly goldRevenueVnd: bigint;
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
  readonly standardVatRateBps?: number;
  readonly reducedVatRateBps?: number;
  readonly reducedVatFrom?: string | null;
  readonly reducedVatTo?: string | null;
  readonly vatIncludesServiceCharge?: boolean;
  readonly serviceChargeRateBps?: number;
  readonly businessDateRolloverHour?: number;
  readonly loyaltyPointsPerUnit?: number;
  readonly loyaltyEarnUnitVnd?: bigint;
  readonly tierSilverStays?: number;
  readonly tierSilverRevenueVnd?: bigint;
  readonly tierGoldStays?: number;
  readonly tierGoldRevenueVnd?: bigint;
  readonly pointsExpireYearEnd?: boolean;
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
   * **Resolves rather than refuses, and neither rate is invented.** The date is
   * what this method takes an argument for: the row carries a standard rate and
   * a reduced rate, and the relief window says which dates the reduced one is
   * the answer on. Every other date — before the window opens, after it closes,
   * and every date at all when no window is set — takes the standard rate.
   *
   * This used to refuse a date outside a window that was set, on the grounds
   * that there was no second rate to fall back to and inventing one would settle
   * `ASM-01` by guessing. The column now exists, so nothing is guessed; and the
   * refusal was itself the more dangerous shape, because statutory relief always
   * lapses back into a standard rate rather than into no rate. Under the old
   * arrangement, configuring a window correctly *guaranteed* a refused posting
   * on the day it lapsed — a desk that could not charge for a stay, arriving on
   * a schedule nobody was watching. Two configured rates cost nothing on the
   * dates the window covers and cover the day it ends.
   *
   * The two refusals that remain are the honest ones and are elsewhere: a
   * database with no row at all refuses every read, and a window that closes
   * before it opens is refused at the write.
   */
  async taxRules(exec: DbExecutor, on: StayDate): Promise<TaxRules> {
    const configured = await this.configuration(exec);

    return {
      vatRateBps: withinTheReliefPeriod(configured, on)
        ? configured.reducedVatRateBps
        : configured.standardVatRateBps,
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
   * What a stay earns, as §7 states it — the rate in its two halves and the
   * expiry rule.
   *
   * Read at the moment of the accrual and never held, for the reason
   * {@link taxRules} is: the earn rate defines what a point *is*, and §7 says so
   * outright — reseeding balances after guests already hold them is a support
   * incident rather than a data edit. A rate cached between accruals is the same
   * incident arriving by a slower route, because the run that used the stale
   * figure has already written its ledger rows.
   *
   * Its own read rather than a field on {@link tierThresholds}, because they
   * answer at different moments: this one at a folio close, the other at
   * business-date rollover. Both read the whole row in one statement all the
   * same, so neither can see half of one configuration.
   */
  async loyaltyRules(exec: DbExecutor): Promise<LoyaltyRules> {
    const configured = await this.configuration(exec);

    return {
      pointsPerUnit: configured.loyaltyPointsPerUnit,
      earnUnitVnd: configured.loyaltyEarnUnitVnd,
      pointsExpireAtYearEnd: configured.pointsExpireYearEnd,
    };
  }

  /**
   * The two rungs a tier is derived from, all four figures together.
   *
   * Together and not one rung at a time, on the argument this file already makes
   * for the tax figures: `READ COMMITTED` takes a fresh snapshot per statement,
   * so two reads inside one transaction can straddle an `ADMIN` edit — and a
   * derivation that compared a guest's stays against the old ladder and their
   * revenue against the new one would promote or hold a guest on a ladder that
   * never existed.
   *
   * What comes back is thresholds. Deriving a tier from them is the caller's,
   * and `FR-GST-04` requires that it be done on read: this method has nowhere to
   * return a tier from, because nothing stores one.
   */
  async tierThresholds(exec: DbExecutor): Promise<TierThresholds> {
    const configured = await this.configuration(exec);

    return {
      silverStays: configured.tierSilverStays,
      silverRevenueVnd: configured.tierSilverRevenueVnd,
      goldStays: configured.tierGoldStays,
      goldRevenueVnd: configured.tierGoldRevenueVnd,
    };
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
   * `updateSystemConfigInput` mirrors every `CHECK` constraint
   * `schema/config.ts` puts on a single column, so a rate above 100% or an hour
   * of 24 is a 400 naming the field before it reaches this method — and the
   * constraints are what make that true of every writer, including a `psql`
   * session. What is left are the constraints that span two columns: the relief
   * window's ends, and each tier rung against the one below it. A `PATCH` may
   * name one side of either, so only this method — holding the stored row beside
   * the edit — can see the pair the write would produce.
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

    const collapsedRung = tierLadderCollapsedBy(proposed);

    if (collapsedRung) {
      throw new ORPCError("BAD_REQUEST", { message: collapsedRung });
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
    ...(edit.standardVatRateBps === undefined
      ? {}
      : { standardVatRateBps: edit.standardVatRateBps }),
    ...(edit.reducedVatRateBps === undefined
      ? {}
      : { reducedVatRateBps: edit.reducedVatRateBps }),
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
    ...(edit.loyaltyPointsPerUnit === undefined
      ? {}
      : { loyaltyPointsPerUnit: edit.loyaltyPointsPerUnit }),
    ...(edit.loyaltyEarnUnitVnd === undefined
      ? {}
      : { loyaltyEarnUnitVnd: edit.loyaltyEarnUnitVnd }),
    ...(edit.tierSilverStays === undefined
      ? {}
      : { tierSilverStays: edit.tierSilverStays }),
    ...(edit.tierSilverRevenueVnd === undefined
      ? {}
      : { tierSilverRevenueVnd: edit.tierSilverRevenueVnd }),
    ...(edit.tierGoldStays === undefined
      ? {}
      : { tierGoldStays: edit.tierGoldStays }),
    ...(edit.tierGoldRevenueVnd === undefined
      ? {}
      : { tierGoldRevenueVnd: edit.tierGoldRevenueVnd }),
    ...(edit.pointsExpireYearEnd === undefined
      ? {}
      : { pointsExpireYearEnd: edit.pointsExpireYearEnd }),
  };
}

/**
 * Why the ladder an edit would leave behind has a rung nobody can stand on, or
 * nothing if it stands.
 *
 * Mirrors `system_config_gold_stays_not_below_silver` and
 * `system_config_gold_revenue_not_below_silver`, and is checked here as well for
 * the reason the window's invariant is: the constraint refuses the write as a
 * 500 naming a constraint, and the person reading it typed one of the two
 * figures and cannot see the other.
 *
 * Each axis is compared with its own, because a rung is reached by stays **or**
 * by revenue. Equal figures are a ladder, not a collapse — a property may raise
 * the money bar and leave the nights alone, and Silver still exists for whoever
 * reaches one and not the other. A Gold rung *below* Silver's on an axis is the
 * collapse: every Silver guest is already Gold on it, so the tier beneath stops
 * existing without anything failing.
 */
function tierLadderCollapsedBy({
  tierSilverStays,
  tierGoldStays,
  tierSilverRevenueVnd,
  tierGoldRevenueVnd,
}: SystemConfigValues): string | undefined {
  if (
    tierSilverStays !== undefined &&
    tierGoldStays !== undefined &&
    tierGoldStays < tierSilverStays
  ) {
    return (
      `Gold at ${tierGoldStays} stays sits below Silver at ${tierSilverStays}, ` +
      "so every guest who reached Silver would already be Gold and the tier " +
      "beneath it would stop being reachable. Set the Gold stay count on or " +
      "above the Silver one."
    );
  }

  if (
    tierSilverRevenueVnd !== undefined &&
    tierGoldRevenueVnd !== undefined &&
    tierGoldRevenueVnd < tierSilverRevenueVnd
  ) {
    return (
      `Gold at ${tierGoldRevenueVnd} đồng sits below Silver at ` +
      `${tierSilverRevenueVnd}, so every guest who reached Silver by revenue ` +
      "would already be Gold. Set the Gold revenue threshold on or above the " +
      "Silver one."
    );
  }

  return undefined;
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
 * Whether a date falls inside the relief period, and so takes the reduced rate.
 *
 * Both ends are inclusive. **Both ends null is "there is no relief period",
 * not "the relief period is unbounded"** — a property that has asserted no
 * window is one whose dates all sit at the standard rate, and reading the
 * absent window as covering everything would apply a reduced rate to a property
 * that never claimed relief. One end set and the other null is a genuinely
 * half-open period: relief that has started and has no announced end, or one
 * whose end is known and whose start predates the system.
 *
 * Compared through `parseDate` rather than as ISO text because the argument is
 * a decoded `StayDate` and the columns are `YYYY-MM-DD`; the comparison is the
 * calendar's, not the string's.
 */
function withinTheReliefPeriod(
  { reducedVatFrom, reducedVatTo }: SystemConfigRow,
  on: StayDate,
): boolean {
  if (reducedVatFrom === null && reducedVatTo === null) {
    return false;
  }

  if (reducedVatFrom !== null && on.compare(parseDate(reducedVatFrom)) < 0) {
    return false;
  }

  return reducedVatTo === null || on.compare(parseDate(reducedVatTo)) <= 0;
}
