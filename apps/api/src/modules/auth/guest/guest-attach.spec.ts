// Following the account link out of a confirmation email.
//
// Against a real Postgres and a real Better Auth instance, because the whole
// point of this flow is a row the library writes: an account whose address is
// already verified. A stand-in for `internalAdapter` would assert that the
// stand-in honours `emailVerified`, which is exactly the fact nobody can promise
// — `guest-attach.internal-api.spec.ts` pins the surface, and this proves the
// behaviour behind it.
//
// The claims:
//
// 1. **The account exists, verified, and the stay is its own** — the mail was
//    the verification, so there is no second round trip.
// 2. **The link is spent once and it expires** — a mailbox is copied, forwarded
//    and left open.
// 3. **The password is optional**, and supplying one writes the credential
//    Better Auth's own sign-in reads.
// 4. **A failure in the attach puts the link back**, because the spend and the
//    attach are one transaction. A guest whose attach failed can follow it again.
// 5. **An address that gained an account in the meantime is attached to that
//    account**, rather than being refused forever by a unique index — whether it
//    gained one before the redemption started or while the account was being
//    written.
// 6. **No transaction of this flow is open while Better Auth writes the
//    account.** The library takes a connection of its own, and a flow holding one
//    of ten while waiting for a second is a flow that stalls the process the
//    moment ten guests redeem at once.

import "reflect-metadata";

import { ORPCError } from "@orpc/nest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../config/env.js";
import type { Database } from "../../../database/database.module.js";
import { TransactionRunner } from "../../../database/transaction-runner.js";
import { booking } from "../../../database/schema/booking.js";
import { bookingLink } from "../../../database/schema/booking-link.js";
import {
  account as guestAccount,
  user as guestUser,
} from "../../../database/schema/guest-auth.js";
import * as schema from "../../../database/schema/index.js";
import { roomType } from "../../../database/schema/inventory.js";
import { BookingService } from "../../booking/booking.service.js";
import type { AssignmentService } from "../../booking/assignment.service.js";
import type { BusinessDateService } from "../../booking/business-date.service.js";
import type { FolioPort } from "../../booking/ports/folio.port.js";
import type { StayQuoteService } from "../../booking/stay-quote.service.js";
import type { GuestService } from "../../guest/guest.service.js";
import type { HousekeepingService } from "../../housekeeping/housekeeping.service.js";
import type { InventoryService } from "../../inventory/inventory.service.js";
import type { BookingConfirmationService } from "../../notification/booking-confirmation.service.js";
import type { MailQueue } from "../../notification/mail-queue.service.js";
import { BookingTokenService } from "../booking-token/booking-token.service.js";
import { createGuestAuth } from "./guest-auth.factory.js";
import {
  GuestAttachService,
  type RedeemedAccountLink,
} from "./guest-attach.service.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

const PASSWORD = "correct-horse-battery-staple";

/** Distinguishes this run's fixtures from whatever an earlier one left. */
const RUN = Date.now().toString(36);

/** What `database.module.ts` gives the whole process. */
const POOL_CONNECTIONS = 10;

/** Comfortably more redemptions at once than there are connections to hold. */
const CONCURRENT_REDEMPTIONS = 24;

/** Postgres' answer to `for update nowait` on a row somebody else holds. */
const LOCK_NOT_AVAILABLE = "55P03";

let DATABASE_URL: string;
let pool: pg.Pool;
let db: Database;
let tokens: BookingTokenService;
let auth: ReturnType<typeof createGuestAuth>;
let attach: GuestAttachService;
let bookings: BookingService;
let roomTypeId: string;
let referenceOrdinal = 0;

/** A unique address per case: this file creates real accounts and the unique
 *  index on `lower(email)` is one of the things under test. */
function nextAddress(): string {
  referenceOrdinal += 1;

  return `mailed-link-${referenceOrdinal}-${RUN}@example.test`;
}

/**
 * Better Auth's own shape for an id — 32 base-62 characters — unique per run.
 *
 * This file deliberately does not truncate the guest tables: they are Better
 * Auth's, other suites share them, and an account created here is meant to
 * outlive the case that made it. So the fixtures must not collide with the rows
 * a previous run left behind.
 */
function nextAccountId(): string {
  referenceOrdinal += 1;

  return `${RUN}${String(referenceOrdinal)}`.padEnd(32, "0").slice(0, 32);
}

async function aConfirmedStay(
  contact: { email: string; name: string } | null,
): Promise<string> {
  referenceOrdinal += 1;

  const [row] = await db
    .insert(booking)
    .values({
      reference: `MRV-20270510-${String(referenceOrdinal).padStart(4, "0")}`,
      state: "CONFIRMED",
      roomTypeId,
      checkInDate: CHECK_IN,
      checkOutDate: CHECK_OUT,
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: 5_400_000n,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
      contactEmail: contact?.email ?? null,
      contactName: contact?.name ?? null,
    })
    .returning({ id: booking.id });

  return row!.id;
}

/** A stay whose confirmation offered an account, and the link it offered. */
async function anInvitation(): Promise<{
  bookingId: string;
  address: string;
  link: string;
}> {
  const address = nextAddress();
  const bookingId = await aConfirmedStay({ email: address, name: "Nguyễn An" });

  return {
    bookingId,
    address,
    link: await tokens.mintAccountLink(db, { bookingId }),
  };
}

/**
 * What a browser would be left holding, out of the `Set-Cookie` lines the
 * redemption answered with — name and value, and none of the attributes that
 * decide how long the browser keeps them.
 */
function browserHolding(lines: readonly string[]): string {
  return lines.map((line) => line.split(";")[0]).join("; ");
}

/** Whoever those cookies are, asked of the realm that issued them. */
async function whoIsHolding(lines: readonly string[]) {
  return await auth.api.getSession({
    headers: new Headers({ cookie: browserHolding(lines) }),
  });
}

async function accountFor(address: string) {
  const [row] = await db
    .select({ id: guestUser.id, emailVerified: guestUser.emailVerified })
    .from(guestUser)
    .where(sql`lower(${guestUser.email}) = lower(${address})`);

  return row ?? null;
}

/** Every account under one address, for the cases about there being one. */
async function accountsFor(address: string) {
  return await db
    .select({ id: guestUser.id })
    .from(guestUser)
    .where(sql`lower(${guestUser.email}) = lower(${address})`);
}

/**
 * Whether another connection can take the link row's lock this instant.
 *
 * The observable form of "no transaction of ours is open". A flow that had
 * already spent the link would be holding that row's write lock until it
 * committed, and `nowait` turns waiting for it into `55P03` rather than a stall.
 * So `true` means the spend has not happened yet, on a connection that is not
 * this process' pool and cannot be confused with it.
 */
async function linkRowIsUnlocked(bookingId: string): Promise<boolean> {
  const observer = new pg.Client({ connectionString: DATABASE_URL });

  await observer.connect();

  try {
    await observer.query("begin");
    await observer.query(
      "select 1 from booking_link where booking_id = $1 for update nowait",
      [bookingId],
    );

    return true;
  } catch (error) {
    if ((error as { code?: string }).code === LOCK_NOT_AVAILABLE) {
      return false;
    }

    throw error;
  } finally {
    await observer.end();
  }
}

/**
 * Runs `redemption` with `watch` called at the instant Better Auth is asked to
 * write the account, and hands back what it saw.
 *
 * The library's own adapter is wrapped rather than replaced: what runs is the
 * real `createUser` against the real table, and the wrapper only marks the
 * moment. That moment is the whole subject — everything about the ordering is a
 * claim about what is true while it happens.
 */
async function whileTheAccountIsWritten<T>(
  watch: () => Promise<T>,
  redemption: () => Promise<unknown>,
): Promise<T | null> {
  const context = await auth.$context;
  const adapter = context.internalAdapter;
  const real = adapter.createUser.bind(adapter);

  let seen: T | null = null;

  adapter.createUser = (async (...given: Parameters<typeof real>) => {
    seen = await watch();

    return await real(...given);
  }) as typeof real;

  try {
    await redemption();
  } finally {
    adapter.createUser = real;
  }

  return seen;
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  DATABASE_URL = connectionString;

  // The production pool's own figures. Ten connections is what
  // `database.module.ts` gives the whole process, and a checkout that has not
  // been served in five seconds is the failure a flow holding one connection
  // while waiting for a second produces — so a case that exhausts the pool fails
  // here rather than hanging.
  pool = new pg.Pool({
    connectionString,
    max: POOL_CONNECTIONS,
    connectionTimeoutMillis: 5_000,
  });
  db = drizzle({ client: pool, schema });
  tokens = new BookingTokenService({
    BETTER_AUTH_SECRET: SECRET,
    NODE_ENV: "test",
  } as Env);

  bookings = new BookingService(
    undefined as unknown as InventoryService,
    undefined as unknown as StayQuoteService,
    undefined as unknown as BusinessDateService,
    undefined as unknown as AssignmentService,
    undefined as unknown as GuestService,
    undefined as unknown as HousekeepingService,
    undefined as unknown as FolioPort,
    undefined as unknown as Env,
    // Neither is reached: no case here confirms a paid hold.
    undefined as unknown as BookingTokenService,
    undefined as unknown as BookingConfirmationService,
  );

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type restart identity cascade`,
  );

  const [deluxe] = await db
    .insert(roomType)
    .values({
      code: "DELUXE",
      name: "Deluxe",
      maxOccupancy: 2,
      beddingSleeps: 2,
      takesExtraBed: true,
      squareMetres: 34,
      bedding: "one king bed (1.80 m)",
      aspect: "garden",
      description: "A garden-facing room with a king bed.",
      displayOrder: 2,
    })
    .returning({ id: roomType.id });

  roomTypeId = deluxe!.id;

  auth = createGuestAuth({
    db,
    env: {
      NODE_ENV: "test",
      API_URL: "https://api.mariva.test",
      WEB_ORIGIN: "https://mariva.test",
      BETTER_AUTH_SECRET: SECRET,
    } as Env,
    // Nothing here signs up or resets, so nothing is ever handed over — and a
    // case that did would fail loudly rather than post to a mail vendor.
    mail: undefined as unknown as MailQueue,
  });

  // The service opens its own boundaries: the account is created between two
  // transactions rather than inside one, so nothing here may wrap the call.
  attach = new GuestAttachService(
    auth,
    db,
    new TransactionRunner(db),
    tokens,
    bookings,
  );
});

beforeEach(() => {
  referenceOrdinal += 1;
});

afterAll(async () => {
  await pool?.end();
});

describe("the account a mailed link creates", () => {
  it("exists with its address already verified, and holds the stay", async () => {
    const invited = await anInvitation();

    const attached = await attach.accountFromLink({ link: invited.link });

    expect(attached.stay.bookingId).toBe(invited.bookingId);

    const created = await accountFor(invited.address);

    expect(created).not.toBeNull();
    expect(
      created!.emailVerified,
      "The confirmation email went to this address and the guest followed its " +
        "link from that mailbox. A second verification mail asks the same " +
        "address to prove the same fact twice.",
    ).toBe(true);

    const [stay] = await db
      .select({
        userId: booking.userId,
        anonAccessRevokedAt: booking.anonAccessRevokedAt,
      })
      .from(booking)
      .where(eq(booking.id, invited.bookingId));

    expect(stay!.userId).toBe(created!.id);
    expect(stay!.anonAccessRevokedAt).not.toBeNull();
  });

  it("has no credential when the guest set no password", async () => {
    const invited = await anInvitation();

    await attach.accountFromLink({ link: invited.link });

    const created = await accountFor(invited.address);
    const credentials = await db
      .select({ id: guestAccount.id })
      .from(guestAccount)
      .where(
        and(
          eq(guestAccount.userId, created!.id),
          eq(guestAccount.providerId, "credential"),
        ),
      );

    // The stay is theirs regardless. Recovery is a reset to the address that
    // has just been verified, which creates the credential this never wrote.
    expect(credentials).toHaveLength(0);
  });

  it("has one when the guest set a password", async () => {
    const invited = await anInvitation();

    await attach.accountFromLink({ link: invited.link, password: PASSWORD });

    const created = await accountFor(invited.address);
    const [credential] = await db
      .select({ password: guestAccount.password })
      .from(guestAccount)
      .where(
        and(
          eq(guestAccount.userId, created!.id),
          eq(guestAccount.providerId, "credential"),
        ),
      );

    expect(credential).toBeDefined();
    // Hashed by the library's own hasher, which is what `/sign-in/email` reads.
    expect(credential!.password).not.toBe(PASSWORD);
    expect(credential!.password).not.toBeNull();
  });

  it("is the one already registered when the address gained an account meanwhile", async () => {
    const invited = await anInvitation();

    // Between the mail landing and the guest opening it, the same person signed
    // up the ordinary way. The link must still work: it names their stay, and
    // it was delivered to the mailbox that account was registered from.
    const [existing] = await db
      .insert(guestUser)
      .values({
        id: nextAccountId(),
        name: "Nguyễn An",
        email: invited.address,
        emailVerified: true,
      })
      .returning({ id: guestUser.id });

    const attached = await attach.accountFromLink({ link: invited.link });

    expect(attached.stay.bookingId).toBe(invited.bookingId);

    const [stay] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, invited.bookingId));

    expect(stay!.userId).toBe(existing!.id);

    expect(
      attached.sessionCookies,
      "A link that met an account which already existed has signed a browser " +
        "into it. That account holds stay history and personal details the " +
        "link never proved anything about — only a sign-in speaks for those.",
    ).toHaveLength(0);
  });
});

// The guest who set no password is the one this is for. The account was made by
// a message sent to their address and holds the single booking that same message
// opened, so a session over it reaches nothing the link did not — and without
// one, a guest who declined the optional password is locked out of the stay they
// have just claimed until they run a password reset to get back in.
describe("the browser that followed the link", () => {
  it("is signed into the account, with no password anywhere in it", async () => {
    const invited = await anInvitation();

    const attached = await attach.accountFromLink({ link: invited.link });

    const created = await accountFor(invited.address);
    const session = await whoIsHolding(attached.sessionCookies);

    expect(session, "No session came back from a link that made an account.")
      .not.toBeNull();
    expect(session!.user.id).toBe(created!.id);
    expect(session!.user.emailVerified).toBe(true);
  });

  it("is signed in when a password was set as well", async () => {
    const invited = await anInvitation();

    const attached = await attach.accountFromLink({
      link: invited.link,
      password: PASSWORD,
    });

    const created = await accountFor(invited.address);
    const session = await whoIsHolding(attached.sessionCookies);

    expect(session!.user.id).toBe(created!.id);
  });

  it("reads the stay as its owner and not as the anonymous caller", async () => {
    const invited = await anInvitation();

    const attached = await attach.accountFromLink({ link: invited.link });

    const session = await whoIsHolding(attached.sessionCookies);

    const [stay] = await db
      .select({
        userId: booking.userId,
        anonAccessRevokedAt: booking.anonAccessRevokedAt,
      })
      .from(booking)
      .where(eq(booking.id, invited.bookingId));

    // The session is the new authority over this stay, and it replaces the old
    // one rather than joining it: the credential the funnel handed out is given
    // up by the same transaction that writes the owner, and signing the guest in
    // does not hand it back.
    expect(stay!.userId).toBe(session!.user.id);
    expect(stay!.anonAccessRevokedAt).not.toBeNull();
  });
});

/**
 * Where the account is written relative to the transaction that spends the link.
 *
 * Better Auth writes on a connection of its own. A flow that asked for that
 * connection while holding one of the pool's ten would be holding one and
 * waiting for a second — and ten of them at once would hold all ten and wait for
 * connections that cannot come, until every checkout timed out. pg-boss draws
 * from the same pool, so it would stall with them.
 *
 * Both cases below are about that shape rather than about any row: the first
 * says nothing of ours is open at the moment the library is called, the second
 * puts more redemptions through at once than there are connections to hold.
 */
describe("the connection the account is written on", () => {
  it("is asked for with no transaction of this flow open", async () => {
    const invited = await anInvitation();

    const unlocked = await whileTheAccountIsWritten(
      () => linkRowIsUnlocked(invited.bookingId),
      () => attach.accountFromLink({ link: invited.link }),
    );

    expect(
      unlocked,
      "The link had already been spent when Better Auth was asked for a " +
        "connection, so this flow was holding one of the pool's ten and " +
        "waiting for another. Ten guests at once is then the whole pool.",
    ).toBe(true);
  });

  it("still spends the link and attaches the stay", async () => {
    const invited = await anInvitation();

    await attach.accountFromLink({ link: invited.link });

    const [row] = await db
      .select({
        userId: booking.userId,
        anonAccessRevokedAt: booking.anonAccessRevokedAt,
        consumedAt: bookingLink.consumedAt,
      })
      .from(booking)
      .innerJoin(bookingLink, eq(bookingLink.bookingId, booking.id))
      .where(eq(booking.id, invited.bookingId));

    // The gap is in the middle of the flow and not at the end of it: the link is
    // spent, the stay has an owner, and its anonymous credential is given up —
    // all three in the transaction that runs after the account exists.
    expect(row!.consumedAt).not.toBeNull();
    expect(row!.userId).toBe((await accountFor(invited.address))!.id);
    expect(row!.anonAccessRevokedAt).not.toBeNull();
  });

  it("serves far more redemptions at once than the pool has connections", async () => {
    const invitations = await Promise.all(
      Array.from({ length: CONCURRENT_REDEMPTIONS }, () => anInvitation()),
    );

    const attached = await Promise.all(
      invitations.map((invited) =>
        attach.accountFromLink({ link: invited.link }),
      ),
    );

    expect(CONCURRENT_REDEMPTIONS).toBeGreaterThan(POOL_CONNECTIONS);
    expect(attached.map((redeemed) => redeemed.stay.bookingId).sort()).toEqual(
      invitations.map((invited) => invited.bookingId).sort(),
    );
  });
});

/**
 * Two links, one mailbox, and the unique index between them.
 *
 * A guest who books twice with the same address, and whose holds are both paid
 * before either is attached, receives two create links — the confirmation mints
 * one whenever the address has no account yet, and neither confirmation knows
 * about the other. Following both is the ordinary thing to do with two messages.
 *
 * The account is created outside any transaction, so nothing serialises the two
 * on the database's behalf. What settles it is the index the second insert hits.
 */
describe("two account links for one address", () => {
  it("attaches to the account that appeared while this one was being written", async () => {
    const address = nextAddress();
    const bookingId = await aConfirmedStay({
      email: address,
      name: "Nguyễn An",
    });
    const link = await tokens.mintAccountLink(db, { bookingId });

    let redeemed: RedeemedAccountLink | undefined;

    // The other redemption, landing in the window between this one's read and
    // its insert — written from inside that window rather than raced for, so
    // the unique violation happens every time rather than when the scheduler
    // obliges.
    const theirs = await whileTheAccountIsWritten(
      async () => {
        const [other] = await db
          .insert(guestUser)
          .values({
            id: nextAccountId(),
            name: "Nguyễn An",
            email: address,
            emailVerified: true,
          })
          .returning({ id: guestUser.id });

        return other!.id;
      },
      async () => {
        redeemed = await attach.accountFromLink({ link });
      },
    );

    const [stay] = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(eq(booking.id, bookingId));

    // Not a 500. The index refused this call's insert, and the address is the
    // same mailbox either way — both links were delivered to it, and both name
    // stays it paid for.
    expect(stay!.userId).toBe(theirs);
    expect(await accountsFor(address)).toHaveLength(1);

    expect(
      redeemed!.sessionCookies,
      "This call did not create that account, so it cannot speak for whatever " +
        "else the account holds — the registered-address branch withholds a " +
        "session for the same reason.",
    ).toHaveLength(0);
  });

  it("leaves one account behind when both links are followed at once", async () => {
    const address = nextAddress();

    const links = await Promise.all(
      [0, 1].map(async () => {
        const bookingId = await aConfirmedStay({
          email: address,
          name: "Nguyễn An",
        });

        return {
          bookingId,
          link: await tokens.mintAccountLink(db, { bookingId }),
        };
      }),
    );

    const attached = await Promise.all(
      links.map((invited) => attach.accountFromLink({ link: invited.link })),
    );

    expect(attached.map((redeemed) => redeemed.stay.bookingId).sort()).toEqual(
      links.map((invited) => invited.bookingId).sort(),
    );

    const accounts = await accountsFor(address);

    expect(accounts).toHaveLength(1);

    const owners = await db
      .select({ userId: booking.userId })
      .from(booking)
      .where(
        inArray(
          booking.id,
          links.map((invited) => invited.bookingId),
        ),
      );

    // Both stays under the one account, which is the whole point of an address
    // having one: a guest's two bookings are not two people.
    expect(owners.map((row) => row.userId)).toEqual([
      accounts[0]!.id,
      accounts[0]!.id,
    ]);
  });
});

describe("the link itself", () => {
  it("is spent by the first use and refused on the second", async () => {
    const invited = await anInvitation();

    await attach.accountFromLink({ link: invited.link });

    const again = await attach.accountFromLink({ link: invited.link })
      .catch((error: unknown) => error);

    expect((again as ORPCError<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("is refused once its hour is up", async () => {
    const invited = await anInvitation();

    // Aged rather than shortened: `booking_link_outlives_the_mail_that_carried
    // _it` refuses a row that expired before it was written, which is the
    // property that stops a dead link ever being mailed.
    await db
      .update(bookingLink)
      .set({
        createdAt: sql`now() - interval '3 hours'`,
        expiresAt: sql`now() - interval '2 hours'`,
      })
      .where(eq(bookingLink.bookingId, invited.bookingId));

    const late = await attach.accountFromLink({ link: invited.link })
      .catch((error: unknown) => error);

    expect((late as ORPCError<string, unknown>).code).toBe("UNAUTHORIZED");
    expect(await accountFor(invited.address)).toBeNull();
  });

  it("is refused, in the same words, when it was never signed here", async () => {
    const elsewhere = new BookingTokenService({
      BETTER_AUTH_SECRET: "a-different-secret-of-at-least-thirty-two-chars",
      NODE_ENV: "test",
    } as Env);

    const bookingId = await aConfirmedStay({
      email: nextAddress(),
      name: "Nguyễn An",
    });

    const theirs = await elsewhere.mintAccountLink(db, { bookingId });

    const refused = await attach.accountFromLink({ link: theirs })
      .catch((error: unknown) => error);

    expect((refused as ORPCError<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("is put back when the attach it started fails", async () => {
    const invited = await anInvitation();

    // The stay already belongs to somebody else, so the attach refuses and the
    // whole transaction rolls back — including the spend.
    await db
      .update(booking)
      .set({ userId: null })
      .where(eq(booking.id, invited.bookingId));

    const [other] = await db
      .insert(guestUser)
      .values({
        id: nextAccountId(),
        name: "Lê Hoàng Bình",
        email: nextAddress(),
        emailVerified: true,
      })
      .returning({ id: guestUser.id });

    await db
      .update(booking)
      .set({ userId: other!.id })
      .where(eq(booking.id, invited.bookingId));

    const refused = await attach.accountFromLink({ link: invited.link })
      .catch((error: unknown) => error);

    expect((refused as ORPCError<string, unknown>).code).toBe("CONFLICT");

    const [link] = await db
      .select({ consumedAt: bookingLink.consumedAt })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, invited.bookingId));

    // Unspent. A link burnt by an attempt that changed nothing is a guest who
    // can never retry.
    expect(link!.consumedAt).toBeNull();
  });

  it("refuses a password the realm would refuse at sign-up, spending nothing", async () => {
    const invited = await anInvitation();

    const refused = await attach
      .accountFromLink({ link: invited.link, password: "short" })
      .catch((error: unknown) => error);

    expect((refused as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");

    const [link] = await db
      .select({ consumedAt: bookingLink.consumedAt })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, invited.bookingId));

    expect(link!.consumedAt).toBeNull();
    expect(await accountFor(invited.address)).toBeNull();
  });
});
