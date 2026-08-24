"use client";

import { formatVnd } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatInstant } from "@/features/guests/guest-record";

import {
  CASH_BOOK_TERM,
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
    // The refusal the press only looks like it makes. The control carries
    // `aria-disabled` rather than `disabled` so it keeps focus while the API is
    // answering, which means a second Enter arrives here and is dropped —
    // a disabled button drops focus on `<body>`, and an operator who has just
    // pressed Enter on a form is exactly who cannot afford that.
    if (openDrawer.isPending) {
      return;
    }

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

      <p className="text-muted-foreground mt-2 text-sm">
        Count the till before the first guest. Everything taken in cash on this
        drawer is held against this figure when it is counted out, so a float
        typed rather than counted is a variance somebody will be asked about.
      </p>

      <Problem said={problem} />

      <div className="mt-4">
        <Button
          type="submit"
          aria-disabled={openDrawer.isPending}
          aria-busy={openDrawer.isPending}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
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
    // The second press, dropped here rather than by a `disabled` attribute that
    // would take the operator's focus with it. Counting a drawer out twice is
    // the one repeat this form must not let through.
    if (closeDrawer.isPending) {
      return;
    }

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

      <div className="mt-4">
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

      <div className="mt-4">
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

      <div className="mt-4">
        <Button
          type="submit"
          aria-disabled={closeDrawer.isPending}
          aria-busy={closeDrawer.isPending}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {closeDrawer.isPending ? "Closing the drawer" : "Close the drawer"}
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
      <Fact label={CASH_BOOK_TERM} value={formatVnd(shift.cashBookNet)} />
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
        <p className="text-muted-foreground mt-2 border-border border-l-2 pl-3 text-sm whitespace-pre-wrap">
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
  heading = "h3",
}: {
  /** True when this operator has a drawer open, which is what an item is
   *  attributed to. */
  onDrawer: boolean;
  /** False for a role the handover row is not granted to, which holds the read
   *  itself back rather than spending it on a 403. */
  offered: boolean;
  /** True where the backlog is being read rather than worked. */
  readOnly?: boolean;
  /** What this list is under. It is a panel of its own beside the history and a
   *  block inside the drawer panel's dialog, and a document whose headings skip
   *  a level is one a screen reader's outline cannot be walked with. */
  heading?: "h2" | "h3";
}) {
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const items = usePendingItems(offered);
  const raise = useRaisePendingItem();
  const resolve = useResolvePendingItem();
  const Heading = heading;

  async function submit() {
    // Dropped here rather than by a `disabled` attribute, which would take the
    // operator's focus to `<body>` on the press that started the write.
    if (raise.isPending) {
      return;
    }

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
      <Heading className="text-muted-foreground text-xs tracking-caps uppercase">
        Outstanding {items.data === undefined ? null : `· ${items.data.total}`}
      </Heading>

      {items.isPending && offered ? (
        <p
          className="text-muted-foreground mt-3 text-sm"
          aria-busy
          role="status"
        >
          Reading what is outstanding.
        </p>
      ) : null}

      {/* A read that failed is not an empty backlog, and this is the one list in
          the console where the difference is the whole point: "nothing is
          outstanding" told to a shift taking the desk over is a statement
          somebody acts on. */}
      {items.isError ? (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          What is outstanding could not be read, so nothing here is a statement
          about the backlog. Ask the last shift what they left.
        </p>
      ) : null}

      {items.data !== undefined && outstanding.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Nothing is outstanding. That is a real answer and a good one — the
          desk is handed over with nothing owed to the next shift.
        </p>
      ) : null}

      {outstanding.length === 0 ? null : (
        <ul className="mt-3 flex flex-col">
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
          className="mt-4"
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
            <div className="mt-3">
              <Button
                type="submit"
                variant="ghost"
                aria-disabled={raise.isPending}
                aria-busy={raise.isPending}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
              >
                Add to the handover
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
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
    <li className="border-border flex items-start justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <span className="min-w-0">
        {item.description}
        {/* When it was raised, a tier under what was raised: level with the
            description it competed with the sentence somebody has to act on. */}
        <span className="text-muted-foreground mt-0.5 block text-xs">
          Raised {formatInstant(item.createdAt)}
        </span>
      </span>

      {onDrawer ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          // `aria-disabled` rather than `disabled`: clearing one item disables
          // every other row's press while the write is in flight, and a
          // disabled button cannot hold the focus of the operator who is
          // standing on it. The repeat is dropped in the handler instead.
          aria-disabled={busy}
          aria-busy={busy}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => {
            if (busy) {
              return;
            }

            onResolve();
          }}
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
      <dd className={emphasis ? "tabular-nums" : undefined}>{value}</dd>
    </div>
  );
}

/**
 * The console's error device: a rule on the leading edge as much as the colour
 * — `--color-danger` is a warm red-brown a shade off the umber every other line
 * is set in, and a sentence that differed only in that would be read as
 * ordinary copy.
 *
 * `role="alert"` because these are refusals rather than captions: the sentence
 * appears after a press, on a surface the operator is already standing on, and
 * a refusal nobody is told about is a form that did nothing.
 */
export function Problem({ said }: { said: string | null }) {
  if (said === null) {
    return null;
  }

  return (
    <p
      className="border-danger text-danger mt-2 border-l-2 pl-3 text-sm"
      role="alert"
    >
      {said}
    </p>
  );
}
