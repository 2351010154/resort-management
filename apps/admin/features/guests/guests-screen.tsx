"use client";

import type { StaffRole } from "@mariva/shared";
import { SearchIcon, UserRoundIcon } from "lucide-react";
import type * as React from "react";
import { useId, useRef, useState } from "react";

import {
  EmptyState,
  FilterBar,
  KeyHint,
  PageHeader,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Guests"
        description="Find guests by name or telephone. Identity details stay masked."
      />

      <FilterBar
        className="mt-6"
        fieldsClassName="lg:max-w-2xl lg:grid-cols-2"
        actions={
          <Button type="submit">
            <SearchIcon aria-hidden="true" />
            Search
          </Button>
        }
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
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
      </FilterBar>

      {problem === null ? null : (
        <p
          className="mt-3 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          {problem}
        </p>
      )}

      <p className="mt-3 text-sm text-muted-foreground">
        <KeyHint>/</KeyHint> focuses search. Identity numbers are not
        searchable.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="min-h-72 p-3">
          {list.status === "idle" ? (
            <EmptyState
              title="Search for a guest"
              description="Enter a name or telephone number."
              className="px-4 py-10 shadow-none"
            />
          ) : null}

          {list.status === "pending" ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : null}

          {list.status === "failed" ? (
            // The console's error device is a rule on the leading edge rather
            // than a colour: --color-destructive and --color-primary are the
            // same umber.
            <p
              className="border-danger border-l-2 pl-3 text-sm text-danger"
              role="alert"
            >
              Guest search could not be run.
            </p>
          ) : null}

          {list.status === "ready" && list.guests.length === 0 ? (
            <EmptyState
              title="No matching guests"
              description="Guests appear after registration. Try a fuller name or telephone number."
              className="px-4 py-10 shadow-none"
            />
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
                <p className="mt-3 border-border border-t px-2 pt-3 text-sm text-muted-foreground">
                  Showing the first fifty guests. Narrow the search to find
                  more.
                </p>
              ) : null}
            </>
          ) : null}
        </Card>

        {selected === null || role === null ? (
          <EmptyState
            title="Choose a guest"
            description="Select a search result to read the guest record."
          />
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
          "flex min-h-14 w-full flex-col justify-center gap-0.5 rounded-md px-3 text-left text-sm transition-colors duration-150 ease-ui hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60",
          selected ? "bg-accent-soft text-accent-strong" : null,
        )}
      >
        <span className="font-semibold">{guest.fullName}</span>
        <span className="text-sm text-muted-foreground">
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
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 border-border border-b p-5">
        <span className="grid size-12 place-items-center rounded-lg bg-accent-soft text-accent-strong">
          <UserRoundIcon aria-hidden="true" className="size-5" />
        </span>
        <h2 className="text-2xl font-semibold leading-8">
          {record.data?.fullName ?? guest.fullName}
        </h2>
      </div>

      {record.isPending ? (
        <div className="space-y-2 p-5" aria-busy>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : null}

      {record.isError ? (
        <p
          className="m-5 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          The guest record could not be read.
        </p>
      ) : null}

      {record.data === undefined ? null : (
        <>
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
            {guestFacts(record.data).map((fact) => (
              <Fact key={fact.label} fact={fact} />
            ))}
          </dl>

          <IdentityNumber record={record.data} role={role} />

          <p className="text-muted-foreground mt-4 text-sm">
            {/* Said rather than implied: an operator looking for a stay list or
                a scan on this screen is owed the reason there is none. */}
            This record is the person, not their stays — a guest's bookings are
            found on Bookings (g b). No document image is kept anywhere: the
            document is checked at the desk and its particulars go on the
            registration.
          </p>
        </>
      )}
    </Card>
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
      <section className="mt-4">
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
    <section className="mt-4">
      <h3 className="text-sm">Identity number</h3>

      <p className="mt-1 tabular-nums text-lg">
        {/* In place: the masked value and the revealed one occupy the same line,
            so an operator reading a document against the screen does not have
            to look somewhere else once they have pressed. */}
        {revealed?.cccdNumber ?? record.cccdMasked}
      </p>

      {revealed === undefined ? null : (
        <p className="text-muted-foreground mt-1 text-sm">
          {revealNotice(revealed)} It is masked again as soon as you leave this
          record, and reading it a second time is a second entry.
        </p>
      )}

      {!mayRevealCccd(role) ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Reading the number itself is the desk's act, and a manager's. This
          account reads the record with the number masked.
        </p>
      ) : revealed === undefined ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            press();
          }}
        >
          <Field
            label="Reason"
            value={reason}
            hint="Optional. Every reveal is recorded."
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
        <p className="border-destructive text-destructive mt-2 border-l-2 pl-3 text-sm">
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
        className="block text-sm font-semibold text-muted-foreground"
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
        <p className="text-muted-foreground mt-1 max-w-64 text-sm">{hint}</p>
      )}
    </div>
  );
}

function Fact({ fact }: { fact: GuestFact }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-muted-foreground">
        {fact.label}
      </dt>
      <dd>{fact.value}</dd>
    </div>
  );
}
