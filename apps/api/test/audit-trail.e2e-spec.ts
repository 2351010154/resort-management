// The change log, end to end — `FR-AUD-01` over the three pricing tables.
//
// What is on trial is not that rows appear. It is the four properties that make
// a change log worth consulting, and each of them fails silently if it is wrong:
//
//   1. **Attribution.** The row names the member of staff the guard resolved,
//      not an id the request could have chosen. A log that records the name it
//      was handed accuses whoever the caller typed.
//   2. **The previous value.** An upsert destroys what it overwrites, so if the
//      pre-image is not captured in the statement that destroys it, it is not
//      captured at all. The `before` on an `UPDATE` is the figure the property
//      was advertising until the call under test — asserted against a price the
//      test put there itself.
//   3. **Atomicity.** The row and the edit are one commit. A refused edit that
//      left a log entry behind would describe a price nobody ever charged, and
//      is the failure `NFR-09`'s coverage assertion cannot see.
//   4. **Exactness.** The snapshot is copied from a `bigint` column into a
//      `jsonb` one by Postgres, so no đồng figure passes through a JavaScript
//      `number` on the way in. The price below is 2^53 + 1 for that reason: it
//      is the smallest integer a `number` cannot hold, so a snapshot that ever
//      became one comes back a đồng short and this is the assertion that
//      notices.
//
// None of the three services under test files an entry itself. Every row
// asserted on here is written by the trigger on the table being changed, which
// is what makes the coverage a property of the database rather than of these
// three call sites — and what makes case 3 exact rather than nearly so.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { withAuditActor } from "../src/common/audit/audit-actor.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { auditEntry } from "../src/database/schema/audit.js";
import { roomType } from "../src/database/schema/inventory.js";
import {
  rateCalendar,
  stayRestriction,
} from "../src/database/schema/pricing.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { TransactionRunner } from "../src/database/transaction-runner.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import { RateCalendarService } from "../src/modules/pricing/rate-calendar.service.js";

const SEED_FROM = parseDate("2027-03-01");

// Inside the twelve months the seed opens, so these nights start out priced —
// which is what makes a reprice over them an `UPDATE` with a `before`.
const FIRST = "2027-04-05";
const LAST = "2027-04-07";
const NIGHTS = 3;

// Past the seeded horizon. Nothing has ever priced these, so a write over them
// is an `INSERT` and its `before` is genuinely absent rather than merely
// unrecorded.
const UNPRICED_FIRST = "2029-01-10";
const UNPRICED_LAST = "2029-01-11";

const SETTLED_PRICE = 1_800_000n;

// 2^53 + 1 — see the header. A `number` rounds this to 9007199254740992.
const UNREPRESENTABLE_AS_NUMBER = 9_007_199_254_740_993n;

const MANAGER = {
  email: "quan.ly.audit@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
  role: "MANAGER",
  password: "manager-password-42",
} as const;

const OTHER_MANAGER = {
  email: "quan.ly.hai@mariva.test",
  fullName: "Đỗ Quang Huy",
  role: "MANAGER",
  password: "manager-password-43",
} as const;

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let manager: string;
let otherManager: string;
let managerId: string;
let deluxeId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);
  const created = await staff.create({ ...MANAGER });
  await staff.create({ ...OTHER_MANAGER });

  managerId = created.id;
  manager = await signIn(MANAGER.email, MANAGER.password);
  otherManager = await signIn(OTHER_MANAGER.email, OTHER_MANAGER.password);

  const [deluxe] = await db
    .select({ id: roomType.id })
    .from(roomType)
    .where(eq(roomType.code, "DELUXE"))
    .limit(1);

  deluxeId = deluxe!.id;
});

beforeEach(async () => {
  // The rules go first and the log second, and the order is the whole of it:
  // clearing the restrictions is itself an audited change, so emptying the log
  // before them would leave the next case reading this one's tidying-up.
  await db.delete(stayRestriction);

  // The log is the thing under test, so every case starts from an empty one and
  // asserts on everything in it rather than on a suffix it has to find.
  // `truncate` rather than a delete: every protected table files its own
  // entries now, so by the time this file runs the log holds every row the
  // suite before it seeded, and a delete over those is a statement that has to
  // finish inside the pool's five seconds.
  await db.execute(sql`truncate audit_entry`);
});

afterAll(async () => {
  await app?.close();
});

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

const as = (token: string) => ({
  patch: (path: string) =>
    http().patch(path).set("Authorization", `Bearer ${token}`),
  put: (path: string) =>
    http().put(path).set("Authorization", `Bearer ${token}`),
});

/** Everything in the log for one table, oldest first. */
async function entriesFor(tableName: string) {
  return await db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.tableName, tableName))
    .orderBy(asc(auditEntry.occurredAt), asc(auditEntry.rowId));
}

/** Puts a known price on the range so a later write has something to overwrite. */
async function priceRange(gross: bigint, from = FIRST, to = LAST) {
  await as(manager)
    .put("/pricing/rate-calendar")
    .send({
      roomType: "DELUXE",
      from,
      to,
      grossPerNight: gross.toString(),
    })
    .expect(200);
}

describe("a reprice", () => {
  it("files one row per night, naming the manager who set it", async () => {
    await priceRange(SETTLED_PRICE);
    await db.delete(auditEntry);

    await priceRange(2_950_000n);

    const entries = await entriesFor("rate_calendar");

    expect(entries).toHaveLength(NIGHTS);
    expect(entries.every((entry) => entry.actorId === managerId)).toBe(true);
    expect(entries.every((entry) => entry.action === "UPDATE")).toBe(true);
  });

  it("keeps the price the property was advertising until the call", async () => {
    await priceRange(SETTLED_PRICE);
    await db.delete(auditEntry);

    await priceRange(2_950_000n);

    const entries = await entriesFor("rate_calendar");

    for (const entry of entries) {
      const before = entry.before as Record<string, unknown>;
      const after = entry.after as Record<string, unknown>;

      expect(String(before.gross_per_night)).toBe(SETTLED_PRICE.toString());
      expect(String(after.gross_per_night)).toBe("2950000");
      // The same row on both sides — a reprice moves a figure, it does not
      // replace the night.
      expect(before.id).toBe(entry.rowId);
      expect(after.id).toBe(entry.rowId);
    }
  });

  it("files a night nobody had priced as an INSERT with no previous state", async () => {
    await priceRange(SETTLED_PRICE, UNPRICED_FIRST, UNPRICED_LAST);

    const entries = await entriesFor("rate_calendar");

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.action === "INSERT")).toBe(true);
    expect(entries.every((entry) => entry.before === null)).toBe(true);
    expect(entries.every((entry) => entry.after !== null)).toBe(true);
  });

  it("attributes each call to the manager who made it, not the last one", async () => {
    await priceRange(SETTLED_PRICE);
    await db.delete(auditEntry);

    await as(otherManager)
      .put("/pricing/rate-calendar")
      .send({
        roomType: "DELUXE",
        from: FIRST,
        to: FIRST,
        grossPerNight: "2100000",
      })
      .expect(200);

    const entries = await entriesFor("rate_calendar");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).not.toBe(managerId);
  });

  it("records a đồng figure a JavaScript number could not hold", async () => {
    await priceRange(UNREPRESENTABLE_AS_NUMBER, FIRST, FIRST);

    const [entry] = await entriesFor("rate_calendar");
    const after = entry!.after as Record<string, unknown>;

    // Read back out of Postgres as text on both sides of the comparison: the
    // stored column and the snapshot have to agree exactly, and the moment
    // either is parsed to a `number` this reads 9007199254740992.
    const { rows } = await db.execute<{ stored: string; snapshot: string }>(sql`
      select
        (select gross_per_night::text
         from rate_calendar
         where room_type_id = ${deluxeId} and stay_date = ${FIRST}) as stored,
        ("after"->>'gross_per_night') as snapshot
      from audit_entry
      where id = ${entry!.id}
    `);

    expect(rows[0]!.stored).toBe(UNREPRESENTABLE_AS_NUMBER.toString());
    expect(rows[0]!.snapshot).toBe(UNREPRESENTABLE_AS_NUMBER.toString());
  });
});

describe("a rate plan edit", () => {
  it("files one row carrying both sides of the field that moved", async () => {
    await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({ percentAdjustment: -25 })
      .expect(200);

    const entries = await entriesFor("rate_plan");

    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    const before = entry.before as Record<string, unknown>;
    const after = entry.after as Record<string, unknown>;

    expect(entry.action).toBe("UPDATE");
    expect(entry.actorId).toBe(managerId);
    expect(before.percent_adjustment).toBe(-10);
    expect(after.percent_adjustment).toBe(-25);
    // Untouched fields appear on both sides unchanged, which is what makes the
    // pair a snapshot of the row rather than a diff of the request.
    expect(before.name).toBe(after.name);
  });

  it("files nothing for a PATCH that named no field", async () => {
    await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({})
      .expect(200);

    // A gesture that changed no value is not a change. A row for it would be an
    // edit an investigation has to rule out before it can rule anything in.
    expect(await entriesFor("rate_plan")).toHaveLength(0);
  });
});

describe("a stay restriction", () => {
  it("files the rule that was put on each night", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 3 })
      .expect(200);

    const entries = await entriesFor("stay_restriction");

    expect(entries).toHaveLength(NIGHTS);
    expect(entries.every((entry) => entry.action === "INSERT")).toBe(true);
    expect(
      entries.every(
        (entry) =>
          (entry.after as Record<string, unknown>).minimum_stay === 3,
      ),
    ).toBe(true);
  });

  // The case the issue was filed for. Clearing deletes the row, so the log is
  // the only place the rule ever existed once this call returns.
  it("keeps the rule a clear lifted, which nothing else does", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({
        roomType: "DELUXE",
        from: FIRST,
        to: LAST,
        minimumStay: 2,
        closedToArrival: true,
      })
      .expect(200);

    await db.delete(auditEntry);

    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 1 })
      .expect(200);

    const entries = await entriesFor("stay_restriction");

    expect(entries).toHaveLength(NIGHTS);
    expect(entries.every((entry) => entry.action === "DELETE")).toBe(true);
    expect(entries.every((entry) => entry.after === null)).toBe(true);

    // The table now holds nothing for these nights, and this is the assertion
    // that the closure survived it.
    const remaining = await db
      .select()
      .from(stayRestriction)
      .where(eq(stayRestriction.roomTypeId, deluxeId));

    expect(remaining).toHaveLength(0);
    expect(
      entries.every(
        (entry) =>
          (entry.before as Record<string, unknown>).closed_to_arrival === true,
      ),
    ).toBe(true);
  });

  it("files nothing for a clear over nights that carried no rule", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 1 })
      .expect(200);

    expect(await entriesFor("stay_restriction")).toHaveLength(0);
  });
});

describe("the log and the edit are one commit", () => {
  it("keeps neither when the transaction they share is rolled back", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    const before = await storedGross(FIRST);

    await expect(
      // The actor is established by hand here because there is no request: the
      // interceptor is what does it in production, and what is on trial in this
      // case is the executor composition rather than the interceptor.
      withAuditActor({ staffUserId: managerId }, () =>
        transactions.run(async (exec) => {
          await calendar.set(exec, {
            roomType: "DELUXE",
            from: parseDate(FIRST),
            to: parseDate(LAST),
            grossPerNight: 4_400_000n,
          });

          // Whatever fails after a write — a sold-out night, a deadlock, a bug.
          throw new Error("the rest of the handler refused");
        }),
      ),
    ).rejects.toThrow("the rest of the handler refused");

    // Both halves are gone, which is the property. A log entry surviving here
    // would name a price the property never charged.
    expect(await storedGross(FIRST)).toBe(before);
    expect(await entriesFor("rate_calendar")).toHaveLength(0);
  });

  it("files a change with nobody behind it against nobody", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    // No `withAuditActor` — the state a sweep, a scheduled job or a gateway
    // callback is in. The change still happened and is still recorded; what it
    // must not do is name an account, because an entry crediting somebody who
    // did nothing is worse than one crediting nobody.
    await transactions.run((exec) =>
      calendar.set(exec, {
        roomType: "DELUXE",
        from: parseDate(FIRST),
        to: parseDate(FIRST),
        grossPerNight: 3_300_000n,
      }),
    );

    const entries = await entriesFor("rate_calendar");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorKind).toBe("system");
    expect(entries[0]!.actorId).toBeNull();
  });
});

/** The price the calendar actually holds, read past the API. */
async function storedGross(night: string): Promise<bigint | null> {
  const [row] = await db
    .select({ gross: rateCalendar.grossPerNight })
    .from(rateCalendar)
    .where(
      and(
        eq(rateCalendar.roomTypeId, deluxeId),
        eq(rateCalendar.stayDate, night),
      ),
    )
    .limit(1);

  return row?.gross ?? null;
}
