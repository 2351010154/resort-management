"use client";

import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  byMethod,
  type CashBookEntry,
  CATEGORY_LABELS,
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
  businessDate,
  amountField,
  onRecorded,
}: {
  /** The tills a cash entry may still be recorded against. */
  drawers: readonly OpenDrawer[];
  /** True while the console still does not know which drawers are open. */
  drawersPending: boolean;
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
      <div className="grid gap-3 sm:grid-cols-2">
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
          placeholder="Whole đồng"
          inputMode="numeric"
          onChange={(amount) => {
            setFields((current) => ({ ...current, amount }));
          }}
        />

        {fields.method === "CASH" ? (
          <DrawerChoice
            drawers={drawers}
            pending={drawersPending}
            value={shiftId}
            onChange={(picked) => {
              setFields((current) => ({ ...current, shiftId: picked }));
            }}
          />
        ) : null}

        <Field
          label="Trading day"
          value={fields.businessDate}
          placeholder="Today, unless it moved on another day"
          onChange={(businessDay) => {
            setFields((current) => ({ ...current, businessDate: businessDay }));
          }}
        />
      </div>

      <div className="mt-rhythm-1">
        <label
          htmlFor={noteId}
          className="text-muted-foreground block text-xs tracking-caps uppercase"
        >
          What it was for
        </label>
        <Textarea
          id={noteId}
          className="mt-1"
          rows={2}
          value={fields.note}
          placeholder="Two crates of bottled water, Minh Phát"
          onChange={(event) => {
            const note = event.target.value;
            setFields((current) => ({ ...current, note }));
          }}
        />
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        {/* Said before the press rather than after it, because it is the one
            property of this book that changes how carefully somebody types. */}
        The book cannot be edited. An entry that turns out to be wrong is undone
        by a correction, and both stay in the record.
      </p>

      <Problem said={problem} />

      <div className="mt-rhythm-1">
        <Button type="submit" disabled={record.isPending}>
          Record it
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
  onCorrected,
  onDismiss,
}: {
  entry: CashBookEntry;
  drawers: readonly OpenDrawer[];
  drawersPending: boolean;
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
            value={shiftId}
            onChange={(picked) => {
              setFields((current) => ({ ...current, shiftId: picked }));
            }}
          />
        </div>
      ) : null}

      <div className="mt-rhythm-1">
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
          rows={2}
          value={fields.note}
          placeholder="Recorded twice — this is the duplicate."
          onChange={(event) => {
            const note = event.target.value;
            setFields((current) => ({ ...current, note }));
          }}
        />
      </div>

      <Problem said={problem} />

      <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={reverse.isPending}>
          Record the correction
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
  value,
  onChange,
}: {
  drawers: readonly OpenDrawer[];
  pending: boolean;
  value: string;
  onChange(shiftId: string): void;
}) {
  const fieldId = useId();

  if (pending) {
    return (
      <p className="text-muted-foreground self-end text-sm" aria-busy>
        Reading which drawers are open.
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
    <div>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        Drawer
      </label>
      <select
        id={fieldId}
        className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
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
            {drawer.operatorName} · {drawer.openingBusinessDate}
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

/** One text field. */
export function Field({
  label,
  value,
  placeholder,
  inputMode,
  inputRef,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  inputMode?: "numeric";
  inputRef?: React.Ref<HTMLInputElement>;
  onChange(value: string): void;
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
      <Input
        id={fieldId}
        ref={inputRef}
        className="mt-1"
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** The console's error device: a rule on the leading edge rather than a colour
 *  — `--color-destructive` and `--color-primary` are the same umber. */
export function Problem({ said }: { said: string | null }) {
  if (said === null) {
    return null;
  }

  return (
    <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
      {said}
    </p>
  );
}
