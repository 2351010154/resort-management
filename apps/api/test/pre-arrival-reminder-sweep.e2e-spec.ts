// The sweep that tells tomorrow's arrivals they arrive tomorrow —
// `FR-NTF-01`'s pre-arrival reminder.
//
// The confirmation goes out when a stay is paid for, which can be months before
// the guest travels, and nothing else in the tree writes to them again. So what
// is asserted here is the predicate and the mark, in the directions that cost
// somebody something:
//
// - a confirmed stay arriving on the business date plus one is mailed, once, with
//   the day, the room type, the address and the identity document in the body;
// - a stay arriving today, a stay arriving the day after tomorrow and a hold
//   arriving tomorrow are all left alone;
// - a stay with nobody to write to is neither mailed nor marked — the mark means
//   "a reminder went out", and a mark with no message behind it is worse than
//   neither;
// - a second pass over the same transaction finds nothing, which is the property
//   `job-runner.service.ts` enforces on every run, checked here against the real
//   sweep rather than against a probe;
// - a run that rolls back sends nothing and marks nothing, which is the pairing
//   the whole design turns on: the marks and the messages must not come apart, or
//   the next tick mails a guest twice.
//
// The stays are taken on a day before they arrive and swept on the day before
// they do — two `BookingService` instances over two stopped clocks, because a
// booking cannot be created into the past.
//
// Every run goes through `TransactionRunner`, which is the boundary `JobRunner`
// opens: the messages are handed over after the commit, so a case opening its own
// transaction would be asserting on a moment the running system does not send at.
// One case boots the container, and only to answer the question the wiring turns
// on — whether the sweep is in the registry at all.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { Env } from "../src/config/env.js";
import type { Database } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import * as schema from "../src/database/schema/index.js";
import { typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { JobRunner } from "../src/jobs/job-runner.service.js";
import { JobsModule } from "../src/jobs/jobs.module.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { PreArrivalReminderSweep } from "../src/modules/booking/pre-arrival-reminder-sweep.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import type { MailQueue } from "../src/modules/notification/mail-queue.service.js";
import type { OutgoingEmail } from "../src/modules/notification/mailer.service.js";
import { PreArrivalReminderService } from "../src/modules/notification/pre-arrival-reminder.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import {
  noCancellations,
  noConfirmations,
  noStayLinks,
} from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

const SEED_FROM = parseDate("2027-06-01");

/** The day the desk takes every stay below — before all of them arrive. */
const BOOKED_ON = SEED_FROM;

/** The day the sweep runs as. Tomorrow is the arrival it is looking for. */
const BUSINESS_DATE = parseDate("2027-06-10");

const TOMORROW = "2027-06-11";
const DEPARTURE = "2027-06-14";

const CONTACT = { email: "khach@example.test", name: "Trần Minh" } as const;
const ANOTHER = { email: "khach2@example.test", name: "Lê Hoà" } as const;

const HOLD_TTL_MINUTES = 20;

/** The property's day, stopped — the same device the other sweep suites use. */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

const silentLogger = { error: vi.fn() } as unknown as PinoLogger;

let pool: pg.Pool;
let db: Database;
let transactions: TransactionRunner;
let sweep: PreArrivalReminderSweep;

/** Every message the reminder service handed over, oldest first. */
let queued: OutgoingEmail[];

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
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
    // None of the three is reached: nothing here confirms a paid hold and
    // nothing cancels a confirmed stay.
    noStayLinks,
    noConfirmations,
    tiersAt(clock),
    noCancellations,
  );
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });
  transactions = new TransactionRunner(db);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // The real reminder service over a queue that records rather than delivers, so
  // what is read back is the body a guest would receive.
  sweep = new PreArrivalReminderSweep(
    new PreArrivalReminderService(
      {
        enqueue: async (email: OutgoingEmail) => {
          queued.push(email);
        },
      } as MailQueue,
      silentLogger,
    ),
  );
});

beforeEach(async () => {
  queued = [];

  await db.execute(
    sql`truncate registration, room_assignment, booking, guest restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

describe("the guests who arrive tomorrow", () => {
  it("writes to each of them once, and marks the stay as reminded", async () => {
    const first = await confirmedStay({ contact: CONTACT });
    const second = await confirmedStay({ contact: ANOTHER });

    const reminded = await runSweep();

    expect([...reminded].sort()).toEqual([first.id, second.id].sort());
    expect(queued).toHaveLength(2);
    expect(queued.map((email) => email.to).sort()).toEqual(
      [ANOTHER.email, CONTACT.email].sort(),
    );

    expect(await remindedAt(first.id)).toBeInstanceOf(Date);
    expect(await remindedAt(second.id)).toBeInstanceOf(Date);
  });

  it("tells the guest the day, the room, the address and what to bring", async () => {
    const stay = await confirmedStay({ contact: CONTACT });

    await runSweep();

    const message = queued[0]!;

    expect(message.subject).toContain(stay.reference);
    // The room type by its own name, which is what the guest chose in the funnel
    // — `SUPERIOR` is what the property's screens say.
    expect(message.text).toContain("Superior");
    expect(message.text).toContain("11 June 2027");
    expect(message.text).toContain("14:00");
    expect(message.text).toContain("Nha Trang");
    // The line the whole message exists for: `FR-GST-02` has the desk read a
    // document before a room is handed over, so a guest without one cannot be
    // checked in at all.
    expect(message.text).toContain("identity document");
  });
});

describe("the stays the sweep must not write to", () => {
  it("leaves one arriving on the business date itself", async () => {
    // Today's arrivals were reminded yesterday. Reminding them again would be
    // the property telling a guest standing in the lobby to come tomorrow.
    const today = await confirmedStay({
      contact: CONTACT,
      checkIn: BUSINESS_DATE.toString(),
    });

    expect(await runSweep()).toEqual([]);
    expect(queued).toHaveLength(0);
    expect(await remindedAt(today.id)).toBeNull();
  });

  it("leaves one arriving the day after tomorrow", async () => {
    const later = await confirmedStay({
      contact: CONTACT,
      checkIn: "2027-06-12",
    });

    expect(await runSweep()).toEqual([]);
    expect(await remindedAt(later.id)).toBeNull();
  });

  it("leaves a hold, which is a stay nobody has confirmed", async () => {
    const held = await heldStay();

    expect(await runSweep()).toEqual([]);
    expect(queued).toHaveLength(0);
    expect(await remindedAt(held.id)).toBeNull();
  });

  it("neither writes to nor marks a stay with nobody to write to", async () => {
    const walkIn = await confirmedStay({ contact: null });

    expect(await runSweep()).toEqual([]);
    expect(queued).toHaveLength(0);
    // The mark says a reminder went out. Set here it would be a lie the next
    // deploy could not tell apart from a message that was actually sent.
    expect(await remindedAt(walkIn.id)).toBeNull();
  });

  it("leaves a stay it has already reminded", async () => {
    const stay = await confirmedStay({ contact: CONTACT });

    expect(await runSweep()).toEqual([stay.id]);
    // The next tick, an hour later, over the same arrivals. The mark is the whole
    // of what makes this empty.
    expect(await runSweep()).toEqual([]);
    expect(queued).toHaveLength(1);
  });
});

describe("the sweep as the runner requires it", () => {
  it("changes nothing on a second pass over the same transaction", async () => {
    const stay = await confirmedStay({ contact: CONTACT });

    // Exactly what `JobRunner` does before it commits: run, and if anything was
    // touched, run again and require nothing. A sweep failing this is rolled back
    // whole rather than discovered later by a guest who was mailed twice.
    const [first, second] = await transactions.run(async (exec) => [
      await sweep.run(exec, BUSINESS_DATE),
      await sweep.run(exec, BUSINESS_DATE),
    ]);

    expect(first).toEqual([stay.id]);
    expect(second).toEqual([]);
    expect(queued).toHaveLength(1);
  });

  it("sends nothing and marks nothing when the run rolls back", async () => {
    const stay = await confirmedStay({ contact: CONTACT });

    await expect(
      transactions.run(async (exec) => {
        await sweep.run(exec, BUSINESS_DATE);

        // What a rejected run looks like from in here: the runner's own
        // idempotency refusal, a deadlock, a sweep that threw.
        throw new Error("the run did not settle");
      }),
    ).rejects.toThrow("the run did not settle");

    expect(
      queued,
      "The marks went back with the transaction, so a message sent here is a " +
        "guest who will be mailed again on the next tick.",
    ).toHaveLength(0);
    expect(await remindedAt(stay.id)).toBeNull();
  });

  it("is registered on the scheduler, under a cron it can be found by", async () => {
    // The one case that boots the container. `jobs.module.ts` keeps the registry
    // as a list somebody has to edit, which buys a readable file at the cost of a
    // sweep that can exist and never run — so the registry is asserted.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, JobsModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const registered = app.get(JobRunner).find("pre-arrival-reminder");

      expect(registered).toBeInstanceOf(PreArrivalReminderSweep);
      // Five fields, and one that fires more than once a day: the rollover hour
      // is configuration, so a sweep pinned to a single hour would remind
      // nobody for a day the morning after somebody changed it.
      expect(registered?.schedule).toMatch(/^\S+ \* \* \* \*$/);
    } finally {
      await app.close();
    }
  });
});

/** A confirmed stay arriving tomorrow unless another arrival is named. */
async function confirmedStay(options: {
  contact: { email: string; name: string } | null;
  checkIn?: string;
}): Promise<{ id: string; reference: string }> {
  const made = await transactions.run((exec) =>
    deskAt(BOOKED_ON).createConfirmed(exec, {
      ...stay(options.checkIn ?? TOMORROW),
      contact: options.contact,
    }),
  );

  return { id: made.id, reference: made.reference };
}

/** A stay arriving tomorrow that nobody has confirmed. */
async function heldStay(): Promise<{ id: string; reference: string }> {
  const made = await transactions.run((exec) =>
    deskAt(BOOKED_ON).createHold(exec, {
      ...stay(TOMORROW),
      contact: CONTACT,
    }),
  );

  return { id: made.id, reference: made.reference };
}

/** The sweep, through the boundary the runner opens around it. */
async function runSweep(
  businessDate: StayDate = BUSINESS_DATE,
): Promise<readonly string[]> {
  return await transactions.run((exec) => sweep.run(exec, businessDate));
}

/** When the property recorded that it had reminded this stay, if it has. */
async function remindedAt(bookingId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: booking.preArrivalReminderSentAt })
    .from(booking)
    .where(eq(booking.id, bookingId));

  if (!row) throw new Error(`no booking ${bookingId}`);

  return row.at;
}

/** The request shape every case books with. */
function stay(checkIn: string): CreateBookingInput {
  return {
    roomType: "SUPERIOR",
    checkIn: parseDate(checkIn),
    checkOut: parseDate(DEPARTURE),
    plan: "STANDARD",
    party: { adults: 2, children: [] },
  };
}
