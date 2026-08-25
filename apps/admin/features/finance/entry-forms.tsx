"use client";

import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  byMethod,
  CATEGORY_LABELS,
  type CashBookEntry,
  categoriesFor,
  DEFAULT_ENTRY_FIELDS,
  DIRECTION_LABELS,
  type EntryFields,
  entryAttempt,
  METHOD_LABELS,
  type OpenDrawer,
  onSide,
  type ReversalFields,
  reversalAttempt,
  theOnlyOpenDrawer,
} from "./cash-book";
import {
  useRecordCashBookEntry,
  useReverseCashBookEntry,
} from "./finance-queries";

/* The two acts the property's cash book has, as forms.
 *
 * There are two and there will not be a third: `contract/finance.ts` declares
 * one route that records a movement and one that undoes it, and no route that
 * edits or deletes. `migrations/0042` refuses both at the table, because a
 * shift's expected cash is computed from these rows — an expense edited after
 * the drawer it came out of was counted would move a variance somebody has
 * already signed for, on a handover that has already happened.
 *
 * ## What these forms refuse, and what they leave to the API
 *
 * They refuse what an operator can fix while the words are still on screen: a
 * figure that is not a quantity of đồng, a category on the wrong side of the
 * book, a cash entry with no drawer named, an entry that says nothing about
 * itself. They do not refuse a drawer somebody counted out a second ago, or an
 * entry a colleague corrected while this panel was open — those are facts about
 * rows, the API holds them under a lock, and a console that guessed at them
 * would be guessing at the state of a desk two people are working.
 *
 * ## The drawer is a choice and not an inference
 *
 * A payment resolves its shift from the session, because the person taking cash
 * from a guest is the person on the desk. Nobody who may reach these forms is on
 * the desk — the matrix grants this row to the accountant and management and
 * denies a receptionist outright — so the till is named. It defaults only where
 * a default is an answer rather than a guess: exactly one drawer open is the
 * only till there is, and two is a day and a night shift overlapping, where
 * choosing for the accountant would put đồng on the wrong handover half the
 * time.
 *
 * ## The keyboard
 *
 * Both are a `<form>`, so Enter finishes the field and the act at once — the
 * contract every other sequence in this console promises. The correction takes
 * focus when it appears, because it appears in the middle of something else: a
 * row somebody has just decided was wrong. The recording form does not, because
 * it sits on the screen from the moment it loads — a form that grabbed the caret
 * there would take it away from an accountant who came to read the month.
 */

/**
 * Recording a movement of the property's own money.
 *
 * The direction is first because everything after it depends on it: the
 * categories offered are that side's, and switching sides moves a selection that
 * no longer belongs — `onSide` says why that is the form's job rather than the
 * operator's.
 *
 * The trading day is left empty on the ordinary entry, and empty means the
 * property's own day, resolved by the server. It is offered at all for the one
 * case that needs it: an accountant recording Friday's bank transfer on Monday,
 * which belongs in Friday's month.
 */
export function RecordEntryForm({
  drawers,
  drawersPending,
  drawersFailed,
  businessDate,
  amountField,
  onRecorded,
}: {
  /** The tills a cash entry may still be recorded against. */
  drawers: readonly OpenDrawer[];
  /** True while the console still does not know which drawers are open. */
  drawersPending: boolean;
  /** True when the console asked which drawers are open and was not told, which
   *  is not the same fact as none being open and must not be drawn as it. */
  drawersFailed: boolean;
  /** The property's day, which a typed date is resolved against. */
  businessDate: string | null;
  /** The screen's handle on the first field, so the palette can put the caret
   *  in it. Owned by the caller rather than by this form: nothing here takes
   *  focus on its own, because this form sits on a screen somebody is reading
   *  rather than appearing over their work. */
  amountField: React.RefObject<HTMLInputElement | null>;
  /** The entry is in the book. */
  onRecorded(): void;
}) {
  const [fields, setFields] = useState<EntryFields>(DEFAULT_ENTRY_FIELDS);
  const [problem, setProblem] = useState<string | null>(null);
  const record = useRecordCashBookEntry();
  const noteId = useId();

  // Only where there is one, and only while the operator has not chosen. A
  // default that overwrote a choice would move the money to another handover
  // between the accountant picking a till and the answer arriving.
  const onlyDrawer = theOnlyOpenDrawer(drawers);
  const shiftId = fields.shiftId === "" ? (onlyDrawer ?? "") : fields.shiftId;

  async function submit() {
    // The refusal the press only *looks* like it makes: the control carries
    // `aria-disabled` so it keeps focus, so a second Enter arrives here and is
    // dropped rather than recording the same movement twice.
    if (record.isPending) {
      return;
    }

    const attempt = entryAttempt({ ...fields, shiftId }, businessDate);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    try {
      await record.mutateAsync(attempt.input);
    } catch {
      // Reported by `lib/query-client.ts`'s central toast, which carries the
      // API's own sentence — including the one about a drawer counted out while
      // this form was open, which is the refusal a console cannot see coming.
      return;
    }

    setFields(DEFAULT_ENTRY_FIELDS);
    onRecorded();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* Two halves of one card rather than a column down the left of it: the
          facts about the movement are short labelled boxes and want two
          columns, and what the money was for is prose and wants a measure. Set
          in one grid the note was as wide as the fields were, which on a card
          this wide left the whole trailing half of it empty. Two thirds and one
          third rather than half and half, because the fields are two columns
          inside their own share and halving the card made each of them too
          narrow to read a category in. `items-start`, so the note is as tall as
          it is asked to be rather than as tall as whichever share is longer. */}
      <div className="grid items-start gap-x-6 gap-y-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <Choice
            label="Side"
            value={fields.direction}
            options={(["EXPENSE", "INCOME"] as const).map((direction) => ({
              value: direction,
              label: DIRECTION_LABELS[direction],
            }))}
            onChange={(direction) => {
              setFields((current) => onSide(current, direction));
            }}
          />
          <Choice
            label="Category"
            value={fields.category}
            options={categoriesFor(fields.direction).map((category) => ({
              value: category,
              label: CATEGORY_LABELS[category],
            }))}
            onChange={(category) => {
              setFields((current) => ({ ...current, category }));
            }}
          />
          <Choice
            label="Method"
            value={fields.method}
            options={(["CASH", "BANK_TRANSFER"] as const).map((method) => ({
              value: method,
              label: METHOD_LABELS[method],
            }))}
            onChange={(method) => {
              setFields((current) => byMethod(current, method));
            }}
          />
          <Field
            label="Amount"
            inputRef={amountField}
            value={fields.amount}
            /* An example of the thing rather than a description of it, which is
               the spelling the other screens' date and figure fields settled
               on: a placeholder sits where the value will be, so a sentence in
               one is read as a value until the caret arrives. What the rule
               actually is belongs under the box. */
            placeholder="180000"
            hint="Whole đồng. The side of the book says which way it went, so no minus sign."
            inputMode="numeric"
            onChange={(amount) => {
              setFields((current) => ({ ...current, amount }));
            }}
          />

          {fields.method === "CASH" ? (
            <DrawerChoice
              drawers={drawers}
              pending={drawersPending}
              failed={drawersFailed}
              value={shiftId}
              onChange={(picked) => {
                setFields((current) => ({ ...current, shiftId: picked }));
              }}
            />
          ) : null}

          <Field
            label="Trading day"
            value={fields.businessDate}
            placeholder="15/3"
            hint="Empty is today. Type the day the money actually moved if it was another one."
            onChange={(businessDay) => {
              setFields((current) => ({
                ...current,
                businessDate: businessDay,
              }));
            }}
          />
        </div>

        <div>
          <label
            htmlFor={noteId}
            className="text-muted-foreground block text-xs tracking-caps uppercase"
          >
            What it was for
          </label>
          {/* Tall enough to be worth the half of the card it now occupies, and
              tall enough to show an entry of the length the API accepts without
              the operator scrolling inside two lines. */}
          <Textarea
            id={noteId}
            className="mt-1 min-h-32"
            rows={5}
            value={fields.note}
            placeholder="Two crates of bottled water, Minh Phát"
            onChange={(event) => {
              const note = event.target.value;
              setFields((current) => ({ ...current, note }));
            }}
          />
          <p className="text-muted-foreground mt-2 text-sm">
            {/* Said before the press rather than after it, because it is the
                one property of this book that changes how carefully somebody
                types. */}
            The book cannot be edited. An entry that turns out to be wrong is
            undone by a correction, and both stay in the record.
          </p>
        </div>
      </div>

      <Problem said={problem} />

      <div className="mt-4">
        {/* `aria-disabled` rather than `disabled`, which is this console's
            standing answer to a control that stops being pressable under
            somebody's finger: a disabled button cannot hold focus, so the
            browser drops it on `<body>` and an accountant who submitted with
            Enter is left nowhere. The second press is refused in `submit`. */}
        <Button
          type="submit"
          aria-disabled={record.isPending}
          aria-busy={record.isPending}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {record.isPending ? "Recording it" : "Record it"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Undoing an entry by recording its opposite.
 *
 * Nothing about the money is asked for: the amount, the category and the method
 * are the original's, read by the API off the row. A form that took them would
 * be recording a second, unrelated movement while calling it a correction, and
 * the two would not net to nothing.
 *
 * **The drawer is named again, and it is the one open now.** The original may
 * have moved through a till counted out hours ago, whose variance stands on the
 * count somebody signed; the đồng physically come back through whichever drawer
 * is open, and that is the shift this correction binds to.
 */
export function CorrectEntryForm({
  entry,
  drawers,
  drawersPending,
  drawersFailed,
  onCorrected,
  onDismiss,
}: {
  entry: CashBookEntry;
  drawers: readonly OpenDrawer[];
  drawersPending: boolean;
  /** The console asked which drawers are open and was not told. */
  drawersFailed: boolean;
  onCorrected(): void;
  onDismiss(): void;
}) {
  const [fields, setFields] = useState<ReversalFields>({
    shiftId: "",
    note: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const reverse = useReverseCashBookEntry();
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();

  useEffect(() => {
    reasonField.current?.focus();
  }, []);

  const onlyDrawer = theOnlyOpenDrawer(drawers);
  const shiftId = fields.shiftId === "" ? (onlyDrawer ?? "") : fields.shiftId;

  async function submit() {
    // As in the recording form: the control keeps focus by carrying
    // `aria-disabled`, so the second press arrives and is dropped here rather
    // than putting the same đồng back in the till twice.
    if (reverse.isPending) {
      return;
    }

    const attempt = reversalAttempt(entry, { ...fields, shiftId });

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    try {
      await reverse.mutateAsync(attempt.input);
    } catch {
      return;
    }

    onCorrected();
  }

  return (
    <form
      className="border-border border-l-2 pl-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {entry.method === "CASH" ? (
        <div className="max-w-sm">
          <DrawerChoice
            drawers={drawers}
            pending={drawersPending}
            failed={drawersFailed}
            value={shiftId}
            onChange={(picked) => {
              setFields((current) => ({ ...current, shiftId: picked }));
            }}
          />
        </div>
      ) : null}

      <div className="mt-4 max-w-prose">
        <label
          htmlFor={reasonId}
          className="text-muted-foreground block text-xs tracking-caps uppercase"
        >
          Why it is being undone
        </label>
        <Textarea
          id={reasonId}
          ref={reasonField}
          className="mt-1"
          rows={3}
          value={fields.note}
          placeholder="Recorded twice — this is the duplicate."
          onChange={(event) => {
            const note = event.target.value;
            setFields((current) => ({ ...current, note }));
          }}
        />
      </div>

      <Problem said={problem} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          aria-disabled={reverse.isPending}
          aria-busy={reverse.isPending}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {reverse.isPending
            ? "Recording the correction"
            : "Record the correction"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Leave it
        </Button>
      </div>
    </form>
  );
}

/**
 * Which till the đồng moved through.
 *
 * Every state says itself in words. A console that drew an empty select while
 * the shifts were still being read, or when the property has no drawer open at
 * all, would leave the operator pressing a button that cannot work and reading
 * a refusal to find out why.
 */
function DrawerChoice({
  drawers,
  pending,
  failed,
  value,
  onChange,
}: {
  drawers: readonly OpenDrawer[];
  pending: boolean;
  failed: boolean;
  value: string;
  onChange(shiftId: string): void;
}) {
  const fieldId = useId();

  if (pending) {
    return (
      <p
        className="text-muted-foreground self-end text-sm"
        role="status"
        aria-busy
      >
        Reading which drawers are open.
      </p>
    );
  }

  /* Before the empty answer, and it is not one. A failed read leaves the same
     empty list a property with no till open leaves, and told "no drawer is
     open" an accountant would go and open one — or book the đồng as a transfer
     they were not. What the console does not know, it says it does not know. */
  if (failed) {
    return (
      <p
        className="self-end max-w-prose border-danger border-l-2 pl-3 text-sm text-danger"
        role="alert"
      >
        Which drawers are open could not be read, so there is no till to name.
        Reload the screen before recording cash — this is not the same as no
        drawer being open.
      </p>
    );
  }

  if (drawers.length === 0) {
    return (
      <p className="text-muted-foreground self-end max-w-prose text-sm">
        No drawer is open, so cash has no till to move through. Record it once
        somebody is on the desk, or record it as a bank transfer if that is what
        it was.
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        Drawer
      </label>
      {/* The box's own height, so a row of fields sits on one baseline and the
          picker clears the 44px a finger needs: `h-9` was a select sitting 8px
          short of every `Input` beside it. */}
      <select
        id={fieldId}
        className="border-input mt-1 h-11 w-full rounded-md border bg-card px-3 text-sm shadow-xs"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {/* A real member and not a cleared field, so "no drawer chosen" is a
            thing the operator can see they are in rather than one they have to
            infer from an empty box. */}
        <option value="">Which drawer</option>
        {drawers.map((drawer) => (
          <option key={drawer.id} value={drawer.id}>
            {drawer.operatorName}, {drawer.openingBusinessDate}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One select over a closed set of members, each with the words it is called by
 *  on screen. Associated by id rather than by nesting, for the reason every
 *  other form in this console gives: the control is a component and a label has
 *  no way to prove what it wraps. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange(value: T): void;
}) {
  const fieldId = useId();

  return (
    // `min-w-0`, because a grid track's automatic minimum is its content: a
    // select whose longest option is a glossed category would otherwise widen
    // its own column and push the rest of a filter row off the card.
    <div className="min-w-0">
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      {/* The boxes' own height, so a filter row sits on one baseline and every
          select clears the 44px a finger needs — `h-9` was 8px short of the
          `Input` primitive standing next to it. */}
      <select
        id={fieldId}
        className="border-input mt-1 h-11 w-full rounded-md border bg-card px-3 text-sm shadow-xs"
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

/** One text field, with the rule it is read by underneath rather than inside
 *  it. A hint set as the placeholder occupies the space the value will occupy,
 *  so it is read as one until the caret arrives — and it disappears at the exact
 *  moment somebody starts typing the thing it was explaining. */
export function Field({
  label,
  value,
  placeholder,
  hint,
  inputMode,
  inputRef,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric";
  inputRef?: React.Ref<HTMLInputElement>;
  onChange(value: string): void;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  return (
    <div className="min-w-0">
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
        // Named rather than merely adjacent: a hint a screen reader never
        // reaches is a hint only sighted operators have.
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground mt-1 text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}

/** The console's error device: a rule on the leading edge as much as the colour
 *  — `--color-danger` is a warm red-brown a shade off the umber every other line
 *  on the screen is set in, and a sentence that differed only in that would be
 *  read as ordinary copy. Announced, because it is the sentence that says why a
 *  press did nothing. */
export function Problem({ said }: { said: string | null }) {
  if (said === null) {
    return null;
  }

  return (
    <p
      className="border-danger mt-3 border-l-2 pl-3 text-sm text-danger"
      role="alert"
    >
      {said}
    </p>
  );
}
