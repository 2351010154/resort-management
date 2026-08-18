"use client";

import { STAFF_ROLES, type StaffRole } from "@mariva/shared";
import type * as React from "react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStaffSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

import {
  type ConfigFields,
  configEdit,
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
  staffAccountAttempt,
  type SystemConfiguration,
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
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Property
        </p>
        <h1 className="font-display text-display-sm mt-2">Settings</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          Two things, kept apart: who may work in the console, and the figures
          every posting reads. Payment-gateway credentials are in neither — they
          live in the environment, not in a table a screen can read.
        </p>
      </header>

      {/* An `ADMIN` holds both rows and is the only role that does, so the tab
          strip is exactly the administrator's view. A manager holds the
          configuration row alone and gets that half with no strip over it,
          rather than a chooser with one choice on it. */}
      {staffAccess ? (
        <Tabs defaultValue="staff" className="mt-rhythm-2">
          <TabsList variant="line">
            <TabsTrigger value="staff">Staff access</TabsTrigger>
            <TabsTrigger value="configuration">
              Property configuration
            </TabsTrigger>
          </TabsList>
          <TabsContent value="staff">
            <StaffAccessPanel />
          </TabsContent>
          <TabsContent value="configuration">
            <ConfigurationPanel
              mayEdit={role !== null && mayEditConfiguration(role)}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      {!staffAccess && configuration ? (
        <div className="mt-rhythm-2">
          <ConfigurationPanel mayEdit={false} />
        </div>
      ) : null}

      {!staffAccess && !configuration ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm">
          Staff accounts and the property's configuration are management's.
          Neither is anybody else's to read, so there is nothing on this screen
          for this account.
        </p>
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
    <section className="mt-rhythm-2">
      <h2 className="font-display text-2xl">Staff access</h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        Every account that can sign in, and the role each one works under. A
        staff token carries exactly one role, so an account is not a set of
        permissions somebody accumulates — it is one row of the capability
        matrix.
      </p>

      {accounts.isPending ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading the property's staff accounts.
        </p>
      ) : null}

      {accounts.isError ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The staff accounts could not be read. Nothing here is a statement
          about who can sign in.
        </p>
      ) : null}

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
      <p className="text-muted-foreground mt-rhythm-2 text-sm">
        No account is listed, which cannot include this one. Read that as a list
        that did not arrive rather than as a property nobody works at.
      </p>
    );
  }

  return (
    <table className="mt-rhythm-2 w-full border-collapse text-sm">
      <caption className="text-muted-foreground mb-rhythm-1 text-left text-xs">
        In the order they were created. A deactivated account is listed rather
        than hidden: the first question about one is usually whether it still
        exists.
      </caption>
      <thead>
        <tr className="border-border border-b">
          <Column>Name</Column>
          <Column>Address</Column>
          <Column>Role</Column>
          <Column>Last signed in</Column>
          <Column>State</Column>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id} className="border-border border-b">
            <Cell>{account.fullName}</Cell>
            <Cell>{account.email}</Cell>
            {/* The wire spelling, which is the matrix's own row name. The rail
                writes a role as a job title because that is where an operator
                reads their own; here an administrator is choosing a capability
                set, and `docs/architecture/rbac-matrix.md` names it this way. */}
            <Cell className="font-mono text-xs">{account.role}</Cell>
            <Cell>{lastSignedInLabel(account.lastSignedInAt)}</Cell>
            <Cell className={account.isActive ? undefined : "text-destructive"}>
              {account.isActive ? "Active" : "Deactivated"}
            </Cell>
          </tr>
        ))}
      </tbody>
    </table>
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
      className="mt-rhythm-3 border-border border-t pt-rhythm-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-sm">New account</h3>
      <p className="text-muted-foreground mt-1 max-w-prose text-xs">
        There is no self-service path to this: a staff account is made by an
        administrator, which is why this control exists at all. The property's
        first administrator came from a command-line bootstrap instead, because
        an API that requires one cannot create the first.
      </p>

      <div className="mt-rhythm-1 flex flex-wrap items-start gap-4">
        <Field
          label="Address"
          value={fields.email}
          hint="What the holder signs in with."
          type="email"
          onChange={(email) => {
            change({ email });
          }}
        />
        <Field
          label="Name"
          value={fields.fullName}
          hint="The person holding the account, as the desk would say it."
          onChange={(fullName) => {
            change({ fullName });
          }}
        />
        <Field
          label="Password"
          value={fields.password}
          hint="At least 12 characters. It travels once, on this request."
          type="password"
          onChange={(password) => {
            change({ password });
          }}
        />
      </div>

      <fieldset className="mt-rhythm-2">
        <legend
          id={roleGroupId}
          className="text-muted-foreground text-xs tracking-caps uppercase"
        >
          Role
        </legend>
        <RadioGroup
          aria-labelledby={roleGroupId}
          className="mt-1 grid-cols-2 sm:grid-cols-5"
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
        <p className="text-muted-foreground mt-2 max-w-prose text-xs">
          One role, fixed at creation. Nothing in the contract changes an
          account's role, resets its password or deactivates it, so an account
          in the wrong role is replaced rather than edited.
        </p>
      </fieldset>

      <div className="mt-rhythm-2 flex items-center gap-3">
        <Button type="submit" disabled={create.isPending}>
          Create account
        </Button>
        {create.data === undefined ? null : (
          <p className="text-muted-foreground text-sm">
            {create.data.email} works under {create.data.role}.
          </p>
        )}
      </div>

      {problem === null ? null : (
        <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
          {problem}
        </p>
      )}
    </form>
  );
}

/** One role, as the matrix names it. */
function RoleChoice({ role }: { role: StaffRole }) {
  const choiceId = useId();

  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={choiceId} value={role} />
      <label htmlFor={choiceId} className="font-mono text-xs">
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

  return (
    <section className="mt-rhythm-2">
      <h2 className="font-display text-2xl">Property configuration</h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        One row, read at the moment it is needed rather than at a deploy: the
        tax figures when a folio posting splits a gross amount, the rollover
        hour on every question about what day the property is having, the
        loyalty figures when a folio closes and when tiers are derived. A change
        here is read by the next request, and by no invoice already issued.
      </p>

      {reading.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading the property's configuration.
        </p>
      ) : null}

      {reading.status === "failed" ? (
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The configuration could not be read. Nothing here is a statement about
          what the property charges.
        </p>
      ) : null}

      {reading.status === "ready" ? (
        <ConfigurationForm
          config={reading.config}
          businessDate={businessDate}
          mayEdit={mayEdit}
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
 * A manager sees the same fields, disabled, and no save button: the matrix gives
 * them the read and not the write, and a form they could fill and not submit
 * would be a 403 with their work already typed into it.
 */
function ConfigurationForm({
  config,
  businessDate,
  mayEdit,
}: {
  config: SystemConfiguration;
  businessDate: string | null;
  mayEdit: boolean;
}) {
  const update = useUpdateConfiguration();
  const [fields, setFields] = useState<ConfigFields>(() => fieldsFrom(config));
  const [problem, setProblem] = useState<string | null>(null);

  // Recomputed as the operator types, so what an edit will send is read before
  // it is sent rather than inferred from a response. `null` only until the API
  // has answered the property's day, which every relative date is counted from.
  const attempt =
    businessDate === null ? null : configEdit(fields, config, businessDate);

  function change(part: Partial<ConfigFields>) {
    setFields((current) => ({ ...current, ...part }));
    setProblem(null);
  }

  function submit() {
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
      },
    });
  }

  return (
    <form
      className="mt-rhythm-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Group
        title="Tax"
        note="ASM-01 is answered from published sources and not yet confirmed by a practising accountant, which is exactly why these are a row and not a constant."
      >
        <Figure
          label="Standard VAT rate"
          value={fields.standardVatRateBps}
          hint="Basis points. The rate on every date the relief period does not cover."
          echo={rateLabel(fields.standardVatRateBps)}
          disabled={!mayEdit}
          onChange={(standardVatRateBps) => {
            change({ standardVatRateBps });
          }}
        />
        <Figure
          label="Reduced VAT rate"
          value={fields.reducedVatRateBps}
          hint="Basis points. The rate on the dates the relief period covers, and on no other."
          echo={rateLabel(fields.reducedVatRateBps)}
          disabled={!mayEdit}
          onChange={(reducedVatRateBps) => {
            change({ reducedVatRateBps });
          }}
        />
        <WindowEnd
          label="Relief period starts"
          bound={fields.reducedVatFromBound}
          value={fields.reducedVatFrom}
          businessDate={businessDate}
          disabled={!mayEdit}
          onBound={(reducedVatFromBound) => {
            change({ reducedVatFromBound });
          }}
          onChange={(reducedVatFrom) => {
            change({ reducedVatFrom });
          }}
        />
        <WindowEnd
          label="Relief period ends"
          bound={fields.reducedVatToBound}
          value={fields.reducedVatTo}
          businessDate={businessDate}
          disabled={!mayEdit}
          onBound={(reducedVatToBound) => {
            change({ reducedVatToBound });
          }}
          onChange={(reducedVatTo) => {
            change({ reducedVatTo });
          }}
        />
        <Figure
          label="Service-charge rate"
          value={fields.serviceChargeRateBps}
          hint="Basis points. Zero is a property that levies none."
          echo={rateLabel(fields.serviceChargeRateBps)}
          disabled={!mayEdit}
          onChange={(serviceChargeRateBps) => {
            change({ serviceChargeRateBps });
          }}
        />
        <Flag
          label="VAT base includes the service charge"
          hint="Whether the service-charge line is inside the amount VAT is computed on."
          checked={fields.vatIncludesServiceCharge}
          disabled={!mayEdit}
          onChange={(vatIncludesServiceCharge) => {
            change({ vatIncludesServiceCharge });
          }}
        />
      </Group>

      <Group
        title="Operating clock"
        note="The hour only. Moving the property's day forward is the night audit, not a setting."
      >
        <Figure
          label="Rollover hour"
          value={fields.businessDateRolloverHour}
          hint="0 to 23, in the property's own zone. At 4, the day turns at 04:00 and 01:30 is still yesterday."
          echo={rolloverLabel(fields.businessDateRolloverHour)}
          disabled={!mayEdit}
          onChange={(businessDateRolloverHour) => {
            change({ businessDateRolloverHour });
          }}
        />
      </Group>

      <Group
        title="Loyalty accrual"
        note="Read when a folio closes. Changing the rate defines what a point is worth from then on and reprices nothing already earned."
      >
        <Figure
          label="Points per unit"
          value={fields.loyaltyPointsPerUnit}
          hint="Points earned for each earn unit of net room revenue."
          echo={null}
          disabled={!mayEdit}
          onChange={(loyaltyPointsPerUnit) => {
            change({ loyaltyPointsPerUnit });
          }}
        />
        <Figure
          label="Earn unit"
          value={fields.loyaltyEarnUnitVnd}
          hint="Whole đồng of net room revenue one lot of points costs. Net is before VAT and service charge."
          echo={dongLabel(fields.loyaltyEarnUnitVnd)}
          disabled={!mayEdit}
          onChange={(loyaltyEarnUnitVnd) => {
            change({ loyaltyEarnUnitVnd });
          }}
        />
      </Group>

      <Group
        title="Tier thresholds"
        note="Rungs a tier is derived from over a trailing twelve months, each reached by stays or by revenue. Nothing here holds a tier: a guest below Silver is a Member, which is the absence of a match."
      >
        <Figure
          label="Silver — stays"
          value={fields.tierSilverStays}
          hint="At least one."
          echo={null}
          disabled={!mayEdit}
          onChange={(tierSilverStays) => {
            change({ tierSilverStays });
          }}
        />
        <Figure
          label="Silver — revenue"
          value={fields.tierSilverRevenueVnd}
          hint="Whole đồng, net."
          echo={dongLabel(fields.tierSilverRevenueVnd)}
          disabled={!mayEdit}
          onChange={(tierSilverRevenueVnd) => {
            change({ tierSilverRevenueVnd });
          }}
        />
        <Figure
          label="Gold — stays"
          value={fields.tierGoldStays}
          hint="On or above Silver's. Equal is a ladder; below it collapses the rung beneath."
          echo={null}
          disabled={!mayEdit}
          onChange={(tierGoldStays) => {
            change({ tierGoldStays });
          }}
        />
        <Figure
          label="Gold — revenue"
          value={fields.tierGoldRevenueVnd}
          hint="On or above Silver's, and compared only against Silver's revenue."
          echo={dongLabel(fields.tierGoldRevenueVnd)}
          disabled={!mayEdit}
          onChange={(tierGoldRevenueVnd) => {
            change({ tierGoldRevenueVnd });
          }}
        />
      </Group>

      {mayEdit ? (
        <div className="mt-rhythm-2 border-border border-t pt-rhythm-1">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                update.isPending || attempt === null || "unchanged" in attempt
              }
            >
              Save changes
            </Button>

            {attempt !== null && "unchanged" in attempt ? (
              <p className="text-muted-foreground text-sm">
                Nothing has changed. Every figure is as the property has it.
              </p>
            ) : null}

            {attempt !== null && "input" in attempt ? (
              <p className="text-sm">
                Sends {attempt.changed.length} of thirteen figures:{" "}
                {attempt.changed.join(", ")}. The rest are left exactly where
                they stand.
              </p>
            ) : null}
          </div>

          {problem === null ? null : (
            <p className="border-destructive text-destructive mt-rhythm-1 border-l-2 pl-3 text-sm">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground mt-rhythm-2 border-border border-t pt-rhythm-1 text-sm">
          These figures are an administrator's to change. What is here is what
          every posting, accrual and tier derivation will read.
        </p>
      )}
    </form>
  );
}

// ── The small shared parts ───────────────────────────────────────────────────

/** One group of figures, with the sentence that says when they are read. */
function Group({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-rhythm-2">
      <legend className="text-sm">{title}</legend>
      <p className="text-muted-foreground mt-1 max-w-prose text-xs">{note}</p>
      <div className="mt-rhythm-1 flex flex-wrap items-start gap-4">
        {children}
      </div>
    </fieldset>
  );
}

/**
 * One figure of the configuration.
 *
 * `echo` is the same integer rendered humanely — a percentage, a clock, an amount
 * in đồng — and it is a second line rather than a second field, because the
 * figure the property stores is the one being edited. Presentation is never
 * allowed to become the storage model: nothing typed here is read as a
 * percentage or a decimal.
 */
function Figure({
  label,
  value,
  hint,
  echo,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  echo: string | null;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const fieldId = useId();

  return (
    <div className="w-56">
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <Input
        id={fieldId}
        className="mt-1 font-mono"
        // Whole digits, so a numeric keypad is the right one and a spinner is
        // not: the arrows on a `type="number"` field would step a basis-point
        // figure by one, which is a hundredth of a percent per press.
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {echo === null ? null : <p className="mt-1 text-xs">{echo}</p>}
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );
}

/**
 * One end of the relief period — a switch, then a date.
 *
 * The switch is the whole reason this is not a plain field. The contract
 * distinguishes an end left alone from an end unbounded: an absent field leaves
 * it where it stands and an explicit null clears it, which is the difference
 * between "the relief period has no end yet" and "do not touch the end I set
 * last week". Switching this off is how the second is said, and it is the only
 * way to say it — blanking the date is answered as an unreadable date rather
 * than as an unbinding, because a statutory window must not lapse by a
 * keystroke.
 */
function WindowEnd({
  label,
  bound,
  value,
  businessDate,
  disabled,
  onBound,
  onChange,
}: {
  label: string;
  bound: boolean;
  value: string;
  businessDate: string | null;
  disabled: boolean;
  onBound(bound: boolean): void;
  onChange(value: string): void;
}) {
  const fieldId = useId();
  const switchId = useId();
  const resolved =
    businessDate === null ? null : resolvedWindowEnd(value, businessDate);

  return (
    <div className="w-56">
      <label
        htmlFor={fieldId}
        className="text-muted-foreground block text-xs tracking-caps uppercase"
      >
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <Switch
          id={switchId}
          checked={bound}
          disabled={disabled}
          onCheckedChange={onBound}
        />
        <label htmlFor={switchId} className="text-xs">
          {bound ? "Bounded" : "Unbounded"}
        </label>
      </div>
      <Input
        id={fieldId}
        className="mt-1 font-mono"
        value={value}
        disabled={disabled || !bound}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {bound && resolved !== null ? (
        <p className="mt-1 text-xs">{resolved}</p>
      ) : null}
      <p className="text-muted-foreground mt-1 text-xs">
        {bound
          ? "31/12/2026, 2026-12-31 — inclusive."
          : "No bound on this side. Every date outside the period takes the standard rate."}
      </p>
    </div>
  );
}

/** One rule that is a yes or a no rather than a figure. */
function Flag({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  const switchId = useId();

  return (
    <div className="w-56">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
        <label
          htmlFor={switchId}
          className="text-muted-foreground text-xs tracking-caps uppercase"
        >
          {label}
        </label>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );
}

/** One typed field of the new-account form. */
function Field({
  label,
  value,
  hint,
  type,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  type?: "email" | "password";
  onChange(value: string): void;
}) {
  // Associated by id rather than by nesting, so the association is one an
  // element inspector and a linter can both see.
  const fieldId = useId();

  return (
    <div className="w-64">
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
        autoComplete={type === "password" ? "new-password" : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
    </div>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="text-muted-foreground px-3 py-2 text-left text-xs font-normal tracking-caps uppercase first:pl-0 last:pr-0"
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
  return (
    <td className={cn("px-3 py-2 first:pl-0 last:pr-0", className)}>
      {children}
    </td>
  );
}
