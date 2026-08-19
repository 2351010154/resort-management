// §7's member discount, from the guest's own history to the price they are
// sold — `FR-GST-04`, and `property-and-tariff.md` §7.
//
// §7 says the discount is "Silver 5% · Gold 10%, applied as a promotions rate
// modifier (`FR-PRC-03`) — rides the existing pricing path". Three separate
// pieces have to agree for that sentence to be true of a running system, and
// each one of them can fail while looking correct:
//
//  1. `TierDerivationService` answers what rung the guest is on.
//  2. `StayQuoteService` finds the `promotion` row that rung is gated on and
//     prices the stay through it.
//  3. `BookingService` freezes what was applied, so the folio bills the figure
//     the guest agreed to rather than re-deriving one.
//
// A suite that exercised any of them alone would pass against a system where
// nobody is ever actually charged less — which is exactly the state this file
// was written to close. So it runs the real services against the migrated,
// seeded database, from a guest's stay history through to the row the sale
// wrote and the folio lines the night audit posts against it.
//
// No Nest application is booted, on `booking-lifecycle.e2e-spec.ts`'s grounds:
// the subject is the services and the rows underneath them. The two `promotion`
// rows are inserted from `LOYALTY_PROMOTIONS` rather than typed again here,
// because the claim is about the figures the property is actually seeded with —
// a copy would let this file go on passing after somebody retuned the shipped
// ones.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { PinoLogger } from "nestjs-pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { user as guestUser } from "../src/database/schema/guest-auth.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { folioPosting } from "../src/database/schema/folio.js";
import { promotion } from "../src/database/schema/pricing.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  type Booking,
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { RoomChargeSweep } from "../src/modules/folio/room-charge-sweep.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import {
  LOYALTY_PROMOTIONS,
  LoyaltyPromotionSeeder,
} from "../src/modules/pricing/loyalty-promotion.seeder.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { accrualOn } from "./accrual.js";
import {
  noCancellations,
  noConfirmations,
  noStayLinks,
} from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

/** The seeded calendar opens here, and every stay below is priced out of it. */
const SEED_FROM = parseDate("2027-06-01");

/** The property's day, stopped at the first night the seed prices. */
const TODAY = SEED_FROM;

const HOLD_TTL_MINUTES = 15;

/** One night of a stay this file books, as `seed/property.ts` prices it. */
const A_NIGHT_ON_THE_ACCOUNT = 1_000_000n;

/**
 * A rung no case reaches by accident — `tier-derivation.e2e-spec.ts`'s device,
 * and for its reason: a ladder both axes could climb would pass whichever one
 * the implementation happened to read.
 */
const UNREACHABLE = {
  stays: 900,
  revenueVnd: 1_000_000_000_000n,
} as const;

/**
 * The property's day, stopped — `booking-lifecycle.e2e-spec.ts` says why. The
 * derivation reads it too, so §7's trailing window runs back from the same date
 * the stays below are dated against.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bookings: BookingService;
let stays: AssignmentService;
let folios: FolioService;
let sweep: RoomChargeSweep;
let roomTypeId: string;

// References and account addresses are unique per case, counted rather than
// drawn so a failing run reproduces.
let ordinal = 0;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The real property and no synthetic stays against it, so the calendar prices
  // every night these cases book and no seeded booking is standing on the rooms.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  const [deluxe] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, "DELUXE"))
    .limit(1);

  roomTypeId = deluxe!.id;

  const configuration = new SystemConfigService();
  const clock = new StoppedClock(TODAY);
  const inventory = new InventoryService();
  const housekeeping = new HousekeepingService();

  folios = new FolioService(db, configuration, accrualOn(db));

  // Held rather than constructed inline, because the extension is a case here
  // and not only a collaborator: a stay lengthened after the sale reprices off
  // the promotion the booking froze, and that is this service's arithmetic.
  stays = new AssignmentService(
    inventory,
    clock,
    new StayQuoteService(),
    housekeeping,
  );

  bookings = new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    stays,
    new GuestService(),
    housekeeping,
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
    noStayLinks,
    noConfirmations,
    tiersAt(clock),
    // Nothing here cancels a confirmed stay that names somebody to write to.
    noCancellations,
  );

  sweep = new RoomChargeSweep(folios, silentLogger);
});

/**
 * A logger that says nothing.
 *
 * Typed through the methods actually called rather than cast from `undefined`,
 * so a collaborator that starts logging something else fails to compile here
 * instead of throwing at whichever case happened to reach it.
 */
const silentLogger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

beforeEach(async () => {
  await clearTheHistory();
  await theLadderIs({
    silverStays: UNREACHABLE.stays,
    silverRevenueVnd: UNREACHABLE.revenueVnd,
    goldStays: UNREACHABLE.stays,
    goldRevenueVnd: UNREACHABLE.revenueVnd,
  });
  await theShippedDiscountsExist();
});

afterAll(async () => {
  await clearTheHistory();
  await db.delete(promotion);
  await pool?.end();
});

describe("the discounts the property boots with", () => {
  it("writes §7's two rows, at §7's two figures", async () => {
    // The figures are asserted against §7 in prose rather than against the
    // constant the seeder exports, which would be the constant agreeing with
    // itself. Silver 5%, Gold 10%, both open-ended, both gated on their rung.
    const rows = await db.select().from(promotion).orderBy(promotion.code);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.code)).toEqual([
      "LOYALTY_GOLD",
      "LOYALTY_SILVER",
    ]);

    for (const row of rows) {
      expect(row.type).toBe("PERCENTAGE");
      expect(row.isActive).toBe(true);
      // A tier discount has no window and no length condition — a guest who
      // reached the rung holds it until the trailing window says otherwise.
      expect(row.validFrom).toBeNull();
      expect(row.validTo).toBeNull();
      expect(row.minNights).toBeNull();
    }

    expect(
      Object.fromEntries(
        rows.map((row) => [row.requiresLoyaltyTier, row.value]),
      ),
    ).toEqual({ SILVER: -5n, GOLD: -10n });
  });

  it("leaves a figure the property retuned exactly where it is", async () => {
    // The reason it is `on conflict do nothing`: a seeder that wrote on every
    // boot would silently roll back an `ADMIN`'s edit at the next deploy, which
    // is `SystemConfigSeeder`'s argument arriving at a price rather than a rate.
    await db
      .update(promotion)
      .set({ value: -12n })
      .where(eq(promotion.code, "LOYALTY_GOLD"));

    await new LoyaltyPromotionSeeder(db, silentLogger).onApplicationBootstrap();

    const [gold] = await db
      .select({ value: promotion.value })
      .from(promotion)
      .where(eq(promotion.code, "LOYALTY_GOLD"));

    expect(gold!.value).toBe(-12n);
    expect(await db.select().from(promotion)).toHaveLength(2);
  });

  it("restores a row somebody removed without disturbing the other", async () => {
    await db.delete(promotion).where(eq(promotion.code, "LOYALTY_SILVER"));
    await db
      .update(promotion)
      .set({ value: -12n })
      .where(eq(promotion.code, "LOYALTY_GOLD"));

    await new LoyaltyPromotionSeeder(db, silentLogger).onApplicationBootstrap();

    const rows = await db.select().from(promotion).orderBy(promotion.code);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.value)).toEqual([-12n, -5n]);
  });
});

describe("what a guest on the ladder is actually quoted", () => {
  it("sells a MEMBER the calendar price, with no promotion frozen", async () => {
    // The base case, and the one that makes every case below mean something: a
    // guest with an account and no standing is quoted exactly what the desk
    // would quote a stranger. §7 gives the base tier no discount, and this is
    // that sentence as a number.
    const guest = await aGuestAccount();
    const sold = await sell(guest, "2028-02-01", "2028-02-04");
    const row = await rowOf(sold);

    expect(row.quotedPromotionCode).toBeNull();
    expect(row.quotedPromotionType).toBeNull();
    expect(row.quotedPromotionValue).toBeNull();
    expect(sold.stayTotalGross).toBe(await standardTotalOf(sold));
  });

  it("takes five percent off a Silver guest's room rate", async () => {
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const sold = await sell(guest, "2028-02-05", "2028-02-08");
    const row = await rowOf(sold);
    const calendar = await standardTotalOf(sold);

    expect(row.quotedPromotionCode).toBe("LOYALTY_SILVER");
    expect(row.quotedPromotionType).toBe("PERCENTAGE");
    expect(row.quotedPromotionValue).toBe(-5n);
    expect(sold.stayTotalGross).toBe((calendar * 95n) / 100n);
    // Stated as money as well as as arithmetic, because a percentage applied to
    // the wrong base would satisfy the line above if the base were also wrong.
    expect(calendar - sold.stayTotalGross).toBe(calendar / 20n);
  });

  it("takes ten percent off a Gold guest's, and not five", async () => {
    // Both rows match a Gold guest — the gate is a floor, so Silver's applies to
    // them too — and the deeper of the two is the one they get. An
    // implementation that took the first row it read would be right about half
    // the time and wrong silently.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 2,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const sold = await sell(guest, "2028-02-09", "2028-02-12");
    const row = await rowOf(sold);
    const calendar = await standardTotalOf(sold);

    expect(row.quotedPromotionCode).toBe("LOYALTY_GOLD");
    expect(row.quotedPromotionValue).toBe(-10n);
    expect(sold.stayTotalGross).toBe((calendar * 90n) / 100n);
  });

  it("quotes the desk's own sale no discount at all", async () => {
    // A walk-in has no account, so there is no history to stand on. The row's
    // `user_id` is null and §7's ladder is about a guest's own stays.
    const sold = await sell(null, "2028-02-13", "2028-02-15");

    expect((await rowOf(sold)).quotedPromotionCode).toBeNull();
    expect(sold.stayTotalGross).toBe(await standardTotalOf(sold));
  });

  it("discounts the room and neither the breakfast nor the extra head", async () => {
    // §3's argument, applied to §7's modifier: a discount that reached the meal
    // would post a breakfast line the menu does not price, and one that reached
    // the third head would discount a bed the room rate never covered.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    // A `PREMIER` rather than a `DELUXE`: §1 sleeps three in one and two in the
    // other, and the third head is what makes the extra-person term non-zero.
    const sold = await sell(guest, "2028-02-16", "2028-02-19", {
      plan: "BB",
      party: { adults: 3, children: [] },
      roomType: "PREMIER",
    });
    const row = await rowOf(sold);
    const calendar = await standardTotalOf(sold);
    const nights = 3n;

    // The room under `BB`'s own percentage first, then Silver's five percent —
    // and the two per-head terms standing at full price beside them.
    const roomUnderThePlan =
      (calendar * BigInt(100 + row.quotedPercentAdjustment)) / 100n;
    const breakfast = row.quotedBreakfastPerPersonGross! * 3n * nights;
    const extraHead = row.quotedExtraPersonPerNightGross * nights;

    expect(row.quotedPromotionValue).toBe(-5n);
    expect(sold.stayTotalGross).toBe(
      (roomUnderThePlan * 95n) / 100n + breakfast + extraHead,
    );
  });
});

describe("what the tax the property charges can and cannot move", () => {
  it("leaves the discount where it was when VAT and the service charge change", async () => {
    // `FR-GST-04`'s acceptance criterion carried through to its consequence.
    // `tier-derivation.e2e-spec.ts` proves the *derivation* reads no rate; this
    // proves the same of the price the guest is sold, which is the thing the
    // requirement is protecting. The guest qualifies on the revenue axis —
    // the only axis a tax figure could reach — and their stay is re-sold under
    // rates moved a long way in both directions.
    const guest = await aGuestAccount();
    const stay = await aFinishedStay(guest);

    await theLadderIs({
      silverStays: UNREACHABLE.stays,
      silverRevenueVnd: stay.net,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    // Net and gross are different figures here, so a derivation reading the
    // wrong one is a case this can distinguish rather than an assumption.
    expect(stay.net).toBeLessThan(A_NIGHT_ON_THE_ACCOUNT);

    const quoted: bigint[] = [];
    let arrival = parseDate("2028-03-01");

    for (const rates of [
      { standardVatRateBps: 1_234, serviceChargeRateBps: 321 },
      { standardVatRateBps: 9_999, serviceChargeRateBps: 5_000 },
      { standardVatRateBps: 0, serviceChargeRateBps: 0 },
    ]) {
      await db.update(systemConfig).set(rates);

      const sold = await sell(
        guest,
        arrival.toString(),
        arrival.add({ days: 3 }).toString(),
      );
      const calendar = await standardTotalOf(sold);

      expect((await rowOf(sold)).quotedPromotionCode).toBe("LOYALTY_SILVER");
      quoted.push(calendar - sold.stayTotalGross);
      arrival = arrival.add({ days: 7 });
    }

    // The same nights at the same calendar price each time, so the reduction is
    // comparable across the three — and it does not move.
    expect(new Set(quoted).size).toBe(1);
    expect(quoted[0]).toBeGreaterThan(0n);
  });
});

describe("what the sale freezes, and what bills against it", () => {
  it("reproduces the total from the row and the nights it stored", async () => {
    // `schema/booking.ts`'s invariant, with a promotion in it: the stored
    // nights and the frozen inputs reproduce `quoted_stay_total_gross` exactly.
    // A promotion the freeze forgot would break this and nothing else.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const sold = await sell(guest, "2028-04-01", "2028-04-05");
    const row = await rowOf(sold);
    const calendar = await standardTotalOf(sold);

    expect(row.quotedStayTotalGross).toBe(
      (calendar * BigInt(100 + Number(row.quotedPromotionValue))) / 100n,
    );
  });

  it("bills the nights the guest was quoted, not the calendar's", async () => {
    // The failure this closes is the one nobody would notice: the sale takes
    // ten percent off and the night audit posts the undiscounted room rate, so
    // the folio and the confirmation disagree by an amount that looks like a
    // price. The sweep prices each night as the difference of two running
    // totals, so the nights have to sum back to what was sold.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 2,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const arrival = "2028-05-01";
    const departure = "2028-05-04";
    const sold = await sell(guest, arrival, departure);

    expect((await rowOf(sold)).quotedPromotionValue).toBe(-10n);

    await db
      .update(booking)
      .set({ state: "CHECKED_IN" })
      .where(eq(booking.id, sold.id));

    const folioId = await folios.ensureFolio(db, sold.id);
    let charged = 0n;

    for (const night of [arrival, "2028-05-02", "2028-05-03"]) {
      await db.transaction((exec) => sweep.run(exec, parseDate(night)));
      charged = await roomChargeGrossOn(folioId);
    }

    expect(charged).toBe(sold.stayTotalGross);
  });

  it("keeps the member rate on the nights an extension adds", async () => {
    // The extension reprices the whole stay from the booking's own frozen
    // figures, and the promotion is one of them. Dropping it there is the
    // quietest failure in the feature: `stayTotalGross` defaults the promotion
    // to none, so the extension would return the undiscounted room rate — a
    // larger number that still reconciles against the nights, still passes
    // every constraint, and raises a total the guest had already agreed.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: 2,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    const sold = await sell(guest, "2028-05-10", "2028-05-13");

    expect((await rowOf(sold)).quotedPromotionValue).toBe(-10n);

    const extended = await db.transaction((exec) =>
      stays.extendStay(exec, {
        bookingId: sold.id,
        checkOut: parseDate("2028-05-15"),
      }),
    );

    expect(extended.nightsAdded).toBe(2);

    // Ten percent off the calendar price of all five nights, and not off the
    // three that were sold at it — §8 reprices the stay whole, so the added
    // nights arrive under the terms the booking carries rather than at the
    // rack rate.
    const calendar = await standardTotalOf(sold);

    expect(extended.stayTotalGross).toBe((calendar * 90n) / 100n);
    expect((await rowOf(sold)).quotedStayTotalGross).toBe(
      extended.stayTotalGross,
    );
    expect(extended.stayTotalGross).toBeLessThan(calendar);
  });
});

describe("a promotion the property has withdrawn or gated differently", () => {
  it("is not applied once it is switched off", async () => {
    // `is_active` is the column that pulls a live campaign, and a discount that
    // went on applying after it was pulled would be a price nobody could stop.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    await db.update(promotion).set({ isActive: false });

    const sold = await sell(guest, "2028-01-05", "2028-01-08");

    expect((await rowOf(sold)).quotedPromotionCode).toBeNull();
    expect(sold.stayTotalGross).toBe(await standardTotalOf(sold));
  });

  it("is not applied to a guest who has not reached its rung", async () => {
    // A Silver guest and a Gold-gated discount. The gate is a floor and the
    // guest is below it, so the row is not theirs — which is the half of "gated
    // on" that a floor could otherwise be read as discarding.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    await db.delete(promotion).where(eq(promotion.code, "LOYALTY_SILVER"));

    const sold = await sell(guest, "2028-01-09", "2028-01-12");

    expect((await rowOf(sold)).quotedPromotionCode).toBeNull();
    expect(sold.stayTotalGross).toBe(await standardTotalOf(sold));
  });

  it("is not applied to a stay shorter than its minimum", async () => {
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    await db
      .update(promotion)
      .set({ minNights: 5 })
      .where(eq(promotion.code, "LOYALTY_SILVER"));

    const short = await sell(guest, "2028-01-13", "2028-01-16");

    expect((await rowOf(short)).quotedPromotionCode).toBeNull();

    const long = await sell(guest, "2028-01-17", "2028-01-23");

    expect((await rowOf(long)).quotedPromotionCode).toBe("LOYALTY_SILVER");
  });

  it("is not applied to a stay running past the end of its window", async () => {
    // The window has to cover the whole stay, because the discount is taken off
    // the summed room total — a campaign that lapsed mid-stay would otherwise
    // discount nights it had stopped applying to.
    const guest = await aGuestAccount();

    await aFinishedStay(guest);
    await theLadderIs({
      silverStays: 1,
      silverRevenueVnd: UNREACHABLE.revenueVnd,
      goldStays: UNREACHABLE.stays,
      goldRevenueVnd: UNREACHABLE.revenueVnd,
    });

    await db
      .update(promotion)
      .set({ validTo: "2028-01-25" })
      .where(eq(promotion.code, "LOYALTY_SILVER"));

    // Nights of the 24th, 25th and 26th — the last is past the window's end.
    const past = await sell(guest, "2028-01-24", "2028-01-27");

    expect((await rowOf(past)).quotedPromotionCode).toBeNull();

    // Nights of the 24th and 25th, both inside it. The departure is the 26th and
    // is not a night sold, which is what the window is compared against.
    const inside = await sell(guest, "2028-01-24", "2028-01-26");

    expect((await rowOf(inside)).quotedPromotionCode).toBe("LOYALTY_SILVER");
  });
});

/** The two rows §7 states, put there by the seeder that ships them. */
async function theShippedDiscountsExist(): Promise<void> {
  await db.delete(promotion);
  await new LoyaltyPromotionSeeder(db, silentLogger).onApplicationBootstrap();
}

/**
 * The property's whole configuration, with §7's ladder at this case's figures.
 *
 * One row rather than an edit, on `tier-derivation.e2e-spec.ts`'s grounds: a
 * case that patched four columns of a row another case left behind would depend
 * on the order the file ran in.
 */
async function theLadderIs(rungs: {
  silverStays: number;
  silverRevenueVnd: bigint;
  goldStays: number;
  goldRevenueVnd: bigint;
}): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values({
    // Unreal, and above zero on both — §8 forbids a real rate here, and a rate
    // of nothing would make the net and the gross the same figure.
    standardVatRateBps: 1_234,
    reducedVatRateBps: 2_468,
    reducedVatFrom: null,
    reducedVatTo: null,
    vatIncludesServiceCharge: true,
    serviceChargeRateBps: 321,
    // Midnight, so the property's day is its calendar day and this file can date
    // its fixtures without borrowing the arithmetic under test.
    businessDateRolloverHour: 0,
    loyaltyPointsPerUnit: 1,
    loyaltyEarnUnitVnd: 1n,
    tierSilverStays: rungs.silverStays,
    tierSilverRevenueVnd: rungs.silverRevenueVnd,
    tierGoldStays: rungs.goldStays,
    tierGoldRevenueVnd: rungs.goldRevenueVnd,
  });
}

/** An account with nothing behind it yet. */
async function aGuestAccount(): Promise<string> {
  ordinal += 1;

  const id = `loyalty-discount-guest-${ordinal}`;

  await db.insert(guestUser).values({
    id,
    name: "Nguyễn Thị Hạnh",
    email: `${id}@mariva.test`,
    emailVerified: true,
  });

  return id;
}

/**
 * A stay this guest finished and paid for, inside §7's trailing window.
 *
 * Written directly rather than sold through the service, because it is the
 * guest's *history* and not a case's subject — and because a stay sold through
 * the service would consume seeded inventory the cases below are counting on.
 * The folio is real, so the revenue axis has a net figure to measure and the
 * VAT and service-charge lines the case about rates needs are actually there.
 */
async function aFinishedStay(guestUserId: string): Promise<{ net: bigint }> {
  ordinal += 1;

  const departed = TODAY.subtract({ days: ordinal });
  const arrival = departed.subtract({ days: 1 });

  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-LOYD-${String(ordinal).padStart(4, "0")}`,
      state: "CHECKED_OUT",
      roomTypeId,
      userId: guestUserId,
      checkInDate: arrival.toString(),
      checkOutDate: departed.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: A_NIGHT_ON_THE_ACCOUNT,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const folioId = await folios.ensureFolio(db, stay!.id);

  await folios.postRoomCharge(db, {
    folioId,
    grossAmount: A_NIGHT_ON_THE_ACCOUNT,
    businessDate: arrival,
    description: `Room charge, night of ${arrival.toString()}`,
    postedBy: null,
  });

  const [owed] = await db
    .select({ balance: sql<string | null>`sum(${folioPosting.amount})` })
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  await folios.postPayment(db, {
    folioId,
    amount: BigInt(owed?.balance ?? "0"),
    businessDate: departed,
    description: "Card, ****4242",
    method: null,
    postedBy: null,
  });

  await folios.close(db, stay!.id);

  return { net: await netRoomRevenueOn(folioId) };
}

/** A confirmed sale, to this account or to nobody. */
async function sell(
  guestUserId: string | null,
  checkIn: string,
  checkOut: string,
  terms: {
    plan?: CreateBookingInput["plan"];
    party?: CreateBookingInput["party"];
    roomType?: RoomTypeCode;
  } = {},
): Promise<Booking> {
  const input: CreateBookingInput = {
    roomType: terms.roomType ?? "DELUXE",
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
    plan: terms.plan ?? "STANDARD",
    party: terms.party ?? { adults: 2, children: [] },
    userId: guestUserId,
  };

  return await db.transaction((exec) => bookings.createConfirmed(exec, input));
}

/** The booking row a sale wrote. */
async function rowOf(sold: Booking): Promise<typeof booking.$inferSelect> {
  const [row] = await db.select().from(booking).where(eq(booking.id, sold.id));

  return row!;
}

/**
 * The calendar price of the nights a sale stored, summed.
 *
 * Read off `booking_night` rather than recomputed from the rate calendar, so
 * the expectations are the property's own published prices and not this file's
 * arithmetic over them.
 */
async function standardTotalOf(sold: Booking): Promise<bigint> {
  const nights = await db
    .select({ standardGross: bookingNight.standardGross })
    .from(bookingNight)
    .where(eq(bookingNight.bookingId, sold.id));

  return nights.reduce((total, night) => total + night.standardGross, 0n);
}

/** What the night audit has actually charged for rooms, gross. */
async function roomChargeGrossOn(folioId: string): Promise<bigint> {
  const lines = await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId));

  // A room charge posts as a principal with its tax lines hanging off it, so
  // the gross the guest owes for rooms is the principal plus its children.
  const roomCharges = new Set(
    lines.filter((line) => line.type === "ROOM_CHARGE").map((line) => line.id),
  );

  return lines
    .filter(
      (line) =>
        roomCharges.has(line.id) ||
        (line.parentPostingId !== null && roomCharges.has(line.parentPostingId)),
    )
    .reduce((total, line) => total + line.amount, 0n);
}

/** What an account billed for rooms, net — §7's figure. */
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

/**
 * Every stay, account and guest this file has written.
 *
 * Left standing, its bookings would be history the next case derives a tier
 * from, and the failure would surface a case away from its cause.
 */
async function clearTheHistory(): Promise<void> {
  await db.execute(
    sql`truncate folio_posting, folio, loyalty_ledger, guest_tier_change, booking_link, room_assignment, booking_night, booking restart identity cascade`,
  );
  await db.delete(guestUser);
  // The nights this file's sales consumed, put back — the seeded inventory is
  // shared with every other case here and a sale that kept its room would make
  // a later one fail on availability rather than on price.
  await db.execute(sql`update type_inventory set sold_rooms = 0`);
}
