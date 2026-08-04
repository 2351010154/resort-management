// The guest record and the number on it, against a real Postgres — `FR-GST-03`.
//
// `guest-storage.e2e-spec.ts` asserts what the tables refuse. This file asserts
// what the service does with them, and the two claims it exists to hold cannot
// be made about a mock:
//
// - **A read never returns the number.** That is a property of a masking rule
//   applied to whatever the database actually stored, including the trimming
//   the write did on the way in — and a stubbed row would only prove the mask
//   works on the string the test handed it.
// - **The audit row and the read commit together.** The failure worth testing
//   is an entry surviving a rolled-back request, or a number being read without
//   one being written, and neither is expressible without a transaction that
//   really rolls back.
//
// No Nest application is booted, for `inventory-reservation.e2e-spec.ts`'s
// reason: the subject is one service and the database underneath it, and an
// HTTP stack around them would only add ways for a failure to mean something
// else. The routes are not written yet in any case — the service exists first
// because check-in registers a guest inside the booking transition.

import "reflect-metadata";

import { CalendarDate, parseDate } from "@internationalized/date";
import { ORPCError } from "@orpc/nest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cccdUnmaskAudit, guest } from "../src/database/schema/guest.js";
import { staffUser } from "../src/database/schema/identity.js";
import * as schema from "../src/database/schema/index.js";
import {
  type GuestRecord,
  GuestService,
  type NewGuest,
} from "../src/modules/guest/guest.service.js";
import { sqlStateOf } from "../src/database/sql-state.js";

// A uuid the migrations guarantee nothing points at — every id here is
// `defaultRandom()`, so this one names no row by construction.
const NO_SUCH_ROW = "00000000-0000-0000-0000-000000000000";

const TRANSACTION_ABORTED = "25P02";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let guests: GuestService;
let managerId: string;

// CCCDs are unique and this file writes many guests, so they are counted rather
// than drawn: a random one would make a failing run harder to reproduce than
// the bug it found.
let cccdOrdinal = 0;

/** The twelve digits a card carries, distinct per call. Not a decodable
 *  number — the leading digits of a real CCCD are a province and a
 *  century-and-sex code, and a fixture that resolves to a plausible person is a
 *  small thing to avoid in a committed file. */
function aCccd(): string {
  cccdOrdinal += 1;

  return `079301${String(cccdOrdinal).padStart(6, "0")}`;
}

/** A guest the desk could have identified. Each test overrides the one field it
 *  is about, so a refusal names the rule under test and not a second one the
 *  fixture happened to break. */
function aGuest(overrides: Partial<NewGuest> = {}): NewGuest {
  return {
    fullName: "Nguyễn Văn A",
    phone: "0901234567",
    cccdNumber: aCccd(),
    dateOfBirth: parseDate("1993-01-04"),
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
    sql`truncate cccd_unmask_audit, registration, guest, staff_session, staff_user restart identity cascade`,
  );

  const [manager] = await db
    .insert(staffUser)
    .values({
      email: "quan.ly@mariva.test",
      fullName: "Trần Thị B",
      role: "MANAGER",
      passwordHash: "not-a-real-hash",
    })
    .returning({ id: staffUser.id });

  managerId = manager!.id;

  guests = new GuestService();
});

afterAll(async () => {
  await pool?.end();
});

describe("identifying a guest", () => {
  it("stores the number as it was read and answers with it masked", async () => {
    // Both halves of `schema/guest.ts`'s argument in one test: the column holds
    // the card, and the mask is what the read path says about it. A second
    // stored column would make these two assertions independent, which is
    // exactly how one of them goes stale.
    const cccd = aCccd();
    const record = await guests.createGuest(db, aGuest({ cccdNumber: cccd }));

    expect(record.cccdMasked).toBe(`********${cccd.slice(-4)}`);
    expect(record.cccdMasked).not.toContain(cccd.slice(0, -4));

    const [stored] = await db
      .select({ cccdNumber: guest.cccdNumber })
      .from(guest)
      .where(eq(guest.id, record.id));

    expect(stored!.cccdNumber).toBe(cccd);
  });

  it("hands back no plain number even to the caller that supplied one", async () => {
    // The creating caller already knows the number, so returning it would leak
    // nothing today. It is withheld anyway: `GuestRecord` is the one shape
    // every read path passes around, and a field that carries the number on
    // some paths is a field somebody logs on all of them.
    const cccd = aCccd();
    const record = await guests.createGuest(db, aGuest({ cccdNumber: cccd }));

    // Every field, not the one that was expected to hold it — the assertion is
    // that the number is nowhere in the answer.
    expect(Object.values(record).join("|")).not.toContain(cccd);
    expect(record).not.toHaveProperty("cccdNumber");
  });

  it("reads a guest back the same way it answered when creating them", async () => {
    const created = await guests.createGuest(db, aGuest());
    const read = await guests.getGuest(db, created.id);

    expect(read).toEqual(created);
  });

  it("carries the date of birth as a calendar date and not an instant", async () => {
    // `NFR-12`. A birthday read as a timestamp moves by a day in UTC+7, and
    // nobody counts nights from a birthday, so the off-by-one would surface
    // years later on a report.
    const record = await guests.createGuest(
      db,
      aGuest({ dateOfBirth: parseDate("1993-01-04") }),
    );

    expect(record.dateOfBirth).toBeInstanceOf(CalendarDate);
    expect(record.dateOfBirth?.toString()).toBe("1993-01-04");
  });

  it("identifies a guest who handed over nothing but a name", async () => {
    // The second occupant of a room, registered on the booking holder's word.
    // `schema/guest.ts` makes every other column nullable for this case.
    const record = await guests.createGuest(db, {
      fullName: "Lê Thị C",
    });

    expect(record.cccdMasked).toBeNull();
    expect(record.dateOfBirth).toBeNull();
    expect(record.phone).toBeNull();
  });

  it("treats a detail typed as blank as one nobody gave", async () => {
    // A field somebody tabbed through. Stored as absent rather than as an empty
    // string, so a report counting guests without a phone number counts the
    // right ones — and so `guest_cccd_present_when_set` never has to refuse a
    // write the desk cannot interpret.
    const record = await guests.createGuest(db, {
      fullName: "Phạm Văn D",
      phone: "   ",
      email: "",
      cccdNumber: "  ",
      nationality: "\t",
    });

    expect(record).toMatchObject({
      phone: null,
      email: null,
      cccdMasked: null,
      nationality: null,
    });
  });

  it("trims the number, so a scanner's stray space is not a second person", async () => {
    // The duplicate the partial unique index exists to prevent, arriving
    // through the one gap the index cannot see: two strings that differ only in
    // whitespace are two values to Postgres and one card to everybody else.
    const cccd = aCccd();

    await guests.createGuest(db, aGuest({ cccdNumber: ` ${cccd} ` }));

    await expect(
      guests.createGuest(db, aGuest({ cccdNumber: cccd })),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("refuses a second record on a number the property already holds", async () => {
    // Not a fault: the property has met this person before, and `FR-GST-01`'s
    // stay history — with the rolling-12-month count `FR-GST-04` derives the
    // VIP tier from — is only whole if both stays land on one row.
    const shared = aGuest();

    await guests.createGuest(db, shared);

    await expect(
      guests.createGuest(db, { ...shared, fullName: "Someone Else" }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("refuses a guest with no name", async () => {
    // `guest_has_a_name`, translated. A guest with a whitespace name is not
    // identified, and the row would be indistinguishable afterwards from one
    // where the name was genuinely unknown.
    await expect(
      guests.createGuest(db, aGuest({ fullName: "   " })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("refuses to read a guest nobody identified", async () => {
    await expect(guests.getGuest(db, NO_SUCH_ROW)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("does not dress a failure it does not own as a refusal", async () => {
    // A transaction already aborted by something else. Translating it into a
    // `CONFLICT` would tell the desk to try different details for a problem
    // that has nothing to do with the details — and would hide a fault behind a
    // status nothing alerts on.
    let thrown: unknown;

    await db
      .transaction(async (exec) => {
        await exec.execute(sql`select 1 / 0`).catch(() => undefined);

        try {
          await guests.createGuest(exec, aGuest());
        } catch (error) {
          thrown = error;
        }

        throw new Error("rolled back on purpose");
      })
      .catch(() => undefined);

    expect(thrown).not.toBeInstanceOf(ORPCError);
    expect(sqlStateOf(thrown)).toBe(TRANSACTION_ABORTED);
  });
});

describe("revealing the number", () => {
  let person: GuestRecord;
  let cccd: string;

  beforeAll(async () => {
    cccd = aCccd();
    person = await guests.createGuest(db, aGuest({ cccdNumber: cccd }));
  });

  it("returns the plain number and records exactly one reading of it", async () => {
    const reveal = await db.transaction((exec) =>
      guests.unmaskCccd(exec, {
        guestId: person.id,
        unmaskedBy: managerId,
        reason: "police residence declaration",
      }),
    );

    expect(reveal.cccdNumber).toBe(cccd);
    expect(reveal.unmaskedBy).toBe(managerId);
    expect(reveal.unmaskedAt).toBeInstanceOf(Date);

    const trail = await auditFor(person.id);

    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      unmaskedBy: managerId,
      reason: "police residence declaration",
    });
  });

  it("records a second look as a second entry", async () => {
    // `FR-GST-03` audits per call and `screens.md` reads that as per field and
    // per visit. A count or a last-read timestamp would answer "has anyone
    // seen this"; the question an investigation asks is who, and how often.
    await db.transaction((exec) =>
      guests.unmaskCccd(exec, { guestId: person.id, unmaskedBy: managerId }),
    );

    const trail = await auditFor(person.id);

    expect(trail).toHaveLength(2);
    // Optional, and left empty rather than filled with "check in": the
    // attribution is what makes the read accountable. Counted rather than
    // indexed, so the assertion does not rest on two timestamps ordering the
    // way the writes happened to.
    expect(trail.filter((entry) => entry.reason === null)).toHaveLength(1);
  });

  it("leaves no entry behind when the request that read it is rolled back", async () => {
    // The entry and the read are one commit. An audit trail that records reads
    // nobody completed cannot be trusted to accuse, which is worse than a
    // sparse one.
    const other = await guests.createGuest(db, aGuest());

    await db
      .transaction(async (exec) => {
        await guests.unmaskCccd(exec, {
          guestId: other.id,
          unmaskedBy: managerId,
        });

        throw new Error("the request failed after the number was read");
      })
      .catch(() => undefined);

    expect(await auditFor(other.id)).toHaveLength(0);
  });

  it("refuses a guest nobody identified, and records nothing", async () => {
    // Resolved before the audit is written on purpose: auditing first against
    // an id nobody holds aborts the caller's whole transaction on a foreign
    // key instead of answering 404.
    await expect(
      db.transaction((exec) =>
        guests.unmaskCccd(exec, {
          guestId: NO_SUCH_ROW,
          unmaskedBy: managerId,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    expect(await auditFor(NO_SUCH_ROW)).toHaveLength(0);
  });

  it("reveals nothing for a guest with no number on file, and records nothing", async () => {
    // Nothing was read, so nothing is claimed. An entry here would put
    // readings of numbers that do not exist into the trail an investigation is
    // counted from.
    const undocumented = await guests.createGuest(db, {
      fullName: "Trần Văn E",
    });

    await expect(
      db.transaction((exec) =>
        guests.unmaskCccd(exec, {
          guestId: undocumented.id,
          unmaskedBy: managerId,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    expect(await auditFor(undocumented.id)).toHaveLength(0);
  });

  it("still masks the number on the ordinary read afterwards", async () => {
    // Revealing is per visit. A guest whose number was unmasked an hour ago is
    // read masked like everybody else — there is no sticky state, because the
    // capability is checked per call and so is the audit.
    const read = await guests.getGuest(db, person.id);

    expect(read.cccdMasked).toBe(`********${cccd.slice(-4)}`);
  });
});

/** Every recorded reading of one guest's number, oldest first. */
async function auditFor(guestId: string) {
  return await db
    .select({
      unmaskedBy: cccdUnmaskAudit.unmaskedBy,
      unmaskedAt: cccdUnmaskAudit.unmaskedAt,
      reason: cccdUnmaskAudit.reason,
    })
    .from(cccdUnmaskAudit)
    .where(eq(cccdUnmaskAudit.guestId, guestId))
    .orderBy(cccdUnmaskAudit.unmaskedAt);
}
