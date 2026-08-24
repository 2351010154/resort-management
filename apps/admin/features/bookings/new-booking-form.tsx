"use client";

import { RATE_PLAN_CODES, ROOM_TYPE_CODES } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckInSequence } from "@/features/arrivals";
import type { BoardRoom } from "@/features/housekeeping";
import { formatLongDate } from "@/lib/business-date";
import { KeyboardLayer, useHotkeys } from "@/lib/keyboard";

import {
  type BookingKind,
  type CreatedBooking,
  checkInFollows,
  defaultStay,
  type NewBookingFields,
  newBookingInput,
  walkInArrival,
} from "./booking-search";
import { useCreateBooking } from "./bookings-queries";

/* The two bookings the funnel cannot take, on one form.
 *
 * `docs/screens.md` §"Staff surfaces": "Creation serves two callers the funnel
 * cannot: the phone booking stops at `CONFIRMED` and surfaces in arrivals on its
 * date, while the walk-in — whose booking and check-in are one conversation at
 * the desk — flows straight from creation into the same check-in sequence
 * arrivals uses. A guest standing at the desk is never parked in a queue."
 *
 * Both take the same stay, so they are one form and one request. What differs is
 * only what happens after the press, which is why the kind is the first field
 * rather than two buttons at the bottom: the operator knows which conversation
 * they are in before they know the dates.
 *
 * ## The check-in follows a guest who is actually here
 *
 * The sequence is mounted on what came back, not on what was typed:
 * `check-in.guard.ts` refuses a check-in before the arrival date, so a stay
 * arriving later has no sequence that can finish and opening one would leave
 * the desk pressing Escape out of a dead end. {@link checkInFollows} is that
 * reading, and the date is pinned as well as read — the arriving field is the
 * property's own day whenever the kind is a walk-in. A creation the sequence
 * does not follow lands on the same confirmation the telephone path shows,
 * which already says the stay is in arrivals on its date.
 *
 * ## The check-in is imported, not rebuilt
 *
 * The walk-in path renders `features/arrivals`' own {@link CheckInSequence}
 * against the stay that was just created. A second implementation here would be
 * a second set of refusal readings, a second deposit parser and a second idea of
 * how many steps a check-in has — and the two would agree right up until one of
 * them changed. The sequence takes a stay in the shape the search answers one
 * in, and `walkInArrival` is the whole of the adaptation.
 *
 * ## The keyboard
 *
 * - Every control is a field or a button in one `<form>`, so **Enter takes the
 *   booking** from wherever the operator is.
 * - **Escape abandons it**, bound in a {@link KeyboardLayer} so it outranks the
 *   list's own bindings underneath — `keyboard-layer.tsx` is written for exactly
 *   this shape. Once a walk-in has been created the sequence mounts its own
 *   layer inside this one and Escape belongs to the sequence.
 * - The two closed sets are native `<select>`s. Five room types and three plans
 *   are sets the browser already navigates with the arrows and type-ahead, and
 *   `isFormField` counts a `SELECT` as somewhere a person is typing — so the
 *   screen's `/` and `n` cannot fire out of one.
 *
 * **No price.** §8 freezes what a booking was quoted, computed inside the
 * transaction that consumes the nights; a total on this form would be a second
 * opinion about it. What the property charges is answered on the folio, which is
 * the first thing the check-in sequence reads.
 */

export interface NewBookingFormProps {
  /** The property's day, from the board. The form is not offered without one. */
  businessDate: string;
  /** Every room on the board — the check-in sequence narrows this itself. */
  rooms: readonly BoardRoom[];
  /** Escape, or the operator backing out before anything was created. */
  onCancel(): void;
  /** The booking is taken and, for a walk-in, the guest is in the room. */
  onDone(): void;
}

export function NewBookingForm(props: NewBookingFormProps) {
  // The layer is declared here and the form is a child of it, because a hook
  // reads its depth from context: Escape bound in this component would read the
  // list's depth and lose to it.
  return (
    <KeyboardLayer>
      <Form {...props} />
    </KeyboardLayer>
  );
}

function Form({ businessDate, rooms, onCancel, onDone }: NewBookingFormProps) {
  const stay = defaultStay(businessDate);
  const [fields, setFields] = useState<NewBookingFields>({
    kind: "walk-in",
    roomType: ROOM_TYPE_CODES[0],
    plan: RATE_PLAN_CODES[0],
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: "1",
    childAges: "",
    contactName: "",
    contactEmail: "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [taken, setTaken] = useState<CreatedBooking | null>(null);

  const create = useCreateBooking();
  const firstControl = useRef<HTMLSelectElement>(null);
  const doneControl = useRef<HTMLButtonElement>(null);

  useHotkeys("escape", onCancel, { enableInFormField: true });

  /* biome-ignore lint/correctness/useExhaustiveDependencies: the stay having
     been taken is not a value this effect reads, it is the event the effect
     exists to answer — focus moves from the form to whatever replaced it. Only
     one of the two refs is mounted at a time. */
  useEffect(() => {
    (firstControl.current ?? doneControl.current)?.focus();
  }, [taken]);

  function change(patch: Partial<NewBookingFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  async function submit() {
    const attempt = newBookingInput(fields, businessDate);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);

    try {
      // The stay is `CONFIRMED` the moment this answers — `POST /bookings` is
      // the desk's own door and has no hold to confirm afterwards.
      setTaken(await create.mutateAsync(attempt.input));
    } catch {
      // Reported by `lib/query-client.ts`'s central toast. A refusal here is the
      // calendar or the inventory, and both are answered where they are decided.
    }
  }

  if (taken !== null && checkInFollows(taken, fields.kind, businessDate)) {
    return (
      <div className="border-border border-t p-4">
        <p className="text-muted-foreground text-sm">
          {taken.reference} is confirmed. The guest is at the counter, so the
          check-in follows here.
        </p>

        <CheckInSequence
          arrival={walkInArrival(taken)}
          rooms={rooms}
          // Abandoning the check-in does not undo the booking: the stay exists
          // and is confirmed, and it is in the arrivals queue for its date. The
          // panel closes and the list refetches with it in.
          onCancel={onDone}
          onCheckedIn={onDone}
        />
      </div>
    );
  }

  if (taken !== null) {
    return (
      <div className="border-border border-t p-4">
        <h2 className="font-semibold text-lg">
          {taken.reference} is confirmed
        </h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <Fact label="State" value={taken.state} />
          <Fact label="Sold as" value={taken.roomType} />
          <Fact label="Arriving" value={formatLongDate(taken.checkIn)} />
          <Fact label="Leaving" value={formatLongDate(taken.checkOut)} />
        </dl>
        <p className="text-muted-foreground mt-2 text-sm">
          It is in the arrivals queue on its date. Read the reference back to
          the guest — it is what they will give at the counter.
        </p>

        <div className="mt-2">
          <Button ref={doneControl} type="button" onClick={onDone}>
            Back to the bookings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="border-border border-t p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Choice
          label="Booking"
          selectRef={firstControl}
          value={fields.kind}
          options={BOOKING_KINDS}
          onChange={(kind) => {
            change({ kind });
          }}
        />
        <Choice
          label="Room type"
          value={fields.roomType}
          options={codeOptions(ROOM_TYPE_CODES)}
          onChange={(roomType) => {
            change({ roomType });
          }}
        />
        <Choice
          label="Rate plan"
          value={fields.plan}
          options={codeOptions(RATE_PLAN_CODES)}
          onChange={(plan) => {
            change({ plan });
          }}
        />
        {/* A walk-in is a guest standing at the counter, so its arrival is the
            property's own day and is not a question the desk is asked: the
            field shows that day and is read from rather than into. What is
            shown is what `newBookingInput` sends for this kind, so the two
            cannot disagree — and the operator cannot book next week down a
            path whose whole point is the check-in that follows it. */}
        <Field
          label="Arriving"
          value={fields.kind === "walk-in" ? businessDate : fields.checkIn}
          readOnly={fields.kind === "walk-in"}
          hint={
            fields.kind === "walk-in"
              ? "A walk-in arrives today."
              : "15/3, 2026-03-15, today, +2d"
          }
          onChange={(checkIn) => {
            change({ checkIn });
          }}
        />
        <Field
          label="Leaving"
          value={fields.checkOut}
          onChange={(checkOut) => {
            change({ checkOut });
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Adults"
            value={fields.adults}
            inputMode="numeric"
            onChange={(adults) => {
              change({ adults });
            }}
          />
          <Field
            label="Children"
            value={fields.childAges}
            hint="Ages: 5, 9"
            onChange={(childAges) => {
              change({ childAges });
            }}
          />
        </div>
        {/* Two more fields in the same grid and in the same tab order, because
            a contact is typed in the same breath as the dates — the operator
            has the guest on the telephone. They are last because the walk-in
            leaves them empty and reaches the button past them with one more
            Tab, and because Enter takes the booking from any of them. */}
        <Field
          label={
            fields.kind === "phone" ? "Guest name" : "Guest name (if given)"
          }
          value={fields.contactName}
          autoComplete="name"
          onChange={(contactName) => {
            change({ contactName });
          }}
        />
        <Field
          label={fields.kind === "phone" ? "Email" : "Email (if given)"}
          value={fields.contactEmail}
          inputMode="email"
          autoComplete="email"
          hint={
            fields.kind === "phone"
              ? "Receives confirmation and cancellation notices."
              : "Optional. Email requires a guest name."
          }
          onChange={(contactEmail) => {
            change({ contactEmail });
          }}
        />
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        {fields.kind === "walk-in"
          ? "Check-in follows immediately."
          : "Confirmed stays appear in Arrivals on their date."}
      </p>

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}

      <div className="mt-2 flex items-center gap-3">
        <Button type="submit" disabled={create.isPending}>
          Take the booking
        </Button>
        <span className="text-muted-foreground text-sm">
          Escape abandons it. Nothing is written until the press.
        </span>
      </div>
    </form>
  );
}

/** One row of a closed set: the code that travels, and what the desk reads. */
interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** The two conversations, in the operator's words rather than in the code's. */
const BOOKING_KINDS: readonly ChoiceOption<BookingKind>[] = [
  { value: "walk-in", label: "Walk-in — guest at the desk" },
  { value: "phone", label: "Telephone — arriving later" },
];

/** A contract code is its own label: the desk speaks these, and inventing a
 *  prettier word for `DELUXE` would be a second vocabulary for one room type. */
function codeOptions<T extends string>(
  codes: readonly T[],
): readonly ChoiceOption<T>[] {
  return codes.map((value) => ({ value, label: value }));
}

/**
 * One of a closed set, as the browser's own control.
 *
 * A native `<select>`, and it is the one place this feature does not reach for
 * `features/arrivals`' filter list. That control exists for sets the property
 * *has* — forty rooms, every guest it has met — where typing is how an operator
 * reaches the one they mean. Five room types and three rate plans are a closed
 * enum the browser already gives arrows, type-ahead and a native mobile picker,
 * and it counts as a form field everywhere the console asks whether somebody is
 * typing.
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
  options: readonly ChoiceOption<T>[];
  // The cast is the one the DOM obliges: `event.target.value` is a string, and
  // what constrains it to the set is that the `<option>`s below are drawn from
  // that set and nothing else.
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

function Field({
  label,
  hint,
  value,
  onChange,
  inputMode,
  readOnly = false,
  autoComplete = "off",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange(value: string): void;
  /* A value the form decides and the operator reads. Read-only rather than
   * disabled: a disabled field leaves the tab order, and the arriving date is
   * something the desk looks at while working down the form — it is answered
   * here, not withheld. The hint beside it says who answered it. */
  readOnly?: boolean;
  /* The keyboard a phone offers, and nothing more. Deliberately not
   * `type="email"`: that hands validation to the browser, which refuses the
   * submit with a bubble of its own wording — and every other refusal on this
   * form is a sentence beside the field, decided by the contract's own schema
   * in `booking-search.ts`. Two refusal styles on one form is one of them the
   * operator cannot predict. */
  inputMode?: "numeric" | "email";
  autoComplete?: string;
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
        inputMode={inputMode}
        readOnly={readOnly}
        autoComplete={autoComplete}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      )}
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
