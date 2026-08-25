"use client";

import {
  CHANGE_LOG_EXPORT_PATH,
  CHANGE_LOG_EXPORT_STEM,
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommands } from "@/features/command-palette";
/* The console's one rendering of an instant in the property's zone — the same
 * formatter a folio attributes a posting with, so the moment a change was made
 * and the moment a payment moved are read the same way. */
import { formatInstant } from "@/features/guests/guest-record";
import { useStaffSession } from "@/lib/auth";
/* The one place the console takes a list away as a spreadsheet. An accountant
 * is offered it here and the file they get holds financial entries only — the
 * API narrows it off the same grant it narrows this list with, so nothing on
 * this screen decides what is financial. */
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";
import { useHotkeys } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import {
  type ChangeReading,
  type PageReading,
  useBusinessDate,
  useChange,
  useChangeLog,
} from "./audit-queries";
import {
  ACTION_LABELS,
  type AuditFilterFields,
  actorLabel,
  auditFilters,
  CHANGE_ACTIONS,
  type ChangedField,
  type ChangeQuestion,
  changedCount,
  changedFirst,
  DEFAULT_AUDIT_FILTERS,
  type LoggedChange,
  mayReadTheLog,
  SCOPE_NOTES,
  valueLabel,
} from "./change-log";

/* Who changed protected state, and what it looked like before they did.
 *
 * `docs/screens.md` names the family's intent — "Review who changed protected
 * state and when" — and states the shape: "Audit is reached from the record, not
 * only from the menu: every booking, folio, invoice and guest record carries a
 * history link that opens the audit view pre-filtered to that record, and the
 * standalone screen with actor, action and date filters remains for sweeps."
 * This is that standalone screen, and its filters are the same ones a record
 * link would arrive carrying — the table and the row are two of the five.
 *
 * ## One list, read twice
 *
 * The table is the change log: who, what table, which row, when. Pressing a row
 * opens the second read beside it — the whole row on either side of the change,
 * column by column, the ones that moved first. They are two routes rather than
 * one because a snapshot is a whole row of an arbitrary table:
 * `contract/audit.ts` argues that fifty of them on a page would be megabytes for
 * a table that draws four columns.
 *
 * ## Nothing here is a number
 *
 * The sharpest property of this screen, and the reason the wire carries text.
 * A snapshot holds `bigint` đồng amounts; Postgres `jsonb` numbers are arbitrary
 * precision and a JavaScript `number` is not, so an amount that went through one
 * would come back a different figure — in a log whose entire purpose is to be
 * believed. Postgres extracts every value as text with `->>`, `change-log.ts`
 * hands it on untouched, and the cell below prints it. There is no formatter on
 * a snapshot value anywhere in this family, deliberately: `money.ts`'s is for a
 * figure the API typed as an amount, and a snapshot column is untyped text out
 * of a table this screen does not know the shape of.
 *
 * ## Who sees what
 *
 * One key governs both reads — *Audit log viewer*, which the matrix grants the
 * accountant, the manager and the admin. The accountant's grant is a ⚠ with the
 * note "ACC: financial entries only", and the narrowing happens on the server:
 * this screen does not decide what is financial and does not ask the role, it
 * prints the scope the API answered with. A reader handed a short list has no
 * other way to tell a quiet fortnight from a narrowed one.
 *
 * The receptionist and the housekeeper are not offered the family at all, so
 * reaching this url gives them the sentence saying where their own work is
 * reviewed rather than a screen that would answer 403 twice over.
 *
 * ## Nothing here writes
 *
 * There is no control on this screen that edits, annotates or removes an entry.
 * That is not an omission to fill in later: `schema/audit.ts` has no update path
 * and the matrix grants this row a viewer. A log with a correction route is not
 * a log.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the day, as it does on the search of every other screen.
 * The table is read rather than worked, so it is not a roving group: the only
 * things that answer a press are the filters, the pager and the row that opens
 * a change.
 *
 * `g u` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** Operational surfaces carry no entrance motion, and every
 * control answers the press immediately.
 */

/** Where the change log's export answers and what its file is called, from the
 *  contract rather than typed out here. */
const LOG_EXPORT: ExcelExportSubject = {
  path: CHANGE_LOG_EXPORT_PATH,
  stem: CHANGE_LOG_EXPORT_STEM,
  failure: "The change log could not be exported.",
};

/** What the screen is currently asking the list for. */
interface Asked {
  readonly question: ChangeQuestion;
  /** The filters that question was built from — what the pager re-builds
   *  against, so paging asks the question that was submitted rather than
   *  whatever has been typed into the form since. */
  readonly fields: AuditFilterFields;
  readonly offset: number;
}

export function AuditScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<AuditFilterFields>(
    DEFAULT_AUDIT_FILTERS,
  );
  // Null until the first question is submitted. The opening one is derived from
  // the property's day below rather than held here, because a day typed as
  // "today" has no answer until the API has said what today is.
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReadTheLog(role);
  /* Both rows, and neither alone. The log's row already denies a receptionist,
   * so the conjunction is what the *Excel export* row's note "operational lists
   * only" comes to on this screen — with nothing here having to know that. */
  const exportsTheLog = offered && role !== null && mayTakeAnExport(role);

  const dayField = useRef<HTMLInputElement>(null);
  const logExport = useExcelExport(LOG_EXPORT);

  useCommands(
    exportsTheLog
      ? [
          {
            id: "audit.export",
            label: "Export these changes to Excel",
            group: "actions" as const,
            keywords: ["excel", "xlsx", "spreadsheet", "audit", "download"],
            // Shown and refused rather than hidden while the file is being
            // written, so an operator who reaches for it twice is told why the
            // second press did nothing.
            disabled: logExport.isPending,
            action: takeTheLog,
          },
        ]
      : [],
  );

  useHotkeys("/", () => {
    dayField.current?.focus();
    dayField.current?.select();
  });

  // The day is read first so the opening question can be built in the same
  // render it arrives, with no effect synchronising two pieces of state that are
  // one fact.
  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;
  const opening = useMemo<ChangeQuestion | null>(() => {
    if (!offered || businessDate === null) {
      return null;
    }

    const attempt = auditFilters(DEFAULT_AUDIT_FILTERS, businessDate, 0);

    // The defaults name no day, no record and no actor, so the attempt cannot
    // fail — this is the narrowing rather than a fallback, and a `problem` here
    // would be a bug in the defaults rather than something to report.
    return "problem" in attempt ? null : attempt.question;
  }, [offered, businessDate]);

  const question = asked?.question ?? opening;
  const offset = asked?.offset ?? 0;

  const page = useChangeLog(question, offset);
  const change = useChange(opened);

  /* The file carries the question the screen is showing, not the words
   * currently in the fields: `question.input` is what was submitted and what the
   * table below was drawn from, window included — a day picked here is two
   * instants, and the export is cut on the same two. The page is dropped on the
   * way, because an export answers with everything the filters match. */
  function takeTheLog() {
    if (question !== null) {
      logExport.mutate(question.input);
    }
  }

  /* One path for every change of question, because they are the same act: the
   * filters and the page are parts of one query, and a screen that built it in
   * two places would eventually build it two ways. */
  function ask(next: AuditFilterFields, nextOffset: number) {
    const attempt = auditFilters(next, businessDate, nextOffset);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setFields(next);
    setAsked({ question: attempt.question, fields: next, offset: nextOffset });
    // A change opened under one question belongs to it. The answer coming may
    // not contain the row it was opened from, and a panel standing beside a
    // list that no longer holds its row reads as an entry the reader has lost.
    setOpened(null);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Audit"
        description="Who changed protected state, when, and what moved."
      />

      {!offered ? (
        <p className="text-muted-foreground mt-4 max-w-prose text-sm">
          Reviewing who changed what is the accountant's work, and management's.
          The desk's own day is reviewed on Shifts — the drawer, the count and
          what the last shift handed over.
        </p>
      ) : propertyDay.isError ? (
        <p className="border-destructive text-destructive mt-4 border-l-2 pl-3 text-sm">
          The property's day could not be read, and a day typed into the filters
          is counted from it. Nothing is shown rather than a day this console
          guessed at.
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field
                label="Day"
                value={fields.day}
                placeholder="every day"
                inputRef={dayField}
                onChange={(day) => {
                  setFields((current) => ({ ...current, day }));
                }}
              />
              <Field
                label="Record type"
                value={fields.tableName}
                placeholder="rate_calendar"
                onChange={(tableName) => {
                  setFields((current) => ({ ...current, tableName }));
                }}
              />
              <Field
                label="Record"
                value={fields.rowId}
                placeholder="The row's id"
                onChange={(rowId) => {
                  setFields((current) => ({ ...current, rowId }));
                }}
              />
              <Field
                label="Actor"
                value={fields.actorId}
                placeholder="A staff id"
                onChange={(actorId) => {
                  setFields((current) => ({ ...current, actorId }));
                }}
              />
              <Choice
                label="Change"
                value={fields.action}
                options={[
                  { value: "ANY" as const, label: "Every change" },
                  ...CHANGE_ACTIONS.map((action) => ({
                    value: action,
                    label: ACTION_LABELS[action],
                  })),
                ]}
                onChange={(action) => {
                  setFields((current) => ({ ...current, action }));
                }}
              />
            </div>

            {problem === null ? null : (
              <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
                {problem}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="submit">Show changes</Button>
              {exportsTheLog ? (
                /* The label changes as well as the control disabling: a file of
                   a month of the log is one the API is still writing, and a
                   control that only greyed out would read as broken for as long
                   as it took. */
                <Button
                  type="button"
                  variant="ghost"
                  disabled={question === null || logExport.isPending}
                  onClick={takeTheLog}
                >
                  {logExport.isPending ? "Writing the file" : "Export to Excel"}
                </Button>
              ) : null}
              <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                {/* Said rather than implied: the pair is an address, and the
                    index behind it is on both halves. */}
                <KeyHint>/</KeyHint>
                <span>First day</span>
                <span>Type and record form one result</span>
              </span>
            </div>
          </form>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <ChangeTable
              page={page}
              opened={opened}
              onOpen={setOpened}
              onPage={(nextOffset) => {
                ask(asked?.fields ?? fields, nextOffset);
              }}
            />

            <ChangePanel reading={change} />
          </div>
        </>
      )}
    </div>
  );
}

/** The page of changes, and the pager under it. */
function ChangeTable({
  page,
  opened,
  onOpen,
  onPage,
}: {
  page: PageReading;
  opened: string | null;
  onOpen(auditEntryId: string): void;
  onPage(offset: number): void;
}) {
  if (page.status === "idle" || page.status === "pending") {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (page.status === "failed") {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p
        className="border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        The change log could not be loaded.
      </p>
    );
  }

  return (
    <DataTableFrame className="overflow-x-auto p-4">
      <p className="text-muted-foreground mb-2 text-sm">
        {SCOPE_NOTES[page.scope]}
      </p>

      {page.entries.length === 0 ? (
        <EmptyState
          title="No matching changes"
          description="Try a wider date range or fewer record filters."
        />
      ) : (
        <>
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="text-muted-foreground mb-2 text-left text-sm">
              Every change the filters matched, newest first. Press a row to
              read the whole record on either side of it.
            </caption>
            <thead>
              <tr className="border-border border-b">
                <Column>When</Column>
                <Column>Who</Column>
                <Column>What</Column>
                <Column>Record</Column>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <ChangeRowCells
                  key={entry.id}
                  change={entry}
                  opened={opened === entry.id}
                  onOpen={onOpen}
                />
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              {page.window.first}–{page.window.last} of {page.window.total}
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={!page.window.hasPrevious}
              onClick={() => {
                onPage(page.window.previousOffset);
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!page.window.hasNext}
              onClick={() => {
                onPage(page.window.nextOffset);
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </DataTableFrame>
  );
}

/** One change, and the press that opens what it did. */
function ChangeRowCells({
  change,
  opened,
  onOpen,
}: {
  change: LoggedChange;
  opened: boolean;
  onOpen(auditEntryId: string): void;
}) {
  return (
    <tr
      className={cn(
        "border-border border-b align-top",
        opened ? "bg-accent/40" : null,
      )}
    >
      <td className="text-muted-foreground py-1 pr-3 whitespace-nowrap first:pl-0">
        {formatInstant(change.occurredAt)}
      </td>
      <td className="px-3 py-1">
        <span>{actorLabel(change)}</span>
        {change.actorId === null ? null : (
          <p className="text-muted-foreground tabular-nums text-sm">
            {change.actorId}
          </p>
        )}
      </td>
      <td className="px-3 py-1 whitespace-nowrap">
        {ACTION_LABELS[change.action]}
      </td>
      <td className="py-1 pl-3 last:pr-0">
        <p className="tabular-nums text-sm">{change.tableName}</p>
        <p className="text-muted-foreground tabular-nums text-sm">
          {change.rowId}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={opened}
          className="mt-1"
          onClick={() => {
            onOpen(change.id);
          }}
        >
          {opened ? "Reading" : "Read the change"}
        </Button>
      </td>
    </tr>
  );
}

/** The whole record on either side of one change. */
function ChangePanel({ reading }: { reading: ChangeReading }) {
  const fields = useMemo(
    () =>
      reading.status === "ready" ? changedFirst(reading.change.fields) : [],
    [reading],
  );

  if (reading.status === "closed") {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        <p className="text-xs tracking-caps uppercase">The change</p>
        <p className="mt-2">
          Press a row to read the record it names, column by column, on either
          side of the change. The columns that moved come first.
        </p>
      </Card>
    );
  }

  if (reading.status === "pending") {
    return (
      <Card className="p-5 text-sm text-muted-foreground" aria-busy>
        Reading the record.
      </Card>
    );
  }

  if (reading.status === "failed") {
    // Drawn here rather than as a toast, because the ordinary cause is not a
    // fault: an entry outside a narrowed reader's scope answers as no such
    // entry, which `contract/audit.ts` argues is the honest shape.
    return (
      <Card className="border-danger border-l-2 p-5 text-sm text-danger">
        That change could not be read. It is either not in this log or no longer
        in the property's records.
      </Card>
    );
  }

  const { change } = reading;
  const moved = changedCount(change.fields);

  return (
    <Card className="p-5">
      <p className="text-muted-foreground text-xs tracking-caps uppercase">
        The change
      </p>
      <p className="mt-2 text-sm">
        {actorLabel(change)}, {ACTION_LABELS[change.action]},{" "}
        {formatInstant(change.occurredAt)}
      </p>
      <p className="text-muted-foreground tabular-nums text-sm">
        {change.tableName}, {change.rowId}
      </p>
      <p className="text-muted-foreground mt-2 text-sm">
        {/* Zero is a real answer and is still said: a change that moved no
            column is a write that recorded itself, and hiding the count would
            leave a reader scanning forty rows for something that is not
            there. */}
        {moved === 1 ? "One column moved" : `${moved} columns moved`}, of{" "}
        {change.fields.length}.
      </p>

      <dl className="mt-2 divide-border divide-y text-sm">
        {fields.map((field) => (
          <FieldRow key={field.column} field={field} />
        ))}
      </dl>
    </Card>
  );
}

/**
 * One column, before and after.
 *
 * Both values are printed exactly as they arrived. There is no formatter here
 * and there must not be one: the module header says why a đồng amount that went
 * through a `number` would come back a different figure, and this cell is the
 * last place that could happen.
 */
function FieldRow({ field }: { field: ChangedField }) {
  return (
    <div className={cn("py-2", field.changed ? null : "text-muted-foreground")}>
      <dt className="tabular-nums text-sm">
        {field.column}
        {field.changed ? null : (
          <span className="ml-2 tracking-caps uppercase">unchanged</span>
        )}
      </dt>
      <dd className="mt-1 tabular-nums text-sm break-all">
        {field.changed ? (
          <>
            <span className="line-through">{valueLabel(field.before)}</span>
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> became </span>
            <span className="text-foreground">{valueLabel(field.after)}</span>
          </>
        ) : (
          // One value rather than the same one twice: a column that did not
          // move has one value, and printing it as an arrow between two
          // identical figures reads as a change nobody made.
          valueLabel(field.after ?? field.before)
        )}
      </dd>
    </div>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="text-muted-foreground py-1 text-left text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
    >
      {children}
    </th>
  );
}

/** One typed field, labelled. */
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
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
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

/**
 * One of a closed set, as a native `<select>` — the same control the filters on
 * Payments and Folios use and for the same reason: four members are an enum the
 * browser already gives arrows, type-ahead and a native mobile picker.
 */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  // The cast below is the one the DOM obliges: `event.target.value` is a
  // string, and what constrains it to the set is that the `<option>`s are drawn
  // from that set and nothing else.
  onChange(value: T): void;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <select
        id={fieldId}
        className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        value={value}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
