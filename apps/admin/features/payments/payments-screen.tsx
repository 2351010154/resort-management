"use client";

import { formatVnd, type StaffRole } from "@mariva/shared";
import { SearchIcon } from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useRef, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  FilterBar,
  KeyHint,
  PageHeader,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
/* The console's one rendering of an instant in the property's zone — the same
 * formatter a folio attributes a posting with, so the moment a gateway says
 * money moved and the moment the ledger says it was posted are read the same
 * way. */
import { formatInstant } from "@/features/guests/guest-record";
import { useStaffSession } from "@/lib/auth";
import { formatLongDate, formatShortDate } from "@/lib/business-date";
import { useHotkeys } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  DEFAULT_PAYMENT_FILTERS,
  DISCREPANCY_LABELS,
  type DiscrepancyEntry,
  discrepancyEntries,
  type ListedPayment,
  METHOD_LABELS,
  mayReconcile,
  type NightReading,
  openingQuestion,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentFilterFields,
  type PaymentQuestion,
  type PaymentRow,
  paidLabel,
  paymentFilters,
  paymentRows,
  type ReconciledNight,
  type ReconciliationRun,
  reportedAmount,
  STATUS_LABELS,
  tradingDayLabel,
} from "./payment-day";
import {
  type PageReading,
  useBusinessDate,
  usePaymentDay,
} from "./payments-queries";

/* The property's money, and the night somebody held it against the gateway's
 * own report.
 *
 * `docs/screens.md` §"Staff surfaces" states the shape: "Payments is organised
 * around the reconciliation day: it opens on today's gateway transactions
 * matched against ledger postings, discrepancies first, yesterday's
 * reconciliation status in view."
 *
 * ## One day, read twice
 *
 * The two halves of this screen are two answers about the same trading day. The
 * table is what the property was paid, as the payer's side reported it; the
 * column beside it is what the sweep found when it held that report against the
 * ledger. `payment-day.ts` derives the day once for both, because a list of one
 * day's payments beside another day's comparison would draw disagreements next
 * to rows they are not about — which is worse than drawing neither.
 *
 * Today's own night will ordinarily not have been compared yet: the sweep runs
 * after a trading day closes. That is said in the panel rather than drawn as a
 * failure, and the nights that *have* been compared sit above the table, each
 * one press from being the day on screen.
 *
 * ## A disagreement is never restated here
 *
 * A payment row carries a disagreement's id and none of its money.
 * `contract/payment.ts` is explicit about why: the two amounts, the
 * classification and the instant belong to the reconciliation read, and a second
 * copy of them beside a payment would be a row that could disagree with the
 * night it came from. So a row says *that* it is disputed and leads to the
 * figures — to the entry beside it when the night on screen is the one that
 * filed it, and to that payment's own trading day when it is not.
 *
 * The panel is the other direction of the same join: a disagreement says whether
 * the payment it names is one of the rows in the table. `MISSING_LOCALLY` never
 * is, and cannot be — it names money the gateway reported and this property has
 * no payment row for, which is exactly the case a table of payments can never
 * show.
 *
 * ## Nothing here writes
 *
 * There is no control on this screen that refunds, reverses, re-runs a night or
 * marks a disagreement resolved. That is not an omission to fill in later:
 * `rbac-matrix.md` puts refunds on the folio routes and a re-run under the
 * sweep's own capability, and `schema/reconciliation.ts` makes a discrepancy
 * append-only because it is an observation of what a night looked like when it
 * was looked at. There is no route to acknowledge one, because acknowledging an
 * observation is not a thing the record allows.
 *
 * ## Who sees it
 *
 * Every read here is governed by one key — *Gateway reconciliation*, which the
 * matrix grants the accountant, the manager and the admin. The rail offers this
 * family to the receptionist too, because a refund is money work and the desk
 * does money work; so a desk operator is given the sentence saying where their
 * money work happens rather than a screen that would answer 403 three times
 * over. The same arrangement `features/guests` uses for the reveal control.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the day, as it does on the search of every other screen.
 * The table is read rather than worked, so it is not a roving group: the only
 * things that answer a press are the filters, the pager, the nights above the
 * table and the link on a disputed row — and that link is an anchor, so it moves
 * the caret to the figures it names rather than merely scrolling them into view.
 *
 * `g p` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** Operational surfaces carry no entrance motion, and every
 * control answers the press immediately: the filters paint their own pending
 * line, the pager disables in place, and the jump to a disagreement is the
 * browser's own.
 */

/* One empty page, shared by every render that has none. A fresh `[]` in a
 * ternary is a new array every render, and both the join below and the panel's
 * own entries are memoized on the payments they were given — so the literal
 * would rebuild both on every keystroke in the filters. */
const NO_PAYMENTS: readonly ListedPayment[] = [];

/** What the screen is currently asking both routes for. */
interface Asked {
  readonly question: PaymentQuestion;
  /** The filters that question was built from — what the pager re-builds
   *  against, so paging asks the question that was submitted rather than
   *  whatever has been typed into the form since. */
  readonly fields: PaymentFilterFields;
  readonly offset: number;
}

export function PaymentsScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<PaymentFilterFields>(
    DEFAULT_PAYMENT_FILTERS,
  );
  // Null until the first question is submitted. The opening one is derived from
  // the property's day below rather than held here, because "today" has no
  // answer until the API has said what today is.
  const [asked, setAsked] = useState<Asked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [marked, setMarked] = useState<string | null>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;
  const offered = role !== null && mayReconcile(role);

  const dayField = useRef<HTMLInputElement>(null);

  useHotkeys("/", () => {
    dayField.current?.focus();
    dayField.current?.select();
  });

  // The day is read first so the opening question can be built from it in the
  // same render it arrives, with no effect synchronising two pieces of state
  // that are one fact.
  const propertyDay = useBusinessDate();
  const businessDate = propertyDay.data?.businessDate ?? null;
  const opening = useMemo(
    () => (offered ? openingQuestion(businessDate) : null),
    [offered, businessDate],
  );
  const question = asked?.question ?? opening;
  const offset = asked?.offset ?? 0;

  const { page, night, nights } = usePaymentDay(question, offset, offered);

  /* One path for every change of question, because they are the same act: the
   * filters, the day pressed above the table and the page are all parts of one
   * query, and a screen that built it in two places would eventually build it
   * two ways. */
  function ask(next: PaymentFilterFields, nextOffset: number) {
    const attempt = paymentFilters(next, businessDate, nextOffset);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setFields(next);
    setAsked({ question: attempt.question, fields: next, offset: nextOffset });
    // A disagreement marked in the panel belongs to the question it was marked
    // under. The answer coming may not contain it, and a mark standing beside a
    // night that no longer holds it reads as a row the operator has lost.
    setMarked(null);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Payments"
        description="Payment history and nightly gateway reconciliation."
      />

      {!offered ? (
        <p className="mt-6 max-w-prose text-sm text-muted-foreground">
          Reconciliation is available to accounting and management. Use Folios
          for a single stay.
        </p>
      ) : propertyDay.isError ? (
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The hotel day could not be read. Payments are unavailable.
        </p>
      ) : (
        <>
          <FilterBar
            className="mt-6"
            actions={
              <Button type="submit">
                <SearchIcon aria-hidden="true" />
                Show payments
              </Button>
            }
            onSubmit={(event) => {
              event.preventDefault();
              ask(fields, 0);
            }}
          >
            <Field
              label="Trading day"
              value={fields.day}
              placeholder="today"
              inputRef={dayField}
              onChange={(day) => {
                setFields((current) => ({ ...current, day }));
              }}
            />
            <Field
              label="Stay"
              value={fields.bookingId}
              placeholder="The id on the stay's folio"
              onChange={(bookingId) => {
                setFields((current) => ({ ...current, bookingId }));
              }}
            />
            <Choice
              label="Method"
              value={fields.method}
              options={[
                { value: "ANY" as const, label: "Every method" },
                ...PAYMENT_METHODS.map((method) => ({
                  value: method,
                  label: METHOD_LABELS[method],
                })),
              ]}
              onChange={(method) => {
                setFields((current) => ({ ...current, method }));
              }}
            />
            <Choice
              label="State"
              value={fields.status}
              options={[
                { value: "ANY" as const, label: "Every state" },
                ...PAYMENT_STATUSES.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                })),
              ]}
              onChange={(status) => {
                setFields((current) => ({ ...current, status }));
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

          <p className="mt-3 text-xs text-muted-foreground">
            <KeyHint>/</KeyHint> focuses the trading day. Clear it to include
            attempts with no trading day.
          </p>

          <ComparedNights
            nights={nights}
            on={question?.day ?? null}
            onPick={(businessDay) => {
              ask({ ...fields, day: businessDay }, 0);
            }}
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <PaymentTable
              page={page}
              night={night}
              marked={marked}
              onMark={setMarked}
              onOpenNight={(businessDay) => {
                ask({ ...fields, day: businessDay }, 0);
              }}
              onPage={(nextOffset) => {
                ask(asked?.fields ?? fields, nextOffset);
              }}
            />

            <NightPanel
              day={question?.day ?? null}
              reading={night}
              payments={page.status === "ready" ? page.payments : NO_PAYMENTS}
              marked={marked}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** The nights already compared, newest first — `screens.md`'s "reconciliation
 *  status in view". */
function ComparedNights({
  nights,
  on,
  onPick,
}: {
  nights: readonly ReconciliationRun[];
  on: string | null;
  onPick(businessDate: string): void;
}) {
  if (nights.length === 0) {
    return null;
  }

  return (
    <nav
      className="mt-6 rounded-lg bg-card p-4 shadow-card"
      aria-label="Nights already compared"
    >
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Compared
      </p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {nights.map((run) => (
          <li key={run.businessDate}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-current={run.businessDate === on}
              className={cn(
                run.businessDate === on ? "bg-accent/60" : null,
                run.discrepancyCount > 0 ? "text-destructive" : null,
              )}
              onClick={() => {
                onPick(run.businessDate);
              }}
            >
              {formatShortDate(run.businessDate)}
              <span className="text-muted-foreground">
                {/* Zero is a good night and is still said. A date with no run
                    and a date whose reports agreed are opposite facts, and only
                    a run tells them apart. */}
                {run.discrepancyCount === 0
                  ? "agreed"
                  : `${run.discrepancyCount} disagreed`}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The page of payments, disagreements first, and the pager under it. */
function PaymentTable({
  page,
  night,
  marked,
  onMark,
  onOpenNight,
  onPage,
}: {
  page: PageReading;
  night: NightReading;
  marked: string | null;
  onMark(discrepancyId: string): void;
  onOpenNight(businessDate: string): void;
  onPage(offset: number): void;
}) {
  const payments = page.status === "ready" ? page.payments : NO_PAYMENTS;
  const observed = night.status === "ready" ? night.night : null;

  // Memoized on the two answers rather than recomputed per render: the join is
  // real work over every row, and the page is re-read on every window focus.
  const rows = useMemo(
    () => paymentRows(payments, observed),
    [payments, observed],
  );

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
        Payments could not be loaded.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No matching payments"
        description="Clear the trading day to include attempts that moved no money."
      />
    );
  }

  return (
    <DataTableFrame className="overflow-x-auto p-4">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
          Every payment the filters matched, with the ones a night disagreed
          about first. The amount is what the payer's side reported and carries
          no sign — which way it moved is the ledger's convention, on the folio.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Column>Day</Column>
            <Column>Payment</Column>
            <Column align="right">Amount</Column>
            <Column>Disagreement</Column>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PaymentRowCells
              key={row.payment.id}
              row={row}
              marked={marked === row.payment.discrepancyId}
              onMark={onMark}
              onOpenNight={onOpenNight}
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
    </DataTableFrame>
  );
}

/** Where one disagreement's figures are read, from the row that names it. */
function entryDomId(discrepancyId: string): string {
  return `disagreement-${discrepancyId}`;
}

/** One payment, and whatever a night said about it. */
function PaymentRowCells({
  row,
  marked,
  onMark,
  onOpenNight,
}: {
  row: PaymentRow;
  marked: boolean;
  onMark(discrepancyId: string): void;
  onOpenNight(businessDate: string): void;
}) {
  const { payment, route } = row;

  return (
    <tr
      className={cn(
        "border-border border-b align-top",
        marked ? "bg-accent/40" : null,
      )}
    >
      <td className="text-muted-foreground py-1 pr-3 whitespace-nowrap first:pl-0">
        {tradingDayLabel(payment)}
      </td>
      <td className="px-3 py-1">
        <span>{METHOD_LABELS[payment.method]}</span>
        <span className="text-muted-foreground text-xs">
          {" "}
          · {STATUS_LABELS[payment.status]}
        </span>
        <p className="text-muted-foreground text-xs">{paidLabel(payment)}</p>
        <p className="text-muted-foreground text-xs">
          {/* The gateway's own id is what an operator matches against a
              merchant screen, and its absence is a fact rather than a gap: cash
              counted at the desk and a bank transfer moved no gateway. */}
          {payment.gatewayTransactionId === null ? (
            "Collected by the property — no gateway id"
          ) : (
            <span className="font-mono">{payment.gatewayTransactionId}</span>
          )}
        </p>
        <p className="text-muted-foreground font-mono text-xs">
          stay {payment.bookingId}
        </p>
      </td>
      <td className="px-3 py-1 text-right font-mono whitespace-nowrap">
        {formatVnd(payment.amount)}
      </td>
      <td className="py-1 pl-3 text-sm last:pr-0">
        <DisagreementCell
          route={route}
          onMark={onMark}
          onOpenNight={onOpenNight}
        />
      </td>
    </tr>
  );
}

/**
 * What a row can honestly say about a disagreement filed against it.
 *
 * Never a figure. The payment carries the observation's id and nothing else, so
 * the cell is the way to the night that holds it — the entry beside this table
 * when the night on screen filed it, and that payment's own trading day when it
 * did not.
 */
function DisagreementCell({
  route,
  onMark,
  onOpenNight,
}: {
  route: PaymentRow["route"];
  onMark(discrepancyId: string): void;
  onOpenNight(businessDate: string): void;
}) {
  switch (route.kind) {
    case "none":
      return null;

    case "in-view":
      return (
        // An anchor rather than a button: the figures are on this page, and the
        // browser's own jump takes the caret to them. A screen reader hears a
        // link to a thing that exists instead of a control with a promise
        // attached.
        <a
          href={`#${entryDomId(route.discrepancyId)}`}
          className="text-destructive underline underline-offset-4"
          onClick={() => {
            onMark(route.discrepancyId);
          }}
        >
          The two reports disagree — read the night
        </a>
      );

    case "other-night":
      return (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-destructive"
          onClick={() => {
            onOpenNight(route.businessDate);
          }}
        >
          Disagreed · read {formatShortDate(route.businessDate)}
        </Button>
      );

    case "undated":
      return (
        <span className="text-destructive">
          Disagreed, and this payment moved no money, so no night holds it.
        </span>
      );
  }
}

/** One night's comparison: when it was made, and everything that disagreed. */
function NightPanel({
  day,
  reading,
  payments,
  marked,
}: {
  day: string | null;
  reading: NightReading;
  payments: readonly ListedPayment[];
  marked: string | null;
}) {
  return (
    <Card className="overflow-hidden p-5">
      {/* Pinned, for the folio ledger's reason: the disagreements are read
          against a table that scrolls, and the thing they are being checked
          against has to stay where the reader can see it. */}
      <div className="sticky top-14 z-10 bg-card pb-3">
        <h2 className="text-2xl font-semibold leading-8">
          {day === null ? "No single night" : formatLongDate(day)}
        </h2>

        {day === null ? (
          <p className="text-muted-foreground mt-1 text-sm">
            These filters span every day the property has been paid on, and a
            comparison is about one night. Name a trading day to read what the
            sweep found on it.
          </p>
        ) : (
          <NightState reading={reading} />
        )}
      </div>

      {reading.status === "ready" && day !== null ? (
        <Disagreements
          night={reading.night}
          payments={payments}
          marked={marked}
        />
      ) : null}
    </Card>
  );
}

/** What is known about the night, before its rows are read. */
function NightState({ reading }: { reading: NightReading }) {
  switch (reading.status) {
    case "pending":
      return (
        <p className="text-muted-foreground mt-1 text-sm" aria-busy>
          Reading the comparison.
        </p>
      );

    case "unswept":
      return (
        // Not a failure, and drawn as none. The sweep holds the two reports
        // against each other after a trading day has closed, so the day in
        // progress has no run — and a date with no run is a different fact from
        // a date whose reports agreed.
        <p className="text-muted-foreground mt-1 text-sm">
          This night has not been compared. The sweep holds the gateway's report
          against the ledger once the property's day has closed, so the day in
          progress has no answer yet.
        </p>
      );

    case "failed":
      return (
        <p className="border-destructive text-destructive mt-1 border-l-2 pl-3 text-sm">
          The comparison could not be read. The payments beside this are still
          the property's own record; what the gateway reported is not on screen.
        </p>
      );

    case "ready":
      return (
        <p className="text-muted-foreground mt-1 text-sm">
          Compared {formatInstant(reading.night.reconciledAt)}.{" "}
          {reading.night.discrepancies.length === 0
            ? "The two reports said the same thing about every payment."
            : reading.night.discrepancies.length === 1
              ? "One payment was described differently by the two reports."
              : `${reading.night.discrepancies.length} payments were described differently by the two reports.`}
        </p>
      );
  }
}

/** Every disagreement the night found, as it was observed. */
function Disagreements({
  night,
  payments,
  marked,
}: {
  night: ReconciledNight;
  payments: readonly ListedPayment[];
  marked: string | null;
}) {
  const entries = useMemo(
    () => discrepancyEntries(night, payments),
    [night, payments],
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <ul className="mt-rhythm-1">
      {entries.map((entry) => (
        <Disagreement
          key={entry.discrepancy.id}
          entry={entry}
          marked={marked === entry.discrepancy.id}
        />
      ))}
    </ul>
  );
}

/** One observation: what disagreed, by how much on each side, and when. */
function Disagreement({
  entry,
  marked,
}: {
  entry: DiscrepancyEntry;
  marked: boolean;
}) {
  const { discrepancy, onScreen } = entry;

  return (
    <li
      // The target of the link on the row that names it. `tabIndex` of −1 makes
      // it a place the caret can land without making it a Tab stop, so the jump
      // moves focus to the figures rather than leaving a reader at the top of
      // the document.
      id={entryDomId(discrepancy.id)}
      tabIndex={-1}
      aria-current={marked}
      className={cn(
        "border-border border-b py-2 last:border-b-0",
        marked ? "bg-accent/40" : null,
      )}
    >
      <p className="font-mono text-xs">{discrepancy.attemptReference}</p>
      <p className="text-destructive mt-1 text-sm">
        {DISCREPANCY_LABELS[discrepancy.kind]}
      </p>

      <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
        <Fact
          label="Gateway"
          value={reportedAmount(discrepancy.gatewayAmount)}
        />
        <Fact label="Ledger" value={reportedAmount(discrepancy.ledgerAmount)} />
      </dl>

      <p className="text-muted-foreground mt-1 text-xs">
        {/* When the two reports were held against each other, and not the
            trading day: a gap found at 04:05 the next morning and one found six
            days late are different answers to how long it stood. */}
        Observed {formatInstant(discrepancy.observedAt)}.{" "}
        {discrepancy.paymentId === null
          ? "This property has no payment for it, so no row beside this can carry it."
          : onScreen
            ? "Its payment is in the list beside this."
            : "Its payment is not in the list beside this — widen the filters to bring it in."}
      </p>
    </li>
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
        "text-muted-foreground px-3 py-2 text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0",
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
 * Folios use and for the same reason: four and five members are an enum the
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {label}
      </dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
