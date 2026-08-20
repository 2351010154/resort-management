"use client";

import { formatVnd } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
/* The drawer's own two pieces, reached by their own paths rather than through
 * `features/shifts`'s barrel: a barrel is resolved as a whole, and the history
 * screen it also exports has no business in the departures bundle. The same
 * reach `features/payments` makes into `features/folios/folio-ledger`. */
import { OpenDrawerForm } from "@/features/shifts/drawer-forms";
import { cashDrawerRefusal } from "@/features/shifts/shift-day";
import { formatShortDate } from "@/lib/business-date";
import {
  type DeskPaymentFields,
  type DeskPaymentMethod,
  deskPaymentAttempt,
  METHOD_LABELS,
  OFFERED_PAYMENT_METHODS,
} from "@/lib/desk-payment";
import { KeyboardLayer, useHotkeys } from "@/lib/keyboard";

import {
  balanceDue,
  type CheckoutStep,
  checkOutRefusal,
  type Departure,
  type Folio,
  type FolioPosting,
  isClosed,
  overpayment,
  refusalSentence,
  refusalStep,
  type SequenceFacts,
  sequenceSteps,
  stepAfter,
} from "./departure-queue";
import {
  useBookingFolio,
  useCheckOut,
  useCloseFolio,
  usePostPayment,
} from "./departures-queries";

/* The checkout, worked where the row is.
 *
 * `screens.md` §"Staff surfaces" states the whole of it: departures mirrors
 * arrivals, picking a row opens the checkout sequence in place — review the
 * folio's charges, collect any balance, close the folio and issue the legal
 * e-invoice, check out — and returns to the queue. The Folios and Payments
 * families exist for work *outside* a checkout, so nothing here sends the
 * operator to them: a detour costs the desk its place in the queue during the
 * one part of the day it cannot afford to lose it.
 *
 * ## The order of the writes, and why the last press does two of them
 *
 * The payment is posted when the payment step is answered, because a refusal
 * has to land on the control that caused it and because whether the account
 * settled is a fact only the write can answer — a desk taking part of what is
 * owed has not settled the stay, and the receipt that comes back carries the
 * balance that proves it either way.
 *
 * The close and the check-out are one press, and that is not the same shortcut.
 * They are two calls with one precondition between them: `FolioService.close`
 * refuses an account that does not balance and `check-out.guard.ts` refuses on
 * exactly the same figure, so there is no state an operator could reach where
 * one would succeed and the other needed a decision. Splitting them would be a
 * step whose only content is "press again". What is *not* collapsed is the
 * recovery: a close that succeeded is remembered, so a second press after a
 * failed check-out does not try to agree an account that is already agreed.
 *
 * ## Cash with no drawer open is answered here, not by a toast
 *
 * Every đồng of cash belongs to an open shift or drawer variance means nothing,
 * so the API refuses a cash payment from an operator on no drawer — a `CONFLICT`
 * carrying `NO_OPEN_SHIFT` in its `data`, which `payment-refusal.ts` exists so
 * that a screen can branch on rather than match on prose. `screens.md` says what
 * the branch owes the desk: "a cash payment with no open shift prompts the
 * receptionist to open one in place, count the drawer and continue." So the
 * refusal opens the drawer form under the payment step and the press that
 * finishes it posts the payment again — the guest is standing at the desk with
 * the money in their hand, and sending the receptionist to another surface to
 * fix it would lose the queue's place over a till that takes ten seconds to
 * count. Every other refusal of a payment is left exactly where it was: reported
 * centrally, with the operator on the control that caused it.
 *
 * ## Nothing is polled for an invoice
 *
 * There is no e-invoice call after the close and no reference to wait for.
 * `apps/api/src/modules/folio/e-invoice.job.ts` is explicit: a folio standing
 * at `CLOSED` with no invoice reference *is* the enqueued job, written by the
 * transaction that closed it, and a sweep issues the document out of band. So
 * the close is the initiation, and this screen says so rather than implying a
 * number exists at the moment of the press.
 *
 * ## The keyboard contract
 *
 * Identical to the arrivals sequence, deliberately — the desk works both in one
 * shift. Every step is a `<form>`, so Enter finishes the field and the step at
 * once; the expansion is rendered after its own row so Tab from the row lands
 * in the first control; Escape abandons, bound in a {@link KeyboardLayer} so it
 * outranks the queue's own bindings; and focus follows the step. A pointer
 * works everywhere and is required nowhere.
 */

export interface CheckoutSequenceProps {
  departure: Departure;
  /** Escape, or a step the operator backed out of. */
  onCancel(): void;
  /** The stay is over. The queue moves to the next departure. */
  onCheckedOut(): void;
}

export function CheckoutSequence(props: CheckoutSequenceProps) {
  // The layer is declared here and the sequence is a child of it, because a
  // hook reads its depth from context: Escape bound in this component would
  // read the queue's depth and lose to it.
  return (
    <KeyboardLayer>
      <Sequence {...props} />
    </KeyboardLayer>
  );
}

function Sequence({
  departure,
  onCancel,
  onCheckedOut,
}: CheckoutSequenceProps) {
  const [step, setStep] = useState<CheckoutStep>("account");
  const [payment, setPayment] = useState<DeskPaymentFields>({
    amount: "",
    // Unanswered, and it stays unanswered until the operator says. The desk is
    // the only party that knows whether the notes were counted or the transfer
    // landed, and this form opening on an answer would be the console making
    // one up in the one moment somebody could have stated it.
    method: null,
    description: "Balance settled at checkout",
  });
  // Whether this sequence has already agreed the account. A second press after
  // a check-out that failed must not try to close a closed folio: that is a
  // `CONFLICT` the operator can do nothing about, over an act that succeeded.
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Whether the last payment was refused for want of a cash drawer. Held apart
  // from `problem` because it is not a sentence but an act: the form below is
  // offered on exactly this refusal, and on nothing else the API can answer.
  const [drawerNeeded, setDrawerNeeded] = useState(false);

  const folio = useBookingFolio(departure.id);
  const account = folio.data;

  const due = account === undefined ? 0n : balanceDue(account);
  const over = account === undefined ? 0n : overpayment(account);
  const closed = account !== undefined && isClosed(account);

  const postPayment = usePostPayment();
  const closeFolio = useCloseFolio();
  const checkOut = useCheckOut();

  const facts: SequenceFacts = { balanceDue: due > 0n };
  const steps = sequenceSteps(facts);

  // The first control of whichever step is showing, re-focused on every step
  // change so the operator's hands never leave the keys to find out where the
  // sequence went. The account and settlement steps have no field of their own
  // — what they ask for is the press — so the confirming button is the target
  // there, and the two refs are read in that order because only one of them is
  // mounted at a time.
  const firstControl = useRef<HTMLInputElement>(null);
  const confirmControl = useRef<HTMLButtonElement>(null);

  // The account is not readable the instant the row opens, and its confirming
  // press is disabled until it is — a disabled button cannot take focus, so
  // focusing on the step alone would leave the operator's focus on the row for
  // the length of one request and quietly break the handover the sequence
  // promises. This is why the read's arrival is an event of its own here.
  const reading = folio.isPending;

  /* biome-ignore lint/correctness/useExhaustiveDependencies: neither dependency
     is a value this effect reads — they are the two events it exists to answer,
     the step changing and the account landing. The refs are read at the moment
     it runs, and dropping them would focus the first control once and never
     again. */
  useEffect(() => {
    (firstControl.current ?? confirmControl.current)?.focus();
  }, [step, reading]);

  useHotkeys("escape", onCancel, { enableInFormField: true });

  const busy =
    postPayment.isPending || closeFolio.isPending || checkOut.isPending;

  /**
   * On to whatever the next step is, given what this one just settled.
   *
   * `learned` is not a convenience. State set in this handler is not readable
   * until the next render, and the payment step is the one that decides how
   * many steps there are — so a settled account routed against the facts that
   * were true before the press would send the operator back to a payment field
   * for money the guest has just handed over.
   */
  function advance(from: CheckoutStep, learned: Partial<SequenceFacts> = {}) {
    setProblem(null);
    setDrawerNeeded(false);
    const next = stepAfter(sequenceSteps({ ...facts, ...learned }), from);

    if (next === null) {
      return;
    }

    if (next === "payment") {
      // Prefilled with the whole of what the account is short, because that is
      // what the guest is being asked for — and editable, because a desk taking
      // part of it in cash and the rest on a card is an ordinary morning.
      setPayment((current) => ({ ...current, amount: due.toString() }));
    }

    setStep(next);
  }

  function agreeCharges() {
    if (account === undefined) {
      setProblem("The account has not been read yet.");
      return;
    }

    if (over > 0n) {
      // Named and refused rather than netted off or rounded away. The property
      // is holding money the guest has not been given back, and both the close
      // and the check-out refuse on the same figure — `folio.refund-policy` and
      // `folio.refund-override` are where it is handed back, each with its own
      // capability and its own record of why.
      setProblem(
        `The account is over-paid by ${formatVnd(over)}. The difference is refunded before the stay can be agreed — that is the Payments family's work, not a checkout's.`,
      );
      return;
    }

    advance("account");
  }

  async function submitPayment() {
    const attempt = deskPaymentAttempt(
      departure.id,
      payment,
      "A payment is money received, so it is a figure above nothing.",
    );

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    let settled: bigint;

    setDrawerNeeded(false);

    try {
      const receipt = await postPayment.mutateAsync(attempt.payment);

      // The balance the write itself came back with, and not the one this
      // component was holding. A part payment leaves the stay short and an
      // over-payment leaves the property owing, and the receipt is the only
      // reading of the ledger taken after the line was written.
      settled = receipt.folio.summary.outstanding;
    } catch (error) {
      // One refusal has an act behind it, and it is the only one this catch
      // reads. Everything else — a figure the route would not take, an account
      // already agreed, a network that was not there — is reported by
      // `lib/query-client.ts`'s central toast, and what is owed here is staying
      // on the control the operator can fix it at.
      if (cashDrawerRefusal(error) === "NO_OPEN_SHIFT") {
        setDrawerNeeded(true);
        setProblem(
          "There is no cash drawer open in your name, and cash belongs to a drawer or the day's variance means nothing. Count the till in below — the same press takes the payment.",
        );
      }

      return;
    }

    if (settled > 0n) {
      // What is left, and the method asked again. A desk taking part of it in
      // cash and the rest by transfer is an ordinary morning, and a second line
      // posted under the first one's method would put money in the drawer that
      // never reached it — the ledger is append-only, so nothing could correct
      // that afterwards except a reversal.
      setPayment((current) => ({
        ...current,
        amount: settled.toString(),
        method: null,
      }));
      setProblem(
        `${formatVnd(settled)} is still outstanding. The stay cannot be checked out until the account balances.`,
      );
      return;
    }

    if (settled < 0n) {
      setProblem(
        `That is ${formatVnd(-settled)} more than the account was short. The over-payment is refunded before the stay can be agreed.`,
      );
      return;
    }

    advance("payment", { balanceDue: false });
  }

  async function submitCheckOut() {
    if (!agreed && !closed) {
      try {
        await closeFolio.mutateAsync({ bookingId: departure.id });
      } catch {
        // The close refuses over a balance and says which way it is short, and
        // that figure has already moved under this sequence if the press got
        // here at all. So the operator goes back to the charges, which re-read
        // the ledger and re-derive whether there is a payment to take.
        await folio.refetch();
        setProblem(
          "The account could not be agreed. Read the charges again — what is on it now is below.",
        );
        setStep("account");
        return;
      }

      setAgreed(true);
    }

    try {
      await checkOut.mutateAsync({ bookingId: departure.id });
    } catch (error) {
      const code = checkOutRefusal(error);

      if (code === null) {
        return;
      }

      await folio.refetch();
      setProblem(refusalSentence(code));
      setStep(refusalStep(code));
      return;
    }

    onCheckedOut();
  }

  return (
    <div className="border-border border-t p-4">
      <StepTrail steps={steps} current={step} />

      {step === "account" ? (
        <Step
          onSubmit={agreeCharges}
          busy={busy || folio.isPending}
          confirm={due > 0n ? "Take the balance" : "Charges agreed"}
          confirmRef={confirmControl}
        >
          {folio.isPending ? (
            <p className="text-muted-foreground text-sm" aria-busy>
              Reading the stay's account.
            </p>
          ) : null}

          {folio.isError ? (
            <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
              The account could not be read, so there is no balance to settle
              and no charges to agree. Nothing about this stay has changed.
            </p>
          ) : null}

          {account === undefined ? null : <AccountSummary folio={account} />}
        </Step>
      ) : null}

      {step === "payment" ? (
        <Step onSubmit={submitPayment} busy={busy} confirm="Post the payment">
          <p className="text-muted-foreground text-sm">
            The account is short {formatVnd(due)}. Post what the guest hands
            over — the stay cannot be checked out until it balances.
          </p>

          <div className="mt-rhythm-1 grid gap-3 sm:grid-cols-2">
            <Field
              label="Amount"
              inputRef={firstControl}
              value={payment.amount}
              inputMode="numeric"
              onChange={(amount) => {
                setPayment((current) => ({ ...current, amount }));
              }}
              required
            />
            <Field
              label="Description"
              value={payment.description}
              onChange={(description) => {
                setPayment((current) => ({ ...current, description }));
              }}
              required
            />
          </div>

          <MethodChoice
            value={payment.method}
            onChange={(method) => {
              setPayment((current) => ({ ...current, method }));
            }}
          />
        </Step>
      ) : null}

      {step === "payment" && drawerNeeded ? (
        /* Under the step and not over it, and a sibling of its form rather than
         * a child — the step's own fields stay on screen above, because the
         * amount, the description and the method the operator already chose are
         * what the press below re-posts. A form that replaced them would look
         * like the payment had been thrown away, and a form nested inside
         * another one is not a form the browser will submit. */
        <div className="border-border mt-rhythm-1 border-t pt-rhythm-1">
          <p className="text-muted-foreground text-xs tracking-caps uppercase">
            Open a drawer
          </p>
          <OpenDrawerForm
            confirm="Open the drawer and take the payment"
            onOpened={async () => {
              setDrawerNeeded(false);
              // The payment again, on the same press, with the same figure and
              // the same method. Not a retry the console decided on — a
              // mutation is never retried automatically here, for the reason
              // `lib/query-client.ts` gives — but the second half of an act the
              // operator asked for by pressing a button that says so.
              await submitPayment();
            }}
          />
        </div>
      ) : null}

      {step === "settlement" ? (
        <Step
          onSubmit={submitCheckOut}
          busy={busy}
          confirm="Close and check out"
          confirmRef={confirmControl}
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Fact label="Stay" value={departure.reference} />
            <Fact label="Room" value={departure.roomNumber ?? "None held"} />
            <Fact
              label="Guest"
              value={
                departure.guestNames.length === 0
                  ? "Nobody registered"
                  : departure.guestNames.join(", ")
              }
            />
            <Fact
              label="Balance"
              value={formatVnd(account?.summary.outstanding ?? 0n)}
            />
          </dl>

          <p className="text-muted-foreground mt-rhythm-1 text-sm">
            {agreed || closed
              ? "The account is already agreed and its invoice is with the property's invoice job. This press ends the stay."
              : "This agrees the account, which is what puts the stay in the invoice queue, and then ends it. The invoice number is issued out of band — there is nothing here to wait for."}
          </p>
        </Step>
      ) : null}

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}

      <p className="text-muted-foreground mt-rhythm-1 text-xs">
        Escape abandons the checkout. Nothing already posted or agreed is undone
        by it.
      </p>
    </div>
  );
}

/**
 * The charges, as they are read back to the guest.
 *
 * Every line rather than a total, because that is what agreeing the account
 * means: the ledger is append-only and a correction is a reversal, so the lines
 * a guest is being asked about are the lines that will be on the invoice.
 */
function AccountSummary({ folio }: { folio: Folio }) {
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <caption className="text-muted-foreground text-left text-xs tracking-caps uppercase">
          Charges and payments
        </caption>
        <tbody>
          {folio.postings.length === 0 ? (
            <tr>
              <td className="text-muted-foreground py-2" colSpan={3}>
                Nothing has been posted to this stay.
              </td>
            </tr>
          ) : (
            folio.postings.map((posting) => (
              <PostingRow key={posting.id} posting={posting} />
            ))
          )}
        </tbody>
      </table>

      <dl className="mt-rhythm-1 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="Charged" value={formatVnd(folio.summary.charged)} />
        <Fact label="Paid" value={formatVnd(folio.summary.credited)} />
        <Fact
          label="Outstanding"
          value={formatVnd(folio.summary.outstanding)}
        />
      </dl>
    </>
  );
}

function PostingRow({ posting }: { posting: FolioPosting }) {
  return (
    <tr className="border-border border-b">
      <td className="text-muted-foreground py-1 pr-3 whitespace-nowrap">
        {formatShortDate(posting.businessDate)}
      </td>
      <td className="py-1 pr-3">{posting.description}</td>
      <td className="py-1 text-right font-mono whitespace-nowrap">
        {formatVnd(posting.amount)}
      </td>
    </tr>
  );
}

/** Where the operator is, and how much of the sequence is left. */
function StepTrail({
  steps,
  current,
}: {
  steps: readonly CheckoutStep[];
  current: CheckoutStep;
}) {
  return (
    <ol className="mb-rhythm-1 flex flex-wrap gap-3 text-xs tracking-caps uppercase">
      {steps.map((step) => (
        <li
          key={step}
          aria-current={step === current ? "step" : undefined}
          className={
            step === current ? "text-foreground" : "text-muted-foreground"
          }
        >
          {STEP_LABELS[step]}
        </li>
      ))}
    </ol>
  );
}

const STEP_LABELS: Record<CheckoutStep, string> = {
  account: "Charges",
  payment: "Balance",
  settlement: "Check out",
};

/** One step of the sequence: fields, and the press that finishes them. */
function Step({
  onSubmit,
  busy,
  confirm,
  confirmRef,
  children,
}: {
  onSubmit(): void | Promise<void>;
  busy: boolean;
  /** The words on the press that finishes this step. */
  confirm: string;
  confirmRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {children}

      <div className="mt-rhythm-1">
        <Button ref={confirmRef} type="submit" disabled={busy}>
          {confirm}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  inputRef,
  required,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  inputMode?: "numeric";
  inputRef?: React.Ref<HTMLInputElement>;
  required?: boolean;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see — the input is a component and
  // the label has no way to prove what it wraps.
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
        inputMode={inputMode}
        autoComplete="off"
        required={required}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/**
 * How the money reached the desk, asked rather than assumed.
 *
 * A radio group and not a select, because the whole list is two rows: a select
 * hides both behind a press that opens a listbox, and the choice a desk makes
 * every time it takes money is not worth a second control's worth of keys. The
 * options are {@link OFFERED_PAYMENT_METHODS}, which is the contract's own list
 * with the gateway excluded — this screen cannot offer a method the API would
 * refuse, and cannot invent the one only the IPN handler may write.
 *
 * Nothing is selected when the step opens. That is the requirement rather than
 * an oversight: a group arriving with `CASH` highlighted is a default wearing a
 * radio button, and the operator who presses Enter past it has recorded an
 * answer they never gave.
 *
 * ## Enter, restored
 *
 * The rest of this sequence promises that Enter finishes the step from
 * wherever the operator is standing, and a radio is the one control where that
 * is not free: WAI-ARIA says a radio group is not activated by Enter, so Radix
 * suppresses the key, and a desk that chose a method and pressed Enter would be
 * met with nothing happening. The group asks its own form to submit instead,
 * which is what every field of every other step already does.
 */
function MethodChoice({
  value,
  onChange,
}: {
  value: DeskPaymentMethod | null;
  onChange(method: DeskPaymentMethod): void;
}) {
  const groupId = useId();

  return (
    <fieldset className="mt-rhythm-1">
      <legend
        id={groupId}
        className="text-muted-foreground text-xs tracking-caps uppercase"
      >
        Method
      </legend>
      <RadioGroup
        aria-labelledby={groupId}
        className="mt-1 grid-flow-col justify-start gap-6"
        value={value ?? ""}
        onValueChange={(method) => {
          onChange(method as DeskPaymentMethod);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.closest("form")?.requestSubmit();
          }
        }}
      >
        {OFFERED_PAYMENT_METHODS.map((method) => (
          <MethodOption key={method} method={method} />
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/** One way of paying, in the words the desk reads. */
function MethodOption({ method }: { method: DeskPaymentMethod }) {
  // Associated by id rather than by nesting, for `Field`'s reason: the control
  // is a component, and a label has no way to prove what it wraps.
  const choiceId = useId();

  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={choiceId} value={method} />
      <label htmlFor={choiceId} className="text-sm">
        {METHOD_LABELS[method]}
      </label>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
