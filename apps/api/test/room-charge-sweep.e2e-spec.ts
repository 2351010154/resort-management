// The sweep that charges the night — `FR-FOL-01` and `FR-FOL-02`, against a
// real Postgres.
//
// `folio-service.e2e-spec.ts` proves what a gross figure becomes once somebody
// posts it. What it cannot prove is that anybody ever does: until this sweep
// runs, a guest checks in, sleeps five nights and departs owing nothing, because
// §4's check-out guard sums a folio nothing was ever written to. So what is
// asserted here is which stays the sweep charges, which it walks past, and — the
// claim the whole design turns on — *what a night costs*.
//
// Three of those are worth naming, because each is money the property or the
// guest would lose:
//
// - a night is charged at what the guest agreed to, extras included, and the
//   nights of a stay sum to `quoted_stay_total_gross` to the đồng;
// - a stay that is not in the building, and a date the stay does not cover, are
//   charged nothing;
// - a second run over the same business date posts nothing, in the same
//   transaction and in a later one — the property `job-runner.service.ts`
//   enforces on every run, checked against the real sweep rather than a probe.
//
// The stays are taken by the desk before they arrive and checked in on their
// arrival date, which is two `BookingService` instances over two stopped clocks:
// a booking cannot be created into the past and a guest cannot be admitted
// before the day they are due. That is the property's own day moving, and it is
// the only thing that puts a guest in the building.
//
// **The rows are committed rather than rolled back**, for the reason
// `folio-service.e2e-spec.ts` gives: the balance is read through `getBalance`,
// which takes a booking id and no executor, so fixtures written inside an open
// transaction would be invisible to the method under test. The ledger is
// therefore truncated on the way in and on the way out.
//
// No Nest application is booted for the behaviour — the subject is a sweep, a
// service and the rows underneath them. One case does boot the container, and
// only to answer the question the wiring turns on: whether the sweep is
// registered at all. A sweep that works and is in nobody's registry is the exact
// shape of the gap this file closes.
//
// The tax figures are deliberately unreal — 12.34% VAT over a 3.21% service
// charge. §8 forbids the tree from carrying a real rate, and a fixture that read
// like the property's would be that defect wearing a test's clothes. Nothing
// below asserts the split itself; that is the other file's claim, and this one
// only requires that the three lines sum back to the night.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type {
  Party,
  RatePlanCode,
  RoomTypeCode,
  StayDate,
  VndAmount,
} from "@mariva/shared";
import { Test } from "@nestjs/testing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio, folioPosting } from "../src/database/schema/folio.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { room, roomType, typeInventory } from "../src/database/schema/inventory.js";
import { rateCalendar } from "../src/database/schema/pricing.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { FolioService } from "../src/modules/folio/folio.service.js";
import { RoomChargeSweep } from "../src/modules/folio/room-charge-sweep.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { noAccrual } from "./accrual.js";
import {
  noCancellations,
  noConfirmations,
  noStayLinks,
} from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

const SEED_FROM = parseDate("2027-06-01");

/** The day the desk takes every stay below — before all of them arrive. */
const BOOKED_ON = SEED_FROM;

const ARRIVAL = "2027-06-10";
const DEPARTURE = "2027-06-13";

/** The nights a three-night stay sells, arrival first — never the departure. */
const NIGHTS = [ARRIVAL, "2027-06-11", "2027-06-12"] as const;

const FIRST_NIGHT = parseDate(ARRIVAL);
const SECOND_NIGHT = parseDate("2027-06-11");
const THE_DAY_THEY_LEAVE = parseDate(DEPARTURE);
const THE_DAY_BEFORE_THEY_ARRIVE = parseDate("2027-06-09");

/** A configuration nobody could mistake for a property's real one. */
const CONFIGURED = {
  standardVatRateBps: 1_234,
  reducedVatRateBps: 2_468,
  reducedVatFrom: null,
  reducedVatTo: null,
  vatIncludesServiceCharge: true,
  serviceChargeRateBps: 321,
  businessDateRolloverHour: 11,
} satisfies typeof systemConfig.$inferInsert;

// The two figures `seed.ts` writes into `rate_plan` and `property_tariff`, named
// here rather than imported: an expectation computed from the same constant the
// code reads would agree with it however wrong both were.
const BREAKFAST_PER_PERSON = 250_000n;
const EXTRA_PERSON_PER_NIGHT = 600_000n;

/**
 * Three calendar prices chosen so the plan's percentage does not divide.
 *
 * `NONREF` is `STANDARD` − 10%, which on the seed's own round figures truncates
 * nothing and would let a sweep that applied the percentage per night pass. On
 * these it does not: night by night the three come to 3,099,997 ₫, and the stay
 * was sold at 3,099,998 ₫. The đồng is the whole argument for charging a night
 * as the difference of two stay totals, so the fixture has to be able to lose it.
 */
const UNEVEN_PRICES = [1_111_111n, 999_999n, 1_333_333n] as const;

/** What that stay was quoted, and what its nights must come to. */
const UNEVEN_STAY_TOTAL = 3_099_998n;
const UNEVEN_NIGHTS = [999_999n, 900_000n, 1_199_999n] as const;

const A_RECEPTIONIST = {
  email: "le.tan.folio@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
} as const;

const HOLD_TTL_MINUTES = 20;

/**
 * The property's day, stopped — the same device the other sweep suites use. The
 * hour and the zone stay the real service's; only the instant it reads is fixed.
 */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

/**
 * The warnings the sweep raised, kept.
 *
 * A stand-in rather than a real logger, because the assertion is about the
 * sweep and not about pino: a run that leaves a guest under-charged has to say
 * which stay and which night, and the only place it can say it is here. The
 * charging path writes nothing to this, so a case that finds it empty has
 * proven the quiet run and not merely a quiet logger.
 */
const warnings: { detail: Record<string, unknown>; message: string }[] = [];

/**
 * The errors it raised, kept apart from the warnings.
 *
 * Two levels and two lists, because the sweep uses the difference to say which
 * of two things happened: an arrear is a night somebody has to re-run, and a
 * stay with no priced night is an invariant that has failed. A case asserting
 * one of them finds the other list empty, which is what makes the levels a
 * behaviour rather than a formatting choice.
 */
const errors: { detail: Record<string, unknown>; message: string }[] = [];

const log = {
  setContext: () => {},
  warn: (detail: Record<string, unknown>, message: string) => {
    warnings.push({ detail, message });
  },
  error: (detail: Record<string, unknown>, message: string) => {
    errors.push({ detail, message });
  },
} as unknown as PinoLogger;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let folios: FolioService;
let sweep: RoomChargeSweep;
let deskId: string;

// Every stay registers a guest, and a CCCD identifies one person. Counted rather
// than drawn, so a failing run reproduces.
let guestOrdinal = 0;

/** The desk, on a given day. */
function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(today);

  return new BookingService(
    inventory,
    new StayQuoteService(),
    clock,
    new AssignmentService(
      inventory,
      clock,
      new StayQuoteService(),
      new HousekeepingService(),
    ),
    new GuestService(),
    new HousekeepingService(),
    // The check-out guard is not exercised here and this suite never closes a
    // stay, so the port's simplest implementation is the honest one — see
    // `folio-stub.service.ts` on why it is shared rather than rewritten.
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    // Stubs that say so if they are, rather than casts that say nothing.
    noStayLinks,
    noConfirmations,
    // §7's ladder, reached only where a stay is sold to a signed-in guest.
    tiersAt(clock),
    // Nothing here cancels a confirmed stay that names somebody to write to.
    noCancellations,
  );
}

/** The rooms service, on a given day. */
function roomsAt(today: StayDate): AssignmentService {
  return new AssignmentService(
    new InventoryService(),
    new StoppedClock(today),
    new StayQuoteService(),
    new HousekeepingService(),
  );
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await clearTheLedger();
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });
  await store(CONFIGURED);

  // Removed first rather than upserted: the uniqueness on this table is over
  // `lower(email)`, which is an index `on conflict` cannot name.
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

  folios = new FolioService(db, new SystemConfigService(), noAccrual);
  sweep = new RoomChargeSweep(folios, log);
});

// Each case starts against the property as the seed laid it down, and against an
// empty ledger — a case reading a folio another one left behind is reading an
// account nobody opened.
beforeEach(async () => {
  warnings.length = 0;
  errors.length = 0;
  await clearTheLedger();
  await db.execute(
    sql`truncate registration, room_assignment, booking, guest restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  // The rows this file committed, taken back the only way a write-once table
  // allows. Left standing, a folio would hold a booking the next file's
  // `seedDatabase` cannot clear, and the failure would surface a file away from
  // its cause.
  await clearTheLedger();
  await pool?.end();
});

describe("the night a guest is sleeping", () => {
  it("posts it as the charge, the service charge and the tax", async () => {
    const stay = await checkedInStay();

    const posted = await runSweep(FIRST_NIGHT);

    expect(posted).toHaveLength(1);

    const lines = await linesOf(await folioOf(stay));

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.type).sort()).toEqual([
      "ROOM_CHARGE",
      "SERVICE_CHARGE_FEE",
      "VAT",
    ]);

    const charge = byType(lines, "ROOM_CHARGE");

    // The id the sweep answers with is the charge, which is the row a correction
    // is issued against — the two derived lines name it, so it is the handle on
    // the whole night rather than on a third of it.
    expect(posted).toEqual([charge.id]);
    expect(byType(lines, "SERVICE_CHARGE_FEE").parentPostingId).toBe(charge.id);
    expect(byType(lines, "VAT").parentPostingId).toBe(charge.id);

    for (const line of lines) {
      // No person wrote these. `schema/folio.ts` keeps the column null for the
      // writers with nobody behind them, and the sweep's own predicate reads it
      // back to recognise its work — so a placeholder account here would be a
      // sweep that could no longer tell its lines from the desk's.
      expect(line.postedBy).toBeNull();
      expect(line.businessDate).toBe(ARRIVAL);
    }
  });

  it("charges a plain stay exactly the calendar price of that night", async () => {
    // `STANDARD` moves the room rate by nothing and two adults are the included
    // occupancy, so the night the guest agreed to is the night the calendar
    // published — and the three lines have to sum back to it.
    const stay = await checkedInStay();

    await runSweep(FIRST_NIGHT);

    expect(await folios.getBalance(stay)).toBe(await priceOf(stay, ARRIVAL));
  });

  it("charges the plan's breakfast and the extra head on the night they are had", async () => {
    // §3 prices both per night. A sweep that posted only the calendar price
    // would bill a family of three for a bare room every night of their stay,
    // and the stay would settle for less than it was sold at.
    const stay = await checkedInStay({
      type: "PREMIER",
      plan: "BB",
      party: { adults: 2, children: [{ age: 8 }] },
    });

    await runSweep(FIRST_NIGHT);

    expect(await folios.getBalance(stay)).toBe(
      (await priceOf(stay, ARRIVAL)) +
        // Every head over six eats — three of them.
        BREAKFAST_PER_PERSON * 3n +
        // One head beyond the included two, and the cheapest head is the
        // eight-year-old at half the rate.
        EXTRA_PERSON_PER_NIGHT / 2n,
    );
  });
});

describe("a stay the sweep must not charge", () => {
  it("leaves one whose guest is not in the building", async () => {
    // A `CONFIRMED` stay is a room held for somebody who may still not come.
    // What that becomes is `FR-BOOK-04`'s no-show charge, which is `M9`'s to
    // post — not a night's rent this sweep would have to take back.
    const stay = await confirmedStay();

    expect(await runSweep(FIRST_NIGHT)).toEqual([]);
    expect(await folios.getBalance(stay)).toBe(0n);
  });

  it("leaves one on the morning it departs", async () => {
    // The half-open range: the guest leaving today slept last night, and last
    // night was charged last night. Charging the departure date would put a
    // night nobody slept on an invoice.
    const stay = await checkedInStay();

    expect(await runSweep(THE_DAY_THEY_LEAVE)).toEqual([]);
    expect(await folios.getBalance(stay)).toBe(0n);
  });

  it("leaves one on a date before it arrives", async () => {
    // The manual trigger takes any business date, so it can be handed one the
    // property has already left behind — and a stay that had not started is not
    // rent anybody owes for that night.
    const stay = await checkedInStay();

    expect(await runSweep(THE_DAY_BEFORE_THEY_ARRIVE)).toEqual([]);
    expect(await folios.getBalance(stay)).toBe(0n);
  });
});

describe("a night that was never charged", () => {
  it("is named, with the stay and the date to re-run", async () => {
    // The ordinary way this happens is not downtime. A guest arrives at 23:00
    // and the desk keys the check-in the next afternoon: the stay was
    // `CONFIRMED` for the whole night it slept, so no run selected it, and no
    // later run ever asks about that date again.
    const stay = await checkedInStay();

    expect(await runSweep(SECOND_NIGHT)).toHaveLength(1);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.detail).toMatchObject({
      businessDate: "2027-06-11",
      stays: 1,
      nights: 1,
      naming: [`${stay}@${ARRIVAL}`],
    });

    // Said, and not silently fixed. The arrival night is still off the account —
    // the header argues that back-posting it would drop a figure into a trading
    // day the property may already have reported, so recovery is a person
    // re-running this sweep over that date.
    const lines = await linesOf(await folioOf(stay));

    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.businessDate === "2027-06-11")).toBe(true);
  });

  it("stops being named once somebody re-runs the sweep over it", async () => {
    const stay = await checkedInStay();

    await runSweep(SECOND_NIGHT);
    warnings.length = 0;

    // The recovery `job-trigger.controller.ts` allows: the same sweep, over the
    // date it missed. The night lands at the rates and on the day it belongs to.
    expect(await runSweep(FIRST_NIGHT)).toHaveLength(1);
    expect(await runSweep(SECOND_NIGHT)).toEqual([]);

    expect(warnings).toEqual([]);

    // Both nights on the account, each dated to itself — which is the whole
    // point of recovering this way rather than posting the arrears as today's.
    const dated = new Set(
      (await linesOf(await folioOf(stay))).map((line) => line.businessDate),
    );

    expect(dated).toEqual(new Set([ARRIVAL, "2027-06-11"]));
  });

  it("says nothing about a stay whose nights are all on the account", async () => {
    await checkedInStay();

    await runSweep(FIRST_NIGHT);

    expect(warnings).toEqual([]);
  });

  it("still names a night the desk posted some other charge against", async () => {
    // The same `posted_by is null` narrowing the charging predicate uses, read
    // the other way, and the two have to agree. A late checkout billed on the
    // arrival night is not that night's rent — the sweep would still charge the
    // night, so the night is still owed, so it is still named. The alternative
    // is a report that goes quiet exactly when a receptionist happened to touch
    // the account.
    const stay = await checkedInStay();
    const folioId = await folios.ensureFolio(db, stay);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: 500_000n,
      businessDate: FIRST_NIGHT,
      description: "Late checkout, charged at the desk",
      postedBy: deskId,
    });

    await runSweep(SECOND_NIGHT);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.detail).toMatchObject({
      nights: 1,
      naming: [`${stay}@${ARRIVAL}`],
    });
  });
});

describe("a stay in house with no price for tonight", () => {
  // `booking_night` is written by the transaction that writes the stay, so this
  // is a broken invariant rather than a case the property meets. What is at
  // stake is the blast radius: the runner's boundary is the whole run, so the
  // question each case below asks is whether one unpriceable stay is allowed to
  // take every other guest's night with it.

  it("does not stop the stays it can price from being charged", async () => {
    const broken = await checkedInStay();
    // A room type of its own: two stays are in the building at once here, and
    // `aFreeRoom` hands back the lowest-numbered room of the type it is asked
    // for, which is the same room twice.
    const priced = await checkedInStay({ type: "PREMIER" });

    await stripThePriceOf(broken, ARRIVAL);

    // One charge, not none and not two. Thrown instead, this rolls back inside
    // the runner's transaction and neither guest is charged — on this run and on
    // every hourly run after it, until somebody repairs the row.
    expect(await runSweep(FIRST_NIGHT)).toHaveLength(1);

    expect(await linesOf(await folioOf(priced))).toHaveLength(3);
    await expect(folioOf(broken)).rejects.toThrow(/has no folio/);
  });

  it("names it, at a level of its own", async () => {
    const broken = await checkedInStay();

    await stripThePriceOf(broken, ARRIVAL);
    await runSweep(FIRST_NIGHT);

    // `error` and not `warn`. An arrear is a night a person re-runs at their
    // convenience; this is `booking_night` failing to cover a stay it is written
    // beside, and reported at the arrears' level it would be read as one.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.detail).toMatchObject({
      businessDate: ARRIVAL,
      stays: 1,
      naming: [broken],
    });

    expect(warnings).toEqual([]);
  });

  it("charges the night once the price is put back", async () => {
    // The recovery, and the reason carrying on rather than stopping loses
    // nothing: the row is repaired, somebody re-runs the date, and the night
    // lands at the rates and on the day it belongs to.
    const stay = await checkedInStay();
    const night = await stripThePriceOf(stay, ARRIVAL);

    expect(await runSweep(FIRST_NIGHT)).toEqual([]);

    await db.insert(bookingNight).values(night);

    expect(await runSweep(FIRST_NIGHT)).toHaveLength(1);
    expect(await linesOf(await folioOf(stay))).toHaveLength(3);
  });

  it("is the only record of the night, because the arrears report cannot see it", async () => {
    // Why this is an error and not a warning beside the arrears. That report
    // reads `booking_night` and names the rows it finds uncharged; a night with
    // no row is invisible to it, on this run and on every run after it. So the
    // line raised here is the only place the night is ever mentioned, and a
    // later run says nothing about it at all.
    const stay = await checkedInStay();

    await stripThePriceOf(stay, ARRIVAL);
    await runSweep(FIRST_NIGHT);

    expect(errors).toHaveLength(1);

    errors.length = 0;
    warnings.length = 0;

    // The next night is priced, so it is charged like any other — and nothing
    // anywhere goes back to the arrival night.
    expect(await runSweep(SECOND_NIGHT)).toHaveLength(1);

    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);

    const dated = (await linesOf(await folioOf(stay))).map(
      (line) => line.businessDate,
    );

    expect(new Set(dated)).toEqual(new Set(["2027-06-11"]));
  });
});

describe("the sweep as the runner requires it", () => {
  it("changes nothing on a second pass over the same transaction", async () => {
    const stay = await checkedInStay();

    // Exactly what `JobRunner` does before it commits: run, and if anything was
    // touched, run again and require nothing. A sweep failing this is rolled
    // back whole rather than discovered later on a guest's invoice.
    const [first, second] = await db.transaction(async (exec) => [
      await sweep.run(exec, FIRST_NIGHT),
      await sweep.run(exec, FIRST_NIGHT),
    ]);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(await linesOf(await folioOf(stay))).toHaveLength(3);
  });

  it("charges nothing when the night is run again hours later", async () => {
    // The manager re-running a night the scheduler missed, and the cron's own
    // later ticks. Both arrive as a separate transaction, which is the case the
    // runner's second pass cannot speak for.
    const stay = await checkedInStay();
    const charged = await runSweep(FIRST_NIGHT);

    expect(await runSweep(FIRST_NIGHT)).toEqual([]);

    expect(charged).toHaveLength(1);
    expect(await linesOf(await folioOf(stay))).toHaveLength(3);
  });

  it("still charges the night when the desk has posted a charge against it", async () => {
    // A late checkout billed at the desk is a room charge on today's business
    // date, and it is not tonight's rent. The predicate reads `posted_by` for
    // exactly this: without it, one receptionist posting anything would silently
    // wipe a night off the account.
    const stay = await checkedInStay();
    const folioId = await folios.ensureFolio(db, stay);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: 500_000n,
      businessDate: FIRST_NIGHT,
      description: "Late checkout, charged at the desk",
      postedBy: deskId,
    });

    expect(await runSweep(FIRST_NIGHT)).toHaveLength(1);

    expect(await folios.getBalance(stay)).toBe(
      500_000n + (await priceOf(stay, ARRIVAL)),
    );
  });

  it("changes nothing on a second pass when a stay could not be priced", async () => {
    // The pairing that would have been easy to get wrong: a stay the sweep walks
    // past is still selected on the second pass, because nothing was charged for
    // it. It has to be walked past again silently rather than counted as work,
    // or the runner reads the run as non-idempotent and rolls the other guest's
    // night back.
    const broken = await checkedInStay();
    const priced = await checkedInStay({ type: "PREMIER" });

    await stripThePriceOf(broken, ARRIVAL);

    const [first, second] = await db.transaction(async (exec) => [
      await sweep.run(exec, FIRST_NIGHT),
      await sweep.run(exec, FIRST_NIGHT),
    ]);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(await linesOf(await folioOf(priced))).toHaveLength(3);
  });

  it("reports a run once, however many passes the runner takes over it", async () => {
    // The runner calls a sweep twice inside one transaction whenever the first
    // pass touched anything, and neither report's answer moves between the two.
    // Said on both, one incident reads as two to whoever is triaging it.
    await checkedInStay();
    const broken = await checkedInStay({ type: "PREMIER" });

    await stripThePriceOf(broken, "2027-06-11");

    await db.transaction(async (exec) => {
      await sweep.run(exec, SECOND_NIGHT);
      await sweep.run(exec, SECOND_NIGHT);
    });

    // One of each, not two. Both stays are carrying an uncharged arrival night,
    // so the arrears line names them together — the count that matters here is
    // the number of lines, not the number of stays on them.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.detail).toMatchObject({ stays: 2, nights: 2 });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.detail).toMatchObject({ stays: 1, naming: [broken] });
  });

  it("reports each date it is asked about, even inside one transaction", async () => {
    // A run is a transaction and a date, not a transaction. Nothing asks this
    // sweep for two dates in one boundary today; keyed on the transaction alone
    // it would answer the second date as though it were the first date's second
    // pass, and the night it could not price would go unsaid.
    const broken = await checkedInStay();

    await stripThePriceOf(broken, ARRIVAL);
    await stripThePriceOf(broken, "2027-06-11");

    await db.transaction(async (exec) => {
      await sweep.run(exec, FIRST_NIGHT);
      await sweep.run(exec, SECOND_NIGHT);
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((raised) => raised.detail.businessDate)).toEqual([
      ARRIVAL,
      "2027-06-11",
    ]);
  });

  it("is registered on the scheduler, under a cron it can be found by", async () => {
    // The one case that boots the container. `jobs.module.ts` keeps the registry
    // as a list somebody has to edit, which buys a readable file at the cost of
    // a sweep that can exist and never run — so the registry is asserted rather
    // than assumed.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, JobsModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const registered = app.get(JobRunner).find("room-charge");

      expect(registered).toBeInstanceOf(RoomChargeSweep);
      // Five fields, and one that fires more than once a day: the rollover hour
      // is configuration, so a sweep pinned to a single hour would charge the
      // wrong night the morning after somebody moved it.
      expect(registered?.schedule).toMatch(/^\S+ \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

describe("the nights of a stay against the figure it was sold at", () => {
  it("sums to the agreed total to the đồng, on prices the plan does not divide", async () => {
    // `NFR-02` over a whole stay, and the reason a night is charged as the
    // difference of two stay totals rather than by running §3 once a night. The
    // three amounts below are what telescoping produces; applying the
    // percentage per night instead yields 999,999 / 899,999 / 1,199,999, which
    // is a đồng the guest was quoted and never billed.
    const stay = await unevenlyPricedStay();

    const charged: VndAmount[] = [];

    for (const night of NIGHTS) {
      const before = await folios.getBalance(stay);

      expect(await runSweep(parseDate(night))).toHaveLength(1);

      charged.push((await folios.getBalance(stay)) - before);
    }

    expect(charged).toEqual([...UNEVEN_NIGHTS]);
    expect(await folios.getBalance(stay)).toBe(UNEVEN_STAY_TOTAL);
    expect(await folios.getBalance(stay)).toBe(await quotedTotalOf(stay));
  });
});

/** The sweep, through the boundary the runner opens around it. */
async function runSweep(businessDate: StayDate): Promise<readonly string[]> {
  return await db.transaction((exec) => sweep.run(exec, businessDate));
}

interface StayOptions {
  readonly type?: RoomTypeCode;
  readonly plan?: RatePlanCode;
  readonly party?: Party;
  readonly checkIn?: string;
  readonly checkOut?: string;
}

/** A confirmed stay with its nights consumed, taken before it arrives. */
async function confirmedStay(options: StayOptions = {}): Promise<string> {
  const made = await db.transaction((tx) =>
    deskAt(BOOKED_ON).createConfirmed(tx, {
      roomType: options.type ?? "SUPERIOR",
      checkIn: parseDate(options.checkIn ?? ARRIVAL),
      checkOut: parseDate(options.checkOut ?? DEPARTURE),
      plan: options.plan ?? "STANDARD",
      party: options.party ?? { adults: 2, children: [] },
    }),
  );

  return made.id;
}

/** A stay holding a room, with its party registered and its guest in it. */
async function checkedInStay(options: StayOptions = {}): Promise<string> {
  const id = await confirmedStay(options);
  const checkIn = options.checkIn ?? ARRIVAL;
  const roomNumber = await aFreeRoom(options.type ?? "SUPERIOR");

  await db.transaction((tx) =>
    roomsAt(BOOKED_ON).assign(tx, { bookingId: id, roomNumber }),
  );

  guestOrdinal += 1;

  await db.transaction((tx) =>
    deskAt(parseDate(checkIn)).checkIn(tx, {
      bookingId: id,
      guests: [
        {
          fullName: "Trần Thị Mai",
          // One person per stay: a CCCD identifies a human being, and two stays
          // sharing one would be the same guest in two rooms.
          cccdNumber: `0793010${String(40_000 + guestOrdinal)}`,
          nationality: "VN",
        },
      ],
    }),
  );

  return id;
}

/**
 * A checked-in stay whose nights were published at {@link UNEVEN_PRICES}.
 *
 * The calendar is moved for the three nights, the stay is sold against it, and
 * the published prices are put back — a rate a manager edits is data, and the
 * booking freezes what it was sold at, so nothing downstream reads the calendar
 * again. Restoring keeps this file's edit out of every suite that runs after it.
 */
async function unevenlyPricedStay(): Promise<string> {
  const [type] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, "DELUXE"))
    .limit(1);

  const published = await db
    .select({
      stayDate: rateCalendar.stayDate,
      grossPerNight: rateCalendar.grossPerNight,
    })
    .from(rateCalendar)
    .where(
      and(
        eq(rateCalendar.roomTypeId, type!.id),
        inArray(rateCalendar.stayDate, [...NIGHTS]),
      ),
    );

  try {
    for (const [index, night] of NIGHTS.entries()) {
      await db
        .update(rateCalendar)
        .set({ grossPerNight: UNEVEN_PRICES[index]! })
        .where(
          and(
            eq(rateCalendar.roomTypeId, type!.id),
            eq(rateCalendar.stayDate, night),
          ),
        );
    }

    return await checkedInStay({ type: "DELUXE", plan: "NONREF" });
  } finally {
    for (const night of published) {
      await db
        .update(rateCalendar)
        .set({ grossPerNight: night.grossPerNight })
        .where(
          and(
            eq(rateCalendar.roomTypeId, type!.id),
            eq(rateCalendar.stayDate, night.stayDate),
          ),
        );
    }
  }
}

/**
 * A room of that type nothing is holding.
 *
 * The lowest-numbered one, and it is free because every case truncates the
 * assignments before it runs. Looked up rather than written down: the numbering
 * is `seed.ts`'s display-order rule, and a suite that hard-coded it would fail
 * on a property whose mix changed rather than on a sweep that broke.
 */
async function aFreeRoom(code: RoomTypeCode): Promise<string> {
  const [found] = await db
    .select({ number: room.number })
    .from(room)
    .innerJoin(roomType, eq(roomType.id, room.roomTypeId))
    .where(eq(roomType.code, code))
    .orderBy(room.number)
    .limit(1);

  if (!found) throw new Error(`the property owns no ${code} room`);

  return found.number;
}

/**
 * Takes one night's price off a stay, and hands the row back to put it again.
 *
 * The only way to reach the state from outside: `booking_night` is written by
 * the transaction that writes the stay and an extension appends to both, so
 * nothing a caller can ask for produces a stay in house on a night it has no
 * price for. Deleting the row is the shape the defect would take — a partial
 * write, a repair somebody made by hand — without a fixture pretending it is
 * ordinary.
 */
async function stripThePriceOf(
  bookingId: string,
  night: string,
): Promise<typeof bookingNight.$inferInsert> {
  const [removed] = await db
    .delete(bookingNight)
    .where(
      and(
        eq(bookingNight.bookingId, bookingId),
        eq(bookingNight.stayDate, night),
      ),
    )
    .returning();

  if (!removed) {
    throw new Error(`booking ${bookingId} has no priced night on ${night}`);
  }

  return removed;
}

/** The account one stay runs up. */
async function folioOf(bookingId: string): Promise<string> {
  const [account] = await db
    .select({ id: folio.id })
    .from(folio)
    .where(eq(folio.bookingId, bookingId));

  if (!account) throw new Error(`booking ${bookingId} has no folio`);

  return account.id;
}

/** Every line on one account, oldest first. */
async function linesOf(
  folioId: string,
): Promise<readonly (typeof folioPosting.$inferSelect)[]> {
  return await db
    .select()
    .from(folioPosting)
    .where(eq(folioPosting.folioId, folioId))
    .orderBy(folioPosting.postedAt, folioPosting.id);
}

/** The one line of a type this case posted. */
function byType(
  lines: readonly (typeof folioPosting.$inferSelect)[],
  type: (typeof folioPosting.$inferSelect)["type"],
): typeof folioPosting.$inferSelect {
  const found = lines.filter((line) => line.type === type);

  if (found.length !== 1) {
    throw new Error(`expected one ${type} line, found ${found.length}`);
  }

  return found[0]!;
}

/** The calendar price one night was sold at, as the booking froze it. */
async function priceOf(bookingId: string, night: string): Promise<VndAmount> {
  const [priced] = await db
    .select({ standardGross: bookingNight.standardGross })
    .from(bookingNight)
    .where(
      and(
        eq(bookingNight.bookingId, bookingId),
        eq(bookingNight.stayDate, night),
      ),
    );

  if (!priced) throw new Error(`booking ${bookingId} has no night on ${night}`);

  return priced.standardGross;
}

/** What the stay was sold for, from the row that froze it. */
async function quotedTotalOf(bookingId: string): Promise<VndAmount> {
  const [sold] = await db
    .select({ total: booking.quotedStayTotalGross })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return sold!.total;
}

/** The one configuration row, replaced. */
async function store(values: typeof systemConfig.$inferInsert): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values(values);
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is
 *  the only way back — it needs rights over the table rather than over its rows,
 *  which is the distinction `schema/folio.ts` draws. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}
