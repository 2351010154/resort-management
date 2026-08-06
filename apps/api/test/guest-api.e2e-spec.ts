// The guest routes, end to end — `FR-GST-03` over HTTP, against a real Postgres
// and the real capability guard.
//
// `guest-record.e2e-spec.ts` already proves what the service does: the mask is
// computed off whatever the column really holds, and the audit row and the read
// commit together. None of that says anything about the half of the requirement
// that only exists once there are routes, and that is what this file asserts:
//
// 1. **The record route is masked, always.** Not by default with a flag beside
//    it — there is no flag, and a query parameter somebody invents changes
//    nothing. The number leaves on one route and that route is governed by its
//    own matrix row.
// 2. **Each route is governed by the row it declares**, driven off the matrix
//    rather than off a list of roles written out here — `rbac-matrix.md` §4
//    asks for exactly that, and it is why the read route's expectation is
//    computed with `permits` rather than spelled out.
// 3. **A reveal leaves exactly one row behind, per call.** Attributed to the
//    session that made it and not to anything in the body, carrying the reason
//    the caller gave and the moment it happened. Two calls on one session are
//    two rows, because `screens.md` reads `FR-GST-03` as per field and per
//    visit.

import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { cccdUnmaskAudit, guest } from "../src/database/schema/guest.js";
import {
  type CapabilityKey,
  staffGrant,
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import {
  type CapabilityAction,
  permits,
} from "../src/modules/identity/rbac/roles.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

/** A uuid every id in these tables is drawn against, so it names no row. */
const NO_SUCH_GUEST = "00000000-0000-4000-8000-000000000000";

/** The person the read route is asked about. */
const READ_CCCD = "079301770001";

/** The person the manager reveals, twice. */
const REVEALED_CCCD = "079301770002";

/** The person the receptionist reveals, and the accountant may not. */
const CONDITIONAL_CCCD = "079301770003";

const MASKED = (cccd: string) => `${"*".repeat(cccd.length - 4)}${cccd.slice(-4)}`;

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role, because both rows are asserted against all five. */
const STAFF = {
  MANAGER: {
    email: "quan.ly@mariva.test",
    fullName: "Nguyễn Thị Hạnh",
    role: "MANAGER",
    password: "manager-password-42",
  },
  RECEPTIONIST: {
    email: "le.tan@mariva.test",
    fullName: "Phạm Văn Dũng",
    role: "RECEPTIONIST",
    password: "reception-password-42",
  },
  HOUSEKEEPING: {
    email: "buong.phong@mariva.test",
    fullName: "Lê Thị Thu",
    role: "HOUSEKEEPING",
    password: "housekeeping-password-42",
  },
  ACCOUNTANT: {
    email: "ke.toan@mariva.test",
    fullName: "Vũ Minh Khoa",
    role: "ACCOUNTANT",
    password: "accountant-password-42",
  },
  ADMIN: {
    email: "quan.tri@mariva.test",
    fullName: "Hoàng Anh Tuấn",
    role: "ADMIN",
    password: "admin-password-42",
  },
} as const satisfies Record<StaffRole, StaffAccount>;

/**
 * Both guest routes, with the matrix row and the action each declares.
 *
 * The action is here because the read route declares one: `guest.read-record`
 * is a row a role could hold 👁 over, and a test that assumed every route was a
 * write would agree with the guard by accident rather than by reading the same
 * rule it does.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post";
  readonly path: (guestId: string) => string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
}[] = [
  {
    name: "readRecord",
    method: "get",
    path: (id) => `/guests/${id}`,
    capability: "guest.read-record",
    action: "read",
  },
  {
    name: "unmaskCccd",
    method: "post",
    path: (id) => `/guests/${id}/cccd-reveals`,
    capability: "guest.unmask-cccd",
    action: "write",
  },
];

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
const tokens = new Map<StaffRole, string>();
const staffIds = new Map<StaffRole, string>();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate cccd_unmask_audit, registration, guest, staff_session, staff_user restart identity cascade`,
  );

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    const created = await staff.create({ ...account });

    staffIds.set(account.role, created.id);
    tokens.set(account.role, await signIn(account.email, account.password));
  }
}, 120_000);

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

/** A call as one member of staff. */
function as(
  role: StaffRole,
  method: "get" | "post",
  path: string,
  body: object = {},
): request.Test {
  return http()
    [method](path)
    .set("Authorization", `Bearer ${tokens.get(role)!}`)
    .send(body);
}

/**
 * A person the property has identified, written straight to the table.
 *
 * There is no route that creates one — a guest is created inside the check-in
 * transition — and arranging a whole stay to reach these two routes would make
 * a failure here mean any of a dozen things.
 */
async function identify(fullName: string, cccdNumber: string): Promise<string> {
  const [created] = await db
    .insert(guest)
    .values({
      fullName,
      cccdNumber,
      phone: "0901234567",
      dateOfBirth: "1993-01-04",
      nationality: "VN",
    })
    .returning({ id: guest.id });

  return created!.id;
}

/** Every recorded reading of one guest's number. */
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

describe("the capability each guest route declares", () => {
  // Every role is put to every route and the expectation is read off the
  // matrix, so a declaration changed without the document moving fails here.
  // The guest id names no row, so an admitted caller answers 404 and a refused
  // one answers 403 — no route can succeed and leave an audit entry behind.
  for (const route of ROUTES) {
    for (const role of STAFF_ROLES) {
      const admitted = permits(staffGrant(route.capability, role), route.action);

      it(`${admitted ? "admits" : "refuses"} ${role} on ${route.name}`, async () => {
        const response = await as(role, route.method, route.path(NO_SUCH_GUEST));

        if (admitted) {
          expect(response.status).not.toBe(403);
        } else {
          expect(response.status).toBe(403);
        }
      });
    }
  }

  it("refuses a stranger holding no session", async () => {
    // 401 and not 403 — nobody at all is asked to sign in first.
    for (const route of ROUTES) {
      await http()
        [route.method](route.path(NO_SUCH_GUEST))
        .send({})
        .expect(401);
    }
  });
});

describe("the guest record as the read route answers it", () => {
  let guestId: string;

  beforeAll(async () => {
    guestId = await identify("Đỗ Thị Lan", READ_CCCD);
  });

  it("masks the number, and carries nothing the whole number could hide in", async () => {
    const response = await as("RECEPTIONIST", "get", `/guests/${guestId}`).expect(
      200,
    );

    expect(response.body).toMatchObject({
      id: guestId,
      fullName: "Đỗ Thị Lan",
      cccdMasked: MASKED(READ_CCCD),
      nationality: "VN",
      // Nine characters, not an object of loose numbers — `NFR-12`'s crossing,
      // performed at the controller.
      dateOfBirth: "1993-01-04",
    });

    // The claim is about the whole answer and not about the field that was
    // expected to hold it: the number is nowhere in the response.
    expect(JSON.stringify(response.body)).not.toContain(READ_CCCD);
    expect(response.body).not.toHaveProperty("cccdNumber");

    expect(Date.parse(response.body.createdAt)).not.toBeNaN();
  });

  it("masks it for every role the row admits, not only the junior ones", async () => {
    // An admin is not trusted with the number by virtue of being an admin. The
    // masked record is what this route returns, and the reveal is a different
    // route with a different row — which is the whole of `FR-GST-03`'s split.
    for (const role of ["ACCOUNTANT", "MANAGER", "ADMIN"] as const) {
      const response = await as(role, "get", `/guests/${guestId}`).expect(200);

      expect(response.body.cccdMasked).toBe(MASKED(READ_CCCD));
      expect(JSON.stringify(response.body)).not.toContain(READ_CCCD);
    }
  });

  it("cannot be widened by a parameter a caller invents", async () => {
    // There is no flag and there is no query parameter. This is the regression
    // guard on that sentence: an option added later would have to change the
    // contract, and adding it there is a review somebody gets to have.
    const response = await as(
      "MANAGER",
      "get",
      `/guests/${guestId}?unmasked=true&reveal=1`,
    ).expect(200);

    expect(response.body.cccdMasked).toBe(MASKED(READ_CCCD));
    expect(JSON.stringify(response.body)).not.toContain(READ_CCCD);

    // And nothing was recorded, because nothing was revealed.
    expect(await auditFor(guestId)).toHaveLength(0);
  });

  it("answers 404 for a guest nobody identified", async () => {
    await as("RECEPTIONIST", "get", `/guests/${NO_SUCH_GUEST}`).expect(404);
  });
});

describe("revealing the number on the audited route", () => {
  let guestId: string;

  beforeAll(async () => {
    guestId = await identify("Trần Văn Sơn", REVEALED_CCCD);
  });

  it("returns the number and records one reading of it", async () => {
    const before = Date.now();

    const response = await as(
      "MANAGER",
      "post",
      `/guests/${guestId}/cccd-reveals`,
      { reason: "police residence declaration" },
    ).expect(200);

    expect(response.body).toMatchObject({
      guestId,
      cccdNumber: REVEALED_CCCD,
      unmaskedBy: staffIds.get("MANAGER"),
    });

    // An instant, and one a client can read as a time rather than as an object.
    expect(Date.parse(response.body.unmaskedAt)).not.toBeNaN();

    const trail = await auditFor(guestId);

    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      unmaskedBy: staffIds.get("MANAGER"),
      reason: "police residence declaration",
    });
    expect(trail[0]!.unmaskedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  it("records a second look on the same session as a second row", async () => {
    // Per call, not per session. A session-scoped entry would answer "has
    // anyone seen this"; the question an investigation asks is who, and how
    // often — and the same person looking twice is two answers.
    await as("MANAGER", "post", `/guests/${guestId}/cccd-reveals`).expect(200);

    const trail = await auditFor(guestId);

    expect(trail).toHaveLength(2);
    // The reason is optional, and left empty rather than filled in — the
    // attribution is what makes the reading accountable.
    expect(trail.filter((entry) => entry.reason === null)).toHaveLength(1);
  });

  it("still answers the read route with the number masked", async () => {
    // No sticky state: the capability is checked per call and so is the audit,
    // so a guest whose number was revealed a moment ago reads like anybody else.
    const response = await as("MANAGER", "get", `/guests/${guestId}`).expect(200);

    expect(response.body.cccdMasked).toBe(MASKED(REVEALED_CCCD));
    expect(JSON.stringify(response.body)).not.toContain(REVEALED_CCCD);
  });
});

describe("who the audit row accuses", () => {
  let guestId: string;

  beforeAll(async () => {
    guestId = await identify("Bùi Quốc Việt", CONDITIONAL_CCCD);
  });

  it("refuses a role holding the record row but not the reveal row", async () => {
    // An accountant reads guest records in full and may not unmask one. The two
    // rows are the reason there are two routes, and this is that sentence as a
    // status code.
    await as("ACCOUNTANT", "get", `/guests/${guestId}`).expect(200);
    await as(
      "ACCOUNTANT",
      "post",
      `/guests/${guestId}/cccd-reveals`,
      { reason: "reconciling a folio" },
    ).expect(403);

    expect(await auditFor(guestId)).toHaveLength(0);
  });

  it("names the session that called it and not an id the body stated", async () => {
    // A `⚠` grant on this row leaves the audit owing and nothing else, so a
    // receptionist is admitted. What the body may not decide is who gets
    // recorded: an attribution a caller can state is an attribution a caller
    // can choose.
    const response = await as(
      "RECEPTIONIST",
      "post",
      `/guests/${guestId}/cccd-reveals`,
      { reason: "guest lost their card", unmaskedBy: staffIds.get("ADMIN") },
    ).expect(200);

    expect(response.body.unmaskedBy).toBe(staffIds.get("RECEPTIONIST"));

    const trail = await auditFor(guestId);

    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      unmaskedBy: staffIds.get("RECEPTIONIST"),
      reason: "guest lost their card",
    });
  });
});
