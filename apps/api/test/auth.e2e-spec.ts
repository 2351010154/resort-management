// Both realms, end to end, against a real Postgres.
//
// The guard's own suite (src/common/auth/access.guard.spec.ts) proves the
// matrix is enforced for all fifty-four rows with the realms stubbed. This file
// proves the other half: that the wiring around it is real — that a password
// actually verifies, a token actually expires, a refresh token actually cannot
// be spent twice, and a verification link actually arrives and works.
//
// It runs against `mariva_test`, which `.env.test` points at, and it applies
// the committed migrations rather than pushing the schema — the SQL under test
// is the SQL that will run in production.

import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DRIZZLE, type Database } from "../src/database/database.module.js";
import { staffUser } from "../src/database/schema/identity.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";
import {
  STAFF_REALM_CLAIM,
  type StaffTokenPayload,
} from "../src/modules/auth/staff/staff-token.service.js";

/** Captures what would have been sent, so a verification link can be followed
 *  in a test the way a guest follows it in an inbox. The mailer is an outbound
 *  port; standing in for it is the one substitution this suite makes. */
class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  /** The most recent link sent to an address. Emails carry exactly one. */
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

const ADMIN = {
  email: "owner@mariva.test",
  fullName: "Trần Minh",
  role: "ADMIN",
  password: "admin-password-42",
} as const;

const GUEST_EMAIL = "anh@example.test";
const GUEST_PASSWORD = "correct-horse-battery";

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let http: () => request.Agent;

beforeAll(async () => {
  mailer = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // A clean slate, and only ever in the test database — `.env.test` is the
  // single place that decides which one that is.
  await db.execute(
    sql`truncate guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );

  http = () => request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

/** Signs in and returns the access token. */
async function signInAsAdmin(): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email: ADMIN.email, password: ADMIN.password })
    .expect(200);

  return response.body.accessToken as string;
}

describe("the staff realm", () => {
  it("creates the first account from the bootstrap path", async () => {
    // The same service the `staff:create` script drives. There is deliberately
    // no HTTP route that could do this on an empty database.
    const created = await app.get(StaffUserService).create({ ...ADMIN });

    expect(created.role).toBe("ADMIN");
    expect(created.passwordHash).not.toContain(ADMIN.password);
    expect(created.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("issues a token carrying exactly one role", async () => {
    const response = await http()
      .post("/auth/staff/sign-in")
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    expect(response.body.user).toMatchObject({
      email: ADMIN.email,
      role: "ADMIN",
    });

    const payload = app
      .get(JwtService)
      .decode<StaffTokenPayload>(response.body.accessToken);

    expect(payload.role).toBe("ADMIN");
    expect(payload.realm).toBe(STAFF_REALM_CLAIM);

    // The long-lived half never reaches the page.
    expect(response.body.refreshToken).toBeUndefined();
    expect(response.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/i);
  });

  it("is case-insensitive about the address", async () => {
    await http()
      .post("/auth/staff/sign-in")
      .send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password })
      .expect(200);
  });

  it("gives the same answer to a wrong password and an unknown address", async () => {
    const wrongPassword = await http()
      .post("/auth/staff/sign-in")
      .send({ email: ADMIN.email, password: "not-the-password" })
      .expect(401);

    const unknownAddress = await http()
      .post("/auth/staff/sign-in")
      .send({ email: "nobody@mariva.test", password: ADMIN.password })
      .expect(401);

    expect(wrongPassword.body.message).toBe(unknownAddress.body.message);
  });

  it("refuses an expired token", async () => {
    const expired = await app.get(JwtService).signAsync(
      {
        sub: "00000000-0000-0000-0000-000000000000",
        realm: STAFF_REALM_CLAIM,
        email: ADMIN.email,
        role: "ADMIN",
      },
      { expiresIn: "-1s" },
    );

    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${expired}`)
      .expect(401);
  });

  it("refuses a tampered token", async () => {
    const token = await signInAsAdmin();
    const tampered = `${token.slice(0, -2)}xy`;

    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${tampered}`)
      .expect(401);
  });

  it("refuses a token signed with the wrong secret", async () => {
    const forged = await new JwtService({
      secret: "a-secret-this-api-has-never-heard-of",
      signOptions: { algorithm: "HS256", expiresIn: 60 },
    }).signAsync({
      sub: "00000000-0000-0000-0000-000000000000",
      realm: STAFF_REALM_CLAIM,
      email: ADMIN.email,
      role: "ADMIN",
    });

    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${forged}`)
      .expect(401);
  });

  it("rotates the refresh token and refuses the spent one", async () => {
    const signIn = await http()
      .post("/auth/staff/sign-in")
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    const first = refreshCookie(signIn);

    const refreshed = await http()
      .post("/auth/staff/refresh")
      .set("cookie", first)
      .send({})
      .expect(200);

    // Rotation, not reuse: the response carries a different token.
    expect(refreshCookie(refreshed)).not.toBe(first);

    // The same token presented a second time — a replay — finds nothing
    // unrevoked left to spend.
    await http()
      .post("/auth/staff/refresh")
      .set("cookie", first)
      .send({})
      .expect(401);
  });

  it("revokes the refresh token on sign-out", async () => {
    const signIn = await http()
      .post("/auth/staff/sign-in")
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    const cookie = refreshCookie(signIn);

    await http().post("/auth/staff/sign-out").set("cookie", cookie).expect(204);

    await http()
      .post("/auth/staff/refresh")
      .set("cookie", cookie)
      .send({})
      .expect(401);
  });

  it("stops a deactivated account at the next request", async () => {
    const token = await signInAsAdmin();

    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    await db
      .update(staffUser)
      .set({ isActive: false })
      .where(eq(staffUser.email, ADMIN.email));

    // The token is still inside its thirty minutes and still verifies. The
    // account behind it is what stopped being valid.
    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${token}`)
      .expect(401);

    await db
      .update(staffUser)
      .set({ isActive: true })
      .where(eq(staffUser.email, ADMIN.email));
  });
});

describe("the capability guard, over HTTP", () => {
  it("refuses an anonymous request with 401", async () => {
    await http().get("/identity/staff-accounts").expect(401);
  });

  it("lets ADMIN reach an ADMIN-only capability", async () => {
    const token = await signInAsAdmin();

    const response = await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body[0]).not.toHaveProperty("passwordHash");
  });

  it("refuses MANAGER on the same capability with 403", async () => {
    const token = await signInAsAdmin();

    await http()
      .post("/identity/staff-accounts")
      .set("authorization", `Bearer ${token}`)
      .send({
        email: "manager@mariva.test",
        fullName: "Lê Thu",
        role: "MANAGER",
        password: "manager-password-42",
      })
      .expect(201);

    const manager = await http()
      .post("/auth/staff/sign-in")
      .send({ email: "manager@mariva.test", password: "manager-password-42" })
      .expect(200);

    await http()
      .get("/identity/staff-accounts")
      .set("authorization", `Bearer ${manager.body.accessToken}`)
      .expect(403);
  });

  it("leaves the health probe reachable, because it is marked so", async () => {
    await http().get("/health").expect(200);
  });
});

describe("the guest realm", () => {
  it("signs a guest up and sends them a verification link", async () => {
    await http()
      .post("/api/auth/sign-up/email")
      .send({ name: "Anh Nguyễn", email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(200);

    expect(mailer.linkTo(GUEST_EMAIL)).toContain("/api/auth/verify-email");
  });

  it("refuses to sign them in until the address is confirmed", async () => {
    await http()
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(403);
  });

  // One signed-in agent, reused by the three tests below. Not a shortcut: the
  // sign-in endpoint is rate limited to five attempts a minute, and a suite
  // that signs in once per test would be asserting against its own limiter
  // rather than against the realm.
  let guest: request.Agent;

  it("signs them in once it is, and hands back a session", async () => {
    const link = mailer.linkTo(GUEST_EMAIL);

    await http().get(pathOf(link)).expect(302);

    guest = request.agent(app.getHttpServer());

    await guest
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(200);

    const session = await guest.get("/api/auth/get-session").expect(200);

    expect(session.body.user.email).toBe(GUEST_EMAIL);
    expect(session.body.user.emailVerified).toBe(true);
  });

  it("refuses a guest session on a staff capability with 403, not 401", async () => {
    // The session is real. The realm is wrong — rbac-matrix.md §1.
    await guest.get("/identity/staff-accounts").expect(403);
  });

  it("refuses a session-bearing request from an untrusted origin", async () => {
    // Better Auth checks the Origin header against `trustedOrigins` before it
    // will act on a session cookie. This is the browser-side half of the CORS
    // rule main.ts sets: a page on another origin cannot spend a Mariva
    // session even though the browser attached the cookie.
    await guest
      .post("/api/auth/sign-out")
      .set("origin", "http://evil.example")
      .expect(403);

    await guest
      .post("/api/auth/sign-out")
      .set("origin", "http://localhost:3000")
      .expect(200);
  });

  it("resets a password, and the old one stops working", async () => {
    await http()
      .post("/api/auth/request-password-reset")
      .send({ email: GUEST_EMAIL, redirectTo: "http://localhost:3000/reset" })
      .expect(200);

    const link = mailer.linkTo(GUEST_EMAIL);

    // The link points at the API, which validates the token and redirects to
    // the page that collects the new password, carrying the token with it.
    const redirect = await http().get(pathOf(link)).expect(302);
    const token = new URL(redirect.headers.location).searchParams.get("token");

    expect(token).toBeTruthy();

    await http()
      .post("/api/auth/reset-password")
      .send({ newPassword: "a-brand-new-password", token })
      .expect(200);

    await http()
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: GUEST_PASSWORD })
      .expect(401);

    await http()
      .post("/api/auth/sign-in/email")
      .send({ email: GUEST_EMAIL, password: "a-brand-new-password" })
      .expect(200);
  });
});

// Last on purpose: it spends the endpoint's quota for the rest of the minute,
// and every test above needs that quota unspent.
describe("rate limiting", () => {
  it("stops a burst against the password-reset endpoint", async () => {
    let refused = false;

    for (let attempt = 0; attempt < 6 && !refused; attempt += 1) {
      const response = await http()
        .post("/api/auth/request-password-reset")
        .send({ email: GUEST_EMAIL, redirectTo: "http://localhost:3000/reset" });

      refused = response.status === 429;
    }

    expect(refused).toBe(true);
  });
});

/** The `name=value` pair from a response's `set-cookie`, ready to send back. */
function refreshCookie(response: request.Response): string {
  // supertest types `headers` as a string map; `set-cookie` is the one header
  // Node hands back as an array, whatever the type says.
  const header = response.headers["set-cookie"] as unknown as
    | string[]
    | undefined;
  const cookie = header?.[0];

  if (!cookie) {
    throw new Error("The response set no cookie");
  }

  return cookie.split(";")[0]!;
}

/** supertest addresses the app directly, so a link's path is what it needs. */
function pathOf(link: string): string {
  const url = new URL(link);

  return `${url.pathname}${url.search}`;
}
