// `FR-AUTH-04`'s email change, against a real Better Auth and a real Postgres.
//
// The claim is about *when* the address moves, and it cannot be read off the
// configuration. `guest-auth.factory.ts` turns `user.changeEmail` on and leaves
// `sendChangeEmailConfirmation` off, which in Better Auth 1.6.25 selects the
// one-step flow: a link to the new address, and no change to the account until
// somebody follows it. Every part of that sentence is a library behaviour that a
// version bump could alter silently — so this file signs in with both addresses
// either side of the click rather than asserting that the option is set.
//
// What it proves, in the order a guest would meet it:
//
//   - the message goes to the address being proved, in the change wording;
//   - the old address is still the sign-in identifier while the link is unused,
//     and the new one is not an identifier at all;
//   - following the link swaps exactly that, and following it again does
//     nothing;
//   - aiming the change at an address that already has an account tells the
//     caller nothing, and mails nobody.
//
// **This file spends its sign-in quota to the last attempt.** `/sign-in/email`
// is limited to five a minute and every assertion below about *which* address
// signs in costs one, refusals included. There are exactly five. A sixth would
// be answered by the limiter, and the failure would read as an address that
// stopped working.

import "reflect-metadata";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DRIZZLE, type Database } from "../src/database/database.module.js";
import { user as guestUser } from "../src/database/schema/guest-auth.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";

/** Stands in for the outbound port, so a link can be followed the way a guest
 *  follows it out of an inbox. */
class RecordingMailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  /** Every message this run has addressed to somebody. */
  to(address: string): OutgoingEmail[] {
    return this.sent.filter((email) => email.to === address);
  }

  /** The most recent link sent to an address. Messages carry exactly one. */
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

// Unique per run. This file does not truncate the guest tables — other files
// own rows in them — so it must not collide with what an earlier run left, and
// it deletes exactly its own three accounts at the end.
const RUN = Date.now();

/** The address the guest holds, and signs in with until the link is used. */
const HELD = `change-from-${RUN}@example.test`;

/** The address they are moving to. Nobody holds it. */
const WANTED = `change-to-${RUN}@example.test`;

/** An address that already has an account. Aiming the change at it must be
 *  indistinguishable from aiming it anywhere else. */
const TAKEN = `change-taken-${RUN}@example.test`;

const PASSWORD = "correct-horse-battery-staple";

// Better Auth checks the Origin of anything that acts on a session, and
// `trustedOrigins` pins it to `WEB_ORIGIN` — so the change-email callback
// cannot be aimed off-origin either. `.env.test` names the web app here.
const WEB = "http://localhost:3000";

let app: INestApplication;
let db: Database;
let mailer: RecordingMailer;
let http: () => request.Agent;

/** The guest's session, taken once: signing in again costs the quota. */
let guest: request.Agent;

/** The responses to aiming the change at a taken address and at a free one. */
let atTakenAddress: request.Response;
let atFreeAddress: request.Response;

/** Sign-in attempts made while the change was still unproven. */
let heldWhilePending: request.Response;
let wantedWhilePending: request.Response;

/** The same two attempts once the link had been followed. */
let heldAfterProof: request.Response;
let wantedAfterProof: request.Response;

/** What following the same link a second time did. */
let replayed: request.Response;

/** The addresses the guest table held for this run while the change was
 *  unproven. Read then, because by the time a test body runs it has moved. */
let storedWhilePending: string[];

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

  // The account the change is aimed at. Written directly rather than signed up
  // for: what it needs to be is registered, and a second sign-up would spend a
  // quota this file needs for the account it actually drives.
  await db.insert(guestUser).values({
    id: `taken-${RUN}`.padEnd(32, "x").slice(0, 32),
    name: "Somebody Else",
    email: TAKEN,
    emailVerified: true,
  });

  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: "Anh Nguyễn", email: HELD, password: PASSWORD })
    .expect(200);

  await http().get(pathOf(mailer.linkTo(HELD))).expect(302);

  guest = request.agent(app.getHttpServer());

  // Sign-in one of five.
  await guest
    .post("/api/auth/sign-in/email")
    .send({ email: HELD, password: PASSWORD })
    .expect(200);

  // The taken address first, so that the message the free one sends is proof
  // the queue had drained past this point with nothing in it for the account
  // that already exists.
  atTakenAddress = await guest
    .post("/api/auth/change-email")
    .set("origin", WEB)
    .send({ newEmail: TAKEN, callbackURL: `${WEB}/account` });

  atFreeAddress = await guest
    .post("/api/auth/change-email")
    .set("origin", WEB)
    .send({ newEmail: WANTED, callbackURL: `${WEB}/account` });

  // Two and three of five.
  heldWhilePending = await http()
    .post("/api/auth/sign-in/email")
    .send({ email: HELD, password: PASSWORD });

  wantedWhilePending = await http()
    .post("/api/auth/sign-in/email")
    .send({ email: WANTED, password: PASSWORD });

  storedWhilePending = (
    await db
      .select({ email: guestUser.email })
      .from(guestUser)
      .where(inArray(guestUser.email, [HELD, WANTED]))
  ).map((row) => row.email);

  const link = pathOf(mailer.linkTo(WANTED));

  await http().get(link).expect(302);

  // Four and five of five.
  heldAfterProof = await http()
    .post("/api/auth/sign-in/email")
    .send({ email: HELD, password: PASSWORD });

  wantedAfterProof = await http()
    .post("/api/auth/sign-in/email")
    .send({ email: WANTED, password: PASSWORD });

  replayed = await http().get(link);
});

afterAll(async () => {
  await db
    .delete(guestUser)
    .where(inArray(guestUser.email, [HELD, WANTED, TAKEN]));

  await app?.close();
});

describe("the message a guest gets when they ask to move their address", () => {
  it("goes to the address being proved and nowhere else", () => {
    // Not to the address they hold. The address they hold is already proved;
    // the one that is not is the one this link is about.
    expect(mailer.to(WANTED)).toHaveLength(1);
    expect(mailer.to(HELD)).toHaveLength(1);
    expect(mailer.to(HELD)[0]?.subject).toBe("Confirm your email — Mariva");
  });

  it("is worded as a change and not as a sign-up", () => {
    expect(mailer.to(WANTED)[0]?.subject).toBe(
      "Confirm your new email address — Mariva",
    );
  });

  it("carries a link back into this API's verification route", () => {
    expect(mailer.linkTo(WANTED)).toContain("/api/auth/verify-email");
  });
});

describe("the address a guest signs in with while the change is unproven", () => {
  it("is still the one they held", () => {
    expect(
      heldWhilePending.status,
      "The address a guest signed up with stopped working the moment they " +
        "asked to change it. A request nobody has proved yet has locked them " +
        "out of their own account — and anyone who reaches an unlocked session " +
        "can do it to them.",
    ).toBe(200);
  });

  it("is not the one they asked for", () => {
    expect(
      wantedWhilePending.status,
      "The new address signs in before anybody proved it belongs to the " +
        "guest. Naming an address is then enough to make it a credential.",
    ).toBe(401);
  });

  it("is what the stored account says too", () => {
    // The row, not just the answer. A route that refused the new address while
    // the column already held it would be one deploy away from accepting it.
    expect(storedWhilePending).toEqual([HELD]);
  });
});

describe("the address a guest signs in with once the link is followed", () => {
  it("is the one they asked for", () => {
    expect(wantedAfterProof.status).toBe(200);
  });

  it("is no longer the one they held", () => {
    expect(
      heldAfterProof.status,
      "Both addresses sign this account in. The old one was never released, " +
        "so the account now answers to an address its owner believes they gave " +
        "up — and to whoever registers it next.",
    ).toBe(401);
  });

  it("leaves one account, proved, under the new address", async () => {
    const rows = await db
      .select({ email: guestUser.email, verified: guestUser.emailVerified })
      .from(guestUser)
      .where(inArray(guestUser.email, [HELD, WANTED]));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ email: WANTED, verified: true });
  });
});

describe("the link itself", () => {
  it("is spent by the first use", () => {
    // The token names the address it moves *from*, and that address is gone the
    // moment the move lands — so a second use finds nothing to move and says
    // so. Following it again must not re-apply anything, and must not be a way
    // to walk an account back onto an address its owner released.
    expect(replayed.status).toBe(302);
    expect(
      replayed.headers.location,
      "A change-email link worked twice. Anything that reaches a guest's inbox " +
        "once — a forwarded message, a shared machine, a mail archive — can " +
        "then move the address again.",
    ).toContain("error=");
  });

  it("comes back only to the origin this realm trusts", () => {
    // `trustedOrigins` is `WEB_ORIGIN`, so the callback the link carries cannot
    // be aimed anywhere else. What arrives here is that origin, error and all.
    expect(replayed.headers.location?.startsWith(WEB)).toBe(true);
  });
});

describe("aiming the change at an address that already has an account", () => {
  it("answers exactly as it does for an address nobody holds", () => {
    expect(
      atTakenAddress.status,
      "Asking to move to a registered address answered differently from " +
        "asking to move to a free one. Anyone with a session and a list of " +
        "addresses can then read which of them hold Mariva accounts, and this " +
        "realm's accounts hold passport scans and stay history.",
    ).toBe(atFreeAddress.status);

    expect(atTakenAddress.body).toEqual(atFreeAddress.body);
  });

  it("mails nobody, so the address's owner is not told either", () => {
    // The free branch's message had already been recorded by the time this
    // could be read, which is what makes the emptiness here a fact rather than
    // a race: both requests were made, and only one of them produced mail.
    expect(mailer.to(TAKEN)).toHaveLength(0);
  });

  it("leaves the other account untouched", async () => {
    const [stored] = await db
      .select({ name: guestUser.name, email: guestUser.email })
      .from(guestUser)
      .where(eq(guestUser.email, TAKEN));

    expect(stored).toEqual({ name: "Somebody Else", email: TAKEN });
  });
});

/** supertest addresses the app directly, so a link's path is what it needs. */
function pathOf(link: string): string {
  const url = new URL(link);

  return `${url.pathname}${url.search}`;
}
