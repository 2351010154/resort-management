// `GET /system/business-date`, over HTTP against a real Postgres and the real
// capability guard.
//
// The route exists because a screen may need the day without needing anything
// else. Three claims are worth asserting end to end, and none of them can be
// asserted anywhere but here:
//
// 1. **Every member of staff may read it, including the roles the neighbouring
//    row shuts out.** `system.config` is `MANAGER` and `ADMIN` because it
//    carries the figures an invoice is computed from; an `ACCOUNTANT` is
//    refused it and must still be able to render a date. That pair — refused
//    the configuration, allowed the day — is the whole reason the row was added,
//    so it is asserted as a pair rather than as two separate expectations.
// 2. **It answers the same day the housekeeping board answers.** Two routes
//    resolving the property's day is the defect this change could have
//    introduced, and the only convincing refutation is calling both and
//    comparing.
// 3. **It reads the configured rollover hour rather than a constant.** The hour
//    is moved in the row and the answer moves with it, which is
//    `property-and-tariff.md` §2's "changes one row, not a deploy" as a test.
//
// A guest and an anonymous caller are refused by the guard, and every denied
// identity on every row is asserted exhaustively in `access.guard.spec.ts`. What
// is asserted here is the one an unauthenticated caller gets from the real
// wiring: 401, and no date.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { type Database, DRIZZLE } from "../src/database/database.module.js";
import { systemConfig } from "../src/database/schema/config.js";
import {
  STAFF_ROLES,
  type StaffRole,
} from "../src/modules/identity/rbac/matrix.js";
import { StaffUserService } from "../src/modules/identity/staff-user.service.js";

const ROUTE = "/system/business-date";

/** The property's zone, for the day this test computes for itself. */
const PROPERTY_TIME_ZONE = "Asia/Ho_Chi_Minh";

interface StaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** One account per staff role: the row grants all five and all five are called. */
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

let app: INestApplication;
let db: Database;
let http: () => request.Agent;
let seededRolloverHour: number;
const tokens = new Map<StaffRole, string>();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  db = app.get<Database>(DRIZZLE);

  // Migrated before the application is initialised, not after: the boot seed
  // writes the `system_config` row this route reads, and it can only write it
  // into a table that exists.
  await migrate(db, { migrationsFolder: "./src/database/migrations" });

  // The five accounts below are created by email and the column is unique, so
  // whatever the previous suite signed in with has to go first.
  await db.execute(
    sql`truncate staff_user, staff_session restart identity cascade`,
  );

  await app.init();

  http = () => request(app.getHttpServer());

  const staff = app.get(StaffUserService);

  for (const account of Object.values(STAFF)) {
    await staff.create({ ...account });
    tokens.set(account.role, await signIn(account.email, account.password));
  }

  seededRolloverHour = await rolloverHour();
}, 120_000);

afterAll(async () => {
  // The row is shared with every other suite in this run, so the hour this file
  // moves is put back where it found it.
  if (db) {
    await setRolloverHour(seededRolloverHour);
  }

  await app?.close();
});

async function signIn(email: string, password: string): Promise<string> {
  const response = await http()
    .post("/auth/staff/sign-in")
    .send({ email, password })
    .expect(200);

  return response.body.accessToken as string;
}

/** A GET as one member of staff. */
function as(role: StaffRole, path: string): request.Test {
  return http().get(path).set("Authorization", `Bearer ${tokens.get(role)!}`);
}

async function rolloverHour(): Promise<number> {
  const [row] = await db.select().from(systemConfig).limit(1);

  if (!row) {
    throw new Error("the boot seed wrote no system_config row");
  }

  return row.businessDateRolloverHour;
}

async function setRolloverHour(hour: number): Promise<void> {
  await db
    .update(systemConfig)
    .set({ businessDateRolloverHour: hour })
    .where(eq(systemConfig.isTheConfiguration, true));
}

/**
 * The wall clock in the property's zone, right now — the day and the hour.
 *
 * `Intl` rather than the service's own `@internationalized/date` arithmetic, so
 * that what the expectation below is built from is not the code under test.
 */
function propertyMoment(): { readonly date: string; readonly hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROPERTY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

describe("the property's business date", () => {
  it("answers every staff role with a calendar date", async () => {
    for (const role of STAFF_ROLES) {
      const response = await as(role, ROUTE).expect(200);

      expect(Object.keys(response.body), role).toEqual(["businessDate"]);
      expect(response.body.businessDate, role).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // The pair the row was added for. An accountant reads bookings and renders
  // them against a day; they may not open the row that holds the tax rates and
  // the rollover hour, and before this route existed the only way to the day
  // was through a row they are refused.
  it("is open to the accountant the configuration is closed to", async () => {
    await as("ACCOUNTANT", "/system/config").expect(403);
    await as("ACCOUNTANT", ROUTE).expect(200);
  });

  it("refuses a caller with no credential", async () => {
    const response = await http().get(ROUTE).expect(401);

    expect(response.body.businessDate).toBeUndefined();
  });

  it("agrees with the day the housekeeping board answers", async () => {
    // Both roles because the two rows have different holders — the board is the
    // housekeeper's and the day is everyone's — and what is being compared is
    // the answer, which must not depend on who asked.
    const day = await as("ACCOUNTANT", ROUTE).expect(200);
    const board = await as("HOUSEKEEPING", "/housekeeping/board").expect(200);

    expect(day.body.businessDate).toBe(board.body.businessDate);
  });

  // §2's "changes one row, not a deploy", asserted against the row: the hour is
  // moved and the answer moves with it. Three hours rather than one, because a
  // single hour is passed by an implementation that ignores the row whenever the
  // wall clock happens to sit on the right side of it — with midnight, midday
  // and the last hour of the day, the property is before the rollover for at
  // least one of them at every moment but the final hour of the night.
  it("moves with the rollover hour in the configuration", async () => {
    for (const hour of [0, 12, 23]) {
      await setRolloverHour(hour);

      const now = propertyMoment();
      const response = await as("RECEPTIONIST", ROUTE).expect(200);

      // Before the rollover the property is still working yesterday.
      const expected =
        now.hour < hour
          ? parseDate(now.date).subtract({ days: 1 }).toString()
          : now.date;

      expect(response.body.businessDate, `rollover ${hour}`).toBe(expected);
    }

    await setRolloverHour(seededRolloverHour);
  });
});
