// What a signed-in guest may do to their own credentials, and what the API
// refuses them — the other half of `FR-AUTH-04`.
//
// Two claims, neither of which the configuration states.
//
// The first is that changing a password behaves like resetting one.
// `revokeSessionsOnPasswordReset` covers the guest who forgot theirs; Better
// Auth's `/change-password` leaves the equivalent to a `revokeOtherSessions`
// flag in the request body, which is to say to whichever client sent it. A
// property that depends on the caller asking for it is not a property, so
// `guest-auth.factory.ts` sets the flag in a before hook — and this file makes
// the request *without* it, because a request that asked for the behaviour
// could not tell the hook from a coincidence.
//
// The second is that an account which only ever pressed Google is refused both
// forms. It has no password to prove, and its address is Google's — moving it
// would leave the next Google sign-in matching nobody and creating a second
// guest. The refusal has to be the API's: a page that omits a control is a
// page, and the request it omits can still be sent.
//
// Sign-in is limited to five a minute and this file makes four.

import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DRIZZLE, type Database } from "../src/database/database.module.js";
import {
  account as guestAccount,
  session as guestSession,
  user as guestUser,
} from "../src/database/schema/guest-auth.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";

class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  to(address: string): OutgoingEmail[] {
    return this.sent.filter((email) => email.to === address);
  }

  linkTo(address: string): string {
    const email = this.to(address).at(-1);

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

/** Unique per run: this file deletes its own accounts and truncates nothing. */
const RUN = Date.now();

const GUEST = `password-owner-${RUN}@example.test`;
const SOCIAL = `google-only-${RUN}@example.test`;
const SOCIAL_WANTED = `google-only-moved-${RUN}@example.test`;

const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-different-long-password";

const WEB = "http://localhost:3000";

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let http: () => request.Agent;

/** Two sessions for one guest: the browser doing the changing, and one left
 *  open somewhere else. */
let thisDevice: request.Agent;
let otherDevice: request.Agent;

/** A session on an account whose only credential is Google's. */
let social: request.Agent;

let wrongCurrentPassword: request.Response;
let changed: request.Response;
let otherDeviceAfterChange: request.Response;

/** Sessions still on the guest's account once the password had changed. */
let sessionsLeftForGuest: number;
let signedInWithNewPassword: request.Response;

/** The stored hash before and after an attempt that named the wrong current
 *  password. Read from the row, so "nothing changed" is about the credential
 *  rather than about the response. */
let hashBeforeWrongAttempt: string | null;
let hashAfterWrongAttempt: string | null;

let socialPasswordChange: request.Response;
let socialEmailChange: request.Response;

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

  http = () => request(app.getHttpServer());

  await signUpAndVerify(GUEST, "Anh Nguyễn");
  await signUpAndVerify(SOCIAL, "Bình Trần");

  // Sign-ins one and two: the same guest, twice over.
  thisDevice = await sessionFor(GUEST, PASSWORD);
  otherDevice = await sessionFor(GUEST, PASSWORD);

  // Sign-in three. Taken while the account still has a password, and then the
  // password is taken away: what a guest who only ever pressed Google has is a
  // session and a Google row, which is exactly what is left after this.
  social = await sessionFor(SOCIAL, PASSWORD);

  await db
    .update(guestAccount)
    .set({
      providerId: "google",
      accountId: `google-subject-${RUN}`,
      password: null,
    })
    .where(eq(guestAccount.userId, await idOf(SOCIAL)));

  // The Google-only refusals first, and not for narrative reasons: Better Auth
  // limits /change-password and /change-email to three attempts every ten
  // seconds by default, and this file makes exactly three of the first. An
  // attempt that arrived fourth would be answered by the limiter, and the
  // refusal would look like the one under test.
  socialPasswordChange = await social
    .post("/api/auth/change-password")
    .set("origin", WEB)
    .send({ newPassword: NEW_PASSWORD, currentPassword: PASSWORD });

  socialEmailChange = await social
    .post("/api/auth/change-email")
    .set("origin", WEB)
    .send({ newEmail: SOCIAL_WANTED, callbackURL: `${WEB}/account` });

  hashBeforeWrongAttempt = await storedHash(GUEST);

  wrongCurrentPassword = await thisDevice
    .post("/api/auth/change-password")
    .set("origin", WEB)
    .send({ newPassword: NEW_PASSWORD, currentPassword: "not-the-password" });

  hashAfterWrongAttempt = await storedHash(GUEST);

  // Deliberately without `revokeOtherSessions`. What revokes the other session
  // has to be the API, not this request.
  changed = await thisDevice
    .post("/api/auth/change-password")
    .set("origin", WEB)
    .send({ newPassword: NEW_PASSWORD, currentPassword: PASSWORD });

  // Counted before the probe below, which would itself revoke sessions if the
  // browser making it still had one.
  sessionsLeftForGuest = (
    await db
      .select({ id: guestSession.id })
      .from(guestSession)
      .where(eq(guestSession.userId, await idOf(GUEST)))
  ).length;

  // A route that re-reads the session from the database rather than one a
  // signed cookie can answer out of its own cache — see the test below for why
  // that distinction matters here.
  otherDeviceAfterChange = await otherDevice
    .post("/api/auth/revoke-sessions")
    .set("origin", WEB)
    .send({});

  // Sign-in four.
  signedInWithNewPassword = await http()
    .post("/api/auth/sign-in/email")
    .send({ email: GUEST, password: NEW_PASSWORD });
});

afterAll(async () => {
  await db
    .delete(guestUser)
    .where(inArray(guestUser.email, [GUEST, SOCIAL, SOCIAL_WANTED]));

  await app?.close();
});

describe("changing a password", () => {
  it("is refused when the current one is not proved", () => {
    expect(
      wrongCurrentPassword.status,
      "A password was changed without the current one. Anyone who reaches an " +
        "unlocked browser, or a session cookie, can then take the account " +
        "outright instead of borrowing it.",
    ).toBe(400);
  });

  it("leaves the stored credential exactly as it was", () => {
    expect(hashBeforeWrongAttempt).not.toBeNull();
    expect(hashAfterWrongAttempt).toBe(hashBeforeWrongAttempt);
  });

  it("succeeds when it is, and the new password signs the guest in", () => {
    expect(changed.status).toBe(200);
    expect(signedInWithNewPassword.status).toBe(200);
  });

  it("revokes the session left open elsewhere, without being asked to", () => {
    // The request above carried no `revokeOtherSessions`. A guest changes their
    // password to end somebody else's access, and a session that survives it
    // does not end anything.
    expect(
      otherDeviceAfterChange.status,
      "A session that existed before the password changed can still act. " +
        "Changing a password is how a guest locks out whoever had their old " +
        "one, and `revokeSessionsOnPasswordReset` already says so for the " +
        "reset path — check the before hook on /change-password in " +
        "guest-auth.factory.ts.",
    ).toBe(401);
  });

  it("leaves exactly the one session that made the change", () => {
    // The rows, because that is where revocation actually happened. It is also
    // where the limit of it is visible: `session.cookieCache` in
    // guest-auth.factory.ts lets a signed cookie answer an ordinary
    // `get-session` from itself for up to five minutes, so a revoked browser
    // can still be *told* it is signed in for that long. It cannot do anything
    // the database is asked about, which is what the assertion above rides on.
    expect(sessionsLeftForGuest).toBe(1);
  });

  it("keeps the session that made the change signed in", () => {
    // Revoking every session including the caller's would sign a guest out of
    // the page they were standing on. Better Auth issues them a fresh one, and
    // the token in the response is that session.
    expect(changed.body.token).toBeTruthy();
  });
});

describe("an account whose only credential is Google's", () => {
  it("is refused a password change by the API", () => {
    expect(socialPasswordChange.status).toBe(400);
    expect(socialPasswordChange.body.code).toBe("CREDENTIAL_ACCOUNT_NOT_FOUND");
  });

  it("is refused an email change by the API", () => {
    expect(
      socialEmailChange.status,
      "A Google-only account was allowed to move its address. Google still " +
        "matches the guest on the old one, so their next sign-in creates a " +
        "second account — and the stay history stays behind on the first.",
    ).toBe(400);
  });

  it("mails nobody about the change it was refused", () => {
    expect(mailer.to(SOCIAL_WANTED)).toHaveLength(0);
  });

  it("keeps the address Google knows it by", async () => {
    const [stored] = await db
      .select({ email: guestUser.email })
      .from(guestUser)
      .where(eq(guestUser.email, SOCIAL));

    expect(stored?.email).toBe(SOCIAL);
  });
});

/** Signs an address up and follows the verification link, so it can sign in. */
async function signUpAndVerify(address: string, name: string): Promise<void> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name, email: address, password: PASSWORD })
    .expect(200);

  const link = new URL(mailer.linkTo(address));

  await http().get(`${link.pathname}${link.search}`).expect(302);
}

/** One signed-in browser. Each of these costs a sign-in attempt. */
async function sessionFor(
  address: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());

  await agent
    .post("/api/auth/sign-in/email")
    .send({ email: address, password })
    .expect(200);

  return agent;
}

async function idOf(address: string): Promise<string> {
  const [row] = await db
    .select({ id: guestUser.id })
    .from(guestUser)
    .where(eq(guestUser.email, address));

  if (!row) {
    throw new Error(`No account was created for ${address}`);
  }

  return row.id;
}

/** The password hash on an account's credential row, or `null`. */
async function storedHash(address: string): Promise<string | null> {
  const [row] = await db
    .select({ password: guestAccount.password })
    .from(guestAccount)
    .where(eq(guestAccount.userId, await idOf(address)));

  return row?.password ?? null;
}
