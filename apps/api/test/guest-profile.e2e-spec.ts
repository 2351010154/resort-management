// The guest's own record of themselves — `FR-GST-01` over HTTP, against a real
// Postgres, the real capability guard and a real Better Auth session.
//
// Five claims, and each is a way the profile could be wrong while every other
// test in the tree stayed green.
//
// 1. **The three sources arrive as one shape, and each is really its own.** The
//    account's address, the guest's own claim about themselves, the property's
//    masked record of them, and the two derived figures. The tier is computed
//    from stays and the balance summed off the ledger, so both are asserted
//    against fixtures set to make one answer right and its neighbour wrong.
// 2. **The balance excludes expired points and includes the ones expiring
//    today.** §7 expires points at the *end* of 31 December of `Y+1`, so a
//    strict comparison takes a guest's points away a day early — which is a
//    defect nothing else would notice, because the balance is a sum and a sum
//    that is short still looks like a number.
// 3. **The editable set is exactly four fields.** A `PATCH` naming a CCCD, an
//    address or a tier is refused rather than answered `200` having changed
//    nothing. `contract/guest.spec.ts` pins the schema; this pins that the route
//    is behind it.
// 4. **An edit is feed-forward, and that is asserted as bytes.** Every
//    `registration`, `guest`, `booking` and `folio` row the account has is
//    photographed before the edit and compared after it. This is the case the
//    whole table shape exists for: `registration` denormalises nothing, so its
//    append-only guarantee is only as strong as the immutability of the `guest`
//    row it points at, and a profile that wrote there would leave every
//    registration byte-identical and meaning somebody else.
// 5. **A profile is the session's and nobody else's.** There is no route
//    carrying an account id, so the refusals are structural: a second guest gets
//    their own profile, a caller with no session is refused, and a member of
//    staff — who holds `👁` on this row for a screen that names a guest — is
//    refused here, where nothing names one.
//
// The fixtures are written straight to the tables rather than driven through the
// funnel and the desk. What is under test is a read across four tables and a
// write into one, and a stay booked, confirmed, checked in and checked out
// through eight routes would put the rate calendar, the room inventory and §4's
// clock between this file and the thing it is about. The account and its session
// are the exception and are real all the way through: the guard resolves the
// subject from the cookie, so a fixture that inserted a `guest_user` row would
// have nothing to send.

import "reflect-metadata";

import { type CalendarDate, parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  CAPABILITY_KEY,
  type CapabilityRequirement,
} from "../src/common/auth/access.decorators.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import { systemConfig } from "../src/database/schema/config.js";
import { folio } from "../src/database/schema/folio.js";
import { guest, registration } from "../src/database/schema/guest.js";
import { guestUser } from "../src/database/schema/index.js";
import { roomType } from "../src/database/schema/inventory.js";
import { loyaltyLedger } from "../src/database/schema/loyalty.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";
import { GuestProfileController } from "../src/modules/guest/guest-profile.controller.js";
import {
  MailerService,
  type OutgoingEmail,
} from "../src/modules/notification/mailer.service.js";

/** One night at the price the guest agreed to, gross. Never read back. */
const A_NIGHT = 1_000_000n;

/**
 * A rung no fixture reaches by accident.
 *
 * The revenue axis is put out of reach in every case here, so the tier this file
 * asserts moved on the stay count and nothing else — a ladder both axes could
 * climb would pass whichever one the implementation happened to read.
 */
const UNREACHABLE_REVENUE = 1_000_000_000_000n;

/** The number on the document the desk took at Anh's first stay. */
const AN_OLD_CCCD = "079301880001";

/** And at her most recent one, which is the number the profile must show. */
const THE_LATEST_CCCD = "079301880002";

const RECEPTIONIST = {
  email: "le.tan.profile@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

const ANH = {
  name: "Anh Nguyễn",
  email: "anh.profile@example.test",
  password: "correct-horse-battery",
} as const;

const BINH = {
  name: "Bình Trần",
  email: "binh.profile@example.test",
  password: "battery-horse-correct",
} as const;

/** Captures what would have been sent, so a verification link can be followed
 *  in a test the way a guest follows it out of an inbox. */
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
let mailer: RecordingMailer;
let roomTypeId: string;
let deskToken: string;
let anh: request.Agent;
let binh: request.Agent;
let anhId: string;

/** References and stay ids are unique per fixture. Counted rather than drawn,
 *  so a failing run reproduces. */
let ordinal = 0;

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
  await emptyWhatThisFileWrites();

  roomTypeId = await aRoomType();

  // Midnight rollover, so the property's day is its calendar day and this file
  // can date its fixtures from `Intl` without borrowing the arithmetic under
  // test. One stay reaches silver and no ladder is reachable on revenue.
  await theConfigurationIs({ silverStays: 1, goldStays: 900 });

  await app.get(StaffUserService).create({ ...RECEPTIONIST });

  deskToken = await signInAsDesk();
  anh = await signedInGuest(ANH);
  binh = await signedInGuest(BINH);
  anhId = await accountId(ANH.email);

  await aHistoryFor(anhId);
}, 120_000);

afterAll(async () => {
  // The next file to run seeds, and its wipe cannot delete a booking a folio
  // names or an account a booking names. Neither is that seed's to own.
  await emptyWhatThisFileWrites();
  await app?.close();
});

describe("the capability each profile route declares", () => {
  const reflector = new Reflector();

  it("names the profile row for the read, as a read", () => {
    // The action is the half worth pinning. `access.decorators.ts` defaults it
    // to `write`, and forgetting it here would refuse the three staff roles the
    // matrix hands a 👁 over this row.
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        GuestProfileController.prototype.readProfile,
      ),
    ).toEqual({ key: "guest.profile", action: "read" });
  });

  it("names the same row for the edit, as a write", () => {
    // The whole of what stops a 👁 grant editing a guest's details: one row, two
    // actions, and no second capability invented to say it.
    expect(
      reflector.get<CapabilityRequirement>(
        CAPABILITY_KEY,
        GuestProfileController.prototype.updateProfile,
      ),
    ).toEqual({ key: "guest.profile", action: "write" });
  });

  it("refuses a caller holding no session at all", async () => {
    // 401 and not 403 — nobody at all is asked to sign in, where somebody
    // holding the wrong authority is refused.
    await http().get("/profile").expect(401);
    await http().patch("/profile").send({ phone: "0900000000" }).expect(401);
  });
});

describe("the profile a guest reads about themselves", () => {
  it("answers with the account, the property's masked record, and both derived figures", async () => {
    const profile = await profileOf(anh);

    expect(profile).toMatchObject({
      id: anhId,
      // Nothing has been declared yet, so the name is the one the account
      // registered under and the three optional fields are absent.
      fullName: ANH.name,
      email: ANH.email,
      phone: null,
      dateOfBirth: null,
      nationality: null,
    });

    // An instant, not a day: this is when the account was opened.
    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("shows the number off the most recent stay it registered, masked", async () => {
    // Masked and only masked — the plain number leaves on `guest.unmask-cccd`,
    // which is a staff row audited per call. And the *latest* registration:
    // a guest whose document was retaken has one number on file that matters.
    const profile = await profileOf(anh);

    expect(profile.cccdMasked).toBe(masked(THE_LATEST_CCCD));
    expect(profile.cccdMasked).not.toBe(masked(AN_OLD_CCCD));

    // Nothing in the answer can carry the number itself.
    expect(JSON.stringify(profile)).not.toContain(THE_LATEST_CCCD);
  });

  it("derives the tier from the guest's own finished stays", async () => {
    // One stay clears the rung the configuration sets, and the revenue axis is
    // out of reach — so this answer moved on the count and nothing else.
    expect((await profileOf(anh)).vipTier).toBe("SILVER");

    // The same derivation, one rung higher, without anything being stored: the
    // tier follows the ladder because it is computed on every read.
    await theConfigurationIs({ silverStays: 1, goldStays: 3 });

    expect((await profileOf(anh)).vipTier).toBe("GOLD");

    await theConfigurationIs({ silverStays: 1, goldStays: 900 });
  });

  it("sums the ledger, keeping the points that expire today and dropping the ones that expired", async () => {
    // §7 expires points at the end of the day the row names, so a point whose
    // expiry is today is still the guest's. The expired row is what makes this
    // a sum with a predicate rather than a sum.
    expect((await profileOf(anh)).loyaltyPoints).toBe("1700");
  });

  it("answers an account with no history at all", async () => {
    // The base tier is an absence rather than a row, an empty ledger sums to
    // zero rather than to nothing, and a guest the property has never
    // identified has no number on file — which is different from having one
    // withheld.
    expect(await profileOf(binh)).toMatchObject({
      fullName: BINH.name,
      email: BINH.email,
      cccdMasked: null,
      vipTier: "MEMBER",
      loyaltyPoints: "0",
    });
  });
});

describe("the four fields a guest may change", () => {
  it("saves them and answers with the profile as it now stands", async () => {
    const saved = await binh
      .patch("/profile")
      .send({
        fullName: "Bình Trần Văn",
        phone: "0901234567",
        dateOfBirth: "1990-04-17",
        nationality: "Việt Nam",
      })
      .expect(200);

    expect(saved.body).toMatchObject({
      fullName: "Bình Trần Văn",
      phone: "0901234567",
      // Nine characters and not an object of loose numbers — the crossing
      // `stay-date.ts` declares and the controller performs.
      dateOfBirth: "1990-04-17",
      nationality: "Việt Nam",
      // The derived half travels back with them, so a screen that saved a field
      // does not have to fetch the page again.
      vipTier: "MEMBER",
      loyaltyPoints: "0",
    });

    expect(await profileOf(binh)).toMatchObject({
      fullName: "Bình Trần Văn",
      phone: "0901234567",
    });
  });

  it("leaves the fields an edit did not name alone", async () => {
    // The whole reason the route is a `PATCH`. A screen editing one field sends
    // one field, and the three it did not send are not instructions to clear.
    await binh.patch("/profile").send({ phone: "0907654321" }).expect(200);

    expect(await profileOf(binh)).toMatchObject({
      fullName: "Bình Trần Văn",
      phone: "0907654321",
      dateOfBirth: "1990-04-17",
      nationality: "Việt Nam",
    });
  });

  it("clears a field the guest sent null for, and falls back for the name", async () => {
    await binh
      .patch("/profile")
      .send({ nationality: null, fullName: null })
      .expect(200);

    const profile = await profileOf(binh);

    expect(profile.nationality).toBeNull();
    // Cleared, not blanked: the account's registered name is what a guest with
    // no declared name is called, and `guest_user_profile` stores the absence
    // rather than a copy of it.
    expect(profile.fullName).toBe(BINH.name);
  });

  it("takes an edit that changes nothing", async () => {
    // Reachable from a form that saved without touching anything. The service
    // writes no row for it — `on conflict do update set` with nothing to set is
    // not a statement Postgres will take — and the answer is still the profile.
    const before = await profileOf(binh);

    expect((await binh.patch("/profile").send({}).expect(200)).body).toEqual(
      before,
    );
  });

  it("refuses a field that is not the guest's to change", async () => {
    // The failure this exists to prevent is a 200 for a caller who sent a CCCD
    // and changed nothing at all.
    for (const forbidden of [
      { cccdNumber: "079301880003" },
      { email: "someone.else@example.test" },
      { vipTier: "GOLD" },
      { loyaltyPoints: "9999" },
    ]) {
      await binh.patch("/profile").send(forbidden).expect(400);
    }

    expect((await profileOf(binh)).cccdMasked).toBeNull();
  });

  it("refuses a name that is blank once trimmed", async () => {
    await binh.patch("/profile").send({ fullName: "   " }).expect(400);
  });
});

describe("what an edit may never reach", () => {
  it("leaves every registration, guest, booking and folio the account has exactly as they were", async () => {
    // `FR-GST-01`'s feed-forward rule, asserted as bytes rather than as a
    // behaviour. Anh has two registrations against two finished stays, and the
    // edit below restates every field a profile can carry — including the name
    // and the birthday, which are what a `guest` row also holds and what a
    // careless implementation would "correct" there.
    const before = await theHistoryOf(anhId);

    expect(before.registrations).toHaveLength(2);
    expect(before.guests).toHaveLength(2);

    await anh
      .patch("/profile")
      .send({
        fullName: "Someone Else Entirely",
        phone: "0900000001",
        dateOfBirth: "1971-01-01",
        nationality: "Nowhere",
      })
      .expect(200);

    expect(await theHistoryOf(anhId)).toEqual(before);

    // And the claim really did land somewhere — otherwise the assertion above
    // would pass for an endpoint that wrote nothing at all.
    expect(await profileOf(anh)).toMatchObject({
      fullName: "Someone Else Entirely",
      nationality: "Nowhere",
    });

    // Including the masked number, which is still the property's and not the
    // one the guest just claimed a new identity behind.
    expect((await profileOf(anh)).cccdMasked).toBe(masked(THE_LATEST_CCCD));
  });
});

describe("whose profile a session opens", () => {
  it("answers each guest with their own, and there is no path that names another", async () => {
    // The security claim is the *shape* of the route: `/profile` carries no
    // account id, so there is nothing for a caller to substitute and no
    // ownership comparison for a handler to forget.
    expect((await profileOf(anh)).id).toBe(anhId);
    expect((await profileOf(binh)).id).not.toBe(anhId);

    // And the route somebody would reach for if there were one does not exist.
    await binh.get(`/profile/${anhId}`).expect(404);
  });

  it("refuses a member of staff, who holds the row's 👁 over a different screen", async () => {
    // The grant is for the desk reading a guest it has named — `guest.read-
    // record` next door. `/profile` names nobody, so a staff session has no
    // subject here and is refused rather than answered with somebody's account.
    await http()
      .get("/profile")
      .set("Authorization", `Bearer ${deskToken}`)
      .expect(403);
  });

  it("refuses a member of staff the edit outright, at the guard", async () => {
    // A 👁 grant on a route that writes is the wrong authority rather than the
    // wrong identity, and the matrix says so without a second row.
    await http()
      .patch("/profile")
      .set("Authorization", `Bearer ${deskToken}`)
      .send({ phone: "0900000000" })
      .expect(403);
  });
});

function http(): request.Agent {
  return request(app.getHttpServer());
}

/** The profile as the screen reads it. */
async function profileOf(
  who: request.Agent,
): Promise<Record<string, string | null>> {
  return (await who.get("/profile").expect(200)).body;
}

/** The mask `cccd-mask.ts` computes, restated so the expectation is not the
 *  implementation. */
function masked(cccdNumber: string): string {
  return `${"*".repeat(cccdNumber.length - 4)}${cccdNumber.slice(-4)}`;
}

/**
 * The property's own calendar date, read from `Intl` rather than from the
 * service under test.
 *
 * At UTC+7 the property's date and the process's UTC date disagree for the last
 * seven hours of every day, so a fixture dated in UTC would drift past the
 * window's edge for those seven hours — a suite that fails in the evening and
 * passes in the morning.
 */
function today(): CalendarDate {
  return parseDate(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
}

/**
 * The property's whole configuration, with §7's ladder set to this file's
 * figures.
 *
 * Written as one row rather than as an edit, for `tier-derivation.e2e-spec.ts`'s
 * reason: a case that patched four columns of a row another case left behind
 * would depend on the order the file ran in.
 */
async function theConfigurationIs(rungs: {
  silverStays: number;
  goldStays: number;
}): Promise<void> {
  await db.execute(sql`truncate system_config`);
  await db.insert(systemConfig).values({
    // Unreal and well above zero on both — §8 forbids a real rate in the tree,
    // and a rate of nothing would make the net and the gross one figure.
    standardVatRateBps: 1_234,
    reducedVatRateBps: 2_468,
    reducedVatFrom: null,
    reducedVatTo: null,
    vatIncludesServiceCharge: true,
    serviceChargeRateBps: 321,
    businessDateRolloverHour: 0,
    loyaltyPointsPerUnit: 1,
    loyaltyEarnUnitVnd: 1n,
    tierSilverStays: rungs.silverStays,
    tierSilverRevenueVnd: UNREACHABLE_REVENUE,
    tierGoldStays: rungs.goldStays,
    tierGoldRevenueVnd: UNREACHABLE_REVENUE,
  });
}

/**
 * Two finished stays, each with a document taken at the desk and a ledger row
 * behind it — enough history for a tier, a balance and a masked number.
 *
 * The three ledger rows carry three expiries on purpose: one well in the
 * future, one falling today, and one that has already passed. A balance that
 * compared strictly would drop the middle row, and a balance with no predicate
 * at all would keep the last.
 */
async function aHistoryFor(userId: string): Promise<void> {
  const older = await aFinishedStay(userId, 200);
  const latest = await aFinishedStay(userId, 20);

  await aRegistration(older.bookingId, AN_OLD_CCCD, 200);
  await aRegistration(latest.bookingId, THE_LATEST_CCCD, 20);

  const third = await aFinishedStay(userId, 40);

  await db.insert(loyaltyLedger).values([
    {
      userId,
      folioId: older.folioId,
      pointsEarned: 1_200n,
      expiresAt: today().add({ years: 1 }).toString(),
    },
    {
      userId,
      folioId: latest.folioId,
      pointsEarned: 500n,
      expiresAt: today().toString(),
    },
    {
      userId,
      folioId: third.folioId,
      pointsEarned: 800n,
      expiresAt: today().subtract({ days: 1 }).toString(),
    },
  ]);
}

/** A stay this account took and finished, with an account of its own. */
async function aFinishedStay(
  userId: string,
  daysAgo: number,
): Promise<{ bookingId: string; folioId: string }> {
  ordinal += 1;

  const departure = today().subtract({ days: daysAgo });
  const [stay] = await db
    .insert(booking)
    .values({
      reference: `MRV-PROF-${String(ordinal).padStart(4, "0")}`,
      state: "CHECKED_OUT",
      roomTypeId,
      userId,
      checkInDate: departure.subtract({ days: 1 }).toString(),
      checkOutDate: departure.toString(),
      ratePlanCode: "STANDARD",
      adults: 2,
      quotedStayTotalGross: A_NIGHT,
      quotedPercentAdjustment: 0,
      quotedExtraPersonPerNightGross: 600_000n,
    })
    .returning({ id: booking.id });

  const [account] = await db
    .insert(folio)
    .values({ bookingId: stay!.id, state: "CLOSED", closedAt: new Date() })
    .returning({ id: folio.id });

  return { bookingId: stay!.id, folioId: account!.id };
}

/**
 * A person registered as the holder of one stay, carrying the number the desk
 * read off their document.
 *
 * `registered_at` is set rather than defaulted, because which registration is
 * the *latest* is exactly what the read under test orders by.
 */
async function aRegistration(
  bookingId: string,
  cccdNumber: string,
  daysAgo: number,
): Promise<void> {
  const [person] = await db
    .insert(guest)
    .values({
      fullName: "Nguyễn Thị Anh",
      cccdNumber,
      dateOfBirth: "1988-02-02",
      nationality: "Việt Nam",
    })
    .returning({ id: guest.id });

  await db.insert(registration).values({
    bookingId,
    guestId: person!.id,
    isPrimary: true,
    registeredAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });
}

/**
 * Every row an edit must not reach, photographed.
 *
 * The four tables `FR-GST-01` names, read whole rather than by a column or two:
 * a comparison over selected fields would pass an implementation that rewrote
 * the one field nobody thought to select.
 */
async function theHistoryOf(userId: string): Promise<{
  bookings: unknown[];
  folios: unknown[];
  registrations: unknown[];
  guests: unknown[];
}> {
  const stays = await db
    .select()
    .from(booking)
    .where(eq(booking.userId, userId))
    .orderBy(booking.reference);

  const ids = stays.map((stay) => stay.id);

  const accounts = await db.select().from(folio).orderBy(folio.bookingId);
  const registered = await db
    .select()
    .from(registration)
    .orderBy(registration.registeredAt);
  const people = await db.select().from(guest).orderBy(guest.cccdNumber);

  return {
    bookings: stays,
    folios: accounts.filter((account) => ids.includes(account.bookingId)),
    registrations: registered.filter((row) => ids.includes(row.bookingId)),
    guests: people,
  };
}

/** The account Better Auth minted for an address. */
async function accountId(email: string): Promise<string> {
  const [row] = await db
    .select({ id: guestUser.id })
    .from(guestUser)
    .where(sql`lower(${guestUser.email}) = lower(${email})`)
    .limit(1);

  if (!row) {
    throw new Error(`No account was created for ${email}`);
  }

  return row.id;
}

async function signInAsDesk(): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email: RECEPTIONIST.email, password: RECEPTIONIST.password })
    .expect(200);

  return response.body.accessToken as string;
}

/**
 * A guest realm account with a live session on it.
 *
 * Signed up, verified through the link the mailer captured and signed in — the
 * whole of what a guest does, because the session cookie is what the guard
 * resolves the account from and a fixture that inserted a `guest_user` row would
 * have nothing to send.
 */
async function signedInGuest(who: {
  name: string;
  email: string;
  password: string;
}): Promise<request.Agent> {
  await http()
    .post("/api/auth/sign-up/email")
    .send({ name: who.name, email: who.email, password: who.password })
    .expect(200);

  const link = new URL(mailer.linkTo(who.email));

  await http().get(`${link.pathname}${link.search}`).expect(302);

  const agent = request.agent(app.getHttpServer());

  await agent
    .post("/api/auth/sign-in/email")
    .send({ email: who.email, password: who.password })
    .expect(200);

  return agent;
}

/** A room type to hang a booking on, and only if the database holds none. */
async function aRoomType(): Promise<string> {
  const [existing] = await db.select({ id: roomType.id }).from(roomType).limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db
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

  return created!.id;
}

/**
 * The rows this file leaves behind, and only those.
 *
 * `truncate … cascade` rather than a delete: `folio_posting` refuses a `DELETE`
 * outright, the append-only trigger raising on it for every client. The cascade
 * reaches the registrations through the bookings they name and the profile rows
 * through the accounts they key on.
 */
async function emptyWhatThisFileWrites(): Promise<void> {
  await db.execute(
    sql`truncate guest_user_profile, loyalty_ledger, payment, folio_posting, folio, room_assignment, booking_night, booking, registration, cccd_unmask_audit, guest, guest_user, guest_session, guest_account, guest_verification, staff_user, staff_session restart identity cascade`,
  );
}
