// The guard `booking-state-machine.md` §4 has always asked, answered for the
// first time from a real ledger — `FR-FOL-01`, and `ports/folio.port.ts`.
//
// `M4` bound `FOLIO_PORT` to a stub that reported every folio settled, because
// there was no ledger and zero was the true state of a system with no money in
// it. `M6` moves the binding to `FolioService`. What has to be shown is that the
// move is real: that the object behind the token is the folio's own service and
// not a second instance, that a stay owing money is refused at the desk, and
// that the same stay leaves once it has paid.
//
// It boots the application rather than constructing the services, which is the
// whole point — the subject is the wiring in `booking.module.ts`, and a suite
// that assembled `BookingService` by hand would prove that a `FolioService`
// passed to a constructor answers correctly and say nothing about what Nest
// actually injects. `check-in-out.e2e-spec.ts` already covers the transition
// itself against a port answering whatever the case needs; nothing there is
// touched or repeated here.
//
// The property's day is stopped, for the reason `booking-journey.e2e-spec.ts`
// gives: the seeded calendar is in 2027, and an arrival window means nothing
// unless the test decides where today falls against it.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import { BookingService } from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FOLIO_PORT, type FolioPort } from "../src/modules/booking/ports/folio.port.js";
import { FolioService } from "../src/modules/folio/folio.service.js";

const SEED_FROM = parseDate("2027-06-01");

const ARRIVAL = parseDate("2027-06-10");
const DEPARTURE = parseDate("2027-06-15");

// Superiors, per `seed.ts`'s display-order rule: the twelve take 201–210 and
// then 301, 302. One per case, because every stay below covers the same nights
// and `room_assignment`'s `EXCLUDE` constraint is right to refuse a second guest
// in the same bed.
const SUPERIOR_ROOMS = ["201", "202", "203", "204"] as const;

// No CCCD. `guest_cccd_number_key` refuses a second row carrying one, and this
// file registers a party per case — the number proves nothing about the guard
// under test and would only need clearing between runs.
const A_GUEST = {
  fullName: "Đỗ Thị Kim Ngân",
  nationality: "VN",
} as const;

/** One night, gross, as the desk would charge it. */
const A_NIGHT = 1_000_000n;

/** The property's day, stopped. Only the instant it reads is fixed; the hour and
 *  the zone stay the real service's. */
class PropertyDay extends BusinessDateService {
  constructor(private today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

const day = new PropertyDay(ARRIVAL);

let app: INestApplication;
let db: Database;
let bookings: BookingService;
let rooms: AssignmentService;
let folios: FolioService;
let runner: TransactionRunner;

// Counted rather than drawn, so a failing run reproduces and each stay takes a
// room of its own.
let stayOrdinal = 0;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BusinessDateService)
    .useValue(day)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Before the seed, which clears the bookings a folio would still be holding.
  await clearTheLedger();

  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // Whatever condition the seed left the rooms in. Absent, a room reads `CLEAN`,
  // which is the state §4's room-ready guard admits a guest into.
  await db.delete(roomCondition);

  bookings = app.get(BookingService);
  rooms = app.get(AssignmentService);
  folios = app.get(FolioService);
  runner = app.get(TransactionRunner);
}, 120_000);

afterAll(async () => {
  // A posting cannot be deleted, so the accounts this file opened are truncated
  // rather than cleared — left standing, they hold bookings the next file's
  // `seedDatabase` cannot delete.
  await clearTheLedger();
  await app?.close();
});

describe("the token the check-out guard reads through", () => {
  it("resolves to the folio's own service and not a second copy of it", async () => {
    // `useExisting` rather than `useClass`. A second instance would answer from
    // the same tables and pass every case below, and would be a bug the day the
    // service holds anything at all.
    expect(app.get<FolioPort>(FOLIO_PORT)).toBe(folios);
  });

  it("answers zero for a stay nothing has ever charged", async () => {
    // What the stub used to assert by construction, now derived: a booking with
    // no account has had nothing posted to it, so there is nothing outstanding.
    const bookingId = await aStayInHouse();

    expect(await app.get<FolioPort>(FOLIO_PORT).getBalance(bookingId)).toBe(0n);
  });
});

describe("a departure against the ledger", () => {
  it("is refused while the folio is owed money", async () => {
    const bookingId = await aStayInHouse();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: ARRIVAL,
      description: "One night, Superior",
    });

    const refusal = await refused(
      runner.run(async (exec) => await bookings.checkOut(exec, bookingId)),
    );

    expect(refusal.code).toBe("CONFLICT");
    expect((refusal.data as { code?: unknown }).code).toBe("FOLIO_NOT_SETTLED");

    // Refused, and nothing about the stay moved with the refusal — the
    // transaction the runner opened rolled back with it.
    expect(await stateOf(bookingId)).toBe("CHECKED_IN");
  });

  it("is refused while the guest is owed money", async () => {
    // §4 says "Balance ≠ 0", not "> 0". A guest who overpaid is owed a refund at
    // the desk, and a check-out that walked past it would close the stay on
    // money the property is holding and the guest has left without.
    const bookingId = await aStayInHouse();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postPayment(db, {
      folioId,
      amount: 200_000n,
      businessDate: ARRIVAL,
      description: "Deposit taken at the desk",
      // The desk took it, so this posting writes the payer's side too — a
      // transfer, which reaches the bank rather than the drawer.
      method: "BANK_TRANSFER",
    });

    const refusal = await refused(
      runner.run(async (exec) => await bookings.checkOut(exec, bookingId)),
    );

    expect((refusal.data as { code?: unknown }).code).toBe("FOLIO_NOT_SETTLED");
    expect(await stateOf(bookingId)).toBe("CHECKED_IN");
  });

  it("goes through once the account comes to nothing", async () => {
    const bookingId = await aStayInHouse();
    const folioId = await folios.ensureFolio(db, bookingId);

    await folios.postRoomCharge(db, {
      folioId,
      grossAmount: A_NIGHT,
      businessDate: ARRIVAL,
      description: "One night, Superior",
    });

    await folios.postPayment(db, {
      folioId,
      amount: A_NIGHT,
      businessDate: ARRIVAL,
      description: "Card payment",
      // A card is the gateway's, and the gateway writes its own row.
      method: null,
    });

    expect(await folios.getBalance(bookingId)).toBe(0n);

    const left = await runner.run(
      async (exec) => await bookings.checkOut(exec, bookingId),
    );

    expect(left.state).toBe("CHECKED_OUT");
  });
});

/** A confirmed stay that holds a room of its own and has been admitted to it. */
async function aStayInHouse(): Promise<string> {
  const roomNumber = SUPERIOR_ROOMS[stayOrdinal]!;

  stayOrdinal += 1;

  const made = await runner.run(
    async (exec) =>
      await bookings.createConfirmed(exec, {
        roomType: "SUPERIOR",
        checkIn: ARRIVAL,
        checkOut: DEPARTURE,
        plan: "STANDARD",
        party: { adults: 2, children: [] },
      }),
  );

  await runner.run(
    async (exec) =>
      await rooms.assign(exec, { bookingId: made.id, roomNumber }),
  );

  await runner.run(
    async (exec) =>
      await bookings.checkIn(exec, {
        bookingId: made.id,
        guests: [A_GUEST],
      }),
  );

  return made.id;
}

/** The state the booking table holds for a stay. */
async function stateOf(bookingId: string): Promise<string> {
  const [found] = await db
    .select({ state: booking.state })
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);

  return found!.state;
}

/** Both ledger tables, emptied. A posting cannot be deleted, so `truncate` is the
 *  only way back. */
async function clearTheLedger(): Promise<void> {
  await db.execute(sql`truncate folio_posting, folio restart identity cascade`);
}

/** The refusal a call provoked. Fails the case if it was accepted. */
async function refused(work: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the desk accepted a departure it should have refused");
}
