// What revocation costs the read path, and what it must not cost an account.
//
// Three claims, and each needs a real Postgres because each is about a `where`
// clause rather than about a decision a service makes.
//
// 1. **A stay whose anonymous access has been given up is unreachable by the
//    credential that used to open it**, and unreachable in the same way a stay
//    that does not exist is — the id space stays unwalkable.
// 2. **An account is unaffected.** Revocation kills the loose copy of an
//    anonymous credential and says nothing about who owns the booking, so the
//    guest who has just attached the stay reads it through their session exactly
//    as before. This is the half that would be quietly lost by writing the
//    predicate one conjunction too high.
// 3. **It costs nothing.** The predicate rides the ownership query that was
//    already going to fetch the row, so the read path issues one statement and
//    issued one before. `access.guard.ts` still takes no round trip to admit a
//    booking cookie, which is the property the whole design is arranged around —
//    the count below is what would notice if a later change moved the check into
//    a read of its own.
//
// The executor handed to the service is the real Drizzle client behind a proxy
// that counts the statements started through it. It is not a stand-in: every
// query runs, every row is real, and the only thing added is the tally.
//
// The service's other collaborators are handed nothing at all, for the reason
// `payment.service.spec.ts` gives about its folio: nothing in these three
// methods reaches inventory, a rate quote or a folio, and passing a stand-in
// would be imitating a ledger this file is not entitled to imitate. A case that
// wandered into one fails loudly instead of quietly agreeing with a fake.
//
// ## The hold a payment attempt extends
//
// One more `where` clause, proved here for the same reason as the three above:
// what `extendHoldForPayment` does is decided by the statement rather than by a
// branch, and the half that matters most cannot be seen from a service at all.
// `booking_hold_expiry_exactly_when_held` refuses an expiry on any row that is
// not `HELD`, and this write happens inside the transaction that opens a payment
// attempt — so a stay that is no longer held has to come back as nothing
// written, not as a constraint violation taking the attempt with it. That is a
// claim about Postgres' answer, and only Postgres can give it.
//
// The other two are the direction it may move a deadline in: out far enough to
// cover a gateway round trip, and never in. `greatest` is what decides both, and
// a test that read back a date this file had computed would agree with itself.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database, DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { guestUser } from "../../database/schema/index.js";
import * as schema from "../../database/schema/index.js";
import { roomType } from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";
import type { AssignmentService } from "./assignment.service.js";
import { BookingService } from "./booking.service.js";
import type { BusinessDateService } from "./business-date.service.js";
import type { GuestService } from "../guest/guest.service.js";
import type { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { TierDerivationService } from "../guest/tier-derivation.service.js";
import type { FolioPort } from "./ports/folio.port.js";
import type { StayQuoteService } from "./stay-quote.service.js";
import type { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import type { BookingConfirmationService } from "../notification/booking-confirmation.service.js";

const CHECK_VIOLATION = "23514";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

/** The account the stay is attached to before its cookie is given up — the
 *  order the schema insists on, because revocation with nobody to sign in as
 *  would be a lock-out. */
const AN_ACCOUNT = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";

/** How long an attempt buys a hold, in this suite. Not the shipped default. */
const WINDOW_MINUTES = 20;

const MS_PER_MINUTE = 60_000;

/**
 * How far a deadline written by Postgres may sit from one computed here.
 *
 * The extension is `now()` on the database's clock and every assertion below
 * measures from this process's, so the two are a round trip and whatever the two
 * machines disagree about apart. A minute is far wider than either and far
 * narrower than the figure under test.
 */
const CLOCK_SLACK_MS = MS_PER_MINUTE;

let pool: pg.Pool;
let db: Database;
let bookings: BookingService;

let roomTypeId: string;
let bookingId: string;
let reference: string;

let referenceOrdinal = 0;

/**
 * The methods that start a statement. Counted at the point they are called, so
 * one entry is one round trip and a chained `.where()` or `.limit()` is not
 * mistaken for a second.
 */
const STARTS_A_STATEMENT = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "execute",
]);

let started = 0;

/** The real client, tallied. Bound to the client rather than to the proxy so
 *  Drizzle's own internals are untouched by the counting. */
const counting = (client: Database): DbExecutor =>
  new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);

      if (typeof value !== "function") {
        return value;
      }

      const method = value as (...args: unknown[]) => unknown;

      if (!STARTS_A_STATEMENT.has(String(property))) {
        return method.bind(target);
      }

      return (...args: unknown[]) => {
        started += 1;

        return method.apply(target, args);
      };
    },
  }) as Database;

async function aBooking(
  overrides: Partial<typeof booking.$inferInsert> = {},
): Promise<{ id: string; reference: string }> {
  referenceOrdinal += 1;

  const [row] = await db
    .insert(booking)
    .values({
      reference: `MRV-20270510-${String(referenceOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
      ...overrides,
    })
    .returning({ id: booking.id, reference: booking.reference });

  return row!;
}

/**
 * A stay the funnel is still holding, with that many minutes left on it.
 *
 * Written straight into the row rather than taken through `createHold`, for the
 * reason the header gives about this file's collaborators: a hold taken through
 * the funnel would consume inventory that nothing here gives back, and what the
 * cases below are about is one column and the constraint over it.
 */
async function aHold({
  minutesLeft,
}: {
  minutesLeft: number;
}): Promise<{ id: string; reference: string }> {
  return await aBooking({
    state: "HELD",
    holdExpiresAt: new Date(Date.now() + minutesLeft * MS_PER_MINUTE),
  });
}

/** When a stay stops being held, straight off the row. */
async function expiryOf(id: string): Promise<Date | null> {
  const [row] = await db
    .select({ expiresAt: booking.holdExpiresAt })
    .from(booking)
    .where(eq(booking.id, id));

  return row?.expiresAt ?? null;
}

/** How much of a hold is left, from now, in minutes. */
async function minutesLeftOn(id: string): Promise<number> {
  const expiresAt = await expiryOf(id);

  if (!expiresAt) {
    throw new Error("that stay is not holding anything");
  }

  return (expiresAt.getTime() - Date.now()) / MS_PER_MINUTE;
}

/** The refusal a caller sees, or a failure if the call succeeded. */
async function refused(work: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("that call was expected to be refused and was not");
}

async function revokedAtOf(id: string): Promise<Date | null> {
  const [row] = await db
    .select({ revokedAt: booking.anonAccessRevokedAt })
    .from(booking)
    .where(eq(booking.id, id));

  return row?.revokedAt ?? null;
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  bookings = new BookingService(
    undefined as unknown as InventoryService,
    undefined as unknown as StayQuoteService,
    undefined as unknown as BusinessDateService,
    undefined as unknown as AssignmentService,
    undefined as unknown as GuestService,
    undefined as unknown as HousekeepingService,
    undefined as unknown as FolioPort,
    // The one figure any method here reads: how long an attempt buys the hold it
    // is opened against. Deliberately not the shipped fifteen, so a case that
    // passed against a default rather than against the value it was handed would
    // fail.
    { BOOKING_PAYMENT_WINDOW_MINUTES: WINDOW_MINUTES } as Env,
    // Neither is reached here: the confirmation email is minted and queued only
    // by the transition a paid hold makes, which nothing in this file drives.
    undefined as unknown as BookingTokenService,
    undefined as unknown as BookingConfirmationService,
    // Unreached: no case here sells a stay, so no tier is derived.
    undefined as unknown as TierDerivationService,
  );

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type, guest_session, guest_account, guest_user restart identity cascade`,
  );

  const [deluxe] = await db
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

  roomTypeId = deluxe!.id;

  await db.insert(guestUser).values({
    id: AN_ACCOUNT,
    name: "Trần Minh Anh",
    email: "minh.anh@mariva.test",
    emailVerified: true,
  });
});

beforeEach(async () => {
  const made = await aBooking({ userId: AN_ACCOUNT });

  bookingId = made.id;
  reference = made.reference;
  started = 0;
});

afterAll(async () => {
  await pool?.end();
});

describe("a stay whose anonymous access has been given up", () => {
  it("was reachable by the credential naming it, and then is not", async () => {
    const owner = { kind: "proven", bookingId } as const;

    expect((await bookings.ownBooking(db, { reference, owner })).id).toBe(
      bookingId,
    );

    await bookings.revokeAnonymousAccess(db, bookingId);

    const refusal = await refused(bookings.ownBooking(db, { reference, owner }));

    // The same `NOT_FOUND` a stranger's reference gets. A revoked stay that
    // answered differently would tell whoever holds the stale cookie that the
    // booking is real and that something changed about it.
    expect(refusal.code).toBe("NOT_FOUND");
  });

  it("is out of reach by its hold id as well as by its reference", async () => {
    // Both own-stay doors go through the one scope clause, which is why there is
    // no route left carrying the old predicate.
    const owner = { kind: "proven", bookingId } as const;

    await bookings.revokeAnonymousAccess(db, bookingId);

    expect((await refused(bookings.ownHold(db, { bookingId, owner }))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("is still the account's stay, read through their session", async () => {
    // The half that matters most. Revocation takes away the loose copy of an
    // anonymous credential; it says nothing about ownership, and a guest who has
    // just attached this booking would otherwise have lost it at the moment they
    // gained it.
    await bookings.revokeAnonymousAccess(db, bookingId);

    const owner = { kind: "account", userId: AN_ACCOUNT } as const;

    expect((await bookings.ownBooking(db, { reference, owner })).id).toBe(
      bookingId,
    );
    expect((await bookings.ownHold(db, { bookingId, owner })).id).toBe(bookingId);
    expect(await bookings.isOwner(db, bookingId, AN_ACCOUNT)).toBe(true);
  });

  it("still appears in that account's stay history", async () => {
    await bookings.revokeAnonymousAccess(db, bookingId);

    const own = await bookings.getOwnBookings(db, AN_ACCOUNT);

    expect(own.map((stay) => stay.id)).toContain(bookingId);
  });
});

describe("revoking anonymous access", () => {
  it("is idempotent, and keeps the instant access was actually given up", async () => {
    // A retried request and a job that ran twice are both the revocation that
    // already happened. Moving the instant would make "when did this stay stop
    // being reachable anonymously?" answer differently every time anybody asked
    // again.
    await bookings.revokeAnonymousAccess(db, bookingId);

    const first = await revokedAtOf(bookingId);

    await bookings.revokeAnonymousAccess(db, bookingId);
    await bookings.revokeAnonymousAccess(db, bookingId);

    expect(await revokedAtOf(bookingId)).toEqual(first);
  });

  it("refuses to strand a stay that has no account behind it", async () => {
    // The database's rule, not a service's. A guest whose cookie was revoked
    // signs in to reach the stay, and one who never chose a password resets it
    // to the address the confirmation went to — with no account there is neither
    // route, and the row is refused rather than the guest locked out of
    // something they paid for.
    const anonymous = await aBooking();

    let refusal: unknown;

    try {
      await bookings.revokeAnonymousAccess(db, anonymous.id);
    } catch (error) {
      refusal = error;
    }

    expect(sqlStateOf(refusal)).toBe(CHECK_VIOLATION);
    expect(await revokedAtOf(anonymous.id)).toBeNull();
  });

  it("leaves a stay nobody named exactly as it was", async () => {
    // Nothing is thrown for an id that names no stay, because the postcondition
    // holds either way: no anonymous credential opens that booking afterwards.
    await bookings.revokeAnonymousAccess(
      db,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(await revokedAtOf(bookingId)).toBeNull();
  });
});

describe("the hold a payment attempt is opened against", () => {
  it("is given the configured window, however little it had left", async () => {
    // The race the whole extension exists for: the guest reached the payment
    // page with a minute of the TTL to spare, and the bank app takes longer than
    // that. Without this write the sweep cancels the stay mid-payment and the
    // money lands on a room that is back on sale.
    const held = await aHold({ minutesLeft: 1 });

    await bookings.extendHoldForPayment(db, held.id);

    expect(await minutesLeftOn(held.id)).toBeGreaterThan(
      WINDOW_MINUTES - CLOCK_SLACK_MS / MS_PER_MINUTE,
    );
    expect(await minutesLeftOn(held.id)).toBeLessThan(
      WINDOW_MINUTES + CLOCK_SLACK_MS / MS_PER_MINUTE,
    );
  });

  it("keeps a longer deadline rather than pulling it in", async () => {
    // `greatest`, and it is the direction that would otherwise be lost. A desk
    // hold with hours on it, or a second attempt opened a minute after the
    // first, must not have pressing pay *shorten* the room they are holding.
    const held = await aHold({ minutesLeft: 120 });
    const before = await expiryOf(held.id);

    await bookings.extendHoldForPayment(db, held.id);

    expect(await expiryOf(held.id)).toEqual(before);
  });

  it("leaves a stay that is no longer being held exactly as it is", async () => {
    // The half only Postgres can answer. `booking_hold_expiry_exactly_when_held`
    // refuses an expiry on any row that is not `HELD`, and this write runs inside
    // the transaction that opens a payment attempt — so a balance collected from
    // a guest already in the building, or a callback landing on a hold the sweep
    // took, has to come back as nothing written rather than as a violation that
    // takes the attempt down with it.
    const confirmed = await aBooking();
    const cancelled = await aBooking({
      state: "CANCELLED",
      cancellationReason: "GUEST_REQUEST",
      cancelledAt: new Date(),
    });

    await bookings.extendHoldForPayment(db, confirmed.id);
    await bookings.extendHoldForPayment(db, cancelled.id);

    expect(await expiryOf(confirmed.id)).toBeNull();
    expect(await expiryOf(cancelled.id)).toBeNull();
  });

  it("leaves a stay nobody named exactly as it was", async () => {
    // No row matches and nothing is thrown, which is the same answer revocation
    // gives above: the postcondition holds either way, since no stay of this
    // property's went into a payment window it did not ask for.
    await bookings.extendHoldForPayment(
      db,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(await expiryOf(bookingId)).toBeNull();
  });
});

describe("what the revocation predicate costs the read path", () => {
  it("reads a stay in one statement, as it did before", async () => {
    const exec = counting(db);

    await bookings.ownBooking(exec, {
      reference,
      owner: { kind: "proven", bookingId },
    });

    expect(started).toBe(1);
  });

  it("refuses a revoked stay in that same one statement", async () => {
    // The whole point of the predicate being a conjunct rather than a lookup of
    // its own: the refusal costs the same round trip the answer did, so
    // `access.guard.ts` never needs one.
    await bookings.revokeAnonymousAccess(db, bookingId);

    const exec = counting(db);

    await refused(
      bookings.ownBooking(exec, {
        reference,
        owner: { kind: "proven", bookingId },
      }),
    );

    expect(started).toBe(1);
  });

  it("costs an account's read nothing at all", async () => {
    const exec = counting(db);

    await bookings.ownHold(exec, {
      bookingId,
      owner: { kind: "account", userId: AN_ACCOUNT },
    });

    expect(started).toBe(1);
  });
});
