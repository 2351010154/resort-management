/* The settings screen's decisions: who is offered which half, and exactly what
 * an edit to the property's configuration puts on the wire.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/rooms/room-list.ts` gives about its own screen: everything below is
 * a judgement the API does not make for the console — which of the two halves an
 * operator is offered, which figures an edit actually names, whether a window
 * end is being left alone or unbounded, and which refusals can be answered
 * before a request leaves the browser.
 *
 * Four rules hold throughout, and `settings-form.spec.ts` holds this file to
 * them.
 *
 * 1. **The two halves are separated by capability, not by taste.**
 *    `docs/screens.md` §"Staff surfaces" says Settings "separates staff access
 *    from property configuration", and the RBAC matrix says why they cannot be
 *    one door: `identity.staff-accounts` is the single capability `ADMIN` holds
 *    alone, while `system.config` is read by `MANAGER` and written by `ADMIN`.
 *    {@link mayManageStaffAccounts}, {@link mayReadConfiguration} and
 *    {@link mayEditConfiguration} are those three rows and nothing else. None of
 *    them is a wall — the API's capability guard is the wall, and what these
 *    decide is whether an operator is *offered* a door that would answer 403.
 *
 * 2. **An edit names only what changed.** `updateSystemConfigInput` is a PATCH
 *    because "a field absent from the body is a field nobody touched", and an
 *    `ADMIN` correcting the rollover hour must not restate a tax rate they were
 *    not asked about. {@link configEdit} builds the body by comparing the form
 *    against the configuration it was filled from, so a figure the operator did
 *    not touch cannot travel.
 *
 * 3. **A window end left alone and a window end unbounded are two different
 *    acts.** The contract spells the difference out: `undefined` leaves the end
 *    where it stands and an explicit `null` unbounds it — "the relief period has
 *    no end yet" against "do not touch the end I set last week". The form
 *    carries a switch per end for exactly that: switched off is `null`, switched
 *    on with the same date is absent, switched on with a new date is that date.
 *    Blanking the text is *not* an unbinding — it is an unreadable date and is
 *    refused as one, because the switch is how the operator says they meant it.
 *
 * 4. **Basis points and integer đồng are the storage model, and presentation
 *    never becomes it.** Rates are typed and sent as whole basis points and
 *    money as whole đồng; {@link rateLabel} and {@link dongLabel} render a
 *    figure humanely beside the field, both by integer arithmetic, so nothing on
 *    the way in or out of this screen touches a float. `NFR-12` is the reason,
 *    and `packages/shared/src/contract/system-config.ts` states it at the field.
 *    The currency rate is the one declared exception: `fxRateSchema` is a
 *    decimal precisely because a currency pair genuinely has a fraction, so
 *    {@link fxRateLabel} is the one echo on this screen built with `Number`
 *    rather than with integer arithmetic — and still never what travels.
 *
 * What is deliberately absent: any notion of a previous rate. `screens.md` is
 * emphatic that the tax values are "one mutable row an `ADMIN` edits" and that
 * the window dates are "two fields of that same row, not a history of it" — the
 * audit log owns the history, and `system-config.service.ts` files the entry
 * inside the transaction that writes the row. There is nothing here that could
 * hold a version, because there is no route that answers one.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  formatVnd,
  type StaffRole,
  staffSignInSchema,
  updateSystemConfigInput,
} from "@mariva/shared";

/* An instant in the property's own zone, from the feature that first needed one.
 * Reached past the `features/guests` barrel for `room-list.ts`'s reason — that
 * barrel carries hooks, and a spec for this file would pull TanStack Query in
 * behind them — and reused rather than reformatted because a fourth
 * `Intl.DateTimeFormat` with the same options would be a fourth opinion about
 * what time it is here. `features/payments/payments-screen.tsx` reaches it the
 * same way. */
import { formatInstant } from "@/features/guests/guest-record";
import { parseLiberalDate } from "@/lib/date-parser";

/* The two shapes, read off the client rather than restated: `@mariva/shared`
 * types the client from the contract's own schemas, so a field renamed there
 * breaks this file in the pull request that renamed it. */
export type SystemConfiguration = Awaited<
  ReturnType<ApiClient["systemConfig"]["read"]>
>;
export type ConfigurationEdit = Parameters<
  ApiClient["systemConfig"]["update"]
>[0];

// ── Who is offered which half ────────────────────────────────────────────────

/**
 * Who is offered the staff-access half — the matrix's `identity.staff-accounts`
 * row, which `ADMIN` holds alone.
 *
 * Alone is the whole point of the row: a `MANAGER` who may read what a posting
 * will charge still may not create the account that does the posting, so a
 * manager is not offered this half at all rather than offered it and refused.
 */
export function mayManageStaffAccounts(role: StaffRole): boolean {
  return role === "ADMIN";
}

/**
 * Who may read the property's configuration — `system.config` at 👁, which the
 * matrix gives `MANAGER` and `ADMIN`.
 *
 * A manager reading the figures is the reason the row is not `ADMIN`-only: the
 * rates here are what every future invoice is computed from, and the person
 * answering "why was this stay charged that?" needs to see them without being
 * able to move them.
 */
export function mayReadConfiguration(role: StaffRole): boolean {
  return role === "MANAGER" || role === "ADMIN";
}

/**
 * Who may change it — `system.config` at ✅, which is `ADMIN` and nobody else.
 *
 * The split against {@link mayReadConfiguration} is the matrix's own, and it is
 * what the API enforces: `read` declares the capability at `"read"` and `update`
 * declares it whole. A screen that offered a manager a save button would be
 * offering a 403 with the operator's work already typed into it.
 */
export function mayEditConfiguration(role: StaffRole): boolean {
  return role === "ADMIN";
}

// ── Half one: staff access ───────────────────────────────────────────────────

/**
 * One staff account, as `GET /identity/staff-accounts` answers it.
 *
 * Written out here rather than read off the client, because these two routes are
 * the console's one pair with no oRPC contract behind them: `identity.controller.ts`
 * is a plain Nest controller and `packages/shared` has no identity module, so
 * there is no generated type to derive. That is also why {@link staffAccountsFrom}
 * exists — a shape nothing typed is a shape worth checking on arrival.
 *
 * `role` is `string` and not {@link StaffRole} on purpose: the API's own view
 * declares it that way, and narrowing it here would be this file claiming
 * something about the response that nothing checks. The screen prints it.
 */
export interface StaffAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly lastSignedInAt: string | null;
}

/**
 * The account list as it arrived, or null if what arrived is not one.
 *
 * The same protection `lib/auth/staff-auth-requests.ts` gets from parsing its
 * responses through a shared schema, done by hand for the reason above: a 200
 * whose body is not the list it claims to be is a deployment mismatch, and
 * finding out by rendering an object into a table cell is finding out three
 * screens later. Every field is required because the API's `view()` names every
 * field it answers with.
 */
export function staffAccountsFrom(
  value: unknown,
): readonly StaffAccount[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const accounts: StaffAccount[] = [];

  for (const entry of value) {
    const account = staffAccountFrom(entry);

    if (account === null) {
      return null;
    }

    accounts.push(account);
  }

  return accounts;
}

/** One account as it arrived, or null if what arrived is not one. The creation
 *  route answers a single account rather than a list, and it is checked on the
 *  same terms. */
export function staffAccountFrom(value: unknown): StaffAccount | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const answered = value as Record<string, unknown>;
  const { id, email, fullName, role, isActive, lastSignedInAt } = answered;

  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    typeof fullName !== "string" ||
    typeof role !== "string" ||
    typeof isActive !== "boolean" ||
    (lastSignedInAt !== null && typeof lastSignedInAt !== "string")
  ) {
    return null;
  }

  return { id, email, fullName, role, isActive, lastSignedInAt };
}

/**
 * When an account was last used, in the property's own zone.
 *
 * Rendered from the instant rather than sliced out of it. The API answers an ISO
 * timestamp, and taking the first ten characters of one would report the UTC
 * date — which is the previous day for every sign-in before 07:00 local, and
 * would disagree with every other date this console prints.
 *
 * An account that has never been used says so. That is a real state and the
 * administrator's question about it: an account created last month and never
 * signed into is one somebody has not been given, or does not need.
 */
export function lastSignedInLabel(lastSignedInAt: string | null): string {
  return lastSignedInAt === null
    ? "Never signed in"
    : formatInstant(lastSignedInAt);
}

/** What the operator typed into the new-account form, before any of it is read.
 *  `role` is one value or none, because a staff token carries exactly one. */
export interface StaffAccountFields {
  email: string;
  fullName: string;
  role: StaffRole | null;
  password: string;
}

/** An empty new-account form, and the identity the screen resets to. */
export const NO_STAFF_ACCOUNT_FIELDS: StaffAccountFields = {
  email: "",
  fullName: "",
  role: null,
  password: "",
};

/** The body `POST /identity/staff-accounts` takes — `createStaffAccountSchema`,
 *  which is four fields and exactly one role. */
export interface NewStaffAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

/** Either an account the API will take, or the sentence that says why it is not
 *  one yet. */
export type StaffAccountAttempt =
  | { readonly account: NewStaffAccount }
  | { readonly problem: string };

/**
 * The address rule, borrowed from the schema beside it rather than restated.
 *
 * `createStaffAccountSchema` validates the address with `z.email().max(320)` and
 * `staffSignInSchema` validates the same address with the same two rules, so
 * this is the API's own decision about what an address is rather than a regex
 * invented here. It has to be borrowed rather than imported directly because the
 * account routes are the console's one pair with no shared contract; the sign-in
 * schema is the nearest thing to one, and the day the two disagree is the day
 * this line stops compiling into something correct — which is why the borrowing
 * is stated rather than hidden.
 */
const staffEmailSchema = staffSignInSchema.shape.email;

/** `z.string().trim().min(1).max(200)`, as the API applies it to a name. */
const LONGEST_FULL_NAME = 200;

/* `z.string().min(12).max(128)`. Twelve characters is the guest realm's floor,
 * applied here because an administrator creating an account is the one place a
 * password is *set* — `identity.controller.ts` makes that argument. */
const SHORTEST_PASSWORD = 12;
const LONGEST_PASSWORD = 128;

/**
 * The account as `createStaffAccountSchema` takes it, or the first thing wrong
 * with it.
 *
 * The address and the name are trimmed and the password is not, which is the
 * API's own asymmetry: its schema trims the name, reads the address through
 * `z.email()`, and takes the password exactly as it arrived — a space inside a
 * password is part of the password, and trimming one here would create an
 * account whose holder cannot sign in.
 *
 * One refusal at a time, like every other form in this console: a form with one
 * message beside it is one thing to fix.
 */
export function staffAccountAttempt(
  fields: StaffAccountFields,
): StaffAccountAttempt {
  const email = fields.email.trim();
  const fullName = fields.fullName.trim();

  if (!staffEmailSchema.safeParse(email).success) {
    return {
      problem:
        "That is not an address the API will take. A staff account is created against one, and it is what the holder signs in with.",
    };
  }

  if (fullName === "") {
    return {
      problem:
        "A staff account needs the name of the person holding it. The desk reads it beside every act the account performs.",
    };
  }

  if (fullName.length > LONGEST_FULL_NAME) {
    return {
      problem: `A name is at most ${LONGEST_FULL_NAME} characters. That one is ${fullName.length}.`,
    };
  }

  if (fields.role === null) {
    return {
      problem:
        "Choose the one role this account works under. A staff token carries exactly one, so an account is not a set of roles somebody accumulates.",
    };
  }

  if (fields.password.length < SHORTEST_PASSWORD) {
    return {
      problem: `A staff password is at least ${SHORTEST_PASSWORD} characters. This is the one place a password is set, so it is the one place the floor can be applied.`,
    };
  }

  if (fields.password.length > LONGEST_PASSWORD) {
    return {
      problem: `A staff password is at most ${LONGEST_PASSWORD} characters.`,
    };
  }

  return {
    account: { email, fullName, role: fields.role, password: fields.password },
  };
}

// ── Half two: property configuration ─────────────────────────────────────────

/**
 * The configuration as the operator is editing it — every figure as typed text,
 * plus the three states that are not text.
 *
 * Text and not numbers, because a partially typed figure is a real state of this
 * form and a `number` has nowhere to hold "80" on the way to "800". The reading
 * happens once, in {@link configEdit}, against the contract's own schema.
 *
 * The two `…Bound` flags are the null-versus-undefined distinction made
 * operable. Switched off means "this side of the relief period is unbounded",
 * which is a `null` the API stores; switched on means the date beside it is the
 * end, and leaving that date as it was read is how an end is left alone.
 */
export interface ConfigFields {
  standardVatRateBps: string;
  reducedVatRateBps: string;
  reducedVatFrom: string;
  reducedVatFromBound: boolean;
  reducedVatTo: string;
  reducedVatToBound: boolean;
  vatIncludesServiceCharge: boolean;
  serviceChargeRateBps: string;
  businessDateRolloverHour: string;
  loyaltyPointsPerUnit: string;
  loyaltyEarnUnitVnd: string;
  tierSilverStays: string;
  tierSilverRevenueVnd: string;
  tierGoldStays: string;
  tierGoldRevenueVnd: string;
  /** Đồng per one US dollar, as decimal text — the one figure on this form
   *  that is allowed a fraction, for `fxRateSchema`'s reason. */
  rateVndPerUsd: string;
}

/**
 * The form as the configuration answered it — the state every edit is diffed
 * against.
 *
 * The dates arrive as ISO text and are put in the field as they came, so a form
 * nobody has touched produces an empty edit exactly. A null end fills the field
 * with nothing and leaves its switch off, which is the same reading in reverse:
 * unbounded is a state the operator sees rather than an empty box they have to
 * interpret.
 */
export function fieldsFrom(config: SystemConfiguration): ConfigFields {
  return {
    standardVatRateBps: String(config.standardVatRateBps),
    reducedVatRateBps: String(config.reducedVatRateBps),
    reducedVatFrom: config.reducedVatFrom ?? "",
    reducedVatFromBound: config.reducedVatFrom !== null,
    reducedVatTo: config.reducedVatTo ?? "",
    reducedVatToBound: config.reducedVatTo !== null,
    vatIncludesServiceCharge: config.vatIncludesServiceCharge,
    serviceChargeRateBps: String(config.serviceChargeRateBps),
    businessDateRolloverHour: String(config.businessDateRolloverHour),
    loyaltyPointsPerUnit: String(config.loyaltyPointsPerUnit),
    loyaltyEarnUnitVnd: config.loyaltyEarnUnitVnd.toString(),
    tierSilverStays: String(config.tierSilverStays),
    tierSilverRevenueVnd: config.tierSilverRevenueVnd.toString(),
    tierGoldStays: String(config.tierGoldStays),
    tierGoldRevenueVnd: config.tierGoldRevenueVnd.toString(),
    // Already text — `numeric` comes back from the API as decimal text, not as
    // a bigint — so nothing is stringified here the way the đồng figures above
    // are.
    rateVndPerUsd: config.rateVndPerUsd,
  };
}

/**
 * The stored row, as one string that changes exactly when the row does.
 *
 * The form is seeded from the configuration once and then diffs what is typed
 * back against it, which is only sound while the two are the same row. They stop
 * being the same row on a background refetch — `lib/query-client.ts` refetches
 * on window focus and trusts a read for thirty seconds, and this console is left
 * open on a desk all day — and a form still showing yesterday's figures would
 * read every figure another administrator moved as a figure *this* operator
 * moved, and send it back. A save meant to correct the rollover hour would
 * quietly restore the VAT rate somebody else had just changed.
 *
 * So the screen mounts the form under this, the way `rates-screen.tsx` mounts a
 * plan card under the plan as it currently stands: a refetch that answers with
 * the same row produces the same string and leaves a half-typed edit alone,
 * while a row that actually moved produces a different one and the form starts
 * again from what the property now holds.
 *
 * Built from {@link fieldsFrom} rather than from the configuration directly, so
 * the figures are listed in one place and money — which is `bigint`, and which
 * `JSON.stringify` refuses — is already text by the time it arrives here.
 */
export function configFingerprint(config: SystemConfiguration): string {
  return JSON.stringify(fieldsFrom(config));
}

/**
 * What an edit resolves to: a body with the figures it names, a form nobody has
 * moved, or the sentence saying why what is typed is not an edit yet.
 *
 * `unchanged` is its own answer rather than a problem, because a form sitting at
 * the figures it was filled from is not a mistake — it is the normal state of
 * this screen. It is separated from `problem` so the screen can hold the save
 * button without printing an error over a form nobody has touched, and so that
 * the empty body the contract refuses on purpose is never built.
 */
export type ConfigEditAttempt =
  | { readonly input: ConfigurationEdit; readonly changed: readonly string[] }
  | { readonly unchanged: true }
  | { readonly problem: string };

/** Every figure the row carries, named as the screen names it — used for the
 *  preview of what an edit will send and to put a field's name in front of the
 *  contract's own refusal. */
const FIGURE_LABELS: Readonly<Record<string, string>> = {
  standardVatRateBps: "the standard VAT rate",
  reducedVatRateBps: "the reduced VAT rate",
  reducedVatFrom: "the relief period's start",
  reducedVatTo: "the relief period's end",
  vatIncludesServiceCharge: "whether VAT includes the service charge",
  serviceChargeRateBps: "the service-charge rate",
  businessDateRolloverHour: "the rollover hour",
  loyaltyPointsPerUnit: "the points per unit",
  loyaltyEarnUnitVnd: "the earn unit",
  tierSilverStays: "Silver's stay count",
  tierSilverRevenueVnd: "Silver's revenue threshold",
  tierGoldStays: "Gold's stay count",
  tierGoldRevenueVnd: "Gold's revenue threshold",
  rateVndPerUsd: "the đồng-per-dollar rate",
};

/**
 * The edit the typed form amounts to, held to everything the console can decide
 * without asking.
 *
 * The order of the checks is the API's own order, and following it is what makes
 * a refusal here the same refusal the server would have given. Each figure is
 * read from its text first, so an unreadable one is answered in the console's
 * words rather than as a zod message about a `NaN` nobody typed. Then the body
 * is built by comparison, so it carries only what moved. Then the contract's own
 * schema runs over that body, which is where every single-column bound lives —
 * a rate above 100%, an hour of 24, a threshold above a `smallint` — so a rule
 * changed in `packages/shared` cannot drift from what this form enforces. Then
 * the two invariants that span columns are checked against the configuration the
 * edit would leave behind: the relief window's ends, and each tier rung against
 * the one below it. Those two are the ones `system-config.service.ts` says only
 * a caller holding the stored row beside the edit can see — and a screen that
 * read the row to fill its fields is exactly such a caller, so it can answer
 * them before the operator presses anything.
 *
 * What is sent is the typed body and never the parsed one: the schema's output
 * side decodes a date into a `CalendarDate` and an amount into a `bigint`, and
 * neither is a shape to put on a wire. `features/rooms/room-list.ts` makes the
 * same distinction for the same reason.
 *
 * `businessDate` is the property's own day, which every relative date in this
 * console is counted from. It is required rather than defaulted so that a screen
 * cannot resolve "today" against the wrong day during the small hours.
 */
export function configEdit(
  fields: ConfigFields,
  config: SystemConfiguration,
  businessDate: string,
): ConfigEditAttempt {
  const standardVatRateBps = wholeNumber(fields.standardVatRateBps);
  const reducedVatRateBps = wholeNumber(fields.reducedVatRateBps);
  const serviceChargeRateBps = wholeNumber(fields.serviceChargeRateBps);
  const businessDateRolloverHour = wholeNumber(fields.businessDateRolloverHour);
  const loyaltyPointsPerUnit = wholeNumber(fields.loyaltyPointsPerUnit);
  const tierSilverStays = wholeNumber(fields.tierSilverStays);
  const tierGoldStays = wholeNumber(fields.tierGoldStays);

  if (standardVatRateBps === null) {
    return { problem: rateIsBasisPoints("The standard VAT rate") };
  }

  if (reducedVatRateBps === null) {
    return { problem: rateIsBasisPoints("The reduced VAT rate") };
  }

  if (serviceChargeRateBps === null) {
    return { problem: rateIsBasisPoints("The service-charge rate") };
  }

  if (businessDateRolloverHour === null) {
    return {
      problem:
        "The rollover hour is an hour of the property's own day — a whole number from 0 to 23, where 4 means the day turns at 04:00.",
    };
  }

  if (loyaltyPointsPerUnit === null) {
    return {
      problem:
        "The points per unit is a whole count of points, earned once per earn unit of net room revenue.",
    };
  }

  if (tierSilverStays === null) {
    return { problem: staysIsACount("Silver") };
  }

  if (tierGoldStays === null) {
    return { problem: staysIsACount("Gold") };
  }

  // Money stays as text all the way to the wire — `vndAmountInputSchema` takes
  // decimal text precisely because no JSON number is wide enough to be trusted
  // with đồng — so the only reading done here is a trim. What is typed and
  // unreadable is left for the contract's schema below to refuse in its own
  // words, which name the unit.
  const loyaltyEarnUnitVnd = fields.loyaltyEarnUnitVnd.trim();
  const tierSilverRevenueVnd = fields.tierSilverRevenueVnd.trim();
  const tierGoldRevenueVnd = fields.tierGoldRevenueVnd.trim();

  // Left as trimmed text for the same reason the đồng figures above are: this
  // is the one field on the whole form `fxRateSchema` allows a fraction in, so
  // there is no whole-number reading to do here at all, and what is unreadable
  // is left for the contract's schema below to refuse in its own words.
  const rateVndPerUsd = fields.rateVndPerUsd.trim();

  const from = windowEnd(
    fields.reducedVatFrom,
    fields.reducedVatFromBound,
    businessDate,
  );

  if ("unreadable" in from) {
    return { problem: windowEndUnreadable("start", "1/7/2025") };
  }

  const to = windowEnd(
    fields.reducedVatTo,
    fields.reducedVatToBound,
    businessDate,
  );

  if ("unreadable" in to) {
    return { problem: windowEndUnreadable("end", "31/12/2026") };
  }

  /* The body, one figure at a time, each present only if it moved. Written out
   * rather than filtered generically, exactly as `system-config.service.ts`
   * writes its own `SET` clause out: "the caller left this alone" and "the
   * caller cleared this" both look like an absent value at a glance, and only
   * the two window ends carry the second. */
  const input: ConfigurationEdit = {
    ...(standardVatRateBps === config.standardVatRateBps
      ? {}
      : { standardVatRateBps }),
    ...(reducedVatRateBps === config.reducedVatRateBps
      ? {}
      : { reducedVatRateBps }),
    ...(from.on === config.reducedVatFrom ? {} : { reducedVatFrom: from.on }),
    ...(to.on === config.reducedVatTo ? {} : { reducedVatTo: to.on }),
    ...(fields.vatIncludesServiceCharge === config.vatIncludesServiceCharge
      ? {}
      : { vatIncludesServiceCharge: fields.vatIncludesServiceCharge }),
    ...(serviceChargeRateBps === config.serviceChargeRateBps
      ? {}
      : { serviceChargeRateBps }),
    ...(businessDateRolloverHour === config.businessDateRolloverHour
      ? {}
      : { businessDateRolloverHour }),
    ...(loyaltyPointsPerUnit === config.loyaltyPointsPerUnit
      ? {}
      : { loyaltyPointsPerUnit }),
    ...(sameDong(loyaltyEarnUnitVnd, config.loyaltyEarnUnitVnd)
      ? {}
      : { loyaltyEarnUnitVnd }),
    ...(tierSilverStays === config.tierSilverStays ? {} : { tierSilverStays }),
    ...(sameDong(tierSilverRevenueVnd, config.tierSilverRevenueVnd)
      ? {}
      : { tierSilverRevenueVnd }),
    ...(tierGoldStays === config.tierGoldStays ? {} : { tierGoldStays }),
    ...(sameDong(tierGoldRevenueVnd, config.tierGoldRevenueVnd)
      ? {}
      : { tierGoldRevenueVnd }),
    ...(rateVndPerUsd === config.rateVndPerUsd ? {} : { rateVndPerUsd }),
  };

  const changed = Object.keys(input).map((key) => FIGURE_LABELS[key] ?? key);

  // Answered here and never sent. The contract refuses a body naming nothing on
  // purpose — an empty body is usually one that named a field it does not have —
  // and a screen that let the operator discover that from a 400 would be
  // reporting its own inaction as the API's refusal.
  if (changed.length === 0) {
    return { unchanged: true };
  }

  const checked = updateSystemConfigInput.safeParse(input);

  if (!checked.success) {
    return { problem: firstRefusal(checked.error.issues) };
  }

  if (from.on !== null && to.on !== null && to.on < from.on) {
    // Compared as ISO text, which sorts as it reads, and both ends inclusive —
    // so equal ends are a window covering one day rather than none. The same
    // comparison `system_config_reduced_vat_window_opens_before_it_closes`
    // makes.
    return {
      problem: `A relief period opening ${from.on} and closing ${to.on} covers no date at all, so every posting inside it would be refused. Set the end on or after the start, or switch that side off to leave it unbounded.`,
    };
  }

  if (tierGoldStays < tierSilverStays) {
    return {
      problem: `Gold at ${tierGoldStays} stays sits below Silver at ${tierSilverStays}, so every guest who reached Silver would already be Gold and the rung beneath would stop being reachable. Set Gold's stay count on or above Silver's.`,
    };
  }

  const silverRevenue = dongOr(
    tierSilverRevenueVnd,
    config.tierSilverRevenueVnd,
  );
  const goldRevenue = dongOr(tierGoldRevenueVnd, config.tierGoldRevenueVnd);

  if (goldRevenue < silverRevenue) {
    return {
      problem: `Gold at ${formatVnd(goldRevenue)} sits below Silver at ${formatVnd(silverRevenue)}, so every guest who reached Silver by revenue would already be Gold. Set Gold's revenue threshold on or above Silver's.`,
    };
  }

  return { input, changed };
}

/**
 * One end of the relief period as the edit would leave it: a date, unbounded, or
 * not readable as either.
 *
 * The switch decides which of the three, and that is the point of having one.
 * Off is `null` — the operator saying this side has no bound — and it is the
 * only way to say it, so an end cannot be cleared by accident. On with an empty
 * or unreadable field is neither a date nor an unbinding, and answering it as
 * "unreadable" is what stops a half-typed date from silently unbounding a
 * statutory window.
 */
type WindowEnd = { readonly on: string | null } | { readonly unreadable: true };

function windowEnd(
  typed: string,
  bound: boolean,
  businessDate: string,
): WindowEnd {
  if (!bound) {
    return { on: null };
  }

  // The same liberal reading every other date field in this console gets: a
  // manager types 31/12/2026 or 2026-12-31 and never opens a picker.
  const on = parseLiberalDate(typed, businessDate);

  return on === null ? { unreadable: true } : { on };
}

/**
 * A window end as the console resolved it, for the echo beside the field.
 *
 * Exported so the screen can show what "31/12" became without repeating the
 * parse or the reference day. Null is "nothing readable there yet", which the
 * screen renders as an absence rather than as an error — the operator is
 * mid-keystroke.
 */
export function resolvedWindowEnd(
  typed: string,
  businessDate: string,
): string | null {
  return parseLiberalDate(typed, businessDate);
}

// ── Reading and rendering figures, on integers throughout ────────────────────

/** A figure typed as whole digits, or null. No sign, no decimal point, and no
 *  `parseFloat` anywhere near it. */
const WHOLE_DIGITS = /^\d+$/;

function wholeNumber(typed: string): number | null {
  const trimmed = typed.trim();

  return WHOLE_DIGITS.test(trimmed) ? Number(trimmed) : null;
}

/** Whether the typed amount is the stored one. Compared as `bigint` rather than
 *  as text so a leading zero is not mistaken for an edit. */
function sameDong(typed: string, stored: bigint): boolean {
  return WHOLE_DIGITS.test(typed) && BigInt(typed) === stored;
}

/** The typed amount, or the stored one when what is typed is not an amount. Only
 *  reached after the contract's schema has accepted the body, so the fallback is
 *  for the fields this edit did not name. */
function dongOr(typed: string, stored: bigint): bigint {
  return WHOLE_DIGITS.test(typed) ? BigInt(typed) : stored;
}

/**
 * A basis-points figure as a percentage, for the line under the field — "8.00%".
 *
 * Integer arithmetic and nothing else: the whole part is taken by subtracting
 * the remainder before dividing, and the hundredths are that remainder padded.
 * A `/ 100` into a float and back would put rounding between what an operator
 * reads and what the property charges, which is the defect basis points exist to
 * prevent. Null when the field does not hold a figure yet.
 */
export function rateLabel(typed: string): string | null {
  const bps = wholeNumber(typed);

  if (bps === null) {
    return null;
  }

  const hundredths = bps % 100;

  return `${(bps - hundredths) / 100}.${String(hundredths).padStart(2, "0")}%`;
}

/** The rollover hour as the clock reads it — "04:00". Null when the field does
 *  not hold an hour of a day. */
export function rolloverLabel(typed: string): string | null {
  const hour = wholeNumber(typed);

  if (hour === null || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:00`;
}

/** A typed amount of đồng as the property reads it — "1.250.000 ₫". Display
 *  only; the field's own text is what travels. */
export function dongLabel(typed: string): string | null {
  const trimmed = typed.trim();

  return WHOLE_DIGITS.test(trimmed) ? formatVnd(BigInt(trimmed)) : null;
}

/** A positive decimal, `fxRateSchema`'s own shape — the one figure on this
 *  form allowed a fraction. */
const FX_RATE_TEXT = /^\d+(\.\d+)?$/;

/**
 * A typed currency rate read the way the property reads it — "26,150.50 đồng
 * per US$1". Display only, and the one echo on this screen built with `Number`
 * rather than with integer arithmetic: `money.ts` reserves that allowance for
 * exactly this figure, because a currency pair is the one place a fraction is
 * real rather than a defect. Nothing typed here is parsed back into what
 * travels — the field's own text is.
 */
export function fxRateLabel(typed: string): string | null {
  const trimmed = typed.trim();

  if (!FX_RATE_TEXT.test(trimmed) || Number(trimmed) <= 0) {
    return null;
  }

  return `${Number(trimmed).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} đồng per US$1`;
}

// ── The sentences ────────────────────────────────────────────────────────────

function rateIsBasisPoints(figure: string): string {
  return `${figure} is whole basis points — 800 for 8%, 150 for 1.5%. A percentage typed as 8 is eight hundredths of a percent, which is why the field takes the figure the row stores.`;
}

function staysIsACount(rung: string): string {
  return `${rung}'s stay count is a whole number of stays, at least one — a rung at zero stays is one every guest is already standing on.`;
}

function windowEndUnreadable(side: string, example: string): string {
  return `The relief period's ${side} is switched on, so it needs a date. Type one — ${example}, 2026-12-31 — or switch it off to leave that side of the window unbounded.`;
}

/**
 * The contract's first refusal, with the figure it is about named in front of
 * it.
 *
 * The schema's own words rather than a translation, for `room-list.ts`'s reason:
 * a bound changed in `packages/shared` should change what the operator reads.
 * The field's name is prefixed because those words are written about a value —
 * "Too big: expected number to be <=10000" — and this form has fourteen of them
 * on screen at once.
 */
function firstRefusal(issues: readonly ContractRefusal[]): string {
  const issue = issues[0];

  if (issue === undefined) {
    return "That is not a change to the configuration the API takes.";
  }

  const figure = FIGURE_LABELS[String(issue.path[0])];

  return figure === undefined ? issue.message : `${figure} — ${issue.message}`;
}

/** As much of a zod issue as this file reads. Structural rather than the
 *  library's own type so nothing here depends on which version of it the
 *  contract was built with. */
interface ContractRefusal {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
