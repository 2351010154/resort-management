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
  Pager,
  StatusChip,
  type StatusTone,
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
  type FolioState,
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
 * rows with the two components stepped in under the charge they were levied on —
 * behind a rule, so the relation is a thing the eye finds rather than a sentence
 * the reader has to notice. One row is four facts stacked in one cell, so they
 * are set at three weights: what kind of line it is, then what it was for, then
 * who wrote it and when. Flat, the money column competed with the audit trail.
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
 * **An account is addressed by its stay, and by nothing else.**
 * `listedFolioSchema` carries an id, a stay, a state, two instants and three
 * figures — there is no booking reference on it and no guest name, and no route
 * on the contract turns a stay's uuid into either. So the row leads with the
 * stay: {@link stayShorthand} of it, which is the one field that differs between
 * two accounts opened in the same minute, and the ledger beside the list prints
 * the whole uuid because that is what somebody raising a question about the
 * account has to quote. The screen says all of this in a line under the filters
 * rather than implying the property has accounts belonging to nobody.
 *
 * ## Two panels, each scrolling inside itself
 *
 * Both are bounded and both stay put while the other is worked, which is what
 * "a pinned settled summary" costs to actually keep. A page of fifty accounts is
 * three times the height of the window, so a rail that grew with its list would
 * put the account being read off the top of the screen by the time the operator
 * reached the row at the bottom of it; and a ledger that ran the page down took
 * the three figures it is being checked against with it. The account's summary
 * is the detail card's own head, above its scrollport rather than sticky inside
 * it, and the ledger's column headings pin to the top of that scrollport — so
 * `AMOUNT` and `BALANCE` still name the columns forty lines down.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the first filter, as it does on Bookings and Guests. The
 * list of accounts is **one Tab stop** with the arrows moving inside it — a
 * {@link RovingFocusGroup} — and the ledger follows it in the document, so Tab
 * from an account falls into its ledger rather than into the next account. The
 * group is the rail's scrollport, and the negative margin with the padding that
 * cancels it is what keeps a focused row's ring from being clipped by that
 * scrollport's edge.
 *
 * `g f` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** Operational surfaces carry no entrance motion, and every
 * control answers the press immediately: the filters paint their own pending
 * line and the pager refuses a second press in place.
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

      {/* What the keys do, in the chips the shell and the palette use, and then
          the two things a reader has to know before they believe a figure or go
          looking for a guest's name on a row. The second is said out loud
          because the contract's answer to "whose account is this?" is a uuid,
          and a screen that only showed one would read as a lookup that failed. */}
      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <KeyHint>/</KeyHint>
          focuses the filters
        </span>
        <span>Balances always cover the full account.</span>
        <span>
          An account is addressed by its stay: the contract attaches no booking
          reference and no guest name to one.
        </span>
      </p>

      {/* `items-start`, so each panel is as tall as it is rather than as tall as
          the taller one — which is also what lets either of them be sticky. */}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Bounded, and sticky beside the ledger rather than as long as the
            page. `top-18` is the shift bar's own height plus a gap: the bar is
            a translucent strip pinned at the top of every screen, and a panel
            that stopped under it would have its first row read through the
            blur. `overflow-hidden` is the containment — a chip or a tinted row
            is drawn inside the rounded card or not at all. */}
        <Card className="flex max-h-[70svh] min-h-72 flex-col gap-3 overflow-hidden p-3 lg:sticky lg:top-18 lg:max-h-[calc(100svh_-_5.5rem)] lg:self-start">
          {page.status === "pending" ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-18" />
              <Skeleton className="h-18" />
              <Skeleton className="h-18" />
            </div>
          ) : null}

          {page.status === "failed" ? (
            // The console's error device is a rule on the leading edge as much
            // as the colour: --color-danger is a warm red-brown a shade off the
            // umber every other line on the screen is set in, and a sentence
            // that differed only in that would be read as ordinary copy.
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
              {/* The list is the scrollport, and the negative margin with the
                  padding that cancels it is the focus ring's gutter: a
                  scrollport clips whatever hangs over its edge, and the
                  console's outline is 3px drawn 2px outside the row. `min-h-0`
                  is what makes it scroll rather than grow — a flex item's
                  automatic minimum is its content, so without it the rail would
                  be fifty rows tall and the card's max-height would decide
                  nothing. */}
              <RovingFocusGroup
                aria-label="Accounts"
                className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5"
              >
                <ul className="space-y-1">
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

              {/* How much list there is and what moves through it, then the two
                  presses that reach the rest of it. A rail that ends mid-row has
                  said "there is more below" only to somebody who already knew. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-border border-t px-1.5 pt-3 text-sm text-muted-foreground">
                <p>
                  {page.window.first}–{page.window.last} of {page.window.total}
                </p>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <KeyHint>↑</KeyHint>
                  <KeyHint>↓</KeyHint>
                  move
                </span>
                <div className="flex w-full flex-wrap items-center gap-2">
                  <Pager
                    label="Previous"
                    offered={page.window.hasPrevious}
                    onPage={() => {
                      ask(asked.fields, page.window.previousOffset);
                    }}
                  />
                  <Pager
                    label="Next"
                    offered={page.window.hasNext}
                    onPage={() => {
                      ask(asked.fields, page.window.nextOffset);
                    }}
                  />
                </div>
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

/**
 * The stay, cut to the block a reader can hold in their eye.
 *
 * Eight hex characters of the account's own uuid and an ellipsis that says so.
 * Not a booking reference dressed up as one — there is no reference on this
 * route to print — and never the only place the stay appears: the ledger beside
 * the list prints the whole of it, and the row carries it as a title for the
 * pointer, so an abbreviation is always one hover or one press from the value it
 * abbreviates.
 */
function stayShorthand(bookingId: string): string {
  return `${bookingId.slice(0, 8)}…`;
}

/**
 * The colour an account's state is drawn in.
 *
 * One place rather than two, because the row and the ledger's head say the same
 * word about the same account and a chip that was grey in the list and green
 * beside it would be the screen disagreeing with itself. Closed is the settled
 * end of the account's life and reads as one; open is the ordinary state and
 * claims no colour, because what an operator is chasing on this screen is the
 * figure under it and not the fact that the stay is still running.
 */
function stateTone(state: FolioState): StatusTone {
  return state === "CLOSED" ? "success" : "neutral";
}

/** One account in the list — which stay it belongs to, and what it comes to. */
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
        // The whole stay, for the pointer, because the row shows eight
        // characters of it. Not a substitute for the ledger's own printing of
        // it: a tooltip is unreachable from the keyboard.
        title={folio.bookingId}
        onClick={onOpen}
        // Three states and not one value for all of them, the arrangement the
        // desk queues use: hover is the lightest because a pointer passing over
        // a row has decided nothing, while focus and the opened account are the
        // full tint because those are where the operator actually is.
        className={cn(
          "flex min-h-16 w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ease-ui hover:bg-accent-soft/50 focus-visible:bg-accent-soft",
          opened ? "bg-accent-soft" : null,
        )}
      >
        {/* The chip follows the stay rather than being pushed to the far edge.
            Pushed, its left edge moved with the length of its own word — a
            ragged column of states — and below the two-pane breakpoint, where
            the rail is the width of the window, it ended up half a screen away
            from the account it describes. */}
        <span className="flex w-full items-center gap-2">
          {/* The stay leads, because it is the only thing on the contract that
              tells two accounts apart: two folios opened in the same minute are
              the same row otherwise, and the property opens them in batches at
              check-in. */}
          <span className="min-w-0 truncate tabular-nums">
            <span className="text-muted-foreground">Stay </span>
            <span className="font-semibold">
              {stayShorthand(folio.bookingId)}
            </span>
          </span>
          <StatusChip className="shrink-0" tone={stateTone(folio.state)}>
            {FOLIO_STATE_LABELS[folio.state]}
          </StatusChip>
        </span>
        {/* The figure the desk acts on, at the weight it is acted on. */}
        <span
          className={cn(
            "tabular-nums",
            short ? "font-semibold text-danger" : "text-muted-foreground",
          )}
        >
          {standingLabel(folio.summary)}
        </span>
        {/* When it opened, under the two facts that identify and rank it. The
            instant crosses into the property's zone rather than being sliced out
            of the ISO text: an account opened at 21:00 in Ho Chi Minh City is a
            UTC timestamp on the day before. */}
        <span className="text-xs text-muted-foreground">
          Opened {formatInstant(folio.openedAt)}
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
    <Card className="flex max-h-[80svh] flex-col overflow-hidden lg:sticky lg:top-18 lg:max-h-[calc(100svh_-_5.5rem)] lg:self-start">
      {ledger.isPending ? (
        // In the shape the panel itself arrives in — a head and a run of lines —
        // so nothing moves under the reader when the account answers.
        <div className="space-y-3 p-5" aria-busy>
          <Skeleton className="h-7 w-3/4 max-w-96" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {ledger.isError ? (
        <p
          className="m-5 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The ledger could not be read. The figures in the list are the last
          thing this screen was told about this account.
        </p>
      ) : null}

      {folio === undefined ? null : (
        <>
          {/* Pinned, which is `screens.md`'s word: a ledger is read by scrolling
              down it, and the figures it is being checked against have to stay
              where the reader can see them. The card's own head rather than a
              `sticky` block inside it — a sticky element belongs to the nearest
              scrolling ancestor, and inside an `overflow-hidden` card that
              ancestor is one that never scrolls, so the summary simply left with
              the page and the column headings went under the shift bar. */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-border border-b p-5">
            <div className="min-w-0">
              <span className="block text-xs tracking-caps text-muted-foreground uppercase">
                Stay
              </span>
              {/* The uuid, whole, as the account's name. It is what the contract
                  attaches to a folio and the whole of what it attaches — there
                  is no reference and no guest name on either the row or the
                  ledger — and it is printed rather than abbreviated here because
                  it is what somebody raising a question about this account has
                  to quote. The state is the chip beside it: "Open account" as a
                  heading was a state being used as a name. */}
              <h2 className="text-xl font-semibold leading-7 tabular-nums break-all">
                {folio.bookingId}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Opened {formatInstant(folio.openedAt)}
                {folio.closedAt === null
                  ? null
                  : ` · agreed ${formatInstant(folio.closedAt)}`}
              </p>
            </div>
            <StatusChip className="shrink-0" tone={stateTone(folio.state)}>
              {FOLIO_STATE_LABELS[folio.state]}
            </StatusChip>
            <dl className="grid w-full gap-3 text-sm sm:grid-cols-3">
              <Fact label="Charged" value={formatVnd(folio.summary.charged)} />
              <Fact label="Paid" value={formatVnd(folio.summary.credited)} />
              <Fact
                label="Balance"
                value={standingLabel(folio.summary)}
                loud={standing(folio.summary) !== "SETTLED"}
              />
            </dl>
          </div>

          {/* The ledger is what scrolls, so the summary above it and the note
              below it are both always on screen. `min-h-0` is what makes it
              scroll rather than grow. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <LedgerNotice folio={folio} lines={lines} />

            <table className="mt-3 w-full border-collapse text-sm">
              {/* The same sentence the notice above draws, for a reader who
                  arrives at the table without it. Not drawn twice. */}
              <caption className="sr-only">
                Every posting on the account, oldest first. A correction is a
                line of its own and the line it corrects is still here, with the
                amount it was written for.
              </caption>
              <thead className="sticky top-0 z-10">
                <tr>
                  <Column>Day</Column>
                  <Column>Line</Column>
                  <Column align="right">Amount</Column>
                  <Column align="right">Balance</Column>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td className="py-6 text-muted-foreground" colSpan={4}>
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
          </div>

          <p className="border-border border-t px-5 py-3 text-sm text-muted-foreground">
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
        // over, and not something to leave for a reader to notice either.
        // `folio-ledger.ts` says why this is worth a rule down the side.
        <p
          className="mt-4 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          These lines do not come to the balance above them. Something has been
          lost between the account and this screen — check the folio against the
          API before acting on either figure.
        </p>
      )}

      {/* One sentence and not two. The ordering is true of every account and the
          corrections are true of some, so the count joins the sentence that was
          going to be said anyway rather than repeating it underneath. */}
      <p className="pt-4 text-sm text-muted-foreground">
        Every posting, oldest first.{" "}
        {corrections === 0
          ? "Nothing on this account has been corrected."
          : `${
              corrections === 1
                ? "One correction stands"
                : `${corrections} corrections stand`
            } on this account, each paired below with the line it reverses. Nothing was removed to make them.`}
      </p>
    </>
  );
}

/** One posting, with whatever it is paired to. */
function LedgerRow({ line }: { line: LedgerLine }) {
  const { posting, levied, reverses, reversedBy } = line;

  return (
    <tr className="border-border border-b align-top">
      <td className="py-2.5 pr-3 text-xs whitespace-nowrap text-muted-foreground first:pl-0">
        {formatShortDate(posting.businessDate)}
      </td>
      <td className="px-3 py-2.5">
        {/* The rule is §5's relation drawn rather than only stated: a service
            charge and a VAT belong to the sale above them, and an indent alone
            is a claim the eye has to measure. */}
        <div
          className={cn(levied ? "ml-3 border-border border-l-2 pl-3" : null)}
        >
          <p className="font-semibold">
            {POSTING_LABELS[posting.type]}
            {levied ? (
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                · levied on the charge above
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground">{posting.description}</p>

          {posting.chargeBasis === null ? null : (
            <p className="text-muted-foreground">
              {CHARGE_BASIS_LABELS[posting.chargeBasis]}
            </p>
          )}

          {/* Both ends of a correction in the console's marker colour, which is
              what makes the pair findable in a column of grey provenance lines.
              Amber is the console's mark and `--console-accent-strong` is the
              value of it that carries text contrast. */}
          {reverses === null ? null : (
            <p className="mt-1 text-accent-strong">
              Reverses the {POSTING_LABELS[reverses.type].toLowerCase()} of{" "}
              {formatShortDate(reverses.businessDate)} —{" "}
              {formatVnd(reverses.amount)}. That line stays on the account.
            </p>
          )}

          {reversedBy === null ? null : (
            <p className="mt-1 text-accent-strong">
              Reversed by a correction of{" "}
              {formatShortDate(reversedBy.businessDate)}. This line keeps the
              amount it was written for.
            </p>
          )}

          {/* Who wrote it and when, at the bottom of the tier: it is the audit
              trail rather than the transaction, and set level with the
              description it competed with the money beside it. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {postedLabel(posting)}
          </p>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">
        {formatVnd(posting.amount)}
      </td>
      <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap text-muted-foreground last:pr-0">
        {formatVnd(line.runningTotal)}
      </td>
    </tr>
  );
}

/**
 * One column heading, pinned to the top of the ledger's scrollport.
 *
 * The background and the rule are on the cell rather than on the row: a sticky
 * `<thead>` is lifted out of the table's own painting order, and a border
 * declared on the row it leaves behind is a rule the headings scroll away from.
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
        "border-border border-b bg-card px-3 py-2 text-xs font-normal tracking-caps text-muted-foreground uppercase first:pl-0 last:pr-0",
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
        className="text-muted-foreground block text-xs tracking-caps uppercase"
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
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      {/* The boxes' own height, so the filter row sits on one line: the two
          selects and the two inputs are one control each in the same bar. */}
      <select
        id={fieldId}
        ref={selectRef}
        className="border-input mt-1 h-11 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
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
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 tabular-nums",
          loud ? "font-semibold text-danger" : null,
        )}
      >
        {value}
      </dd>
    </div>
  );
}
