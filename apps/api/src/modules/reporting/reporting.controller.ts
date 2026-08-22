// The three Excel exports over HTTP — `FR-OPS-03`'s routes.
//
// **These are plain Nest routes and not oRPC procedures, and the reason is the
// response.** Everything else in this tree answers with JSON that a contract
// validates on both sides, which is the guarantee `contract/index.ts` exists
// for. A spreadsheet is not JSON. oRPC can carry a `Blob`, so the shape would
// have compiled — but a `Blob` is the whole file in memory before the first byte
// leaves, which is precisely what "streamed" in the requirement rules out. The
// choice was therefore between the contract's compile-time guarantee and the
// requirement, and the requirement wins; what is recovered is that the address,
// the filters, the media type and the file name are declared in
// `contract/reporting.ts` and read from there by both sides, so the two ends
// still cannot drift about anything a schema could have held.
//
// `payment.controller.ts` already has ordinary `@Get` handlers beside the oRPC
// ones for its two non-JSON routes, so this is the tree's existing arrangement
// rather than a new one — and, like those, these routes go through the same
// global `AccessGuard` as everything else. There is no second door here.
//
// **Two capabilities guard every route, and only one of them is a decorator.**
// `reporting.excel-export` is declared below and enforced by the guard;
// `export-authority.ts` resolves the row that governs the list underneath and
// says at length why composing the two is what makes the matrix's "RCP:
// operational lists only" note fall out instead of being copied. Both are
// resolved before a single byte is written.
//
// **The transaction wraps the whole write**, which is unusual in this codebase
// and deliberate. Every other controller opens one so that a page and the count
// beside it are one moment; here it is so that a file assembled from twenty
// pages is one moment, since a reader cannot see that the eleventh page was
// read after somebody recorded an entry. The cost is a pooled connection held
// for as long as the download takes, and it is the right trade for an act a
// property performs a few times a month against one that would otherwise
// produce a month's totals that do not add up.
//
// **Nothing is refused once bytes are moving.** Filters are parsed, the two
// capabilities are resolved and the scope is decided before `writeExcelSheet` is
// reached, because after that the status line is already gone and the only
// signal left is a truncated download.

import {
  CASH_BOOK_EXPORT_PATH,
  CASH_BOOK_EXPORT_STEM,
  cashBookExportInput,
  CHANGE_LOG_EXPORT_PATH,
  CHANGE_LOG_EXPORT_STEM,
  changeLogExportInput,
  EXCEL_MEDIA_TYPE,
  excelExportFileName,
  SHIFT_HISTORY_EXPORT_PATH,
  SHIFT_HISTORY_EXPORT_STEM,
  shiftHistoryExportInput,
} from "@mariva/shared";
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { InjectPinoLogger, type PinoLogger } from "nestjs-pino";
import type { z } from "zod";
import {
  CurrentPrincipal,
  RequiresCapability,
} from "../../common/auth/access.decorators.js";
import type { Principal } from "../../common/auth/principal.js";
import type { DbExecutor } from "../../database/database.module.js";
import { TransactionRunner } from "../../database/transaction-runner.js";
import {
  type ExcelSheet,
  propertyDayOf,
  writeExcelSheet,
} from "./excel-sheet.js";
import {
  exportingStaffMember,
  readingTheListBehind,
  readsEverythingOn,
} from "./export-authority.js";
import { ManagementExports } from "./management-exports.js";

@Controller()
export class ReportingController {
  constructor(
    private readonly sheets: ManagementExports,
    private readonly transactions: TransactionRunner,
    @InjectPinoLogger(ReportingController.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * The property's own cash book, filtered as the screen filtered it.
   *
   * `operations.income-expense` is the second capability, and it denies
   * `RECEPTIONIST` outright — so the person standing at the till reaches no
   * cash-book export at all, which is the same separation
   * `cash-book.controller.ts` states for the screen: whoever holds the money is
   * not whoever books what left it. Nothing here narrows, because that row
   * grants `full` to each of its three holders and carries no note; a scope
   * decided here would be a decision with one outcome.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(CASH_BOOK_EXPORT_PATH)
  async exportCashBook(
    @CurrentPrincipal() principal: Principal | null,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    readingTheListBehind("operations.income-expense", principal);

    const filters = asked(cashBookExportInput, query);
    const takenAt = new Date();

    await this.send(response, CASH_BOOK_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.cashBookSheet(exec, filters, takenAt),
    );
  }

  /**
   * The desk's working days, with the variance and the handover on each.
   *
   * `operations.cash-drawer` is the second capability, and the narrowing is the
   * whole of "RCP: own shift": a receptionist's `⚠` gets their own drawers and
   * the accountant's 👁 gets everybody's, which is exactly what
   * `shift.controller.ts` decides for the list. A narrowed caller's `operatorId`
   * is overwritten rather than refused, for the reason that file gives — a
   * filter this route is about to answer anyway is not worth a 403 — and the
   * file says so in its own stamp, because a short sheet otherwise looks like a
   * quiet fortnight.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(SHIFT_HISTORY_EXPORT_PATH)
  async exportShiftHistory(
    @CurrentPrincipal() principal: Principal | null,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const grant = readingTheListBehind("operations.cash-drawer", principal);
    const ownShiftsOnly = !readsEverythingOn(grant);

    const asAsked = asked(shiftHistoryExportInput, query);
    const filters = ownShiftsOnly
      ? { ...asAsked, operatorId: exportingStaffMember(principal) }
      : asAsked;

    const takenAt = new Date();

    await this.send(response, SHIFT_HISTORY_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.shiftHistorySheet(exec, filters, ownShiftsOnly, takenAt),
    );
  }

  /**
   * The change log, as much of it as the reader may see.
   *
   * `audit.read` is the second capability. It denies `RECEPTIONIST` and hands
   * `ACCOUNTANT` a `⚠`, so the accountant's file holds financial entries only —
   * `financial-tables.ts` owns what *financial* means and nothing here restates
   * it. The scope is applied as the list's own predicate rather than as a second
   * gate, so an accountant who filtered on `stay_restriction` gets a file with a
   * header and no rows rather than a refusal, which is the answer
   * `audit.controller.ts` gives to the same question.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(CHANGE_LOG_EXPORT_PATH)
  async exportChangeLog(
    @CurrentPrincipal() principal: Principal | null,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const grant = readingTheListBehind("audit.read", principal);
    const financialOnly = !readsEverythingOn(grant);

    const filters = asked(changeLogExportInput, query);
    const takenAt = new Date();

    await this.send(response, CHANGE_LOG_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.changeLogSheet(exec, filters, financialOnly, takenAt),
    );
  }

  /**
   * Names the download, opens the transaction, and streams the sheet into the
   * response.
   *
   * The headers are set before the writer touches the stream, because Express
   * flushes them on the first byte and exceljs writes the workbook's opening
   * entries as soon as it has a worksheet — there is no later moment.
   *
   * **A failure after the first byte destroys the connection.** The status is
   * already 200 and cannot be taken back, so the alternatives are an incomplete
   * file the browser reports as a failed download, or a well-formed zip holding
   * half a month that opens without complaint. The first is the only honest one.
   * It is logged here rather than rethrown, because Nest's exception layer would
   * try to write a JSON body onto a socket that no longer exists; a failure
   * before the first byte is rethrown as usual and answers with a status.
   */
  private async send<Row>(
    response: Response,
    stem: string,
    takenAt: Date,
    sheet: (exec: DbExecutor) => ExcelSheet<Row>,
  ): Promise<void> {
    const fileName = excelExportFileName(stem, propertyDayOf(takenAt));

    response.setHeader("content-type", EXCEL_MEDIA_TYPE);
    response.setHeader(
      "content-disposition",
      `attachment; filename="${fileName}"`,
    );
    // The file holds the property's money and one reader's scope. Nothing
    // between here and the console may keep a copy of it to hand to the next
    // person who asks.
    response.setHeader("cache-control", "no-store");

    try {
      await this.transactions.run((exec) =>
        writeExcelSheet(sheet(exec), response),
      );
    } catch (error) {
      if (!response.headersSent) {
        throw error;
      }

      this.logger.error(
        { err: error, fileName },
        "an export failed after its first byte; the download was cut off",
      );

      response.destroy();
    }
  }
}

/**
 * The filters as the contract decodes them, or a refusal naming the field.
 *
 * A query string is text a person can type, so this is a boundary and is
 * validated like one. The message is zod's own — it names the field and says
 * what was wrong with it, which is what somebody who edited a url needs — rather
 * than a sentence invented here that would say less.
 *
 * Generic over the schema so the three routes share it. Each of them passes the
 * schema `contract/reporting.ts` declares for it, so what is accepted here is
 * exactly what the console was allowed to ask.
 */
function asked<Schema extends z.ZodType>(
  schema: Schema,
  query: unknown,
): z.infer<Schema> {
  const read = schema.safeParse(query);

  if (!read.success) {
    throw new BadRequestException(
      `That export was asked for with filters it cannot take: ${read.error.message}`,
    );
  }

  return read.data;
}
