"use client";

import {
  formatVnd,
  PERFORMANCE_REPORT_EXPORT_PATH,
  PERFORMANCE_REPORT_EXPORT_STEM,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useMemo, useRef, useState } from "react";

import { DataTableFrame, EmptyState, PageHeader } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
/* The property's day, from the hook the rest of the console already asks it
 * with — the revenue page's reason, unchanged: one route through the same
 * `orpc` utils is one cache entry, so a typed range is resolved against the day
 * the desk is working without a second request and without a second opinion. */
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { useStaffSession } from "@/lib/auth";
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";
import { useHotkeys } from "@/lib/keyboard";

import { RangePicker } from "./range-picker";
import { PerformanceChart } from "./report-charts";
import { usePerformanceReport } from "./report-queries";
import {
  boundaryNote,
  DEFAULT_RANGE_FIELDS,
  formatOccupancy,
  formatRatioVnd,
  mayReadPerformance,
  PERFORMANCE_FIGURE_LABELS,
  type PerformanceQuery,
  type PerformanceReport,
  type PerformanceTypeRow,
  type RangeFields,
  rangeQuestion,
} from "./reports";

/* Occupancy, ADR and RevPAR — `FR-RPT-03`.
 *
 * ## Three ratios of two counts
 *
 * How full the property was, what it sold a room for, and what each room it
 * could have sold earned. All three are divisions of figures the night audit
 * froze — `contract/reporting.ts` states the formulas over the columns they are
 * read from — and none of them is stored: a stored ADR cannot be re-totalled,
 * and the API counts each range over its own closed days rather than averaging
 * the buckets under it, so a quarter and the three months in it agree.
 *
 * This is the family's strictest reading of the stamp. Every figure here comes
 * from a closed night and nothing on the page reads a live table, so the
 * boundary under the heading is not just a promise about what is missing — it is
 * also, on this page alone, where all of it came from.
 *
 * ## Who this is for
 *
 * The matrix's *Occupancy / ADR / RevPAR* row, which is `reporting.performance`
 * and grants the accountant, the manager and the administrator. **It is a
 * different row from the revenue report's** even though today it names the same
 * three roles — `mayReadPerformance` says why it is a second predicate rather
 * than an alias. The desk is refused by the API as well as not offered the door.
 *
 * ## What is charted and what is tabulated
 *
 * The chart draws the property-wide series, one figure at a time; the table
 * under it carries the range's totals for every room type the range reached.
 * **The per-type figures are deliberately not charted.** Five types across up to
 * 365 daily buckets is an illegible chart and a legible table — the brainstorm
 * left the choice to the committed chart components and this is it. A reader who
 * needs a type's figures *per bucket* takes the Excel export, which carries
 * exactly that; putting them on the screen would cost the page its legibility to
 * answer a question a spreadsheet answers better.
 *
 * **No animation.** The picker disables in place while the report is read and
 * the chart paints in the state it is going to be in.
 */

/** Where this report's export answers and what its file is called, from the
 *  contract rather than typed out here. */
const PERFORMANCE_EXPORT: ExcelExportSubject = {
  path: PERFORMANCE_REPORT_EXPORT_PATH,
  stem: PERFORMANCE_REPORT_EXPORT_STEM,
  failure: "The performance report could not be exported.",
};

export function PerformanceScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<RangeFields>(DEFAULT_RANGE_FIELDS);
  const [asked, setAsked] = useState<PerformanceQuery | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReadPerformance(role);
  /* Both rows, and neither alone — the composition `lib/excel-export.ts` argues
   * and the API makes again on its side. This report's own row already denies
   * the desk, so the conjunction is what the *Excel export* row's "operational
   * lists only" comes to here without this file knowing that. */
  const exportsTheReport = offered && role !== null && mayTakeAnExport(role);

  const firstDayField = useRef<HTMLInputElement>(null);

  useHotkeys("/", () => {
    firstDayField.current?.focus();
    firstDayField.current?.select();
  });

  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;

  // The opening question names no day, which the API answers with everything the
  // night audit has closed, by month — and can be asked before the property's
  // own day has arrived.
  const opening = useMemo<PerformanceQuery | null>(() => {
    if (!offered) {
      return null;
    }

    const attempt = rangeQuestion(DEFAULT_RANGE_FIELDS, null);

    if ("problem" in attempt) {
      // Unreachable: the opening fields carry no typed date, and the only
      // refusal `rangeQuestion` has is about one. Thrown rather than quietly
      // replaced — a screen silently opening on filters nobody chose would be
      // lying about what it is showing.
      throw new Error(attempt.problem);
    }

    return attempt.query;
  }, [offered]);

  const query = asked ?? opening;
  const report = usePerformanceReport(query);
  const exported = useExcelExport(PERFORMANCE_EXPORT);

  /* The file carries the question the page is showing rather than the words
   * currently in the fields: `query` is what was submitted and what the chart
   * below was drawn from, so the export cannot be a wider stretch than the one
   * being read. */
  function takeTheReport() {
    if (query !== null) {
      exported.mutate(query);
    }
  }

  function ask() {
    const attempt = rangeQuestion(fields, businessDate);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setAsked(attempt.query);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Performance"
        description="Hotel performance over closed trading days."
      />

      {!offered ? (
        <p className="text-muted-foreground mt-4 max-w-prose text-sm">
          How the property performed belongs to the accountant and management.
          The desk sells the rooms and reads its own shift; what the selling
          came to is read by whoever answers for it. Where the rooms stand is
          the report open to you.
        </p>
      ) : (
        <>
          <Card className="mt-6 p-4">
            <RangePicker
              fields={fields}
              firstDayField={firstDayField}
              pending={report.isFetching}
              onChange={setFields}
              onSubmit={ask}
            />

            {problem === null ? null : (
              <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
                {problem}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Stamp
                pending={report.isPending}
                failed={report.isError}
                lastClosedBusinessDate={
                  report.data?.lastClosedBusinessDate ?? null
                }
              />
              {exportsTheReport ? (
                /* The label changes as well as the control disabling: a quiet
                   month is over before anything could be drawn, and a decade by
                   day is a file the API is still writing. */
                <Button
                  type="button"
                  variant="ghost"
                  disabled={query === null || exported.isPending}
                  onClick={takeTheReport}
                >
                  {exported.isPending ? "Writing the file" : "Export to Excel"}
                </Button>
              ) : null}
            </div>
          </Card>

          <Reading
            pending={report.isPending}
            failed={report.isError}
            report={report.data ?? null}
          />
        </>
      )}
    </div>
  );
}

/**
 * The boundary, in the words `screens.md` gives it.
 *
 * Drawn from the answer rather than from the request, because the boundary is a
 * fact about the property's own books and not about what was asked for: a reader
 * who typed a range ending next Friday is told where the audit has actually
 * reached, which is the fact they are missing.
 */
function Stamp({
  pending,
  failed,
  lastClosedBusinessDate,
}: {
  pending: boolean;
  failed: boolean;
  lastClosedBusinessDate: string | null;
}) {
  if (failed) {
    return null;
  }

  return (
    <span className="text-muted-foreground text-sm">
      {pending ? "Reading the report." : boundaryNote(lastClosedBusinessDate)}
    </span>
  );
}

/** What the range came to property-wide, the chart it was cut into, and the
 *  types underneath it. */
function Reading({
  pending,
  failed,
  report,
}: {
  pending: boolean;
  failed: boolean;
  report: PerformanceReport | null;
}) {
  if (failed) {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p
        className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        The performance report could not be loaded.
      </p>
    );
  }

  if (pending || report === null) {
    return <Skeleton className="mt-6 h-80" aria-busy />;
  }

  if (report.buckets.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="No closed days in range"
        description="Adjust the range or check the audit boundary above."
      />
    );
  }

  const whole = report.totals.property;

  return (
    <>
      {/* The range's own figures, counted over every closed day it reached
          rather than averaged from the buckets — which is why they can be read
          beside the chart without contradicting it. */}
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Total
          label={PERFORMANCE_FIGURE_LABELS.OCCUPANCY}
          value={formatOccupancy(whole.occupancy)}
          emphasis
        />
        <Total
          label={PERFORMANCE_FIGURE_LABELS.ADR}
          value={formatRatioVnd(whole.adrVnd)}
        />
        <Total
          label={PERFORMANCE_FIGURE_LABELS.REVPAR}
          value={formatRatioVnd(whole.revparVnd)}
        />
        <Total
          label="Closed days"
          value={report.totals.closedDays.toString()}
        />
      </dl>

      <section className="mt-6 rounded-lg bg-card p-4 shadow-card">
        <PerformanceChart report={report} />
      </section>

      <DataTableFrame className="mt-6 scrollbar-visible overflow-x-auto p-4">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <caption className="text-muted-foreground mb-2 text-left text-sm">
            What each room type came to over the whole range. These are the
            range's own counts rather than the buckets averaged, so a type's
            rate here is what its rooms actually sold for across every closed
            day. Per bucket and per type is what the Excel export carries — five
            types across a year of days is a table worth reading and a chart
            nobody could. A figure with no answer — a type nothing was on sale
            for, a type nothing sold from — is a dash rather than a zero.
          </caption>
          <thead>
            <tr className="border-border border-b">
              <Column>Room type</Column>
              <Column align="right">Sellable rooms</Column>
              <Column align="right">Rooms sold</Column>
              <Column align="right">Net room revenue</Column>
              <Column align="right">
                {PERFORMANCE_FIGURE_LABELS.OCCUPANCY}
              </Column>
              <Column align="right">{PERFORMANCE_FIGURE_LABELS.ADR}</Column>
              <Column align="right">{PERFORMANCE_FIGURE_LABELS.REVPAR}</Column>
            </tr>
          </thead>
          <tbody>
            {report.totals.byType.map((type) => (
              <TypeRow key={type.roomType} type={type} />
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </>
  );
}

/** One room type's range. The code is printed as it stands, which is what
 *  `features/rooms` prints on every row of the room list — a second spelling of
 *  `JUNIOR_SUITE` here would be a third vocabulary for a value the property
 *  already names one way. */
function TypeRow({ type }: { type: PerformanceTypeRow }) {
  return (
    <tr className="border-border border-b">
      <td className="py-1 pr-3 whitespace-nowrap first:pl-0">
        {type.roomType}
      </td>
      <Count value={type.sellableRooms} />
      <Count value={type.roomsSold} />
      <Figure value={formatVnd(type.netRoomRevenueVnd)} />
      <Figure value={formatOccupancy(type.occupancy)} emphasis />
      <Figure value={formatRatioVnd(type.adrVnd)} />
      <Figure value={formatRatioVnd(type.revparVnd)} />
    </tr>
  );
}

/** A whole number of rooms. */
function Count({ value }: { value: number }) {
  return (
    <td className="text-muted-foreground px-3 py-1 text-right tabular-nums whitespace-nowrap">
      {value}
    </td>
  );
}

/** One already-formatted figure in a cell — money from the `bigint` the API
 *  sent, a fraction as a percentage, or the dash for a ratio whose denominator
 *  was zero. Formatting happens in `reports.ts` so the same figure is spelled
 *  the same way in the chart's tooltip and here. */
function Figure({ value, emphasis }: { value: string; emphasis?: boolean }) {
  return (
    <td
      className={
        emphasis
          ? "px-3 py-1 text-right tabular-nums whitespace-nowrap last:pr-0"
          : "text-muted-foreground px-3 py-1 text-right tabular-nums whitespace-nowrap last:pr-0"
      }
    >
      {value}
    </td>
  );
}

function Total({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-card">
      <dt className="text-xs font-semibold tracking-caps text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "mt-2 text-2xl font-semibold tabular-nums"
            : "mt-2 text-2xl font-semibold text-muted-foreground tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Column({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={
        align === "right"
          ? "text-muted-foreground px-3 py-2 text-right text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
          : "text-muted-foreground px-3 py-2 text-left text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
      }
    >
      {children}
    </th>
  );
}
