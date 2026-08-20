// The change log over HTTP — `FR-AUD-02`'s two routes, against a real Postgres,
// the real capability guard and real sessions.
//
// `audit-trail.e2e-spec.ts` proves that the property's writers file entries at
// all; this file is about who may read them back and what comes out when they
// do:
//
// 1. **Both routes are governed by the matrix row they declare**, driven off
//    `CAPABILITIES` rather than off a list written here — `rbac-matrix.md` §4's
//    own instruction. Both are asked with `permits(grant, "read")`, because both
//    declare themselves reads and the row hands `ACCOUNTANT` a `⚠` rather than a
//    `✅`.
// 2. **"ACC: financial entries only" is enforced, and it is enforced off the
//    grant.** The proof is empirical rather than structural: two entries are
//    filed against two tables the property really audits — `rate_calendar`,
//    which is what a night is sold at, and `stay_restriction`, which is a
//    minimum-stay rule with no đồng in it — and the accountant sees the first
//    and not the second while the manager sees both. The detail route is held to
//    the same line: the entry the accountant may not list is not one they may
//    open by id either.
// 3. **A đồng amount does not lose a digit between the snapshot and the wire.**
//    The sharpest thing this module promises. `audit.service.ts` refuses to let
//    the driver parse `jsonb` on the way in, and the read half refuses to let it
//    parse on the way out; the case below stores a stay total larger than
//    `Number.MAX_SAFE_INTEGER` and asserts the route hands back the same
//    seventeen digits. Parsed into a JavaScript `number` anywhere along the way,
//    the last of them changes — which is a change log that misreports the change
//    it exists to record.
// 4. **The unattended writers stay visible.** `audit_actor_kind` admits a row
//    with no member of staff behind it, and a list that joined the actor's name
//    the obvious way would drop every one of them. The system entry below is
//    what holds the join to being a left one.
//
// The routes are reached through `AppModule` and nothing is registered here, so
// this suite fails if `audit.module.ts` ever stops carrying the controller —
// which is the point of booting the real graph rather than a hand-built one.
//
// The entries are inserted directly, with the snapshots cast from text. That is
// not a shortcut around the write path: what is under test is the read, and
// driving five different services through five different funnels to produce five
// rows would put every one of their preconditions in the way of an assertion
// about a list. The one thing the insert must not do is hand the driver an
// object to serialise, because that is the crossing this whole file exists to
// prove nobody makes — in production the snapshots are written by a trigger and
// never cross into this process at all.

import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { type Database, DRIZZLE } from "../../src/database/database.module.js";
import { auditEntry } from "../../src/database/schema/audit.js";
import { staffUser } from "../../src/database/schema/identity.js";
import {
  capability,
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../../src/modules/identity/rbac/matrix.js";
import {
  type CapabilityAction,
  permits,
} from "../../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../../src/modules/identity/staff-user.service.js";

/** A uuid no row has. */
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * A stay total with more significant digits than a JavaScript `number` can
 * hold.
 *
 * Seventeen of them, where `Number.MAX_SAFE_INTEGER` runs out at sixteen. Read
 * through a `number` at any point between the column and the assertion, the last
 * digit comes back a `0` — so this figure is the whole of the precision case,
 * and it is a plausible one: đồng are not divided, and a property's annual
 * takings run to eleven digits before anybody has done anything unusual.
 */
const AN_UNROUNDABLE_AMOUNT = "12345678901234567";

/** What the same figure becomes if anything parses it. Asserted against rather
 *  than merely avoided, so a regression names itself. */
const WHAT_A_NUMBER_WOULD_MAKE_OF_IT = String(
  Number(AN_UNROUNDABLE_AMOUNT),
);

/** The tables the entries below are filed against. The first is money and the
 *  second is not, which is the whole of the narrowing under test. */
const FINANCIAL_TABLE = "rate_calendar";
const OPERATIONAL_TABLE = "stay_restriction";

/** The rows the entries are about. Nothing joins to them — an audit entry
 *  addresses a row that may since have been deleted, which is most of the point
 *  of the table. */
const A_PRICED_NIGHT = "11111111-1111-4111-8111-111111111111";
const A_RESTRICTED_NIGHT = "22222222-2222-4222-8222-222222222222";
const A_SWEPT_ROW = "33333333-3333-4333-8333-333333333333";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because the matrix row is asserted against all
 *  five. */
const STAFF = {
  MANAGER: {
    email: "nhat.ky.quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "nhat.ky.le.tan@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "nhat.ky.buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "nhat.ky.ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "nhat.ky.quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

const EMAILS = Object.values(STAFF).map((account) => account.email);

/** One change as the list draws it. */
interface LoggedChange {
  readonly id: string;
  readonly actorKind: "staff" | "system";
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly occurredAt: string;
  readonly tableName: string;
  readonly rowId: string;
  readonly action: "INSERT" | "UPDATE" | "DELETE";
}

interface ChangedField {
  readonly column: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly changed: boolean;
}

type LoggedChangeDetail = LoggedChange & {
  readonly fields: readonly ChangedField[];
};

interface ChangePage {
  readonly entries: readonly LoggedChange[];
  readonly total: number;
  readonly scope: "financial" | "everything";
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;

const tokens = new Map<string, string>();

/** The manager, who is the actor on every staff entry below. */
let managerId: string;

/** The entries this file files, kept so the assertions can name them. */
let pricedEntryId: string;
let restrictedEntryId: string;
let sweptEntryId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await clearTheLog();

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.email, await signIn(account.email, account.password));
  }

  managerId = await staffIdOf(STAFF.MANAGER.email);

  pricedEntryId = await aStaffChange(
    FINANCIAL_TABLE,
    A_PRICED_NIGHT,
    `{"id": "${A_PRICED_NIGHT}", "stay_date": "2027-09-15", "price_gross": 1200000}`,
    `{"id": "${A_PRICED_NIGHT}", "stay_date": "2027-09-15", "price_gross": ${AN_UNROUNDABLE_AMOUNT}}`,
  );

  restrictedEntryId = await aStaffChange(
    OPERATIONAL_TABLE,
    A_RESTRICTED_NIGHT,
    `{"id": "${A_RESTRICTED_NIGHT}", "stay_date": "2027-09-15", "min_stay": 1}`,
    `{"id": "${A_RESTRICTED_NIGHT}", "stay_date": "2027-09-15", "min_stay": 3}`,
  );

  sweptEntryId = await aSystemChange(
    FINANCIAL_TABLE,
    A_SWEPT_ROW,
    `{"id": "${A_SWEPT_ROW}", "stay_date": "2027-09-16", "price_gross": 900000}`,
  );
}, 120_000);

afterAll(async () => {
  await clearTheLog();
  await app?.close();
});

/**
 * The whole log, and then this file's accounts.
 *
 * The whole of it rather than the three rows below, because every protected
 * table files its own entries now: a suite that has seeded a year of rates has
 * left thousands of `rate_calendar` entries behind, and the narrowings asserted
 * here — one `INSERT` against that table, one entry against `stay_restriction` —
 * are counts over a log this file has to own outright. `fileParallelism: false`
 * is what makes owning it available; nothing else is reading it while this runs.
 *
 * The entries go first, because each staff one names an account behind a foreign
 * key with no `onDelete` — an account cannot be deleted out from under the trail
 * that names it, which `schema/audit.ts` states as a rule rather than as an
 * inconvenience.
 */
async function clearTheLog(): Promise<void> {
  await db.execute(sql`truncate audit_entry`);
  await db.delete(staffUser).where(inArray(staffUser.email, EMAILS));
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A call as one member of staff. Both routes are `GET`, so the arguments go in
 *  the query string. */
function as(role: StaffRole, path: string, query: object = {}): request.Test {
  return http()
    .get(path)
    .set("Authorization", `Bearer ${tokens.get(STAFF[role].email)!}`)
    .query(query);
}

/**
 * When the log says an entry was filed.
 *
 * Read back out of the route rather than held from the insert, because the
 * column is defaulted by Postgres and the only instant the window tests may
 * compare against is the one the reader is actually shown.
 */
async function occurredAtOf(entryId: string): Promise<string> {
  const response = await as("MANAGER", `/audit-entries/${entryId}`).expect(200);

  return (response.body as LoggedChangeDetail).occurredAt;
}

async function staffIdOf(email: string): Promise<string> {
  const [row] = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(inArray(staffUser.email, [email]));

  return row!.id;
}

/**
 * One change filed against the manager, with both snapshots cast from text.
 *
 * `::jsonb` and never a bound object: an object handed to the driver is
 * serialised by `JSON.stringify` from values the driver parsed, and the đồng
 * amount above would not survive the round trip. A string that is never looked
 * at cannot lose a digit.
 */
async function aStaffChange(
  tableName: string,
  rowId: string,
  before: string,
  after: string,
): Promise<string> {
  const filed = await db.execute<{ id: string }>(sql`
    insert into audit_entry
      (actor_kind, actor_id, table_name, row_id, action, "before", "after")
    values (
      'staff'::audit_actor_kind,
      ${managerId}::uuid,
      ${tableName},
      ${rowId}::uuid,
      'UPDATE'::audit_action,
      ${before}::jsonb,
      ${after}::jsonb
    )
    returning id
  `);

  return filed.rows[0]!.id;
}

/** One change with nobody behind it — a sweep, a scheduled job, a gateway's
 *  callback. `audit_entry_actor_check` demands the actor be absent on exactly
 *  these. */
async function aSystemChange(
  tableName: string,
  rowId: string,
  after: string,
): Promise<string> {
  const filed = await db.execute<{ id: string }>(sql`
    insert into audit_entry
      (actor_kind, actor_id, table_name, row_id, action, "before", "after")
    values (
      'system'::audit_actor_kind,
      null,
      ${tableName},
      ${rowId}::uuid,
      'INSERT'::audit_action,
      null,
      ${after}::jsonb
    )
    returning id
  `);

  return filed.rows[0]!.id;
}

/** Both routes, with the matrix row each declares and what it does with it. */
const ROUTES: readonly {
  readonly name: string;
  readonly path: string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "list",
    path: "/audit-entries",
    capability: "audit.read",
    action: "read",
  },
  {
    name: "read",
    path: `/audit-entries/${ABSENT_ID}`,
    capability: "audit.read",
    action: "read",
  },
];

describe("the capability each audit route declares", () => {
  // §4's obligation for the row these routes add. The detail route names a uuid
  // no row has, so the furthest an admitted caller gets is a 404 about an entry
  // that does not exist — which is not a 403 and is what the assertion turns
  // on.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.path);

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong role is refused.
    for (const route of ROUTES) {
      await http().get(route.path).expect(401);
    }
  });

  it("names only a row the matrix already has", () => {
    // The guard types the decorator's first argument against the matrix, so an
    // invented key would not compile. This asserts the other half — that the row
    // is the one these routes are meant to be under, and that it is not a key
    // some later edit renamed out from under them.
    for (const route of ROUTES) {
      expect(capability(route.capability).section).toBe("Reports and audit");
      expect(capability(route.capability).row).toBe("Audit log viewer");
    }
  });
});

describe("reading the whole log", () => {
  it("hands a manager both changes and says the answer is unnarrowed", async () => {
    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      rowId: A_PRICED_NIGHT,
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.scope).toBe("everything");
    expect(page.total).toBe(1);
    expect(page.entries[0]!.id).toBe(pricedEntryId);
    expect(page.entries[0]!.tableName).toBe(FINANCIAL_TABLE);
  });

  it("names the member of staff behind a change", async () => {
    // A column of uuids does not say who was answerable, which is the whole
    // reason the log exists.
    const response = await as("ADMIN", "/audit-entries", {
      tableName: OPERATIONAL_TABLE,
      rowId: A_RESTRICTED_NIGHT,
    }).expect(200);

    const [change] = (response.body as ChangePage).entries;

    expect(change!.actorKind).toBe("staff");
    expect(change!.actorId).toBe(managerId);
    expect(change!.actorName).toBe(STAFF.MANAGER.fullName);
  });

  it("keeps the changes nobody made, which name nobody", async () => {
    // The left join holding. An inner one would drop every unattended write out
    // of the log while looking like a working list.
    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      rowId: A_SWEPT_ROW,
    }).expect(200);

    const [swept] = (response.body as ChangePage).entries;

    expect(swept!.id).toBe(sweptEntryId);
    expect(swept!.actorKind).toBe("system");
    expect(swept!.actorId).toBeNull();
    expect(swept!.actorName).toBeNull();
  });

  it("narrows to one shape of change when asked", async () => {
    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      action: "INSERT",
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.entries.map((change) => change.id)).toEqual([sweptEntryId]);
  });

  it("narrows to one member of staff when asked", async () => {
    // The manager's own change and not the sweep beside it, which is the pair
    // worth asserting: the actor filter runs over the same left join that keeps
    // unattended writes in the log, and a filter written against the joined
    // account rather than the entry's own column would drop them from every
    // answer instead of only from this one.
    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      actorId: managerId,
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.entries.map((change) => change.id)).toEqual([pricedEntryId]);
    expect(page.total).toBe(1);
  });

  it("holds a change filed at the instant the window opens", async () => {
    // The window's own boundary, read off the entry rather than off a clock, so
    // the assertion is about `from` being inclusive and not about how long the
    // fixtures took to file. Its pair below asks the same instant of `to`, and
    // the two together are what pin a half-open window: a change is in exactly
    // one of the two answers, never both and never neither.
    const filed = await occurredAtOf(pricedEntryId);

    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      rowId: A_PRICED_NIGHT,
      from: filed,
    }).expect(200);

    expect((response.body as ChangePage).entries.map((c) => c.id)).toEqual([
      pricedEntryId,
    ]);
  });

  it("leaves out a change filed at the instant the window closes", async () => {
    const filed = await occurredAtOf(pricedEntryId);

    const response = await as("MANAGER", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      rowId: A_PRICED_NIGHT,
      to: filed,
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("counts under the same predicate it cut the page from", async () => {
    // A pager offering a last page needs the count to be about the same set the
    // page came from; a list of one under a heading that says three is how a
    // reader learns not to trust either figure.
    const response = await as("MANAGER", "/audit-entries", {
      tableName: OPERATIONAL_TABLE,
      limit: 1,
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.entries).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it("refuses a row id with no table beside it", async () => {
    // The contract's refusal reaching a caller as a 400 rather than as a scan.
    await as("MANAGER", "/audit-entries", { rowId: A_PRICED_NIGHT }).expect(400);
  });
});

describe("the accountant's log", () => {
  it("holds the change to what a night is sold at", async () => {
    const response = await as("ACCOUNTANT", "/audit-entries", {
      tableName: FINANCIAL_TABLE,
      rowId: A_PRICED_NIGHT,
    }).expect(200);

    const page = response.body as ChangePage;

    expect(page.entries.map((change) => change.id)).toEqual([pricedEntryId]);
  });

  it("says the answer is narrowed rather than leaving it to be guessed", async () => {
    // A short list is a quiet fortnight or a scoped one, and a reader handed no
    // scope has no way to tell them apart.
    const response = await as("ACCOUNTANT", "/audit-entries").expect(200);

    expect((response.body as ChangePage).scope).toBe("financial");
  });

  it("does not hold a change a manager can see", async () => {
    // The narrowing, proved against the two roles rather than asserted about
    // one. A minimum stay is a commercial rule with no đồng in it, and the
    // matrix denies the accountant that row on its own screen — so the viewer
    // may not be the side door to it.
    const theirs = await as("ACCOUNTANT", "/audit-entries", {
      tableName: OPERATIONAL_TABLE,
      rowId: A_RESTRICTED_NIGHT,
    }).expect(200);

    expect((theirs.body as ChangePage).entries).toHaveLength(0);
    expect((theirs.body as ChangePage).total).toBe(0);

    const managers = await as("MANAGER", "/audit-entries", {
      tableName: OPERATIONAL_TABLE,
      rowId: A_RESTRICTED_NIGHT,
    }).expect(200);

    expect((managers.body as ChangePage).entries).toHaveLength(1);
  });

  it("intersects the filters they typed rather than refusing them", async () => {
    // An accountant reaching a table outside their scope gets an empty page and
    // not a 403: the scope is a predicate beside what they asked for, and
    // answering with a refusal would be telling somebody they may not ask a
    // question this route was about to answer anyway.
    const response = await as("ACCOUNTANT", "/audit-entries", {
      tableName: OPERATIONAL_TABLE,
    });

    expect(response.status).toBe(200);
    expect((response.body as ChangePage).total).toBe(0);
  });

  it("cannot open by id an entry it cannot list", async () => {
    // The same predicate on the other route. Without it the narrowing would be
    // a list filter with a second door beside it.
    await as("ACCOUNTANT", `/audit-entries/${restrictedEntryId}`).expect(404);

    await as("MANAGER", `/audit-entries/${restrictedEntryId}`).expect(200);
  });

  it("opens the financial entry it can list", async () => {
    const response = await as(
      "ACCOUNTANT",
      `/audit-entries/${pricedEntryId}`,
    ).expect(200);

    expect((response.body as LoggedChangeDetail).id).toBe(pricedEntryId);
  });
});

describe("what actually changed", () => {
  it("hands back every column of the row, in a stable order", async () => {
    const response = await as(
      "MANAGER",
      `/audit-entries/${pricedEntryId}`,
    ).expect(200);

    const detail = response.body as LoggedChangeDetail;
    const columns = detail.fields.map((field) => field.column);

    // The union of the two snapshots, by name. `jsonb` stores keys by length
    // and then bytewise, so the table's own column order did not survive
    // `to_jsonb` and alphabetical is the only order that is the same twice.
    expect(columns).toEqual(["id", "price_gross", "stay_date"]);
  });

  it("marks the column somebody touched and leaves the rest alone", async () => {
    const response = await as(
      "MANAGER",
      `/audit-entries/${pricedEntryId}`,
    ).expect(200);

    const detail = response.body as LoggedChangeDetail;
    const changed = detail.fields.filter((field) => field.changed);

    expect(changed.map((field) => field.column)).toEqual(["price_gross"]);
  });

  it("does not lose a digit of a đồng amount on the way to the wire", async () => {
    // The sharpest thing this module promises. Postgres `jsonb` numbers are
    // arbitrary precision; a JavaScript `number` is not. The service never
    // selects the snapshot as a column and Postgres renders the value as text
    // with `->>`, so this figure passes through no numeric type in either
    // runtime.
    const response = await as(
      "MANAGER",
      `/audit-entries/${pricedEntryId}`,
    ).expect(200);

    const detail = response.body as LoggedChangeDetail;
    const price = detail.fields.find((field) => field.column === "price_gross");

    expect(price!.after).toBe(AN_UNROUNDABLE_AMOUNT);
    // Named rather than merely avoided, so a regression says what happened to
    // it instead of failing on an opaque mismatch.
    expect(price!.after).not.toBe(WHAT_A_NUMBER_WOULD_MAKE_OF_IT);
    expect(price!.before).toBe("1200000");
  });

  it("leaves every previous value null on a change that created the row", async () => {
    // `audit_entry_action_matches_states` is what makes that reliable rather
    // than conventional: an `INSERT` carrying a previous state is a row this
    // schema cannot hold.
    const response = await as(
      "MANAGER",
      `/audit-entries/${sweptEntryId}`,
    ).expect(200);

    const detail = response.body as LoggedChangeDetail;

    expect(detail.action).toBe("INSERT");
    expect(detail.fields.every((field) => field.before === null)).toBe(true);
    expect(detail.fields.every((field) => field.changed)).toBe(true);
  });

  it("answers no such entry for an id no row has", async () => {
    await as("MANAGER", `/audit-entries/${ABSENT_ID}`).expect(404);
  });
});
