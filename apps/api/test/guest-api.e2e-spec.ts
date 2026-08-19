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
// 4. **The desk's transcription reaches the record and comes back masked** —
//    `FR-GST-02`. It is the same claim as (1) from the writing side: a route
//    that records a number is not a route that shows one, and what it stores is
//    proved by reading the column rather than by trusting the answer. The
//    particulars arrive as typed text and nothing else does; `NFR-08` is held
//    structurally by `nfr-08-no-id-scan-storage.spec.ts`, and what this file
//    adds is that the flow works without an image ever being part of it.
//
// The guest realm is refused all three, with a real session rather than an
// invented header — `NFR-07` is a claim about authority, and a 401 from a
// missing cookie would prove nothing about it.

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
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";

/** A uuid every id in these tables is drawn against, so it names no row. */
const NO_SUCH_GUEST = "00000000-0000-4000-8000-000000000000";

/** The person the read route is asked about. */
const READ_CCCD = "079301770001";

/** The person the manager reveals, twice. */
const REVEALED_CCCD = "079301770002";

/** The person the receptionist reveals, and the accountant may not. */
const CONDITIONAL_CCCD = "079301770003";

/** The number the desk types onto a record that arrived without one. */
const TRANSCRIBED_CCCD = "079301770004";

/** The one a second guest is refused, because the first already carries it. */
const TAKEN_CCCD = "079301770005";

/** A guest account with a session on it, for the realm the row denies. */
const GUEST_EMAIL = "khach@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

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
 * Every guest route, with the matrix row and the action each declares.
 *
 * The action is here because the read route declares one: `guest.read-record`
 * is a row a role could hold 👁 over, and a test that assumed every route was a
 * write would agree with the guard by accident rather than by reading the same
 * rule it does.
 *
 * The body is here for the transcription, which refuses an empty one before it
 * has looked for the guest: an authority test that sent nothing would be
 * reading a `400` where it means to read the absence of a `403`, and would go
 * on passing if the route stopped checking the row at all.
 */
const ROUTES: readonly {
  readonly name: string;
  readonly method: "get" | "post";
  readonly path: (guestId: string) => string;
  readonly capability: CapabilityKey;
  readonly action: CapabilityAction;
  readonly body?: object;
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
  {
    name: "transcribeDocument",
    method: "post",
    path: (id) => `/guests/${id}/document-particulars`,
    capability: "guest.id-scan.upload",
    action: "write",
    body: { nationality: "VN" },
  },
];

/** Captures what would have been sent, so the guest's verification link can be
 *  followed the way a guest follows it out of an inbox. */
class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  linkTo(address: string): string {
    const email = [...this.sent].reverse().find((sent) => sent.to === address);

    if (!email) {
      throw new Error(`No email was sent to ${address}`);
    }

    const link = /https?:\/\/\S+/.exec(email.text)?.[0];

    if (!link) {
      throw new Error(`No link in the email to ${address}`);
    }

    return link;
  }
}

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let mailer: RecordingMailer;
const tokens = new Map<StaffRole, string>();
const staffIds = new Map<StaffRole, string>();

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(
    sql`truncate cccd_unmask_audit, registration, guest, staff_session, staff_user, guest_user, guest_session, guest_account, guest_verification restart identity cascade`,
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

/**
 * A guest the property has a name for and no document from.
 *
 * The record `FR-GST-02`'s route exists for. `schema/guest.ts` describes how one
 * arrives — a second occupant registered on the first guest's word, a companion
 * with no card on them — and check-in names such a guest by id ever after, so
 * the particulars typed beside that id have nowhere to go without this route.
 */
async function registerWithoutADocument(fullName: string): Promise<string> {
  const [created] = await db
    .insert(guest)
    .values({ fullName })
    .returning({ id: guest.id });

  return created!.id;
}

/** The row as the database holds it, number and all. */
async function storedGuest(guestId: string) {
  const [row] = await db
    .select({
      cccdNumber: guest.cccdNumber,
      dateOfBirth: guest.dateOfBirth,
      nationality: guest.nationality,
      fullName: guest.fullName,
      updatedAt: guest.updatedAt,
    })
    .from(guest)
    .where(eq(guest.id, guestId));

  return row!;
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
        const response = await as(
          role,
          route.method,
          route.path(NO_SUCH_GUEST),
          route.body,
        );

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
        .send(route.body ?? {})
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

describe("recording what a document said", () => {
  const PATH = (guestId: string) => `/guests/${guestId}/document-particulars`;

  it("puts a number on a record that arrived without one, and answers masked", async () => {
    const guestId = await registerWithoutADocument("Ngô Thị Bích");

    const response = await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: TRANSCRIBED_CCCD,
      dateOfBirth: "1988-11-02",
      nationality: "VN",
    }).expect(200);

    expect(response.body).toMatchObject({
      id: guestId,
      fullName: "Ngô Thị Bích",
      cccdMasked: MASKED(TRANSCRIBED_CCCD),
      // Nine characters, not an object of loose numbers — `NFR-12`'s crossing,
      // performed at the controller on the way back out.
      dateOfBirth: "1988-11-02",
      nationality: "VN",
    });

    // The route that writes the number answers exactly as the route that reads
    // it does: masked, with no field the digits could travel in. Recording a
    // number is not being shown one.
    expect(JSON.stringify(response.body)).not.toContain(TRANSCRIBED_CCCD);
    expect(response.body).not.toHaveProperty("cccdNumber");

    // What the column holds, rather than what the response claims about it.
    expect(await storedGuest(guestId)).toMatchObject({
      cccdNumber: TRANSCRIBED_CCCD,
      dateOfBirth: "1988-11-02",
      nationality: "VN",
    });
  });

  it("leaves alone the facts the document was not read for", async () => {
    const guestId = await registerWithoutADocument("Hà Văn Cường");

    await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: "079301770010",
      nationality: "VN",
    }).expect(200);

    // A second reading that names one fact. The other two are absent, which is
    // the document not carrying them — not an instruction about the columns.
    const response = await as("MANAGER", "post", PATH(guestId), {
      dateOfBirth: "1975-06-30",
    }).expect(200);

    expect(response.body).toMatchObject({
      cccdMasked: MASKED("079301770010"),
      dateOfBirth: "1975-06-30",
      nationality: "VN",
    });
  });

  it("moves the timestamp a record's corrections are read from", async () => {
    const guestId = await registerWithoutADocument("Lý Thị Duyên");
    const before = await storedGuest(guestId);

    await as("RECEPTIONIST", "post", PATH(guestId), {
      nationality: "VN",
    }).expect(200);

    const after = await storedGuest(guestId);

    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
  });

  it("corrects a transposed digit, and repeating one reading changes nothing", async () => {
    const guestId = await registerWithoutADocument("Trịnh Văn Em");

    await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: "079301770021",
    }).expect(200);

    const corrected = await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: "079301770012",
    }).expect(200);

    expect(corrected.body.cccdMasked).toBe(MASKED("079301770012"));

    // Sent again, which is what a desk does with a connection it never saw
    // answer. A row does not collide with its own value, so this is a `200`
    // and not the conflict below.
    const repeated = await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: "079301770012",
    }).expect(200);

    expect(repeated.body.cccdMasked).toBe(MASKED("079301770012"));
    expect((await storedGuest(guestId)).cccdNumber).toBe("079301770012");
  });

  it("refuses a number another guest already carries", async () => {
    const first = await identify("Phan Thị Giang", TAKEN_CCCD);
    const second = await registerWithoutADocument("Phan Thị Hằng");

    const response = await as("RECEPTIONIST", "post", PATH(second), {
      cccdNumber: TAKEN_CCCD,
    }).expect(409);

    // The refusal is not a fault: the property has met this person before, and
    // what the desk does next is check the digits or use the record it already
    // has. The message says which.
    expect(JSON.stringify(response.body)).toContain("met this person before");

    // Neither row moved. The first guest keeps the number and the second gains
    // nothing — a partial write here would be one person's identity landing on
    // another's record.
    expect((await storedGuest(first)).cccdNumber).toBe(TAKEN_CCCD);
    expect((await storedGuest(second)).cccdNumber).toBeNull();
  });

  it("refuses a body that clears a fact, and one that records none", async () => {
    const guestId = await registerWithoutADocument("Vương Văn Ích");

    // `null` is the clearing this route has no spelling for: a statutory record
    // does not lose what Điều 44 obliged the property to take.
    await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: null,
    }).expect(400);

    // An empty transcription is a reading nobody performed, refused rather than
    // answered `200` by a handler that wrote nothing.
    await as("RECEPTIONIST", "post", PATH(guestId), {}).expect(400);

    // A name is not a particular read off a document, and the strict shape
    // refuses it rather than dropping it — the desk would otherwise read the
    // `200` as having corrected the name.
    await as("RECEPTIONIST", "post", PATH(guestId), {
      fullName: "Somebody Else",
      nationality: "VN",
    }).expect(400);

    expect(await storedGuest(guestId)).toMatchObject({
      fullName: "Vương Văn Ích",
      cccdNumber: null,
      nationality: null,
    });
  });

  it("answers 404 for a guest nobody identified", async () => {
    await as("RECEPTIONIST", "post", PATH(NO_SUCH_GUEST), {
      cccdNumber: "079301770099",
    }).expect(404);
  });

  it("still hands the number back only on the audited route", async () => {
    const guestId = await registerWithoutADocument("Đặng Thị Kim");

    await as("RECEPTIONIST", "post", PATH(guestId), {
      cccdNumber: "079301770030",
    }).expect(200);

    // Writing a number down is not reading one, so nothing is in the trail.
    expect(await auditFor(guestId)).toHaveLength(0);

    const revealed = await as(
      "MANAGER",
      "post",
      `/guests/${guestId}/cccd-reveals`,
      { reason: "police residence declaration" },
    ).expect(200);

    expect(revealed.body.cccdNumber).toBe("079301770030");
    expect(await auditFor(guestId)).toHaveLength(1);
  });
});

describe("a guest holding a real session", () => {
  let account: request.Agent;
  let guestId: string;

  beforeAll(async () => {
    guestId = await registerWithoutADocument("Bùi Thị Lệ");

    await http()
      .post("/api/auth/sign-up/email")
      .send({
        name: "Bùi Thị Lệ",
        email: GUEST_EMAIL,
        password: GUEST_PASSWORD,
      })
      .expect(200);

    const link = new URL(mailer.linkTo(GUEST_EMAIL));

    await http().get(`${link.pathname}${link.search}`).expect(302);

    account = request.agent(app.getHttpServer());

    await account
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(200);

    // The session is real, which is what makes the refusal below mean
    // something: it is about authority and not about the cookie.
    const session = await account.get("/api/auth/get-session").expect(200);

    expect(session.body.user.emailVerified).toBe(true);
  });

  it("is refused every guest route with 403 rather than 401", async () => {
    // `rbac-matrix.md` §3 denies the guest column all three rows outright, so
    // the guard refuses before a handler is reached. `NFR-07` in the other
    // direction is the 401 above: an identity that is missing is not the same
    // answer as an authority that is, and a screen cannot tell the operator
    // what to do about it if the two arrive as one status.
    for (const route of ROUTES) {
      await account[route.method](route.path(guestId))
        .send(route.body ?? {})
        .expect(403);
    }
  });

  it("leaves the property's record of them untouched", async () => {
    // The sharp half of the row's denial. A guest-realm channel for identity
    // particulars is what §3 refuses to build, and the refusal above is worth
    // nothing if the write landed on its way to the 403.
    expect(await storedGuest(guestId)).toMatchObject({
      cccdNumber: null,
      nationality: null,
    });
  });
});
