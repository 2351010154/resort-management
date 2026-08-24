"use client";

import { STAFF_ROLES, type StaffRole } from "@mariva/shared";
import type * as React from "react";
import { useId, useState } from "react";

import {
  DataTableFrame,
  EmptyState,
  PageHeader,
  StatusChip,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStaffSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

import {
  type ConfigFields,
  configEdit,
  configFingerprint,
  dongLabel,
  fieldsFrom,
  lastSignedInLabel,
  mayEditConfiguration,
  mayManageStaffAccounts,
  mayReadConfiguration,
  NO_STAFF_ACCOUNT_FIELDS,
  rateLabel,
  resolvedWindowEnd,
  rolloverLabel,
  type StaffAccount,
  type StaffAccountFields,
  type SystemConfiguration,
  staffAccountAttempt,
} from "./settings-form";
import {
  useConfiguration,
  useCreateStaffAccount,
  useStaffAccounts,
  useUpdateConfiguration,
} from "./settings-queries";

/* Settings — who may work in the console, and the figures every posting reads.
 *
 * `docs/screens.md` §"Staff surfaces" gives the screen its organising idea in its
 * first sentence: "Settings separates staff access from property configuration."
 * The two halves are separate here because they are separate in the RBAC matrix
 * — `identity.staff-accounts` is the one capability `ADMIN` holds alone, and
 * `system.config` is read by `MANAGER` and written by `ADMIN` — so the tab strip
 * appears for exactly one role and a manager arrives directly in the half that
 * is theirs.
 *
 * ## What this screen deliberately does not have
 *
 * **No gateway credentials.** `screens.md`: "gateway credentials stay in the
 * environment rather than in it." There is no field on the read a credential
 * could travel in, because `schema/config.ts` declined the column — a secret in
 * a table an `ADMIN` screen reads is a secret with a wider audience than the
 * process that spends it. So there is no form here and no placeholder for one.
 *
 * **No history of any figure.** The tax values are one mutable row, and the
 * window dates are "two fields of that same row, not a history of it". The audit
 * log owns the history: `system-config.service.ts` files the change-log entry
 * inside the same transaction that writes the row, which is why an effective-dated
 * table here would be a second, worse record of the same thing.
 *
 * **No advancing of the business date.** Only the hour the property's day rolls
 * at is configuration. Moving the day itself is the night audit.
 *
 * **No account editing.** The contract's identity routes are a list and a
 * create, and there is no route that changes a role, resets a password or
 * deactivates an account. The panel says so in a line rather than offering
 * controls that would have nowhere to send themselves.
 *
 * Role gating below is presentation and not a wall: the API's capability guard is
 * the wall, and what these predicates decide is whether an operator is *offered*
 * a door that would answer 403.
 *
 * ## How the configuration half is laid out, and why
 *
 * Every group is a band with its heading and its standing sentence in a column of
 * their own and the figures beside them. Thirteen numeric fields wrapped across
 * the full width of a 1500px card was one undifferentiated form: the headings sat
 * at body weight inside it, a group holding a single figure left most of a row
 * empty, and a switch carrying a sentence for a label had to compete with five
 * four-digit boxes in the same row. Reading which figures a heading governs is
 * the whole navigation problem on a screen with four sections and no other
 * landmarks.
 *
 * **The unit is stated before a figure is typed, not only echoed after.** Rates
 * are whole basis points on the wire — `contract/system-config.ts` puts them
 * there and `NFR-12` is the reason — so a field labelled "VAT rate" that takes
 * `1000` is a field an operator can set to a hundredth of what they meant. The
 * unit is therefore said four times over: in the group's own sentence, as a mark
 * inside the box, in the hint the box is described by, and in the reading
 * underneath once there is a figure to read.
 */

export function SettingsScreen() {
  const session = useStaffSession();

  // The guard above this renders nothing until the session is authenticated, so
  // `null` is unreachable in the shell. It is here because the narrowing is real
  // and a cast would be a claim about this component's position in a tree that
  // nothing checks — `features/shell/app-nav.tsx` makes the same argument.
  const role: StaffRole | null =
    session.status === "authenticated" ? session.user.role : null;

  const staffAccess = role !== null && mayManageStaffAccounts(role);
  const configuration = role !== null && mayReadConfiguration(role);

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Settings"
        description="Staff access and property configuration."
      />

      {/* An `ADMIN` holds both rows and is the only role that does, so the tab
          strip is exactly the administrator's view. A manager holds the
          configuration row alone and gets that half with no strip over it,
          rather than a chooser with one choice on it. */}
      {staffAccess ? (
        <Tabs defaultValue="staff" className="mt-6">
          {/* The rule under the strip belongs to the strip and not to the
              primitive: the line variant draws its active underline five pixels
              below the trigger, which needs something to be a line *on*. Without
              it the mark floats between the tabs and the card beneath, and the
              two labels read as a heading rather than as a chooser. */}
          <div className="border-border border-b">
            <TabsList variant="line" className="gap-6 pb-1">
              <TabsTrigger value="staff" className="flex-none">
                Staff access
              </TabsTrigger>
              <TabsTrigger value="configuration" className="flex-none">
                Property configuration
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="staff" className="mt-4">
            <StaffAccessPanel />
          </TabsContent>
          <TabsContent value="configuration" className="mt-4">
            <ConfigurationPanel
              mayEdit={role !== null && mayEditConfiguration(role)}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      {!staffAccess && configuration ? (
        <div className="mt-6">
          <ConfigurationPanel mayEdit={false} />
        </div>
      ) : null}

      {!staffAccess && !configuration ? (
        <EmptyState
          className="mt-6"
          title="No settings available"
          description="Staff access and configuration are limited to management."
        />
      ) : null}
    </div>
  );
}

// ── Half one: staff access ───────────────────────────────────────────────────

/** Who may work in the console, and the one act available — creating an
 *  account. */
function StaffAccessPanel() {
  const accounts = useStaffAccounts();

  return (
    <section className="rounded-lg bg-card p-5 shadow-card">
      <h2 className="text-2xl font-semibold leading-8">Staff access</h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        Every account that can sign in, and the role each one works under. A
        staff token carries exactly one role, so an account is not a set of
        permissions somebody accumulates — it is one row of the capability
        matrix.
      </p>

      {accounts.isPending ? (
        <div className="mt-6 space-y-2" aria-busy>
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : null}

      {accounts.isError ? (
        // The console's error device is a rule on the leading edge as much as
        // the colour: `--color-danger` is a warm red-brown a shade off the umber
        // every other line on this screen is set in, and a sentence differing
        // only in that would be read as ordinary copy.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Staff accounts could not be loaded. This is not the same as the
          property having none — nothing below is a statement about who can sign
          in until the list can be read.
        </p>
      ) : null}

      {/* The failure is drawn above and the list only when there is one, which
          is the ordering this has to keep: a plain `useQuery` that errors leaves
          `isPending` false and `data` undefined, so a branch testing emptiness
          before failure would answer a read that did not happen with "no staff
          accounts" — a sentence about the property that the console does not
          know. */}
      {accounts.data === undefined ? null : (
        <AccountList accounts={accounts.data} />
      )}

      <NewAccountForm />
    </section>
  );
}

/** The accounts, oldest first, as the API orders them. */
function AccountList({ accounts }: { accounts: readonly StaffAccount[] }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        title="No staff accounts"
        description="No account is available in this list."
      />
    );
  }

  return (
    <DataTableFrame className="mt-6">
      {/* Above the scrollport rather than in a `<caption>`: a caption is as wide
          as its table, and this table is 760px at its narrowest, so on any
          smaller window the sentence could only be finished by scrolling
          sideways. The caption that remains names the table for a screen reader
          and is not the same sentence twice. */}
      <p className="text-muted-foreground border-border border-b px-4 py-3 text-sm">
        In the order they were created. A deactivated account is listed rather
        than hidden: the first question about one is usually whether it still
        exists.
      </p>
      <div className="max-h-[60svh] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">
            Staff accounts, in the order they were created.
          </caption>
          {/* The ground and the rule are on the cell rather than on the row: a
              sticky `<thead>` is lifted out of the table's painting order and
              leaves a row-declared border behind it. */}
          <thead className="sticky top-0 z-10">
            <tr>
              <Column>Name</Column>
              <Column>Address</Column>
              <Column>Role</Column>
              <Column>Last signed in</Column>
              <Column>State</Column>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr
                key={account.id}
                className="border-border border-b last:border-b-0"
              >
                <Cell>{account.fullName}</Cell>
                <Cell>{account.email}</Cell>
                {/* The wire spelling, which is the matrix's own row name. The rail
                    writes a role as a job title because that is where an operator
                    reads their own; here an administrator is choosing a capability
                    set, and `docs/architecture/rbac-matrix.md` names it this way. */}
                <Cell>{account.role}</Cell>
                <Cell className="text-muted-foreground">
                  {lastSignedInLabel(account.lastSignedInAt)}
                </Cell>
                <Cell>
                  <StatusChip tone={account.isActive ? "neutral" : "danger"}>
                    {account.isActive ? "Active" : "Deactivated"}
                  </StatusChip>
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataTableFrame>
  );
}

/**
 * Creating an account — `FR-IDN-02`, and the only write this half has.
 *
 * The four fields are `createStaffAccountSchema`'s and no more. The role is a
 * radio group rather than a multi-select because exactly one is what a token
 * carries, and it is stated beneath because the choice cannot be revised: no
 * route changes an account's role, so an account in the wrong one is replaced.
 */
function NewAccountForm() {
  const create = useCreateStaffAccount();
  const [fields, setFields] = useState<StaffAccountFields>(
    NO_STAFF_ACCOUNT_FIELDS,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const roleGroupId = useId();

  function change(part: Partial<StaffAccountFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    // The press is `aria-disabled` rather than `disabled`, so a second Enter
    // still arrives here and is dropped rather than being refused by a control
    // that has already handed focus back to `<body>`.
    if (create.isPending) {
      return;
    }

    const attempt = staffAccountAttempt(fields);

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    create.mutate(attempt.account, {
      onSuccess: () => {
        // Cleared on success only. A refused account leaves the address and the
        // name where they were typed, which is where the correction is made —
        // except the password, which is cleared with the rest because it is not
        // a field anybody re-reads.
        setFields(NO_STAFF_ACCOUNT_FIELDS);
      },
    });
  }

  return (
    <form
      className="mt-8 border-border border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-lg font-semibold leading-6">New account</h3>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        Administrators create staff accounts. Roles cannot be edited later.
      </p>

      <div className="mt-5 grid max-w-3xl gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field
          label="Address"
          value={fields.email}
          placeholder="an.nguyen@example.com"
          hint="What the holder signs in with."
          type="email"
          onChange={(email) => {
            change({ email });
          }}
        />
        <Field
          label="Name"
          value={fields.fullName}
          placeholder="Nguyễn Văn An"
          hint="Account holder's display name."
          onChange={(fullName) => {
            change({ fullName });
          }}
        />
        <Field
          label="Password"
          value={fields.password}
          hint="At least 12 characters. Sent once."
          type="password"
          onChange={(password) => {
            change({ password });
          }}
        />
      </div>

      <fieldset className="mt-6">
        <legend
          id={roleGroupId}
          className="text-muted-foreground text-xs tracking-caps uppercase"
        >
          Role
        </legend>
        <RadioGroup
          aria-labelledby={roleGroupId}
          // Bounded to the width the fields above it use, so the five choices
          // read as one band rather than five marks strung across a metre of
          // card with the label of each one nearer the next than to its own.
          className="mt-2 max-w-3xl grid-cols-2 sm:grid-cols-5"
          value={fields.role ?? ""}
          onValueChange={(role) => {
            change({ role: role as StaffRole });
          }}
        >
          {/* In ascending authority, which is the order `STAFF_ROLES` declares
              and the order the matrix reads in. */}
          {STAFF_ROLES.map((role) => (
            <RoleChoice key={role} role={role} />
          ))}
        </RadioGroup>
        <p className="text-muted-foreground mt-3 max-w-prose text-sm">
          Roles are fixed at creation. Replace incorrectly assigned accounts.
        </p>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* `aria-disabled` rather than `disabled`, which is this console's
            standing answer to the press that loses its own focus: a disabled
            control cannot hold it, the browser drops it on `<body>`, and a
            refusal that leaves the state alone never re-runs an effect that
            would put it back. The second press is dropped in the handler. */}
        <Button
          type="submit"
          aria-disabled={create.isPending}
          aria-busy={create.isPending}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {create.isPending ? "Creating account" : "Create account"}
        </Button>
        {create.data === undefined ? null : (
          <p className="text-sm" role="status">
            {create.data.email} works under {create.data.role}.
          </p>
        )}
      </div>

      <Problem said={problem} />
    </form>
  );
}

/** One role, as the matrix names it. */
function RoleChoice({ role }: { role: StaffRole }) {
  const choiceId = useId();

  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={choiceId} value={role} />
      <label htmlFor={choiceId} className="text-sm">
        {role}
      </label>
    </div>
  );
}

// ── Half two: property configuration ─────────────────────────────────────────

/** The figures every posting reads, and — for an `ADMIN` — the one edit that
 *  changes them. */
function ConfigurationPanel({ mayEdit }: { mayEdit: boolean }) {
  const { businessDate, reading } = useConfiguration();

  /* Which row a save actually committed, held above the form rather than in it.
     The form is keyed by the configuration it was seeded from, so the answer to
     a `PATCH` — written straight into the read's cache entry — replaces the form
     with a new one, and a receipt kept inside it would be unmounted in the same
     tick it was earned. This console raises a toast for a failed write and
     nothing at all for a successful one, so without this a save that worked
     looks exactly like a form nobody touched. */
  const [savedRow, setSavedRow] = useState<string | null>(null);

  return (
    <section className="rounded-lg bg-card p-5 shadow-card">
      <h2 className="text-2xl font-semibold leading-8">
        Property configuration
      </h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        Controls posting, business dates, and loyalty. Saved changes apply to
        new requests.
      </p>

      {reading.status === "pending" ? (
        <div className="mt-6 max-w-3xl space-y-4" aria-busy>
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        </div>
      ) : null}

      {reading.status === "failed" ? (
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Property configuration could not be loaded. No figure on this screen
          is a statement about what the property charges until it can be read.
        </p>
      ) : null}

      {reading.status === "ready" ? (
        /* Keyed by the row as it currently stands, for the reason
           {@link configFingerprint} sets out: the form diffs what is typed back
           against the configuration it was seeded from, so a row that moved
           under it has to reseed it rather than be treated as this operator's
           own edit. A refetch answering with the same figures keeps the same key
           and leaves a half-typed edit where it is. */
        <ConfigurationForm
          key={configFingerprint(reading.config)}
          config={reading.config}
          businessDate={businessDate}
          mayEdit={mayEdit}
          saved={
            savedRow !== null && savedRow === configFingerprint(reading.config)
          }
          onSaved={setSavedRow}
        />
      ) : null}
    </section>
  );
}

/**
 * The thirteen figures, and an edit that carries only what moved.
 *
 * The form state is filled from the row and diffed back against it by
 * {@link configEdit}, which is specified on its own — every decision about what
 * travels, what a switched-off window end means, and which refusals can be
 * answered here is in that module, and none of it is in this component.
 *
 * A manager sees the same fields and no save button: the matrix gives them the
 * read and not the write, and a form they could fill and not submit would be a
 * 403 with their work already typed into it. The fields are `readOnly` rather
 * than `disabled`, because the manager's whole business with this screen is
 * reading it — the person answering "why was this stay charged that?" needs the
 * figures at full contrast and needs to be able to reach and copy one.
 */
function ConfigurationForm({
  config,
  businessDate,
  mayEdit,
  saved,
  onSaved,
}: {
  config: SystemConfiguration;
  businessDate: string | null;
  mayEdit: boolean;
  saved: boolean;
  onSaved(row: string): void;
}) {
  const update = useUpdateConfiguration();
  const [fields, setFields] = useState<ConfigFields>(() => fieldsFrom(config));
  const [problem, setProblem] = useState<string | null>(null);

  // Recomputed as the operator types, so what an edit will send is read before
  // it is sent rather than inferred from a response. `null` only until the API
  // has answered the property's day, which every relative date is counted from.
  const attempt =
    businessDate === null ? null : configEdit(fields, config, businessDate);

  const unchanged = attempt !== null && "unchanged" in attempt;

  function change(part: Partial<ConfigFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
    // The press keeps its focus, so a second Enter lands here rather than on a
    // control that has just been taken away from the keyboard.
    if (update.isPending) {
      return;
    }

    if (attempt === null) {
      setProblem(
        "The property's own day has not been read yet, and the relief-period dates are resolved against it. Try again in a moment.",
      );
      return;
    }

    if ("unchanged" in attempt) {
      return;
    }

    if ("problem" in attempt) {
      setProblem(attempt.problem);
      return;
    }

    setProblem(null);
    update.mutate(attempt.input, {
      onSuccess: (configured) => {
        // Refilled from the row that committed, not from what was typed: the
        // `PATCH` answers with the whole configuration, so a concurrent edit by
        // another administrator becomes visible here instead of being painted
        // over by this form's own copy.
        setFields(fieldsFrom(configured));
        onSaved(configFingerprint(configured));
      },
    });
  }

  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {mayEdit ? null : (
        <p className="text-muted-foreground mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
          These figures are read-only for your role. Only an administrator can
          change them.
        </p>
      )}

      <div className="mt-6 space-y-10">
        <Group
          title="Tax"
          note="Confirm statutory rates with the property's accountant. Every rate here is whole basis points — 1000 is 10%, 150 is 1.5%."
        >
          <Figure
            label="Standard VAT rate"
            unit="bps"
            value={fields.standardVatRateBps}
            placeholder="1000"
            hint="Whole basis points, charged outside the relief period. Typing 10 here would set a rate of 0.1%."
            echo={rateLabel(fields.standardVatRateBps)}
            readOnly={!mayEdit}
            onChange={(standardVatRateBps) => {
              change({ standardVatRateBps });
            }}
          />
          <Figure
            label="Reduced VAT rate"
            unit="bps"
            value={fields.reducedVatRateBps}
            placeholder="800"
            hint="Whole basis points, charged inside the relief period below."
            echo={rateLabel(fields.reducedVatRateBps)}
            readOnly={!mayEdit}
            onChange={(reducedVatRateBps) => {
              change({ reducedVatRateBps });
            }}
          />
          <Figure
            label="Service-charge rate"
            unit="bps"
            value={fields.serviceChargeRateBps}
            placeholder="500"
            hint="Whole basis points. Zero disables the charge."
            echo={rateLabel(fields.serviceChargeRateBps)}
            readOnly={!mayEdit}
            onChange={(serviceChargeRateBps) => {
              change({ serviceChargeRateBps });
            }}
          />
          <WindowEnd
            label="Relief period starts"
            side="start"
            example="1/7/2025"
            unbounded="No start. The standard rate applies before the period."
            bound={fields.reducedVatFromBound}
            value={fields.reducedVatFrom}
            businessDate={businessDate}
            readOnly={!mayEdit}
            onBound={(reducedVatFromBound) => {
              change({ reducedVatFromBound });
            }}
            onChange={(reducedVatFrom) => {
              change({ reducedVatFrom });
            }}
          />
          <WindowEnd
            label="Relief period ends"
            side="end"
            example="31/12/2026"
            unbounded="No end. The reduced rate does not lapse on a date."
            bound={fields.reducedVatToBound}
            value={fields.reducedVatTo}
            businessDate={businessDate}
            readOnly={!mayEdit}
            onBound={(reducedVatToBound) => {
              change({ reducedVatToBound });
            }}
            onChange={(reducedVatTo) => {
              change({ reducedVatTo });
            }}
          />
          <SwitchField
            className="col-span-full"
            label="VAT base includes the service charge"
            hint="On, a posting computes VAT over the room charge and the service charge together. Off, the service charge is outside the base."
            checked={fields.vatIncludesServiceCharge}
            disabled={!mayEdit}
            onChange={(vatIncludesServiceCharge) => {
              change({ vatIncludesServiceCharge });
            }}
          />
        </Group>

        <Group
          title="Operating clock"
          note="Sets when the property's trading day changes. The night audit runs at the rollover and closes the date that has just ended, so this hour is what puts a late checkout and a small-hours walk-in on the day they belong to."
        >
          <Figure
            label="Rollover hour"
            unit="hour"
            value={fields.businessDateRolloverHour}
            placeholder="4"
            hint="An hour of the property's own day, 0 through 23. 4 means the day turns at 04:00."
            echo={rolloverLabel(fields.businessDateRolloverHour)}
            readOnly={!mayEdit}
            onChange={(businessDateRolloverHour) => {
              change({ businessDateRolloverHour });
            }}
          />
        </Group>

        <Group
          title="Loyalty accrual"
          note="New accruals use saved values. Existing points remain unchanged."
          columns="sm:grid-cols-2"
        >
          <Figure
            label="Points per unit"
            unit="points"
            value={fields.loyaltyPointsPerUnit}
            placeholder="1"
            hint="Points earned each time net room revenue reaches one earn unit."
            echo={null}
            readOnly={!mayEdit}
            onChange={(loyaltyPointsPerUnit) => {
              change({ loyaltyPointsPerUnit });
            }}
          />
          <Figure
            label="Earn unit"
            unit="₫"
            value={fields.loyaltyEarnUnitVnd}
            placeholder="10000"
            hint="Whole đồng of net room revenue required per points lot."
            echo={dongLabel(fields.loyaltyEarnUnitVnd)}
            readOnly={!mayEdit}
            onChange={(loyaltyEarnUnitVnd) => {
              change({ loyaltyEarnUnitVnd });
            }}
          />
        </Group>

        {/* Two columns rather than three, so the pair a rung is reached by sits
            on one line and Gold reads directly under Silver. */}
        <Group
          title="Tier thresholds"
          note="Tiers use trailing twelve-month stays or revenue."
          columns="sm:grid-cols-2"
        >
          <Figure
            label="Silver — stays"
            unit="stays"
            value={fields.tierSilverStays}
            placeholder="3"
            hint="At least one."
            echo={null}
            readOnly={!mayEdit}
            onChange={(tierSilverStays) => {
              change({ tierSilverStays });
            }}
          />
          <Figure
            label="Silver — revenue"
            unit="₫"
            value={fields.tierSilverRevenueVnd}
            placeholder="20000000"
            hint="Whole đồng, net."
            echo={dongLabel(fields.tierSilverRevenueVnd)}
            readOnly={!mayEdit}
            onChange={(tierSilverRevenueVnd) => {
              change({ tierSilverRevenueVnd });
            }}
          />
          <Figure
            label="Gold — stays"
            unit="stays"
            value={fields.tierGoldStays}
            placeholder="8"
            hint="Must equal or exceed Silver stays."
            echo={null}
            readOnly={!mayEdit}
            onChange={(tierGoldStays) => {
              change({ tierGoldStays });
            }}
          />
          <Figure
            label="Gold — revenue"
            unit="₫"
            value={fields.tierGoldRevenueVnd}
            placeholder="60000000"
            hint="Must equal or exceed Silver revenue."
            echo={dongLabel(fields.tierGoldRevenueVnd)}
            readOnly={!mayEdit}
            onChange={(tierGoldRevenueVnd) => {
              change({ tierGoldRevenueVnd });
            }}
          />
        </Group>
      </div>

      {mayEdit ? (
        <div className="mt-10 border-border border-t pt-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button
              type="submit"
              aria-disabled={update.isPending || attempt === null || unchanged}
              aria-busy={update.isPending}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              {update.isPending ? "Saving changes" : "Save changes"}
            </Button>

            {/* The receipt is announced and the resting sentence is not: the
                first is news, the second is the state this form spends most of
                its life in. The preview beside them is recomputed on every
                keystroke, so it is read rather than announced — a live region
                there would spell the whole list again at each digit. */}
            {unchanged && saved ? (
              <p className="text-sm" role="status">
                Saved. Every figure above is the row the property now holds.
              </p>
            ) : null}

            {unchanged && !saved ? (
              <p className="text-muted-foreground text-sm">
                No saved values changed.
              </p>
            ) : null}

            {attempt !== null && "input" in attempt ? (
              <p className="text-sm">
                Updates{" "}
                {attempt.changed.length === 1
                  ? "one figure"
                  : `${attempt.changed.length} figures`}
                : {attempt.changed.join(", ")}.
              </p>
            ) : null}
          </div>

          <Problem said={problem} />
        </div>
      ) : null}
    </form>
  );
}

// ── The small shared parts ───────────────────────────────────────────────────

/**
 * One group of figures, with the sentence that says when they are read.
 *
 * A `<section>` under a heading rather than a `<fieldset>` under a legend, and
 * that is a layout decision made deliberately: a legend has to be the fieldset's
 * own first child to be its caption, which puts it in the same column as the
 * fields it names and leaves the heading tier weak and the band without a spine.
 * These are independent figures each carrying its own label — the grouping a
 * fieldset adds is the heading's job here, and the one control set on this
 * screen that genuinely needs a legend, the role radios, still has one.
 */
function Group({
  title,
  note,
  // Whole tracks rather than an addition to them: a group asking for two columns
  // has to *replace* the default three, and merging would keep the `xl` rule the
  // caller was overriding — a different breakpoint is a different utility, so
  // nothing drops it.
  columns = "sm:grid-cols-2 xl:grid-cols-3",
  children,
}: {
  title: string;
  note: string;
  columns?: string;
  children: React.ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-x-10"
    >
      <div>
        <h3 id={headingId} className="text-lg font-semibold leading-6">
          {title}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">{note}</p>
      </div>
      <div
        className={cn("mt-4 grid max-w-3xl gap-x-6 gap-y-5 lg:mt-0", columns)}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One figure of the configuration.
 *
 * `unit` is a mark inside the box and `echo` is the same integer rendered
 * humanely underneath — a percentage, a clock, an amount in đồng. The mark is
 * there because the echo alone arrives too late: it appears once a figure has
 * been typed, and the figure this screen is most easily got wrong is the one
 * typed before anything is echoed. Both are presentation and neither is the
 * storage model: nothing typed here is read as a percentage or a decimal, and
 * what travels is the digits in the box.
 *
 * The mark is `aria-hidden` because the hint says the same thing in words and
 * the box is described by it — a unit announced twice inside one field is a
 * field that reads as two.
 */
function Figure({
  label,
  unit,
  value,
  placeholder,
  hint,
  echo,
  readOnly,
  className,
  onChange,
}: {
  label: string;
  unit?: string;
  value: string;
  placeholder?: string;
  hint: string;
  echo: string | null;
  readOnly: boolean;
  className?: string;
  onChange(value: string): void;
}) {
  const fieldId = useId();
  const echoId = `${fieldId}-echo`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <div className="relative mt-1">
        <Input
          id={fieldId}
          className={cn(
            "tabular-nums",
            unit === undefined ? undefined : "pr-16",
          )}
          // Whole digits, so a numeric keypad is the right one and a spinner is
          // not: the arrows on a `type="number"` field would step a basis-point
          // figure by one, which is a hundredth of a percent per press.
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          // Named rather than merely adjacent: a hint a screen reader never
          // reaches is a hint only sighted operators have.
          aria-describedby={echo === null ? hintId : `${echoId} ${hintId}`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        {unit === undefined ? null : (
          <span
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs tracking-caps uppercase"
          >
            {unit}
          </span>
        )}
      </div>
      {echo === null ? null : (
        <p id={echoId} className="mt-1 text-sm font-semibold tabular-nums">
          = {echo}
        </p>
      )}
      <p id={hintId} className="text-muted-foreground mt-1 text-sm">
        {hint}
      </p>
    </div>
  );
}

/**
 * One end of the relief period — a date, and the switch that says whether there
 * is one.
 *
 * The switch is the whole reason this is not a plain field. The contract
 * distinguishes an end left alone from an end unbounded: an absent field leaves
 * it where it stands and an explicit null clears it, which is the difference
 * between "the relief period has no end yet" and "do not touch the end I set
 * last week". Switching this off is how the second is said, and it is the only
 * way to say it — blanking the date is answered as an unreadable date rather
 * than as an unbinding, because a statutory window must not lapse by a
 * keystroke.
 *
 * It sits *under* the box rather than over it. Every other cell in the band is
 * label, then box, then what the box reads as, and a switch on the first of
 * those lines pushed the box out of the row and left the label naming a control
 * two rows above the one it belongs to. Under the box it reads as the
 * qualification it is, and its own label states what it does rather than
 * restating the state the switch already carries.
 */
function WindowEnd({
  label,
  side,
  example,
  unbounded,
  bound,
  value,
  businessDate,
  readOnly,
  onBound,
  onChange,
}: {
  label: string;
  side: "start" | "end";
  example: string;
  unbounded: string;
  bound: boolean;
  value: string;
  businessDate: string | null;
  readOnly: boolean;
  onBound(bound: boolean): void;
  onChange(value: string): void;
}) {
  const fieldId = useId();
  const switchId = useId();
  const hintId = `${fieldId}-hint`;
  const echoId = `${fieldId}-echo`;
  const resolved =
    businessDate === null ? null : resolvedWindowEnd(value, businessDate);
  const echo = bound ? resolved : null;

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
        className="mt-1 tabular-nums"
        autoComplete="off"
        // Only while there is a date to type: an example left in a box the
        // switch has turned off is a greyed date sitting exactly where a value
        // sits, on the one field where "there is no date here" is the meaning.
        placeholder={bound ? example : undefined}
        value={value}
        readOnly={readOnly}
        // A real disable and not a read-only: with the switch off there is no
        // date to hold, and the field is not somewhere an operator should be
        // able to leave a keystroke that says nothing to the API.
        disabled={!bound}
        aria-describedby={echo === null ? hintId : `${echoId} ${hintId}`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Switch
          id={switchId}
          checked={bound}
          disabled={readOnly}
          onCheckedChange={onBound}
        />
        <label htmlFor={switchId} className="text-sm">
          Bounded by a date
        </label>
      </div>
      {echo === null ? null : (
        <p id={echoId} className="mt-2 text-sm font-semibold tabular-nums">
          = {echo}
        </p>
      )}
      <p id={hintId} className="text-muted-foreground mt-1 text-sm">
        {bound
          ? `The ${side} of the period, inclusive. Type ${example} or 2026-12-31.`
          : unbounded}
      </p>
    </div>
  );
}

/**
 * One rule that is a yes or a no rather than a figure.
 *
 * Its own band across the grid rather than a cell inside it. A switch's label is
 * a sentence about what the property does and not the name of a box, so setting
 * it in the caps tier the figures use made it two lines of shouting in a column
 * sized for the word "Earn unit". The row it gets instead is wide enough for the
 * sentence, and the label is what a finger and a pointer both land on, which is
 * where the touch target comes from — the switch itself is 32px of track.
 */
function SwitchField({
  label,
  hint,
  checked,
  disabled,
  className,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  className?: string;
  onChange(checked: boolean): void;
}) {
  const switchId = useId();
  const hintId = `${switchId}-hint`;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3",
        className,
      )}
    >
      <Switch
        id={switchId}
        className="mt-1"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onCheckedChange={onChange}
      />
      <div className="min-w-0">
        <label htmlFor={switchId} className="block text-sm font-semibold">
          {label}
        </label>
        <p id={hintId} className="text-muted-foreground mt-0.5 text-sm">
          {hint}
        </p>
      </div>
    </div>
  );
}

/** One typed field of the new-account form. */
function Field({
  label,
  value,
  placeholder,
  hint,
  type,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint: string;
  type?: "email" | "password";
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
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
        className="mt-1"
        type={type}
        placeholder={placeholder}
        autoComplete={type === "password" ? "new-password" : undefined}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p id={hintId} className="text-muted-foreground mt-1 text-sm">
        {hint}
      </p>
    </div>
  );
}

/** The console's error device: a rule on the leading edge as much as the colour.
 *  Announced, because it is the sentence that says why a press did nothing. */
function Problem({ said }: { said: string | null }) {
  if (said === null) {
    return null;
  }

  return (
    <p
      className="mt-4 border-danger border-l-2 pl-3 text-sm text-danger"
      role="alert"
    >
      {said}
    </p>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="text-muted-foreground border-border border-b bg-card px-4 py-2.5 text-left text-xs font-normal tracking-caps uppercase"
    >
      {children}
    </th>
  );
}

function Cell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-2.5", className)}>{children}</td>;
}
