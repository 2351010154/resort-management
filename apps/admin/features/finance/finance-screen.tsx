"use client";

import {
  CASH_BOOK_CATEGORIES,
  CASH_BOOK_PAGE_SIZE,
  formatVnd,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCommands } from "@/features/command-palette";
/* The property's day, from the hook the rest of the console already asks it
 * with: one route through the same `orpc` utils is one cache entry, so the day a
 * typed filter is resolved against here is the day the desk is working, without
 * a second request and without a second opinion about what its failure says. */
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { pageWindow } from "@/features/folios/folio-ledger";
/* The console's one rendering of an instant in the property's zone, and of a
 * trading day, taken from the modules that already own them rather than a third
 * `Intl.DateTimeFormat` beside them. */
import { formatInstant } from "@/features/guests/guest-record";
/* The shift history, read for one thing only: which drawers are still open, so
 * a cash entry can name the till it moved through. `cash-book.ts` says why that
 * is derived from the history rather than asked of a route of its own. */
import { useShiftHistory } from "@/features/shifts";
import { useStaffSession } from "@/lib/auth";
import { formatShortDate } from "@/lib/business-date";
import { useHotkeys } from "@/lib/keyboard";

import {
  type BookFields,
  bookQuestion,
  type CashBookEntry,
  type CashBookQuery,
  CATEGORY_LABELS,
  DEFAULT_BOOK_FIELDS,
  DIRECTION_LABELS,
  mayKeepTheBook,
  METHOD_LABELS,
  netOfTheBook,
  type OpenDrawer,
  openDrawersIn,
} from "./cash-book";
import { useCashBook } from "./finance-queries";
import {
  Choice,
  CorrectEntryForm,
  Field,
  Problem,
  RecordEntryForm,
} from "./entry-forms";

/* The property's own cash book — `FR-OPS-02`, *thu chi*.
 *
 * `docs/screens.md` is narrow about what belongs here: Finance is "strictly the
 * money the folio system does not capture — categorised income and expense such
 * as supplies, utilities and salaries. Stay revenue lives in Reports, computed
 * from night-audit snapshots; showing it here too would invite double-counting
 * the hotel's main income." So there is no room revenue on this screen, no
 * occupancy, and no folio — not as an omission to fill in later, but because the
 * property's main income has a screen of its own and two answers to what it
 * earned would be one answer too many.
 *
 * ## Who this is for
 *
 * The matrix's *Income / expense (thu chi)* row grants `full` to `ACCOUNTANT`,
 * `MANAGER` and `ADMIN` and lists nobody else, so this screen is offered to
 * three roles and the rail already hides it from the rest. **A receptionist is
 * refused, deliberately**: the person standing at the till does not book what
 * left it, which is the ordinary separation between holding money and accounting
 * for it. What they see instead is their drawer's expected figure moving, which
 * is what the count they sign has to agree with.
 *
 * ## The book is a record and not a working document
 *
 * There is no edit control and no delete control anywhere on this screen. An
 * entry that turns out to be wrong is undone by a correction that names it, and
 * both stay in the record — `migrations/0042` refuses the alternative at the
 * table, because a shift's expected cash is computed from these rows and an
 * entry edited after the drawer was counted would move a variance somebody has
 * already signed for.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the first day, as it does on every other screen with
 * filters. The palette carries the one act this screen owns, so an accountant
 * who arrived by `g i` reaches the form without a mouse. The table is read
 * rather than worked, so it is not a roving group: the things that answer a
 * press are the filters, the pager and the correction on a row.
 *
 * **No animation.** Operational surfaces carry no entrance motion — the filters
 * paint their own pending line and the pager disables in place.
 */

/** What the screen is currently asking the book for. */
interface Asked {
  readonly query: CashBookQuery;
  /** The filters that query was built from — what the pager re-builds against,
   *  so paging asks the question that was submitted rather than whatever has
   *  been typed into the form since. */
  readonly fields: BookFields;
  readonly offset: number;
}

/* One empty page, shared by every render that has none. A fresh `[]` in a
 * ternary is a new array every render, and the drawers below are memoized on the
 * shifts they were built from. */
const NO_ENTRIES: readonly CashBookEntry[] = [];

export function FinanceScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<BookFields>(DEFAULT_BOOK_FIELDS);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayKeepTheBook(role);

  const firstDayField = useRef<HTMLInputElement>(null);
  const amountField = useRef<HTMLInputElement>(null);

  useHotkeys("/", () => {
    firstDayField.current?.focus();
    firstDayField.current?.select();
  });

  useCommands(
    offered
      ? [
          {
            id: "finance.record-entry",
            label: "Record income or expense",
            group: "actions" as const,
            keywords: ["thu chi", "expense", "supplies", "utilities", "salary"],
            action: () => {
              amountField.current?.focus();
              amountField.current?.scrollIntoView({ block: "center" });
            },
          },
        ]
      : [],
  );

  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;

  // The opening question names no filter at all, which the route answers with
  // its own most recent page — about a month of a small property's own money.
  // That is the stretch somebody opening this screen is asking about, and it is
  // a question that can be asked before the property's day has arrived.
  const opening = useMemo<CashBookQuery | null>(() => {
    if (!offered) {
      return null;
    }

    const attempt = bookQuestion(DEFAULT_BOOK_FIELDS, null, 0);

    if ("problem" in attempt) {
      // Unreachable: the opening fields carry no typed date, and the only
      // refusal `bookQuestion` has is about one. Thrown rather than quietly
      // replaced, for `folio-ledger.ts`'s reason — a screen silently opening on
      // filters nobody chose would be lying about what it is showing.
      throw new Error(attempt.problem);
    }

    return attempt.query;
  }, [offered]);

  const query = asked?.query ?? opening;
  const offset = asked?.offset ?? 0;

  const book = useCashBook(query);
  const entries = book.data?.entries ?? NO_ENTRIES;

  // The newest page of the history, unfiltered — its open shifts are the tills a
  // cash entry may name. Asked only of somebody who may record one, so a console
  // that merely reads the book spends no request on it.
  const history = useShiftHistory(offered ? { limit: 50, offset: 0 } : null);
  const drawers = useMemo(
    () => openDrawersIn(history.data?.shifts ?? []),
    [history.data?.shifts],
  );

  /* One path for every change of question, because the filters and the pager
   * are parts of one query — a screen that built it in two places would
   * eventually build it two ways. */
  function ask(next: BookFields, nextOffset: number) {
    const attempt = bookQuestion(next, businessDate, nextOffset);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setFields(next);
    setAsked({ query: attempt.query, fields: next, offset: nextOffset });
  }

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Operations
        </p>
        <h1 className="font-display text-display-sm mt-2">Finance</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2 max-w-prose">
          The property's own money — what it spent on supplies, utilities and
          wages, and what it took in outside a guest's account. Room revenue is
          not here: it is computed from the night audit and read in Reports, and
          counting it twice is the one thing this book must not do.
        </p>
      </header>

      {!offered ? (
        <p className="text-muted-foreground mt-rhythm-2 max-w-prose text-sm">
          The cash book belongs to the accountant and management. Money out of a
          drawer is recorded by whoever accounts for it rather than by whoever
          is holding it — what the desk sees is the drawer's expected figure
          moving.
        </p>
      ) : (
        <>
          <section className="mt-rhythm-2">
            <h2 className="font-display text-lg">Record a movement</h2>
            <div className="mt-rhythm-1 max-w-3xl">
              <RecordEntryForm
                drawers={drawers}
                drawersPending={history.isPending}
                businessDate={businessDate}
                amountField={amountField}
                onRecorded={() => {
                  // The book below re-reads itself: the mutation invalidates
                  // the family, so nothing here has to re-ask what it is
                  // showing.
                  setProblem(null);
                }}
              />
            </div>
          </section>

          <form
            className="mt-rhythm-3"
            onSubmit={(event) => {
              event.preventDefault();
              ask(fields, 0);
            }}
          >
            <h2 className="font-display text-lg">The book</h2>
            <div className="mt-rhythm-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <Choice
                label="Side"
                value={fields.direction}
                options={[
                  { value: "" as const, label: "Both sides" },
                  { value: "INCOME" as const, label: DIRECTION_LABELS.INCOME },
                  {
                    value: "EXPENSE" as const,
                    label: DIRECTION_LABELS.EXPENSE,
                  },
                ]}
                onChange={(direction) => {
                  setFields((current) => ({ ...current, direction }));
                }}
              />
              <Choice
                label="Category"
                value={fields.category}
                options={[
                  { value: "" as const, label: "Every category" },
                  /* Every category once, from the contract's own list —
                     expenses first, then the income the folio never sees. The
                     recording form offers the chosen side's list instead,
                     because there a category on the wrong side is a refusal
                     waiting for the amount to be typed; here nothing is being
                     recorded, so filtering on `SALARIES` is a legitimate
                     question whichever side is showing. */
                  ...CASH_BOOK_CATEGORIES.map((category) => ({
                    value: category,
                    label: CATEGORY_LABELS[category],
                  })),
                ]}
                onChange={(category) => {
                  setFields((current) => ({ ...current, category }));
                }}
              />
              <Choice
                label="Method"
                value={fields.method}
                options={[
                  { value: "" as const, label: "Either way" },
                  { value: "CASH" as const, label: METHOD_LABELS.CASH },
                  {
                    value: "BANK_TRANSFER" as const,
                    label: METHOD_LABELS.BANK_TRANSFER,
                  },
                ]}
                onChange={(method) => {
                  setFields((current) => ({ ...current, method }));
                }}
              />
            </div>

            <Problem said={problem} />

            <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
              <Button type="submit">Show the book</Button>
              <span className="text-muted-foreground text-xs">
                {/* Said rather than implied: both ends are the trading day the
                    money moved on and not the day somebody typed it in, which is
                    what puts a Friday transfer entered on Monday in Friday's
                    month. */}
                / reaches the first day · both ends are inclusive trading days
              </span>
            </div>
          </form>

          <Totals
            pending={book.isPending}
            failed={book.isError}
            incomeTotal={book.data?.incomeTotal ?? 0n}
            expenseTotal={book.data?.expenseTotal ?? 0n}
          />

          <EntryTable
            entries={entries}
            pending={book.isPending}
            failed={book.isError}
            total={book.data?.total ?? 0}
            offset={offset}
            correcting={correcting}
            drawers={drawers}
            drawersPending={history.isPending}
            onCorrect={setCorrecting}
            onPage={(nextOffset) => {
              ask(asked?.fields ?? fields, nextOffset);
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * What the filtered book came to.
 *
 * The two sides come from the API, counted under the same predicate the page was
 * cut from — a total assembled from the rows on screen would answer the question
 * for the first fifty entries and be silently wrong for every page after. The
 * net is the one figure this console computes, and `cashBookPageSchema` says why
 * it is not sent: a single net figure would hide a month that took eighty
 * million and spent seventy-nine behind one that moved nothing at all.
 */
function Totals({
  pending,
  failed,
  incomeTotal,
  expenseTotal,
}: {
  pending: boolean;
  failed: boolean;
  incomeTotal: bigint;
  expenseTotal: bigint;
}) {
  if (failed || pending) {
    return null;
  }

  const net = netOfTheBook({ incomeTotal, expenseTotal });

  return (
    <dl className="mt-rhythm-2 grid gap-2 text-sm sm:grid-cols-3">
      <Total label="Thu" value={formatVnd(incomeTotal)} />
      <Total label="Chi" value={formatVnd(expenseTotal)} />
      <Total
        label={net < 0n ? "Net out" : "Net in"}
        value={formatVnd(net < 0n ? -net : net)}
        emphasis
      />
    </dl>
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
    <div>
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {label}
      </dt>
      <dd
        className={emphasis ? "font-mono" : "font-mono text-muted-foreground"}
      >
        {value}
      </dd>
    </div>
  );
}

/** The page of entries, latest trading day first, and the pager under it. */
function EntryTable({
  entries,
  pending,
  failed,
  total,
  offset,
  correcting,
  drawers,
  drawersPending,
  onCorrect,
  onPage,
}: {
  entries: readonly CashBookEntry[];
  pending: boolean;
  failed: boolean;
  total: number;
  offset: number;
  correcting: string | null;
  drawers: readonly OpenDrawer[];
  drawersPending: boolean;
  onCorrect(entryId: string | null): void;
  onPage(offset: number): void;
}) {
  if (failed) {
    // The console's error device is a rule on the leading edge rather than a
    // colour: --color-destructive and --color-primary are the same umber.
    return (
      <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
        The cash book could not be read. Nothing here is a statement about what
        the property took or spent.
      </p>
    );
  }

  if (pending) {
    return (
      <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
        Reading the book.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground mt-rhythm-2 text-sm">
        No entry matches. A stretch of days with nothing in the book is a
        property that spent nothing of its own, which is an ordinary answer for
        a quiet week and a question worth asking about a month.
      </p>
    );
  }

  const window = pageWindow(total, entries.length, offset, CASH_BOOK_PAGE_SIZE);

  return (
    <div className="mt-rhythm-2">
      <table className="w-full border-collapse text-sm">
        <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
          Every entry the filters matched, latest trading day first. A cash
          entry names the drawer it moved through, and its count has to account
          for those đồng; a correction is a row of its own and both stay in the
          record.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Column>Trading day</Column>
            <Column>Category</Column>
            <Column>Method</Column>
            <Column align="right">Thu</Column>
            <Column align="right">Chi</Column>
            <Column>Recorded by</Column>
            <Column>Correction</Column>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <EntryRows
              key={entry.id}
              entry={entry}
              correcting={correcting === entry.id}
              drawers={drawers}
              drawersPending={drawersPending}
              onCorrect={onCorrect}
            />
          ))}
        </tbody>
      </table>

      <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground text-xs">
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
    </div>
  );
}

/**
 * One entry, its note under it, and the correction when one is being written.
 *
 * The two sides get a column each rather than one signed figure, because a
 * column an eye can run down is what a cash book is for: everything on the left
 * came in and everything on the right went out, and nothing has to be decoded.
 *
 * The correction is offered only on an entry that still stands and is not itself
 * one. An entry already corrected says so instead — `reversedByEntryId` travels
 * on the row precisely so this screen does not have to ask a second question to
 * find out.
 */
function EntryRows({
  entry,
  correcting,
  drawers,
  drawersPending,
  onCorrect,
}: {
  entry: CashBookEntry;
  correcting: boolean;
  drawers: readonly OpenDrawer[];
  drawersPending: boolean;
  onCorrect(entryId: string | null): void;
}) {
  const stands =
    entry.reversedByEntryId === null && entry.reversesEntryId === null;

  return (
    <>
      <tr className="border-border align-top">
        <td className="py-1 pr-3 whitespace-nowrap first:pl-0">
          {formatShortDate(entry.businessDate)}
          <span className="text-muted-foreground block text-xs">
            {formatInstant(entry.recordedAt)}
          </span>
        </td>
        <td className="px-3 py-1">
          {CATEGORY_LABELS[entry.category]}
          {entry.reversesEntryId === null ? null : (
            <span className="text-muted-foreground block text-xs">
              A correction
            </span>
          )}
        </td>
        <td className="px-3 py-1 whitespace-nowrap">
          {METHOD_LABELS[entry.method]}
        </td>
        <td className="px-3 py-1 text-right font-mono whitespace-nowrap">
          {entry.direction === "INCOME" ? formatVnd(entry.amount) : null}
        </td>
        <td className="px-3 py-1 text-right font-mono whitespace-nowrap">
          {entry.direction === "EXPENSE" ? formatVnd(entry.amount) : null}
        </td>
        <td className="px-3 py-1">{entry.recordedByName}</td>
        <td className="py-1 pl-3 whitespace-nowrap last:pr-0">
          <Correction
            stands={stands}
            corrected={entry.reversedByEntryId !== null}
            writing={correcting}
            onWrite={() => {
              onCorrect(entry.id);
            }}
            onLeave={() => {
              onCorrect(null);
            }}
          />
        </td>
      </tr>

      <tr className="border-border border-b">
        <td
          className="text-muted-foreground pb-2 text-sm first:pl-0"
          colSpan={7}
        >
          <span className="border-border block border-l-2 pl-3 whitespace-pre-wrap">
            {entry.note}
          </span>

          {correcting ? (
            <div className="mt-rhythm-1">
              <CorrectEntryForm
                entry={entry}
                drawers={drawers}
                drawersPending={drawersPending}
                onCorrected={() => {
                  onCorrect(null);
                }}
                onDismiss={() => {
                  onCorrect(null);
                }}
              />
            </div>
          ) : null}
        </td>
      </tr>
    </>
  );
}

/**
 * The one act a row carries, in the three states it has.
 *
 * Its own component rather than a chain of ternaries in the cell, because the
 * three are genuinely different answers: an entry already corrected says so and
 * offers nothing, a correction itself offers nothing at all — a correction is
 * not corrected again, and the API says so — and an entry that still stands
 * offers the act or the way out of it.
 */
function Correction({
  stands,
  corrected,
  writing,
  onWrite,
  onLeave,
}: {
  stands: boolean;
  corrected: boolean;
  writing: boolean;
  onWrite(): void;
  onLeave(): void;
}) {
  if (corrected) {
    return <span className="text-muted-foreground text-xs">Corrected</span>;
  }

  if (!stands) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={writing ? onLeave : onWrite}
    >
      {writing ? "Leave it" : "Correct"}
    </Button>
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
