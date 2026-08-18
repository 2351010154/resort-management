"use client";

import type { StaffRole } from "@mariva/shared";
import { useId, useRef, useState } from "react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchCriteria } from "@/features/bookings/booking-search";
import { useStaffSession } from "@/lib/auth";
import {
  RovingFocusGroup,
  useHotkeys,
  useRovingFocusItem,
} from "@/lib/keyboard";
import { cn } from "@/lib/utils";

import {
  type GuestFact,
  type GuestHit,
  type GuestRecord,
  type GuestSearchFields,
  guestFacts,
  guestSearchCriteria,
  mayRevealCccd,
  NO_GUEST_SEARCH_FIELDS,
  revealAttempt,
  revealNotice,
} from "./guest-record";
import {
  useGuestRecord,
  useGuestSearch,
  useRevealCccd,
} from "./guests-queries";

/* The guest record, and the one control that reveals an identity number.
 *
 * `docs/screens.md` §"Staff surfaces" states the whole of it: "Guests shows the
 * record with its identity number masked; the number carries a reveal control
 * that shows the value in place, writes one audit entry, and re-masks when the
 * staff member leaves the record. Revealing is per field and per visit so an
 * audit entry means exactly 'this person looked at this number once' — the
 * strongest story the audit log can tell."
 *
 * ## The reveal is a visit, not a mode
 *
 * Three things hold it to that sentence, and none of them is a rule this
 * component remembers to apply:
 *
 * - **Nothing reveals on arrival.** The number arrives through a mutation and a
 *   mutation only fires when somebody presses it, so there is no render path —
 *   no prefetch, no refetch on window focus, no retry — that can file a reading
 *   nobody performed. `contract/guest.ts` makes the same argument about why the
 *   route is a POST.
 * - **The reading belongs to the record it was made on.** {@link GuestDetail} is
 *   keyed by the guest, so choosing another person unmounts the control holding
 *   the number along with everything else about the previous one. There is no
 *   screen-wide "unmasked" flag for a second record to inherit.
 * - **Leaving is forgetting.** `guests-queries.ts` drops the mutation on unmount
 *   rather than letting it sit in the cache, so coming back is a second reading
 *   and is filed as one.
 *
 * ## Finding somebody
 *
 * `search.operational`, which is the search the bookings screen already runs —
 * one route, one cache entry, and the two dimensions that are facts about a
 * person. There is no route that lists every guest the property has, so this
 * screen opens on an empty search rather than on a table, and says so.
 *
 * ## The keyboard
 *
 * `/` puts the caret in the search, as it does on Bookings. The candidate list
 * is **one Tab stop** with the arrows moving inside it — a
 * {@link RovingFocusGroup} — and the detail follows it in the document, so Tab
 * from a person falls into their record and the reveal control rather than into
 * the next candidate.
 *
 * `g g` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * **No animation.** Operational surfaces carry no entrance motion, and every
 * control on this screen answers the press immediately: the search paints its
 * own pending line and the reveal disables in place.
 */

export function GuestsScreen() {
  const session = useStaffSession();
  const [fields, setFields] = useState<GuestSearchFields>(
    NO_GUEST_SEARCH_FIELDS,
  );
  // `null` is the screen before anybody has searched. A search replaces it
  // wholesale rather than narrowing an answer, because the criteria the API
  // takes are its own.
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<GuestHit | null>(null);

  const list = useGuestSearch(criteria);
  const nameField = useRef<HTMLInputElement>(null);

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;

  useHotkeys("/", () => {
    nameField.current?.focus();
    nameField.current?.select();
  });

  function runSearch() {
    const attempt = guestSearchCriteria(fields);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    setCriteria(attempt.criteria);
    // The record open beside the list is closed by a new search, which is the
    // re-masking `screens.md` asks for: searching again is leaving the record,
    // and a number read for the previous person must not still be on screen
    // while a different list is drawn under it.
    setSelected(null);
  }

  return (
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Front desk
        </p>
        <h1 className="font-display text-display-sm mt-2">Guests</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          Find a guest by name or telephone number, and read their record. The
          identity number is masked until it is deliberately revealed, and every
          reading is recorded.
        </p>
      </header>

      <form
        className="mt-rhythm-2"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <Field
            label="Guest name"
            value={fields.fullName}
            inputRef={nameField}
            onChange={(fullName) => {
              setFields((current) => ({ ...current, fullName }));
            }}
          />
          <Field
            label="Telephone"
            value={fields.phone}
            onChange={(phone) => {
              setFields((current) => ({ ...current, phone }));
            }}
          />
        </div>

        {problem === null ? null : (
          <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
            {problem}
          </p>
        )}

        <div className="mt-rhythm-1 flex flex-wrap items-center gap-3">
          <Button type="submit">Search</Button>
          <span className="text-muted-foreground text-xs">
            / searches. The identity number is not searchable.
          </span>
        </div>
      </form>

      <div className="mt-rhythm-2 grid gap-rhythm-2 lg:grid-cols-[18rem_1fr]">
        <div>
          {list.status === "idle" ? (
            <p className="text-muted-foreground text-sm">
              Nobody yet. A guest is found by the name or the number the desk
              was given — there is no list of everybody the property has.
            </p>
          ) : null}

          {list.status === "pending" ? (
            <p className="text-muted-foreground text-sm" aria-busy>
              Looking for the guest.
            </p>
          ) : null}

          {list.status === "failed" ? (
            // The console's error device is a rule on the leading edge rather
            // than a colour: --color-destructive and --color-primary are the
            // same umber.
            <p className="border-destructive text-destructive border-l-2 pl-3 text-sm">
              The search could not be run. Nothing here is a statement about who
              the property has on file.
            </p>
          ) : null}

          {list.status === "ready" && list.guests.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody matches. A guest is on file once they have been registered
              at check-in, so somebody arriving tomorrow may not be here yet.
            </p>
          ) : null}

          {list.status === "ready" && list.guests.length > 0 ? (
            <>
              <RovingFocusGroup aria-label="Guests found">
                <ul>
                  {list.guests.map((guest) => (
                    <GuestRow
                      key={guest.id}
                      guest={guest}
                      selected={guest.id === selected?.id}
                      onSelect={() => {
                        setSelected(guest);
                      }}
                    />
                  ))}
                </ul>
              </RovingFocusGroup>

              {list.truncated ? (
                <p className="text-muted-foreground mt-rhythm-1 text-sm">
                  The search answers at most fifty people and has no second
                  page, so there may be somebody this list does not show. Narrow
                  it with a fuller name or the telephone number.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {selected === null || role === null ? (
          <p className="text-muted-foreground text-sm">
            Pick a guest to read their record.
          </p>
        ) : (
          /* Keyed by the guest, so choosing another person takes the whole of
             the previous record with it — a revealed number included. This is
             the re-masking on leaving a record, made structural rather than
             left to a handler to remember. */
          <GuestDetail key={selected.id} guest={selected} role={role} />
        )}
      </div>
    </div>
  );
}

/** One candidate in the list. */
function GuestRow({
  guest,
  selected,
  onSelect,
}: {
  guest: GuestHit;
  selected: boolean;
  onSelect(): void;
}) {
  const roving = useRovingFocusItem(guest.id);

  return (
    <li>
      <button
        {...roving}
        type="button"
        // The picked guest, for a screen reader as well as for the shading. The
        // record beside the list is what this state selects, so it is "current"
        // rather than "checked".
        aria-current={selected}
        onClick={onSelect}
        className={cn(
          "hover:bg-accent/40 focus-visible:bg-accent/40 flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm",
          selected ? "bg-accent/60" : null,
        )}
      >
        <span>{guest.fullName}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {/* What distinguishes one candidate from another, which is what the
              search is allowed to disclose. The masked number is here because
              two people with one name are told apart by it at the desk, with a
              document in hand — and it is masked on this path exactly as it is
              on the record. */}
          {guest.phone ?? "No telephone"} ·{" "}
          {guest.cccdMasked ?? "No identity number"}
        </span>
      </button>
    </li>
  );
}

/** A guest's record, and the reading their identity number can be put to. */
function GuestDetail({ guest, role }: { guest: GuestHit; role: StaffRole }) {
  const record = useGuestRecord(guest.id);

  return (
    <div className="border-border border-l pl-4">
      <h2 className="font-display text-2xl">
        {record.data?.fullName ?? guest.fullName}
      </h2>

      {record.isPending ? (
        <p className="text-muted-foreground mt-rhythm-1 text-sm" aria-busy>
          Reading the record.
        </p>
      ) : null}

      {record.isError ? (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          The record could not be read. What the search showed is all this
          screen knows about this guest.
        </p>
      ) : null}

      {record.data === undefined ? null : (
        <>
          <dl className="mt-rhythm-1 grid gap-3 text-sm sm:grid-cols-2">
            {guestFacts(record.data).map((fact) => (
              <Fact key={fact.label} fact={fact} />
            ))}
          </dl>

          <IdentityNumber record={record.data} role={role} />

          <p className="text-muted-foreground mt-rhythm-2 text-xs">
            {/* Said rather than implied: an operator looking for a stay list or
                a scan on this screen is owed the reason there is none. */}
            This record is the person, not their stays — a guest's bookings are
            found on Bookings (g b). No document image is kept anywhere: the
            document is checked at the desk and its particulars go on the
            registration.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The masked number, and the audited call that reads it once.
 *
 * The control is offered to the roles the matrix's *Unmask CCCD number* row
 * grants, and to nobody else — an accountant reaches this screen under the row
 * above it and is told where their read stops rather than being handed a button
 * that answers 403.
 *
 * A guest with no number on file gets no control at all. A reveal pressed
 * against nothing would file an audit entry recording a reading of a number the
 * property does not hold, and the contract's masked field is nullable precisely
 * so the two cases stay tellable apart.
 */
function IdentityNumber({
  record,
  role,
}: {
  record: GuestRecord;
  role: StaffRole;
}) {
  const reveal = useRevealCccd();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (record.cccdMasked === null) {
    return (
      <section className="mt-rhythm-2">
        <h3 className="text-sm">Identity number</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          None on file. It is taken from the document at check-in.
        </p>
      </section>
    );
  }

  const revealed = reveal.data;

  function press() {
    const attempt = revealAttempt(record.id, reason);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    reveal.mutate(attempt.input);
  }

  return (
    <section className="mt-rhythm-2">
      <h3 className="text-sm">Identity number</h3>

      <p className="mt-1 font-mono text-lg">
        {/* In place: the masked value and the revealed one occupy the same line,
            so an operator reading a document against the screen does not have
            to look somewhere else once they have pressed. */}
        {revealed?.cccdNumber ?? record.cccdMasked}
      </p>

      {revealed === undefined ? null : (
        <p className="text-muted-foreground mt-1 text-xs">
          {revealNotice(revealed)} It is masked again as soon as you leave this
          record, and reading it a second time is a second entry.
        </p>
      )}

      {!mayRevealCccd(role) ? (
        <p className="text-muted-foreground mt-rhythm-1 text-xs">
          Reading the number itself is the desk's act, and a manager's. This
          account reads the record with the number masked.
        </p>
      ) : revealed === undefined ? (
        <form
          className="mt-rhythm-1 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            press();
          }}
        >
          <Field
            label="Reason"
            value={reason}
            hint="Optional — checking a document, a police request. Who looked and when is recorded either way."
            onChange={(typed) => {
              setReason(typed);
              setProblem(null);
            }}
          />
          <Button type="submit" disabled={reveal.isPending}>
            Reveal number
          </Button>
        </form>
      ) : null}

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}
    </section>
  );
}

/** One typed field, labelled — and optionally the one `/` reaches. */
function Field({
  label,
  value,
  hint,
  onChange,
  inputRef,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange(value: string): void;
  inputRef?: React.Ref<HTMLInputElement>;
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
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <p className="text-muted-foreground mt-1 max-w-64 text-xs">{hint}</p>
      )}
    </div>
  );
}

function Fact({ fact }: { fact: GuestFact }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-caps uppercase">
        {fact.label}
      </dt>
      <dd>{fact.value}</dd>
    </div>
  );
}
