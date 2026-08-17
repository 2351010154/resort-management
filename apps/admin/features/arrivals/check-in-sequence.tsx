"use client";

import { formatVnd } from "@mariva/shared";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardRoom } from "@/features/housekeeping";
import { KeyboardLayer, useHotkeys } from "@/lib/keyboard";

import {
  type Arrival,
  assignableRooms,
  type CheckInStep,
  checkInRefusal,
  depositDue,
  type GuestHit,
  parseAmount,
  parseBirthDate,
  refusalSentence,
  refusalStep,
  roomRefusal,
  type SequenceFacts,
  sequenceSteps,
  stepAfter,
} from "./arrival-queue";
import {
  useAssignRoom,
  useBookingFolio,
  useCheckIn,
  useGuestMatches,
  usePostDeposit,
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
 * Both are idempotent in the way that matters here: assigning the same room
 * twice leaves the booking holding that room, and the deposit step is left
 * behind once it is answered.
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

/** Which guest is going on the residence record. */
type ChosenGuest =
  | { readonly kind: "known"; readonly id: string; readonly name: string }
  | { readonly kind: "new"; readonly name: string };

/** What the document step collects, before any of it is trimmed or read. */
interface Particulars {
  fullName: string;
  cccdNumber: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
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
  const [deposit, setDeposit] = useState({
    amount: "",
    description: "Deposit taken at check-in",
  });
  const [posted, setPosted] = useState<bigint | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const folio = useBookingFolio(arrival.id);
  const due = folio.data === undefined ? 0n : depositDue(folio.data);

  const matches = useGuestMatches(guestQuery);
  const assignRoom = useAssignRoom();
  const postDeposit = usePostDeposit();
  const checkIn = useCheckIn();

  const facts: SequenceFacts = {
    knownGuest: guest?.kind === "known",
    // A deposit already posted inside this sequence is not a second one to
    // collect: the account is re-read after the posting, but the step is
    // finished either way.
    depositDue: due > 0n && posted === null,
  };

  const steps = sequenceSteps(facts);

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
    assignRoom.isPending || postDeposit.isPending || checkIn.isPending;

  /**
   * On to whatever the next step is, given what this one just settled.
   *
   * `learned` is not a convenience. State set in this handler is not readable
   * until the next render, so a step that decided how many steps there are —
   * the guest step, which drops the document step by naming somebody the
   * property already knows — would otherwise be routed against the answer that
   * was true before the operator pressed Enter, and send them to a form for a
   * record that already exists.
   */
  function advance(from: CheckInStep, learned: Partial<SequenceFacts> = {}) {
    setProblem(null);
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
      advance("guest", { knownGuest: false });
      return;
    }

    const known = matches.find((one) => one.id === id);

    if (known === undefined) {
      return;
    }

    setGuest({ kind: "known", id: known.id, name: known.fullName });
    advance("guest", { knownGuest: true });
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

  function submitParticulars() {
    const name = particulars.fullName.trim();

    if (name === "") {
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

    advance("identity");
  }

  async function submitDeposit() {
    const amount = parseAmount(deposit.amount);

    if (amount === null) {
      setProblem(
        "A deposit is money handed over, so it is a figure above nothing.",
      );
      return;
    }

    if (deposit.description.trim() === "") {
      setProblem("The line needs a description — it is what the guest reads.");
      return;
    }

    try {
      await postDeposit.mutateAsync({
        bookingId: arrival.id,
        // Text on the way in, per `money.ts`: the contract decodes it back into
        // the `bigint` the ledger is counted in.
        amount: amount.toString(),
        description: deposit.description.trim(),
      });
    } catch {
      return;
    }

    setPosted(amount);
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
    <div className="border-border border-t p-4">
      <StepTrail steps={steps} current={step} />

      {step === "guest" ? (
        <FilterList
          inputRef={firstControl}
          label="Guest"
          hint="Type the name on the document. The property may already have them."
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
            Read from the guest's document. Nothing is stored but these
            particulars.
          </p>

          <div className="mt-rhythm-1 grid gap-3 sm:grid-cols-2">
            <Field
              label="Full name"
              inputRef={firstControl}
              value={particulars.fullName}
              onChange={(fullName) => {
                setParticulars((current) => ({ ...current, fullName }));
              }}
              required
            />
            <Field
              label="CCCD number"
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
            <Field
              label="Telephone"
              value={particulars.phone}
              onChange={(phone) => {
                setParticulars((current) => ({ ...current, phone }));
              }}
            />
          </div>
        </Step>
      ) : null}

      {step === "room" ? (
        <FilterList
          inputRef={firstControl}
          label="Room"
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

          <div className="mt-rhythm-1 grid gap-3 sm:grid-cols-2">
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
        </Step>
      ) : null}

      {step === "review" ? (
        <Step
          onSubmit={submitCheckIn}
          busy={busy}
          confirm="Check in"
          confirmRef={confirmControl}
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Fact label="Stay" value={arrival.reference} />
            <Fact label="Guest" value={guest?.name ?? "Nobody named"} />
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
            <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
              The account could not be read, so no deposit was offered. Check
              the folio after the guest is in the room.
            </p>
          ) : null}
        </Step>
      ) : null}

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}

      <p className="text-muted-foreground mt-rhythm-1 text-xs">
        Escape abandons the check-in. Nothing already posted is undone by it.
      </p>
    </div>
  );
}

/** Where the operator is, and how much of the sequence is left. */
function StepTrail({
  steps,
  current,
}: {
  steps: readonly CheckInStep[];
  current: CheckInStep;
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

const STEP_LABELS: Record<CheckInStep, string> = {
  guest: "Guest",
  identity: "Document",
  room: "Room",
  deposit: "Deposit",
  review: "Check in",
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

function roomHint(arrival: Arrival, held: string | null): string {
  const sold = `Ready ${arrival.roomType} rooms with nobody in them.`;

  return held === null ? sold : `${sold} The stay currently holds ${held}.`;
}

/**
 * The person, in the shape `checkInGuestSchema` discriminates on.
 *
 * A guest the property already has is named by id and nothing else: the union's
 * first branch drops any details beside it, and sending them would either be
 * ignored or create the duplicate record the CCCD's unique key refuses.
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

function orNothing(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}
