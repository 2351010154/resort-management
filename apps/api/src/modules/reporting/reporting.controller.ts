// The Reports family on the API — `FR-RPT-02`'s two reads, `FR-RPT-03`'s KPI
// read and `FR-OPS-03`'s six Excel exports.
//
// **Three reads and six exports in one controller, which is the arrangement the
// tree already has.** `payment.controller.ts` puts ordinary `@Get` handlers
// beside its oRPC ones for the same reason: an export is a page taken away as a
// file, so refusing it and refusing the page it came from are one decision made
// in one place. The reads are declared against `contract.reporting` and the
// exports against the paths the same file holds.
//
// **Every route here is governed by two capabilities and the pairing is not a
// convention.** A read declares the row that owns its subject —
// `reporting.financial` for revenue, `reporting.operational` for room status,
// `reporting.performance` for occupancy, ADR and RevPAR — and nothing else. The
// three rows are three separate grants and not one Reports permission: an
// accountant reads the takings in full and the KPIs at 👁, and a receptionist
// holds neither. An export declares `reporting.excel-export` at the guard and
// then asks `export-authority.ts` for the caller's grant on that same subject
// row, which is what makes the matrix's "RCP: operational lists only" note fall
// out instead of being copied: a receptionist is denied `reporting.financial`
// outright, so no revenue file exists for them to reach, and they hold the
// operational row, so the room-status file is theirs. Nothing in this file knows
// that.
//
// **No report is narrowed, and `readingEveryFigureOn` is why that is a
// refusal rather than an omission.** A report is one figure over every stay the
// property took; there are no rows in it to withhold from a narrowed reader, so
// a narrowed grant is refused the file rather than handed a scoped version of
// one that cannot exist.
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
// The export routes go through the same global `AccessGuard` as everything
// else. There is no second door here.
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
  contract,
  EXCEL_MEDIA_TYPE,
  excelExportFileName,
  PERFORMANCE_REPORT_EXPORT_PATH,
  PERFORMANCE_REPORT_EXPORT_STEM,
  performanceReportQuery,
  REVENUE_REPORT_EXPORT_PATH,
  REVENUE_REPORT_EXPORT_STEM,
  revenueReportQuery,
  ROOM_STATUS_REPORT_EXPORT_PATH,
  ROOM_STATUS_REPORT_EXPORT_STEM,
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
import { Implement, implement } from "@orpc/nest";
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
  readingEveryFigureOn,
  readingTheListBehind,
  readsEverythingOn,
} from "./export-authority.js";
import { ManagementExports } from "./management-exports.js";
import { PerformanceQueries } from "./performance-queries.service.js";
import { ReportQueries } from "./report-queries.service.js";

@Controller()
export class ReportingController {
  constructor(
    private readonly sheets: ManagementExports,
    private readonly reports: ReportQueries,
    // Named for what it answers rather than for its type, because the read
    // route below is called `performance` and a field of that name would be the
    // handler it is meant to serve.
    private readonly kpis: PerformanceQueries,
    private readonly transactions: TransactionRunner,
    @InjectPinoLogger(ReportingController.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * What the property earned over a stretch of closed trading days —
   * `FR-RPT-02`'s revenue page.
   *
   * `reporting.financial` is the row, asked for `read` because that is what this
   * is: the matrix grants it `full` to `ACCOUNTANT`, `MANAGER` and `ADMIN` and
   * names nobody else, so a receptionist reaching this url is refused here
   * whatever the console offered them. That refusal is the point rather than a
   * side effect — the desk sees the drawer it is holding and the property's
   * takings are the accountant's and the owner's.
   *
   * The transaction is opened for a read, as `housekeeping.controller.ts` opens
   * one for its board and for the same two reasons: the service needs an
   * executor, and the three statements behind this page have to see one snapshot
   * of the database or a night audit committing between them would produce a page
   * whose penalties reach a day whose revenue does not.
   */
  @RequiresCapability("reporting.financial", "read")
  @Implement(contract.reporting.revenue)
  revenue() {
    return implement(contract.reporting.revenue).handler(async ({ input }) => {
      const report = await this.transactions.run((exec) =>
        this.reports.revenue(exec, input),
      );

      // Copied out of the service's readonly arrays rather than handed over,
      // which is the one crossing every controller in this tree makes at its own
      // edge: a service promises a caller cannot rearrange what it answered
      // with, and the wire shape is a plain array. `housekeeping.controller.ts`
      // maps its board over for the same reason.
      return { ...report, buckets: [...report.buckets] };
    });
  }

  /**
   * Where every room stands, counted now — `FR-RPT-02`'s room-status page.
   *
   * `reporting.operational` is the row, and it is a different one from the page
   * above deliberately: this is the state of the floors rather than the state of
   * the books, and the matrix grants it to the desk and to housekeeping as well
   * as to management. An accountant is not on it and does not reach this — which
   * is the mirror of the revenue page and the same separation read from the other
   * side.
   *
   * **Nothing here is read from a snapshot.** `screens.md` is explicit that a
   * housekeeping status is where a room stands now and never a fact about a night
   * that has ended, so this counts `room_condition` live; the last closed business
   * date travels with it as the family's boundary, and
   * `roomStatusReportSchema` says in its own words that the stamp is not the
   * counts' source.
   */
  @RequiresCapability("reporting.operational", "read")
  @Implement(contract.reporting.roomStatus)
  roomStatus() {
    return implement(contract.reporting.roomStatus).handler(async () => {
      const report = await this.transactions.run((exec) =>
        this.reports.roomStatus(exec),
      );

      return {
        // The one conversion this route makes: an instant becomes the text the
        // contract declares, here at the edge where it can be seen rather than
        // inside a service that has no opinion about the wire.
        takenAt: report.takenAt.toISOString(),
        lastClosedBusinessDate: report.lastClosedBusinessDate,
        rooms: report.rooms,
        byStatus: [...report.byStatus],
        byType: report.byType.map((type) => ({
          ...type,
          byStatus: [...type.byStatus],
        })),
      };
    });
  }

  /**
   * How the property performed over a stretch of closed trading days —
   * `FR-RPT-03`'s occupancy, ADR and RevPAR.
   *
   * **`reporting.performance` and not `reporting.financial`, and the two rows
   * are different on purpose.** `rbac-matrix.md` §Reports separates *Occupancy /
   * ADR / RevPAR* from *Revenue and financial reports*: the accountant holds this
   * one at 👁 rather than at ✅, and nobody else outside management holds it at
   * all. So a receptionist reaching this url is refused here whatever the console
   * offered them, and refused on a row of its own rather than by borrowing the
   * revenue page's — a page that resolved a neighbour's capability would be the
   * matrix written twice, and the second copy is the one that goes stale.
   *
   * `read` is the action because that is what this is; the row grants `full` to
   * `MANAGER` and `ADMIN`, and `full` permits a read.
   *
   * The transaction is opened for a read for the reason the revenue page above
   * gives: the three statements behind this page have to see one snapshot of the
   * database, or a night audit committing between them would produce a page whose
   * per-type rows reach a day whose property row does not.
   */
  @RequiresCapability("reporting.performance", "read")
  @Implement(contract.reporting.performance)
  performance() {
    return implement(contract.reporting.performance).handler(
      async ({ input }) => {
        const report = await this.transactions.run((exec) =>
          this.kpis.performance(exec, input),
        );

        // Copied out of the service's readonly arrays at both levels, which is
        // the crossing the revenue route above makes for its one level: this
        // page nests a per-type array inside every bucket, so a shallow copy
        // would hand the wire a frozen array one step down.
        return {
          ...report,
          buckets: report.buckets.map((bucket) => ({
            ...bucket,
            byType: [...bucket.byType],
          })),
          totals: { ...report.totals, byType: [...report.totals.byType] },
        };
      },
    );
  }

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
   * The revenue page as a file.
   *
   * `reporting.financial` is the second capability and it denies `RECEPTIONIST`
   * outright, so the person standing at the till reaches no revenue export at
   * all — which is exactly the matrix note "RCP: operational lists only" without
   * this file having to know it.
   *
   * `readingEveryFigureOn` rather than a scope, because a report is an aggregate
   * and there is no narrow version of a month total. `export-authority.ts` argues
   * that at length; the short of it is that a narrowed reader handed a
   * property-wide figure is holding what the narrowing exists to withhold.
   *
   * The filters are the page's own query object, decoded by the same schema the
   * oRPC route above takes. There is no export-shaped copy of it — a report has
   * no page to drop, so a second shape could only drift.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(REVENUE_REPORT_EXPORT_PATH)
  async exportRevenue(
    @CurrentPrincipal() principal: Principal | null,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    readingEveryFigureOn("reporting.financial", principal);

    const filters = asked(revenueReportQuery, query);
    const takenAt = new Date();

    await this.send(response, REVENUE_REPORT_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.revenueSheet(exec, filters, takenAt),
    );
  }

  /**
   * The room-status page as a file.
   *
   * `reporting.operational` is the second capability. It hands `HOUSEKEEPING` a
   * `⚠` — "HK: own board" — and they are denied `reporting.excel-export`
   * outright, so the guard above has already refused them and the narrowing this
   * route would otherwise have to interpret never arrives. `ACCOUNTANT` holds
   * the export row and not this one, so their refusal comes from
   * `readingEveryFigureOn` and names the report rather than the file.
   *
   * No filters, because the page has none: a live count over `room_condition`
   * has no range to cut and `roomStatusReportQuery` says so by being empty.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(ROOM_STATUS_REPORT_EXPORT_PATH)
  async exportRoomStatus(
    @CurrentPrincipal() principal: Principal | null,
    @Res() response: Response,
  ): Promise<void> {
    readingEveryFigureOn("reporting.operational", principal);

    const takenAt = new Date();

    await this.send(response, ROOM_STATUS_REPORT_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.roomStatusSheet(exec, takenAt),
    );
  }

  /**
   * The performance page as a file.
   *
   * `reporting.performance` is the second capability, and it is the row that
   * owns these figures rather than the revenue export's: the matrix denies
   * `RECEPTIONIST` *Occupancy / ADR / RevPAR* outright, so there is no
   * performance file for the desk to reach, and hands `ACCOUNTANT` the row at
   * 👁 — which is a claim about what may be done to the figures and not about
   * which of them, so their file is whole. Asking for the row here rather than
   * borrowing the revenue export's is what keeps the two grants two grants; a
   * route that resolved a neighbour's capability would be the matrix written
   * twice.
   *
   * `readingEveryFigureOn` rather than a scope, for the reason
   * {@link exportRevenue} gives: a report is an aggregate and there is no narrow
   * version of a month's occupancy.
   *
   * The filters are the page's own query object, decoded by the same schema the
   * oRPC route above takes — a report has no page to drop, so a second
   * export-shaped copy could only drift.
   */
  @RequiresCapability("reporting.excel-export", "read")
  @Get(PERFORMANCE_REPORT_EXPORT_PATH)
  async exportPerformance(
    @CurrentPrincipal() principal: Principal | null,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    readingEveryFigureOn("reporting.performance", principal);

    const filters = asked(performanceReportQuery, query);
    const takenAt = new Date();

    await this.send(response, PERFORMANCE_REPORT_EXPORT_STEM, takenAt, (exec) =>
      this.sheets.performanceSheet(exec, filters, takenAt),
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
   * **The sheet may be a promise, and that is what the two report exports need.**
   * A list's sheet is describable before anything is read — the stamp is the
   * filters the operator typed — where a report's stamp is the last business date
   * the night audit closed, which is a fact. Awaiting it here keeps that read
   * *before* `writeExcelSheet`, which is where everything refusable in this file
   * already happens: the status line is still available until the first byte, and
   * after it there is nothing left to say.
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
    sheet: (exec: DbExecutor) => ExcelSheet<Row> | Promise<ExcelSheet<Row>>,
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
      await this.transactions.run(async (exec) =>
        writeExcelSheet(await sheet(exec), response),
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
 * Generic over the schema so the export routes share it. Each of them passes
 * the schema `contract/reporting.ts` declares for it, so what is accepted here
 * is exactly what the console was allowed to ask — and for the revenue export
 * that is literally the schema the read route takes, since a report has no page
 * for an export shape to leave out.
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
