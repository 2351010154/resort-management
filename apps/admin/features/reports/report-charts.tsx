"use client";

import { formatVnd } from "@mariva/shared";
import { useId, useMemo, useState } from "react";

import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  ABSENT_FIGURE,
  DEFAULT_PERFORMANCE_FIGURE,
  formatOccupancy,
  PERFORMANCE_FIGURE_LABELS,
  PERFORMANCE_FIGURES,
  type PerformanceFigure,
  type PerformanceReport,
  performanceSeries,
  REVENUE_SERIES_LABELS,
  type RevenueBar,
  ROOM_STATUS_LABELS,
  type RoomStatusBar,
} from "./reports";

/* The Reports family's charts, over the vendored Bklit components.
 *
 * **What is in this file is the whole of what the console tells those
 * components.** The colours are not here: every series is a `var(--chart-N)`,
 * and `app/globals.css` answers those names out of @mariva/tokens — the
 * restyle is one block of that stylesheet rather than props threaded through
 * these components, which is what makes it a change to the brand rather than a
 * change to two charts. The one thing this file does say about colour is *which*
 * step of the ramp each series takes, because that is a fact about the series
 * rather than about the palette: the stack reads dark to light in the order a
 * reader adds it up.
 *
 * **There is no entrance animation and there is no `status="loading"`.**
 * `NFR-04` allows neither on an operational screen, and the neutralisation is in
 * the vendored source rather than in these props — `components/charts/
 * animation.ts` argues why a default is the only version of that promise a new
 * chart cannot forget to keep. What a page says while it is waiting is a line of
 * text above the chart, like every other pending state in this console.
 *
 * **The tooltip is written by hand and formats đồng from the API's own
 * figures.** The default tooltip prints the number it was handed, which on a
 * revenue chart is a run of nine digits with no separator and no currency.
 * `formatVnd` is the console's one rendering of money, and it is reached here
 * through the same point the bars were built from — `revenueSeries` says why a
 * bar's height is the only place a `bigint` becomes a `number`.
 */

/** The step of the palette's ramp each revenue series takes. Dark to light in
 *  the order the stack is read: the room charges are the property's business,
 *  what else it sold sits on top, and the money a cancellation forfeited is the
 *  lightest because it is the least like a sale — which is the same argument
 *  `night-audit.service.ts` makes for keeping it out of the snapshot. */
const REVENUE_FILLS = {
  room: "var(--chart-2)",
  other: "var(--chart-3)",
  penalties: "var(--chart-4)",
} as const;

/** And for the four conditions, in `HOUSEKEEPING_STATUSES` order. `OUT_OF_ORDER`
 *  takes the accent rather than a step of the ramp, because it is the one
 *  condition somebody has to do something about — `design-foundations.md`
 *  reserves --dusk-amber for a state mark, which is exactly this. */
const ROOM_STATUS_FILLS = {
  CLEAN: "var(--chart-2)",
  DIRTY: "var(--chart-4)",
  INSPECTED: "var(--chart-3)",
  OUT_OF_ORDER: "var(--chart-crosshair)",
} as const;

/**
 * What the property earned, one stacked bar per bucket.
 *
 * Stacked rather than grouped, because the three parts add up to one figure —
 * the bucket's total — and a reader comparing two months is comparing the
 * heights. Grouped bars would answer a different question, "how did penalties
 * move", which the table under the chart already answers exactly.
 */
export function RevenueChart({ bars }: { bars: readonly RevenueBar[] }) {
  return (
    <BarChart
      aspectRatio="3 / 1"
      data={[...bars]}
      margin={{ top: 16, right: 8, bottom: 32, left: 8 }}
      stacked
      xDataKey="bucket"
    >
      <Grid vertical={false} />
      <Bar dataKey="room" fill={REVENUE_FILLS.room} />
      <Bar dataKey="other" fill={REVENUE_FILLS.other} />
      <Bar dataKey="penalties" fill={REVENUE_FILLS.penalties} />
      <BarXAxis />
      <ChartTooltip
        rows={(point) => [
          {
            color: REVENUE_FILLS.room,
            label: REVENUE_SERIES_LABELS.room,
            value: dong(point.room),
          },
          {
            color: REVENUE_FILLS.other,
            label: REVENUE_SERIES_LABELS.other,
            value: dong(point.other),
          },
          {
            color: REVENUE_FILLS.penalties,
            label: REVENUE_SERIES_LABELS.penalties,
            value: dong(point.penalties),
          },
        ]}
        // The date pill is a label for a time series and these buckets are
        // named — "Q3 2026" is already under the bar it belongs to.
        showDatePill={false}
      />
    </BarChart>
  );
}

/**
 * Where the rooms stand, one stacked bar per type.
 *
 * Stacked, because the four conditions partition a type's rooms and the bar's
 * height is how many rooms of that type the property has. A manager reading down
 * the chart is reading the room mix and the state of it at once, which is what
 * the page is opened for.
 */
export function RoomStatusChart({ bars }: { bars: readonly RoomStatusBar[] }) {
  return (
    <BarChart
      aspectRatio="3 / 1"
      data={[...bars]}
      margin={{ top: 16, right: 8, bottom: 32, left: 8 }}
      stacked
      xDataKey="roomType"
    >
      <Grid vertical={false} />
      <Bar dataKey="CLEAN" fill={ROOM_STATUS_FILLS.CLEAN} />
      <Bar dataKey="INSPECTED" fill={ROOM_STATUS_FILLS.INSPECTED} />
      <Bar dataKey="DIRTY" fill={ROOM_STATUS_FILLS.DIRTY} />
      <Bar dataKey="OUT_OF_ORDER" fill={ROOM_STATUS_FILLS.OUT_OF_ORDER} />
      <BarXAxis />
      <ChartTooltip
        rows={(point) => [
          {
            color: ROOM_STATUS_FILLS.CLEAN,
            label: ROOM_STATUS_LABELS.CLEAN,
            value: rooms(point.CLEAN),
          },
          {
            color: ROOM_STATUS_FILLS.INSPECTED,
            label: ROOM_STATUS_LABELS.INSPECTED,
            value: rooms(point.INSPECTED),
          },
          {
            color: ROOM_STATUS_FILLS.DIRTY,
            label: ROOM_STATUS_LABELS.DIRTY,
            value: rooms(point.DIRTY),
          },
          {
            color: ROOM_STATUS_FILLS.OUT_OF_ORDER,
            label: ROOM_STATUS_LABELS.OUT_OF_ORDER,
            value: rooms(point.OUT_OF_ORDER),
          },
        ]}
        showDatePill={false}
      />
    </BarChart>
  );
}

/** The one series the performance chart draws, whichever figure is selected.
 *  The same step of the ramp for all three, because only one of them is on the
 *  chart at a time and a colour that changed with the selection would suggest a
 *  comparison the chart is not making. */
const PERFORMANCE_FILL = "var(--chart-2)";

/**
 * How the property performed, one figure at a time.
 *
 * **Three figures, one chart, and a selector — not three series.** Occupancy is
 * a fraction and ADR and RevPAR are đồng, so there is no axis the three can
 * share: stacked they would be adding a percentage to a hundred thousand đồng,
 * and overlaid the occupancy bar would be a pixel beside the rate. `reports.ts`
 * argues the split where the series is built; this is the control that follows
 * from it.
 *
 * A radio group rather than tabs or a `select`, because these are three
 * alternatives to one question and exactly one is true at a time, which is what
 * the role means — and it is three words wide, so closing two of them behind a
 * menu would cost a click to learn what the page even offers.
 *
 * The selection is held here rather than by the screen because nothing else on
 * the page depends on it: the table under the chart prints all three figures for
 * every type regardless, and all three ratios arrive on every row of the one
 * answer — so switching is a redraw and never a request.
 *
 * **No entrance animation.** `enterTransition` is not passed and the duration
 * inherited from `components/charts/animation.ts` is zero, which is `NFR-04`
 * kept at the source rather than at this call site. Switching the figure redraws
 * bars that are already there; nothing about that is an entrance.
 */
export function PerformanceChart({
  report,
}: {
  report: Pick<PerformanceReport, "buckets" | "bucket">;
}) {
  const [figure, setFigure] = useState<PerformanceFigure>(
    DEFAULT_PERFORMANCE_FIGURE,
  );
  const groupId = useId();
  const bars = useMemo(
    () => performanceSeries(report, figure),
    [report, figure],
  );

  return (
    <>
      <fieldset>
        <legend
          id={groupId}
          className="text-muted-foreground text-xs tracking-caps uppercase"
        >
          Figure
        </legend>
        <RadioGroup
          aria-labelledby={groupId}
          className="mt-1 grid-flow-col justify-start gap-6"
          value={figure}
          onValueChange={(chosen) => {
            setFigure(chosen as PerformanceFigure);
          }}
        >
          {PERFORMANCE_FIGURES.map((offered) => (
            <FigureOption key={offered} figure={offered} />
          ))}
        </RadioGroup>
      </fieldset>

      <BarChart
        aspectRatio="3 / 1"
        className="mt-rhythm-1"
        data={[...bars]}
        margin={{ top: 16, right: 8, bottom: 32, left: 8 }}
        xDataKey="bucket"
      >
        <Grid vertical={false} />
        <Bar dataKey="value" fill={PERFORMANCE_FILL} />
        <BarXAxis />
        <ChartTooltip
          rows={(point) => [
            {
              color: PERFORMANCE_FILL,
              label: PERFORMANCE_FIGURE_LABELS[figure],
              value: drawn(point.value, figure),
            },
          ]}
          showDatePill={false}
        />
      </BarChart>
    </>
  );
}

/** One figure, in the words the selector offers it. Associated by id rather
 *  than by nesting, for `check-in-sequence.tsx`'s reason: the control is a
 *  component and a label has no way to prove what it wraps. */
function FigureOption({ figure }: { figure: PerformanceFigure }) {
  const choiceId = useId();

  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={choiceId} value={figure} />
      <label htmlFor={choiceId} className="text-sm">
        {PERFORMANCE_FIGURE_LABELS[figure]}
      </label>
    </div>
  );
}

/**
 * A hovered performance bar's height, back in the units a person reads.
 *
 * The return trip out of the pixel scale, like {@link dong} beside it and with
 * the same narrowing: a point carries `Record<string, unknown>`, and a bucket
 * whose ratio had no denominator carries `null` — which is neither a number nor
 * an omission but the answer "there was nothing to divide by", printed as the
 * dash rather than as `0%` or `0 ₫`.
 *
 * Occupancy travels the series as percentage points, so it is divided back to
 * the fraction {@link formatOccupancy} takes rather than being formatted a
 * second way here.
 */
function drawn(value: unknown, figure: PerformanceFigure): string {
  if (typeof value !== "number") {
    return ABSENT_FIGURE;
  }

  return figure === "OCCUPANCY"
    ? formatOccupancy(value / 100)
    : formatVnd(BigInt(Math.round(value)));
}

/**
 * One series' value out of a hovered point, as đồng.
 *
 * The point arrives as `Record<string, unknown>` because the chart carries
 * whatever data it was given, so the narrowing happens here rather than being
 * asserted: a series that somehow held something other than a number reads as
 * nothing, which is honest, where a cast would print `NaN ₫` at an accountant.
 *
 * Back through `BigInt` before `formatVnd`, because that is the type the
 * console's one money formatter takes — the chart's `number` is a pixel scale
 * and this is the return trip out of it.
 */
function dong(value: unknown): string {
  return typeof value === "number" ? formatVnd(BigInt(Math.round(value))) : "—";
}

/** And one count, which is a whole number of rooms and stays one. */
function rooms(value: unknown): string {
  if (typeof value !== "number") {
    return "—";
  }

  return value === 1 ? "1 room" : `${value} rooms`;
}
