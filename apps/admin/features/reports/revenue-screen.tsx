"use client";

import {
  formatVnd,
  REVENUE_REPORT_EXPORT_PATH,
  REVENUE_REPORT_EXPORT_STEM,
  type RevenueBucket,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useMemo, useRef, useState } from "react";

import { DataTableFrame, EmptyState, PageHeader } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
/* The property's day, from the hook the rest of the console already asks it
 * with: one route through the same `orpc` utils is one cache entry, so the day a
 * typed range is resolved against here is the day the desk is working, without a
 * second request and without a second opinion about what its failure says. */
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { useStaffSession } from "@/lib/auth";
/* The one place the console takes a page away as a spreadsheet. The act is
 * offered here when the matrix grants both rows — this report's own and the
 * Excel export row — which is the composition `lib/excel-export.ts` argues for
 * and the API makes again on its side. */
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";
import { useHotkeys } from "@/lib/keyboard";

import { RangePicker } from "./range-picker";
import { RevenueChart } from "./report-charts";
import { useRevenueReport } from "./report-queries";
import {
  boundaryNote,
  bucketLabel,
  DEFAULT_RANGE_FIELDS,
  mayReadRevenue,
  type RangeFields,
  REVENUE_SERIES_LABELS,
  type RevenueBar,
  type RevenueBucketRow,
  type RevenueQuery,
  type RevenueReport,
  rangeQuestion,
  revenueSeries,
} from "./reports";

/* What the property earned — `FR-RPT-02`, the money half.
 *
 * ## Where each figure comes from, and why the page can mix them
 *
 * Room revenue and other revenue are read off `night_audit_snapshot`: frozen
 * when the audit closed the day, immutable at the table, and therefore the same
 * answer next month. Cancellation and no-show penalties are *not* on that row —
 * `night-audit.service.ts` keeps §4's charge out of it on the grounds that money
 * a booking forfeited by not happening is not a sale, and counting it as takings
 * would report a night of mass cancellations as a good one. So the API sums them
 * from the folio ledger and this page prints them as their own column.
 *
 * That is a page assembled from two tables, and what makes it coherent is the
 * stamp under the heading. `docs/screens.md` is explicit that the last closed
 * business date is *a boundary rather than a statement of source*: what it
 * promises is that no page shows a day the audit has not closed, not that every
 * figure was read from a frozen row. Both halves stop at it, which is safe
 * because a penalty is posted to the trading day it was taken on and the ledger
 * is append-only — a closed day's total cannot move afterwards.
 *
 * ## Who this is for
 *
 * The matrix's *Revenue and financial reports* row grants `full` to `ACCOUNTANT`,
 * `MANAGER` and `ADMIN` and lists nobody else. **A receptionist is refused,
 * deliberately**, and the API refuses the route as well as the console declining
 * to offer it: the person standing at the till holds the drawer and does not
 * read the property's takings. What they are offered under Reports is the
 * room-status page, which is the other row.
 *
 * ## The chart draws what was earned; the table carries the sign
 *
 * A bucket can be negative — a fortnight that reversed more than it charged is a
 * real fortnight, and the contract keeps the sign for exactly that. A stacked
 * bar cannot draw a negative segment, so the chart floors each part at nothing
 * and the table under it prints what the bucket actually came to. `reports.ts`
 * argues that split where the conversion happens.
 *
 * **No animation.** Operational surfaces carry no entrance motion — the picker
 * disables in place while the report is read and the chart paints in the state
 * it is going to be in.
 */

/** Where this report's export answers and what its file is called, from the
 *  contract rather than typed out here. */
const REVENUE_EXPORT: ExcelExportSubject = {
  path: REVENUE_REPORT_EXPORT_PATH,
  stem: REVENUE_REPORT_EXPORT_STEM,
  failure: "The revenue report could not be exported.",
};

export function RevenueScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<RangeFields>(DEFAULT_RANGE_FIELDS);
  const [asked, setAsked] = useState<RevenueQuery | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReadRevenue(role);
  /* Both rows, and neither alone. This report's row already denies a
   * receptionist, so the conjunction is what the *Excel export* row's note
   * "operational lists only" comes to on this page — with nothing here having to
   * know that. */
  const exportsTheReport = offered && role !== null && mayTakeAnExport(role);

  const firstDayField = useRef<HTMLInputElement>(null);

  useHotkeys("/", () => {
    firstDayField.current?.focus();
    firstDayField.current?.select();
  });

  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;

  // The opening question names no day at all, which the API answers with
  // everything the night audit has closed, by month. That is the question
  // somebody opening a revenue report has, and it can be asked before the
  // property's own day has arrived.
  const opening = useMemo<RevenueQuery | null>(() => {
    if (!offered) {
      return null;
    }

    const attempt = rangeQuestion(DEFAULT_RANGE_FIELDS, null);

    if ("problem" in attempt) {
      // Unreachable: the opening fields carry no typed date, and the only
      // refusal `rangeQuestion` has is about one. Thrown rather than quietly
      // replaced, for `folio-ledger.ts`'s reason — a screen silently opening on
      // filters nobody chose would be lying about what it is showing.
      throw new Error(attempt.problem);
    }

    return attempt.query;
  }, [offered]);

  const query = asked ?? opening;
  const report = useRevenueReport(query);
  const exported = useExcelExport(REVENUE_EXPORT);

  const bars = useMemo(
    () => (report.data === undefined ? [] : revenueSeries(report.data)),
    [report.data],
  );

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
        title="Revenue"
        description="Room, other, and forfeited revenue over closed trading days."
      />

      {!offered ? (
        <p className="text-muted-foreground mt-4 max-w-prose text-sm">
          What the property earned belongs to the accountant and management. The
          desk holds the drawer and reads its own shift; the takings are read by
          whoever accounts for them. Where the rooms stand is the report open to
          you.
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
                /* The label changes as well as the control disabling, which is
                   deliberate: a quiet month is over before anything could be
                   drawn, and a decade by day is a file the API is still
                   writing. A control that only greyed out would read as broken
                   for as long as it took. */
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
            buckets={report.data?.buckets ?? []}
            bucket={report.data?.bucket ?? fields.bucket}
            totals={report.data?.totals ?? null}
            bars={bars}
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

/** The chart, what the range came to, and the buckets it was assembled from. */
function Reading({
  pending,
  failed,
  buckets,
  bucket,
  totals,
  bars,
}: {
  pending: boolean;
  failed: boolean;
  buckets: readonly RevenueBucketRow[];
  bucket: RevenueBucket;
  totals: RevenueReport["totals"] | null;
  bars: readonly RevenueBar[];
}) {
  if (failed) {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p
        className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        The revenue report could not be loaded.
      </p>
    );
  }

  if (pending) {
    return <Skeleton className="mt-6 h-80" aria-busy />;
  }

  if (buckets.length === 0 || totals === null) {
    return (
      <EmptyState
        className="mt-6"
        title="No closed days in range"
        description="Adjust the range or check the audit boundary above."
      />
    );
  }

  return (
    <>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Total
          label={REVENUE_SERIES_LABELS.room}
          value={formatVnd(totals.roomRevenueVnd)}
        />
        <Total
          label={REVENUE_SERIES_LABELS.other}
          value={formatVnd(totals.otherRevenueVnd)}
        />
        <Total
          label={REVENUE_SERIES_LABELS.penalties}
          value={formatVnd(totals.penaltyRevenueVnd)}
        />
        <Total label="Total" value={formatVnd(totals.totalVnd)} emphasis />
      </dl>

      <section className="mt-6 rounded-lg bg-card p-4 shadow-card">
        <RevenueChart bars={bars} />
      </section>

      <DataTableFrame className="mt-6 scrollbar-visible overflow-x-auto p-4">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <caption className="text-muted-foreground mb-2 text-left text-sm">
            Every bucket the range reached, earliest first. `From` and `To` are
            the first and last day the audit closed inside the bucket rather
            than its calendar span, so a month the audit has only reached the
            twentieth of says so — and `Closed days` is how many nights the
            figures beside it were assembled from.
          </caption>
          <thead>
            <tr className="border-border border-b">
              <Column>Bucket</Column>
              <Column>From</Column>
              <Column>To</Column>
              <Column align="right">Closed days</Column>
              <Column align="right">{REVENUE_SERIES_LABELS.room}</Column>
              <Column align="right">{REVENUE_SERIES_LABELS.other}</Column>
              <Column align="right">{REVENUE_SERIES_LABELS.penalties}</Column>
              <Column align="right">Total</Column>
            </tr>
          </thead>
          <tbody>
            {buckets.map((held) => (
              <tr className="border-border border-b" key={held.from}>
                <td className="py-1 pr-3 whitespace-nowrap first:pl-0">
                  {bucketLabel(held.from, bucket)}
                </td>
                <td className="px-3 py-1 whitespace-nowrap">{held.from}</td>
                <td className="px-3 py-1 whitespace-nowrap">{held.to}</td>
                <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
                  {held.closedDays}
                </td>
                <Money amount={held.roomRevenueVnd} />
                <Money amount={held.otherRevenueVnd} />
                <Money amount={held.penaltyRevenueVnd} />
                <Money amount={held.totalVnd} emphasis />
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </>
  );
}

/** One đồng figure in a cell. Formatted from the `bigint` the API sent, never
 *  from the number the chart was drawn at — the sign included, because a bucket
 *  of corrections is genuinely negative. */
function Money({ amount, emphasis }: { amount: bigint; emphasis?: boolean }) {
  return (
    <td
      className={
        emphasis
          ? "px-3 py-1 text-right tabular-nums whitespace-nowrap last:pr-0"
          : "text-muted-foreground px-3 py-1 text-right tabular-nums whitespace-nowrap last:pr-0"
      }
    >
      {formatVnd(amount)}
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
