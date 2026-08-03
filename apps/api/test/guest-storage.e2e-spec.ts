// The guest tables and their keys, against a real Postgres.
//
// `src/database/schema/guest.spec.ts` asserts what the declarations say. This
// file asserts what the database does with them, because the claim being made
// is not that a service remembers to check — it is that the rows a residence
// record cannot survive are unstorable.
//
// The rows it tries are the ones the check-in path will lean on: a returning
// guest duplicated under a second row with the same CCCD, a booking with two
// holders, a registration naming a stay nobody took, and an unmask attributed
// to nobody. Each is a row that reads as ordinary until a report, an invoice or
// an audit is run off it a milestone later.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies the
// migrations rather than pushing the schema: the SQL under test is the SQL that
// will run in production. No Nest application is booted — the subject is the
// storage layer itself.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { booking } from "../src/database/schema/booking.js";
import {
  cccdUnmaskAudit,
  guest,
  registration,
} from "../src/database/schema/guest.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// A uuid the migrations guarantee nothing points at — every id in this suite is
// `defaultRandom()`, so this one names no row by construction.
const NO_SUCH_ROW = "00000000-0000-0000-0000-000000000000";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

let bookingId: string;
let managerId: string;

// CCCDs are unique and this suite writes many guests, so they are counted
// rather than drawn: a random one would make a failing run harder to reproduce
// than the bug it found.
let cccdOrdinal = 0;

/** A guest the desk could have registered. Each test overrides the one field it
 *  is about, so a refusal names the constraint under test and not a second one
 *  the fixture happened to break. */
function aGuest(
  overrides: Partial<typeof guest.$inferInsert> = {},
): typeof guest.$inferInsert {
  cccdOrdinal += 1;

  return {
    fullName: "Nguyễn Văn A",
    phone: "0901234567",
    cccdNumber: `0793010${String(cccdOrdinal).padStart(5, "0")}`,
    dateOfBirth: "1993-01-04",
    nationality: "VN",
    ...overrides,
  };
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate cccd_unmask_audit, registration, guest, room_assignment, booking_night, booking, type_inventory, room, room_type, staff_session, staff_user restart identity cascade`,
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
    .returning();

  const [stay] = await db
    .insert(booking)
    .values({
      reference: "MRV-20270510-0001",
      state: "CONFIRMED",
      roomTypeId: deluxe!.id,
      checkInDate: "2027-05-10",
      checkOutDate: "2027-05-13",
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning();

  bookingId = stay!.id;

  const [manager] = await db
    .insert(staffUser)
    .values({
      email: "manager@mariva.test",
      fullName: "Trần Thị B",
      role: "MANAGER",
      passwordHash: "not-a-real-hash",
    })
    .returning();

  managerId = manager!.id;
});

afterAll(async () => {
  await pool?.end();
});

describe("the guest and their number", () => {
  it("refuses a second person on one CCCD", async () => {
    // The duplicate that splits a stay history. Both rows look like a guest;
    // neither holds the whole of `FR-GST-01`'s history, and `FR-GST-04` derives
    // the VIP tier from a rolling-12-month count that would then undercount.
    const shared = aGuest();

    await db.insert(guest).values(shared);

    const refusal = await refused(
      db.insert(guest).values({ ...shared, fullName: "Someone Else" }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(refusal.constraint).toBe("guest_cccd_number_key");
  });

  it("stores as many guests without a CCCD as the room holds", async () => {
    // The other half of the partial index, and the reason it is partial: a
    // passport-holder and a second occupant registered by name are both null
    // here, and a plain unique index would let the property identify exactly
    // one of them.
    await db.insert(guest).values(aGuest({ cccdNumber: null }));
    await db.insert(guest).values(aGuest({ cccdNumber: null }));

    const withoutCccd = await db
      .select()
      .from(guest)
      .where(sql`${guest.cccdNumber} is null`);

    expect(withoutCccd.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a CCCD that is present but says nothing", async () => {
    // An empty string masks to a row of asterisks that looks exactly like a
    // number being withheld. Absent and present-but-blank have to stay tellable
    // apart, so only one of them is storable.
    const refusal = await refused(
      db.insert(guest).values(aGuest({ cccdNumber: "   " })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("guest_cccd_present_when_set");
  });

  it("refuses a guest with no name", async () => {
    const refusal = await refused(
      db.insert(guest).values(aGuest({ fullName: "  " })),
    );

    expect(refusal.code).toBe(CHECK_VIOLATION);
    expect(refusal.constraint).toBe("guest_has_a_name");
  });
});

describe("the registration", () => {
  it("refuses a registration naming a stay nobody took", async () => {
    // What the key is for. A typo'd booking id would otherwise produce a
    // residence record for a booking that does not exist — a person the
    // property claims stayed with it and cannot say when.
    const [person] = await db.insert(guest).values(aGuest()).returning();

    const refusal = await refused(
      db
        .insert(registration)
        .values({ bookingId: NO_SUCH_ROW, guestId: person!.id }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(refusal.constraint).toBe("registration_booking_id_booking_id_fk");
  });

  it("refuses a registration naming a guest nobody identified", async () => {
    const refusal = await refused(
      db.insert(registration).values({ bookingId, guestId: NO_SUCH_ROW }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(refusal.constraint).toBe("registration_guest_id_guest_id_fk");
  });

  it("refuses the same person registered twice on one stay", async () => {
    // Harmless-looking, and it makes the occupant count — which is what a
    // residence report is counted from — depend on how many times somebody
    // pressed the button.
    const [person] = await db.insert(guest).values(aGuest()).returning();

    await db.insert(registration).values({ bookingId, guestId: person!.id });

    const refusal = await refused(
      db.insert(registration).values({ bookingId, guestId: person!.id }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(refusal.constraint).toBe("registration_booking_guest_key");
  });

  it("refuses a booking with two holders", async () => {
    // Two primaries is a folio with two addressees and no rule for choosing,
    // which surfaces at M6 as an invoice made out to whichever row was read
    // first.
    const [holder] = await db.insert(guest).values(aGuest()).returning();
    const [second] = await db.insert(guest).values(aGuest()).returning();

    await db
      .insert(registration)
      .values({ bookingId, guestId: holder!.id, isPrimary: true });

    const refusal = await refused(
      db
        .insert(registration)
        .values({ bookingId, guestId: second!.id, isPrimary: true }),
    );

    expect(refusal.code).toBe(UNIQUE_VIOLATION);
    expect(refusal.constraint).toBe("registration_one_primary_per_booking_key");
  });

  it("registers the rest of the room alongside the holder", async () => {
    // The partial index constrains the primaries only. A family of four is four
    // rows on one booking, and exactly one of them is the addressee.
    const [companion] = await db.insert(guest).values(aGuest()).returning();

    const [registered] = await db
      .insert(registration)
      .values({ bookingId, guestId: companion!.id })
      .returning();

    expect(registered?.isPrimary).toBe(false);
    expect(registered?.registeredAt).toBeInstanceOf(Date);
  });
});

describe("the unmask audit", () => {
  it("records who read which number, and when", async () => {
    const [person] = await db.insert(guest).values(aGuest()).returning();

    const [entry] = await db
      .insert(cccdUnmaskAudit)
      .values({
        guestId: person!.id,
        unmaskedBy: managerId,
        reason: "police residence declaration",
      })
      .returning();

    expect(entry?.guestId).toBe(person!.id);
    expect(entry?.unmaskedBy).toBe(managerId);
    expect(entry?.unmaskedAt).toBeInstanceOf(Date);
  });

  it("refuses a reveal attributed to nobody", async () => {
    // `FR-GST-03` audits per call, and an unattributed entry answers none of
    // what an audit is read for. There is no automated path that needs the
    // plain number, so there is no actor to leave null.
    const [person] = await db.insert(guest).values(aGuest()).returning();

    const refusal = await refused(
      db
        .insert(cccdUnmaskAudit)
        .values({ guestId: person!.id, unmaskedBy: NO_SUCH_ROW }),
    );

    expect(refusal.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(refusal.constraint).toBe(
      "cccd_unmask_audit_unmasked_by_staff_user_id_fk",
    );
  });

  it("keeps the trail when the member of staff leaves", async () => {
    // `identity.ts` deactivates rather than deletes, precisely so the key above
    // keeps resolving. Asserted from this side because the guarantee the audit
    // depends on is the one made in another file.
    const [leaver] = await db
      .insert(staffUser)
      .values({
        email: "leaver@mariva.test",
        fullName: "Lê Văn C",
        role: "RECEPTIONIST",
        passwordHash: "not-a-real-hash",
        isActive: false,
      })
      .returning();

    const [person] = await db.insert(guest).values(aGuest()).returning();

    const [entry] = await db
      .insert(cccdUnmaskAudit)
      .values({ guestId: person!.id, unmaskedBy: leaver!.id })
      .returning();

    expect(entry?.unmaskedBy).toBe(leaver!.id);
  });
});

type Refusal = { code: string; constraint?: string };

/** The refusal a write provoked. Fails the test if the database accepted it. */
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
 * on a cause one or more levels down. The chain is walked rather than assumed
 * to be one deep.
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
