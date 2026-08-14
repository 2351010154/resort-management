// The sign-up response must not say whether the address is already registered.
//
// A public sign-up form is an account-existence oracle the moment its answer
// depends on whether the address is known. "This email is already in use" tells
// an attacker with a list of addresses which of their targets hold accounts
// here, and the guest realm's accounts hold passport scans and stay history.
//
// Better Auth already answers generically, but only because
// `requireEmailVerification` is set — the same route throws
// `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` with a 422 when that flag is off. So
// the property is real today and is held up by a setting that reads as being
// about email, plus a library version that could change the coupling. This file
// is what fails when either of those moves.
//
// It drives the mounted HTTP route rather than `auth.api.signUpEmail`, because
// the two are not the same code path: the rate limiter lives in the router's
// request hook and does not run for a direct library call, so a test that
// bypassed the router would be asserting about a door no guest uses.

import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { user as guestUser } from "../../../database/schema/guest-auth.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../../notification/mailer.service.js";

/**
 * Stands in for the outbound mail port so nothing leaves the machine, and so
 * "was an email sent?" is a question the test can actually ask.
 *
 * It also holds every send open until this file lets it go. That turns "was
 * the send waited for?" from a stopwatch reading into a fact: a response that
 * arrives while its message is still in here was not waiting on delivery.
 */
class RecordingMailer {
  /** Messages handed to the port, whether or not they have finished. */
  readonly sent: OutgoingEmail[] = [];

  /** Messages whose send has actually returned. */
  readonly delivered: OutgoingEmail[] = [];

  private open = () => {};
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve;
  });

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    await this.gate;
    this.delivered.push(email);
  }

  /** Lets the held sends finish, so nothing is left hanging at teardown. */
  releaseHeldSends(): void {
    this.open();
  }
}

// A send held open forever would hang the hook rather than fail an assertion,
// and a hook timeout says nothing about what went wrong. This lets go long
// after a sign-up should have answered, so the assertion below is the thing
// that reports it: the response arrives, having waited, with its message
// already delivered.
const HELD_SENDS_RELEASED_AFTER_MS = 15_000;

const PASSWORD = "correct-horse-battery-staple";

// The stored account is aged before the duplicate attempt, so that a response
// echoing the row's real `createdAt` would be visible as a leak rather than
// hiding behind two timestamps that are both a few milliseconds old.
const AGED_AT = new Date("2020-03-01T00:00:00.000Z");

/** Unique per run: this file deliberately does not truncate the guest tables,
 *  so it must not collide with rows another suite left behind. */
const ADDRESS = `enumeration-${Date.now()}@example.test`;

const NAME_ON_FIRST_ATTEMPT = "Anh Nguyễn";
const NAME_ON_SECOND_ATTEMPT = "Someone Else Entirely";

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;

/** The response to signing up an address nobody holds. */
let toNewAddress: request.Response;

/** The response to signing up the same address once it is held. */
let toRegisteredAddress: request.Response;

let storedBeforeSecondAttempt: typeof guestUser.$inferSelect;
let mailsBeforeSecondAttempt: number;

/** Messages handed over, and finished, by the time both responses were in. */
let handedOverWhileAnswering: number;
let deliveredWhileAnswering: number;

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

  const http = () => request(app.getHttpServer());

  const valve = setTimeout(
    () => mailer.releaseHeldSends(),
    HELD_SENDS_RELEASED_AFTER_MS,
  );

  // Exactly two sign-ups, and no more: the route is rate limited to five a
  // minute, and a suite that spent that budget would start asserting against
  // its own limiter instead of against the response shape.
  toNewAddress = await http()
    .post("/api/auth/sign-up/email")
    .send({
      name: NAME_ON_FIRST_ATTEMPT,
      email: ADDRESS,
      password: PASSWORD,
    });

  await db
    .update(guestUser)
    .set({ createdAt: AGED_AT, updatedAt: AGED_AT })
    .where(eq(guestUser.email, ADDRESS));

  storedBeforeSecondAttempt = await storedAccount();
  mailsBeforeSecondAttempt = mailer.sent.length;

  toRegisteredAddress = await http()
    .post("/api/auth/sign-up/email")
    .send({
      name: NAME_ON_SECOND_ATTEMPT,
      email: ADDRESS,
      password: "a-completely-different-password",
    });

  // Read before anything is let go, so what they record is the state both
  // responses were produced in.
  handedOverWhileAnswering = mailer.sent.length;
  deliveredWhileAnswering = mailer.delivered.length;

  clearTimeout(valve);
  mailer.releaseHeldSends();
});

afterAll(async () => {
  // Only this run's row. The suite shares one database and other files own
  // rows in the same table.
  await db.delete(guestUser).where(eq(guestUser.email, ADDRESS));
  await app?.close();
});

describe("signing up an address that is already registered", () => {
  it("answers with the same status as signing up a new one", () => {
    expect(
      toRegisteredAddress.status,
      "Sign-up answered a registered address with a different HTTP status than " +
        "a new one. That difference is an account-existence oracle: anyone can " +
        "test an address against the public form and read the status. Check " +
        "whether emailAndPassword.requireEmailVerification is still set in " +
        "guest-auth.factory.ts, or whether the Better Auth upgrade changed " +
        "which responses it treats as generic.",
    ).toBe(toNewAddress.status);
  });

  it("answers with a body of the same shape, field for field", () => {
    // Structure, not a copied literal: a hand-written expected body would have
    // to be edited every time Better Auth adds a field, and the edit that keeps
    // it passing is exactly the edit that would stop it noticing a new field
    // present on only one of the two branches.
    expect(
      shapeOf(toRegisteredAddress.body),
      "The sign-up response body for a registered address no longer has the " +
        "same keys and value types as the body for a new address. Whichever " +
        "field appeared, changed type or went missing tells a caller which " +
        "branch ran, and therefore whether the account exists.",
    ).toEqual(shapeOf(toNewAddress.body));

    expect(toRegisteredAddress.headers["content-type"]).toBe(
      toNewAddress.headers["content-type"],
    );
  });

  it("issues no session on either branch, so neither is marked by a cookie", () => {
    // Verification is required before sign-in, so neither branch may hand back
    // a session. A cookie on one of them would identify it without anyone
    // needing to read the body.
    for (const response of [toNewAddress, toRegisteredAddress]) {
      expect(response.body.token).toBeNull();
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("echoes the attempt rather than the stored account", () => {
    const echoed = toRegisteredAddress.body.user;

    // Every field below is one the real row also has a value for. Returning
    // the stored value instead of the submitted one would confirm the account
    // exists and disclose its contents at the same time.
    expect(
      echoed.name,
      "The response to a duplicate sign-up returned the registered account's " +
        "name instead of the name that was submitted. That both proves the " +
        "account exists and discloses who holds it.",
    ).toBe(NAME_ON_SECOND_ATTEMPT);

    expect(echoed.id).not.toBe(storedBeforeSecondAttempt.id);

    expect(
      new Date(echoed.createdAt).getTime(),
      "The response to a duplicate sign-up returned the registered account's " +
        "creation date. An attacker reads it straight off the public form and " +
        "learns both that the address is taken and when.",
    ).toBeGreaterThan(AGED_AT.getTime());
  });

  it("sends no email, so the address owner is not told", () => {
    expect(
      mailer.sent.length,
      "A duplicate sign-up sent an email. That mails an unsolicited message to " +
        "someone who did not ask for it, and tells whoever triggered it that " +
        "the address is registered.",
    ).toBe(mailsBeforeSecondAttempt);

    // The one email is the verification link from the first, genuine sign-up.
    expect(mailer.sent.filter((email) => email.to === ADDRESS)).toHaveLength(1);
  });

  it("answers without waiting for the one email it did send", () => {
    // The branch that has a message to send is the fresh one, and the send is
    // held open for the whole of both requests. So the message being handed
    // over while none of it has been delivered is the shape of the fix: the
    // vendor's round trip is not inside the response any more, and the two
    // branches no longer differ by the length of it.
    expect(handedOverWhileAnswering).toBe(1);

    expect(
      deliveredWhileAnswering,
      "The sign-up response waited for the verification email to be delivered. " +
        "In production that wait is an HTTPS round trip to the mail vendor, " +
        "paid only by the branch that had an email to send — so a stopwatch on " +
        "one request says whether the address is already registered, whatever " +
        "the body says. The send belongs on the queue, not in the request; see " +
        "MailQueue and the two hooks in guest-auth.factory.ts.",
    ).toBe(0);
  });

  it("writes nothing: no second account, and the first one untouched", async () => {
    const rows = await db
      .select()
      .from(guestUser)
      .where(eq(guestUser.email, ADDRESS));

    expect(
      rows,
      "A duplicate sign-up wrote a second row for one address. The unique " +
        "index on lower(email) should have refused it, and a route that " +
        "reaches the index at all is a route whose answer can depend on " +
        "whether the insert failed.",
    ).toHaveLength(1);

    expect(
      rows[0],
      "A duplicate sign-up modified the existing account. A stranger who " +
        "guesses an address must not be able to change anything about the " +
        "person who holds it.",
    ).toEqual(storedBeforeSecondAttempt);
  });
});

/** The stored guest account for this run's address. */
async function storedAccount(): Promise<typeof guestUser.$inferSelect> {
  const [row] = await db
    .select()
    .from(guestUser)
    .where(eq(guestUser.email, ADDRESS));

  if (!row) {
    throw new Error(
      `The first sign-up created no account for ${ADDRESS}; this file cannot ` +
        "compare a duplicate attempt against an account that is not there.",
    );
  }

  return row;
}

/**
 * A value's structure with its data removed: every key kept, every leaf
 * replaced by its type. Comparing two of these asks "are these the same shape?"
 * without asking "are these the same account?".
 */
function shapeOf(value: unknown): unknown {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return value.map(shapeOf);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nested]) => [key, shapeOf(nested)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  return typeof value;
}
