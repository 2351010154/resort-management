// The coverage `NFR-09` states as a number — 100% of state-changing endpoints —
// asserted as a property of the database rather than sampled one route at a
// time.
//
// **Why the coverage assertion is over tables and not over routes.** A route
// that changes state changes a row of some table; there is no third thing it
// could do. So a table that cannot be inserted into, updated or deleted from
// without an entry being filed is a table every route touching it is audited
// against — including the route somebody adds next month without reading any of
// this. Enumerating today's mutating procedures would prove something about
// today and pass silently forever after, which is the failure mode a coverage
// test can least afford. What is enumerated below instead is the schema: every
// table in `schema/index.ts` either carries the trigger or is named in the list
// of decisions about the ones that do not, and a table added tomorrow is in
// neither until somebody says which.
//
// The other five claims are the ones a change log is worth consulting for, and
// each of them fails silently if it is wrong:
//
//   1. **Attribution comes from the guard.** The entry names the member of staff
//      the access guard resolved from the credential presented, on a route whose
//      body never mentions an actor at all. A log that recorded a name it was
//      handed accuses whoever the caller typed.
//   2. **A change with nobody behind it names nobody.** A sweep, a job, a
//      gateway callback and a seeder all change rows with no person behind them,
//      and the honest entry for those is `system` with no account — never the
//      account that happened to hold the pooled connection a moment earlier.
//   3. **The entry and the change are one commit.** A rolled-back edit takes its
//      entry with it, so a price that was refused never appears as a price that
//      was set.
//   4. **A đồng figure survives exactly.** The amount below is 2^53 + 1: the
//      smallest integer a JavaScript `number` cannot hold. It is copied from a
//      `bigint` column into a `jsonb` one by Postgres with the driver nowhere on
//      the path, and this is the assertion that notices if that ever stops being
//      true.
//   5. **The log carries what it is entitled to carry, and still records that
//      it changed.** A CCCD number and a password digest are withheld — the
//      viewer must not become an unmask route with no `cccd_unmask_audit` row
//      behind it — but withholding a value is not the same statement as ignoring
//      a column, and the two must not collapse into one. A correction confined
//      to a withheld column files an entry carrying `withheld` on both sides; a
//      hold's twenty-second heartbeat, which is an ignored column, files
//      nothing.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  and,
  asc,
  eq,
  getTableName,
  inArray,
  is,
  like,
  sql,
} from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { withAuditActor } from "../../src/common/audit/audit-actor.js";
import { type Database, DRIZZLE } from "../../src/database/database.module.js";
import { auditEntry } from "../../src/database/schema/audit.js";
import { booking } from "../../src/database/schema/booking.js";
import { systemConfig } from "../../src/database/schema/config.js";
import { guest } from "../../src/database/schema/guest.js";
import { staffUser } from "../../src/database/schema/identity.js";
import * as schema from "../../src/database/schema/index.js";
import { rateCalendar } from "../../src/database/schema/pricing.js";
import { seedDatabase } from "../../src/database/seed/seed.js";
import { TransactionRunner } from "../../src/database/transaction-runner.js";
import { StaffUserService } from "../../src/modules/identity/staff-user.service.js";
import { RateCalendarService } from "../../src/modules/pricing/rate-calendar.service.js";

/**
 * Which tables are protected by the trigger, and why each of the rest is not.
 *
 * This is the list the migration installing the trigger argues, restated as an
 * assertion. It is a map rather than an array because a silent exclusion is
 * exactly the hole `NFR-09` exists to close: a table leaves the protected set
 * only by a sentence somebody had to write, and the case below refuses a key
 * naming a table this schema no longer has, so a rename cannot quietly carry an
 * exclusion forward with it.
 */
const NOT_PROTECTED: Readonly<Record<string, string>> = {
  audit_entry:
    "the log itself — an entry about an entry recurses without bound",
  staff_session:
    "one row per issued refresh token, held as a digest: session " +
    "infrastructure, and a credential the log has no business copying",
  guest_session: "the guest realm's sessions, for the same reason",
  guest_verification: "one-time codes, for the same reason",
  guest_account: "the guest realm's credentials, for the same reason",
  guest_user:
    "Better Auth's account row, keyed by text it generates — audit_entry.row_id " +
    "is a uuid and cannot address it",
  guest_user_profile:
    "keyed by that same text id and unaddressable with it; nothing statutory " +
    "is lost, since the residence record is registration and the property's " +
    "own record of a guest is guest, both protected",
  payment_reconciliation_run:
    "keyed by business_date and holding no uuid; it is also a job's record " +
    "that a day was compared, carrying the instant it was compared at",
};

/** Postgres's own bits in `pg_trigger.tgtype`. */
const FIRES_PER_ROW = 1 << 0;
const FIRES_BEFORE = 1 << 1;
const FIRES_ON_INSERT = 1 << 2;
const FIRES_ON_DELETE = 1 << 3;
const FIRES_ON_UPDATE = 1 << 4;

const SEED_FROM = parseDate("2027-03-01");

/** Inside the seeded horizon, so a write over it overwrites a published price. */
const A_PRICED_NIGHT = "2027-04-05";

// 2^53 + 1 — see the header. A `number` rounds this to 9007199254740992.
const UNREPRESENTABLE_AS_NUMBER = 9_007_199_254_740_993n;

/**
 * The prices this file publishes over that night, in the order it publishes
 * them.
 *
 * Every one of them has to differ from the one before, and the first from what
 * the seed published, because a write that leaves the row exactly as it found it
 * is not a change and files nothing — which is the rule the withheld-column
 * cases below turn on. `beforeAll` refuses to run if the seed ever moves onto one
 * of these figures, so the coincidence is a failure that names itself rather than
 * an empty page somewhere else.
 */
const PRICES: readonly bigint[] = [
  2_411_000n,
  2_522_000n,
  2_633_000n,
  UNREPRESENTABLE_AS_NUMBER,
];

const [UNATTENDED_PRICE, ATTRIBUTED_PRICE, FOLLOWING_PRICE] = PRICES;

/** A price nothing asserts on, because the transaction that sets it is thrown
 *  away before it can commit. */
const A_REFUSED_PRICE = 4_400_000n;

/** Every account this file opens, so afterAll can find them by one predicate. */
const ACCOUNT_DOMAIN = "@bao-phu.mariva.test";

const FIRST_ADMIN = {
  email: `quan.tri.mot${ACCOUNT_DOMAIN}`,
  fullName: "Hoàng Anh Tuấn",
  role: "ADMIN",
  password: "admin-password-42",
} as const;

const SECOND_ADMIN = {
  email: `quan.tri.hai${ACCOUNT_DOMAIN}`,
  fullName: "Trần Bảo Ngọc",
  role: "ADMIN",
  password: "admin-password-43",
} as const;

/**
 * Two numbers no seeded guest carries, distinctive enough that a snapshot
 * leaking either is found by searching for the digits themselves.
 *
 * The second is what the first is corrected to — the transposed digit
 * `schema/guest.ts` names as the reason that column is editable at all.
 */
const A_CCCD_NUMBER = "079301004417";
const THE_CORRECTED_CCCD_NUMBER = "079301004471";

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let firstAdmin: string;
let secondAdmin: string;
let firstAdminId: string;
let secondAdminId: string;
let aBookingId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // Cascades into the log, because every staff entry names an account behind a
  // foreign key with no `onDelete`. Both tables go together for that reason.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  await clearThisFilesGuest();

  // Bookings, because one of the cases below is about a booking's heartbeat and
  // there is no cheaper way to have one.
  await seedDatabase(db, { from: SEED_FROM, bookings: 5 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  firstAdminId = (await staff.create({ ...FIRST_ADMIN })).id;
  secondAdminId = (await staff.create({ ...SECOND_ADMIN })).id;

  firstAdmin = await signIn(FIRST_ADMIN.email, FIRST_ADMIN.password);
  secondAdmin = await signIn(SECOND_ADMIN.email, SECOND_ADMIN.password);

  const [stay] = await db.select({ id: booking.id }).from(booking).limit(1);

  if (!stay) {
    throw new Error(
      "The seed produced no booking, and the heartbeat case needs one — " +
        "check `bookings` above against what `seed.ts` does with it",
    );
  }

  aBookingId = stay.id;

  const published = await storedGross(A_PRICED_NIGHT);

  if (published === null || PRICES.includes(published)) {
    throw new Error(
      `The seed published ${published} for ${A_PRICED_NIGHT}, which is one of ` +
        "the figures this file writes over it — a write that changes nothing " +
        "files nothing, so the cases below would assert against an empty log. " +
        "Move PRICES.",
    );
  }
}, 180_000);

beforeEach(async () => {
  // The guest goes first and the log second, and the order is the whole of it:
  // removing the guest is itself an audited change, so emptying the log before
  // it would leave the next case reading this one's tidying-up.
  await clearThisFilesGuest();

  // The log is the thing under test, so every case starts from an empty one and
  // asserts on everything in it rather than on a suffix it has to find.
  // `truncate` rather than a delete: by the time this file runs the log holds
  // every row the suite before it seeded, and a delete over those is a statement
  // that has to finish inside the pool's five seconds.
  await db.execute(sql`truncate audit_entry`);
});

afterAll(async () => {
  if (db) {
    await clearThisFilesGuest();
    // The entries before the accounts they name, for the reason the truncate
    // above gives.
    await db.delete(auditEntry);
    await db
      .delete(staffUser)
      .where(like(staffUser.email, `%${ACCOUNT_DOMAIN}`));
  }

  await app?.close();
});

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** Says the hold's browser is still open, exactly as the funnel's heartbeat
 *  does — one statement moving one column, through the runner so the trigger
 *  sees an actor or the absence of one. */
async function markPresence(): Promise<void> {
  await app.get(TransactionRunner).run((exec) =>
    exec
      .update(booking)
      .set({ lastSeenAt: new Date() })
      .where(eq(booking.id, aBookingId)),
  );
}

/** The guest this file registers a CCCD against, gone in both directions — the
 *  number is unique where it is present, so a leftover row would refuse the
 *  next run's insert. */
async function clearThisFilesGuest(): Promise<void> {
  await db
    .delete(guest)
    .where(
      inArray(guest.cccdNumber, [A_CCCD_NUMBER, THE_CORRECTED_CCCD_NUMBER]),
    );
}

/** Everything in the log for one table, oldest first. */
async function entriesFor(tableName: string) {
  return await db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.tableName, tableName))
    .orderBy(asc(auditEntry.occurredAt), asc(auditEntry.rowId));
}

/**
 * One snapshot as the characters Postgres holds.
 *
 * Read back as text on Postgres's side rather than off the parsed column, so a
 * đồng figure in it is never a JavaScript `number` in this process either — the
 * same rule the read path in `audit.service.ts` keeps for the same reason.
 */
async function snapshotText(
  entryId: string,
  side: "before" | "after",
): Promise<string | null> {
  const { rows } = await db.execute<{ state: string | null }>(sql`
    select ${sql.raw(`"${side}"`)}::text as state
    from audit_entry
    where id = ${entryId}::uuid
  `);

  return rows[0]!.state;
}

/**
 * One column of one snapshot, likewise as text.
 *
 * The key is cast rather than left for Postgres to infer: `->>` is defined over
 * both `text` and `integer` on the right, and an untyped parameter between two
 * candidates is an ambiguity the server refuses rather than guesses at.
 */
async function snapshotField(
  entryId: string,
  side: "before" | "after",
  column: string,
): Promise<string | null> {
  const { rows } = await db.execute<{ value: string | null }>(sql`
    select ${sql.raw(`"${side}"`)} ->> ${column}::text as value
    from audit_entry
    where id = ${entryId}::uuid
  `);

  return rows[0]!.value;
}

/** Every table this schema declares, by the name Postgres knows it as. */
function tablesInTheSchema(): string[] {
  return [
    ...new Set(
      Object.values(schema)
        .filter((exported) => is(exported, PgTable))
        .map((table) => getTableName(table as PgTable)),
    ),
  ].sort();
}

/** Every table the row-audit trigger is attached to, and how it fires. */
async function tablesWithTheTrigger(): Promise<Map<string, number>> {
  const { rows } = await db.execute<{ table_name: string; fires: number }>(sql`
    select c.relname as table_name, t.tgtype::int as fires
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = c.relnamespace
     where p.proname = 'audit_row_change'
       and n.nspname = 'public'
  `);

  return new Map(rows.map((row) => [row.table_name, Number(row.fires)]));
}

describe("the tables a change can happen to", () => {
  it("either files its own entries or is a table somebody decided about", async () => {
    const attached = await tablesWithTheTrigger();

    const unaccounted = tablesInTheSchema().filter(
      (table) => !attached.has(table) && !(table in NOT_PROTECTED),
    );

    expect(
      unaccounted,
      "A table in this schema neither files change-log entries nor appears in " +
        "the list of tables that deliberately do not. That is the hole NFR-09 " +
        "exists to close: rows of it can be inserted, updated and deleted with " +
        "nothing anywhere saying so. Attach the trigger, or add the table to " +
        "NOT_PROTECTED with the reason.",
    ).toEqual([]);
  });

  it("does not carry an exclusion for a table this schema no longer has", () => {
    // The other direction, and it is what stops a rename from carrying an
    // exclusion forward: `guest_profile` renamed to something else would leave
    // the old reason standing over a new, unprotected table.
    const declared = new Set(tablesInTheSchema());

    expect(
      Object.keys(NOT_PROTECTED).filter((table) => !declared.has(table)),
    ).toEqual([]);
  });

  it("files on an insert, an update and a delete alike, after the row has moved", async () => {
    const attached = await tablesWithTheTrigger();

    for (const [table, fires] of attached) {
      // Per row, because a statement-level trigger sees neither snapshot.
      expect(fires & FIRES_PER_ROW, table).toBe(FIRES_PER_ROW);
      // After, because a `BEFORE` trigger can be superseded by another one that
      // rewrites the row it has just filed.
      expect(fires & FIRES_BEFORE, table).toBe(0);
      expect(
        fires & (FIRES_ON_INSERT | FIRES_ON_UPDATE | FIRES_ON_DELETE),
        table,
      ).toBe(FIRES_ON_INSERT | FIRES_ON_UPDATE | FIRES_ON_DELETE);
    }

    // Vacuity: an empty map would satisfy every assertion in the loop above.
    expect(attached.size).toBeGreaterThanOrEqual(20);
  });
});

describe("who a change is filed against", () => {
  /** Opens an account, which is a change to `staff_user` and mentions no actor
   *  anywhere in the body. */
  async function openAnAccount(token: string, email: string): Promise<void> {
    await http()
      .post("/identity/staff-accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email,
        fullName: "Ngô Thị Lan",
        role: "RECEPTIONIST",
        password: "reception-password-42",
      })
      .expect(201);
  }

  it("names the administrator the guard resolved, on a route that names nobody", async () => {
    await openAnAccount(firstAdmin, `le.tan.mot${ACCOUNT_DOMAIN}`);

    const entries = await entriesFor("staff_user");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("INSERT");
    expect(entries[0]!.actorKind).toBe("staff");
    // The only place this id could have come from is the credential presented:
    // the request body carries an email, a name, a role and a password, and
    // nothing that could have chosen an actor.
    expect(entries[0]!.actorId).toBe(firstAdminId);
  });

  it("names the second administrator for the change the second one made", async () => {
    // The same body shape from a different credential. If the attribution were
    // read from anything other than the guard's decision — a header, a cached
    // principal, the last actor announced on the pooled connection — these two
    // would come back the same.
    await openAnAccount(firstAdmin, `le.tan.hai${ACCOUNT_DOMAIN}`);
    await openAnAccount(secondAdmin, `le.tan.ba${ACCOUNT_DOMAIN}`);

    const entries = await entriesFor("staff_user");

    expect(entries.map((entry) => entry.actorId)).toEqual([
      firstAdminId,
      secondAdminId,
    ]);
  });

  it("names nobody at all when nothing established an actor", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    // The state a sweep, a scheduled job, a gateway's callback and the seeder
    // are all in. The change happened and is recorded; what it must not do is
    // name an account, because an entry crediting somebody who did nothing is
    // an accusation where an entry crediting nobody is a fact.
    await transactions.run((exec) =>
      calendar.set(exec, {
        roomType: "DELUXE",
        from: parseDate(A_PRICED_NIGHT),
        to: parseDate(A_PRICED_NIGHT),
        grossPerNight: UNATTENDED_PRICE,
      }),
    );

    const entries = await entriesFor("rate_calendar");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorKind).toBe("system");
    expect(entries[0]!.actorId).toBeNull();
  });

  it("does not let one transaction's actor reach the next one on the connection", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    const reprice = (gross: bigint) =>
      transactions.run((exec) =>
        calendar.set(exec, {
          roomType: "DELUXE",
          from: parseDate(A_PRICED_NIGHT),
          to: parseDate(A_PRICED_NIGHT),
          grossPerNight: gross,
        }),
      );

    await withAuditActor({ staffUserId: firstAdminId }, () =>
      reprice(ATTRIBUTED_PRICE),
    );

    // The pool has ten connections and nothing else is running, so this second
    // transaction is overwhelmingly likely to be handed the same one. The
    // setting is released when a transaction ends and stated again when the next
    // one opens; if either half stopped being true, this entry would name the
    // administrator above.
    await reprice(FOLLOWING_PRICE);

    const entries = await entriesFor("rate_calendar");

    expect(entries.map((entry) => entry.actorId)).toEqual([
      firstAdminId,
      null,
    ]);
  });
});

describe("the entry and the change", () => {
  it("are one commit, so a rolled-back edit takes its entry with it", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    const before = await storedGross(A_PRICED_NIGHT);

    await expect(
      withAuditActor({ staffUserId: firstAdminId }, () =>
        transactions.run(async (exec) => {
          await calendar.set(exec, {
            roomType: "DELUXE",
            from: parseDate(A_PRICED_NIGHT),
            to: parseDate(A_PRICED_NIGHT),
            grossPerNight: A_REFUSED_PRICE,
          });

          // Whatever fails after a write — a sold-out night, a deadlock, a bug.
          throw new Error("the rest of the handler refused");
        }),
      ),
    ).rejects.toThrow("the rest of the handler refused");

    // Both halves are gone, which is the property. An entry surviving here would
    // name a price the property never charged.
    expect(await storedGross(A_PRICED_NIGHT)).toBe(before);
    expect(await entriesFor("rate_calendar")).toHaveLength(0);
  });
});

describe("a đồng figure in a snapshot", () => {
  it("comes back with every digit, having been a number in neither runtime", async () => {
    const transactions = app.get(TransactionRunner);
    const calendar = app.get(RateCalendarService);

    await transactions.run((exec) =>
      calendar.set(exec, {
        roomType: "DELUXE",
        from: parseDate(A_PRICED_NIGHT),
        to: parseDate(A_PRICED_NIGHT),
        grossPerNight: UNREPRESENTABLE_AS_NUMBER,
      }),
    );

    const [entry] = await entriesFor("rate_calendar");

    // Both sides of the comparison are read out of Postgres as text: the stored
    // column and the snapshot have to agree exactly, and the moment either is
    // parsed to a `number` this reads 9007199254740992.
    const stored = await storedGross(A_PRICED_NIGHT);

    expect(stored).toBe(UNREPRESENTABLE_AS_NUMBER);
    expect(await snapshotField(entry!.id, "after", "gross_per_night")).toBe(
      UNREPRESENTABLE_AS_NUMBER.toString(),
    );
  });
});

describe("a column the log withholds", () => {
  it("withholds a staff password digest while still recording the account", async () => {
    const password = "reception-password-44";

    await http()
      .post("/identity/staff-accounts")
      .set("Authorization", `Bearer ${firstAdmin}`)
      .send({
        email: `le.tan.bon${ACCOUNT_DOMAIN}`,
        fullName: "Vũ Minh Khoa",
        role: "RECEPTIONIST",
        password,
      })
      .expect(201);

    const [entry] = await entriesFor("staff_user");
    const snapshot = await snapshotText(entry!.id, "after");

    // The key stays, so a reader can see the log declines to carry it rather
    // than wondering whether the column exists.
    expect(await snapshotField(entry!.id, "after", "password_hash")).toBe(
      "withheld",
    );
    // And the account being opened, the role it was opened with and by whom are
    // all still there — the withholding is one column and not the row.
    expect(await snapshotField(entry!.id, "after", "role")).toBe(
      "RECEPTIONIST",
    );
    expect(snapshot).not.toContain(password);
    expect(snapshot).not.toContain("$argon2");
  });

  it("withholds a guest's CCCD number, which the viewer is not an unmask route for", async () => {
    await db.insert(guest).values({
      fullName: "Đặng Thu Hà",
      cccdNumber: A_CCCD_NUMBER,
    });

    const [entry] = await entriesFor("guest");
    const snapshot = await snapshotText(entry!.id, "after");

    expect(await snapshotField(entry!.id, "after", "cccd_number")).toBe(
      "withheld",
    );
    expect(
      snapshot,
      "The change log handed over an identity number. Reading one is its own " +
        "capability and is audited per call in cccd_unmask_audit; a viewer " +
        "printing it is that trail being bypassed.",
    ).not.toContain(A_CCCD_NUMBER);
    // The rest of the record is carried, so a name changed on a guest is still
    // an answerable question.
    expect(await snapshotField(entry!.id, "after", "full_name")).toBe(
      "Đặng Thu Hà",
    );
  });

  it("records a correction confined to it, carrying neither number", async () => {
    // The case the whole `withhold`/`ignore` split exists for. Masking before
    // the comparison rather than after would leave this reading `withheld`
    // against `withheld`, comparing equal, and filing nothing — so a guest's
    // identity number could be changed with nothing anywhere saying it had
    // been, which is the opposite of what `FR-GST-03` asks of this record.
    await db.insert(guest).values({
      fullName: "Đặng Thu Hà",
      cccdNumber: A_CCCD_NUMBER,
    });
    await db.execute(sql`truncate audit_entry`);

    await withAuditActor({ staffUserId: firstAdminId }, () =>
      app.get(TransactionRunner).run((exec) =>
        exec
          .update(guest)
          .set({ cccdNumber: THE_CORRECTED_CCCD_NUMBER })
          .where(eq(guest.cccdNumber, A_CCCD_NUMBER)),
      ),
    );

    const entries = await entriesFor("guest");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("UPDATE");
    // Who changed it is the half of the entry that survives the withholding,
    // and it is the half an investigation asks for first.
    expect(entries[0]!.actorKind).toBe("staff");
    expect(entries[0]!.actorId).toBe(firstAdminId);

    expect(await snapshotField(entries[0]!.id, "before", "cccd_number")).toBe(
      "withheld",
    );
    expect(await snapshotField(entries[0]!.id, "after", "cccd_number")).toBe(
      "withheld",
    );

    const before = await snapshotText(entries[0]!.id, "before");
    const after = await snapshotText(entries[0]!.id, "after");

    for (const number of [A_CCCD_NUMBER, THE_CORRECTED_CCCD_NUMBER]) {
      expect(before).not.toContain(number);
      expect(after).not.toContain(number);
    }
  });

  it("keeps a deleted row in the log and nowhere else", async () => {
    await db.insert(guest).values({
      fullName: "Đặng Thu Hà",
      cccdNumber: A_CCCD_NUMBER,
    });
    await db.delete(auditEntry);

    await clearThisFilesGuest();

    const [entry] = await entriesFor("guest");

    expect(entry!.action).toBe("DELETE");
    expect(entry!.after).toBeNull();
    expect(await snapshotField(entry!.id, "before", "full_name")).toBe(
      "Đặng Thu Hà",
    );
  });

});

describe("a column the log ignores", () => {
  it("files nothing for a heartbeat that moves only that column", async () => {
    // A hold's browser says it is still there every twenty seconds per open
    // funnel, and `booking.service.ts` deliberately leaves `updated_at` alone
    // for it: a guest looking at a page has not modified their booking. Counted
    // as a change it would be three entries a minute per funnel, each with two
    // whole booking snapshots in it, burying the room move and the cancellation.
    //
    // Twice, because the column is dropped from the comparison rather than
    // masked in it: the first sighting moves it from nothing to something and
    // the second from one instant to another, and neither is a change to the
    // booking.
    await markPresence();
    await markPresence();

    expect(await entriesFor("booking")).toHaveLength(0);
  });

  it("still carries its real value on an entry filed for something else", async () => {
    const transactions = app.get(TransactionRunner);

    // The rule is "this column does not by itself justify an entry", not "this
    // column is not in the log" and not "this table is not audited". The name is
    // one no generated fixture would produce, because a value that happened to
    // match the one already stored would leave the row unchanged and file
    // nothing — which is the right rule arriving where it is not wanted.
    const renamedTo = "Nguyễn Thị Hạnh · sửa trong bài kiểm tra";
    const seenAt = new Date();

    await transactions.run((exec) =>
      exec
        .update(booking)
        .set({ contactName: renamedTo, lastSeenAt: seenAt })
        .where(eq(booking.id, aBookingId)),
    );

    const [entry] = await entriesFor("booking");

    expect(entry!.action).toBe("UPDATE");
    expect(await snapshotField(entry!.id, "after", "contact_name")).toBe(
      renamedTo,
    );

    const lastSeen = await snapshotField(entry!.id, "after", "last_seen_at");

    // Not withheld — nothing about this column is secret, and an entry that
    // masked it would be answering a question nobody asked with a word that
    // means something else in this log.
    expect(lastSeen).not.toBe("withheld");
    expect(Date.parse(lastSeen!)).toBe(seenAt.getTime());
  });
});

describe("a table with no surrogate key", () => {
  it("is addressed by the name of the table, which is the whole of its address", async () => {
    // `system_config` pins its primary key to a boolean precisely so a second
    // row cannot exist, so there is no uuid for `audit_entry.row_id` to hold and
    // the derivation below is what it holds instead. Asserted against Postgres's
    // own evaluation rather than a literal, because the value is a rule and not
    // a number somebody picked.
    const [configured] = await db
      .select({ rate: systemConfig.serviceChargeRateBps })
      .from(systemConfig)
      .limit(1);

    const original = configured!.rate;

    await db
      .update(systemConfig)
      .set({ serviceChargeRateBps: original === 500 ? 600 : 500 });

    const [entry] = await entriesFor("system_config");

    const { rows } = await db.execute<{ address: string }>(
      sql`select md5('system_config')::uuid as address`,
    );

    expect(entry!.action).toBe("UPDATE");
    expect(entry!.rowId).toBe(rows[0]!.address);

    // Put back, because this row is the one every posting in the suite splits a
    // gross figure with and a file that leaves it moved fails a file that had
    // nothing to do with it.
    await db.update(systemConfig).set({ serviceChargeRateBps: original });
  });
});

/** The price the calendar actually holds, read past the API. */
async function storedGross(night: string): Promise<bigint | null> {
  const [deluxe] = await db
    .select({ id: schema.roomType.id })
    .from(schema.roomType)
    .where(eq(schema.roomType.code, "DELUXE"))
    .limit(1);

  const [row] = await db
    .select({ gross: rateCalendar.grossPerNight })
    .from(rateCalendar)
    .where(
      and(
        eq(rateCalendar.roomTypeId, deluxe!.id),
        eq(rateCalendar.stayDate, night),
      ),
    )
    .limit(1);

  return row?.gross ?? null;
}
