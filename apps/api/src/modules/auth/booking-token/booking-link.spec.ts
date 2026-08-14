// What a mailed link does, against a real Postgres.
//
// `booking-token.service.spec.ts` is the half that needs no database: what the
// signature buys, and the set of edits to a cookie that must not verify. This
// file is the other half, and every claim in it is a claim about a row —
// because single use is a fact about the world rather than a property of a
// signature, and only a database can be asked whether a link has already been
// followed.
//
// The case this file exists for is the third one. Two clicks on one link, a mail
// client prefetching it while the guest opens it, a forwarded copy opened at the
// same moment: all of them arrive as two statements against one row, and exactly
// one of them must win. That is what the conditional `UPDATE` in
// `booking-token.service.ts` is for, and asserting it needs two connections and
// a real lock — a stand-in for Postgres would be asserting the stand-in.
//
// The rest are the ways a link must fail closed: signed elsewhere, edited after
// signing, followed already, out of date, presented at the wrong door, and
// naming a stay whose anonymous access has since been given up. Each is `null`,
// and the sameness is deliberate — a redemption that distinguished them would
// tell whoever is trying which half of a guess was right.
//
// It applies the committed migrations rather than pushing the schema, for
// `booking-storage.e2e-spec.ts`'s reason: the SQL under test is the SQL that
// will run in production.

import "reflect-metadata";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../config/env.js";
import { booking } from "../../../database/schema/booking.js";
import { bookingLink } from "../../../database/schema/booking-link.js";
import { guestUser } from "../../../database/schema/index.js";
import * as schema from "../../../database/schema/index.js";
import { roomType } from "../../../database/schema/inventory.js";
import { BookingTokenService } from "./booking-token.service.js";

const SECRET = "a-secret-at-least-thirty-two-characters-long";

const CHECK_IN = "2027-05-10";
const CHECK_OUT = "2027-05-13";

/** The instant the stay ends, as the controller hands it over — property-local
 *  midnight of the departure date, which is what the cookie's life is measured
 *  from. */
const DEPARTURE = new Date("2027-05-13T00:00:00+07:00");

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tokens: BookingTokenService;

let roomTypeId: string;
let bookingId: string;
let reference: string;

/** An account for the one case that needs one: a stay cannot give up its
 *  anonymous credential unless somebody can sign in to it. */
const AN_ACCOUNT = "3Xk2p9QwR7tL1sVn4cB8dF6hJ0mZyU5e";

let referenceOrdinal = 0;

function service(secret = SECRET): BookingTokenService {
  return new BookingTokenService({
    BETTER_AUTH_SECRET: secret,
    NODE_ENV: "test",
  } as Env);
}

/** A confirmed stay — the state a confirmation email is sent from. */
async function aBooking(
  overrides: Partial<typeof booking.$inferInsert> = {},
): Promise<{ id: string; reference: string }> {
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
      ...overrides,
    })
    .returning({ id: booking.id, reference: booking.reference });

  return row!;
}

/** The signature half of a link, replaced with one that is not ours. */
function withABrokenSignature(link: string): string {
  const separator = link.lastIndexOf(".");
  const signature = link.slice(separator + 1);

  return `${link.slice(0, separator)}.${
    signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`
  }`;
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is unset — vitest.config.ts loads .env.test");
  }

  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });
  tokens = service();

  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  await db.execute(
    sql`truncate booking_link, room_assignment, booking_night, booking, type_inventory, room, room_type, guest_session, guest_account, guest_user restart identity cascade`,
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

  await db.insert(guestUser).values({
    id: AN_ACCOUNT,
    name: "Trần Minh Anh",
    email: "minh.anh@mariva.test",
    emailVerified: true,
  });
});

beforeEach(async () => {
  // A second stay beside it on every case, so that a redemption which reached
  // the wrong booking — or joined to no booking in particular — comes back
  // naming a reference this file can see is the other one.
  await aBooking();

  const made = await aBooking();

  bookingId = made.id;
  reference = made.reference;
});

afterAll(async () => {
  await pool?.end();
});

describe("the link that re-issues a stay's credential", () => {
  it("opens the stay it was minted for, once", async () => {
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    const reissued = await tokens.redeemStayLink(db, link);

    expect(reissued?.bookingId).toBe(bookingId);
    // The claim comes back in the shape `issue` takes, so the caller hands it
    // straight to the browser and the guest leaves holding what the hold's
    // cookie was. The reference is this stay's and not merely a well-shaped
    // one — it is read across the join, so asserting it is asserting that the
    // link resolved to the booking it names.
    expect(reissued?.reference).toBe(reference);
    expect(reissued?.expiresAt.getTime()).toBe(
      tokens.expiryFor(DEPARTURE).getTime(),
    );
  });

  it("dies with the credential it re-issues, and not later", async () => {
    // Seven days past checkout, the same figure the cookie carries. A link that
    // outlived the credential would be a way to extend a bearer token by mailing
    // yourself a fresh copy of it.
    await tokens.mintStayLink(db, { bookingId, checkOut: DEPARTURE });

    const [row] = await db
      .select({ expiresAt: bookingLink.expiresAt })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, bookingId));

    expect(row?.expiresAt.getTime()).toBe(tokens.expiryFor(DEPARTURE).getTime());
  });

  it("refuses the second guest to follow it", async () => {
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    expect(await tokens.redeemStayLink(db, link)).not.toBeNull();
    expect(await tokens.redeemStayLink(db, link)).toBeNull();
  });

  it("records when it was followed, inside the life it was given", async () => {
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    await tokens.redeemStayLink(db, link);

    const [row] = await db
      .select({
        consumedAt: bookingLink.consumedAt,
        expiresAt: bookingLink.expiresAt,
      })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, bookingId));

    expect(row?.consumedAt).not.toBeNull();
    expect(row!.consumedAt!.getTime()).toBeLessThan(row!.expiresAt.getTime());
  });
});

describe("two people following one link at the same moment", () => {
  it("lets exactly one of them through", async () => {
    // The invariant the conditional `UPDATE` exists for, and the reason
    // redemption is not a read followed by a write. Both statements are in
    // flight before either has answered; Postgres makes the second wait on the
    // row, then re-tests `consumed_at is null` against the version the first
    // just wrote.
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    const outcomes = await Promise.all([
      tokens.redeemStayLink(db, link),
      tokens.redeemStayLink(db, link),
    ]);

    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
  });

  it("lets exactly one of them through however many arrive", async () => {
    const link = await tokens.mintAccountLink(db, { bookingId });

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, async () =>
        tokens.redeemAccountLink(db, link),
      ),
    );

    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);

    // And the row says so once, rather than eight times over.
    const [row] = await db
      .select({ consumedAt: bookingLink.consumedAt })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, bookingId));

    expect(row?.consumedAt).not.toBeNull();
  });
});

describe("the link that offers an account", () => {
  it("names the stay the account will attach to, once", async () => {
    const link = await tokens.mintAccountLink(db, { bookingId });

    expect(await tokens.redeemAccountLink(db, link)).toEqual({ bookingId });
    expect(await tokens.redeemAccountLink(db, link)).toBeNull();
  });

  it("lives an hour, not the week the stay link lives", async () => {
    // Two lifetimes in one envelope. A create link left standing for a week is a
    // week of anybody reaching that mailbox being able to become the guest.
    await tokens.mintAccountLink(db, { bookingId });

    const [row] = await db
      .select({ expiresAt: bookingLink.expiresAt })
      .from(bookingLink)
      .where(eq(bookingLink.bookingId, bookingId));

    const minutes = (row!.expiresAt.getTime() - Date.now()) / 60_000;

    expect(minutes).toBeGreaterThan(55);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it("hands back no credential for the stay", async () => {
    // The account door's business is the account. A claim returned from here
    // would make it a second way of minting the booking cookie, which is the one
    // thing the two links are separated to prevent.
    const link = await tokens.mintAccountLink(db, { bookingId });
    const redeemed = await tokens.redeemAccountLink(db, link);

    expect(Object.keys(redeemed ?? {})).toEqual(["bookingId"]);
  });
});

describe("a link presented at the wrong door", () => {
  it("is refused, and stays spendable at its own", async () => {
    // The purpose is part of the redeeming statement's `where`, so the hour-long
    // link that creates an account cannot be spent where a booking cookie is
    // handed out. A refusal that consumed the row would let anybody who guessed
    // the wrong door destroy a guest's link.
    const account = await tokens.mintAccountLink(db, { bookingId });

    expect(await tokens.redeemStayLink(db, account)).toBeNull();
    expect(await tokens.redeemAccountLink(db, account)).not.toBeNull();
  });

  it("is refused in the other direction too", async () => {
    const stay = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    expect(await tokens.redeemAccountLink(db, stay)).toBeNull();
    expect(await tokens.redeemStayLink(db, stay)).not.toBeNull();
  });
});

describe("a link that is not one this deployment issued", () => {
  it("refuses an edited signature", async () => {
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    expect(await tokens.redeemStayLink(db, withABrokenSignature(link))).toBeNull();

    // And the row is untouched, because a forgery must not spend a real link.
    expect(await tokens.redeemStayLink(db, link)).not.toBeNull();
  });

  it("refuses one signed under another secret", async () => {
    const elsewhere = service(`${SECRET}-but-different`);
    const theirs = await elsewhere.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    expect(await tokens.redeemStayLink(db, theirs)).toBeNull();
  });

  it("refuses the shapeless cases the same way", async () => {
    for (const presented of [undefined, "", "no-separator", ".", "x".repeat(600)]) {
      expect(await tokens.redeemStayLink(db, presented)).toBeNull();
    }
  });

  it("refuses a booking cookie presented as a link", async () => {
    // Both are signed under one key, and what separates them is what each has to
    // parse as. A cookie's payload names a stay and an expiry and carries no
    // link row, so it addresses nothing here.
    const cookie = tokens.mint({
      bookingId,
      reference: "AAAA-1111",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(await tokens.redeemStayLink(db, cookie)).toBeNull();
    expect(await tokens.redeemAccountLink(db, cookie)).toBeNull();
  });

  it("refuses a link presented as a booking cookie", async () => {
    // The same separation, the other way round: a link opens a stay by being
    // followed once, and it must never be pasteable into the cookie that opens
    // it on every request for a week.
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    expect(tokens.verify(link)).toBeNull();
  });
});

describe("a link whose deadline has passed", () => {
  it("is refused, however well signed it is", async () => {
    // Backdated rather than minted expired: a link that died before it was sent
    // is a mail with a dead link in it, which
    // `booking_link_outlives_the_mail_that_carried_it` refuses outright. What is
    // being tested is the ordinary case — a guest reading their mail tomorrow.
    const link = await tokens.mintAccountLink(db, { bookingId });

    await db
      .update(bookingLink)
      .set({
        createdAt: sql`now() - interval '3 hours'`,
        expiresAt: sql`now() - interval '1 hour'`,
      })
      .where(eq(bookingLink.bookingId, bookingId));

    expect(await tokens.redeemAccountLink(db, link)).toBeNull();
  });
});

describe("a link to a stay that has given up its anonymous access", () => {
  it("is refused, because the credential it would re-issue is gone", async () => {
    // The one place this file reads the revocation instant. Everywhere else it
    // is the ownership query's business — but a link that re-minted a cookie the
    // guest has already surrendered would hand back exactly what revocation took
    // away.
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    await db
      .update(booking)
      .set({ userId: AN_ACCOUNT, anonAccessRevokedAt: sql`now()` })
      .where(eq(booking.id, bookingId));

    expect(await tokens.redeemStayLink(db, link)).toBeNull();
  });

  it("refuses the account link to it as well", async () => {
    // A stay that already has an account has nothing for a create link to do,
    // and the link in a mail sent before the attach must not create a second
    // account against it.
    const link = await tokens.mintAccountLink(db, { bookingId });

    await db
      .update(booking)
      .set({ userId: AN_ACCOUNT, anonAccessRevokedAt: sql`now()` })
      .where(eq(booking.id, bookingId));

    expect(await tokens.redeemAccountLink(db, link)).toBeNull();
  });

  it("leaves a link to an attached stay alone until access is revoked", async () => {
    // Attaching an account is not by itself the surrender — a guest who signed
    // in before booking never had a cookie to give up, and their stay's links
    // are ordinary links.
    const link = await tokens.mintStayLink(db, {
      bookingId,
      checkOut: DEPARTURE,
    });

    await db
      .update(booking)
      .set({ userId: AN_ACCOUNT })
      .where(eq(booking.id, bookingId));

    expect(await tokens.redeemStayLink(db, link)).not.toBeNull();
  });
});
