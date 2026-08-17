// Giving a stay an owner, and the order the two writes go in.
//
// **The order is the claim.** `booking_revokes_anonymous_access_only_with_an
// _account` refuses a row whose anonymous access is given up and whose
// `user_id` is null, so writing the revocation first raises `23514` and rolls
// the transaction back. That is the safe failure, and it is still a failure: the
// guest's attach would 500. This file proves the constraint is live — by
// provoking it directly — and then proves that attach commits, which together
// say the writes happened the right way round. There is no third way to make a
// transaction that ends in a committed, revoked, owned row.
//
// **One transaction, so neither half can survive alone.** A rollback after the
// attach must leave the stay ownerless *and* still reachable by its cookie; a
// stay that kept the revocation and lost the owner is precisely the row the
// constraint refuses.
//
// **Never reassigned.** A booking has one owner. Moving it would take a stay out
// of somebody's history, so a different account is refused and nothing is
// written.
//
// A real Postgres, because every claim here is about a constraint or a `where`.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../config/env.js";
import type { Database } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { guestUser } from "../../database/schema/index.js";
import * as schema from "../../database/schema/index.js";
import { roomType } from "../../database/schema/inventory.js";
import { sqlStateOf } from "../../database/sql-state.js";
import type { BookingTokenService } from "../auth/booking-token/booking-token.service.js";
import type { BookingConfirmationService } from "../notification/booking-confirmation.service.js";
import type { AssignmentService } from "./assignment.service.js";
import { BookingService } from "./booking.service.js";
import type { BusinessDateService } from "./business-date.service.js";
import type { GuestService } from "../guest/guest.service.js";
import type { TierDerivationService } from "../guest/tier-derivation.service.js";
import type { HousekeepingService } from "../housekeeping/housekeeping.service.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { FolioPort } from "./ports/folio.port.js";
import type { StayQuoteService } from "./stay-quote.service.js";

const CHECK_VIOLATION = "23514";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

/** Better Auth's own shape for an id: 32 base-62 characters, not a UUID. */
const ANH = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";
const BINH = "7Qw9Lm2Xk4pR8tV1sN6cB3dF5hJ0zY2a";

let pool: pg.Pool;
let db: Database;
let bookings: BookingService;
let roomTypeId: string;
let stayId: string;
let referenceOrdinal = 0;

/** The stay's owner and whether its anonymous credential still opens it. */
async function ownershipOf(bookingId: string) {
  const [row] = await db
    .select({
      userId: booking.userId,
      anonAccessRevokedAt: booking.anonAccessRevokedAt,
    })
    .from(booking)
    .where(eq(booking.id, bookingId));

  return row!;
}

async function aStay(): Promise<string> {
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
    })
    .returning({ id: booking.id });

  return row!.id;
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
    undefined as unknown as Env,
    // Neither is reached: nothing here confirms a paid hold, and a case that
    // wandered into one fails loudly rather than agreeing with a stand-in.
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

  await db.insert(guestUser).values([
    {
      id: ANH,
      name: "Trần Minh Anh",
      email: "minh.anh@mariva.test",
      emailVerified: true,
    },
    {
      id: BINH,
      name: "Lê Hoàng Bình",
      email: "hoang.binh@mariva.test",
      emailVerified: true,
    },
  ]);
});

beforeEach(async () => {
  stayId = await aStay();
});

afterAll(async () => {
  await pool?.end();
});

describe("attaching a stay to an account", () => {
  it("writes the owner and gives up the anonymous credential, in one commit", async () => {
    const attached = await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    expect(attached.id).toBe(stayId);
    expect(attached.userId).toBe(ANH);

    const stored = await ownershipOf(stayId);

    expect(stored.userId).toBe(ANH);
    expect(stored.anonAccessRevokedAt).not.toBeNull();
  });

  it("cannot have revoked first, because the database refuses that order", async () => {
    // The control. Revocation on a stay with no owner raises `23514`, so the
    // committed row above can only have been reached by writing `user_id`
    // first. This is the proof, and it is a proof about the database rather
    // than about the order of two lines somebody could reorder tomorrow.
    const raised = await db
      .transaction((exec) => bookings.revokeAnonymousAccess(exec, stayId))
      .catch((error: unknown) => error);

    expect(sqlStateOf(raised)).toBe(CHECK_VIOLATION);
    expect((await ownershipOf(stayId)).anonAccessRevokedAt).toBeNull();
  });

  it("leaves nothing behind when the transaction it is part of fails", async () => {
    const failed = await db
      .transaction(async (exec) => {
        await bookings.attachToAccount(exec, {
          bookingId: stayId,
          userId: ANH,
        });

        throw new Error("something after the attach went wrong");
      })
      .catch(() => "rolled back");

    expect(failed).toBe("rolled back");

    const stored = await ownershipOf(stayId);

    // Both halves gone. A stay that kept the revocation and lost the owner is
    // a guest locked out of a room they paid for.
    expect(stored.userId).toBeNull();
    expect(stored.anonAccessRevokedAt).toBeNull();
  });

  it("never moves a stay that already belongs to somebody else", async () => {
    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    const refused = await db
      .transaction((exec) =>
        bookings.attachToAccount(exec, { bookingId: stayId, userId: BINH }),
      )
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ORPCError);
    expect((refused as ORPCError<string, unknown>).code).toBe("CONFLICT");
    expect((await ownershipOf(stayId)).userId).toBe(ANH);
  });

  it("is the attach that already happened when the same account asks twice", async () => {
    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    const revokedAt = (await ownershipOf(stayId)).anonAccessRevokedAt;

    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    const stored = await ownershipOf(stayId);

    expect(stored.userId).toBe(ANH);
    // The instant is when access was surrendered, and a second call moving it
    // would rewrite a fact about the past.
    expect(stored.anonAccessRevokedAt).toEqual(revokedAt);
  });

  it("gives up the credential for a stay that was booked signed in", async () => {
    // Filed under the account at the hold and never revoked, which is the state
    // every signed-in funnel booking is in. Attaching is then only the second
    // half — and it has to still happen, or the cookie that browser is holding
    // goes on opening a stay that has an owner.
    await db
      .update(booking)
      .set({ userId: ANH })
      .where(eq(booking.id, stayId));

    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    expect((await ownershipOf(stayId)).anonAccessRevokedAt).not.toBeNull();
  });

  it("refuses a stay that does not exist without saying so differently", async () => {
    const missing = await db
      .transaction((exec) =>
        bookings.attachToAccount(exec, {
          bookingId: "00000000-0000-4000-8000-000000000000",
          userId: ANH,
        }),
      )
      .catch((error: unknown) => error);

    expect((missing as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });
});

describe("what the stay answers after it is attached", () => {
  it("is unreachable by the credential that used to open it", async () => {
    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    const refused = await bookings
      .ownHold(db, {
        bookingId: stayId,
        owner: { kind: "proven", bookingId: stayId },
      })
      .catch((error: unknown) => error);

    // The same `NOT_FOUND` a stay that does not exist gets, which is what keeps
    // the id space unwalkable.
    expect((refused as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("is reachable by the account it now belongs to", async () => {
    await db.transaction((exec) =>
      bookings.attachToAccount(exec, { bookingId: stayId, userId: ANH }),
    );

    const read = await bookings.ownHold(db, {
      bookingId: stayId,
      owner: { kind: "account", userId: ANH },
    });

    expect(read.id).toBe(stayId);
  });
});
