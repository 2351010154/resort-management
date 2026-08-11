// The join between a booking and the account that made it — `FR-GST-01`'s
// ownership check — and the ledger `FR-GST-05` accrues into.
//
// The claim under test is not that a service remembers to set a column. It is
// that the two realms are joinable at all, and joinable in the one direction
// ownership needs: a guest asking for "my bookings" gets theirs and nobody
// else's, and a stay the desk took belongs to nobody rather than to whoever asks
// about it. Neither is assertable against a mock, because both are `WHERE`
// clauses and a mock has no rows to leave out.
//
// The other half is what the database refuses. A second accrual for one folio
// would be points the guest did not earn, and — the balance being a sum rather
// than a column — nothing downstream would notice the doubling. So the
// constraint is tried rather than described.
//
// No Nest application is booted, for `booking-lifecycle.e2e-spec.ts`'s reason:
// the subject is the service and the rows underneath it.
//
// Every stay below arrives on a Monday inside the seeded calendar. The seed
// writes minimum stays and closed arrivals on weekend nights only, and the funnel
// obeys them — a Friday arrival here would make a refusal mean the restriction
// rather than the account.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { RoomTypeCode, StayDate } from "@mariva/shared";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/config/env.js";
import { booking } from "../src/database/schema/booking.js";
import { folio } from "../src/database/schema/folio.js";
import { guestUser } from "../src/database/schema/index.js";
import * as schema from "../src/database/schema/index.js";
import { loyaltyLedger } from "../src/database/schema/loyalty.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { AssignmentService } from "../src/modules/booking/assignment.service.js";
import {
  type Booking,
  BookingService,
  type CreateBookingInput,
} from "../src/modules/booking/booking.service.js";
import { BusinessDateService } from "../src/modules/booking/business-date.service.js";
import { FolioStubService } from "../src/modules/booking/ports/folio-stub.service.js";
import { StayQuoteService } from "../src/modules/booking/stay-quote.service.js";
import { GuestService } from "../src/modules/guest/guest.service.js";
import { HousekeepingService } from "../src/modules/housekeeping/housekeeping.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { SystemConfigService } from "../src/modules/system-config/system-config.service.js";

const SEED_FROM = parseDate("2027-06-01");

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Better Auth's own shape for an id: 32 base-62 characters, not a UUID.
 *
 * `schema/booking.ts` takes `text` for exactly this, and a fixture that used a
 * UUID here would pass against a column that could not hold a real account id.
 */
const ANH_ID = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";
const BINH_ID = "7Qw9Lm2Xk4pR8tV1sN6cB3dF5hJ0zY2a";
/** An account that was never created. The keys are what refuse it. */
const NO_SUCH_ACCOUNT = "nobodyNobodyNobodyNobodyNobody12";

/** The property's day, stopped — `booking-lifecycle.e2e-spec.ts` argues why. */
class StoppedClock extends BusinessDateService {
  constructor(private readonly today: StayDate) {
    super(new SystemConfigService());
  }

  override async current(): Promise<StayDate> {
    return this.today;
  }
}

function deskAt(today: StayDate): BookingService {
  const inventory = new InventoryService();

  return new BookingService(
    inventory,
    new StayQuoteService(),
    new StoppedClock(today),
    new AssignmentService(
      inventory,
      new StoppedClock(today),
      new StayQuoteService(),
      new HousekeepingService(),
    ),
    new GuestService(),
    new HousekeepingService(),
    new FolioStubService(),
    { BOOKING_HOLD_TTL_MINUTES: 15 } as Env,
  );
}

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bookings: BookingService;

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Before the seed rather than only after this file, because `seed.ts`'s wipe
  // deletes bookings and cannot get past a folio that still names one — its own
  // comment says so. A previous run that ended badly would otherwise fail here
  // with a foreign key rather than with anything about this suite.
  await emptyWhatThisFileWrites();

  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  // After the seed, which wipes what it owns. Two accounts, because half of what
  // ownership means is the rows the other one cannot see.
  await db.insert(guestUser).values([
    { id: ANH_ID, name: "Anh Nguyễn", email: "anh@example.test" },
    { id: BINH_ID, name: "Bình Trần", email: "binh@example.test" },
  ]);

  bookings = deskAt(SEED_FROM);
});

afterAll(async () => {
  // The next file to run seeds, and its wipe cannot delete a booking a folio
  // names or an account a booking names. Neither is this seed's to own, so this
  // file clears them itself.
  await emptyWhatThisFileWrites();
  await pool?.end();
});

describe("a stay the front desk takes", () => {
  it("is stored with no account and is still a booking", async () => {
    // The ordinary case at a forty-room property, and the one the nullable
    // column exists for: nobody signed in, nobody to sign in as, and a stay
    // reachable by its reference alone.
    const walkIn = await createConfirmed(stay("2028-01-10", "2028-01-12"));

    expect(walkIn.state).toBe("CONFIRMED");
    expect(walkIn.userId).toBeNull();

    const [stored] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, walkIn.id));

    expect(stored?.userId).toBeNull();
  });

  it("belongs to nobody, so no account can claim it", async () => {
    // SQL's equality never matches a null, which is what makes the ownership
    // check safe on the rows that have no owner. A guest guessing at ids finds
    // none of the property's own stays this way.
    const walkIn = await createConfirmed(stay("2028-01-17", "2028-01-19"));

    expect(await isOwner(walkIn.id, ANH_ID)).toBe(false);
  });
});

describe("a stay a signed-in guest takes", () => {
  it("carries the account through to the row and back", async () => {
    const held = await createHold({
      ...stay("2028-02-07", "2028-02-09"),
      userId: ANH_ID,
    });

    expect(held.state).toBe("HELD");
    expect(held.userId).toBe(ANH_ID);

    const [stored] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, held.id));

    expect(stored?.userId).toBe(ANH_ID);
  });

  it("answers the ownership check for its account and for no other", async () => {
    const held = await createHold({
      ...stay("2028-02-14", "2028-02-16"),
      userId: ANH_ID,
    });

    expect(await isOwner(held.id, ANH_ID)).toBe(true);
    expect(await isOwner(held.id, BINH_ID)).toBe(false);
  });

  it("tells a guest naming an id nobody holds the same thing", async () => {
    // False rather than a distinguishable failure. A reply that separated "not
    // yours" from "no such booking" would be a way to discover which ids are
    // real.
    expect(await isOwner("11111111-1111-4111-8111-111111111111", ANH_ID)).toBe(
      false,
    );
  });

  it("is refused an account the guest realm does not have", async () => {
    // The key, doing what a service check could only ask for politely: a stay
    // filed under an account nobody can sign in to is a booking no guest could
    // ever be shown.
    const refusal = await refused(
      createConfirmed({
        ...stay("2028-02-21", "2028-02-23"),
        userId: NO_SUCH_ACCOUNT,
      }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("the bookings one account may read", () => {
  it("returns that guest's stays, newest arrival first, and nobody else's", async () => {
    const anhsFirst = await createHold({
      ...stay("2028-03-06", "2028-03-08"),
      userId: ANH_ID,
    });
    const anhsSecond = await createHold({
      ...stay("2028-03-13", "2028-03-15"),
      userId: ANH_ID,
    });
    const binhs = await createHold({
      ...stay("2028-03-20", "2028-03-22"),
      userId: BINH_ID,
    });
    const walkIn = await createConfirmed(stay("2028-03-27", "2028-03-29"));

    const own = await db.transaction((exec) =>
      bookings.getOwnBookings(exec, ANH_ID),
    );
    const ids = own.map((one) => one.id);

    expect(ids).toContain(anhsFirst.id);
    // Newest arrival first, which is the order a guest reads their own bookings
    // in — the stay they are about to take before the ones they have taken.
    expect(ids.indexOf(anhsSecond.id)).toBeLessThan(ids.indexOf(anhsFirst.id));
    expect(ids).not.toContain(binhs.id);
    expect(ids).not.toContain(walkIn.id);
    expect(own.every((one) => one.userId === ANH_ID)).toBe(true);
  });

  it("is empty for an account that has booked nothing", async () => {
    const none = await db.transaction((exec) =>
      bookings.getOwnBookings(exec, BINH_ID.replace("7", "8")),
    );

    expect(none).toEqual([]);
  });
});

describe("the loyalty ledger", () => {
  it("accrues once per closed folio and refuses the second attempt", async () => {
    // `FR-GST-05`'s idempotency, tried rather than described. A retried close, a
    // re-run job and a support script all arrive as this second insert.
    const folioId = await aFolio();

    await db.insert(loyaltyLedger).values(anAccrual(folioId));

    const refusal = await refused(
      db.insert(loyaltyLedger).values(anAccrual(folioId)),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
  });

  it("takes a second accrual for a second stay", async () => {
    // The other half of the key: it is the folio that is unique, so a guest who
    // stays twice earns twice. Without this the refusal above would also be
    // satisfied by a table that accepted one row per guest for all time.
    await db.insert(loyaltyLedger).values(anAccrual(await aFolio()));
    await db.insert(loyaltyLedger).values(anAccrual(await aFolio()));

    const rows = await db
      .select({ points: loyaltyLedger.pointsEarned })
      .from(loyaltyLedger)
      .where(eq(loyaltyLedger.userId, ANH_ID));

    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("stores an honest nothing for a stay below one earn unit", async () => {
    const [written] = await db
      .insert(loyaltyLedger)
      .values(anAccrual(await aFolio(), { pointsEarned: 0n }))
      .returning({ points: loyaltyLedger.pointsEarned });

    expect(written?.points).toBe(0n);
  });

  it("refuses a negative row, because there is no way to spend a point", async () => {
    const refusal = await refused(
      db
        .insert(loyaltyLedger)
        .values(anAccrual(await aFolio(), { pointsEarned: -1n })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
  });

  it("refuses an accrual to an account the guest realm does not have", async () => {
    const refusal = await refused(
      db
        .insert(loyaltyLedger)
        .values(anAccrual(await aFolio(), { userId: NO_SUCH_ACCOUNT })),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

/**
 * Mondays inside the seeded calendar, one per folio this file opens.
 *
 * Named dates rather than arithmetic on an ordinal, so a stay that falls on a
 * restricted weekend night is visible here rather than in a refusal nobody
 * expected.
 */
const FOLIO_ARRIVALS = [
  "2028-04-03",
  "2028-04-10",
  "2028-04-17",
  "2028-04-24",
  "2028-05-01",
  "2028-05-08",
  "2028-05-15",
  "2028-05-22",
];

let folioOrdinal = 0;

/** A stay with an account opened against it, so there is something to accrue to. */
async function aFolio(): Promise<string> {
  const arrival = FOLIO_ARRIVALS[folioOrdinal];

  if (!arrival) {
    throw new Error(
      "this file has opened more folios than it has arrival dates for",
    );
  }

  folioOrdinal += 1;

  const stayed = await createConfirmed(
    stay(arrival, parseDate(arrival).add({ days: 2 }).toString()),
  );

  const [opened] = await db
    .insert(folio)
    .values({ bookingId: stayed.id })
    .returning({ id: folio.id });

  return opened!.id;
}

function anAccrual(
  folioId: string,
  overrides: Partial<typeof loyaltyLedger.$inferInsert> = {},
): typeof loyaltyLedger.$inferInsert {
  return {
    userId: ANH_ID,
    folioId,
    // A figure the fixture states rather than computes: what a stay earns is
    // §7's rate against net room revenue, and the path that reads it is a later
    // task. What this file is about is the row, not the arithmetic behind it.
    pointsEarned: 540n,
    // §7 expires points earned in year `Y` on 31 December of `Y+1`.
    expiresAt: "2029-12-31",
    ...overrides,
  };
}

async function isOwner(bookingId: string, userId: string): Promise<boolean> {
  return await db.transaction((exec) =>
    bookings.isOwner(exec, bookingId, userId),
  );
}

async function createConfirmed(input: CreateBookingInput): Promise<Booking> {
  return await db.transaction((exec) => bookings.createConfirmed(exec, input));
}

async function createHold(input: CreateBookingInput): Promise<Booking> {
  return await db.transaction((exec) => bookings.createHold(exec, input));
}

/** One Deluxe, mid-week, for a party the type sleeps. */
function stay(checkIn: string, checkOut: string): CreateBookingInput {
  const roomType: RoomTypeCode = "DELUXE";

  return {
    roomType,
    checkIn: parseDate(checkIn),
    checkOut: parseDate(checkOut),
    plan: "STANDARD",
    party: { adults: 2, children: [] },
  };
}

/**
 * The rows this file leaves behind, and only those.
 *
 * `truncate … cascade` rather than a delete, because `folio_posting` refuses a
 * `DELETE` outright — the append-only trigger raises on it for every client.
 * The cascade reaches `loyalty_ledger` through the folio it keys to and the
 * bookings through the accounts they name, which is exactly the set this file
 * wrote.
 */
async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate loyalty_ledger, folio_posting, folio, booking, guest_user restart identity cascade`,
  );
}

interface Refusal {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
}

/**
 * Runs a write that must fail and returns the refusal.
 *
 * A write that succeeds fails the test here rather than at a later assertion
 * reading an absent error, so "the database accepted it" is what the report says
 * instead of "cannot read properties of undefined".
 */
async function refused(write: Promise<unknown>): Promise<Refusal> {
  try {
    await write;
  } catch (error) {
    return refusalOf(error);
  }

  throw new Error("the database stored a row it should have refused");
}

/**
 * The SQLSTATE code and constraint name out of a thrown error.
 *
 * Drizzle wraps a driver error in one of its own, so the fields that matter sit
 * on a cause one or more levels down. The chain is walked rather than assumed to
 * be one deep — `booking-storage.e2e-spec.ts` reads its refusals the same way.
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
        constraint: typeof constraint === "string" ? constraint : undefined,
      };
    }
  }

  throw error;
}
