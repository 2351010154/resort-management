"use client";

import { formatVnd } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInstant } from "@/features/guests/guest-record";

import {
  type CloseDrawerFields,
  closeDrawerAttempt,
  expectedInDrawer,
  type OpenDrawerFields,
  openDrawerAttempt,
  type PendingItem,
  pendingItemAttempt,
  type Shift,
  VARIANCE_LABELS,
  varianceReading,
} from "./shift-day";
import {
  useCloseDrawer,
  useOpenDrawer,
  usePendingItems,
  useRaisePendingItem,
  useResolvePendingItem,
} from "./shift-queries";

/* The three acts a drawer has, as forms rather than as screens.
 *
 * `screens.md` §"Staff surfaces" is the reason none of these is a page: shifts
 * "frame the receptionist's day but never own a screen visit". So each act is
 * written as a component that can be dropped wherever the desk is already
 * standing — inside the palette's panel on any screen, and, for the open, inside
 * the checkout sequence at the moment a cash payment was refused for want of a
 * drawer. That second placement is the whole reason {@link OpenDrawerForm} takes
 * its confirming words and its aftermath from the caller: opening a drawer from
 * the palette is finished when the drawer is open, and opening one mid-checkout
 * is finished when the money the guest is holding out has been taken.
 *
 * ## What these forms refuse, and what they leave to the API
 *
 * They refuse what an operator can fix while the words are still on screen: a
 * float that is not a quantity of đồng, a note longer than the column, an item
 * that says nothing. They do not refuse a second open drawer, a shift somebody
 * else already closed or an item another shift has just cleared — those are
 * facts about rows, the API holds them under a lock, and a console that guessed
 * at them would be guessing at the state of a desk two people are working.
 *
 * Nothing here computes a variance. `contract/operations.ts` derives it on the
 * close and hands it back on the answer, and {@link CloseDrawerForm} prints the
 * figure that came back.
 *
 * ## The keyboard
 *
 * Every act is a `<form>`, so Enter finishes the field and the act at once — the
 * contract the arrivals and departures sequences already promise the desk. The
 * first control takes focus when the form appears, because these forms appear in
 * the middle of something else: a panel that opened over the work, or a payment
 * step that was refused.
 */

/**
 * Opening a drawer: the đồng counted into it, and nothing else.
 *
 * No operator field and none possible — the only person who may be answerable
 * for this drawer is the one asking, and a body naming somebody else would
 * attribute every đồng of the day to the wrong person. No business date either:
 * which trading day a shift opened at 01:00 belongs to is the property's
 * rollover, resolved on the server.
 */
export function OpenDrawerForm({
  confirm,
  onOpened,
}: {
  /** The words on the press. "Open the drawer" from the palette; something that
   *  names the interrupted act where this appears inside one. */
  confirm: string;
  /** The drawer is open. What follows is the caller's — closing a panel, or
   *  taking the payment that was refused. */
  onOpened(shift: Shift): void | Promise<void>;
}) {
  const [fields, setFields] = useState<OpenDrawerFields>({ openingFloat: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const openDrawer = useOpenDrawer();
  const floatField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    floatField.current?.focus();
  }, []);

  async function submit() {
    const attempt = openDrawerAttempt(fields);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    let opened: Shift;

    try {
      opened = await openDrawer.mutateAsync(attempt.input);
    } catch {
      // Reported by `lib/query-client.ts`'s central toast, which carries the
      // API's own sentence — including the one about a drawer this operator
      // already has open, which is the refusal a console cannot see coming.
      return;
    }

    await onOpened(opened);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <MoneyField
        label="Opening float"
        inputRef={floatField}
        value={fields.openingFloat}
        placeholder="What is in the till now"
        onChange={(openingFloat) => {
          setFields({ openingFloat });
        }}
      />

      <p className="text-muted-foreground mt-2 text-xs">
        Count the till before the first guest. Everything taken in cash on this
        drawer is held against this figure when it is counted out, so a float
        typed rather than counted is a variance somebody will be asked about.
      </p>

      <Problem said={problem} />

      <div className="mt-rhythm-1">
        <Button type="submit" disabled={openDrawer.isPending}>
          {confirm}
        </Button>
      </div>
    </form>
  );
}

/**
 * Counting a drawer out, and telling the next person what they are inheriting.
 *
 * What the till should hold is stated above the field — the opening float, the
 * cash bound to the shift and what the property spent through it — because a
 * count taken blind is a count nobody can act on, and because all three terms
 * are on the shift already. What it does
 * *not* state is the variance the count would produce: that figure is the API's,
 * derived under the lock it takes before summing the cash, and a console
 * previewing it would be inviting the operator to type until it read zero.
 */
export function CloseDrawerForm({
  shift,
  onClosed,
}: {
  shift: Shift;
  /** The drawer is counted out. The closed shift carries its variance. */
  onClosed(closed: Shift): void;
}) {
  const [fields, setFields] = useState<CloseDrawerFields>({
    closingCount: "",
    handoverNote: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const closeDrawer = useCloseDrawer();
  const countField = useRef<HTMLInputElement>(null);
  const noteId = useId();

  useEffect(() => {
    countField.current?.focus();
  }, []);

  async function submit() {
    const attempt = closeDrawerAttempt(shift.id, fields);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    try {
      onClosed(await closeDrawer.mutateAsync(attempt.input));
    } catch {
      // The API refuses a drawer that is not this operator's and one somebody
      // has already counted out, and says which in its own words. Both are
      // facts about the row rather than about what was typed, so the operator
      // stays on the form and the central toast carries the sentence.
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DrawerFigures shift={shift} />

      <div className="mt-rhythm-1">
        <MoneyField
          label="Counted out"
          inputRef={countField}
          value={fields.closingCount}
          placeholder="What is in the till"
          onChange={(closingCount) => {
            setFields((current) => ({ ...current, closingCount }));
          }}
        />
      </div>

      <div className="mt-rhythm-1">
        <label
          htmlFor={noteId}
          className="text-muted-foreground block text-xs tracking-caps uppercase"
        >
          Handover note
        </label>
        <Textarea
          id={noteId}
          className="mt-1"
          value={fields.handoverNote}
          placeholder="What the next person needs to know. Leave it blank on a quiet shift."
          onChange={(event) => {
            const handoverNote = event.target.value;
            setFields((current) => ({ ...current, handoverNote }));
          }}
        />
      </div>

      <Problem said={problem} />

      <div className="mt-rhythm-1">
        <Button type="submit" disabled={closeDrawer.isPending}>
          Close the drawer
        </Button>
      </div>
    </form>
  );
}

/**
 * What the drawer holds so far — the float, the cash taken on it, what the
 * property's own book moved through it, and the sum somebody is about to count
 * against.
 *
 * The sum is the one piece of arithmetic over money this console does, and
 * `shiftSchema` asks for it here rather than sending a fourth figure: all three
 * terms are on the shift and all three are exact integers.
 *
 * The cash-book term is printed even when it is nothing, rather than appearing
 * the first time somebody spends from the till. Nobody working a drawer may
 * record one of those entries — the matrix denies a receptionist the row — so
 * this figure moves without them, and a term that only showed up once it was
 * non-zero would be a sum that changed shape on the morning it mattered.
 */
export function DrawerFigures({ shift }: { shift: Shift }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="Opening float" value={formatVnd(shift.openingFloat)} />
      <Fact label="Cash taken" value={formatVnd(shift.cashTaken)} />
      <Fact label="Thu chi" value={formatVnd(shift.cashBookNet)} />
      <Fact
        label="Should hold"
        value={formatVnd(expectedInDrawer(shift))}
        emphasis
      />
    </dl>
  );
}

/**
 * A drawer that has been counted out, and how far out it was.
 *
 * The variance is printed as a word and a magnitude rather than as a signed
 * figure. "Over" and "short" are both wrong and a manager asks which way first;
 * a minus sign in front of a currency mark is the same fact in a spelling that
 * has to be decoded.
 */
export function ClosedDrawer({ shift }: { shift: Shift }) {
  const variance = varianceReading(shift);

  return (
    <div>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <Fact
          label="Should have held"
          value={formatVnd(expectedInDrawer(shift))}
        />
        <Fact
          label="Counted out"
          value={
            shift.closingCount === null
              ? "Not counted"
              : formatVnd(shift.closingCount)
          }
        />
        <Fact
          label="Variance"
          value={
            variance === null
              ? "None yet"
              : variance.tone === "square"
                ? VARIANCE_LABELS.square
                : `${VARIANCE_LABELS[variance.tone]} ${formatVnd(variance.amount)}`
          }
          emphasis
        />
      </dl>

      {shift.handoverNote === null ? null : (
        <p className="text-muted-foreground mt-rhythm-1 border-border border-l-2 pl-3 text-sm whitespace-pre-wrap">
          {shift.handoverNote}
        </p>
      )}
    </div>
  );
}

/**
 * The backlog: what is still outstanding, what this shift is adding to it, and
 * what it has just dealt with.
 *
 * Unscoped, and shown to whoever is looking. An item outlives the shift that
 * raised it — that is the whole reason the table exists — so a list holding only
 * what the current drawer found would be the handover with the handover taken
 * out.
 *
 * Raising and clearing both need a drawer, because both are attributed to the
 * caller's own open shift and the API refuses a caller who is on none. So the
 * controls are withheld from an operator with no drawer rather than offered and
 * refused, and the sentence says which act would fix it.
 *
 * `readOnly` is the history screen's, and it is a statement about the surface
 * rather than about the operator: `screens.md` makes the Shifts family the
 * history — "past shifts, variances, handover notes" — and a screen that also
 * wrote to the backlog would be the one place in this console where reading the
 * record and working the desk happened at the same address.
 */
export function PendingItems({
  onDrawer,
  offered,
  readOnly,
}: {
  /** True when this operator has a drawer open, which is what an item is
   *  attributed to. */
  onDrawer: boolean;
  /** False for a role the handover row is not granted to, which holds the read
   *  itself back rather than spending it on a 403. */
  offered: boolean;
  /** True where the backlog is being read rather than worked. */
  readOnly?: boolean;
}) {
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const items = usePendingItems(offered);
  const raise = useRaisePendingItem();
  const resolve = useResolvePendingItem();

  async function submit() {
    const attempt = pendingItemAttempt(said);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    try {
      await raise.mutateAsync(attempt.input);
    } catch {
      // The central toast carries the API's sentence, which for the one refusal
      // this form cannot see coming — a drawer closed under the operator
      // between the read and the press — says to open one.
      return;
    }

    setSaid("");
  }

  const outstanding = items.data?.items ?? [];

  return (
    <section>
      <h3 className="text-muted-foreground text-xs tracking-caps uppercase">
        Outstanding {items.data === undefined ? null : `· ${items.data.total}`}
      </h3>

      {items.isPending && offered ? (
        <p className="text-muted-foreground mt-2 text-sm" aria-busy>
          Reading what is outstanding.
        </p>
      ) : null}

      {outstanding.length === 0 && !items.isPending ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Nothing is outstanding. That is a real answer and a good one — the
          desk is handed over with nothing owed to the next shift.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {outstanding.map((item) => (
            <PendingItemRow
              key={item.id}
              item={item}
              onDrawer={onDrawer && readOnly !== true}
              busy={resolve.isPending}
              onResolve={() => {
                resolve.mutate({ pendingItemId: item.id });
              }}
            />
          ))}
        </ul>
      )}

      {readOnly === true ? null : (
        <form
          className="mt-rhythm-1"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Raise an item"
            value={said}
            placeholder="305 deposit not receipted"
            disabled={!onDrawer}
            onChange={setSaid}
          />

          <Problem said={problem} />

          {onDrawer ? (
            <div className="mt-2">
              <Button type="submit" variant="ghost" disabled={raise.isPending}>
                Add to the handover
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              An item is raised by the drawer that found it, so opening one is
              what makes this writable. The list above is readable either way —
              it is every shift's problem until somebody clears it.
            </p>
          )}
        </form>
      )}
    </section>
  );
}

/** One outstanding item, and the press that says this shift dealt with it. */
function PendingItemRow({
  item,
  onDrawer,
  busy,
  onResolve,
}: {
  item: PendingItem;
  onDrawer: boolean;
  busy: boolean;
  onResolve(): void;
}) {
  return (
    <li className="border-border flex items-start justify-between gap-3 border-b py-1 text-sm">
      <span>
        {item.description}
        <span className="text-muted-foreground block text-xs">
          Raised {formatInstant(item.createdAt)}
        </span>
      </span>

      {onDrawer ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={onResolve}
        >
          Cleared
        </Button>
      ) : null}
    </li>
  );
}

/** A figure in đồng, typed. `inputMode` numeric so a phone at the desk opens
 *  the digits, and the value stays text until `shift-day.ts` reads it — the
 *  grouping marks an operator types are that module's to drop. */
function MoneyField({
  label,
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      inputRef={inputRef}
      inputMode="numeric"
    />
  );
}

/** One labelled control. Associated by id rather than by nesting, for the
 *  reason every other form in this console gives: the input is a component and
 *  a label has no way to prove what it wraps. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  inputRef,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  inputMode?: "numeric";
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** One labelled fact. */
export function Fact({
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
      <dd className={emphasis ? "font-mono" : undefined}>{value}</dd>
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
