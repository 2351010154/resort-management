// The night a guest's rung moved, written down — `FR-GST-04`'s recorded half,
// against a real Postgres.
//
// `tier-derivation.e2e-spec.ts` owns what a tier *is*: which stays count, which
// window they fall in, and that the figure is net of the tax config. None of
// that is re-asserted here. What this file is about is the four things only a
// sweep can get wrong, every one of them a way the trail could be useless while
// the derivation stayed correct:
//
// - a crossing is recorded **once**, with the rung the guest came from on it;
// - a run that finds nothing moved writes nothing — including the runner's own
//   second pass over the same open transaction, which is the contract
//   `job-runner.service.ts` enforces and the reason no unique key is needed;
// - a guest who falls **back** is recorded, and the row says MEMBER — the case
//   `loyalty_tier` has no word for and `derived_tier` exists to hold;
// - and an observation, once written, cannot be rewritten or removed by anybody,
//   which is what makes the previous tier recoverable at all.
//
// **The ladder is climbed on stays and never on money.** Every case below puts
// the revenue rung out of reach, so a guest moves because they stayed and for no
// other reason. That is not a gap: the revenue axis is the same
// `net-room-revenue.ts` sum the accrual and the derivation already share, proved
// against real folios one file over, and a fixture here that posted charges,
// paid them and closed the account would be re-proving that at a hundred times
// the cost per case. What the sweep does with the answer is identical whichever
// axis produced it.
//
// **The rollover hour is zero, so the property's day is its calendar day**, and
// the fixtures are dated from `Intl` in Ho Chi Minh City rather than from the
// service under test — `tier-derivation.e2e-spec.ts` gives the reason and it is
// the same one.

import "reflect-metadata";

import { type CalendarDate, parseDate } from "@internationalized/date";
import { count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "../src/database/database.module.js";
import { auditEntry } from "../src/database/schema/audit.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { guestTierChange } from "../src/database/schema/guest-tier.js";
import { guestUser } from "../src/database/schema/index.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { loyaltyLedger } from "../src/database/schema/loyalty.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { TierDerivationService } from "../src/modules/guest/tier-derivation.service.js";
import {
  ACCOUNTS_PER_BATCH,
  TierRecomputeSweep,
} from "../src/modules/guest/tier-recompute-sweep.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

/** The SQLSTATE `0032` gave this trail's append-only boundary. */
const APPEND_ONLY_VIOLATION = "MV005";

/** The four thresholds a case sets, before they are turned into a whole row. */
interface Ladder {
  silverStays: number;
  goldStays: number;
}

/**
 * A revenue rung no case reaches, so the stay count is always what moved the
 * guest.
 */
const UNREACHABLE_REVENUE = 1_000_000_000_000n;

/** A stay count nothing here reaches either, for the rung a case is not using. */
const UNREACHABLE_STAYS = 900;

/** The price a night was sold at. Never posted — see the header. */
const A_NIGHT = 1_000_000n;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let transactions: TransactionRunner;
let sweep: TierRecomputeSweep;
// The derivation the sweep drives, held so the cases about what the trail is
// *not* can ask it the same question the sweep asks.
let tiers: TierDerivationService;
let roomTypeId: string;

// Accounts and stay references are unique per case. Counted rather than drawn,
// so a failing run reproduces.
let ordinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await clearTheHistory();

  const [existing] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .limit(1);

  roomTypeId = existing?.id ?? (await someRoomType());

  const configuration = new SystemConfigService();

  transactions = new TransactionRunner(db);
  tiers = new TierDerivationService(
    configuration,
    new BusinessDateService(configuration),
  );
  sweep = new TierRecomputeSweep(tiers);
});

beforeEach(async () => {
  await clearTheHistory();
  await theLadderIs({
    silverStays: UNREACHABLE_STAYS,
    goldStays: UNREACHABLE_STAYS,
  });
});

afterAll(async () => {
  await clearTheHistory();
  await pool?.end();
});

describe("what the sweep writes down", () => {
  it("records a guest crossing a rung once, and where they came from", async () => {
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(40));
    await aFinishedStay(guest, daysAgo(10));

    await theLadderIs({ silverStays: 2, goldStays: 4 });

    const written = await runTheSweep();

    expect(written).toHaveLength(1);
    expect(await trailFor(guest)).toEqual([
      // Null and not `MEMBER`: the trail said nothing about this guest, and
      // saying nothing is how it says MEMBER.
      { fromTier: null, toTier: "SILVER" },
    ]);

    // The ids the sweep answered with are the rows it wrote — `sweep-job.ts`
    // asks for what was touched rather than for how many.
    const [observation] = await db
      .select({ id: guestTierChange.id })
      .from(guestTierChange);

    expect(written).toEqual([observation?.id]);
  });

  it("names the rung a guest was standing on when they climb the next one", async () => {
    // Two runs a season apart, which is the only way a `from_tier` other than
    // null is ever produced: the second sweep reads the first one's row.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(40));
    await aFinishedStay(guest, daysAgo(30));
    await theLadderIs({ silverStays: 2, goldStays: 4 });

    await runTheSweep();

    await aFinishedStay(guest, daysAgo(20));
    await aFinishedStay(guest, daysAgo(10));

    expect(await runTheSweep()).toHaveLength(1);
    expect(await trailFor(guest)).toEqual([
      { fromTier: null, toTier: "SILVER" },
      { fromTier: "SILVER", toTier: "GOLD" },
    ]);
  });

  it("records a guest whose window moved past their stays as a MEMBER again", async () => {
    // The case `loyalty_tier` cannot express, and the reason `derived_tier`
    // holds three values. A trailing window cannot be moved forward inside a
    // test without waiting a year, so the stay is moved back past its far edge
    // instead — which is the same predicate answering differently, and it is
    // what a stay ageing out does to the count.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, daysAgo(20));

    await theLadderIs({ silverStays: 1, goldStays: 4 });

    expect(await runTheSweep()).toHaveLength(1);

    // The whole stay moves, not just its far end — a booking that departs
    // before it arrives is refused by `booking_covers_at_least_one_night`, and
    // rightly.
    await db
      .update(booking)
      .set({
        checkInDate: monthsAgo(13).subtract({ days: 1 }).toString(),
        checkOutDate: monthsAgo(13).toString(),
      })
      .where(eq(booking.id, stay));

    expect(await runTheSweep()).toHaveLength(1);
    expect(await trailFor(guest)).toEqual([
      { fromTier: null, toTier: "SILVER" },
      { fromTier: "SILVER", toTier: "MEMBER" },
    ]);

    // The guest has no stay in the window at all now, so the only thing keeping
    // them in the sweep's sight is their own trail — which is what made the
    // demotion above visible. Being permanently in sight must not mean a row an
    // hour: the comparison against the last observation is what stops it, and
    // this is where a table that grew with the clock would show up.
    expect(await runTheSweep()).toEqual([]);
    expect(await countOf(guestTierChange)).toBe(2);
  });

  it("leaves a guest with no finished stay in the window unswept", async () => {
    // Three ways of having no qualifying activity, and none of them may produce
    // a row: MEMBER is the absence of one, so writing a baseline for every
    // dormant account would be a table that grows with the guest list rather
    // than with what happened to it.
    const never = await aGuestAccount();
    const cancelled = await aGuestAccount();
    const longAgo = await aGuestAccount();

    await aFinishedStay(cancelled, daysAgo(10), "CANCELLED");
    await aFinishedStay(longAgo, monthsAgo(13));

    await theLadderIs({ silverStays: 1, goldStays: 4 });

    expect(await runTheSweep()).toEqual([]);
    expect(await trailFor(never)).toEqual([]);
    expect(await trailFor(cancelled)).toEqual([]);
    expect(await trailFor(longAgo)).toEqual([]);
  });

  it("touches nothing but the trail", async () => {
    // The sweep reads history and writes one kind of row. A run that moved a
    // booking, a folio or the loyalty ledger would be rewriting the record it
    // is measuring.
    //
    // `audit_entry` grows by exactly one, and that entry is not the tier change
    // — it is the record that a row was written to the trail, filed by the
    // trigger every protected table now carries. `schema/guest-tier.ts` argues
    // that the change itself cannot live in `audit_entry`, and it still does
    // not: what is there is one `INSERT` against `guest_tier_change`, addressed
    // by that row's own id and attributed to nobody, because a sweep has no
    // member of staff behind it.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });

    const before = await whatIsStored();

    expect(await runTheSweep()).toHaveLength(1);

    expect(await whatIsStored()).toEqual({
      ...before,
      audit: before.audit! + 1,
    });
    expect(await countOf(guestTierChange)).toBe(1);
  });
});

// `FR-GST-04` opens with "VIP tier is a **derived value**, never hand-set", and
// `schema/guest-tier.ts` says what these rows are: "a log of observations, not
// the tier". The distinction is not enforceable by a constraint — a trail row
// looks exactly like a stored tier, and reading one back would be a one-line
// change that no other case here would notice. So it is asserted directly: the
// trail is written to and never consulted, and what a guest holds comes from
// their own history every time it is asked.
describe("the trail is history, and the derivation is the tier", () => {
  it("answers from the guest's stays even when the trail says otherwise", async () => {
    // A row claiming GOLD, standing against a guest whose history reaches
    // Silver and no further. An implementation that took the last observation
    // as the current tier would say GOLD; the requirement is that it says what
    // the history says.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });

    await db.insert(guestTierChange).values({
      userId: guest,
      fromTier: null,
      toTier: "GOLD",
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
  });

  it("answers the same with the trail emptied under it", async () => {
    // The other direction, and the one a retention policy would create. If the
    // derivation consulted these rows at all, deleting them would move a
    // guest's tier — so the answer before and after has to be the same figure,
    // and it is because nothing reads them.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(11));
    await aFinishedStay(guest, daysAgo(12));
    await theLadderIs({ silverStays: 1, goldStays: 2 });

    expect(await runTheSweep()).toHaveLength(1);
    expect(await tiers.deriveTier(db, guest)).toBe("GOLD");

    await purgeTheTrail();

    expect(await tiers.deriveTier(db, guest)).toBe("GOLD");
  });

  it("re-records a change the trail no longer remembers", async () => {
    // What purging the trail actually costs, stated as behaviour rather than as
    // a warning. `schema/guest-tier.ts` says a guest's previous tier is
    // recovered from these rows and that silence about an account means MEMBER,
    // so a purge makes the next sweep record a promotion that already happened.
    // The guest's *tier* is unharmed — the case above — and the history is what
    // is lost. This is the evidence behind the table's no-expiry rule.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(13));
    await theLadderIs({ silverStays: 1, goldStays: 4 });

    expect(await runTheSweep()).toHaveLength(1);
    // Nothing to say on the next tick: the trail already holds the change.
    expect(await runTheSweep()).toHaveLength(0);

    await purgeTheTrail();

    const rewritten = await runTheSweep();

    expect(rewritten).toHaveLength(1);

    const [observation] = await db.select().from(guestTierChange);

    expect(observation?.fromTier).toBeNull();
    expect(observation?.toTier).toBe("SILVER");
  });
});

describe("running it again", () => {
  it("writes nothing on a second pass over the same open transaction", async () => {
    // `job-runner.service.ts` runs a sweep a second time inside the run's own
    // transaction whenever the first pass touched anything, and requires the
    // second to come back empty. Reproduced here rather than described: the
    // second pass has to see the uncommitted rows the first one wrote, which is
    // exactly what makes "no change since the last observation" a guard and not
    // a race.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });

    const { first, second } = await transactions.run(async (exec) => ({
      first: await sweep.run(exec, today()),
      second: await sweep.run(exec, today()),
    }));

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(await countOf(guestTierChange)).toBe(1);
  });

  it("writes nothing on the next tick, with no unique key to stop it", async () => {
    // The sweep fires every hour, so twenty-three runs a day find the ladder
    // where they left it. Nothing in the schema refuses a second row for this
    // pair — a guest can genuinely reach Silver twice in a lifetime — so the
    // only thing keeping the trail honest is the comparison the sweep makes.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });

    expect(await runTheSweep()).toHaveLength(1);
    expect(await runTheSweep()).toEqual([]);
    expect(await runTheSweep()).toEqual([]);

    expect(await trailFor(guest)).toEqual([
      { fromTier: null, toTier: "SILVER" },
    ]);
  });

  it("walks past the end of a page", async () => {
    // The accounts are read a page at a time by keyset, so a base larger than
    // one page is the case where a sweep silently stops half way — every guest
    // after the five hundredth would keep their old tier forever and nothing
    // would say so. One more account than a page holds is what makes the second
    // read happen at all.
    const crowd = await aCrowdOfGuestAccounts(ACCOUNTS_PER_BATCH + 1);

    await theLadderIs({ silverStays: 1, goldStays: 4 });

    expect(await runTheSweep()).toHaveLength(crowd.length);

    const recorded = await db
      .select({ userId: guestTierChange.userId })
      .from(guestTierChange)
      .where(inArray(guestTierChange.userId, [...crowd]));

    // Every one of them, and each exactly once — a keyset that repeated its
    // last row would write the boundary account twice.
    expect(new Set(recorded.map((row) => row.userId)).size).toBe(crowd.length);
    expect(recorded).toHaveLength(crowd.length);

    expect(await runTheSweep()).toEqual([]);
  });
});

describe("an observation, once made", () => {
  it("refuses to be rewritten", async () => {
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });
    await runTheSweep();

    const refusal = await refused((exec) =>
      exec.update(guestTierChange).set({ toTier: "GOLD" }),
    );

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("append-only");
    expect(refusal.message).toContain("update");

    // The row the database declined to change is the row it had.
    expect(await trailFor(guest)).toEqual([
      { fromTier: null, toTier: "SILVER" },
    ]);
  });

  it("refuses to be deleted", async () => {
    // The one that matters most: a deleted observation makes the guest's
    // previous tier MEMBER again by the absence rule, and the next sweep would
    // record a promotion that already happened.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, daysAgo(10));
    await theLadderIs({ silverStays: 1, goldStays: 4 });
    await runTheSweep();

    const refusal = await refused((exec) => exec.delete(guestTierChange));

    expect(refusal.code).toBe(APPEND_ONLY_VIOLATION);
    expect(refusal.message).toContain("delete");
    expect(await countOf(guestTierChange)).toBe(1);
  });

  it("cannot be written claiming MEMBER on the side it came from", async () => {
    // One spelling of the base tier on the left, held by the database rather
    // than by whoever is writing. Two would leave a reader comparing histories
    // having to know both.
    const guest = await aGuestAccount();

    const refusal = await refused((exec) =>
      exec
        .insert(guestTierChange)
        .values({ userId: guest, fromTier: "MEMBER", toTier: "SILVER" }),
    );

    expect(refusal.constraint).toBe(
      "guest_tier_change_from_member_is_the_absence",
    );
  });

  it("cannot be written recording no change at all", async () => {
    const guest = await aGuestAccount();

    const refusal = await refused((exec) =>
      exec
        .insert(guestTierChange)
        .values({ userId: guest, fromTier: null, toTier: "MEMBER" }),
    );

    expect(refusal.constraint).toBe("guest_tier_change_records_a_change");
  });
});

/** One run of the sweep, on its own transaction, as an hourly tick is. */
async function runTheSweep(): Promise<readonly string[]> {
  return await transactions.run((exec) => sweep.run(exec, today()));
}

/**
 * The trail emptied — what a retention policy would have to do to it.
 *
 * `truncate` and not `delete`, and the difference is the point rather than a
 * detail of this file: `guest_tier_change_refuse_rewrite` raises `MV005` on a
 * delete, so no purge can be written as one. Anybody who ever wants a retention
 * rule here has to disable the append-only guard or truncate the table wholesale
 * — an act that cannot happen by accident, which is exactly what
 * `schema/guest-tier.ts` is asking for when it says this memory has no expiry.
 */
async function purgeTheTrail(): Promise<void> {
  await db.execute(sql`truncate guest_tier_change`);
}

/**
 * The property's own calendar date, read from `Intl` rather than from the
 * service the sweep calls.
 *
 * At UTC+7 the property's date and the process's UTC date disagree for the last
 * seven hours of every day, so a fixture dated in UTC would drift past the
 * window's edge for those seven hours — a suite that fails in the evening and
 * passes in the morning.
 */
function today(): CalendarDate {
  return parseDate(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
}

function daysAgo(days: number): CalendarDate {
  return today().subtract({ days });
}

function monthsAgo(months: number): CalendarDate {
  return today().subtract({ months });
}

/**
 * The property's whole configuration, with §7's stay rungs set to this case's
 * figures and both revenue rungs out of reach.
 *
 * Written as one row rather than as an edit, for the reason the derivation's own
 * suite gives: a case that patched columns of a row another case left behind
 * would depend on the order the file ran in.
 */
async function theLadderIs(rungs: Ladder): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values({
    // Unreal and well above zero on both — §8 forbids a real rate here.
    standardVatRateBps: 1_234,
    reducedVatRateBps: 2_468,
    reducedVatFrom: null,
    reducedVatTo: null,
    vatIncludesServiceCharge: true,
    serviceChargeRateBps: 321,
    // Midnight, so the property's day is its calendar day and this file can
    // date its fixtures without borrowing the arithmetic under test.
    businessDateRolloverHour: 0,
    loyaltyPointsPerUnit: 1,
    loyaltyEarnUnitVnd: 1n,
    tierSilverStays: rungs.silverStays,
    tierSilverRevenueVnd: UNREACHABLE_REVENUE,
    tierGoldStays: rungs.goldStays,
    tierGoldRevenueVnd: UNREACHABLE_REVENUE,
  });
}

/**
 * A one-night stay that ended on the given date.
 *
 * No folio and no postings: the ladder every case here climbs is the stay count,
 * and the header says why the money axis is proved a file over instead.
 */
async function aFinishedStay(
  guestUserId: string,
  departedOn: CalendarDate,
  state: "CHECKED_OUT" | "CANCELLED" = "CHECKED_OUT",
): Promise<string> {
  ordinal += 1;

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-SWEEP-${String(ordinal).padStart(5, "0")}`,
      state,
      cancellationReason: state === "CANCELLED" ? "GUEST_REQUEST" : null,
      cancelledAt: state === "CANCELLED" ? new Date() : null,
      roomTypeId,
      userId: guestUserId,
      checkInDate: departedOn.subtract({ days: 1 }).toString(),
      checkOutDate: departedOn.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: A_NIGHT,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  return stay!.id;
}

/** An account on the public site, by the id Better Auth would have minted. */
async function aGuestAccount(): Promise<string> {
  return (await guestAccounts(1))[0]!;
}

/**
 * Accounts and nothing else, written in one statement.
 *
 * The ids are zero-padded so their text order is their numeric order, which is
 * the order the sweep's keyset walks.
 */
async function guestAccounts(howMany: number): Promise<readonly string[]> {
  const ids = Array.from({ length: howMany }, () => {
    ordinal += 1;

    return `sweep-account-${String(ordinal).padStart(6, "0")}`;
  });

  await db.insert(guestUser).values(
    ids.map((id) => ({
      id,
      name: "Nguyễn Thị Hương",
      email: `${id}@mariva.test`,
    })),
  );

  return ids;
}

/**
 * Many accounts, each with one finished stay, written in two statements.
 *
 * Two statements rather than a loop of the single-stay helper, because five
 * hundred round trips per case is the difference between a suite somebody runs
 * and one they stop running.
 */
async function aCrowdOfGuestAccounts(
  howMany: number,
): Promise<readonly string[]> {
  const ids = await guestAccounts(howMany);

  await db.insert(booking).values(
    ids.map((id, index) => {
      ordinal += 1;

      return {
        reference: `MRV-CROWD-${String(ordinal).padStart(5, "0")}`,
        state: "CHECKED_OUT" as const,
        roomTypeId,
        userId: id,
        // Spread across the window rather than stacked on one date, so the
        // stays are not all one index entry.
        checkInDate: daysAgo(31 + (index % 90)).toString(),
        checkOutDate: daysAgo(30 + (index % 90)).toString(),
        ratePlanCode: "STANDARD" as const,
        adults: 2,
        quotedStayTotalGross: A_NIGHT,
        quotedPercentAdjustment: 0,
        quotedExtraPersonPerNightGross: 600_000n,
      };
    }),
  );

  return ids;
}

/** This guest's trail, oldest first. */
async function trailFor(
  guestUserId: string,
): Promise<{ fromTier: string | null; toTier: string }[]> {
  return await db
    .select({
      fromTier: guestTierChange.fromTier,
      toTier: guestTierChange.toTier,
    })
    .from(guestTierChange)
    .where(eq(guestTierChange.userId, guestUserId))
    .orderBy(guestTierChange.observedAt);
}

/**
 * Every table the sweep could conceivably reach and must not, counted.
 *
 * The trail itself is deliberately absent — it is the one thing a run is
 * supposed to change, and the case that calls this counts it separately.
 */
async function whatIsStored(): Promise<Record<string, number>> {
  const tables = {
    audit: auditEntry,
    ledger: loyaltyLedger,
    postings: folioPosting,
    folios: folio,
    bookings: booking,
    guests: guestUser,
  };
  const counted: Record<string, number> = {};

  for (const [name, table] of Object.entries(tables)) {
    counted[name] = await countOf(table);
  }

  return counted;
}

async function countOf(table: PgTable): Promise<number> {
  const [row] = await db.select({ rows: count() }).from(table);

  return row?.rows ?? 0;
}

type Refusal = { code: string; message: string; constraint?: string };

/**
 * The refusal a write provoked, taken on its own transaction.
 *
 * Fails the case if the database accepted it — a constraint asserted by a write
 * that succeeded is no assertion.
 */
async function refused(
  write: (exec: DbExecutor) => Promise<unknown>,
): Promise<Refusal> {
  try {
    await transactions.run(async (exec) => {
      await write(exec);
    });
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE, message and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed to
 * be one deep — `folio-storage.e2e-spec.ts` says the same where it does the same.
 */
function refusalOf(error: unknown): Refusal {
  for (let current = error; current instanceof Error; current = current.cause) {
    const { code, constraint } = current as Error & {
      code?: unknown;
      constraint?: unknown;
    };

    if (typeof code === "string") {
      return {
        code,
        message: current.message,
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}

/** A room type to hang a booking on, and only if the database holds none. */
async function someRoomType(): Promise<string> {
  const [created] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  return created!.id;
}

async function clearTheHistory(): Promise<void> {
  await db.execute(
    sql`truncate guest_tier_change, loyalty_ledger, folio_posting, folio, booking, guest_user restart identity cascade`,
  );
}
