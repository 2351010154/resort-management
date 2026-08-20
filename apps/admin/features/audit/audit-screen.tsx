"use client";

import type { StaffRole } from "@mariva/shared";
import type * as React from "react";
import { useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
/* The console's one rendering of an instant in the property's zone — the same
 * formatter a folio attributes a posting with, so the moment a change was made
 * and the moment a payment moved are read the same way. */
import { formatInstant } from "@/features/guests/guest-record";
import { useStaffSession } from "@/lib/auth";
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

  const dayField = useRef<HTMLInputElement>(null);

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
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Record
        </p>
        <h1 className="font-display text-display-sm mt-2">Audit</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          Who changed protected state, when, and what the row looked like on
          either side of it. Every entry is written once and never edited —
          there is no control on this screen that corrects one, because a log
          with a correction route is not a log.
        </p>
      </header>

      {!offered ? (
        <p className="text-muted-foreground mt-rhythm-2 max-w-prose text-sm">
          Reviewing who changed what is the accountant's work, and management's.
          The desk's own day is reviewed on Shifts — the drawer, the count and
          what the last shift handed over.
        </p>
      ) : propertyDay.isError ? (
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The property's day could not be read, and a day typed into the filters
          is counted from it. Nothing is shown rather than a day this console
          guessed at.
        </p>
      ) : (
        <>
          <form
            className="mt-rhythm-2"
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
              <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
                {problem}
              </p>
            )}

            <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
              <Button type="submit">Show changes</Button>
              <span className="text-muted-foreground text-xs">
                {/* Said rather than implied: the pair is an address, and the
                    index behind it is on both halves. */}
                / reaches the day · a record is a type and a row together
              </span>
            </div>
          </form>

          <div className="mt-rhythm-2 grid gap-rhythm-2 lg:grid-cols-[1fr_26rem]">
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
      <p className="text-muted-foreground text-sm" aria-busy>
        Reading the change log.
      </p>
    );
  }

  if (page.status === "failed") {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
        The change log could not be read. Nothing here is a statement about what
        the property has or has not changed.
      </p>
    );
  }

  return (
    <div>
      <p className="text-muted-foreground mb-rhythm-1 text-xs">
        {SCOPE_NOTES[page.scope]}
      </p>

      {page.entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No change matches. A stretch in which nothing protected was touched is
          an ordinary stretch — and a record type outside this log's scope has
          nothing in it to show either.
        </p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
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

          <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-xs">
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
    </div>
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
          <p className="text-muted-foreground font-mono text-xs">
            {change.actorId}
          </p>
        )}
      </td>
      <td className="px-3 py-1 whitespace-nowrap">
        {ACTION_LABELS[change.action]}
      </td>
      <td className="py-1 pl-3 last:pr-0">
        <p className="font-mono text-xs">{change.tableName}</p>
        <p className="text-muted-foreground font-mono text-xs">
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
      <aside className="text-muted-foreground text-sm">
        <p className="text-xs tracking-caps uppercase">The change</p>
        <p className="mt-rhythm-1">
          Press a row to read the record it names, column by column, on either
          side of the change. The columns that moved come first.
        </p>
      </aside>
    );
  }

  if (reading.status === "pending") {
    return (
      <aside className="text-muted-foreground text-sm" aria-busy>
        Reading the record.
      </aside>
    );
  }

  if (reading.status === "failed") {
    // Drawn here rather than as a toast, because the ordinary cause is not a
    // fault: an entry outside a narrowed reader's scope answers as no such
    // entry, which `contract/audit.ts` argues is the honest shape.
    return (
      <aside className="border-destructive text-destructive border-l-2 pl-3 text-sm">
        That change could not be read. It is either not in this log or no longer
        in the property's records.
      </aside>
    );
  }

  const { change } = reading;
  const moved = changedCount(change.fields);

  return (
    <aside>
      <p className="text-muted-foreground text-xs tracking-caps uppercase">
        The change
      </p>
      <p className="mt-rhythm-1 text-sm">
        {actorLabel(change)} · {ACTION_LABELS[change.action]} ·{" "}
        {formatInstant(change.occurredAt)}
      </p>
      <p className="text-muted-foreground font-mono text-xs">
        {change.tableName} · {change.rowId}
      </p>
      <p className="text-muted-foreground mt-rhythm-1 text-xs">
        {/* Zero is a real answer and is still said: a change that moved no
            column is a write that recorded itself, and hiding the count would
            leave a reader scanning forty rows for something that is not
            there. */}
        {moved === 1 ? "One column moved" : `${moved} columns moved`}, of{" "}
        {change.fields.length}.
      </p>

      <dl className="mt-rhythm-1 divide-border divide-y text-sm">
        {fields.map((field) => (
          <FieldRow key={field.column} field={field} />
        ))}
      </dl>
    </aside>
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
      <dt className="font-mono text-xs">
        {field.column}
        {field.changed ? null : (
          <span className="ml-2 tracking-caps uppercase">unchanged</span>
        )}
      </dt>
      <dd className="mt-1 font-mono text-xs break-all">
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
