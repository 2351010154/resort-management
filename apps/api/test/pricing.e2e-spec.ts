// The pricing write surface, end to end — `property-and-tariff.md` §3 and
// `FR-PRC-02`.
//
// Two things are on trial and they are not the same thing.
//
// The first is authority. `pricing.rate-plans` and `pricing.stay-restrictions`
// are the first matrix rows where a role holds 👁 and a route exists that would
// write the row, so this is the first suite that can show the difference
// between seeing a price and setting one. Every assertion about it is made
// against the real guard on a real route: no handler in `modules/pricing` names
// a role, and if one ever does these tests will still pass — which is why the
// 403s below are paired with a 200 for the same caller on the read route beside
// it. A 403 alone would also be produced by a route nobody can reach.
//
// The second is that the calendar is data. §3 states `NONREF` as `STANDARD`
// − 10% and `schema/pricing.ts` argues that the ten has to be a column a
// manager edits rather than a literal a deploy changes. The way to prove that
// is not to read the column back — it is to change it and then ask the public
// availability route for a price, which is what the last test of the rate-plan
// block does.
//
// The seed writes restrictions sparsely and at random within its stream, so
// this suite clears them before it starts — the same thing `availability.e2e`
// does, and for the same reason: a rule nobody wrote is a rule nobody can
// assert against.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { roomType } from "../src/database/schema/inventory.js";
import {
  rateCalendar,
  ratePlan,
  stayRestriction,
} from "../src/database/schema/pricing.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const SEED_FROM = parseDate("2027-03-01");

// Inside the twelve months the seed opens, so these nights start out priced.
const FIRST = "2027-04-05";
const LAST = "2027-04-09";
const NIGHTS = 5;

// Past the seeded horizon. Nothing has ever priced these, which is what makes
// them the test of a gap rather than of an overwrite.
const UNPUBLISHED = "2029-01-10";

const NEW_PRICE = 2_950_000n;

const MANAGER = {
  email: "quan.ly@mariva.test",
  fullName: "Nguyễn Thị Hạnh",
  role: "MANAGER",
  password: "manager-password-42",
} as const;

const RECEPTIONIST = {
  email: "le.tan@mariva.test",
  fullName: "Phạm Văn Dũng",
  role: "RECEPTIONIST",
  password: "reception-password-42",
} as const;

const ACCOUNTANT = {
  email: "ke.toan@mariva.test",
  fullName: "Trần Minh Khoa",
  role: "ACCOUNTANT",
  password: "accountant-password-42",
} as const;

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let manager: string;
let receptionist: string;
let accountant: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(sql`truncate staff_user, staff_session restart identity cascade`);

  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);
  await staff.create({ ...MANAGER });
  await staff.create({ ...RECEPTIONIST });
  await staff.create({ ...ACCOUNTANT });

  manager = await signIn(MANAGER.email, MANAGER.password);
  receptionist = await signIn(RECEPTIONIST.email, RECEPTIONIST.password);
  accountant = await signIn(ACCOUNTANT.email, ACCOUNTANT.password);
});

beforeEach(async () => {
  await db.delete(stayRestriction);
});

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

const as = (token: string) => ({
  get: (path: string) =>
    http().get(path).set("Authorization", `Bearer ${token}`),
  patch: (path: string) =>
    http().patch(path).set("Authorization", `Bearer ${token}`),
  put: (path: string) =>
    http().put(path).set("Authorization", `Bearer ${token}`),
});

const calendarRange = (from = FIRST, to = LAST) =>
  `/pricing/rate-calendar?roomType=DELUXE&from=${from}&to=${to}`;

const restrictionRange = (from = FIRST, to = LAST) =>
  `/pricing/stay-restrictions?roomType=DELUXE&from=${from}&to=${to}`;

/** The price the calendar actually holds, read past the API. */
async function storedGross(night: string): Promise<bigint | null> {
  const [row] = await db
    .select({ gross: rateCalendar.grossPerNight })
    .from(rateCalendar)
    .innerJoin(roomType, eq(roomType.id, rateCalendar.roomTypeId))
    .where(
      and(eq(roomType.code, "DELUXE"), eq(rateCalendar.stayDate, night)),
    )
    .limit(1);

  return row?.gross ?? null;
}

describe("who may see a price and who may set one", () => {
  // Each pair is one caller against one row: the read they hold and the write
  // they do not. Asserted together because a 403 on its own is also what an
  // unreachable route returns, and the read is what rules that out.

  it("lets a receptionist read the rate plans and refuses them the edit", async () => {
    await as(receptionist).get("/pricing/rate-plans").expect(200);

    const refused = await as(receptionist)
      .patch("/pricing/rate-plans/NONREF")
      .send({ percentAdjustment: -50 });

    expect(refused.status).toBe(403);
  });

  it("lets an accountant read the calendar and refuses them the price", async () => {
    await as(accountant).get(calendarRange()).expect(200);

    const refused = await as(accountant).put("/pricing/rate-calendar").send({
      roomType: "DELUXE",
      from: FIRST,
      to: LAST,
      grossPerNight: NEW_PRICE.toString(),
    });

    expect(refused.status).toBe(403);
  });

  it("lets a receptionist read the stay restrictions and refuses them the rule", async () => {
    await as(receptionist).get(restrictionRange()).expect(200);

    const refused = await as(receptionist)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 3 });

    expect(refused.status).toBe(403);
  });

  // The row beside it gives ACCOUNTANT 👁 over rates; this one gives them
  // nothing. A minimum stay is a rule about what the property will sell, and it
  // never reaches an invoice.
  it("refuses an accountant the stay restrictions altogether", async () => {
    const refused = await as(accountant).get(restrictionRange());

    expect(refused.status).toBe(403);
  });

  it("refuses a caller with no session at all", async () => {
    const refused = await http().get("/pricing/rate-plans");

    expect(refused.status).toBe(401);
  });

  it("lets a manager do all of it", async () => {
    await as(manager).get("/pricing/rate-plans").expect(200);
    await as(manager).get(calendarRange()).expect(200);
    await as(manager).get(restrictionRange()).expect(200);
  });
});

describe("the rate plans", () => {
  it("come back in the order the funnel offers them", async () => {
    const response = await as(manager).get("/pricing/rate-plans").expect(200);

    expect(
      response.body.plans.map((plan: { code: string }) => plan.code),
    ).toEqual(["STANDARD", "BB", "NONREF"]);
  });

  it("carry the derivation §3 states, not a formula in a service", async () => {
    const response = await as(manager).get("/pricing/rate-plans").expect(200);
    const byCode = new Map<string, Record<string, unknown>>(
      response.body.plans.map((plan: { code: string }) => [plan.code, plan]),
    );

    expect(byCode.get("NONREF")!.percentAdjustment).toBe(-10);
    expect(byCode.get("STANDARD")!.breakfastPerPersonGross).toBeNull();
    expect(BigInt(byCode.get("BB")!.breakfastPerPersonGross as string)).toBe(
      250_000n,
    );
  });

  it("leave the fields a PATCH did not name alone", async () => {
    const response = await as(manager)
      .patch("/pricing/rate-plans/BB")
      .send({ name: "Bed and breakfast, room only rate plus meal" })
      .expect(200);

    expect(BigInt(response.body.breakfastPerPersonGross)).toBe(250_000n);
    expect(response.body.percentAdjustment).toBe(0);
  });

  it("answer a PATCH that names nothing with the plan as it stands", async () => {
    // Not an error, and not an UPDATE either: Drizzle refuses an empty `set`,
    // and a statement that writes nothing has no business taking a row lock.
    const response = await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({})
      .expect(200);

    expect(response.body.code).toBe("NONREF");
    expect(response.body.percentAdjustment).toBe(-10);
  });

  it("refuse to edit a plan the property has not laid down", async () => {
    // The enum keeps an invented code off the wire, so the only way to reach
    // this is a database migrated and never seeded — which is exactly when a
    // silent zero-row write would be the worst answer.
    await db.execute(sql`delete from ${ratePlan} where ${ratePlan.code} = 'NONREF'`);

    try {
      await as(manager)
        .patch("/pricing/rate-plans/NONREF")
        .send({ name: "Non-refundable" })
        .expect(404);

      // The same answer when the PATCH names no field: a plan that is not
      // there cannot be read back either.
      await as(manager)
        .patch("/pricing/rate-plans/NONREF")
        .send({})
        .expect(404);
    } finally {
      await db.insert(ratePlan).values({
        code: "NONREF",
        name: "Non-refundable",
        percentAdjustment: -10,
        breakfastPerPersonGross: null,
        displayOrder: 3,
      });
    }
  });

  it("tell an omitted breakfast from a cleared one", async () => {
    const cleared = await as(manager)
      .patch("/pricing/rate-plans/BB")
      .send({ breakfastPerPersonGross: null })
      .expect(200);

    expect(cleared.body.breakfastPerPersonGross).toBeNull();

    const restored = await as(manager)
      .patch("/pricing/rate-plans/BB")
      .send({ breakfastPerPersonGross: "250000" })
      .expect(200);

    expect(BigInt(restored.body.breakfastPerPersonGross)).toBe(250_000n);
  });

  it("refuse a discount that would pay the guest to stay", async () => {
    const refused = await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({ percentAdjustment: -150 });

    expect(refused.status).toBe(400);
  });

  // Zero breakfast is not breakfast at no charge — it is a folio line saying
  // something happened that did not. The column's own check says so; this
  // asserts the wire refuses it first, with a message naming the field.
  it("refuse a breakfast of nothing", async () => {
    const refused = await as(manager)
      .patch("/pricing/rate-plans/BB")
      .send({ breakfastPerPersonGross: "0" });

    expect(refused.status).toBe(400);
  });

  // The one that matters. §3's ten per cent is a column precisely so that
  // changing it changes what a guest is quoted, and the only proof of that is
  // to change it and then ask the public route.
  it("reprice the public availability quote when the discount moves", async () => {
    const before = await http()
      .get(`/availability?checkIn=${FIRST}&checkOut=${LAST}&plan=NONREF`)
      .expect(200);

    await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({ percentAdjustment: -25 })
      .expect(200);

    const after = await http()
      .get(`/availability?checkIn=${FIRST}&checkOut=${LAST}&plan=NONREF`)
      .expect(200);

    const quoted = (body: {
      offers: { code: string; stayTotalGross: string }[];
    }) => BigInt(body.offers.find((offer) => offer.code === "DELUXE")!.stayTotalGross);

    // −10% became −25%, so the standard total the two are derived from can be
    // recovered from either and must agree.
    expect((quoted(before.body) * 100n) / 90n).toBe(
      (quoted(after.body) * 100n) / 75n,
    );
    expect(quoted(after.body)).toBeLessThan(quoted(before.body));

    await as(manager)
      .patch("/pricing/rate-plans/NONREF")
      .send({ percentAdjustment: -10 })
      .expect(200);
  });
});

describe("the rate calendar", () => {
  it("returns every night of the range, gaps included", async () => {
    const response = await as(manager)
      .get(calendarRange(UNPUBLISHED, "2029-01-12"))
      .expect(200);

    expect(response.body.nights).toHaveLength(3);
    expect(response.body.nights.map((n: { date: string }) => n.date)).toEqual([
      "2029-01-10",
      "2029-01-11",
      "2029-01-12",
    ]);

    // A night the property has not published is a gap and not a zero. The
    // guest-facing calendar renders it as unavailable; a manager has to be able
    // to see that it is unpriced.
    for (const night of response.body.nights) {
      expect(night.grossPerNight).toBeNull();
    }
  });

  it("prices a range at one figure and says how many nights it wrote", async () => {
    const response = await as(manager)
      .put("/pricing/rate-calendar")
      .send({
        roomType: "DELUXE",
        from: FIRST,
        to: LAST,
        grossPerNight: NEW_PRICE.toString(),
      })
      .expect(200);

    expect(response.body).toEqual({ roomType: "DELUXE", nights: NIGHTS });

    const read = await as(manager).get(calendarRange()).expect(200);

    expect(read.body.nights).toHaveLength(NIGHTS);
    for (const night of read.body.nights) {
      expect(BigInt(night.grossPerNight)).toBe(NEW_PRICE);
    }
  });

  it("leaves the night after the range alone", async () => {
    const after = "2027-04-10";
    const before = await storedGross(after);

    await as(manager)
      .put("/pricing/rate-calendar")
      .send({
        roomType: "DELUXE",
        from: FIRST,
        to: LAST,
        grossPerNight: NEW_PRICE.toString(),
      })
      .expect(200);

    expect(await storedGross(after)).toBe(before);
  });

  it("prices a night nobody had published before", async () => {
    await as(manager)
      .put("/pricing/rate-calendar")
      .send({
        roomType: "DELUXE",
        from: UNPUBLISHED,
        to: UNPUBLISHED,
        grossPerNight: NEW_PRICE.toString(),
      })
      .expect(200);

    expect(await storedGross(UNPUBLISHED)).toBe(NEW_PRICE);
  });

  // What makes it a PUT. Repricing a season the property has already published
  // is the common edit, and the second call has to be the same answer as the
  // first rather than a unique-violation.
  it("is the same answer sent twice", async () => {
    const body = {
      roomType: "DELUXE",
      from: FIRST,
      to: LAST,
      grossPerNight: NEW_PRICE.toString(),
    };

    const first = await as(manager)
      .put("/pricing/rate-calendar")
      .send(body)
      .expect(200);
    const second = await as(manager)
      .put("/pricing/rate-calendar")
      .send(body)
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(await storedGross(FIRST)).toBe(NEW_PRICE);
  });

  it("reaches the public quote", async () => {
    await as(manager)
      .put("/pricing/rate-calendar")
      .send({
        roomType: "DELUXE",
        from: FIRST,
        to: LAST,
        grossPerNight: NEW_PRICE.toString(),
      })
      .expect(200);

    // The stay departs the day *after* the last night priced above. An edit
    // names its first and last night; a stay names an arrival and a departure,
    // and the departure is not a night sold. Asking for `LAST` as the check-out
    // would quote four of the five nights just repriced and the sum would be
    // short by one, which is the arithmetic the two conventions exist to keep
    // straight.
    const quote = await http()
      .get(`/availability?checkIn=${FIRST}&checkOut=2027-04-10&plan=STANDARD`)
      .expect(200);

    const deluxe = quote.body.offers.find(
      (offer: { code: string }) => offer.code === "DELUXE",
    );

    expect(BigInt(deluxe.stayTotalGross)).toBe(NEW_PRICE * BigInt(NIGHTS));
  });

  it("refuses a range that ends before it begins", async () => {
    const refused = await as(manager).put("/pricing/rate-calendar").send({
      roomType: "DELUXE",
      from: LAST,
      to: FIRST,
      grossPerNight: NEW_PRICE.toString(),
    });

    expect(refused.status).toBe(400);
  });

  // A mistyped year is the way this goes wrong, and it writes several thousand
  // rows before anybody notices the price is wrong on all of them.
  it("refuses a range longer than the calendar it is editing", async () => {
    const refused = await as(manager).put("/pricing/rate-calendar").send({
      roomType: "DELUXE",
      from: FIRST,
      to: "2030-04-05",
      grossPerNight: NEW_PRICE.toString(),
    });

    expect(refused.status).toBe(400);
  });

  it("refuses a free night, which is a comp and not a rate", async () => {
    const refused = await as(manager).put("/pricing/rate-calendar").send({
      roomType: "DELUXE",
      from: FIRST,
      to: LAST,
      grossPerNight: "0",
    });

    expect(refused.status).toBe(400);
  });
});

describe("the stay restrictions", () => {
  const rule = {
    roomType: "DELUXE",
    from: FIRST,
    to: LAST,
    minimumStay: 3,
    closedToArrival: true,
  };

  it("returns only the nights that carry a rule", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ ...rule, from: FIRST, to: FIRST })
      .expect(200);

    const response = await as(manager).get(restrictionRange()).expect(200);

    // One rule written, one night returned — not five nights of "no rule".
    expect(response.body.restrictions).toHaveLength(1);
    expect(response.body.restrictions[0]).toMatchObject({
      date: FIRST,
      minimumStay: 3,
      maximumStay: null,
      closedToArrival: true,
      closedToDeparture: false,
    });
  });

  it("writes one rule across the range", async () => {
    const response = await as(manager)
      .put("/pricing/stay-restrictions")
      .send(rule)
      .expect(200);

    expect(response.body).toEqual({
      roomType: "DELUXE",
      nights: NIGHTS,
      cleared: false,
    });

    const read = await as(manager).get(restrictionRange()).expect(200);

    expect(read.body.restrictions).toHaveLength(NIGHTS);
  });

  // A field the caller did not send is the unrestricted value, not whatever was
  // on the night before. A rule that silently kept half of its predecessor
  // would be a rule nobody could read off the request that wrote it.
  it("does not carry a flag over from the rule it replaces", async () => {
    await as(manager).put("/pricing/stay-restrictions").send(rule).expect(200);

    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 2 })
      .expect(200);

    const read = await as(manager).get(restrictionRange()).expect(200);

    expect(read.body.restrictions[0]).toMatchObject({
      minimumStay: 2,
      closedToArrival: false,
    });
  });

  it("removes the rows when the rule written is no rule", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ ...rule, from: FIRST, to: "2027-04-07" })
      .expect(200);

    const response = await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST })
      .expect(200);

    // Three rows removed over a five-night range: the count is what was
    // actually there, which is the number that tells the manager which of their
    // rules existed.
    expect(response.body).toEqual({
      roomType: "DELUXE",
      nights: 3,
      cleared: true,
    });

    const read = await as(manager).get(restrictionRange()).expect(200);

    expect(read.body.restrictions).toHaveLength(0);
  });

  it("refuses a maximum below the minimum", async () => {
    const refused = await as(manager).put("/pricing/stay-restrictions").send({
      roomType: "DELUXE",
      from: FIRST,
      to: LAST,
      minimumStay: 4,
      maximumStay: 2,
    });

    expect(refused.status).toBe(400);
  });

  // `FR-PRC-02` rejects at query time and not at booking time, and the
  // availability route is where that happens. A rule written here has to reach
  // it, or the calendar is greying nothing.
  it("reach the public quote", async () => {
    await as(manager)
      .put("/pricing/stay-restrictions")
      .send({ roomType: "DELUXE", from: FIRST, to: LAST, minimumStay: 4 })
      .expect(200);

    const quote = await http()
      .get(`/availability?checkIn=${FIRST}&checkOut=2027-04-07&plan=STANDARD`)
      .expect(200);

    const deluxe = quote.body.offers.find(
      (offer: { code: string }) => offer.code === "DELUXE",
    );

    // Two nights against a four-night minimum. The offer still carries its
    // price — the funnel greys the cell and says why rather than hiding a room
    // and saying nothing.
    expect(deluxe.isAvailable).toBe(false);
    expect(BigInt(deluxe.stayTotalGross)).toBeGreaterThan(0n);
  });
});

describe("a room type the property does not have", () => {
  it("is refused at the wire, before any lookup", async () => {
    const refused = await as(manager).get(
      "/pricing/rate-calendar?roomType=PENTHOUSE&from=" +
        FIRST +
        "&to=" +
        LAST,
    );

    // `room_type_code` is a Postgres enum built from the same tuple the wire
    // schema is, so an unknown code never reaches the 404 in `room-type-id.ts`.
    // That branch is for a database migrated and not seeded.
    expect(refused.status).toBe(400);
  });
});
