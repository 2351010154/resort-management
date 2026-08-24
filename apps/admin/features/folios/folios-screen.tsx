"use client";

import { FOLIO_PAGE_SIZE, formatVnd } from "@mariva/shared";
import { SearchIcon } from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useRef, useState } from "react";

import {
  EmptyState,
  FilterBar,
  KeyHint,
  PageHeader,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { FolioListQuery } from "@/features/dashboard/day-counts";
import type { Folio } from "@/features/departures/departure-queue";
/* The console's one rendering of an instant in the property's zone — the same
 * formatter `folio-ledger.ts` attributes a posting with, so the moment an
 * account was opened and the moment a line was written are read the same way. */
import { formatInstant } from "@/features/guests/guest-record";
import { formatShortDate } from "@/lib/business-date";
import {
  RovingFocusGroup,
  useHotkeys,
  useRovingFocusItem,
} from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  CHARGE_BASIS_LABELS,
  correctionCount,
  DEFAULT_FOLIO_FILTERS,
  FOLIO_STATE_LABELS,
  type FolioFilterFields,
  folioFilters,
  type LedgerLine,
  type ListedFolio,
  ledgerAgrees,
  ledgerLines,
  openingQuery,
  POSTING_LABELS,
  postedLabel,
  standing,
  standingLabel,
} from "./folio-ledger";
import { useFolioLedger, useFolioPage } from "./folios-queries";

/* The property's accounts, and the append-only ledger behind one of them.
 *
 * `docs/screens.md` §"Staff surfaces" states the whole of it: "Folios never
 * hides the ledger: staff always see every posting, reversals paired with what
 * they reversed, under a pinned settled summary. Append-only is the product's
 * integrity story, and the folio screen exists to make corrections reviewable —
 * a net view that hid them would hide the screen's purpose."
 *
 * ## Every line, and the pair that a correction makes
 *
 * A folio is corrected by a reversing entry and never by an edit — `FR-FOL-01`
 * — and the difference between a screen that is *true* to that and a screen that
 * *shows* it is the whole design here. So: the reversal is a row, the line it
 * reversed is still a row above it with its own amount, each one names the
 * other, and a running balance beside them lets a reader watch the account move
 * and come back. `folio-ledger.ts` decides all of that and is specified on its
 * own; this file draws it.
 *
 * The same argument decides what §5's three lines look like. A sale, its 5%
 * service charge and its VAT are three postings, and they are drawn as three
 * rows with the two components stepped in under the charge they were levied on.
 * The guest was quoted one gross figure; the account shows what it was made of.
 *
 * ## Nothing here writes
 *
 * There is no control on this screen that posts, reverses, refunds or closes.
 * That is not an omission to fill in later: `screens.md` puts settlement inside
 * the checkout sequence and refunds on the payment row, each behind its own
 * capability, and a delete or an edit is not offered anywhere in the product
 * because the ledger has no such operation to offer. A screen whose purpose is
 * to make corrections reviewable is the wrong place to make one from.
 *
 * ## The list
 *
 * `GET /folios` and its own filters — state, balance and the trading days the
 * account had lines on — asked on submit, the way Bookings and Guests ask
 * theirs. It is a real collection with a page and a total behind it rather than
 * a capped search, so there is a pager, and the count under it is the API's own
 * figure for the whole set.
 *
 * The row is thin because the answer is: an account carries its id, its stay,
 * its state and its three figures, and nothing in the contract attaches a guest
 * or a reference to it. The screen says so rather than implying the property has
 * accounts belonging to nobody.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the first filter, as it does on Bookings and Guests. The
 * list of accounts is **one Tab stop** with the arrows moving inside it — a
 * {@link RovingFocusGroup} — and the ledger follows it in the document, so Tab
 * from an account falls into its ledger rather than into the next account.
 *
 * `g f` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** Operational surfaces carry no entrance motion, and every
 * control answers the press immediately: the filters paint their own pending
 * line and the pager disables in place.
 */

/** What the screen is currently asking the collection for. */
interface Asked {
  readonly query: FolioListQuery;
  /** The filters that query was built from — what the pager re-builds against,
   *  so paging asks the question that was submitted rather than whatever has
   *  been typed into the form since. */
  readonly fields: FolioFilterFields;
  readonly offset: number;
}

export function FoliosScreen() {
  const [fields, setFields] = useState<FolioFilterFields>(
    DEFAULT_FOLIO_FILTERS,
  );
  const [asked, setAsked] = useState<Asked>(() => ({
    query: openingQuery(),
    fields: DEFAULT_FOLIO_FILTERS,
    offset: 0,
  }));
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<ListedFolio | null>(null);

  const { businessDate, page } = useFolioPage(
    asked.query,
    asked.offset,
    FOLIO_PAGE_SIZE,
  );
  const firstFilter = useRef<HTMLSelectElement>(null);

  useHotkeys("/", () => {
    firstFilter.current?.focus();
  });

  /* One path for every change of question, because they are the same act: the
   * filters and the page are both parts of one query, and a screen that built
   * it in two places would eventually build it two ways. */
  function ask(next: FolioFilterFields, offset: number) {
    const attempt = folioFilters(next, businessDate, offset);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setAsked({ query: attempt.input, fields: next, offset });
    // The ledger open beside the list is closed by a new question. The account
    // it belongs to may not be in the answer that is coming, and a ledger
    // standing beside a list that no longer contains its account reads as a row
    // the operator has lost track of.
    setOpened(null);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Folios"
        description="Append-only guest accounts with every charge, payment, and correction."
      />

      <FilterBar
        className="mt-6"
        actions={
          <Button type="submit">
            <SearchIcon aria-hidden="true" />
            Show accounts
          </Button>
        }
        onSubmit={(event) => {
          event.preventDefault();
          ask(fields, 0);
        }}
      >
        <Choice
          label="Balance"
          value={fields.balance}
          selectRef={firstFilter}
          options={[
            { value: "OUTSTANDING", label: "Does not balance" },
            { value: "ANY", label: "Any balance" },
          ]}
          onChange={(balance) => {
            setFields((current) => ({ ...current, balance }));
          }}
        />
        <Choice
          label="State"
          value={fields.state}
          options={[
            { value: "ANY", label: "Open and closed" },
            { value: "OPEN", label: FOLIO_STATE_LABELS.OPEN },
            { value: "CLOSED", label: FOLIO_STATE_LABELS.CLOSED },
          ]}
          onChange={(state) => {
            setFields((current) => ({ ...current, state }));
          }}
        />
        <Field
          label="From"
          value={fields.from}
          placeholder="-7d"
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
      </FilterBar>

      {problem === null ? null : (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}

      <p className="mt-3 text-sm text-muted-foreground">
        <KeyHint>/</KeyHint> focuses filters. Balances always cover the full
        account.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="min-h-72 p-3">
          {page.status === "pending" ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : null}

          {page.status === "failed" ? (
            // The console's error device is a rule on the leading edge rather
            // than a colour: --color-destructive and --color-primary are the
            // same umber.
            <p
              className="border-danger border-l-2 pl-3 text-sm text-danger"
              role="alert"
            >
              Folios could not be loaded.
            </p>
          ) : null}

          {page.status === "ready" && page.folios.length === 0 ? (
            <EmptyState
              title="No matching folios"
              description={
                asked.fields.balance === "OUTSTANDING"
                  ? "Every account in this window balances."
                  : "Folios open when a stay checks in."
              }
              className="px-4 py-10 shadow-none"
            />
          ) : null}

          {page.status === "ready" && page.folios.length > 0 ? (
            <>
              <RovingFocusGroup aria-label="Accounts">
                <ul>
                  {page.folios.map((folio) => (
                    <FolioRow
                      key={folio.id}
                      folio={folio}
                      opened={folio.id === opened?.id}
                      onOpen={() => {
                        setOpened(folio);
                      }}
                    />
                  ))}
                </ul>
              </RovingFocusGroup>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-border border-t px-2 pt-3">
                <p className="text-muted-foreground text-sm">
                  {page.window.first}–{page.window.last} of {page.window.total}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!page.window.hasPrevious}
                  onClick={() => {
                    ask(asked.fields, page.window.previousOffset);
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!page.window.hasNext}
                  onClick={() => {
                    ask(asked.fields, page.window.nextOffset);
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          ) : null}
        </Card>

        {opened === null ? (
          <EmptyState
            title="Choose a folio"
            description="Select an account to read its complete ledger."
          />
        ) : (
          /* Keyed by the stay, so opening another account takes the whole of
             the previous ledger with it rather than repainting one folio's
             lines under another folio's balance while the read is in flight. */
          <FolioDetail key={opened.bookingId} account={opened} />
        )}
      </div>
    </div>
  );
}

/** One account in the list — what it is, and what it comes to. */
function FolioRow({
  folio,
  opened,
  onOpen,
}: {
  folio: ListedFolio;
  opened: boolean;
  onOpen(): void;
}) {
  const roving = useRovingFocusItem(folio.id);
  const short = standing(folio.summary) !== "SETTLED";

  return (
    <li>
      <button
        {...roving}
        type="button"
        // The opened account, for a screen reader as well as for the shading.
        // The ledger beside the list is what this state selects, so it is
        // "current" rather than "checked".
        aria-current={opened}
        onClick={onOpen}
        className={cn(
          "flex min-h-16 w-full flex-col justify-center gap-0.5 rounded-md px-3 text-left text-sm transition-colors duration-150 ease-ui hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60",
          opened ? "bg-accent-soft" : null,
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          {/* The account is addressed by its stay and carries no reference and
              no guest name — `listedFolioSchema` has neither — so what the row
              can honestly say is when it was opened and how it stands.
              The instant crosses into the property's zone rather than being
              sliced out of the ISO text: an account opened at 21:00 in Ho Chi
              Minh City is a UTC timestamp on the day before. */}
          <span className="font-semibold">
            Opened {formatInstant(folio.openedAt)}
          </span>
          <span className="text-muted-foreground text-sm">
            {FOLIO_STATE_LABELS[folio.state]}
          </span>
        </span>
        <span
          className={cn(
            "tabular-nums text-sm",
            short ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {standingLabel(folio.summary)}
        </span>
      </button>
    </li>
  );
}

/** One account's ledger: the summary it comes to, then every line of it. */
function FolioDetail({ account }: { account: ListedFolio }) {
  const ledger = useFolioLedger(account.bookingId);
  const folio = ledger.data;

  // Memoized on the answer rather than recomputed per render: the ordering and
  // the pairing are real work over every posting, and a long stay's ledger is
  // re-read on every window focus.
  const lines = useMemo(
    () => (folio === undefined ? [] : ledgerLines(folio.postings)),
    [folio],
  );

  return (
    <Card className="overflow-hidden p-5">
      {ledger.isPending ? (
        <p className="text-muted-foreground text-sm" aria-busy>
          Reading the account.
        </p>
      ) : null}

      {ledger.isError ? (
        <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
          The ledger could not be read. The figures in the list are the last
          thing this screen was told about this account.
        </p>
      ) : null}

      {folio === undefined ? null : (
        <>
          {/* Pinned, which is `screens.md`'s word: a ledger is read by scrolling
              down it, and the figures it is being checked against have to stay
              where the reader can see them. */}
          <div className="sticky top-14 z-10 bg-card pb-3">
            <h2 className="text-2xl font-semibold leading-8">
              {FOLIO_STATE_LABELS[folio.state]} account
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {/* When it opened, when it was agreed, and the stay it belongs
                  to. The stay is a uuid because that is the whole of what the
                  contract attaches to an account — there is no reference and no
                  guest name on either the row or the ledger — and it is printed
                  rather than hidden because it is what somebody raising a
                  question about this account has to quote. */}
              Opened {formatInstant(folio.openedAt)}
              {folio.closedAt === null
                ? null
                : ` · agreed ${formatInstant(folio.closedAt)}`}{" "}
              · stay <span className="tabular-nums">{folio.bookingId}</span>
            </p>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
              <Fact label="Charged" value={formatVnd(folio.summary.charged)} />
              <Fact label="Paid" value={formatVnd(folio.summary.credited)} />
              <Fact
                label="Balance"
                value={standingLabel(folio.summary)}
                loud={standing(folio.summary) !== "SETTLED"}
              />
            </dl>
          </div>

          <LedgerNotice folio={folio} lines={lines} />

          <table className="mt-2 w-full border-collapse text-sm">
            <caption className="text-muted-foreground mb-2 text-left text-sm">
              Every posting on the account, oldest first. A correction is a line
              of its own and the line it corrects is still here, with the amount
              it was written for.
            </caption>
            <thead>
              <tr className="border-border border-b">
                <Column>Day</Column>
                <Column>Line</Column>
                <Column align="right">Amount</Column>
                <Column align="right">Balance</Column>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td className="text-muted-foreground py-2" colSpan={4}>
                    Nothing has been posted to this stay yet.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <LedgerRow key={line.posting.id} line={line} />
                ))
              )}
            </tbody>
          </table>

          <p className="text-muted-foreground mt-4 text-sm">
            {/* Said rather than implied: an operator looking for a correction
                control here is owed the reason there is none, and the reason is
                that reviewing is this screen's whole job. */}
            This screen reads. Posting a charge, reversing one, refunding and
            agreeing the account are the checkout sequence's and the Payments
            family's, each behind its own permission — and no screen anywhere
            edits or deletes a posting, because the ledger has no such act.
          </p>
        </>
      )}
    </Card>
  );
}

/** What is worth saying about the ledger before it is read line by line. */
function LedgerNotice({
  folio,
  lines,
}: {
  folio: Folio;
  lines: readonly LedgerLine[];
}) {
  const corrections = correctionCount(folio.postings);

  return (
    <>
      {ledgerAgrees(lines, folio.summary) ? null : (
        // Two derivations of one figure disagreeing is not something to paint
        // over. `folio-ledger.ts` says why this is worth a rule down the side.
        <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
          These lines do not come to the balance above them. Something has been
          lost between the account and this screen — check the folio against the
          API before acting on either figure.
        </p>
      )}

      {corrections > 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {corrections === 1
            ? "One correction stands on this account."
            : `${corrections} corrections stand on this account.`}{" "}
          Each is an entry of its own, paired below with the line it reverses.
          Nothing was removed to make them.
        </p>
      ) : null}
    </>
  );
}

/** One posting, with whatever it is paired to. */
function LedgerRow({ line }: { line: LedgerLine }) {
  const { posting, levied, reverses, reversedBy } = line;

  return (
    <tr className="border-border border-b align-top">
      <td className="text-muted-foreground py-1 pr-3 whitespace-nowrap first:pl-0">
        {formatShortDate(posting.businessDate)}
      </td>
      <td className={cn("px-3 py-1", levied ? "pl-6" : null)}>
        <span>{POSTING_LABELS[posting.type]}</span>
        {levied ? (
          <span className="text-muted-foreground text-sm">
            {" "}
            · levied on the charge above
          </span>
        ) : null}
        <p className="text-muted-foreground">{posting.description}</p>

        {posting.chargeBasis === null ? null : (
          <p className="text-muted-foreground text-sm">
            {CHARGE_BASIS_LABELS[posting.chargeBasis]}
          </p>
        )}

        {reverses === null ? null : (
          <p className="text-sm">
            Reverses the {POSTING_LABELS[reverses.type].toLowerCase()} of{" "}
            {formatShortDate(reverses.businessDate)} —{" "}
            {formatVnd(reverses.amount)}. That line stays on the account.
          </p>
        )}

        {reversedBy === null ? null : (
          <p className="text-sm">
            Reversed by a correction of{" "}
            {formatShortDate(reversedBy.businessDate)}. This line keeps the
            amount it was written for.
          </p>
        )}

        <p className="text-muted-foreground text-sm">{postedLabel(posting)}</p>
      </td>
      <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
        {formatVnd(posting.amount)}
      </td>
      <td className="text-muted-foreground py-1 pl-3 text-right tabular-nums whitespace-nowrap last:pr-0">
        {formatVnd(line.runningTotal)}
      </td>
    </tr>
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

/** One typed field, labelled. */
function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
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
 * One of a closed set, as a native `<select>` — the same control the new-booking
 * form uses and for the same reason: two and three members are an enum the
 * browser already gives arrows, type-ahead and a native mobile picker.
 */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  selectRef,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  // The cast below is the one the DOM obliges: `event.target.value` is a
  // string, and what constrains it to the set is that the `<option>`s are drawn
  // from that set and nothing else.
  onChange(value: T): void;
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  const fieldId = useId();

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-sm  uppercase"
      >
        {label}
      </label>
      <select
        id={fieldId}
        ref={selectRef}
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

function Fact({
  label,
  value,
  loud = false,
}: {
  label: string;
  value: string;
  loud?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm  uppercase">{label}</dt>
      <dd className={cn("tabular-nums", loud ? "text-destructive" : null)}>
        {value}
      </dd>
    </div>
  );
}
