"use client";

import type { StaffRole } from "@mariva/shared";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * is what keeps the grid operable without a pointer while leaving the arrow keys
 * to the roving group — each row is one Tab stop with the arrows moving along its
 * nights, and Tab moves between the types.
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
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Tariff
        </p>
        <h1 className="font-display text-display-sm mt-2">Rates</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          What every room type costs each night, and the rules attached to those
          nights. Select a block of cells to price a weekend or a season in one
          edit.
        </p>
      </header>

      {role !== null && !mayReadRates(role) ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm">
          The property's tariff is not part of this role. Room condition is on
          the housekeeping board.
        </p>
      ) : null}

      {day.isError ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The property's day could not be read, so there is no night to open the
          grid on. Nothing here is a statement about what a night costs.
        </p>
      ) : null}

      {role !== null && mayReadRates(role) && !day.isError ? (
        businessDate === null ? (
          <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
            Reading the property's day.
          </p>
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
   * Up and down through the types, on the same night.
   *
   * The roving group owns left and right, which is a flat walk along a row and
   * is exactly what its geometry does. It has no notion of a second axis — one
   * step through the members in document order from a Tuesday in `DELUXE` is
   * Wednesday, not the same Tuesday one type down — so this claims the two
   * vertical keys before the group reads them. `verticalNeighbour` decides where
   * the press lands and is specified on its own; focusing the cell is what tells
   * the group its active member moved, through the member's own `onFocus`.
   */
  function moveBetweenTypes(event: React.KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

    if (step === 0 || table.current === null) {
      return;
    }

    const member = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-roving-item]",
    );
    const from = parseCellKey(member?.dataset.rovingValue);
    const to = from === null ? null : verticalNeighbour(walkable, from, step);

    if (to === null) {
      return;
    }

    const target = table.current.querySelector<HTMLElement>(
      `[data-roving-value="${cellKey(to)}"]`,
    );

    if (target === null) {
      return;
    }

    event.preventDefault();
    target.focus();
  }

  return (
    <>
      <WindowBar
        window={window}
        businessDate={businessDate}
        onMove={setWindow}
      />

      {grid.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading the tariff for these nights.
        </p>
      ) : null}

      {grid.status === "failed" ? (
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          No room type's prices could be read for these nights. Nothing below is
          a statement about the tariff.
        </p>
      ) : null}

      {grid.status !== "pending" ? (
        <>
          <Legend
            role={role}
            unreadPrices={unread.prices}
            unreadRules={unread.rules}
          />

          {/* The grid scrolls in its own box rather than the page: twenty-eight
              legible columns are wider than a laptop, and a page that scrolled
              sideways would take the edit panel and the plans with it. */}
          <div className="mt-rhythm-1 overflow-x-auto">
            <RovingFocusGroup
              // The table already says what it is, so the group claims nothing
              // over it — `roving-focus.tsx`'s own note about a table of rows,
              // and the arrangement `bookings-screen.tsx` uses.
              role="presentation"
              // Left and right along a row's nights. Up and down are claimed in
              // the screen above, because a flat list has no second axis.
              orientation="horizontal"
              onKeyDown={moveBetweenTypes}
            >
              <table
                ref={table}
                className="w-max border-separate border-spacing-0 text-sm"
              >
                <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
                  {/* Said rather than implied: the whole grid is one Tab stop,
                      and an operator arriving in it needs to know the arrows
                      walk it and that Shift is what widens a selection. */}
                  Arrow keys move between nights and room types. Enter selects a
                  night; Shift+Enter extends the selection to it.
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="text-muted-foreground w-36 pb-1 text-left text-xs font-normal tracking-caps uppercase"
                    >
                      Room type
                    </th>
                    {grid.columns.map((column) => (
                      <th
                        key={column.date}
                        scope="col"
                        className={cn(
                          "w-16 pb-1 text-center text-xs font-normal",
                          column.isWeekend
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {/* A non-breaking space where no month begins, so the
                            three-line heading keeps its height across every
                            column and the day numbers stay on one baseline. */}
                        <span className="block">
                          {column.monthLabel ?? "\u00a0"}
                        </span>
                        <span className="block">{column.weekdayLabel}</span>
                        <span className="block font-mono">
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
          </div>
        </>
      ) : null}

      {span === null ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm">
          Press a cell to select a night. Shift and a press — or Shift+Enter
          from the keyboard — extends the selection across nights and types, and
          one edit then covers all of it.
        </p>
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

/** Which nights are on screen, and how to move them. */
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
    <section className="mt-rhythm-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <p className="text-muted-foreground text-xs tracking-caps uppercase">
            Nights on screen
          </p>
          <p className="mt-1 text-sm">
            {formatLongDate(window.from)} to {formatLongDate(window.to)}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMove(shiftWindow(window, -1));
          }}
        >
          Earlier
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMove(shiftWindow(window, 1));
          }}
        >
          Later
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onMove(nightWindow(businessDate));
          }}
        >
          Back to today
        </Button>

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <Field
            label="Open on"
            value={typed}
            hint="1/2, 2026-02-01, +30d"
            onChange={setTyped}
          />
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
      </div>

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}
    </section>
  );
}

/** What the cells mean, and which of them are not there. */
function Legend({
  role,
  unreadPrices,
  unreadRules,
}: {
  role: StaffRole;
  unreadPrices: readonly string[];
  unreadRules: readonly string[];
}) {
  return (
    <div className="mt-rhythm-2">
      <p className="text-muted-foreground text-xs">
        Prices in thousands of đồng, gross. A dashed cell is a night the
        property has not published — unpriced, not sold out.
        {mayReadRestrictions(role)
          ? " Rules read 3+ for a minimum stay, ≤5 for a maximum, CTA closed to arrival, CTD closed to departure."
          : " Stay restrictions are not part of this role, so no cell here carries one."}
      </p>

      {unreadPrices.length > 0 ? (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          Prices could not be read for {unreadPrices.join(", ")}. Those rows say
          nothing about the tariff.
        </p>
      ) : null}

      {unreadRules.length > 0 ? (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          Stay restrictions could not be read for {unreadRules.join(", ")}.
          Those nights are not necessarily unrestricted.
        </p>
      ) : null}
    </div>
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
      <th
        scope="row"
        className="w-36 py-1 pr-2 text-left text-xs font-normal break-words"
      >
        {row.roomType}
        {row.rulesUnread ? (
          <span className="text-destructive block">rules unread</span>
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
          className="text-muted-foreground py-1 text-xs"
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
    <td className="p-0">
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
          "flex w-16 flex-col justify-center gap-0.5 border px-1 py-1 text-center",
          // Unpublished is a dashed edge and muted type. Never the destructive
          // treatment: this night is a gap in the tariff, not a night nobody may
          // buy, and the two must not be drawn the same way.
          cell.isPublished
            ? "border-border"
            : "border-border border-dashed text-muted-foreground",
          isWeekend && !selected ? "bg-muted/40" : null,
          selected ? "bg-accent/60" : "hover:bg-accent/30",
        )}
      >
        <span className="font-mono text-sm">{cell.priceLabel}</span>
        <span className="text-muted-foreground h-3 text-[0.625rem] leading-3">
          {cell.restrictionMarks.join(" ")}
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
    <section className="border-border mt-rhythm-2 border-l pl-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Selected nights</h2>
        <Button type="button" variant="ghost" onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <p className="mt-1 text-sm">{spanLabel(span)}</p>
      <p className="text-muted-foreground mt-1 text-xs">
        {span.cells} {span.cells === 1 ? "night" : "nights"} in all, written in{" "}
        {span.roomTypes.length}{" "}
        {span.roomTypes.length === 1 ? "request" : "requests"} — one per room
        type, whatever the span's width.
      </p>

      {!mayPrice && !mayRestrict ? (
        <p className="text-muted-foreground mt-rhythm-1 text-sm">
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
          className="mt-rhythm-1"
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
    </section>
  );
}

/** One price across the whole selection. */
function PriceForm({ span }: { span: SelectionSpan }) {
  const applyPrice = useApplyPrice();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
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
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Gross per night"
        value={typed}
        hint="Whole đồng — 1850000, or 1.850.000."
        onChange={(value) => {
          setTyped(value);
          setProblem(null);
        }}
      />
      <Button type="submit" disabled={applyPrice.isPending}>
        Apply to {span.cells} {span.cells === 1 ? "night" : "nights"}
      </Button>

      <div className="basis-full">
        {problem === null ? null : (
          <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
            {problem}
          </p>
        )}

        {applyPrice.data === undefined ? null : (
          <p className="text-muted-foreground text-sm">
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

  // Recomputed as the operator types, so the sentence under the form says which
  // of the route's two outcomes the press will cause before it is pressed.
  const edit = restrictionEdit(span, fields);

  function change(part: Partial<RestrictionFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    if ("problem" in edit) {
      setProblem(edit.problem);
      return;
    }

    setProblem(null);
    applyRules.mutate(edit.calls);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Minimum stay"
        value={fields.minimumStay}
        hint="Nights. 1 is no rule."
        onChange={(minimumStay) => {
          change({ minimumStay });
        }}
      />
      <Field
        label="Maximum stay"
        value={fields.maximumStay}
        hint="Leave empty for no ceiling."
        onChange={(maximumStay) => {
          change({ maximumStay });
        }}
      />

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

      <Button type="submit" disabled={applyRules.isPending}>
        Apply to {span.cells} {span.cells === 1 ? "night" : "nights"}
      </Button>

      <div className="basis-full">
        {"clears" in edit && edit.clears ? (
          <p className="text-muted-foreground text-xs">
            Nothing is constrained, so this removes any rule on those nights
            rather than storing one that says nothing.
          </p>
        ) : null}

        {problem === null ? null : (
          <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
            {problem}
          </p>
        )}

        {applyRules.data === undefined ? null : (
          <p className="text-muted-foreground text-sm">
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
    <section className="mt-rhythm-3">
      <h2 className="font-display text-2xl">Rate plans</h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        Three plans, each priced off the calendar above rather than beside it. A
        fourth is a migration and not a form — the codes are a database enum,
        and the order they are shown in is fixed.
      </p>

      {plans.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-1 text-sm" aria-busy>
          Reading the plans.
        </p>
      ) : null}

      {plans.status === "failed" ? (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          The plans could not be read.
        </p>
      ) : null}

      {plans.status === "ready" ? (
        <div className="mt-rhythm-1 grid gap-rhythm-2 lg:grid-cols-3">
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

  // Recomputed as the operator types, so what the PATCH will actually say is
  // readable before the press rather than inferable from the form's state.
  const patch = planPatch(plan, fields);

  function change(part: Partial<PlanFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    if ("problem" in patch) {
      setProblem(patch.problem);
      return;
    }

    setProblem(null);
    update.mutate(patch.input);
  }

  return (
    <div className="border-border border-l pl-4">
      <h3 className="text-sm">
        <span className="font-mono">{plan.code}</span> · {plan.name}
      </h3>
      <dl className="mt-1 text-xs">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Adjustment</dt>
          <dd>{percentLabel(plan.percentAdjustment)} of the calendar price</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Breakfast</dt>
          <dd>{breakfastLabel(plan)}</dd>
        </div>
      </dl>

      {!mayEdit ? (
        <p className="text-muted-foreground mt-rhythm-1 text-xs">
          Changing a plan is a manager's act.
        </p>
      ) : (
        <form
          className="mt-rhythm-1 flex flex-col gap-3"
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
            hint="Signed whole percent — -10, 0, 8."
            onChange={(percentAdjustment) => {
              change({ percentAdjustment });
            }}
          />
          <Field
            label="Breakfast a head"
            value={fields.breakfastPerPersonGross}
            hint="Empty leaves breakfast exactly as it is."
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
            <ul className="text-muted-foreground text-xs">
              {patch.changes.map((said) => (
                <li key={said}>{said}</li>
              ))}
            </ul>
          ) : null}

          <Button
            type="submit"
            disabled={update.isPending}
            className="self-start"
          >
            Save plan
          </Button>
        </form>
      )}

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}

      {update.data === undefined ? null : (
        <p className="text-muted-foreground mt-rhythm-1 text-xs">
          Saved. {update.data.name} now runs at{" "}
          {percentLabel(update.data.percentAdjustment)},{" "}
          {breakfastLabel(update.data)}.
        </p>
      )}
    </div>
  );
}

/** One typed field, labelled. */
function Field({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see — the arrangement
  // `features/rooms/rooms-screen.tsx` uses for the same field.
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        className="mt-1 w-40"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p className="text-muted-foreground mt-1 max-w-64 text-xs">{hint}</p>
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
      <label htmlFor={toggleId} className="text-xs">
        {label}
      </label>
    </div>
  );
}
