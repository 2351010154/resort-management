// The six export routes end to end, minus the database.
//
// What the specs beside this one cannot show is that the pieces are wired
// together: that the route answers with a spreadsheet rather than JSON, that it
// names the download, that the second capability is resolved in the handler
// rather than only in a helper, and — the one that matters most — that a
// narrowed caller's scope actually reaches the query the file is built from.
//
// The three report exports add one more thing to show, and it is the reason they
// are here rather than only in a unit test: their sheets are assembled *after* a
// read, because a report's stamp is the last business date the night audit
// closed rather than the filters somebody typed. So the route has to await the
// sheet before writing a byte, and a refusal from that read has to arrive as a
// status rather than as a truncated download.
//
// So the controller is built with the real `ManagementExports` and the five
// services under it stubbed. That is deliberate rather than convenient: it exercises the
// column definitions, the paging walk and the stamps as written, and it lets
// each stub record what it was asked for — which is how "a receptionist's export
// holds their own shifts" is asserted as a fact about the query rather than as a
// fact about a predicate.
//
// The global `AccessGuard` is not here; `AuthModule` installs it over the whole
// application and it has a suite of its own. What stands in for it is the
// decision it leaves on the request, set below from a header, because that
// decision is the only thing these handlers read from it. The routes' own
// declaration of `reporting.excel-export` is asserted in
// `export-authority.spec.ts`, off the metadata the guard reads.

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import type { NextFunction, Request, Response } from "express";
import { getLoggerToken } from "nestjs-pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCESS_DECISION } from "../../src/common/auth/principal.js";
import { TransactionRunner } from "../../src/database/transaction-runner.js";
import { AuditService } from "../../src/modules/audit/audit.service.js";
import { staffGrant } from "../../src/modules/identity/rbac/matrix.js";
import type { StaffRole } from "../../src/modules/identity/rbac/roles.js";
import { CashBookService } from "../../src/modules/operations/cash-book.service.js";
import { ShiftService } from "../../src/modules/operations/shift.service.js";
import { ManagementExports } from "../../src/modules/reporting/management-exports.js";
import { PerformanceQueries } from "../../src/modules/reporting/performance-queries.service.js";
import { ReportQueries } from "../../src/modules/reporting/report-queries.service.js";
import { ReportingController } from "../../src/modules/reporting/reporting.controller.js";

const A_STAFF_ID = "6f1a3f2e-0a1f-4a4e-9a1a-2b3c4d5e6f70";
const ROLE_HEADER = "x-test-role";

const EXCEL_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The first row of data on a sheet whose stamp carries a scope line: the
 *  title, three stamp lines, a blank and the headers come first. The cash book
 *  has no scope — its row grants one level to everybody who holds it — so its
 *  own data starts one row earlier. */
const FIRST_SCOPED_ROW = 7;

/** What each stubbed list was last asked for, so a scope can be asserted where
 *  it actually takes effect rather than where it is decided. */
const asked: {
  cashBook: unknown;
  shifts: unknown;
  changeLog: unknown;
  revenue: unknown;
  performance: unknown;
} = {
  cashBook: null,
  shifts: null,
  changeLog: null,
  revenue: null,
  performance: null,
};

/** The last trading day the night audit closed, in every stub below. It is the
 *  boundary both report sheets stamp themselves with. */
const LAST_CLOSED = "2026-08-20";

/** One month the audit reached the twentieth of — so `to` is not the calendar's
 *  last day, which is the distinction the row is shaped to carry. */
const A_REVENUE_REPORT = {
  bucket: "MONTH" as const,
  lastClosedBusinessDate: LAST_CLOSED,
  buckets: [
    {
      from: "2026-08-01",
      to: LAST_CLOSED,
      closedDays: 20,
      roomRevenueVnd: 300_000_000n,
      otherRevenueVnd: 20_000_000n,
      penaltyRevenueVnd: 5_000_000n,
      totalVnd: 325_000_000n,
    },
  ],
  totals: {
    closedDays: 20,
    roomRevenueVnd: 300_000_000n,
    otherRevenueVnd: 20_000_000n,
    penaltyRevenueVnd: 5_000_000n,
    totalVnd: 325_000_000n,
  },
};

/**
 * Two closed months, arranged so that both null denominators are in the file.
 *
 * July was a month the property had nothing on sale — a renovation the audit
 * still closed a day at a time — so its occupancy and RevPAR have no
 * denominator. August sold, and one of its two types sold nothing, so that type
 * has no ADR. Both are the readings `performance-queries.service.ts` returns
 * null for, and this fixture is what carries them as far as a cell.
 */
const A_PERFORMANCE_REPORT = {
  bucket: "MONTH" as const,
  lastClosedBusinessDate: LAST_CLOSED,
  buckets: [
    {
      from: "2026-07-01",
      to: "2026-07-31",
      closedDays: 31,
      property: {
        sellableRooms: 0,
        roomsSold: 0,
        netRoomRevenueVnd: 0n,
        occupancy: null,
        adrVnd: null,
        revparVnd: null,
      },
      byType: [],
    },
    {
      from: "2026-08-01",
      to: LAST_CLOSED,
      closedDays: 20,
      property: {
        sellableRooms: 380,
        roomsSold: 266,
        netRoomRevenueVnd: 300_000_000n,
        occupancy: 0.7,
        adrVnd: 1_127_820n,
        revparVnd: 789_474n,
      },
      byType: [
        {
          roomType: "SUPERIOR" as const,
          sellableRooms: 220,
          roomsSold: 266,
          netRoomRevenueVnd: 300_000_000n,
          // Above 100%: rooms were withdrawn after the nights were sold, which
          // the schema declines to forbid and nothing here may clamp.
          occupancy: 1.209_090_909_090_909_1,
          adrVnd: 1_127_820n,
          revparVnd: 1_363_636n,
        },
        {
          roomType: "DELUXE" as const,
          sellableRooms: 160,
          roomsSold: 0,
          netRoomRevenueVnd: 0n,
          occupancy: 0,
          adrVnd: null,
          revparVnd: 0n,
        },
      ],
    },
  ],
  totals: {
    closedDays: 51,
    property: {
      sellableRooms: 380,
      roomsSold: 266,
      netRoomRevenueVnd: 300_000_000n,
      occupancy: 0.7,
      adrVnd: 1_127_820n,
      revparVnd: 789_474n,
    },
    byType: [],
  },
};

const A_ROOM_STATUS_REPORT = {
  takenAt: new Date("2026-08-21T02:15:00.000Z"),
  lastClosedBusinessDate: LAST_CLOSED,
  rooms: 19,
  byStatus: [
    { status: "CLEAN" as const, rooms: 16 },
    { status: "DIRTY" as const, rooms: 2 },
    { status: "INSPECTED" as const, rooms: 0 },
    { status: "OUT_OF_ORDER" as const, rooms: 1 },
  ],
  byType: [
    {
      roomType: "SUPERIOR" as const,
      rooms: 11,
      byStatus: [
        { status: "CLEAN" as const, rooms: 10 },
        { status: "DIRTY" as const, rooms: 0 },
        { status: "INSPECTED" as const, rooms: 0 },
        { status: "OUT_OF_ORDER" as const, rooms: 1 },
      ],
    },
  ],
};

const AN_ENTRY = {
  id: "11111111-1111-4111-8111-111111111111",
  direction: "EXPENSE" as const,
  category: "SUPPLIES" as const,
  method: "CASH" as const,
  amount: 1_250_000n,
  businessDate: "2026-08-20",
  shiftId: "22222222-2222-4222-8222-222222222222",
  note: "hai thùng nước suối",
  recordedById: A_STAFF_ID,
  recordedByName: "Nguyễn Thị Lan",
  recordedAt: new Date("2026-08-20T10:35:00.000Z"),
  reversesEntryId: null,
  reversedByEntryId: null,
};

const A_SHIFT = {
  id: "33333333-3333-4333-8333-333333333333",
  operatorId: A_STAFF_ID,
  operatorName: "Trần Văn Minh",
  openingFloat: 2_000_000n,
  openedAt: new Date("2026-08-20T00:05:00.000Z"),
  openingBusinessDate: "2026-08-20",
  cashTaken: 5_400_000n,
  cashBookNet: -1_250_000n,
  closingCount: 6_150_000n,
  variance: 0n,
  closedAt: new Date("2026-08-20T09:05:00.000Z"),
  handoverNote: "Room 204 waiting on a receipt.",
};

const A_CHANGE = {
  id: "44444444-4444-4444-8444-444444444444",
  actorKind: "staff" as const,
  actorId: A_STAFF_ID,
  actorName: "Nguyễn Thị Lan",
  occurredAt: new Date("2026-08-20T10:35:00.000Z"),
  tableName: "folio_posting",
  rowId: "55555555-5555-4555-8555-555555555555",
  action: "UPDATE" as const,
};

let app: INestApplication;

beforeAll(async () => {
  const built = await Test.createTestingModule({
    controllers: [ReportingController],
    providers: [
      ManagementExports,
      {
        provide: CashBookService,
        useValue: {
          list: (_exec: unknown, query: unknown) => {
            asked.cashBook = query;

            return Promise.resolve({
              entries: [AN_ENTRY],
              total: 1,
              incomeTotal: 0n,
              expenseTotal: AN_ENTRY.amount,
            });
          },
        },
      },
      {
        provide: ShiftService,
        useValue: {
          history: (_exec: unknown, query: unknown) => {
            asked.shifts = query;

            return Promise.resolve({ shifts: [A_SHIFT], total: 1 });
          },
        },
      },
      {
        provide: AuditService,
        useValue: {
          list: (_exec: unknown, query: unknown) => {
            asked.changeLog = query;

            return Promise.resolve({ entries: [A_CHANGE], total: 1 });
          },
        },
      },
      {
        provide: ReportQueries,
        useValue: {
          revenue: (_exec: unknown, filters: unknown) => {
            asked.revenue = filters;

            return Promise.resolve(A_REVENUE_REPORT);
          },
          roomStatus: () => Promise.resolve(A_ROOM_STATUS_REPORT),
        },
      },
      {
        provide: PerformanceQueries,
        useValue: {
          performance: (_exec: unknown, filters: unknown) => {
            asked.performance = filters;

            return Promise.resolve(A_PERFORMANCE_REPORT);
          },
        },
      },
      {
        // The boundary without a database behind it. The handler's only use of
        // it is to hold one open around the write, and what it hands the sheet
        // is passed straight back to the stubs above.
        provide: TransactionRunner,
        useValue: {
          run: (work: (exec: unknown) => Promise<unknown>) => work({}),
        },
      },
      {
        provide: getLoggerToken(ReportingController.name),
        useValue: { error: () => undefined },
      },
    ],
  }).compile();

  app = built.createNestApplication();

  // The decision the guard would have left. Nothing else about the guard is
  // stood in for: an unheaded request arrives with no decision at all, which is
  // the shape a handler sees when a guard has not run.
  app.use((incoming: Request, _outgoing: Response, next: NextFunction) => {
    const named = incoming.headers[ROLE_HEADER];

    if (typeof named === "string") {
      const role = named as StaffRole;

      (incoming as Request & Record<string, unknown>)[ACCESS_DECISION] = {
        principal: {
          realm: "staff",
          userId: A_STAFF_ID,
          email: "someone@example.test",
          role,
        },
        capabilityKey: "reporting.excel-export",
        grant: staffGrant("reporting.excel-export", role),
      };
    }

    next();
  });

  await app.init();
});

afterAll(async () => {
  await app.close();
});

function take(path: string, role: StaffRole, search = "") {
  return request(app.getHttpServer())
    .get(search === "" ? `/${path}` : `/${path}?${search}`)
    .set(ROLE_HEADER, role)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

async function sheetOf(file: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(file);

  const [first] = workbook.worksheets;

  if (!first) {
    throw new Error("that response was not a workbook with a sheet in it");
  }

  return first;
}

describe("the revenue export", () => {
  it("answers an accountant with a named spreadsheet", async () => {
    const answer = await take("exports/revenue.xlsx", "ACCOUNTANT").expect(200);

    expect(answer.headers["content-type"]).toContain(EXCEL_MEDIA_TYPE);
    expect(answer.headers["content-disposition"]).toMatch(
      /^attachment; filename="revenue-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(1).getCell(1).value).toContain("Revenue");
    // Title, three stamp lines — taken, filters, boundary — a fourth carrying
    // the range totals, a blank, the headers, then the buckets.
    expect(sheet.getRow(7).getCell(1).value).toBe("From");
    expect(sheet.getRow(8).getCell(1).value).toBe("2026-08-01");
    expect(sheet.getRow(8).getCell(3).value).toBe(20);
    expect(sheet.getRow(8).getCell(4).value).toBe(300_000_000);
    expect(sheet.getRow(8).getCell(6).value).toBe(5_000_000);
    expect(sheet.getRow(8).getCell(7).value).toBe(325_000_000);
  });

  it("stamps the file with the boundary rather than with a source", async () => {
    // The sentence `screens.md` asks for: what the file does *not* reach. It
    // matters most on a spreadsheet, which outlives the page it was taken from
    // and carries figures assembled from a frozen snapshot and a live ledger.
    const answer = await take("exports/revenue.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(4).getCell(1).value).toBe(
      `Boundary: nothing here reaches past ${LAST_CLOSED}, the last trading day the night audit has closed.`,
    );
  });

  it("carries the range and the cut the page submitted", async () => {
    await take(
      "exports/revenue.xlsx",
      "MANAGER",
      "bucket=QUARTER&from=2026-01-01&to=2026-08-31",
    ).expect(200);

    expect(asked.revenue).toMatchObject({ bucket: "QUARTER" });

    const filters = asked.revenue as { from?: { toString(): string } };

    expect(filters.from?.toString()).toBe("2026-01-01");
  });

  it("refuses a receptionist, who may not read the takings at all", async () => {
    // The matrix note "RCP: operational lists only", falling out of the two
    // rows rather than being written anywhere: the desk is denied
    // `reporting.financial`, so there is no revenue file for them to reach.
    await take("exports/revenue.xlsx", "RECEPTIONIST").expect(403);
  });

  it("refuses a range that ends before it starts", async () => {
    await take(
      "exports/revenue.xlsx",
      "MANAGER",
      "from=2026-08-31&to=2026-08-01",
    ).expect(400);
  });
});

describe("the performance export", () => {
  it("answers a manager with a named spreadsheet", async () => {
    const answer = await take("exports/performance.xlsx", "MANAGER").expect(200);

    expect(answer.headers["content-type"]).toContain(EXCEL_MEDIA_TYPE);
    expect(answer.headers["content-disposition"]).toMatch(
      /^attachment; filename="performance-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(1).getCell(1).value).toContain("Performance");
    // Title, three stamp lines — taken, filters, boundary — a fourth carrying
    // the range totals, a blank, the headers, then the buckets.
    expect(sheet.getRow(7).values).toEqual([
      undefined,
      "From",
      "To",
      "Closed days",
      "Scope",
      "Sellable rooms",
      "Rooms sold",
      "Net room revenue",
      "Occupancy",
      "ADR",
      "RevPAR",
    ]);
  });

  it("puts the property row first and its types under it, in the order answered", async () => {
    // The bucket's own figures are counted over the snapshot's columns rather
    // than assembled from the types below them, so the two are separate rows
    // and the property's comes first.
    const answer = await take("exports/performance.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(
      [8, 9, 10, 11].map((row) => sheet.getRow(row).getCell(4).value),
    ).toEqual(["Property", "Property", "SUPERIOR", "DELUXE"]);
    expect([8, 9].map((row) => sheet.getRow(row).getCell(1).value)).toEqual([
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(sheet.getRow(9).getCell(6).value).toBe(266);
    expect(sheet.getRow(9).getCell(7).value).toBe(300_000_000);
    expect(sheet.getRow(9).getCell(9).value).toBe(1_127_820);
  });

  it("leaves a ratio with no denominator blank rather than nought", async () => {
    // July had nothing on sale, so it has no occupancy and no RevPAR; Deluxe
    // sold nothing in August, so it has no ADR. A 0 in any of those cells is a
    // number somebody averages.
    const answer = await take("exports/performance.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    const july = sheet.getRow(8);

    expect(july.getCell(8).value).toBeNull();
    expect(july.getCell(10).value).toBeNull();
    // The counts under those ratios are a genuine nought and stay one.
    expect(july.getCell(6).value).toBe(0);

    const deluxe = sheet.getRow(11);

    expect(deluxe.getCell(9).value).toBeNull();
    expect(deluxe.getCell(8).value).toBe(0);
  });

  it("carries occupancy as the fraction the service computed, uncapped", async () => {
    const answer = await take("exports/performance.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(9).getCell(8).value).toBe(0.7);
    expect(sheet.getRow(9).getCell(8).numFmt).toBe("0.0%");
    expect(sheet.getRow(10).getCell(8).value).toBeGreaterThan(1);
  });

  it("puts the range totals and the boundary in the stamp and not in a row", async () => {
    const answer = await take("exports/performance.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(4).getCell(1).value).toBe(
      `Boundary: nothing here reaches past ${LAST_CLOSED}, the last trading day the night audit has closed.`,
    );
    expect(sheet.getRow(5).getCell(1).value).toContain(
      "Range totals over 51 closed days",
    );
    expect(sheet.getRow(5).getCell(1).value).toContain("occupancy 70.0%");
    // Four data rows and nothing after them: a totals row appended to the data
    // is a row that breaks every filter a reader applies afterwards.
    expect(sheet.getRow(12).getCell(1).value).toBeNull();
  });

  it("carries the range and the cut the page submitted", async () => {
    await take(
      "exports/performance.xlsx",
      "MANAGER",
      "bucket=QUARTER&from=2026-01-01&to=2026-08-31",
    ).expect(200);

    expect(asked.performance).toMatchObject({ bucket: "QUARTER" });

    const filters = asked.performance as { from?: { toString(): string } };

    expect(filters.from?.toString()).toBe("2026-01-01");
  });

  it("gives an accountant the whole file, since their grant is unnarrowed", async () => {
    // The matrix hands `ACCOUNTANT` this row at 👁, which is `read` and
    // therefore not a claim about which rows — so the file is whole rather than
    // scoped, and there is no scope line in its stamp to say otherwise.
    const answer = await take("exports/performance.xlsx", "ACCOUNTANT").expect(
      200,
    );
    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(11).getCell(4).value).toBe("DELUXE");
  });

  it("refuses a receptionist, who holds no performance row at all", async () => {
    await take("exports/performance.xlsx", "RECEPTIONIST").expect(403);
  });

  it("refuses a range that ends before it starts", async () => {
    await take(
      "exports/performance.xlsx",
      "MANAGER",
      "from=2026-08-31&to=2026-08-01",
    ).expect(400);
  });
});

describe("the room-status export", () => {
  it("gives a receptionist the operational file they hold", async () => {
    // The other half of the same note. This is an operational list, the desk
    // holds its row, and so the file is theirs.
    const answer = await take(
      "exports/room-status.xlsx",
      "RECEPTIONIST",
    ).expect(200);

    expect(answer.headers["content-disposition"]).toMatch(
      /^attachment; filename="room-status-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(1).getCell(1).value).toContain("Room status");
    // Title, four stamp lines — taken, counted, boundary, filters — a blank,
    // the headers, then a row per type with a column per condition.
    expect(sheet.getRow(7).getCell(1).value).toBe("Room type");
    expect(sheet.getRow(7).getCell(3).value).toBe("Clean");
    expect(sheet.getRow(8).getCell(1).value).toBe("Superior");
    expect(sheet.getRow(8).getCell(2).value).toBe(11);
    expect(sheet.getRow(8).getCell(3).value).toBe(10);
    expect(sheet.getRow(8).getCell(6).value).toBe(1);
  });

  it("says the counts are live as well as where the boundary falls", async () => {
    // Both, because a spreadsheet outlives the minute it was taken and a reader
    // opening it next week has no other way to know these are not a closed
    // day's figures.
    const answer = await take("exports/room-status.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(3).getCell(1).value).toContain("19 rooms");
    expect(sheet.getRow(3).getCell(1).value).toContain(
      "a housekeeping status is where a room stands now",
    );
    expect(sheet.getRow(4).getCell(1).value).toContain(
      `nothing here reaches past ${LAST_CLOSED}`,
    );
  });

  it("refuses an accountant, who holds no operational row", async () => {
    await take("exports/room-status.xlsx", "ACCOUNTANT").expect(403);
  });
});

describe("the cash book export", () => {
  it("answers a manager with a named spreadsheet", async () => {
    const answer = await take("exports/cash-book.xlsx", "MANAGER").expect(200);

    expect(answer.headers["content-type"]).toContain(EXCEL_MEDIA_TYPE);
    expect(answer.headers["content-disposition"]).toMatch(
      /^attachment; filename="cash-book-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(answer.headers["cache-control"]).toBe("no-store");

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(1).getCell(1).value).toContain("Cash book");
    // Title, two stamp lines, a blank, the headers, then the book.
    expect(sheet.getRow(5).getCell(1).value).toBe("Trading day");
    expect(sheet.getRow(6).getCell(1).value).toBe("2026-08-20");
    expect(sheet.getRow(6).getCell(6).value).toBe(1_250_000);
  });

  it("carries the filters the screen submitted, and no page", async () => {
    await take(
      "exports/cash-book.xlsx",
      "ACCOUNTANT",
      "from=2026-08-01&to=2026-08-31&category=SUPPLIES",
    ).expect(200);

    expect(asked.cashBook).toMatchObject({
      category: "SUPPLIES",
      limit: expect.any(Number),
      offset: 0,
    });

    const query = asked.cashBook as { from?: { toString(): string } };

    expect(query.from?.toString()).toBe("2026-08-01");
  });

  it("says which filters produced it", async () => {
    const answer = await take(
      "exports/cash-book.xlsx",
      "ACCOUNTANT",
      "from=2026-08-01&to=2026-08-31",
    ).expect(200);

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(3).getCell(1).value).toBe(
      "Filters: from 2026-08-01 · to 2026-08-31",
    );
  });

  it("refuses a receptionist, who may not read the book at all", async () => {
    await take("exports/cash-book.xlsx", "RECEPTIONIST").expect(403);
  });

  it("refuses a range that ends before it starts", async () => {
    await take(
      "exports/cash-book.xlsx",
      "MANAGER",
      "from=2026-08-31&to=2026-08-01",
    ).expect(400);
  });
});

describe("the shift history export", () => {
  it("gives a manager every operator's drawer", async () => {
    const answer = await take("exports/shifts.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    expect(asked.shifts).toMatchObject({ operatorId: undefined });
    expect(sheet.getRow(4).getCell(1).value).toBe(
      "Scope: every operator's drawer.",
    );
    // Title, three stamp lines — the scope is one of them — a blank, the
    // headers, then the desk. The variance is the API's own figure, square on
    // this drawer.
    expect(sheet.getRow(FIRST_SCOPED_ROW).getCell(9).value).toBe(0);
  });

  it("narrows a receptionist to their own drawers, overwriting the filter", async () => {
    const answer = await take(
      "exports/shifts.xlsx",
      "RECEPTIONIST",
      "operatorId=99999999-9999-4999-8999-999999999999",
    ).expect(200);

    expect(asked.shifts).toMatchObject({ operatorId: A_STAFF_ID });

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(4).getCell(1).value).toContain("your own shifts");
  });

  it("refuses a housekeeper, who holds no drawer row", async () => {
    await take("exports/shifts.xlsx", "HOUSEKEEPING").expect(403);
  });
});

describe("the change log export", () => {
  it("gives a manager every change the property records", async () => {
    const answer = await take("exports/change-log.xlsx", "MANAGER").expect(200);

    expect(asked.changeLog).toMatchObject({ financialOnly: false });

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(4).getCell(1).value).toBe(
      "Scope: every change the property records.",
    );
    expect(sheet.getRow(FIRST_SCOPED_ROW).getCell(3).value).toBe(
      "folio_posting",
    );
  });

  it("narrows an accountant to financial entries, and says so in the file", async () => {
    const answer = await take("exports/change-log.xlsx", "ACCOUNTANT").expect(
      200,
    );

    expect(asked.changeLog).toMatchObject({ financialOnly: true });

    const sheet = await sheetOf(answer.body as Buffer);

    expect(sheet.getRow(4).getCell(1).value).toContain(
      "financial entries only",
    );
  });

  it("carries no snapshot column, so nothing withheld can be un-withheld", async () => {
    const answer = await take("exports/change-log.xlsx", "MANAGER").expect(200);
    const sheet = await sheetOf(answer.body as Buffer);

    const headers = sheet.getRow(FIRST_SCOPED_ROW - 1).values as (
      | string
      | undefined
    )[];

    expect(headers).not.toContain("Before");
    expect(headers).not.toContain("After");
  });

  it("refuses a receptionist, who may not read the log at all", async () => {
    await take("exports/change-log.xlsx", "RECEPTIONIST").expect(403);
  });

  it("refuses a row id with no table beside it", async () => {
    await take(
      "exports/change-log.xlsx",
      "MANAGER",
      "rowId=55555555-5555-4555-8555-555555555555",
    ).expect(400);
  });
});

describe("a request no guard left a decision on", () => {
  it("is refused rather than answered with a file", async () => {
    await request(app.getHttpServer())
      .get("/exports/cash-book.xlsx")
      .expect(403);
  });
});
