// What holds the workbook writer to the two promises it makes.
//
// **That it streams.** The assertion is not that the library is a streaming one
// — that is a claim about a dependency — but that bytes reach the writable
// *before the last row exists*. The row source below is shaped like the real
// one: `management-exports.ts` reads each list a page at a time, so it hands
// rows over in bursts separated by a round trip, and the fixture pauses on the
// same boundary. If a future change buffered the sheet and wrote it at the end,
// the byte count taken as the last row is produced would be zero and this fails.
//
// **That no đồng amount is misrepresented.** The file is read back and the cells
// are compared against the `bigint` that went in, at the exactness bound
// `excel-sheet.ts` argues for and one đồng past it.
//
// **That a proportion is neither rounded, clamped nor confused with a nought.**
// `FR-RPT-03`'s occupancy is a fraction whose denominator can be zero and whose
// value can exceed one, and all three of those readings have to survive the trip
// into a cell as themselves.
//
// No database. A workbook built from fixture rows needs none, which is the whole
// reason these two properties can be held on every run rather than only where
// Postgres is up.

import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  dongCell,
  inPropertyZone,
  LARGEST_EXACT_DONG_IN_A_CELL,
  propertyDayOf,
  type SheetColumn,
  writeExcelSheet,
} from "../../src/modules/reporting/excel-sheet.js";

interface Movement {
  readonly day: string;
  readonly amount: bigint;
  readonly recordedAt: Date;
  readonly note: string | null;
}

const COLUMNS: readonly SheetColumn<Movement>[] = [
  { header: "Trading day", width: 13, text: (row) => row.day },
  { header: "Amount", width: 16, dong: (row) => row.amount },
  { header: "Recorded at", width: 17, at: (row) => row.recordedAt },
  { header: "Note", width: 40, text: (row) => row.note },
];

const AN_INSTANT = new Date("2026-08-20T10:35:41.000Z");

function movement(amount: bigint, note: string | null = "a note"): Movement {
  return { day: "2026-08-20", amount, recordedAt: AN_INSTANT, note };
}

/** The two stamp lines every real export carries, so a sheet written here has
 *  the layout the exports have and the first row of data is always row 6. */
const STAMP: readonly string[] = [
  "Taken 2026-08-20 17:35 · Asia/Ho_Chi_Minh",
  "Filters: from 2026-08-01 · to 2026-08-31",
];

/** The row the first movement lands on: the title, the two stamp lines, the
 *  blank, the headers, and then the sheet. */
const FIRST_MOVEMENT = 6;

/** The bytes a sheet came to. */
async function written(
  rows: AsyncIterable<Movement>,
  stamp: readonly string[] = STAMP,
): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];

  sink.on("data", (chunk: Buffer) => chunks.push(chunk));

  await writeExcelSheet(
    {
      sheetName: "Book",
      title: "Cash book — a fixture",
      stamp,
      columns: COLUMNS,
      rows,
    },
    sink,
  );

  return Buffer.concat(chunks);
}

async function readBack(file: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(file);

  const sheet = workbook.getWorksheet("Book");

  if (!sheet) {
    throw new Error(
      "the workbook came back without the sheet that was written",
    );
  }

  return sheet;
}

describe("a sheet as it is written", () => {
  it("puts what the file is, when it was taken and its filters above the columns", async () => {
    const sheet = await readBack(await written(source([movement(1_250_000n)])));

    expect(sheet.getRow(1).getCell(1).value).toBe("Cash book — a fixture");
    expect(sheet.getRow(2).getCell(1).value).toBe(
      "Taken 2026-08-20 17:35 · Asia/Ho_Chi_Minh",
    );
    expect(sheet.getRow(3).getCell(1).value).toBe(
      "Filters: from 2026-08-01 · to 2026-08-31",
    );
    // A blank row, then the headers, then the rows.
    expect(sheet.getRow(4).getCell(1).value).toBeNull();
    expect(sheet.getRow(5).values).toEqual([
      undefined,
      "Trading day",
      "Amount",
      "Recorded at",
      "Note",
    ]);
  });

  it("writes a trading day as the characters it arrived as", async () => {
    const sheet = await readBack(await written(source([movement(1n)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(1).value).toBe("2026-08-20");
  });

  it("writes an instant in the property's own zone, to the minute", async () => {
    const sheet = await readBack(await written(source([movement(1n)])));

    // 10:35 UTC is 17:35 in Ho Chi Minh City.
    expect(sheet.getRow(FIRST_MOVEMENT).getCell(3).value).toBe(
      "2026-08-20 17:35",
    );
  });

  it("leaves a null as an empty cell rather than as a word", async () => {
    const sheet = await readBack(await written(source([movement(1n, null)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(4).value).toBeNull();
  });

  it("gives every money column the đồng number format", async () => {
    const sheet = await readBack(await written(source([movement(1n)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(2).numFmt).toBe("#,##0");
    expect(sheet.getRow(FIRST_MOVEMENT).getCell(1).numFmt).toBeUndefined();
  });
});

describe("a đồng amount in a cell", () => {
  it("is a number, so a column of them can be summed", async () => {
    const sheet = await readBack(await written(source([movement(1_250_000n)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(2).value).toBe(1_250_000);
  });

  it("keeps every digit up to the exactness bound", async () => {
    const sheet = await readBack(
      await written(source([movement(LARGEST_EXACT_DONG_IN_A_CELL)])),
    );

    const cell = sheet.getRow(FIRST_MOVEMENT).getCell(2).value;

    expect(typeof cell).toBe("number");
    expect(BigInt(cell as number)).toBe(LARGEST_EXACT_DONG_IN_A_CELL);
  });

  it("keeps a negative figure — a variance is signed", async () => {
    const sheet = await readBack(await written(source([movement(-2_000n)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(2).value).toBe(-2_000);
  });

  it("becomes exact text one đồng past the bound rather than a rounded number", async () => {
    const past = LARGEST_EXACT_DONG_IN_A_CELL + 1n;
    const sheet = await readBack(await written(source([movement(past)])));

    expect(sheet.getRow(FIRST_MOVEMENT).getCell(2).value).toBe(past.toString());
  });

  it("degrades in both directions, since a magnitude is what is compared", () => {
    expect(dongCell(-(LARGEST_EXACT_DONG_IN_A_CELL + 1n))).toBe(
      "-1000000000000000",
    );
    expect(dongCell(LARGEST_EXACT_DONG_IN_A_CELL)).toBe(999_999_999_999_999);
  });
});

describe("the writer under a source that is paged, as the real one is", () => {
  it("has bytes on the wire before the last row has been produced", async () => {
    const ROWS = 5_000;
    const PAGE = 200;

    const sink = new PassThrough();
    let bytes = 0;
    let bytesWhenTheLastRowWasProduced = -1;

    sink.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });

    async function* paged(): AsyncGenerator<Movement> {
      for (let index = 0; index < ROWS; index += 1) {
        // The round trip a real page costs. Without it nothing here yields to
        // the loop, and a stream that never gets a turn cannot be told apart
        // from one that buffers.
        if (index % PAGE === 0) {
          await new Promise<void>((resume) => setImmediate(resume));
        }

        if (index === ROWS - 1) {
          bytesWhenTheLastRowWasProduced = bytes;
        }

        yield movement(BigInt(index) * 1_000n);
      }
    }

    await writeExcelSheet(
      {
        sheetName: "Book",
        title: "Cash book — a fixture",
        stamp: [],
        columns: COLUMNS,
        rows: paged(),
      },
      sink,
    );

    expect(bytesWhenTheLastRowWasProduced).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(bytesWhenTheLastRowWasProduced);
  });
});

describe("a proportion in a cell", () => {
  // Its own sheet rather than a fifth column on the fixture above, so the
  // header row every other test in this file compares against stays four wide.
  interface Reading {
    readonly night: string;
    readonly occupancy: number | null;
  }

  const READING_COLUMNS: readonly SheetColumn<Reading>[] = [
    { header: "Night", width: 13, text: (row) => row.night },
    { header: "Occupancy", width: 12, fraction: (row) => row.occupancy },
  ];

  /** The title, one stamp line, the blank and the headers come first. */
  const FIRST_READING = 5;

  async function readings(
    rows: readonly Reading[],
  ): Promise<ExcelJS.Worksheet> {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];

    sink.on("data", (chunk: Buffer) => chunks.push(chunk));

    async function* source(): AsyncGenerator<Reading> {
      for (const row of rows) {
        yield row;
      }
    }

    await writeExcelSheet(
      {
        sheetName: "Book",
        title: "Performance — a fixture",
        stamp: ["Taken 2026-08-20 17:35 · Asia/Ho_Chi_Minh"],
        columns: READING_COLUMNS,
        rows: source(),
      },
      sink,
    );

    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(Buffer.concat(chunks));

    const sheet = workbook.getWorksheet("Book");

    if (!sheet) {
      throw new Error("the workbook came back without the sheet written");
    }

    return sheet;
  }

  it("holds the fraction itself under a percent format", async () => {
    // Not the percentage: 0.42 is what the service computed and what the cell
    // holds, and the format is what makes it read as 42.0%. A cell holding 42
    // would be a column that charts a hundred times too high.
    const sheet = await readings([{ night: "2026-08-20", occupancy: 0.42 }]);
    const cell = sheet.getRow(FIRST_READING).getCell(2);

    expect(cell.value).toBe(0.42);
    expect(cell.numFmt).toBe("0.0%");
  });

  it("carries a reading above 100% uncapped", async () => {
    // A closure that withdraws a room after the night was sold leaves a day
    // genuinely sold above what was sellable, which `schema/night-audit.ts`
    // declines to forbid. Nothing between the count and the cell may clamp it.
    const sheet = await readings([{ night: "2026-08-20", occupancy: 1.2 }]);

    expect(sheet.getRow(FIRST_READING).getCell(2).value).toBe(1.2);
  });

  it("leaves a null denominator blank rather than writing a nought", async () => {
    // The distinction the whole nullable ratio exists for: a property with no
    // room on sale has no occupancy, and a 0 in a spreadsheet is a number
    // somebody averages.
    const sheet = await readings([{ night: "2026-08-20", occupancy: null }]);

    expect(sheet.getRow(FIRST_READING).getCell(2).value).toBeNull();
  });

  it("writes a genuine nought as a nought, so the two are told apart", async () => {
    const sheet = await readings([{ night: "2026-08-20", occupancy: 0 }]);

    expect(sheet.getRow(FIRST_READING).getCell(2).value).toBe(0);
  });
});

describe("the property's clock", () => {
  it("reads an instant as the day it was in Ho Chi Minh City", () => {
    // 18:30 UTC on the 19th is already the 20th at the property.
    expect(inPropertyZone(new Date("2026-08-19T18:30:00.000Z"))).toBe(
      "2026-08-20 01:30",
    );
    expect(propertyDayOf(new Date("2026-08-19T18:30:00.000Z"))).toBe(
      "2026-08-20",
    );
  });

  it("reads midnight as 00 rather than as 24", () => {
    expect(inPropertyZone(new Date("2026-08-19T17:00:00.000Z"))).toBe(
      "2026-08-20 00:00",
    );
  });
});

async function* source(rows: readonly Movement[]): AsyncGenerator<Movement> {
  for (const row of rows) {
    yield row;
  }
}
