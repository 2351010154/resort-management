"use client";

import {
  CASH_BOOK_CATEGORIES,
  CASH_BOOK_EXPORT_PATH,
  CASH_BOOK_EXPORT_STEM,
  CASH_BOOK_PAGE_SIZE,
  formatVnd,
  type StaffRole,
} from "@mariva/shared";
import type * as React from "react";
import { useMemo, useRef, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  FilterBar,
  KeyHint,
  PageHeader,
  Pager,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
/* The property's day, from the hook the rest of the console already asks it
 * with: one route through the same `orpc` utils is one cache entry, so the day a
 * typed filter is resolved against here is the day the desk is working, without
 * a second request and without a second opinion about what its failure says. */
import { useBusinessDate } from "@/features/bookings/bookings-queries";
import { useCommands } from "@/features/command-palette";
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
/* The one place the console takes a list away as a spreadsheet. The act is
 * offered here when the matrix grants both rows — the book's own and the Excel
 * export row — which is the composition `lib/excel-export.ts` argues for and the
 * API makes again on its side. */
import {
  type ExcelExportSubject,
  mayTakeAnExport,
  useExcelExport,
} from "@/lib/excel-export";
import { useHotkeys } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  type BookFields,
  bookQuestion,
  CATEGORY_LABELS,
  type CashBookEntry,
  type CashBookQuery,
  DEFAULT_BOOK_FIELDS,
  DIRECTION_LABELS,
  METHOD_LABELS,
  mayKeepTheBook,
  netOfTheBook,
  type OpenDrawer,
  openDrawersIn,
} from "./cash-book";
import {
  Choice,
  CorrectEntryForm,
  Field,
  Problem,
  RecordEntryForm,
} from "./entry-forms";
import { useCashBook } from "./finance-queries";

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
 * paint their own pending line and the pager refuses a second press in place.
 *
 * ## The two halves of the screen
 *
 * Recording is a card of its own above the book, and the book is a bar of
 * filters over a bounded table. The recording card is laid out in two halves
 * because its fields and its note want different measures: six labelled boxes
 * read best two abreast, and a sentence about what the money bought reads best
 * as prose beside them rather than as a full-width strip under them.
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

/** Where the book's export answers and what its file is called, from the
 *  contract rather than typed out here — `contract/reporting.ts` holds the
 *  address so the two ends cannot disagree about it. */
const BOOK_EXPORT: ExcelExportSubject = {
  path: CASH_BOOK_EXPORT_PATH,
  stem: CASH_BOOK_EXPORT_STEM,
  failure: "The cash book could not be exported.",
};

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
  /* Both rows, and neither alone. The book's row already denies a receptionist,
   * so the conjunction is what the *Excel export* row's note "operational lists
   * only" comes to on this screen — with nothing here having to know that. */
  const exportsTheBook = offered && role !== null && mayTakeAnExport(role);

  const firstDayField = useRef<HTMLInputElement>(null);
  const amountField = useRef<HTMLInputElement>(null);

  useHotkeys("/", () => {
    firstDayField.current?.focus();
    firstDayField.current?.select();
  });

  const bookExport = useExcelExport(BOOK_EXPORT);

  useCommands([
    ...(offered
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
      : []),
    ...(exportsTheBook
      ? [
          {
            id: "finance.export",
            label: "Export the book to Excel",
            group: "actions" as const,
            keywords: ["excel", "xlsx", "spreadsheet", "thu chi", "download"],
            // Shown and refused rather than hidden while the file is being
            // written, so an operator who reaches for it twice is told why the
            // second press did nothing.
            disabled: bookExport.isPending,
            action: takeTheBook,
          },
        ]
      : []),
  ]);

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

  /* The file carries the question the screen is showing, not the words
   * currently in the fields: `query` is what was submitted and what the table
   * below was drawn from, so the export cannot be a wider stretch of the book
   * than the one being read. The page is dropped on the way — an export answers
   * with everything the filters match. */
  function takeTheBook() {
    // The refusal the press only *looks* like it makes: the control carries
    // `aria-disabled` so it keeps focus, so the second press arrives here and is
    // dropped rather than writing the file twice.
    if (query === null || bookExport.isPending) {
      return;
    }

    bookExport.mutate(query);
  }

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
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Finance"
        description="Property income and expenses outside guest folios."
      />

      {!offered ? (
        <EmptyState
          className="mt-6"
          title="The cash book is not part of this role"
          description="What the property itself took and spent is an accounting record, and this console offers it to accounting and management."
        />
      ) : (
        <>
          <Card className="mt-6 p-5">
            <h2 className="text-lg font-semibold leading-6">
              Record a movement
            </h2>
            <div className="mt-4">
              <RecordEntryForm
                drawers={drawers}
                drawersPending={history.isPending}
                drawersFailed={history.isError}
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
          </Card>

          <h2 className="mt-8 text-lg font-semibold leading-6">The book</h2>

          {/* Five filters and two presses, in the bar the rest of the console
              asks a list with. Three columns on a laptop and five on a wide
              screen: five boxes across a 1024px window were five boxes nobody
              could read the options of. */}
          <FilterBar
            className="mt-3"
            fieldsClassName="lg:grid-cols-3 xl:grid-cols-5"
            actions={
              <>
                <Button type="submit">Show the book</Button>
                {exportsTheBook ? (
                  /* The label changes as well as the control refusing, which is
                     not what the forms on this screen do and is deliberate: a
                     recorded entry is over in a moment, and a year of the book
                     is a file the API is still writing. A control that only
                     greyed out would read as broken for as long as it took.
                     `aria-disabled` rather than `disabled`, which is this
                     console's standing answer to a control that stops being
                     pressable under somebody's finger — see {@link Pager}. */
                  <Button
                    type="button"
                    variant="ghost"
                    aria-disabled={query === null || bookExport.isPending}
                    aria-busy={bookExport.isPending}
                    className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                    onClick={takeTheBook}
                  >
                    {bookExport.isPending
                      ? "Writing the file"
                      : "Export to Excel"}
                  </Button>
                ) : null}
              </>
            }
            onSubmit={(event) => {
              event.preventDefault();
              ask(fields, 0);
            }}
          >
            <Field
              label="From"
              value={fields.from}
              placeholder="-30d"
              inputRef={firstDayField}
              onChange={(from) => {
                setFields((current) => ({ ...current, from }));
              }}
            />
            <Field
              label="To"
              value={fields.to}
              placeholder="today"
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
          </FilterBar>

          {/* Below the bar rather than between the fields and the presses, so
              the sentence that says why the press did nothing is not squeezed
              into the row the press is in. */}
          <Problem said={problem} />

          {/* What the key does, then the one thing a reader has to know before
              they believe a date: both ends are the trading day the money moved
              on and not the day somebody typed it in, which is what puts a
              Friday transfer entered on Monday in Friday's month. */}
          <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <KeyHint>/</KeyHint>
              focuses the first day
            </span>
            <span>Both ends are trading days, and both are included.</span>
          </p>

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
            drawersFailed={history.isError}
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
  // A failed read has no figures and none are invented; the table below says so
  // in a sentence, so nothing is said twice here.
  if (failed) {
    return null;
  }

  // The three cards arrive in the shape they will keep, so the table under them
  // does not jump up the page when the book lands.
  if (pending) {
    return (
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3" aria-busy>
        <Total label={DIRECTION_LABELS.INCOME} />
        <Total label={DIRECTION_LABELS.EXPENSE} />
        <Total label="Net" emphasis />
      </dl>
    );
  }

  const net = netOfTheBook({ incomeTotal, expenseTotal });

  return (
    <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
      <Total label={DIRECTION_LABELS.INCOME} value={formatVnd(incomeTotal)} />
      <Total label={DIRECTION_LABELS.EXPENSE} value={formatVnd(expenseTotal)} />
      <Total
        label={net < 0n ? "Net out" : "Net in"}
        value={formatVnd(net < 0n ? -net : net)}
        emphasis
      />
    </dl>
  );
}

/** One of the three figures. Without a value it is the space that figure will
 *  occupy, which is what the screen shows while the book is being read. */
function Total({
  label,
  value,
  emphasis,
}: {
  label: string;
  value?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-card">
      <dt className="text-xs font-semibold tracking-caps text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums",
          emphasis ? null : "text-muted-foreground",
        )}
      >
        {value === undefined ? <Skeleton className="h-8 w-40" /> : value}
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
  drawersFailed,
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
  drawersFailed: boolean;
  onCorrect(entryId: string | null): void;
  onPage(offset: number): void;
}) {
  // The failure is answered before the empty answer and never after it: a
  // failed read carries no entries, and a screen that reached the empty branch
  // first would tell an accountant the property spent nothing all month.
  if (failed) {
    // The console's error device is a rule on the leading edge as much as the
    // colour: --color-danger is a warm red-brown a shade off the umber every
    // other line on the screen is set in, and a sentence that differed only in
    // that would be read as ordinary copy.
    return (
      <p
        className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        The cash book could not be loaded. Nothing on this screen is a statement
        about what the property took or spent until it can be read.
      </p>
    );
  }

  if (pending) {
    // In the frame the page itself arrives in, so the screen does not change
    // shape underneath the reader when the book lands.
    return (
      <DataTableFrame className="mt-6 space-y-2 p-4" aria-busy>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </DataTableFrame>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="No matching entries"
        description="Try a wider date range or fewer filters."
      />
    );
  }

  const window = pageWindow(total, entries.length, offset, CASH_BOOK_PAGE_SIZE);

  return (
    <DataTableFrame className="mt-6">
      {/* Above the scrollport rather than in the table's own `<caption>`: a
          caption is as wide as the table it belongs to, and this table is 900px
          at its narrowest — so a sentence set in one was a sentence the reader
          had to scroll sideways to finish. */}
      <p className="px-4 pt-4 text-sm text-muted-foreground">
        Every entry the filters matched, latest trading day first. A cash entry
        names the drawer it moved through, and its count has to account for
        those đồng; a correction is a row of its own and both stay in the
        record.
      </p>

      {/* Bounded, so the pager under it stays on screen and the headings stay
          above the figures: a page is fifty entries, each of which carries the
          note that says what the money was for, and a table that ran the page
          down took its own column names off the top of it. Both axes scroll
          here — the figures need 900px — and the headings pin to the top of
          this element because `sticky` belongs to the nearest scrolling
          ancestor. */}
      <div className="mt-3 max-h-[70svh] overflow-auto px-4 pb-4">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <caption className="sr-only">
            The property's cash book: trading day, category, method, and what
            moved which way.
          </caption>
          <thead className="sticky top-0 z-10">
            <tr>
              <Column>Trading day</Column>
              <Column>Category</Column>
              <Column>Method</Column>
              <Column align="right">{DIRECTION_LABELS.INCOME}</Column>
              <Column align="right">{DIRECTION_LABELS.EXPENSE}</Column>
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
                drawersFailed={drawersFailed}
                onCorrect={onCorrect}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* How much book there is and the two presses that reach the rest of it,
          outside the scrollport: a pager that scrolled sideways with the
          figures was a control an operator had to go looking for. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-border border-t px-4 py-3 text-sm text-muted-foreground">
        <p>
          {window.first}–{window.last} of {window.total}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Pager
            label="Previous"
            offered={window.hasPrevious}
            onPage={() => {
              onPage(window.previousOffset);
            }}
          />
          <Pager
            label="Next"
            offered={window.hasNext}
            onPage={() => {
              onPage(window.nextOffset);
            }}
          />
        </div>
      </div>
    </DataTableFrame>
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
  drawersFailed,
  onCorrect,
}: {
  entry: CashBookEntry;
  correcting: boolean;
  drawers: readonly OpenDrawer[];
  drawersPending: boolean;
  drawersFailed: boolean;
  onCorrect(entryId: string | null): void;
}) {
  const stands =
    entry.reversedByEntryId === null && entry.reversesEntryId === null;

  return (
    <>
      <tr className="border-border align-top">
        <td className="py-2.5 pr-3 whitespace-nowrap first:pl-0">
          {formatShortDate(entry.businessDate)}
          {/* When it was typed in, under the day it is booked on. The provenance
              tier, so the two facts in one cell are not read at one weight. */}
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {formatInstant(entry.recordedAt)}
          </span>
        </td>
        <td className="px-3 py-2.5">
          {CATEGORY_LABELS[entry.category]}
          {entry.reversesEntryId === null ? null : (
            <span className="text-muted-foreground mt-0.5 block text-xs">
              A correction
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {METHOD_LABELS[entry.method]}
        </td>
        {/* Nothing where the entry has no figure on that side. The other column
            holds it, so a dash here would be a second mark in a pair of columns
            an eye runs down for the one that is filled. */}
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
          {entry.direction === "INCOME" ? formatVnd(entry.amount) : null}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
          {entry.direction === "EXPENSE" ? formatVnd(entry.amount) : null}
        </td>
        <td className="px-3 py-2.5">{entry.recordedByName}</td>
        <td className="py-2.5 pl-3 whitespace-nowrap last:pr-0">
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
          className="text-muted-foreground pb-3 text-sm first:pl-0"
          colSpan={7}
        >
          <span className="border-border block border-l-2 pl-3">
            {/* Named, because the block is prose in a table of figures and an
                accountant scanning the column of days needs to know at a glance
                what it is. */}
            <span className="block text-xs tracking-caps uppercase">
              What it was for
            </span>
            <span className="mt-0.5 block whitespace-pre-wrap">
              {entry.note}
            </span>
          </span>

          {correcting ? (
            <div className="mt-3">
              <CorrectEntryForm
                entry={entry}
                drawers={drawers}
                drawersPending={drawersPending}
                drawersFailed={drawersFailed}
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
    return <span className="text-muted-foreground text-sm">Corrected</span>;
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

/**
 * One column heading, pinned to the top of the book's scrollport.
 *
 * The background and the rule are on the cell rather than on the row: a sticky
 * `<thead>` is lifted out of the table's own painting order, so a rule declared
 * on the row is one the headings scroll away from and a row underneath shows
 * through them.
 */
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
        "border-border border-b bg-card px-3 py-2 align-bottom text-xs font-normal tracking-caps text-muted-foreground uppercase first:pl-0 last:pr-0",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}
