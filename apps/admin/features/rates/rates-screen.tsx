"use client";

import type { StaffRole } from "@mariva/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  KeyHint,
  PageHeader,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStaffSession } from "@/lib/auth";
import { formatLongDate } from "@/lib/business-date";
import { parseLiberalDate } from "@/lib/date-parser";
import { RovingFocusGroup, useRovingFocusItem } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  breakfastLabel,
  type CellRef,
  cellKey,
  extendSelection,
  isSelected,
  mayEditRates,
  mayEditRestrictions,
  mayReadRates,
  mayReadRestrictions,
  type NightColumn,
  type NightWindow,
  NO_RESTRICTION_FIELDS,
  nightWindow,
  type PlanFields,
  parseCellKey,
  percentLabel,
  planFields,
  planPatch,
  priceEdit,
  type RateCell,
  type RatePlan,
  type RateRow,
  type RateSelection,
  type RestrictionFields,
  restrictionEdit,
  type SelectionSpan,
  selectionSpan,
  shiftWindow,
  spanLabel,
  unreadTypes,
  verticalNeighbour,
} from "./rate-grid";
import {
  useApplyPrice,
  useApplyRules,
  useBusinessDate,
  useRatePlans,
  useRateWindow,
  useUpdateRatePlan,
} from "./rates-queries";

/* The property's tariff, as the grid the industry reads it in.
 *
 * `docs/screens.md` §"Staff surfaces" fixes the shape and the reason: "Rates is
 * a grid — days across, room types down — showing price and restrictions per
 * cell, with range selection so a weekend uplift or a Tết season is one edit
 * rather than fourteen. The grid is the industry's mental model for rate
 * management; per-plan forms would hide what a given week actually costs across
 * types." So the grid is the screen and the three plans sit under it as what
 * they are — arithmetic applied to the calendar, not a second place a week's
 * price is decided.
 *
 * ## The two things a cell says, and the one it must not
 *
 * A cell carries a price and the night's rules. A night with no price is drawn
 * *unpriced* — a dashed cell and a dash — and never as unavailable, because
 * `contract/pricing.ts` names that distinction as the whole reason the staff
 * calendar is a separate contract from the guest one: the funnel renders an
 * unpublished night as taken, and a manager looking at the same month needs to
 * know it is a gap they have not filled. `rate-grid.ts` owns the distinction and
 * `rate-grid.spec.ts` holds it there.
 *
 * The rules are the other half and are drawn as marks, in amber, at the label
 * size rather than below it: `CTA` on a night is the fact this screen exists to
 * surface, and a restriction nobody notices is a restriction the desk sells
 * through. The footer under the grid is what makes the abbreviations readable —
 * the legend sits beside the marks it names rather than in a paragraph above
 * them, which is also what keeps the paragraph short.
 *
 * ## Twenty-eight columns in a box that is not that wide
 *
 * The grid scrolls sideways in its own scrollport, so three things have to be
 * true that are not true of a table that fits. The room type stays put —
 * `sticky left-0`, or the operator scrolled to the fourth week is reading a row
 * of figures belonging to nothing. The focus ring is drawn *inside* the cell,
 * because a scrollport clips what hangs over its edge and the console's outline
 * is 3px at 2px offset. And a focused cell carries `scroll-ml-40`, so the
 * browser's own scroll-into-view leaves the sticky column's width clear instead
 * of parking the cell underneath it.
 *
 * ## Range selection
 *
 * A press anchors, and Shift and a press extends to a block — a run of nights
 * across a run of types. One press of *Apply* then costs one request per
 * selected type and one however wide the span is, which is the floor
 * `setRateCalendar` and `setStayRestrictions` permit: a fortnight of Tết across
 * the whole property is five requests where a per-night form would be seventy.
 *
 * Shift and a press reaches this the same way from a mouse and from a keyboard,
 * because Shift+Enter on a focused cell raises a click carrying `shiftKey`. That
 * is what keeps the grid operable without a pointer without taking Enter off the
 * button that is the cell.
 *
 * ## The arrows, and why the grid claims all four
 *
 * The whole grid is **one Tab stop**, and Tab leaves it. Inside it the arrows
 * are the cursor: left and right along one type's nights, up and down between
 * the types on the same night. Both axes are resolved here, against the window's
 * dates and the rows that actually drew cells, rather than by the roving group's
 * own geometry — that is a flat walk of the members in document order, so right
 * from the last night of `DELUXE` would land on the *first* night of `PREMIER`,
 * twenty-seven days back. The group keeps what it is good at: one remembered Tab
 * stop, tracked by cell rather than by index, and Home and End to the ends of
 * the grid.
 *
 * ## What is not here
 *
 * **No promotions.** `FR-PRC-03` is named in the same matrix row as the calendar
 * and has no table and no route behind it — `contract/pricing.ts` says a route
 * for a table that does not exist is a promise the client would be typed against
 * and nobody could keep. A tab here would be the same promise in markup.
 *
 * **No booking-time validation of a restriction.** `FR-PRC-02` rejects at query
 * time, in the availability read. This screen edits the rules and says nothing
 * about what a given booking attempt would be told.
 *
 * **No reordering of the plans.** `displayOrder` is read-only in the contract.
 *
 * `g t` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** `NFR-04` forbids entrance animation on operational
 * surfaces, and a grid that fades in is a tariff somebody is waiting to read.
 *
 * Role gating is presentation and not a wall: the API's capability guard is the
 * wall, and what the predicates decide is whether an operator is *offered* an
 * act that would answer 403.
 */

export function RatesScreen() {
  const session = useStaffSession();
  const day = useBusinessDate();

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks — `features/rooms/rooms-screen.tsx` makes the same argument.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;

  const businessDate = day.data?.businessDate ?? null;

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Rates"
        description="Edit nightly prices and restrictions across room types and dates."
      />

      {role !== null && !mayReadRates(role) ? (
        <EmptyState
          className="mt-6"
          title="Rates are not part of this role"
          description="What a night costs is a commercial record, and this console offers it to the roles that price it."
        />
      ) : null}

      {day.isError ? (
        // The console's error device is a rule on the leading edge as much as
        // the colour: --color-danger is a warm red-brown a shade off the umber
        // every other line on the screen is set in, and a sentence that differed
        // only in that would be read as ordinary copy.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The hotel day could not be read. Rates are unavailable.
        </p>
      ) : null}

      {role !== null && mayReadRates(role) && !day.isError ? (
        businessDate === null ? (
          <Skeleton className="mt-6 h-80" aria-busy />
        ) : (
          <RateBoard businessDate={businessDate} role={role} />
        )
      ) : null}
    </div>
  );
}

/**
 * The grid, the edit beside it, and the three plans under it.
 *
 * Split from the screen above so every hook below it runs with a first night
 * that exists: the window opens on the property's business date, which rolls at
 * 04:00, and a manager pricing at 01:30 must not be handed a grid starting
 * tomorrow.
 */
function RateBoard({
  businessDate,
  role,
}: {
  businessDate: string;
  role: StaffRole;
}) {
  const [window, setWindow] = useState<NightWindow>(() =>
    nightWindow(businessDate),
  );
  const [selection, setSelection] = useState<RateSelection | null>(null);

  const grid = useRateWindow(window, {
    prices: mayReadRates(role),
    rules: mayReadRestrictions(role),
  });

  const span = selection === null ? null : selectionSpan(selection);
  const unread = unreadTypes(grid.rows);

  /* The types the arrows actually stop on. A row whose prices could not be read
     draws no cells, so stepping onto it would put focus nowhere. */
  const walkable = grid.rows
    .filter((row) => row.status === "ready")
    .map((row) => row.roomType);

  // The table carries the ref rather than the group, for the reason
  // `features/bookings/bookings-screen.tsx` states: the group spreads unnamed
  // props onto its own container, and a `ref` passed through would replace the
  // one its arrow handling reads the list from.
  const table = useRef<HTMLTableElement>(null);

  /**
   * The cursor, on both axes.
   *
   * Claimed before the roving group reads the press, because the group steers a
   * flat list and this is a grid: one step through the members in document order
   * from a Tuesday in `DELUXE` is Wednesday going right and the first night of
   * `PREMIER` at the end of the row, where what the operator asked for is the
   * next night of the same type and then nothing. `verticalNeighbour` decides
   * the second axis and is specified on its own; {@link nightNeighbour} is its
   * twin along the window's dates.
   *
   * Every arrow that starts on a cell is claimed, including the ones that land
   * on an edge: leaving an edge press to the group is exactly the flat walk this
   * exists to prevent. Focusing the cell is what tells the group its active
   * member moved, through the member's own `onFocus`.
   */
  function moveInGrid(event: React.KeyboardEvent<HTMLDivElement>) {
    const across =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const down =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

    if ((across === 0 && down === 0) || table.current === null) {
      return;
    }

    const member = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-roving-item]",
    );
    const from = parseCellKey(member?.dataset.rovingValue);

    if (from === null) {
      return;
    }

    event.preventDefault();

    const to =
      across === 0
        ? verticalNeighbour(walkable, from, down)
        : nightNeighbour(window.dates, from, across);

    if (to === null) {
      return;
    }

    table.current
      .querySelector<HTMLElement>(`[data-roving-value="${cellKey(to)}"]`)
      ?.focus();
  }

  return (
    <>
      <WindowBar
        window={window}
        businessDate={businessDate}
        onMove={setWindow}
      />

      {grid.status === "pending" ? (
        // In the frame the grid itself arrives in, and a block per room type, so
        // the screen does not change shape underneath the operator when the
        // tariff lands.
        <DataTableFrame className="mt-6 space-y-2 p-4" aria-busy>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </DataTableFrame>
      ) : null}

      {grid.status === "failed" ? (
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          No room type's prices could be read for these nights. Nothing below is
          a statement about the tariff.
        </p>
      ) : null}

      {grid.status !== "pending" ? (
        <>
          <GridAlerts unreadPrices={unread.prices} unreadRules={unread.rules} />

          {/* What the grid is worked with, in the chips the shell and the
              palette use for a key. The table's caption says the same thing to a
              screen reader; this is the half a manager can see. */}
          <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <KeyHint>↑</KeyHint>
              <KeyHint>↓</KeyHint>
              <KeyHint>←</KeyHint>
              <KeyHint>→</KeyHint>
              <span className="ml-0.5">move through the nights</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <KeyHint>Enter</KeyHint>
              selects a night
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyHint>Shift</KeyHint>
              <KeyHint>Enter</KeyHint>
              <span className="ml-0.5">extends the selection</span>
            </span>
          </p>

          {/* The grid scrolls in its own box rather than the page: twenty-eight
              legible columns are wider than a laptop, and a page that scrolled
              sideways would take the edit panel and the plans with it. The
              legend sits outside that box so it stays put while the nights move
              under it. */}
          <DataTableFrame className="mt-3">
            <RovingFocusGroup
              // The table already says what it is, so the group claims nothing
              // over it — `roving-focus.tsx`'s own note about a table of rows,
              // and the arrangement `bookings-screen.tsx` uses.
              role="presentation"
              // Both axes are resolved in `moveInGrid` above; what the group is
              // left with is the remembered Tab stop, and Home and End to the
              // ends of the grid.
              orientation="horizontal"
              onKeyDown={moveInGrid}
              // The scrollport, and therefore what `sticky left-0` on the room
              // type sticks to. Vertical padding only: a horizontal one would
              // leave a gutter for the cells to scroll through beside the
              // sticky column, so the nights carry their own trailing space.
              className="overflow-x-auto py-4"
            >
              <table
                ref={table}
                className="w-max min-w-full border-separate border-spacing-0 text-sm"
              >
                <caption className="sr-only">
                  Nightly prices and stay restrictions, room types down and
                  nights across. The grid is one Tab stop: arrow keys move
                  between cells, Enter selects one, Shift and Enter extends the
                  selection.
                </caption>
                <thead>
                  <tr>
                    {/* Two header rows, and this one spans both: the months are
                        a heading over the dates they cover, not a word floating
                        above one column of them. */}
                    <th
                      scope="col"
                      rowSpan={2}
                      className="sticky left-0 z-10 w-40 border-border border-r bg-card px-4 pb-1 text-left align-bottom text-xs font-normal tracking-caps text-muted-foreground uppercase"
                    >
                      Room type
                    </th>
                    {monthSpans(grid.columns).map((month) => (
                      <th
                        key={month.from}
                        scope="colgroup"
                        colSpan={month.nights}
                        className="border-border border-b px-1 pb-1 text-left text-xs font-normal tracking-caps text-muted-foreground uppercase last:pr-4"
                      >
                        {/* The name travels with its run. A heading left at the
                            start of eighteen columns is a heading nobody scrolled
                            into the middle of September can see; sticky inside
                            its own cell, it stops at that month's last night and
                            the next one takes over. `left-40` is the room type's
                            width, so the two never overlap. */}
                        <span className="sticky left-40 inline-block">
                          {month.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {grid.columns.map((column) => (
                      <th
                        key={column.date}
                        scope="col"
                        className={cn(
                          "w-18 px-1 pt-1.5 pb-1 text-center font-normal last:pr-4",
                          column.isWeekend
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="block text-xs tracking-caps uppercase">
                          {column.weekdayLabel}
                        </span>
                        <span className="block text-sm tabular-nums">
                          {column.dayLabel}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <GridRow
                      key={row.roomType}
                      row={row}
                      columns={grid.columns}
                      span={span}
                      onPress={(cell, extending) => {
                        setSelection((current) =>
                          extendSelection(current, cell, extending),
                        );
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </RovingFocusGroup>

            <GridLegend role={role} nights={grid.columns.length} />
          </DataTableFrame>
        </>
      ) : null}

      {span === null ? (
        <EmptyState
          className="mt-6"
          title="No nights selected"
          description="Press Enter on a cell to select that night. Shift and Enter extends the block across nights and room types."
        />
      ) : (
        <SelectionPanel
          span={span}
          role={role}
          onClear={() => {
            setSelection(null);
          }}
        />
      )}

      <RatePlansSection role={role} />
    </>
  );
}

/**
 * The same night one column left or right — the twin of `verticalNeighbour`,
 * along the window's own dates.
 *
 * Null at either edge rather than wrapping, for the reason `rate-grid.ts` gives
 * about the other axis: wrapping from the last night of the window to the first
 * is disorienting on an axis the operator reads as a calendar. The window bar
 * above the grid is how the next four weeks are reached.
 */
function nightNeighbour(
  dates: readonly string[],
  from: CellRef,
  step: number,
): CellRef | null {
  const index = dates.indexOf(from.date);
  const target = index + step;

  if (index === -1 || target < 0 || target >= dates.length) {
    return null;
  }

  return { roomType: from.roomType, date: dates[target] };
}

/** A run of columns in one month, as the spanning heading over them. */
interface MonthSpan {
  readonly label: string;
  /** The first night of the run — its key, and never drawn. */
  readonly from: string;
  readonly nights: number;
}

/**
 * The month headings, as runs rather than as a label per column.
 *
 * `nightColumns` names a month on the first column and again wherever one
 * begins, which is the fact this needs: a new name opens a run and every
 * unnamed column after it belongs to the one before. Grouping is presentation —
 * the two-row heading is a drawing decision — so it lives with the drawing.
 */
function monthSpans(columns: readonly NightColumn[]): MonthSpan[] {
  const spans: MonthSpan[] = [];

  for (const column of columns) {
    const open = spans[spans.length - 1];

    if (column.monthLabel !== null || open === undefined) {
      spans.push({
        label: column.monthLabel ?? "",
        from: column.date,
        nights: 1,
      });
      continue;
    }

    spans[spans.length - 1] = { ...open, nights: open.nights + 1 };
  }

  return spans;
}

/**
 * Which nights are on screen, and every control that moves them.
 *
 * One card and one row of controls, because all five steer the same viewport
 * and a bare text link among real buttons says the opposite. Not
 * `components/console/filter-bar.tsx`: nothing here filters a list, and that
 * component is a `<form>` whose own submit would have to become this jump —
 * with the four viewport presses sitting inside it as if they were its actions.
 * Not `toolbar.tsx` either: `role="toolbar"` promises arrow-key movement
 * between the controls, and the arrows on this screen belong to the grid.
 */
function WindowBar({
  window,
  businessDate,
  onMove,
}: {
  window: NightWindow;
  businessDate: string;
  onMove(next: NightWindow): void;
}) {
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();
  const problemId = `${fieldId}-problem`;

  function jump() {
    // Typed rather than picked, like every other date on the console: a manager
    // types "1/2" or "+30d" and never opens a calendar widget. Counted from the
    // property's business date, which is what "today" means here.
    const from = parseLiberalDate(typed, businessDate);

    if (from === null) {
      setProblem("Type a date — 1/2, 2026-02-01, today, +30d.");
      return;
    }

    setProblem(null);
    setTyped("");
    onMove(nightWindow(from));
  }

  return (
    <Card className="mt-6 p-4">
      <p className="text-xs tracking-caps text-muted-foreground uppercase">
        Nights on screen
      </p>
      <p className="mt-1 text-sm">
        {formatLongDate(window.from)} to {formatLongDate(window.to)}
      </p>

      {/* One shape for every control that steers the window, on one baseline.
          The three steps sit together and the typed jump is the same row's far
          end, so the group reads as one instrument rather than as two buttons,
          a link and a form that happen to be adjacent. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMove(shiftWindow(window, -1));
          }}
        >
          <ChevronLeft aria-hidden="true" />
          Earlier
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMove(nightWindow(businessDate));
          }}
        >
          Back to today
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMove(shiftWindow(window, 1));
          }}
        >
          Later
          <ChevronRight aria-hidden="true" />
        </Button>

        <form
          className="flex items-center gap-2 sm:ml-auto"
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          {/* Beside the box rather than above it. A caption stacked over an
              input puts the input's baseline above every button in the row,
              which is what made this bar read as four unrelated things. */}
          <label
            htmlFor={fieldId}
            className="text-sm text-muted-foreground whitespace-nowrap"
          >
            Open on
          </label>
          <Input
            id={fieldId}
            className="w-32"
            placeholder="15/3"
            value={typed}
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? undefined : problemId}
            onChange={(event) => {
              setTyped(event.target.value);
              setProblem(null);
            }}
          />
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
      </div>

      {problem === null ? null : (
        // Announced, not only drawn. A refusal a manager who had looked away
        // never hears is a press that did nothing and said nothing.
        <p
          id={problemId}
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}
    </Card>
  );
}

/** The types whose prices or whose rules are not on screen. */
function GridAlerts({
  unreadPrices,
  unreadRules,
}: {
  unreadPrices: readonly string[];
  unreadRules: readonly string[];
}) {
  if (unreadPrices.length === 0 && unreadRules.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      {unreadPrices.length > 0 ? (
        <p
          className="border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Prices could not be read for {unreadPrices.join(", ")}. Those rows say
          nothing about the tariff.
        </p>
      ) : null}

      {unreadRules.length > 0 ? (
        <p
          className="border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Stay restrictions could not be read for {unreadRules.join(", ")}.
          Those nights are not necessarily unrestricted.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the cells mean, under the cells that mean it.
 *
 * A legend rather than the paragraph this used to be: every abbreviation is
 * drawn in the type it is drawn in inside the grid, so the reader matches a mark
 * to a mark instead of holding four spellings in their head. The count on the
 * trailing edge is the other half of the scrollbar's job — a grid that ends at
 * the frame's edge has said "there is more to the right" only to somebody who
 * already knew.
 */
function GridLegend({ role, nights }: { role: StaffRole; nights: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-border border-t px-4 py-3 text-sm text-muted-foreground">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <li>Thousands of đồng, gross</li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-4 w-6 rounded-xs border border-border border-dashed"
          />
          unpriced, not sold out
        </li>
        {mayReadRestrictions(role) ? (
          <>
            <li className="inline-flex items-center gap-1.5">
              <Mark>3+</Mark>minimum stay
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Mark>≤5</Mark>maximum stay
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Mark>CTA</Mark>closed to arrival
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Mark>CTD</Mark>closed to departure
            </li>
          </>
        ) : (
          <li>
            Stay restrictions are not part of this role, so no cell here carries
            one
          </li>
        )}
      </ul>

      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {nights} nights on screen
        <KeyHint>←</KeyHint>
        <KeyHint>→</KeyHint>
      </span>
    </div>
  );
}

/** One restriction, in the type it is drawn in inside a cell. Amber is the
 *  console's marker colour — 6.2:1 on a card and 5.1:1 on the selection's own
 *  tint, where the muted grey this used to be disappeared under both. */
function Mark({ children }: { children: string }) {
  return (
    <span className="text-xs font-semibold tracking-caps text-accent-strong">
      {children}
    </span>
  );
}

/** One room type's nights. */
function GridRow({
  row,
  columns,
  span,
  onPress,
}: {
  row: RateRow;
  columns: readonly { readonly date: string; readonly isWeekend: boolean }[];
  span: SelectionSpan | null;
  onPress(cell: CellRef, extending: boolean): void;
}) {
  return (
    <tr>
      {/* Stays where it is while the nights scroll past it. Opaque, because the
          cells pass underneath rather than beside it. */}
      <th
        scope="row"
        className="sticky left-0 z-10 w-40 border-border border-r bg-card px-4 py-1 text-left text-sm font-normal break-words"
      >
        {row.roomType}
        {row.rulesUnread ? (
          <span className="block text-xs text-danger">rules unread</span>
        ) : null}
      </th>

      {row.status === "ready" ? (
        row.cells.map((cell, index) => (
          <GridCell
            key={cell.date}
            cell={cell}
            isWeekend={columns[index]?.isWeekend === true}
            isSelected={isSelected(span, cell.roomType, cell.date)}
            onPress={onPress}
          />
        ))
      ) : (
        <td
          colSpan={columns.length}
          className={cn(
            "px-4 py-2 text-sm last:pr-4",
            row.status === "failed" ? "text-danger" : "text-muted-foreground",
          )}
        >
          {row.status === "failed"
            ? "These prices could not be read."
            : "Reading."}
        </td>
      )}
    </tr>
  );
}

/**
 * One night of one type.
 *
 * The button is the roving member rather than the cell around it: the group
 * finds its members with `closest("[data-roving-item]")`, so putting the props
 * on the thing that actually takes focus is what keeps the arrows and the
 * remembered Tab stop agreeing about where the operator is.
 *
 * `aria-pressed` and not `aria-selected`, because a `<td>` outside a grid role
 * has nothing to be selected in — what is true here is that this control is held
 * down as part of the block an edit will be applied to.
 */
function GridCell({
  cell,
  isWeekend,
  isSelected: selected,
  onPress,
}: {
  cell: RateCell;
  isWeekend: boolean;
  isSelected: boolean;
  onPress(cell: CellRef, extending: boolean): void;
}) {
  const roving = useRovingFocusItem(cellKey(cell));

  return (
    // `h-px` is what lets the button fill the cell. A row is as tall as its
    // tallest night — one carrying four rules wraps its marks onto a second
    // line — and a percentage height inside a table cell resolves against the
    // used height only when the cell states one. Without it the other
    // twenty-seven cells of that row stop short of the row's own bottom edge.
    <td className="h-px p-0 align-top last:pr-4">
      <button
        {...roving}
        type="button"
        aria-pressed={selected}
        aria-label={cell.cellLabel}
        title={cell.cellLabel}
        onClick={(event) => {
          // The shift key, from a mouse and from Shift+Enter alike — which is
          // what lets the grid be selected without a pointer and without taking
          // the arrow keys off the roving group.
          onPress({ roomType: cell.roomType, date: cell.date }, event.shiftKey);
        }}
        className={cn(
          // `scroll-ml-40` is the sticky room type's width: without it the
          // browser scrolls a focused cell just inside the scrollport, which is
          // underneath that column. The offset is negative for the same
          // scrollport's sake — a ring drawn outside the cell loses its left and
          // right edges to the clip.
          "flex h-full w-18 scroll-ml-40 flex-col items-center justify-center gap-0.5 border px-1 py-1.5 text-center transition-colors duration-150 ease-ui focus-visible:[outline-offset:-3px]",
          // Unpublished is a dashed edge and muted type. Never the destructive
          // treatment: this night is a gap in the tariff, not a night nobody may
          // buy, and the two must not be drawn the same way.
          cell.isPublished
            ? "border-border"
            : "border-border border-dashed text-muted-foreground",
          isWeekend && !selected ? "bg-muted/40" : null,
          // Three states and not one value for all of them, the arrangement the
          // desk queues use. Hover is the lightest, because a pointer passing
          // over a night has decided nothing; a selected night is the full tint
          // and an amber edge, because it is a night this screen is about to
          // write to.
          selected
            ? "border-accent-line bg-accent-soft"
            : "hover:bg-accent-soft/50",
        )}
      >
        <span className="text-sm tabular-nums">{cell.priceLabel}</span>
        {/* The line is reserved whether or not the night carries a rule, so the
            prices across a row stay on one baseline. */}
        <span className="flex min-h-4 flex-wrap justify-center gap-x-1 leading-4">
          {cell.restrictionMarks.map((mark) => (
            <Mark key={mark}>{mark}</Mark>
          ))}
        </span>
      </button>
    </td>
  );
}

/** The block that is selected, and the two edits that can be applied to it. */
function SelectionPanel({
  span,
  role,
  onClear,
}: {
  span: SelectionSpan;
  role: StaffRole;
  onClear(): void;
}) {
  const mayPrice = mayEditRates(role);
  const mayRestrict = mayEditRestrictions(role);

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold leading-8">Selected nights</h2>
        <Button type="button" variant="ghost" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <p className="mt-1 text-sm">{spanLabel(span)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {span.cells} {span.cells === 1 ? "night" : "nights"} in all, written in{" "}
        {span.roomTypes.length}{" "}
        {span.roomTypes.length === 1 ? "request" : "requests"} — one per room
        type, whatever the span's width.
      </p>

      {!mayPrice && !mayRestrict ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Pricing a night and closing it to arrival are both a manager's acts.
          This selection is here to be read.
        </p>
      ) : (
        /* Keyed by the span, so moving the selection resets the two forms with
           it. A price half-typed for one weekend must not still be sitting in
           the field when the operator selects another. */
        <Tabs
          key={`${span.from}:${span.to}:${span.roomTypes.join(",")}`}
          defaultValue={mayPrice ? "price" : "rules"}
          className="mt-4"
        >
          <TabsList>
            {mayPrice ? <TabsTrigger value="price">Price</TabsTrigger> : null}
            {mayRestrict ? (
              <TabsTrigger value="rules">Restrictions</TabsTrigger>
            ) : null}
          </TabsList>

          {mayPrice ? (
            <TabsContent value="price">
              <PriceForm span={span} />
            </TabsContent>
          ) : null}

          {mayRestrict ? (
            <TabsContent value="rules">
              <RulesForm span={span} />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </Card>
  );
}

/** One price across the whole selection. */
function PriceForm({ span }: { span: SelectionSpan }) {
  const applyPrice = useApplyPrice();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const busy = applyPrice.isPending;

  function submit() {
    // The press that arrives while the last one is still in flight. Dropped
    // here rather than by `disabled` on the button: a disabled control is
    // unfocusable, and the browser answers that by moving focus to <body> — so
    // a manager who pressed Enter on this button would be left nowhere, and a
    // refusal that leaves the form exactly as it was gives them nothing to
    // press their way back with.
    if (applyPrice.isPending) {
      return;
    }

    const edit = priceEdit(span, typed);

    if ("problem" in edit) {
      setProblem(edit.problem);
      return;
    }

    setProblem(null);
    applyPrice.mutate(edit.calls, {
      onSuccess: () => {
        // Cleared on success only. A refused price stays in the field, which is
        // where the correction is made.
        setTyped("");
      },
    });
  }

  return (
    <form
      className="mt-4 flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        className="w-52"
        label="Gross per night"
        value={typed}
        placeholder="1850000"
        hint="Whole đồng. There is no minor unit to type."
        onChange={(value) => {
          setTyped(value);
          setProblem(null);
        }}
      />
      {/* On the input's own line rather than under the caption above it, which
          is what `mt-6` buys: the label, the box and the press read as one
          control instead of two rows that happen to touch. */}
      <Button
        type="submit"
        className="mt-6 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        aria-disabled={busy}
        aria-busy={busy}
      >
        Apply to {span.cells} {span.cells === 1 ? "night" : "nights"}
      </Button>

      <div className="basis-full">
        {problem === null ? null : (
          <p
            className="border-danger border-l-2 pl-3 text-sm text-danger"
            role="alert"
          >
            {problem}
          </p>
        )}

        {applyPrice.data === undefined ? null : (
          <p className="text-sm text-muted-foreground" role="status">
            Priced {applyPrice.data.nights} nights across{" "}
            {applyPrice.data.roomTypes.join(", ")}.
          </p>
        )}
      </div>
    </form>
  );
}

/** One stay rule across the whole selection — `FR-PRC-02`. */
function RulesForm({ span }: { span: SelectionSpan }) {
  const applyRules = useApplyRules();
  const [fields, setFields] = useState<RestrictionFields>(
    NO_RESTRICTION_FIELDS,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const busy = applyRules.isPending;

  // Recomputed as the operator types, so the sentence under the form says which
  // of the route's two outcomes the press will cause before it is pressed.
  const edit = restrictionEdit(span, fields);

  function change(part: Partial<RestrictionFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    // As in the price form above, and for the same reason: a disabled button
    // drops focus to <body>, and this form's refusals leave the state it would
    // have to be put back by unchanged.
    if (applyRules.isPending) {
      return;
    }

    if ("problem" in edit) {
      setProblem(edit.problem);
      return;
    }

    setProblem(null);
    applyRules.mutate(edit.calls);
  }

  return (
    <form
      className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        className="w-40"
        label="Minimum stay"
        value={fields.minimumStay}
        placeholder="2"
        hint="Nights. 1 is no rule."
        onChange={(minimumStay) => {
          change({ minimumStay });
        }}
      />
      <Field
        className="w-40"
        label="Maximum stay"
        value={fields.maximumStay}
        placeholder="5"
        hint="Empty for no ceiling."
        onChange={(maximumStay) => {
          change({ maximumStay });
        }}
      />

      {/* The two switches and the press share the boxes' own line rather than
          floating above it — `min-h-11` is the height of the fields beside
          them. */}
      <div className="mt-6 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-3">
        <Toggle
          label="Closed to arrival"
          checked={fields.closedToArrival}
          onChange={(closedToArrival) => {
            change({ closedToArrival });
          }}
        />
        <Toggle
          label="Closed to departure"
          checked={fields.closedToDeparture}
          onChange={(closedToDeparture) => {
            change({ closedToDeparture });
          }}
        />

        <Button
          type="submit"
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          aria-disabled={busy}
          aria-busy={busy}
        >
          Apply to {span.cells} {span.cells === 1 ? "night" : "nights"}
        </Button>
      </div>

      <div className="basis-full">
        {"clears" in edit && edit.clears ? (
          <p className="text-sm text-muted-foreground">
            Nothing is constrained, so this removes any rule on those nights
            rather than storing one that says nothing.
          </p>
        ) : null}

        {problem === null ? null : (
          <p
            className="border-danger border-l-2 pl-3 text-sm text-danger"
            role="alert"
          >
            {problem}
          </p>
        )}

        {applyRules.data === undefined ? null : (
          <p className="text-sm text-muted-foreground" role="status">
            {applyRules.data.cleared ? "Cleared" : "Restricted"}{" "}
            {applyRules.data.nights} nights across{" "}
            {applyRules.data.roomTypes.join(", ")}.
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * The three plans priced off the calendar — `FR-PRC-01`.
 *
 * Under the grid rather than instead of it, which is `screens.md`'s point: a
 * plan is a percentage and a breakfast applied to what the calendar already
 * says, so a per-plan form as this screen's whole surface would hide what a week
 * actually costs across types.
 */
function RatePlansSection({ role }: { role: StaffRole }) {
  const plans = useRatePlans(mayReadRates(role));

  return (
    <section className="mt-10">
      <h2 className="text-2xl font-semibold leading-8">Rate plans</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Three plans, each priced off the calendar above rather than beside it. A
        fourth is a migration and not a form — the codes are a database enum,
        and the order they are shown in is fixed.
      </p>

      {plans.status === "pending" ? (
        // In the three cards the plans themselves arrive in.
        <div className="mt-4 grid gap-4 lg:grid-cols-3" aria-busy>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {plans.status === "failed" ? (
        <p
          className="mt-4 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The plans could not be read.
        </p>
      ) : null}

      {plans.status === "ready" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {plans.plans.map((plan) => (
            /* Keyed by the plan as it currently stands, so a PATCH that lands
               reseeds this form from the row the API wrote — and the breakfast
               box goes back to empty, which is what "leave it alone" is spelled
               as. */
            <PlanCard
              key={`${plan.code}:${plan.name}:${plan.percentAdjustment}:${plan.breakfastPerPersonGross}`}
              plan={plan}
              mayEdit={mayEditRates(role)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One plan, and the PATCH that changes it.
 *
 * The care here is entirely the difference between the two ways
 * `breakfastPerPersonGross` can be absent, which `contract/pricing.ts` names as
 * the difference between editing `BB`'s name and turning `BB` into a room-only
 * plan. An empty box leaves breakfast exactly as it was; the *Room only* switch
 * is the one control that sends the explicit null. The box is therefore not
 * seeded with the current figure — the figure is printed beside it — because a
 * box holding a value the operator then cleared would be asking this form to
 * guess between the two. {@link planPatch} refuses both at once rather than
 * choosing.
 */
function PlanCard({ plan, mayEdit }: { plan: RatePlan; mayEdit: boolean }) {
  const update = useUpdateRatePlan();
  const [fields, setFields] = useState<PlanFields>(() => planFields(plan));
  const [problem, setProblem] = useState<string | null>(null);
  const busy = update.isPending;

  // Recomputed as the operator types, so what the PATCH will actually say is
  // readable before the press rather than inferable from the form's state.
  const patch = planPatch(plan, fields);

  function change(part: Partial<PlanFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    // As in the two forms above: `disabled` here would drop focus to <body> on
    // the press, and this form's own refusal path changes nothing that would
    // put it back.
    if (update.isPending) {
      return;
    }

    if ("problem" in patch) {
      setProblem(patch.problem);
      return;
    }

    setProblem(null);
    update.mutate(patch.input);
  }

  return (
    <Card className="p-5">
      <h3 className="font-semibold">
        <span className="tabular-nums">{plan.code}</span> · {plan.name}
      </h3>
      <dl className="mt-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Adjustment</dt>
          <dd>{percentLabel(plan.percentAdjustment)} of the calendar price</dd>
        </div>
        <div className="mt-0.5 flex gap-2">
          <dt className="text-muted-foreground">Breakfast</dt>
          <dd>{breakfastLabel(plan)}</dd>
        </div>
      </dl>

      {!mayEdit ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Changing a plan is a manager's act.
        </p>
      ) : (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label="Name"
            value={fields.name}
            onChange={(name) => {
              change({ name });
            }}
          />
          <Field
            label="Adjustment"
            value={fields.percentAdjustment}
            placeholder="-10"
            hint="Signed whole percent."
            onChange={(percentAdjustment) => {
              change({ percentAdjustment });
            }}
          />
          <Field
            label="Breakfast a head"
            value={fields.breakfastPerPersonGross}
            placeholder="120000"
            hint="Empty keeps the current breakfast amount."
            onChange={(breakfastPerPersonGross) => {
              change({ breakfastPerPersonGross });
            }}
          />
          <Toggle
            label="Room only — remove breakfast"
            checked={fields.removesBreakfast}
            onChange={(removesBreakfast) => {
              change({ removesBreakfast });
            }}
          />

          {"changes" in patch ? (
            <ul className="text-sm text-muted-foreground">
              {patch.changes.map((said) => (
                <li key={said}>{said}</li>
              ))}
            </ul>
          ) : null}

          <Button
            type="submit"
            className="mt-1 self-start aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={busy}
            aria-busy={busy}
          >
            Save plan
          </Button>
        </form>
      )}

      {problem === null ? null : (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}

      {update.data === undefined ? null : (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Saved. {update.data.name} now runs at{" "}
          {percentLabel(update.data.percentAdjustment)},{" "}
          {breakfastLabel(update.data)}.
        </p>
      )}
    </Card>
  );
}

/** One typed field, labelled. */
function Field({
  className,
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  className?: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see — the arrangement
  // `features/rooms/rooms-screen.tsx` uses for the same field.
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={fieldId}
        // `leading-5` is load-bearing rather than cosmetic: it fixes the caption
        // at twenty pixels, so a press placed at `mt-6` beside the field lands
        // exactly on the box's top edge instead of three pixels under it.
        className="block text-xs leading-5 tracking-caps text-muted-foreground uppercase"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        // Named as well as drawn. A hint that only exists visually is guidance
        // the operator this console is built for never receives.
        aria-describedby={hint === undefined ? undefined : hintId}
        className="mt-1 w-full"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** One boolean, labelled. */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  const toggleId = useId();

  return (
    <div className="flex items-center gap-2">
      <Switch id={toggleId} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={toggleId} className="text-sm whitespace-nowrap">
        {label}
      </label>
    </div>
  );
}
