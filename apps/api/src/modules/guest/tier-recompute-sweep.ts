// The recorded half of `FR-GST-04`: noticing that a guest's rung moved, and
// writing the fact down.
//
// `tier-derivation.service.ts` answers what tier a guest holds and stores
// nothing, which is the requirement — "VIP tier is a **derived value**, never
// hand-set". A derivation therefore has no previous answer to compare against,
// so the other half of `FR-GST-04` — "a tier change writes an audit row" — is
// not something a read can satisfy. A change is only observable across two
// recomputations, and this is the thing that performs the second one.
//
// It is the only writer of `guest_tier_change`, and `schema/guest-tier.ts` says
// what those rows are and are not: a trail of what the recomputation saw, never
// the tier itself. Nothing here writes a tier anywhere a reader could mistake
// for the answer.
//
// ## Hourly, because the rollover hour is configuration
//
// §7 says "tier derived nightly" and `FR-GST-04` "recomputed at business-date
// rollover", and the obvious reading of both — a daily cron a few minutes past
// 04:00 — is the one `no-show-sweep.ts` refuses and the other two sweeps inherit
// by citation. The hour is a `system_config` row an `ADMIN` edits without a
// deploy, and `config/env.ts` says of the variable that seeds it that "nothing
// reads it at run time". A cron holding `4` would be that number's second home,
// and the morning after somebody moved it this sweep would run before the
// rollover and record the ladder as it stood the previous day.
//
// Hourly needs no such agreement: whenever the day rolls, the next tick
// recomputes against the window that has just moved. Fifty-five past keeps it off
// the hour boundary, off `e-invoice.job.ts`'s five-minute grid, and last in the
// hour — after the night's charges, invoices and reconciliations are on the
// ledger, so the ladder is read over an hour the rest of the schedule has
// finished with.
//
// Recomputing more often than nightly is not a deviation from either document.
// A tier is derived on *read* throughout the day already, by design; what this
// sweep adds is the record, and an hourly observation writes the same single row
// per rung crossed with an `observed_at` nearer the departure that caused it.
//
// ## No run marker, and what the one in the tree is actually guarding
//
// `reconciliation.job.ts` is hourly too and does its work once per business date,
// held to it by a `payment_reconciliation_run` row. That marker is not there
// because twenty-four runs would be untidy. It is there because each run is a
// round trip to VNPay per attempt, and because a reconciled day pages people and
// must therefore be looked at exactly once.
//
// Neither hazard is here. A tick that finds the ladder unmoved is a few indexed
// reads per active guest on the runner's own connection — no row locks, no
// network, nothing woken. Twenty-three of those is a minute of read-only
// database time a day, which is less than the one that job already spends on
// HTTPS. A marker table would buy that minute for a second schema surface and a
// second thing to keep honest.
//
// The date such a marker would key on is also not the date the work is done
// over. {@link TierDerivationService.deriveTier} reads the property's today
// itself, through `BusinessDateService`, rather than taking the date this sweep
// was handed — so a manual re-run over last week still derives against this
// week's trailing window. That is the derivation's contract and not this file's
// to change; what follows from it is that the business date is used for the
// candidate scan below and for nothing else, and a run row stamped with it would
// be recording a day the recomputation never looked at.
//
// ## Idempotency is the comparison, not a key
//
// `job-runner.service.ts` re-runs a sweep inside the same transaction and
// requires the second pass to come back empty. This satisfies that by
// construction rather than by promising it: a row is written only where the
// derived tier differs from the last one recorded for that guest, and the second
// pass reads back the rows the first pass just wrote. The same predicate is what
// makes every tick after the first of a day write nothing.
//
// It is deliberately not a unique key. A guest's tier can genuinely move twice —
// up in March and back in December — so `(user_id, to_tier)` is not unique and
// must not be made so. The refusal that protects this table is the append-only
// trigger, which is about a row that already exists rather than about a row
// being written twice.
//
// ## Batching
//
// A sweep never opens a transaction — `sweep-job.ts` — so the runner's one
// transaction is the boundary whatever this does, and batching cannot and does
// not change that. What it bounds is the rest: the candidate accounts are read a
// page at a time by keyset rather than materialised whole, and the query that
// recovers their last observations carries one page of ids rather than a
// property's entire guest base in a single `in` list. A forty-room house will
// never notice; a list that grows without a bound is the kind of query that is
// only ever discovered by the night it times out.

import type { StayDate } from "@mariva/shared";
import { Injectable } from "@nestjs/common";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { type PgColumn, union } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { guestTierChange } from "../../database/schema/guest-tier.js";
import type { SweepJob } from "../../jobs/sweep-job.js";
import {
  type DerivedTier,
  TierDerivationService,
} from "./tier-derivation.service.js";

// See the header. Last in the hour, off the boundary and off the five-minute
// grid `e-invoice.job.ts` occupies.
const HOURLY = "55 * * * *";

// §7's window, and the only thing this file does with it: deciding whose ladder
// is worth asking about. The derivation applies the same twelve months itself,
// over its own reading of the property's today, and it is the authority on where
// the window's edge falls.
const TRAILING_MONTHS = 12;

/**
 * How many guest accounts are read, derived and compared at a time.
 *
 * Large enough that a forty-room property's whole base is one or two pages,
 * small enough that a property with a hundred times the history still issues
 * bounded statements.
 *
 * Exported so the case that proves the second page is fetched can build one
 * account more than a page holds, rather than hard-coding a number that would
 * quietly stop testing anything the day this one moved.
 */
export const ACCOUNTS_PER_BATCH = 500;

/**
 * Recomputes the tier of every guest whose ladder could have moved — those who
 * stayed recently and those the trail already has an opinion about — and records
 * the ones that did.
 *
 * Registered in `jobs.module.ts` and owned here, which is the split that file
 * describes: the scheduler is machinery, and a sweep belongs to the requirement
 * that asked for it.
 */
@Injectable()
export class TierRecomputeSweep implements SweepJob {
  readonly name = "tier-recompute";
  readonly schedule = HOURLY;

  constructor(private readonly tiers: TierDerivationService) {}

  /**
   * Answers with the id of every observation it wrote.
   *
   * The row's id and not the guest's, for the reason the room-charge sweep gives
   * about its postings: it is the thing that was written, and it is the handle
   * the trail is read back by.
   */
  async run(
    exec: DbExecutor,
    businessDate: StayDate,
  ): Promise<readonly string[]> {
    const since = businessDate
      .subtract({ months: TRAILING_MONTHS })
      .toString();

    const written: string[] = [];
    let after: string | null = null;

    for (;;) {
      const accounts = await this.activeAccounts(exec, since, after);

      if (accounts.length === 0) {
        return written;
      }

      const recorded = await this.lastObserved(exec, accounts);

      // Sequential, not `Promise.all`: every statement is on the runner's one
      // connection inside its one transaction, so concurrency here would buy
      // nothing and interleave four reads per guest on a connection that can
      // only carry one.
      for (const userId of accounts) {
        // No row for a guest means the guest was MEMBER — exact rather than
        // conventional, because MEMBER is the absence of a match and a guest
        // with no history derives it. `schema/guest-tier.ts` states the rule;
        // this is the only place that applies it.
        const was = recorded.get(userId) ?? "MEMBER";
        const now = await this.tiers.deriveTier(exec, userId);

        if (now === was) {
          continue;
        }

        const [observation] = await exec
          .insert(guestTierChange)
          .values({
            userId,
            // MEMBER is written as the absence on this side and never as the
            // word — the table's own constraint holds it, and the header there
            // says why the two sides of the row spell it differently.
            fromTier: was === "MEMBER" ? null : was,
            toTier: now,
          })
          .returning({ id: guestTierChange.id });

        if (observation) {
          written.push(observation.id);
        }
      }

      // A short page is the last one. Asking again would cost one statement to
      // be told the same thing.
      if (accounts.length < ACCOUNTS_PER_BATCH) {
        return written;
      }

      after = accounts.at(-1) ?? null;
    }
  }

  /**
   * One page of the guest accounts whose ladder is worth asking about, in id
   * order.
   *
   * Two sets, and the second is not an optimisation of the first — it is what
   * makes a fall to MEMBER recordable at all.
   *
   * **Guests who finished a stay inside §7's window** are the obvious half: they
   * are the ones whose count and revenue can have moved upward.
   *
   * **Guests this trail has ever spoken about** are the other, and leaving them
   * out is the defect that prompted this paragraph. A guest falls back to MEMBER
   * precisely *because* their last stay aged out of the trailing window — which
   * is the same moment they stop having a finished stay inside it. Selected on
   * activity alone, they would drop out of the sweep's sight on the very night
   * the demotion became true, and the trail would go on claiming Silver for a
   * guest who has not been near the property in a year, permanently and with
   * nothing anywhere to notice.
   *
   * That set is every account with a row here rather than only the ones standing
   * above MEMBER, which is a superset and a cheaper predicate: a guest whose
   * last observation already says MEMBER derives MEMBER and produces nothing.
   * What it buys is the plain sentence — the trail is re-checked against every
   * guest it holds an opinion about — and it is bounded by the changes that
   * actually happened rather than by the size of the guest list.
   *
   * A guest in neither set has never moved and has no recent stay, so silence
   * about them is already the right record — `schema/guest-tier.ts`'s rule.
   * Deriving for them would be four statements to confirm nothing, per dormant
   * account, per tick, forever.
   *
   * Keyset on the id rather than `offset`, so the pages do not shift under a
   * concurrent insert and each half stays a walk of its own index —
   * `booking_user_id_idx` and `guest_tier_change_user_observed_at_idx` — rather
   * than a re-count of everything already seen. The bound is repeated inside
   * both halves for that reason: applied outside the union it would be a filter
   * over rows both indexes had already produced.
   */
  private async activeAccounts(
    exec: DbExecutor,
    since: string,
    after: string | null,
  ): Promise<readonly string[]> {
    const beyond = (column: PgColumn): SQL | undefined =>
      after === null ? undefined : gt(column, after);

    const rows = await union(
      exec
        .selectDistinct({ userId: booking.userId })
        .from(booking)
        .where(
          and(
            isNotNull(booking.userId),
            eq(booking.state, "CHECKED_OUT"),
            gte(booking.checkOutDate, since),
            beyond(booking.userId),
          ),
        ),
      exec
        .selectDistinct({ userId: guestTierChange.userId })
        .from(guestTierChange)
        .where(beyond(guestTierChange.userId)),
    )
      // By the output column and not by either input's, which is the only form
      // Postgres accepts over a union — and `union` has already discarded the
      // duplicate a guest in both halves would otherwise arrive as.
      .orderBy(sql`user_id`)
      .limit(ACCOUNTS_PER_BATCH);

    // The guard tells TypeScript what `is not null` above already guaranteed —
    // `reconciliation.job.ts` does the same on the same kind of column.
    return rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));
  }

  /**
   * The tier last recorded for each of these accounts, where one was.
   *
   * `distinct on` rather than a join against a `max(observed_at)` subquery: the
   * index on `(user_id, observed_at)` answers it by walking each account's
   * entries backwards and stopping at the first, which is the whole read. An
   * account with no entry is absent from the result, and the caller reads that
   * absence as MEMBER.
   *
   * Two entries for one account cannot share an instant. `observed_at` defaults
   * to the transaction's own `now()`, and this sweep writes at most one row per
   * account per transaction — including across the runner's second pass, which
   * finds the first pass's row and has nothing to add.
   */
  private async lastObserved(
    exec: DbExecutor,
    accounts: readonly string[],
  ): Promise<ReadonlyMap<string, DerivedTier>> {
    const rows = await exec
      .selectDistinctOn([guestTierChange.userId], {
        userId: guestTierChange.userId,
        tier: guestTierChange.toTier,
      })
      .from(guestTierChange)
      .where(inArray(guestTierChange.userId, [...accounts]))
      .orderBy(guestTierChange.userId, desc(guestTierChange.observedAt));

    return new Map(rows.map((row) => [row.userId, row.tier]));
  }
}

