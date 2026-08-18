// The message a guest gets when a stay they were told was confirmed is called
// off — `FR-NTF-01`'s cancellation mail.
//
// What is asserted is the four things that make it worth sending rather than the
// fact that something was sent:
//
// 1. **The figure in the mail is the figure the property will charge.** The
//    penalty comes from `cancellation-calculator.ts` — §4's grid, the one the
//    folio prices the charge from — and it is asserted against the stay's own
//    stored night prices rather than against a constant, so a mail that quietly
//    started rounding, or reading the plan wrongly, cannot pass.
// 2. **A waived cancellation refunds the whole of what the account paid.** The
//    waiver is a manager's decision recorded on the booking, and §4's table has no
//    cell for it; the guest is owed the money and the mail is where they are told.
// 3. **A stay with nobody to write to sends nothing.** `contact_email` and
//    `contact_name` are null together on every stay the desk took at a counter.
// 4. **A hold is not a cancellation the guest was ever told about.** The sweep
//    cancels expired holds every minute and the funnel releases the room a guest
//    moved off; announcing either would mail somebody about a booking they do not
//    believe they made.
//
// Both routes are here — the desk's `cancel` and the guest's own `cancelOwn` —
// because they are one method and must stay one: two senders would eventually
// quote two figures for one cancellation.
//
// Every case runs through `TransactionRunner`, which is what the controllers use.
// The message is handed over after that commit, so a case opening its own
// transaction would be asserting on a moment the running system does not send at.
// The mail service is the real one over a queue that records rather than
// delivers, so what is read back is the body a guest would receive.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import { formatVnd, type StayDate, type VndAmount } from "@mariva/shared";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PinoLogger } from "nestjs-pino";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env.js";
import type { Database } from "../src/database/database.module.js";
import { booking, bookingNight } from "../src/database/schema/booking.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { roomCondition } from "../src/database/schema/housekeeping.js";
import { typeInventory } from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import type { FolioPort } from "../src/modules/booking/ports/folio.port.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { BookingCancellationService } from "../src/modules/notification/booking-cancellation.service.js";
import type { MailQueue } from "../src/modules/notification/mail-queue.service.js";
import type { OutgoingEmail } from "../src/modules/notification/mailer.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";
import { noConfirmations, noStayLinks } from "./no-announcement.js";
import { tiersAt } from "./tiers.js";

const SEED_FROM = parseDate("2027-06-01");

/** The property's day for every case: the day the stays are taken and cancelled
 *  on. Well inside §4's free window for the arrival below, which is why the
 *  charged case is a `NONREF` stay rather than a late one — a wall clock in the
 *  present cannot be moved to 2027 to miss a deadline. */
const BUSINESS_DATE = SEED_FROM;

const ARRIVAL = "2027-06-20";
const DEPARTURE = "2027-06-23";

const CONTACT = { email: "khach@example.test", name: "Trần Minh" } as const;

const HOLD_TTL_MINUTES = 20;

/** The property's day, stopped — the device every sweep suite here uses. */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

/**
 * The ledger, as the cancellation mail reads it.
 *
 * A stub at the port `booking` declares rather than the real folio, because what
 * is under test is what the mail says about a balance and not how the balance is
 * summed — `folio-refunds.e2e-spec.ts` owns the second question. Signed the way
 * `ports/folio.port.ts` states: negative is the property holding money that is
 * not its own.
 */
class FolioHolding implements FolioPort {
  constructor(private readonly balance: VndAmount) {}

  async getBalance(): Promise<VndAmount> {
    return this.balance;
  }
}

const silentLogger = { error: vi.fn() } as unknown as PinoLogger;

let pool: pg.Pool;
let db: Database;
let transactions: TransactionRunner;

/** Every message the cancellation service handed over, oldest first. */
let queued: OutgoingEmail[];

/**
 * The desk, over a ledger holding `balance` and a queue that records.
 *
 * The cancellation service is the real one: the claim is about the body a guest
 * receives, so the template has to run.
 */
function deskOver(balance: VndAmount): BookingService {
  const inventory = new InventoryService();
  const clock = new StoppedClock(BUSINESS_DATE);

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
    new FolioHolding(balance),
    { BOOKING_HOLD_TTL_MINUTES: HOLD_TTL_MINUTES } as Env,
    // Unreached: `createConfirmed` announces nothing, and no case here confirms
    // a hold.
    noStayLinks,
    noConfirmations,
    tiersAt(clock),
    new BookingCancellationService(
      {
        enqueue: async (email: OutgoingEmail) => {
          queued.push(email);
        },
      } as MailQueue,
      silentLogger,
    ),
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
});

beforeEach(async () => {
  queued = [];

  await db.execute(
    sql`truncate registration, room_assignment, booking, guest, staff_session, staff_user restart identity cascade`,
  );
  await db.update(typeInventory).set({ soldRooms: 0 });
  await db.delete(roomCondition);
});

afterAll(async () => {
  await pool?.end();
});

describe("the cancellation the desk sends", () => {
  it("quotes the penalty §4 actually charged, from the stay's own night prices", async () => {
    // `NONREF` is 100% of the stay on any cancellation, which is the one cell of
    // the grid a wall clock cannot move: a stay arriving in 2027 is inside the
    // free window for every other plan, whenever this suite is run.
    const stay = await confirmedStay({ plan: "NONREF" });
    const nights = await nightPricesOf(stay.id);
    const penalty = nights.reduce<VndAmount>((total, night) => total + night, 0n);

    await cancel(stay.id, { balance: -penalty });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.to).toBe(CONTACT.email);
    expect(queued[0]!.subject).toContain(stay.reference);
    // The figure, formatted as the property quotes prices. Read from the stored
    // nights rather than written down here, so a plan or a calendar change moves
    // both sides of the assertion together.
    expect(queued[0]!.text).toContain(formatVnd(penalty));
    // Nothing to refund: the penalty stands against the whole of what was paid.
    expect(queued[0]!.text).not.toContain("Refund");
  });

  it("says there is no charge for a cancellation inside the free window", async () => {
    const stay = await confirmedStay({ plan: "STANDARD" });

    await cancel(stay.id, { balance: 0n });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.text).toContain("no cancellation charge");
  });

  it("refunds what the account is over-paid by once the penalty stands", async () => {
    const stay = await confirmedStay({ plan: "NONREF" });
    const nights = await nightPricesOf(stay.id);
    const penalty = nights.reduce<VndAmount>((total, night) => total + night, 0n);

    // The guest paid the stay and a little more — a deposit against extras is
    // enough to make the arithmetic visible.
    const paid = penalty + 500_000n;

    await cancel(stay.id, { balance: -paid });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.text).toContain(formatVnd(penalty));
    expect(queued[0]!.text).toContain(formatVnd(500_000n));
  });

  it("refunds the whole of what was paid when a manager waived the penalty", async () => {
    const stay = await confirmedStay({ plan: "NONREF" });
    const nights = await nightPricesOf(stay.id);
    const paid = nights.reduce<VndAmount>((total, night) => total + night, 0n);

    await cancel(stay.id, { balance: -paid, waivedBy: await aManager() });

    expect(queued).toHaveLength(1);
    // §4's table has no waiver cell, so a waived stay never reaches the grid and
    // is priced at nothing — which in money is the whole of what it paid coming
    // back. A mail that still quoted the `NONREF` penalty would be telling a
    // guest the property kept money a manager gave up.
    expect(queued[0]!.text).toContain("no cancellation charge");
    expect(queued[0]!.text).toContain(formatVnd(paid));
  });

  it("says nothing at all for a stay nobody named a contact on", async () => {
    const walkIn = await confirmedStay({ plan: "NONREF", contact: null });

    await cancel(walkIn.id, { balance: -1_000_000n });

    expect(
      queued,
      "A stay with no contact address is a walk-in the desk took. There is " +
        "nowhere to send a cancellation, and inventing a recipient is worse " +
        "than sending nothing.",
    ).toHaveLength(0);
  });

  it("says nothing a second time, because only the first cancellation transitions", async () => {
    const stay = await confirmedStay({ plan: "NONREF" });

    await cancel(stay.id, { balance: -1_000_000n });
    await cancel(stay.id, { balance: -1_000_000n, reason: "STAFF_ERROR" });

    // §4's idempotency guard returns before the update, so a retried request and
    // a double-clicked button are one cancellation and one message.
    expect(queued).toHaveLength(1);
  });

  it("says nothing when the transaction that cancelled the stay rolls back", async () => {
    const stay = await confirmedStay({ plan: "NONREF" });

    await expect(
      transactions.run(async (exec) => {
        await deskOver(-1_000_000n).cancel(exec, {
          bookingId: stay.id,
          reason: "GUEST_REQUEST",
          waivedBy: null,
        });

        throw new Error("the folio would not take the posting");
      }),
    ).rejects.toThrow("the folio would not take the posting");

    expect(
      queued,
      "The stay is still confirmed and its nights are still sold. A guest who " +
        "receives this has been told a booking they still hold is cancelled.",
    ).toHaveLength(0);

    const [row] = await db
      .select({ state: booking.state })
      .from(booking)
      .where(eq(booking.id, stay.id));

    expect(row!.state).toBe("CONFIRMED");
  });
});

describe("the cancellation a guest's own route sends", () => {
  it("writes to the guest who cancelled their own stay", async () => {
    const stay = await confirmedStay({ plan: "NONREF" });

    await transactions.run((exec) =>
      deskOver(-2_000_000n).cancelOwn(exec, {
        reference: stay.reference,
        // The credential a guest who booked without an account holds: one stay,
        // proved. `booking.controller.ts` builds this from what the guard
        // resolved and never from a body.
        owner: { kind: "proven", bookingId: stay.id },
      }),
    );

    // The guest's route is the desk's method with `waivedBy` null, so the mail
    // is the same mail and says the same figure — which is the whole reason there
    // is one sender and not two.
    expect(queued).toHaveLength(1);
    expect(queued[0]!.to).toBe(CONTACT.email);
    expect(queued[0]!.subject).toContain(stay.reference);
    expect(queued[0]!.text).toContain("you asked us");
  });
});

describe("a hold the guest was never told about", () => {
  it("sends nothing when the hold's own clock ran out", async () => {
    const held = await heldStay();

    await cancel(held.id, { balance: 0n, reason: "HOLD_EXPIRED" });

    expect(
      queued,
      "An expired hold was never confirmed and never paid for. The sweep runs " +
        "every minute; mailing about it would be the property writing to " +
        "everybody who abandoned the funnel.",
    ).toHaveLength(0);
  });

  it("sends nothing when the guest moved to another room type", async () => {
    const held = await heldStay();

    await cancel(held.id, { balance: 0n, reason: "HOLD_REPLACED" });

    // The guest cancelled nothing — they changed rooms, and the funnel releases
    // the room they moved off in the same transaction it takes the new one.
    expect(queued).toHaveLength(0);
  });
});

/** A confirmed stay, with somebody to write to unless told otherwise. */
async function confirmedStay(options: {
  plan: CreateBookingInput["plan"];
  contact?: { email: string; name: string } | null;
}): Promise<{ id: string; reference: string }> {
  const made = await transactions.run((exec) =>
    deskOver(0n).createConfirmed(exec, {
      ...stay(options.plan),
      contact: options.contact === undefined ? CONTACT : options.contact,
    }),
  );

  return { id: made.id, reference: made.reference };
}

/** A stay still being held, taken through the funnel's own door. */
async function heldStay(): Promise<{ id: string; reference: string }> {
  const made = await transactions.run((exec) =>
    deskOver(0n).createHold(exec, { ...stay("STANDARD"), contact: CONTACT }),
  );

  return { id: made.id, reference: made.reference };
}

/** The cancellation, through the boundary a controller opens around it. */
async function cancel(
  bookingId: string,
  options: {
    balance: VndAmount;
    reason?: Parameters<BookingService["cancel"]>[1]["reason"];
    waivedBy?: string;
  },
): Promise<void> {
  await transactions.run((exec) =>
    deskOver(options.balance).cancel(exec, {
      bookingId,
      reason: options.reason ?? "GUEST_REQUEST",
      waivedBy: options.waivedBy ?? null,
    }),
  );
}

/** The per-night prices §4 scales, in stay order. */
async function nightPricesOf(bookingId: string): Promise<VndAmount[]> {
  const rows = await db
    .select({ gross: bookingNight.standardGross })
    .from(bookingNight)
    .where(eq(bookingNight.bookingId, bookingId))
    .orderBy(asc(bookingNight.stayDate));

  if (rows.length === 0) {
    throw new Error("the stay stored no night prices, so §4 cannot be applied");
  }

  return rows.map((row) => row.gross);
}

/** Somebody with the authority to set §4 aside. */
async function aManager(): Promise<string> {
  const [manager] = await db
    .insert(staffUser)
    .values({
      email: "quan.ly@mariva.test",
      fullName: "Nguyễn Thị Hạnh",
      role: "MANAGER",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  return manager!.id;
}

/** The request shape every case books with. */
function stay(plan: CreateBookingInput["plan"]): CreateBookingInput {
  return {
    roomType: "SUPERIOR",
    checkIn: parseDate(ARRIVAL),
    checkOut: parseDate(DEPARTURE),
    plan,
    party: { adults: 2, children: [] },
  };
}
