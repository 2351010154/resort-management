// Which rung of §7's ladder a guest is standing on — `FR-GST-04`, against a
// real Postgres.
//
// The derivation is a read and only a read, so almost everything worth asserting
// here is about what it *counts* rather than about what it does. Six claims, and
// each of them is a way a tier could be wrong while every other test in the tree
// stayed green:
//
// - either axis reaches a rung on its own. §7 spells both with an "or", so a
//   guest who came twice and a guest who came once and spent the same money are
//   both Silver, and the two are proved separately with the other axis put out
//   of reach;
// - the highest rung reached is the answer, not the first one passed;
// - the window is a trailing twelve months, so a stay that ended thirteen months
//   ago counts toward nothing at all — on either axis;
// - **the figure is net room revenue**, which is what `FR-GST-04` means by "a
//   change to the `ASM-01` tax config cannot silently move tier boundaries". A
//   guest whose gross bill clears a rung and whose net does not is held below
//   it, and moving the property's tax rates afterwards moves nobody;
// - a guest with no history is a MEMBER, which is an absence and not a row;
// - and nothing anywhere is written by asking.
//
// **The rollover hour is zero, so the property's day is its calendar day.** The
// window's far end is read through `BusinessDateService` and this file dates its
// fixtures from `Intl` in Ho Chi Minh City, independently. Deriving the property's
// today the way the service does would make a bug in the window agree with a bug
// in the fixture; setting the hour to zero is what lets the two be computed apart
// and still meet. What the rollover hour itself does to a date is
// `business-date.service.spec.ts`'s, where it can be asserted without waiting for
// an hour of the day to come round.
//
// **The tax rates are deliberately unreal** — 12.34% VAT over a 3.21% service
// charge, as `loyalty-accrual.e2e-spec.ts` uses and for the reason it gives: §8
// forbids the tree from carrying a real rate, and what matters is only that both
// are well above zero so a net figure and a gross one cannot be confused.
//
// **The accrual is the real one.** Closing an account here writes a ledger row,
// which is not what this file is about — but it is what lets the last case put
// the two readers of `net-room-revenue.ts` side by side: at one point per đồng
// the ledger row *is* the stay's net, so a ladder set to that figure exactly must
// promote the guest, and a ladder one đồng above it must not. Two callers, one
// sum, asserted against each other rather than assumed from the import.

import "reflect-metadata";

import { type CalendarDate, parseDate } from "@internationalized/date";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditEntry } from "../src/database/schema/audit.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { staffUser } from "../src/database/schema/identity.js";
import { guestUser } from "../src/database/schema/index.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { loyaltyLedger } from "../src/database/schema/loyalty.js";
import { serviceCatalog } from "../src/database/schema/service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { TierDerivationService } from "../src/modules/guest/tier-derivation.service.js";
import { CatalogService } from "../src/modules/operations/catalog.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { accrualOn } from "./accrual.js";

/** The four thresholds a case sets, before it is turned into a whole row. */
interface Ladder {
  silverStays: number;
  silverRevenueVnd: bigint;
  goldStays: number;
  goldRevenueVnd: bigint;
}

/**
 * A rung no case reaches by accident.
 *
 * Every case puts one axis out of reach so that the other is what moved the
 * answer. A ladder both axes could climb would pass whichever one the
 * implementation happened to read.
 */
const UNREACHABLE = {
  stays: 900,
  revenueVnd: 1_000_000_000_000n,
} as const;

/** One night at the price the guest agreed to, gross. */
const A_NIGHT = 1_000_000n;

/** A minibar bill, gross. Never part of what §7 measures. */
const A_MINIBAR = 400_000n;

/**
 * The catalog row the minibar line names, written by this file and removed on
 * the way out. Unpriced, so the figure on the line is the one above rather than
 * one the catalog decided — and under its own code, so the case does not change
 * shape with whichever suite last touched §6's eight seeded items.
 */
const A_SERVICE_ITEM = {
  code: "TIER_SUITE_SUNDRIES",
  name: "Sundries",
  unitPriceGross: null,
  taxClass: "STANDARD",
} as const;

/** An account nobody has stayed under. */
const A_STRANGER = "tier-account-stranger";

/**
 * The member of staff who takes a night back off an account. A reversal is
 * attributed — `FR-FOL-01` — where a room charge posted by the night audit is
 * not, so this file needs one desk account and only for that.
 */
const A_RECEPTIONIST = {
  email: "le.tan.tier@mariva.test",
  fullName: "Trần Thị Mai",
} as const;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let tiers: TierDerivationService;
let catalog: CatalogService;
let roomTypeId: string;
let deskId: string;

// References, account addresses and stays are unique per case. Counted rather
// than drawn, so a failing run reproduces.
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

  await db
    .insert(serviceCatalog)
    .values(A_SERVICE_ITEM)
    .onConflictDoNothing({ target: serviceCatalog.code });

  await db.delete(staffUser).where(eq(staffUser.email, A_RECEPTIONIST.email));

  const [staff] = await db
    .insert(staffUser)
    .values({
      ...A_RECEPTIONIST,
      role: "RECEPTIONIST",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  deskId = staff!.id;

  const configuration = new SystemConfigService();

  folios = new FolioService(db, configuration, accrualOn(db));
  tiers = new TierDerivationService(
    configuration,
    new BusinessDateService(configuration),
  );
  catalog = new CatalogService();
});

beforeEach(async () => {
  await clearTheHistory();
  await theLadderIs({
    silverStays: UNREACHABLE.stays,
    silverRevenueVnd: UNREACHABLE.revenueVnd,
    goldStays: UNREACHABLE.stays,
    goldRevenueVnd: UNREACHABLE.revenueVnd,
  });
});

afterAll(async () => {
  // The rows this file committed. Left standing, its bookings and folios would
  // be fixtures the next file cannot clear, and the failure would surface a
  // file away from its cause.
  await clearTheHistory();
  await db
    .delete(serviceCatalog)
    .where(eq(serviceCatalog.code, A_SERVICE_ITEM.code));
  await db.delete(staffUser).where(eq(staffUser.email, A_RECEPTIONIST.email));
  await pool?.end();
});

describe("the rung a guest's own history puts them on", () => {
  it("makes two finished stays silver", async () => {
    const guest = await aGuestAccount();

    await aFinishedStay(guest, { departedOn: daysAgo(30) });
    await aFinishedStay(guest, { departedOn: daysAgo(10) });

    await theLadderIs({
      silverStays: 2,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
  });

  it("holds a guest one stay short of the rung below it", async () => {
    // The other half of the case above, and the one that would pass anyway if
    // the comparison were the wrong way round.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, { departedOn: daysAgo(10) });

    await theLadderIs({
      silverStays: 2,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
  });

  it("makes four finished stays gold, and not the silver they passed through", async () => {
    // §7's ladder is climbed, so a guest at four stays has met silver's rung as
    // well as gold's. The answer is the highest one reached.
    const guest = await aGuestAccount();

    for (const days of [120, 90, 60, 30]) {
      await aFinishedStay(guest, { departedOn: daysAgo(days) });
    }

    await theLadderIs({
      silverStays: 2,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("GOLD");
  });

  it("reaches silver on revenue alone, on a single stay", async () => {
    // The second axis, proved with the first put out of reach: §7 says "2 stays
    // **or** 15,000,000 ₫", and a guest who came once and spent the figure is
    // standing on the same rung as the guest who came twice.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, { departedOn: daysAgo(5) });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
  });

  it("reaches gold on revenue alone, on the same single stay", async () => {
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, { departedOn: daysAgo(5) });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net / 2n,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: stay.net,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("GOLD");
  });

  it("holds a guest one đồng short of the revenue rung", async () => {
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, { departedOn: daysAgo(5) });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net + 1n,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
  });

  it("adds up the revenue of every stay in the window", async () => {
    const guest = await aGuestAccount();
    const first = await aFinishedStay(guest, { departedOn: daysAgo(200) });
    const second = await aFinishedStay(guest, { departedOn: daysAgo(20) });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: first.net + second.net,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
  });

  it("leaves a guest who has never stayed a member", async () => {
    await db.insert(guestUser).values({
      id: A_STRANGER,
      name: "Phạm Văn An",
      email: `${A_STRANGER}@mariva.test`,
    });

    // On §7's own proposed ladder, which is what the column defaults hold: a
    // guest with nothing behind them reaches neither rung of a real one.
    await theLadderIs({
      silverStays: 2,
      silverRevenueVnd: 15_000_000n,
      goldStays: 4,
      goldRevenueVnd: 40_000_000n,
    });

    expect(await tiers.deriveTier(db, A_STRANGER)).toBe("MEMBER");
  });
});

describe("the trailing twelve months, and what falls out of them", () => {
  it("counts nothing a guest did thirteen months ago", async () => {
    // Both axes at once: the ladder below is one this guest's single stay would
    // clear on either, and it is out of the window on both.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, {
      departedOn: monthsAgo(13),
    });

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: stay.net,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
  });

  it("counts a stay that ended exactly twelve months ago", async () => {
    // The last day of a trailing twelve months is inside it, and the case above
    // is the one that would pass whichever way this boundary fell.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, { departedOn: monthsAgo(12) });

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: stay.net,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
  });

  it("counts nobody else's stays, however recent", async () => {
    const guest = await aGuestAccount();
    const neighbour = await aGuestAccount();

    await aFinishedStay(neighbour, { departedOn: daysAgo(1) });
    await aFinishedStay(neighbour, { departedOn: daysAgo(2) });

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
    expect(await tiers.deriveTier(db, neighbour)).toBe("SILVER");
  });

  it("counts a stay the guest never turned up for as nothing", async () => {
    // §7 puts the ladder on stays, and `state-machine.ts` makes `CHECKED_OUT`
    // reachable only by having slept. A cancellation is excluded structurally
    // rather than by a rule written here — the same property the accrual relies
    // on when it hangs off the folio close.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, { departedOn: daysAgo(5), state: "CANCELLED" });
    await aFinishedStay(guest, { departedOn: daysAgo(4), state: "NO_SHOW" });

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: 1n,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
  });

  it("counts a stay whose account is still open, and none of its money", async () => {
    // The two axes read the same stays and part company on one condition. A
    // guest who has left counts as having stayed the moment they leave; what
    // the stay came to is not settled until the desk agrees the account, so
    // `FR-GST-05`'s "final settled folio total" is what the revenue axis waits
    // for.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, {
      departedOn: daysAgo(3),
      agreed: false,
    });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: 1n,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
    // And the account really does carry the charge, so the first answer is an
    // exclusion rather than an empty folio.
    expect(await netRoomRevenueOn(stay.folioId)).toBeGreaterThan(0n);
  });

  it("stops counting a night the property agreed did not happen", async () => {
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, {
      departedOn: daysAgo(6),
      nights: 2,
    });
    const twoNights = stay.net;

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: twoNights,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");

    const undone = await aFinishedStay(guest, {
      departedOn: daysAgo(6),
      nights: 2,
      reverseTheFirstNight: true,
    });

    expect(await netRoomRevenueOn(undone.folioId)).toBe(twoNights / 2n);
  });
});

describe("the tax the property charges cannot move a tier", () => {
  it("measures the room charge net, not the gross the guest paid", async () => {
    // `FR-GST-04`'s acceptance criterion, as the boundary it protects. The rung
    // sits between the net and the gross, so an implementation reading either
    // the gross or the whole bill promotes this guest and the requirement is
    // that it does not.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, {
      departedOn: daysAgo(7),
      minibar: true,
    });

    expect(stay.net).toBeLessThan(A_NIGHT);

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: A_NIGHT,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");

    // And the account carries every line kind §7 excludes, so this is an
    // exclusion and not an absence.
    expect(new Set(await lineKindsOn(stay.folioId))).toEqual(
      new Set([
        "ROOM_CHARGE",
        "SERVICE_ITEM",
        "SERVICE_CHARGE_FEE",
        "VAT",
        "PAYMENT",
      ]),
    );
  });

  it("leaves every tier exactly where it was when the rates change", async () => {
    // The `ASM-01` isolation, stated as the thing an accountant's answer must
    // not do. Two guests either side of one rung, then the property's VAT and
    // service charge are moved a long way in both directions, and neither guest
    // moves. Nothing re-posts, which is the point: the derivation reads no rate
    // at all, so there is no route by which one could reach it.
    const promoted = await aGuestAccount();
    const held = await aGuestAccount();

    const stay = await aFinishedStay(promoted, { departedOn: daysAgo(8) });

    await aFinishedStay(held, { departedOn: daysAgo(8) });

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    // `held`'s stay is worth the same as `promoted`'s, so the two are separated
    // by the ladder rather than by their history — which is why the second one
    // is re-derived against a rung a đồng higher.
    expect(await tiers.deriveTier(db, promoted)).toBe("SILVER");

    for (const rates of [
      { standardVatRateBps: 9_999, serviceChargeRateBps: 5_000 },
      { standardVatRateBps: 0, serviceChargeRateBps: 0 },
    ]) {
      await db.update(systemConfig).set(rates);

      expect(await tiers.deriveTier(db, promoted)).toBe("SILVER");
    }

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net + 1n,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    for (const rates of [
      { standardVatRateBps: 9_999, serviceChargeRateBps: 5_000 },
      { standardVatRateBps: 0, serviceChargeRateBps: 0 },
    ]) {
      await db.update(systemConfig).set(rates);

      expect(await tiers.deriveTier(db, held)).toBe("MEMBER");
    }
  });
});

describe("what a derivation is, and is not", () => {
  it("writes nothing at all, whatever it answers", async () => {
    // `FR-GST-04` makes the tier a derived value, so a derivation that stored,
    // logged or audited its answer would be creating the second authority the
    // requirement exists to refuse. A tier *change* does write an audit row —
    // that is the rollover sweep's, because a change is only observable across
    // two recomputations and this method has no previous answer to compare
    // against.
    const guest = await aGuestAccount();

    await aFinishedStay(guest, { departedOn: daysAgo(9) });

    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const before = await whatIsStored();

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");
    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");

    expect(await whatIsStored()).toEqual(before);
  });

  it("answers for an account with no history and no row of its own", async () => {
    // A guest id that references nothing. The derivation reads history rather
    // than a guest record, so there is nothing for it to fail to find — and a
    // MEMBER is what it says, rather than raising.
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: 1n,
      goldStays: 4,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, "nobody-has-this-id")).toBe("MEMBER");
  });

  it("measures a guest by the same figure the accrual earned them points on", async () => {
    // One point per đồng, so the ledger row a close wrote *is* that stay's net
    // room revenue. A ladder set to the ledger's figure must promote the guest
    // and a ladder one đồng above it must not — which is the two readers of
    // `net-room-revenue.ts` agreeing on a number, asserted rather than assumed
    // from the fact that they share an import.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest, {
      departedOn: daysAgo(11),
      minibar: true,
    });

    const [earned] = await db
      .select({ points: loyaltyLedger.pointsEarned })
      .from(loyaltyLedger)
      .where(eq(loyaltyLedger.folioId, stay.folioId));

    expect(earned?.points).toBe(stay.net);

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: earned!.points,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("SILVER");

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: earned!.points + 1n,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    expect(await tiers.deriveTier(db, guest)).toBe("MEMBER");
  });
});

/**
 * The property's own calendar date, read from `Intl` rather than from the
 * service under test.
 *
 * At UTC+7 the property's date and the process's UTC date disagree for the last
 * seven hours of every day, and a fixture dated in UTC would drift past the
 * window's edge for those seven hours — which is a suite that fails in the
 * evening and passes in the morning.
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
 * The property's whole configuration, with §7's ladder set to this case's
 * figures.
 *
 * Written as one row rather than as an edit, because the derivation reads the
 * row and a case that patched four columns of a row another case had left
 * behind would depend on the order the file ran in.
 */
async function theLadderIs(rungs: Ladder): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values({
    // Unreal, and well above zero on both — §8 forbids a real rate here, and a
    // rate of nothing would make the net and the gross the same figure.
    standardVatRateBps: 1_234,
    reducedVatRateBps: 2_468,
    reducedVatFrom: null,
    reducedVatTo: null,
    vatIncludesServiceCharge: true,
    serviceChargeRateBps: 321,
    // Midnight, so the property's day is its calendar day and this file can date
    // its fixtures without borrowing the arithmetic under test.
    businessDateRolloverHour: 0,
    // One point per đồng, so a ledger row can be read as a net figure directly.
    loyaltyPointsPerUnit: 1,
    loyaltyEarnUnitVnd: 1n,
    tierSilverStays: rungs.silverStays,
    tierSilverRevenueVnd: rungs.silverRevenueVnd,
    tierGoldStays: rungs.goldStays,
    tierGoldRevenueVnd: rungs.goldRevenueVnd,
  });
}

/**
 * A stay that ended on the given date, charged for its nights and — unless the
 * case is about an account still open — paid for and agreed.
 *
 * Returns the net the account billed for rooms, read back off the postings the
 * way a reader would, so an expectation is the folio's own figure rather than
 * this file's arithmetic over a rate.
 */
async function aFinishedStay(
  guestUserId: string,
  options: {
    departedOn: CalendarDate;
    nights?: number;
    agreed?: boolean;
    minibar?: boolean;
    reverseTheFirstNight?: boolean;
    state?: "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";
  },
): Promise<{ bookingId: string; folioId: string; net: bigint }> {
  const {
    departedOn,
    nights = 1,
    agreed = true,
    minibar = false,
    reverseTheFirstNight = false,
    state = "CHECKED_OUT",
  } = options;

  ordinal += 1;

  const arrival = departedOn.subtract({ days: nights });
  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-TIER-${String(ordinal).padStart(4, "0")}`,
      state,
      cancellationReason: state === "CANCELLED" ? "GUEST_REQUEST" : null,
      cancelledAt: state === "CANCELLED" ? new Date() : null,
      roomTypeId,
      userId: guestUserId,
      checkInDate: arrival.toString(),
      checkOutDate: departedOn.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: A_NIGHT * BigInt(nights),
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const bookingId = stay!.id;
  const folioId = await folios.ensureFolio(db, bookingId);
  const posted: string[] = [];

  for (let night = 0; night < nights; night += 1) {
    posted.push(
      await folios.postRoomCharge(db, {
        folioId,
        grossAmount: A_NIGHT,
        businessDate: arrival.add({ days: night }),
        description: `Room charge, night of ${arrival.add({ days: night }).toString()}`,
        postedBy: null,
      }),
    );
  }

  if (minibar) {
    await folios.postServiceItem(db, {
      folioId,
      item: await catalog.sellableItem(db, A_SERVICE_ITEM.code),
      quantity: 1,
      grossAmount: A_MINIBAR,
      businessDate: departedOn,
      postedBy: null,
    });
  }

  if (reverseTheFirstNight) {
    await folios.reversePosting(db, {
      postingId: posted[0]!,
      businessDate: departedOn,
      postedBy: deskId,
    });
  }

  if (agreed) {
    const [owed] = await db
      .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
      .from(folioPosting)
      .where(eq(folioPosting.folioId, folioId));

    await folios.postPayment(db, {
      folioId,
      amount: BigInt(owed?.balance ?? "0"),
      businessDate: departedOn,
      description: "Card, ****4242",
      method: null,
      postedBy: null,
    });

    await folios.close(db, bookingId);
  }

  return { bookingId, folioId, net: await netRoomRevenueOn(folioId) };
}

/**
 * What the account billed for rooms, net — walked over the postings here rather
 * than asked of the module under test, so the expectations are independent of
 * the query they are checking.
 */
async function netRoomRevenueOn(folioId: string): Promise<bigint> {
  const lines = await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  const undone = new Set(
    lines.map((line) => line.reversesPostingId).filter((id) => id !== null),
  );

  return lines
    .filter((line) => line.type === "ROOM_CHARGE" && !undone.has(line.id))
    .reduce((total, line) => total + line.amount, 0n);
}

async function lineKindsOn(folioId: string): Promise<string[]> {
  const lines = await db
    .select({ type: folioPosting.type })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  return lines.map((line) => line.type);
}

/**
 * Every table a derivation could conceivably reach, counted.
 *
 * The change log and the ledger by name because they are what a tier would be
 * written into if anybody decided it should be; the rest because a derivation
 * that touched a folio or a booking would be rewriting the history it is
 * measuring.
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
    const [row] = await db.select({ rows: count() }).from(table);

    counted[name] = row?.rows ?? 0;
  }

  return counted;
}

/** An account on the public site, by the id Better Auth would have minted. */
async function aGuestAccount(): Promise<string> {
  ordinal += 1;

  const id = `tier-account-${String(ordinal).padStart(4, "0")}`;

  await db.insert(guestUser).values({
    id,
    name: "Nguyễn Thị Hương",
    email: `${id}@mariva.test`,
  });

  return id;
}

async function clearTheHistory(): Promise<void> {
  await db.execute(
    sql`truncate loyalty_ledger, folio_posting, folio, booking, guest_user restart identity cascade`,
  );
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
