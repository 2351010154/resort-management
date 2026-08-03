// Room closure, end to end — `FR-INV-04`.
//
// The requirement's acceptance is one sentence with two halves: closure changes
// `total_rooms`, and housekeeping status never does. The second half is the one
// worth a test even though M3 builds no housekeeping — it is the confusion the
// requirement exists to prevent, and asserting that the two are separate now is
// cheaper than discovering at M4 that somebody wired them together.
//
// The other half of the story is the RBAC row. `inventory.close-room` is
// `MANAGER` and `ADMIN`, and a receptionist reaching for it gets a 403 — from
// the guard, off the matrix, not from a check written into this endpoint.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { booking } from "../src/database/schema/booking.js";
import {
  room,
  roomAssignment,
  roomType,
  typeInventory,
} from "../src/database/schema/inventory.js";
import { seedDatabase } from "../src/database/seed/seed.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const SEED_FROM = parseDate("2027-06-01");

// 201 is a Superior — the seed lays the types down in display order and the
// twelve Superiors take the first twelve numbers.
const SUPERIOR_ROOM = "201";
const SUPERIOR_ROOMS = 12;

const CHECK_IN = "2027-06-10";
const CHECK_OUT = "2027-06-13";
const NIGHTS = 3;

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

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let managerToken: string;
let receptionistToken: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  db = app.get<Database>(DRIZZLE);

  await migrate(db, { migrationsFolder: "./src/database/migrations" });
  await db.execute(sql`truncate staff_user, staff_session restart identity cascade`);

  // No synthetic stays: every assertion below counts rooms, and five hundred
  // random holds would make "one fewer Superior" a number nobody can predict.
  await seedDatabase(db, { from: SEED_FROM, bookings: 0 });

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);
  await staff.create({ ...MANAGER });
  await staff.create({ ...RECEPTIONIST });

  managerToken = await signIn(MANAGER.email, MANAGER.password);
  receptionistToken = await signIn(RECEPTIONIST.email, RECEPTIONIST.password);
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

/** `total_rooms` and `sold_rooms` for a type on one night. */
async function counterOn(
  code: string,
  night: string,
): Promise<{ totalRooms: number; soldRooms: number }> {
  const [row] = await db
    .select({
      totalRooms: typeInventory.totalRooms,
      soldRooms: typeInventory.soldRooms,
    })
    .from(typeInventory)
    .innerJoin(roomType, eq(roomType.id, typeInventory.roomTypeId))
    .where(
      and(
        eq(roomType.code, code as "SUPERIOR"),
        eq(typeInventory.stayDate, night),
      ),
    )
    .limit(1);

  return row!;
}

async function close(
  token: string,
  body: Record<string, string>,
): Promise<request.Response> {
  return await http()
    .post("/inventory/room-closures")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

describe("closing a room", () => {
  let closureId: string;

  it("is refused to a receptionist", async () => {
    // The RBAC matrix's own note on the row: "Changes total_rooms — a
    // commercial act, not a cleaning one". A receptionist may set the room out
    // of order; only a manager may stop the property selling it.
    await close(receptionistToken, {
      roomNumber: SUPERIOR_ROOM,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      reason: "Bathroom re-tiling",
    }).then((response) => expect(response.status).toBe(403));

    expect((await counterOn("SUPERIOR", CHECK_IN)).totalRooms).toBe(
      SUPERIOR_ROOMS,
    );
  });

  it("is refused to a stranger holding no session", async () => {
    await http()
      .post("/inventory/room-closures")
      .send({
        roomNumber: SUPERIOR_ROOM,
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        reason: "Bathroom re-tiling",
      })
      .expect(401);
  });

  it("takes a room off sale for every night of the range", async () => {
    const response = await close(managerToken, {
      roomNumber: SUPERIOR_ROOM,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      reason: "Bathroom re-tiling",
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      roomNumber: SUPERIOR_ROOM,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      nightsWithdrawn: NIGHTS,
    });

    closureId = response.body.id;

    // The acceptance criterion, literally: closure changes `total_rooms`.
    const withdrawn = await counterOn("SUPERIOR", CHECK_IN);

    expect(withdrawn.totalRooms).toBe(SUPERIOR_ROOMS - 1);
    // And never `sold_rooms`. A withdrawn room is not a sold one — the
    // difference is the whole reason there are two columns.
    expect(withdrawn.soldRooms).toBe(0);
  });

  it("leaves the night after the range alone", async () => {
    // Half-open, like every other range in the system: the departure date is
    // not a night withdrawn.
    expect((await counterOn("SUPERIOR", CHECK_OUT)).totalRooms).toBe(
      SUPERIOR_ROOMS,
    );
  });

  it("shows up in availability as one fewer room", async () => {
    const response = await http()
      .get("/availability/calendar")
      .query({ year: 2027, month: 6 })
      .expect(200);

    // The closure is invisible in the grid — eleven Superiors is still a
    // Superior available — which is the correct outcome and the reason the
    // counter is what the test above asserts against.
    const night = response.body.nights.find(
      (each: { date: string }) => each.date === CHECK_IN,
    );

    expect(night.isSoldOut).toBe(false);
  });

  it("holds the physical room, so nothing else can be given it", async () => {
    const [held] = await db
      .select({
        bookingId: roomAssignment.bookingId,
        closureReason: roomAssignment.closureReason,
      })
      .from(roomAssignment)
      .innerJoin(room, eq(room.id, roomAssignment.roomId))
      .where(eq(room.number, SUPERIOR_ROOM))
      .limit(1);

    // No booking behind it, and a reason in the words of whoever took it out.
    expect(held!.bookingId).toBeNull();
    expect(held!.closureReason).toBe("Bathroom re-tiling");
  });

  it("refuses a second closure overlapping the first", async () => {
    // Refused by `room_assignment_no_overlap` in Postgres, surfaced as a 409.
    // Not a fault: the room is genuinely taken, and the desk resolves it by
    // choosing another room or another week.
    const response = await close(managerToken, {
      roomNumber: SUPERIOR_ROOM,
      checkIn: "2027-06-12",
      checkOut: "2027-06-15",
      reason: "Air conditioning",
    });

    expect(response.status).toBe(409);
  });

  it("accepts a closure beginning the day the last one ends", async () => {
    const response = await close(managerToken, {
      roomNumber: SUPERIOR_ROOM,
      checkIn: CHECK_OUT,
      checkOut: "2027-06-15",
      reason: "Carpet",
    });

    expect(response.status).toBe(201);

    await http()
      .delete(`/inventory/room-closures/${response.body.id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .expect(200);
  });

  it("refuses a range with nights the property has not opened for sale", async () => {
    // The seed opened twelve months. A range past the end has no counter to
    // decrement, and holding the room across it would leave the two layers
    // disagreeing the moment that date is opened.
    const response = await close(managerToken, {
      roomNumber: "202",
      checkIn: "2029-01-10",
      checkOut: "2029-01-12",
      reason: "Too far out",
    });

    expect(response.status).toBe(409);
  });

  it("refuses a room number nobody has", async () => {
    const response = await close(managerToken, {
      roomNumber: "999",
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      reason: "Nonexistent",
    });

    expect(response.status).toBe(404);
  });

  it("refuses a closure with no reason", async () => {
    const response = await close(managerToken, {
      roomNumber: "203",
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      reason: "",
    });

    expect(response.status).toBe(400);
  });

  it("puts the room back on sale when the closure is lifted", async () => {
    await http()
      .delete(`/inventory/room-closures/${closureId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .expect(200);

    expect((await counterOn("SUPERIOR", CHECK_IN)).totalRooms).toBe(
      SUPERIOR_ROOMS,
    );

    const stillHeld = await db
      .select({ id: roomAssignment.id })
      .from(roomAssignment)
      .where(eq(roomAssignment.id, closureId));

    expect(stillHeld).toHaveLength(0);
  });

  it("refuses to reopen something that is not a closure", async () => {
    // A guest's booking reaching this endpoint would release their room and
    // credit the property with inventory it has already sold. The predicate
    // that refuses it is `closure_reason is not null`, in the delete itself.
    const [room205] = await db
      .select({ id: room.id, roomTypeId: room.roomTypeId })
      .from(room)
      .where(eq(room.number, "205"))
      .limit(1);

    // A real booking row and not an invented id: `room_assignment.booking_id`
    // carries a foreign key since M4, and a hold naming a stay nobody took is
    // exactly what it refuses.
    const [sold] = await db
      .insert(booking)
      .values({
        reference: "MRV-20270610-9001",
        state: "CONFIRMED",
        roomTypeId: room205!.roomTypeId,
        checkInDate: CHECK_IN,
        checkOutDate: CHECK_OUT,
        ratePlanCode: "STANDARD",
        adults: 2,
        quotedStayTotalGross: 3_000_000n,
        quotedPercentAdjustment: 0,
        quotedExtraPersonPerNightGross: 600_000n,
      })
      .returning({ id: booking.id });

    const [held] = await db
      .insert(roomAssignment)
      .values({
        roomId: room205!.id,
        bookingId: sold!.id,
        checkInDate: CHECK_IN,
        checkOutDate: CHECK_OUT,
      })
      .returning({ id: roomAssignment.id });

    await http()
      .delete(`/inventory/room-closures/${held!.id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .expect(404);
  });
});

describe("the sold-out edge", () => {
  it("refuses to withdraw a room the property has already sold every one of", async () => {
    const night = "2027-07-04";

    // Every Panorama Suite sold for that night. There is no room left to
    // withdraw, and `type_inventory_sold_at_most_total` is what says so —
    // never a check this service performs first, because a check followed by a
    // write is two statements a concurrent request can interleave.
    await db
      .update(typeInventory)
      .set({ soldRooms: sql`${typeInventory.totalRooms}` })
      .where(
        and(
          eq(
            typeInventory.roomTypeId,
            (
              await db
                .select({ id: roomType.id })
                .from(roomType)
                .where(eq(roomType.code, "PANORAMA_SUITE"))
                .limit(1)
            )[0]!.id,
          ),
          eq(typeInventory.stayDate, night),
        ),
      );

    // 501–504 are the four Panorama Suites — the last four numbers the seed
    // deals out.
    const response = await close(managerToken, {
      roomNumber: "507",
      checkIn: night,
      checkOut: "2027-07-05",
      reason: "Balcony railing",
    });

    expect(response.status).toBe(409);
  });
});
