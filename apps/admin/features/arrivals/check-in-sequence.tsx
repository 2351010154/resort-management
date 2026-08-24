"use client";

import { formatVnd } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { KeyHint, StepTrail } from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BoardRoom } from "@/features/housekeeping";
import { OpenDrawerForm } from "@/features/shifts/drawer-forms";
import { cashDrawerRefusal } from "@/features/shifts/shift-day";
import {
  type DeskPaymentFields,
  type DeskPaymentMethod,
  deskPaymentAttempt,
  METHOD_LABELS,
  OFFERED_PAYMENT_METHODS,
} from "@/lib/desk-payment";
import { KeyboardLayer, useHotkeys } from "@/lib/keyboard";

import {
  type Arrival,
  assignableRooms,
  type CheckInStep,
  type ChosenGuest,
  checkInRefusal,
  depositDue,
  documentTranscription,
  type GuestHit,
  orNothing,
  type Particulars,
  parseBirthDate,
  refusalSentence,
  refusalStep,
  roomRefusal,
  type SequenceFacts,
  sequenceSteps,
  stepAfter,
  transcriptionRefusal,
} from "./arrival-queue";
import {
  useAssignRoom,
  useBookingFolio,
  useCheckIn,
  useGuestMatches,
  usePostDeposit,
  useTranscribeDocument,
} from "./arrivals-queries";
import { FilterList, type FilterOption } from "./filter-list";

/* The check-in, worked where the row is.
 *
 * `screens.md` §"Staff surfaces" describes this screen as a worked queue and
 * not a report, and the sequence being *in place* is most of what that means:
 * check-in happens in bursts — ten guests at two o'clock — and a detour to a
 * booking detail and back costs the operator their place in the queue every
 * time. So the row expands, the sequence is worked, and the queue is still
 * underneath it.
 *
 * It is drawn as a panel inset into the queue and not as more table. The rows
 * around it are a list being read; this is the one stay being worked, and a
 * block that bled the full width of the table with a hairline over it read as
 * six more columns nobody had a heading for.
 *
 * ## The keyboard contract
 *
 * `NFR-11` requires the whole of this to be reachable with no pointer, and the
 * shape below is what makes that true rather than merely possible:
 *
 * - **Enter is always "yes, that one, go on."** Every step is a `<form>`, so the
 *   key that finishes a field is the key that finishes the step, and no step
 *   needs the operator to find a button.
 * - **Tab moves inside the step and never out of the sequence by accident.**
 *   The expansion is rendered after its own row in the document, so tabbing from
 *   the row lands in the first field of the step rather than in the next row.
 * - **Escape abandons it.** Bound in a {@link KeyboardLayer}, so it outranks
 *   whatever the queue underneath has bound — `keyboard-layer.tsx` describes
 *   this exact case, an arrivals screen that mounts a row and its open sequence
 *   in one commit.
 * - **Focus follows the step.** Each step focuses its own first control on
 *   arrival, so the operator never has to go looking for where they now are.
 *
 * ## The order of the writes, and why it is not one press
 *
 * The room is assigned when the room step is answered and the deposit is posted
 * when the deposit step is answered, rather than both being held back and fired
 * with the check-in. Two reasons. The first is that a refusal has to land on the
 * control that caused it: a room somebody else took thirty seconds ago must be
 * refused at the assignment field, where the operator picks another, and not
 * inside a check-in that has already posted money. The second is that the API
 * does not offer the alternative — `booking.check-in` refuses a stay holding no
 * room, so the assignment is a separate call whatever this screen does with it.
 *
 * A returning guest's document particulars are written on the same rule and for
 * the same first reason — a number the property already holds on somebody else
 * has to be refused where the digits were typed. `FR-GST-02` adds one of its
 * own: Nghị định 96/2016/NĐ-CP Điều 44 wants the particulars recorded *before*
 * the room changes hands, and a write ordered after the transition would be a
 * stay that began without them every time the second call failed. A guest being
 * registered now is the exception that proves the shape — they have no id yet,
 * so their particulars travel inside the check-in that creates the record.
 *
 * All three are idempotent in the way that matters here: assigning the same
 * room twice leaves the booking holding that room, the deposit step is left
 * behind once it is answered, and the same three particulars sent twice leave
 * the guest record saying exactly what the card said. So a step that refuses is
 * a step the operator presses again, and Escape after any of them abandons the
 * check-in without unsaying what was already true.
 *
 * ## Landing the room refusal
 *
 * "Refused at the assignment field" is worked out in {@link Sequence.chooseRoom}
 * and is two acts, not one. The sentence is written into the step, because the
 * central toast in `lib/query-client.ts` dismisses itself and sits nowhere near
 * the control — an operator who looked away for a moment is left with a press
 * that did nothing and no account of why. And the room comes off the offered
 * list, because the list is drawn from a board that only knows about tonight
 * while the API refuses across every night of the stay: leaving the number
 * highlighted under the operator's fingers means the next Enter buys the same
 * refusal. {@link roomRefusal} decides which refusals are worth that — see it
 * for why a hold is different from a room that merely would not take.
 */

export interface CheckInSequenceProps {
  arrival: Arrival;
  /**
   * Every room on the board — the assignment control narrows this itself.
   *
   * Never empty for want of an answer: a board that did not load fails the
   * whole queue, so there is no row to open a sequence from. An empty list here
   * is a property with nothing ready of the type this stay was sold.
   */
  rooms: readonly BoardRoom[];
  /** Escape, or a step the operator backed out of. */
  onCancel(): void;
  /** The stay is in the building. The queue moves to the next arrival. */
  onCheckedIn(): void;
}

/** The synthetic row that registers whoever is being typed. */
const REGISTER_NEW = "register-new-guest";

export function CheckInSequence(props: CheckInSequenceProps) {
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
  arrival,
  rooms,
  onCancel,
  onCheckedIn,
}: CheckInSequenceProps) {
  const [step, setStep] = useState<CheckInStep>("guest");
  const [guestQuery, setGuestQuery] = useState("");
  const [guest, setGuest] = useState<ChosenGuest | null>(null);
  const [particulars, setParticulars] = useState<Particulars>({
    fullName: "",
    cccdNumber: "",
    dateOfBirth: "",
    nationality: "",
    phone: "",
  });
  const [roomQuery, setRoomQuery] = useState("");
  const [roomNumber, setRoomNumber] = useState<string | null>(
    arrival.roomNumber,
  );
  // The numbers the API has already declined for this stay. State of the
  // sequence and not of the board, because it is an answer about these nights:
  // it is right that it is forgotten when the operator abandons the row and
  // asked again for the next guest.
  const [refusedRooms, setRefusedRooms] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [deposit, setDeposit] = useState<DeskPaymentFields>({
    amount: "",
    // Unanswered, and it stays unanswered until the operator says so. The desk
    // is the only party that knows whether the notes were counted or the
    // transfer landed, and a form opening on an answer would be the console
    // making one up in the one moment somebody could have stated it.
    method: null,
    description: "Deposit taken at check-in",
  });
  const [posted, setPosted] = useState<bigint | null>(null);
  // Whether the deposit step is also asking for a drawer to count the notes
  // into. State of this sequence rather than of the shift, because the drawer
  // itself is read by the shell's bar: what this remembers is only that a press
  // on this step was refused for the want of one.
  const [drawerNeeded, setDrawerNeeded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const folio = useBookingFolio(arrival.id);
  const due = folio.data === undefined ? 0n : depositDue(folio.data);

  const matches = useGuestMatches(guestQuery);
  const assignRoom = useAssignRoom();
  const postDeposit = usePostDeposit();
  const transcribe = useTranscribeDocument();
  const checkIn = useCheckIn();

  const facts: SequenceFacts = {
    // A deposit already posted inside this sequence is not a second one to
    // collect: the account is re-read after the posting, but the step is
    // finished either way.
    depositDue: due > 0n && posted === null,
  };

  const steps = sequenceSteps(facts);

  /** The guest as a record that already exists, or null while there is none. */
  const known = guest?.kind === "known" ? guest : null;

  // The first control of whichever step is showing, re-focused on every step
  // change so the operator's hands never leave the keys to find out where the
  // sequence went. The review step has no field of its own — what it asks for
  // is the press — so the confirming button is the target there, and the two
  // refs are read in that order because only one of them is mounted at a time.
  const firstControl = useRef<HTMLInputElement>(null);
  const confirmControl = useRef<HTMLButtonElement>(null);

  /* biome-ignore lint/correctness/useExhaustiveDependencies: the step is not a
     value this effect reads, it is the event the effect exists to answer. The
     refs are read at the moment it runs, and dropping the dependency would
     focus the first control once and never again. */
  useEffect(() => {
    (firstControl.current ?? confirmControl.current)?.focus();
  }, [step]);

  useHotkeys("escape", onCancel, { enableInFormField: true });

  const busy =
    assignRoom.isPending ||
    postDeposit.isPending ||
    transcribe.isPending ||
    checkIn.isPending;

  /**
   * On to whatever the next step is, given what this one just settled.
   *
   * `learned` is not a convenience. State set in this handler is not readable
   * until the next render, so a step that decided how many steps there are —
   * the deposit step, which the posting it takes removes — would otherwise be
   * routed against the answer that was true before the operator pressed Enter,
   * and send them back to a step they have just finished.
   */
  function advance(from: CheckInStep, learned: Partial<SequenceFacts> = {}) {
    setProblem(null);
    // With the sentence that asked for it, because the form under the deposit
    // step is offered on one refusal and nothing else. Left standing, it would
    // reappear on a later return to that step with nothing on screen saying
    // why.
    setDrawerNeeded(false);
    const next = stepAfter(sequenceSteps({ ...facts, ...learned }), from);

    if (next === null) {
      return;
    }

    if (next === "deposit") {
      // Prefilled with what the account is short, because that is what the
      // guest is being asked for — and editable, because a desk taking part of
      // it is a normal thing to do.
      setDeposit((current) => ({ ...current, amount: due.toString() }));
    }

    setStep(next);
  }

  function chooseGuest(id: string) {
    const typed = guestQuery.trim();

    if (id === REGISTER_NEW) {
      setGuest({ kind: "new", name: typed });
      setParticulars((current) => ({ ...current, fullName: typed }));
      advance("guest");
      return;
    }

    const hit = matches.find((one) => one.id === id);

    if (hit === undefined) {
      return;
    }

    setGuest({
      kind: "known",
      id: hit.id,
      name: hit.fullName,
      // Carried forward so the document step can show what the property
      // already holds. Masked, because a queue is not `guest.unmask-cccd`.
      cccdMasked: hit.cccdMasked,
    });
    advance("guest");
  }

  async function chooseRoom(number: string) {
    try {
      await assignRoom.mutateAsync({
        bookingId: arrival.id,
        roomNumber: number,
      });
    } catch (error) {
      const refusal = roomRefusal(error, number);

      // The central toast has said it too, and says it once and briefly. This
      // is the copy that stays beside the field until the operator has picked
      // something the property will accept.
      setProblem(refusal.sentence);

      if (refusal.spokenFor) {
        setRefusedRooms((already) => new Set(already).add(number));
        // The refused number is cleared out of the field with it, so what is
        // left under the operator is the rooms that are still worth trying
        // rather than an empty list and a number that will never be taken.
        setRoomQuery("");
      }

      return;
    }

    setRoomNumber(number);
    advance("room");
  }

  /**
   * The document step, answered — and for a returning guest, recorded.
   *
   * The write happens here rather than being held back to the check-in, which
   * is the order the room and the deposit are written in and is that argument
   * applied to a third write: a number the property already has on another
   * record must be refused at the field the digits were typed into, where the
   * operator can read them again, and not inside a check-in that has already
   * assigned a room and posted money. It is also the order Điều 44 asks for —
   * the particulars are on the record before the room changes hands, not
   * after — and the one that survives an abandoned sequence honestly: what was
   * read off the card is true of that person whether or not this stay goes on,
   * which is what the step's own footnote says about a posted deposit.
   *
   * Safe to repeat, because the route is. A refusal leaves the sequence on this
   * step with the fields as they were, so Enter sends the same three facts
   * again and the record ends up saying what the card says.
   *
   * A guest being registered now writes nothing here: their particulars travel
   * with the check-in that creates them, in that transition's transaction.
   */
  async function submitParticulars() {
    const newGuest = guest?.kind !== "known";

    if (newGuest && particulars.fullName.trim() === "") {
      setProblem("The residence record needs the guest's name.");
      return;
    }

    if (
      particulars.dateOfBirth.trim() !== "" &&
      parseBirthDate(particulars.dateOfBirth) === null
    ) {
      setProblem("Write the date of birth as YYYY-MM-DD.");
      return;
    }

    const read = documentTranscription(guest, particulars);

    if (read !== null) {
      try {
        await transcribe.mutateAsync(read);
      } catch (error) {
        // Beside the field, for `chooseRoom`'s reason: the central toast says
        // it once and briefly, and an operator who looked away is left with a
        // press that did nothing and no account of why.
        setProblem(transcriptionRefusal(error));
        return;
      }
    }

    advance("identity");
  }

  async function submitDeposit() {
    const attempt = deskPaymentAttempt(
      arrival.id,
      deposit,
      "A deposit is money handed over, so it is a figure above nothing.",
    );

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    // Both cleared together, because they are one state: the sentence below is
    // only ever written beside the form, and a press that gets a different
    // answer would otherwise leave "count the till in below" standing over a
    // form that is no longer there.
    setDrawerNeeded(false);
    setProblem(null);

    try {
      await postDeposit.mutateAsync(attempt.payment);
    } catch (error) {
      // The same one refusal the checkout sequence reads, for the same reason:
      // a deposit handed over in cash belongs to a drawer, and an operator on
      // none is holding notes with nowhere to count them. Everything else is
      // reported by `lib/query-client.ts`'s central toast.
      if (cashDrawerRefusal(error) === "NO_OPEN_SHIFT") {
        setDrawerNeeded(true);
        setProblem(
          "There is no cash drawer open in your name, and cash belongs to a drawer or the day's variance means nothing. Count the till in below — the same press takes the deposit.",
        );
      }

      return;
    }

    setPosted(BigInt(attempt.payment.amount));
    advance("deposit", { depositDue: false });
  }

  async function submitCheckIn() {
    if (guest === null) {
      setProblem("Nobody has been named for the residence record.");
      return;
    }

    try {
      await checkIn.mutateAsync({
        bookingId: arrival.id,
        // One person: the booking holder, who is the registration the
        // transition exists to write. Other occupants are added on the stay
        // itself, which is not a queue's work.
        guests: [asCheckInGuest(guest, particulars)],
      });
    } catch (error) {
      const code = checkInRefusal(error);

      if (code === null) {
        return;
      }

      setProblem(refusalSentence(code));
      setStep(refusalStep(code));
      return;
    }

    onCheckedIn();
  }

  return (
    // Two ceilings on the width. The first is a readable measure, because a
    // form stretched across a sixteen-hundred-pixel queue is a form whose
    // labels and fields are a hand's width apart. The second is the window: the
    // queue behind this sets a minimum width and scrolls sideways under it, and
    // a panel that inherited that would make a desk on a small screen scroll to
    // reach the field they are typing into.
    <div className="max-w-[min(48rem,calc(100vw_-_5rem))] rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5">
      <StepTrail
        sequence="Check-in"
        steps={steps}
        current={step}
        labels={STEP_LABELS}
      />

      {step === "guest" ? (
        // The field names itself and not the step. The trail immediately above
        // already names this step "Guest", and a caps label under it saying
        // GUEST again read as a stutter rather than as two different things.
        <FilterList
          inputRef={firstControl}
          label="Name on the document"
          hint="Whoever the property already holds, or a new record."
          placeholder="Nguyễn Thị Hương"
          query={guestQuery}
          onQueryChange={setGuestQuery}
          options={guestOptions(matches, guestQuery)}
          onPick={chooseGuest}
          emptyMessage="Type the guest's name to look them up or register them."
        />
      ) : null}

      {step === "identity" ? (
        <Step
          onSubmit={submitParticulars}
          busy={busy}
          confirm="Particulars taken"
        >
          <p className="text-muted-foreground text-sm">
            {/* The desk scanner emulates a keyboard, so every field here takes
                a scan exactly as it takes typing — `screens.md` puts typed
                input first for that reason. `FR-GST-02`: the particulars are
                transcribed and the image is never stored, which is why there
                is nothing to upload on this step. */}
            {known === null
              ? "Read from the guest's document. Nothing is stored but these particulars."
              : whatIsOnFile(known)}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {/* The name is the new guest's to give and the returning guest's
                already: their record was found by it, and the transcription
                route takes no name — a box that writes nothing is worse than
                no box, because a desk that corrects a misspelling in it would
                be told the correction landed. */}
            {known === null ? (
              <Field
                label="Full name"
                inputRef={firstControl}
                value={particulars.fullName}
                onChange={(fullName) => {
                  setParticulars((current) => ({ ...current, fullName }));
                }}
                required
              />
            ) : null}
            <Field
              label="CCCD number"
              inputRef={known === null ? undefined : firstControl}
              value={particulars.cccdNumber}
              onChange={(cccdNumber) => {
                setParticulars((current) => ({ ...current, cccdNumber }));
              }}
            />
            <Field
              label="Date of birth"
              placeholder="YYYY-MM-DD"
              value={particulars.dateOfBirth}
              onChange={(dateOfBirth) => {
                setParticulars((current) => ({ ...current, dateOfBirth }));
              }}
            />
            <Field
              label="Nationality"
              value={particulars.nationality}
              onChange={(nationality) => {
                setParticulars((current) => ({ ...current, nationality }));
              }}
            />
            {/* The telephone is not a particular of a document and the
                transcription route does not take one. It stays on the new
                guest's form, where it travels with the record being created. */}
            {known === null ? (
              <Field
                label="Telephone"
                value={particulars.phone}
                onChange={(phone) => {
                  setParticulars((current) => ({ ...current, phone }));
                }}
              />
            ) : null}
          </div>
        </Step>
      ) : null}

      {step === "room" ? (
        <FilterList
          inputRef={firstControl}
          label="Room number"
          hint={roomHint(arrival, roomNumber)}
          placeholder="204"
          query={roomQuery}
          onQueryChange={setRoomQuery}
          options={roomOptions(rooms, arrival, roomQuery, refusedRooms)}
          onPick={(number) => {
            void chooseRoom(number);
          }}
          emptyMessage={nothingToOffer(arrival, refusedRooms)}
        />
      ) : null}

      {step === "deposit" ? (
        <Step onSubmit={submitDeposit} busy={busy} confirm="Post the deposit">
          <p className="text-muted-foreground text-sm">
            The account is short {formatVnd(due)}. Post what the guest hands
            over — the rest stays outstanding.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label="Amount"
              inputRef={firstControl}
              value={deposit.amount}
              inputMode="numeric"
              onChange={(amount) => {
                setDeposit((current) => ({ ...current, amount }));
              }}
              required
            />
            <Field
              label="Description"
              value={deposit.description}
              onChange={(description) => {
                setDeposit((current) => ({ ...current, description }));
              }}
              required
            />
          </div>

          <MethodChoice
            value={deposit.method}
            onChange={(method) => {
              setDeposit((current) => ({ ...current, method }));
            }}
          />
        </Step>
      ) : null}

      {step === "deposit" && drawerNeeded ? (
        /* A sibling of the step's form and under it, not over it — the amount,
         * the description and the method the operator already chose stay on
         * screen, because the press below re-posts them. A form nested inside
         * another one is also not a form the browser will submit. */
        <div className="border-border mt-4 border-t pt-3">
          <p className="text-muted-foreground text-xs tracking-caps uppercase">
            Open a drawer
          </p>
          <OpenDrawerForm
            confirm="Open the drawer and post the deposit"
            onOpened={async () => {
              setDrawerNeeded(false);
              // The deposit again, on the same press, with the same figure and
              // the same method — the second half of an act the operator asked
              // for by pressing a button that says so, not a retry the console
              // decided on.
              await submitDeposit();
            }}
          />
        </div>
      ) : null}

      {step === "review" ? (
        <Step
          onSubmit={submitCheckIn}
          busy={busy}
          confirm="Check in"
          confirmRef={confirmControl}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Fact label="Stay" value={arrival.reference} />
            <Fact label="Guest" value={guest?.name ?? "Nobody named"} />
            <Fact label="Document" value={documentFact(guest, particulars)} />
            <Fact label="Room" value={roomNumber ?? "None held"} />
            <Fact
              label="Deposit"
              value={
                posted === null
                  ? due > 0n
                    ? `${formatVnd(due)} still outstanding`
                    : "Nothing due"
                  : `${formatVnd(posted)} posted`
              }
            />
          </dl>

          {folio.isError ? (
            <p className="border-destructive text-destructive mt-3 border-l-2 pl-3 text-sm">
              The account could not be read, so no deposit was offered. Check
              the folio after the guest is in the room.
            </p>
          ) : null}
        </Step>
      ) : null}

      {problem === null ? null : (
        // Announced as well as written. The sentence arrives from a round trip
        // the operator has already stopped watching for, and a refusal that
        // only appears on screen is one a desk working by keyboard never hears.
        <p
          className="border-destructive text-destructive mt-3 border-l-2 pl-3 text-sm"
          role="alert"
        >
          {problem}
        </p>
      )}

      {/* The two keys the whole sequence is worked with, drawn as chips rather
          than described in a sentence — the console shows a shortcut the way
          the shell and the palette show one. */}
      <p className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-t pt-3 text-sm">
        <span className="inline-flex items-center gap-2">
          <KeyHint>Enter</KeyHint>
          finishes the step
        </span>
        <span className="inline-flex items-center gap-2">
          <KeyHint>Esc</KeyHint>
          abandons the check-in — nothing already posted is undone by it
        </span>
      </p>
    </div>
  );
}

/** The words each step of a check-in is drawn with in the trail. */
const STEP_LABELS: Record<CheckInStep, string> = {
  guest: "Guest",
  identity: "Document",
  room: "Room",
  deposit: "Deposit",
  review: "Check in",
};

/**
 * One step of the sequence: fields, and the press that finishes them.
 *
 * The button in flight is `aria-disabled` and not `disabled`, and the second
 * press is dropped here instead. A control that goes disabled under the
 * operator's finger hands focus to `<body>`, which is exactly what the review
 * step cannot afford: it is the one step whose first control *is* the button,
 * so a refusal that leaves the sequence where it was would leave the desk with
 * the sentence explaining it and nothing to press. Both spellings refuse the
 * same second press, and only one of them keeps the keys.
 */
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

        if (busy) {
          return;
        }

        void onSubmit();
      }}
    >
      {children}

      <div className="mt-4">
        <Button
          ref={confirmRef}
          type="submit"
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
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
 * hides both behind a press that opens a listbox, and the answer a desk gives
 * every time it takes money is not worth a second control's worth of keys. The
 * options are {@link OFFERED_PAYMENT_METHODS}, which is the contract's own list
 * with the gateway excluded — this step cannot offer a method the API would
 * refuse, and cannot invent the one only the IPN handler may write.
 *
 * Nothing is selected when the step opens, and that is the whole point of the
 * control. A group arriving with "Cash" already highlighted is a default
 * wearing a radio button, and an operator who tabs past it has recorded an
 * answer they never gave — onto a ledger that is append-only and cannot be
 * asked again.
 *
 * ## Enter, restored
 *
 * This sequence promises that Enter finishes the step from wherever the
 * operator is standing, and a radio is the one control where that is not free:
 * WAI-ARIA says a radio group is not activated by Enter, so Radix suppresses
 * the key, and a desk that chose a method and pressed Enter would meet nothing
 * happening. The group asks its own form to submit instead, which is what every
 * field of every other step already does.
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
    <fieldset className="mt-4">
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
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

/** The people the lookup found, and the row that registers a new one. */
function guestOptions(
  matches: readonly GuestHit[],
  typed: string,
): FilterOption[] {
  const options: FilterOption[] = matches.map((one) => ({
    id: one.id,
    label: one.fullName,
    // What tells two people with the same name apart. The number is the
    // property's masked one — `FR-GST-03` — because nothing outside
    // `guest.unmask-cccd` may show the digits, and a queue is not that route.
    detail: [one.phone, one.cccdMasked]
      .filter((fact) => fact !== null)
      .join(" · "),
  }));

  const name = typed.trim();

  if (name !== "") {
    options.push({
      id: REGISTER_NEW,
      label: `Register “${name}” as a new guest`,
      detail: "Their document is taken next",
    });
  }

  return options;
}

/** The rooms this stay may be walked into, as rows. */
function roomOptions(
  rooms: readonly BoardRoom[],
  arrival: Arrival,
  typed: string,
  refused: ReadonlySet<string>,
): FilterOption[] {
  return assignableRooms(rooms, arrival.roomType, typed, refused).map(
    (room) => ({
      id: room.roomNumber,
      label: room.roomNumber,
      detail: `Floor ${room.floor} · ${room.status.toLowerCase()}`,
    }),
  );
}

/**
 * Why there is nothing to pick, which is two different afternoons.
 *
 * A property with nothing ready of the type is housekeeping's to fix and is the
 * same answer for every stay sold that type today. A list emptied by refusals
 * is about these nights and this stay — the rooms exist and are clean, they are
 * simply spoken for — and the way out of it is a shorter stay or a different
 * type, which is a manager's decision and not a queue's. Saying "no ready room
 * is free" for the second one would send the desk to ring housekeeping about
 * rooms housekeeping has already released.
 */
function nothingToOffer(
  arrival: Arrival,
  refused: ReadonlySet<string>,
): string {
  return refused.size === 0
    ? `No ready ${arrival.roomType} is free. Housekeeping releases one, or the stay needs a different type.`
    : `Every ready ${arrival.roomType} is held by another stay across these nights. The stay needs a different type or different dates.`;
}

/**
 * What the property already holds about this guest's document, said on the step
 * that would otherwise ask for it again.
 *
 * The masked number and never the digits — `FR-GST-03` puts the reveal behind
 * its own capability and its own audit row, and the Guests screen is where that
 * control lives. Masked is enough for what this step is for: a receptionist
 * looking at the last four on the card in their hand can see the property has
 * this person's number and leave the box alone.
 */
function whatIsOnFile(known: Extract<ChosenGuest, { kind: "known" }>): string {
  return known.cccdMasked === null
    ? `The property has no identity number for ${known.name}. Read one off their document — an empty box records nothing.`
    : `The property holds ${known.cccdMasked} for ${known.name}. Leave a box empty to keep what is on file; type to correct it.`;
}

/**
 * What the review says about the residence record's identity particulars.
 *
 * Three different afternoons. A guest being registered now carries their
 * document into the check-in itself, so nothing has been written yet and the
 * line says so. A returning guest whose document was read at this desk has
 * already had it recorded — the step wrote it — and one whose box was left
 * empty is shown what the property had before they arrived, which is the fact
 * the operator is confirming.
 */
function documentFact(
  guest: ChosenGuest | null,
  particulars: Particulars,
): string {
  if (guest === null) {
    return "Nobody named";
  }

  if (guest.kind === "new") {
    return orNothing(particulars.cccdNumber) === null
      ? "No number taken"
      : "Taken with the registration";
  }

  if (documentTranscription(guest, particulars) !== null) {
    return "Recorded from the document";
  }

  return guest.cccdMasked ?? "Nothing on file";
}

function roomHint(arrival: Arrival, held: string | null): string {
  const sold = `Ready, vacant ${arrival.roomType} rooms.`;

  return held === null ? sold : `${sold} Holding ${held}.`;
}

/**
 * The person, in the shape `checkInGuestSchema` discriminates on.
 *
 * A guest the property already has is named by id and nothing else: the union's
 * first branch drops any details beside it, and sending them would either be
 * ignored or create the duplicate record the CCCD's unique key refuses. What
 * the desk typed about them went to `guest.transcribeDocument` at the document
 * step instead — {@link documentTranscription} — which is a write onto the
 * person and not onto the stay.
 *
 * A blank optional field travels as `null` rather than as `""`. The contract
 * takes both — every one of them is `nullish` — and the empty string is the
 * dishonest one: `guest.service.ts` writes a blank straight into a column the
 * partial unique index over the CCCD then treats as a value, and a registration
 * carrying `""` for a telephone number claims a fact nobody gave.
 */
function asCheckInGuest(guest: ChosenGuest, particulars: Particulars) {
  if (guest.kind === "known") {
    return { guestId: guest.id };
  }

  return {
    fullName: particulars.fullName.trim(),
    phone: orNothing(particulars.phone),
    cccdNumber: orNothing(particulars.cccdNumber),
    nationality: orNothing(particulars.nationality),
    // Already known to parse: the identity step refuses to advance past a birth
    // date it cannot read, so `null` here is a field left blank.
    dateOfBirth: parseBirthDate(particulars.dateOfBirth),
  };
}
