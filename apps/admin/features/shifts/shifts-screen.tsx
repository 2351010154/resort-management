"use client";

import {
  formatVnd,
  SHIFT_HISTORY_EXPORT_PATH,
  SHIFT_HISTORY_EXPORT_STEM,
  SHIFT_PAGE_SIZE,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useId, useMemo, useRef, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  KeyHint,
  PageHeader,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommands } from "@/features/command-palette";
/* The property's day, from the hook the rest of the console already asks it
 * with: one route through the same `orpc` utils is one cache entry, so the day a
 * typed filter is resolved against here is the day the desk is working, without
 * a second request and without a second opinion about what its failure says. */
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { pageWindow } from "@/features/folios/folio-ledger";
/* The console's one rendering of an instant in the property's zone, and of a
 * trading day, taken from the modules that already own them rather than a third
 * `Intl.DateTimeFormat` beside them. A shift opens and closes at instants; the
 * day it is answerable for is a calendar date the property agrees on. */
import { formatInstant } from "@/features/guests/guest-record";
import { useStaffSession } from "@/lib/auth";
import { formatShortDate } from "@/lib/business-date";
/* The one place the console takes a list away as a spreadsheet. A receptionist
 * is offered it here and the file they get holds their own drawers — the API
 * narrows it off the same grant it narrows the list with, so this screen makes
 * no second decision about scope. */
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";
import { useHotkeys } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import { PendingItems } from "./drawer-forms";
import {
  DEFAULT_HISTORY_FIELDS,
  type HistoryFields,
  historyQuestion,
  mayPickOperator,
  mayReadDrawers,
  type Operator,
  operatorChoices,
  type Shift,
  type ShiftHistoryQuery,
  VARIANCE_LABELS,
  varianceReading,
} from "./shift-day";
import { useShiftHistory } from "./shift-queries";

/* The desk's days, read back.
 *
 * `docs/screens.md` §"Staff surfaces" states what this screen is and, just as
 * importantly, what it is not: "Shifts frame the receptionist's day but never
 * own a screen visit. The current shift lives in the shell's top bar, and
 * opening, counting, closing and handing over are command-palette actions
 * available from any screen; the Shifts family screen is the history — past
 * shifts, variances, handover notes — read by managers and the accountant."
 *
 * So there is no control here that opens, counts or closes anything. That is not
 * an omission to fill in later: a receptionist works a drawer from wherever they
 * are standing, and a screen that also offered the acts would be teaching the
 * desk to leave the queue in order to do them.
 *
 * ## Who this is for, and the one filter that is not for everybody
 *
 * The matrix grants the drawer row to the desk, the accountant and management,
 * and this screen is offered to all four. The operator filter is offered to
 * three of them: `shift.controller.ts` overwrites a receptionist's `operatorId`
 * with their own rather than refusing it — deliberately, so an old link still
 * answers with the one history they are entitled to — which means a picker in
 * their hands would be a control whose every setting produced the same rows.
 *
 * The choices in that picker are the operators the answer contains, because no
 * route in this console turns a staff id into a list of people. `operatorName`
 * travels on the shift precisely so a history is readable without one, and
 * inventing a staff directory to fill a filter would be a screen asking for a
 * route that does not exist.
 *
 * ## The variance is read, never computed
 *
 * The figure on every closed row is the API's, derived under the lock it takes
 * before summing the shift's cash. What this screen adds is the word in front of
 * it — over, short or square — because both directions are wrong and a manager
 * asks which way first.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the first day, as it does on every other screen with
 * filters. The table is read rather than worked, so it is not a roving group:
 * the only things that answer a press are the filters and the pager.
 *
 * **No animation.** Operational surfaces carry no entrance motion — the filters
 * paint their own pending line and the pager disables in place.
 */

/** What the screen is currently asking the history for. */
interface Asked {
  readonly query: ShiftHistoryQuery;
  /** The filters that query was built from — what the pager re-builds against,
   *  so paging asks the question that was submitted rather than whatever has
   *  been typed into the form since. */
  readonly fields: HistoryFields;
  readonly offset: number;
}

/* One empty page, shared by every render that has none. A fresh `[]` in a
 * ternary is a new array every render, and the operator choices below are
 * memoized on the shifts they were built from. */
const NO_SHIFTS: readonly Shift[] = [];

/** Where the history's export answers and what its file is called, from the
 *  contract rather than typed out here. */
const HISTORY_EXPORT: ExcelExportSubject = {
  path: SHIFT_HISTORY_EXPORT_PATH,
  stem: SHIFT_HISTORY_EXPORT_STEM,
  failure: "The shift history could not be exported.",
};

export function ShiftsScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<HistoryFields>(DEFAULT_HISTORY_FIELDS);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReadDrawers(role);
  const picksOperator = role !== null && mayPickOperator(role);
  /* Both rows, and neither alone — the drawer's, which this screen is already
   * behind, and the matrix's *Excel export* row. A housekeeper holds neither
   * and reaches nothing; a receptionist holds both, conditionally, and the file
   * they get is the history they can already read. */
  const exportsTheHistory = offered && role !== null && mayTakeAnExport(role);

  const firstDayField = useRef<HTMLInputElement>(null);
  const historyExport = useExcelExport(HISTORY_EXPORT);

  useCommands(
    exportsTheHistory
      ? [
          {
            id: "shifts.export",
            label: "Export these shifts to Excel",
            group: "actions" as const,
            keywords: ["excel", "xlsx", "spreadsheet", "variance", "download"],
            // Shown and refused rather than hidden while the file is being
            // written, so an operator who reaches for it twice is told why the
            // second press did nothing.
            disabled: historyExport.isPending,
            action: takeTheHistory,
          },
        ]
      : [],
  );

  useHotkeys("/", () => {
    firstDayField.current?.focus();
    firstDayField.current?.select();
  });

  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;

  // The opening question names no day at all, which the route answers with its
  // own most recent page — roughly a fortnight of desk, newest first. That is
  // the stretch somebody opening this screen is asking about, and it is a
  // question that can be asked before the property's day has arrived.
  const opening = useMemo<ShiftHistoryQuery | null>(() => {
    if (!offered) {
      return null;
    }

    const attempt = historyQuestion(DEFAULT_HISTORY_FIELDS, null, 0);

    if ("problem" in attempt) {
      // Unreachable: the opening fields carry no typed date, and the only
      // refusal `historyQuestion` has is about one. Thrown rather than quietly
      // replaced, for `folio-ledger.ts`'s reason — a screen silently opening on
      // filters nobody chose would be lying about what it is showing.
      throw new Error(attempt.problem);
    }

    return attempt.query;
  }, [offered]);

  const query = asked?.query ?? opening;
  const offset = asked?.offset ?? 0;

  const history = useShiftHistory(query);
  const shifts = history.data?.shifts ?? NO_SHIFTS;

  const choices = useMemo(
    () => operatorChoices(shifts, fields.operator),
    [shifts, fields.operator],
  );

  /* The file carries the question the screen is showing, not the words
   * currently in the fields: `query` is what was submitted and what the table
   * below was drawn from. A receptionist's `operatorId` is whatever they were
   * answered with, and the API overwrites it with their own account anyway —
   * this screen does not narrow it a second time, for the reason
   * `shift-day.ts` gives about the picker it already declines to offer them. */
  function takeTheHistory() {
    if (query !== null) {
      historyExport.mutate(query);
    }
  }

  /* One path for every change of question, because the filters and the pager
   * are parts of one query — a screen that built it in two places would
   * eventually build it two ways. */
  function ask(next: HistoryFields, nextOffset: number) {
    const attempt = historyQuestion(next, businessDate, nextOffset);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setFields(next);
    setAsked({ query: attempt.query, fields: next, offset: nextOffset });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Shifts"
        description="Drawer history, variances, and handover notes."
      />

      {!offered ? (
        <p className="mt-6 max-w-prose text-sm text-muted-foreground">
          Shift history is available to front desk, accounting, and management.
        </p>
      ) : (
        <>
          <form
            className="mt-6 rounded-lg bg-card p-4 shadow-card"
            onSubmit={(event) => {
              event.preventDefault();
              ask(fields, 0);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="From"
                value={fields.from}
                placeholder="the first trading day"
                inputRef={firstDayField}
                onChange={(from) => {
                  setFields((current) => ({ ...current, from }));
                }}
              />
              <Field
                label="To"
                value={fields.to}
                placeholder="the last, inclusive"
                onChange={(to) => {
                  setFields((current) => ({ ...current, to }));
                }}
              />

              {picksOperator ? (
                <OperatorChoice
                  choices={choices}
                  value={fields.operator}
                  onChange={(operator) => {
                    setFields((current) => ({ ...current, operator }));
                  }}
                />
              ) : null}
            </div>

            {problem === null ? null : (
              <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
                {problem}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="submit">Show shifts</Button>
              {exportsTheHistory ? (
                /* The label changes as well as the control disabling: a file of
                   a year of desk is one the API is still writing, and a control
                   that only greyed out would read as broken for as long as it
                   took. */
                <Button
                  type="button"
                  variant="ghost"
                  disabled={query === null || historyExport.isPending}
                  onClick={takeTheHistory}
                >
                  {historyExport.isPending
                    ? "Writing the file"
                    : "Export to Excel"}
                </Button>
              ) : null}
              <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                {/* Said rather than implied: both ends are the trading day the
                    shift opened on and not the instant it opened at, which is
                    what puts a night shift's variance on the day it was
                    answerable for. */}
                <KeyHint>/</KeyHint>
                <span>First day</span>
                <span>Inclusive trading days</span>
                {picksOperator ? null : <span>Your shifts only</span>}
              </span>
            </div>
          </form>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <ShiftTable
              shifts={shifts}
              pending={history.isPending}
              failed={history.isError}
              total={history.data?.total ?? 0}
              offset={offset}
              onPage={(nextOffset) => {
                ask(asked?.fields ?? fields, nextOffset);
              }}
            />

            <aside>
              {/* The backlog beside the history, and read-only here. An item
                  outlives the shift that found it, so "what is still
                  outstanding" is the other half of what a handover left — and
                  clearing one is an act, which belongs where the acts are. */}
              <PendingItems onDrawer={false} offered readOnly />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** The page of shifts, newest opening first, and the pager under it. */
function ShiftTable({
  shifts,
  pending,
  failed,
  total,
  offset,
  onPage,
}: {
  shifts: readonly Shift[];
  pending: boolean;
  failed: boolean;
  total: number;
  offset: number;
  onPage(offset: number): void;
}) {
  if (failed) {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p
        className="border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        Shift history could not be loaded.
      </p>
    );
  }

  if (pending) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (shifts.length === 0) {
    return (
      <EmptyState
        title="No matching shifts"
        description="Try a wider date range or another operator."
      />
    );
  }

  const window = pageWindow(total, shifts.length, offset, SHIFT_PAGE_SIZE);

  return (
    <DataTableFrame className="overflow-x-auto p-4">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <caption className="text-muted-foreground mb-2 text-left text-sm">
          Every shift the filters matched, newest opening first. What the drawer
          should have held is the opening float, plus the cash taken on it, plus
          what the property recorded through it; the variance is the property's
          own figure, computed when the drawer was counted out.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Column>Trading day</Column>
            <Column>Operator</Column>
            <Column align="right">Float</Column>
            <Column align="right">Cash taken</Column>
            <Column align="right">Thu chi</Column>
            <Column align="right">Counted out</Column>
            <Column>Variance</Column>
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <ShiftRows key={shift.id} shift={shift} />
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground text-sm">
          {window.first}–{window.last} of {window.total}
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled={!window.hasPrevious}
          onClick={() => {
            onPage(window.previousOffset);
          }}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!window.hasNext}
          onClick={() => {
            onPage(window.nextOffset);
          }}
        >
          Next
        </Button>
      </div>
    </DataTableFrame>
  );
}

/**
 * One shift, and the note it left under it.
 *
 * Two rows rather than a cell, because a handover note is prose of up to two
 * thousand characters and a table cell holding it would set the column widths
 * for every figure beside it. The note is the reason a manager opens this screen
 * on the morning after a bad night, so it is not behind a press either.
 */
function ShiftRows({ shift }: { shift: Shift }) {
  const variance = varianceReading(shift);

  return (
    <>
      <tr
        className={cn(
          "border-border align-top",
          shift.handoverNote === null ? "border-b" : null,
        )}
      >
        <td className="py-1 pr-3 whitespace-nowrap first:pl-0">
          {formatShortDate(shift.openingBusinessDate)}
          <span className="text-muted-foreground block text-sm">
            {formatInstant(shift.openedAt)}
            {shift.closedAt === null
              ? " · still open"
              : ` – ${formatInstant(shift.closedAt)}`}
          </span>
        </td>
        <td className="px-3 py-1">{shift.operatorName}</td>
        <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
          {formatVnd(shift.openingFloat)}
        </td>
        <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
          {formatVnd(shift.cashTaken)}
        </td>
        {/* The property's own money through the same till — `FR-OPS-02`. A term
            of what the drawer should have held, beside the guests' cash rather
            than folded into it: one is what the desk took and the other is what
            the property spent from the till, and a manager reading a variance
            asks which. */}
        <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
          {formatVnd(shift.cashBookNet)}
        </td>
        <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
          {shift.closingCount === null ? (
            <span className="text-muted-foreground">Not counted</span>
          ) : (
            formatVnd(shift.closingCount)
          )}
        </td>
        <td className="py-1 pl-3 whitespace-nowrap last:pr-0">
          {variance === null ? (
            <span className="text-muted-foreground">Open</span>
          ) : variance.tone === "square" ? (
            VARIANCE_LABELS.square
          ) : (
            <span className="text-destructive">
              {VARIANCE_LABELS[variance.tone]} {formatVnd(variance.amount)}
            </span>
          )}
        </td>
      </tr>

      {shift.handoverNote === null ? null : (
        <tr className="border-border border-b">
          <td
            className="text-muted-foreground pb-2 text-sm first:pl-0"
            colSpan={7}
          >
            <span className="border-border block border-l-2 pl-3 whitespace-pre-wrap">
              {shift.handoverNote}
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Whose desk, or everybody's.
 *
 * The empty value is "every operator" and is a real member of the list rather
 * than a cleared field: a filter that is cleared by deleting text is a filter
 * somebody cannot tell from one they have not typed into yet.
 */
function OperatorChoice({
  choices,
  value,
  onChange,
}: {
  choices: readonly Operator[];
  value: Operator | null;
  onChange(operator: Operator | null): void;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-sm  uppercase"
      >
        Operator
      </label>
      <select
        id={fieldId}
        className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        value={value?.id ?? ""}
        onChange={(event) => {
          const picked = event.target.value;
          onChange(choices.find((one) => one.id === picked) ?? null);
        }}
      >
        <option value="">Every operator</option>
        {choices.map((operator) => (
          <option key={operator.id} value={operator.id}>
            {operator.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  inputRef,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, for the reason every other form in
  // this console gives: the input is a component and a label has no way to
  // prove what it wraps.
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-sm  uppercase"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        ref={inputRef}
        className="mt-1"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
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
      className={cn(
        "text-muted-foreground px-3 py-2 text-sm font-normal  uppercase first:pl-0 last:pr-0",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}
