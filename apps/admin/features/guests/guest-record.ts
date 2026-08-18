/* The guests screen's decisions: how a person is found, what their record reads
 * like, and who is offered the one call that reveals an identity number.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/rooms/room-list.ts` and `features/bookings/booking-search.ts` both
 * give: everything below is a judgement the API does not make for the console —
 * whether what an operator typed is a search the contract will accept, which
 * answer is a list of people and which is a refusal wearing one, what a record
 * with half its fields empty actually says, and which operator is shown a
 * control that would otherwise answer 403.
 *
 * Three rules hold throughout, and `guest-record.spec.ts` holds this file to
 * them:
 *
 * 1. **The number is never here.** Nothing in this module holds, derives or
 *    remembers a plain CCCD. {@link guestFacts} is built from named fields and
 *    the masked one is the only identity field it names, so a record cannot leak
 *    a number through a display helper that forgot. What the reveal answers is
 *    handed to the screen and to nothing else.
 * 2. **A list nobody could compute is not an empty list.** {@link guestList}
 *    answers `null` rather than `[]` when the search came back narrowed to a
 *    scope with no people in it, because "nobody matches" is a real sentence and
 *    printing it over a refusal is the console lying about the property.
 *    `booking-search.ts` states the same rule about stays, and this screen reads
 *    the other arm of the same union.
 * 3. **A refusal the operator can still fix is not sent.** The contract refuses
 *    a search with no criteria and a reason longer than it stores; so does this,
 *    in words naming the field, before a request leaves the browser.
 *
 * The search is `search.operational` and not a guest-listing route, because the
 * contract has none: there is no call that answers "every guest the property
 * has", and `contract/search.ts` says why the number is not among the
 * dimensions one can be found by. So this screen finds a person the way the desk
 * does — by the name or the telephone number somebody half remembers — and reads
 * the record only once a person has been picked.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  SEARCH_RESULT_LIMIT,
  type StaffRole,
  unmaskCccdInput as revealSchema,
} from "@mariva/shared";

/* The search's own shapes, taken from the module that owns them rather than
 * restated: the bookings screen already asks `search.operational` this question,
 * and a second `SearchCriteria` here would be a second opinion about one route.
 * Reached past `features/bookings`'s barrel — which re-exports client components
 * — for the reason `room-list.ts` gives about `board-queries`: a spec for a pure
 * module must not drag a screen in behind a type. */
import type {
  SearchAttempt,
  SearchCriteria,
  SearchResults,
} from "@/features/bookings/booking-search";
import { formatLongDate, PROPERTY_TIME_ZONE } from "@/lib/business-date";

/* The shapes, read off the client rather than restated — the same argument
 * every other feature makes: `@mariva/shared` types the client from the
 * contract's own schemas, so a field renamed there breaks this file in the pull
 * request that renamed it, where a hand-written interface would compile until it
 * was wrong. */
type FullResults = Extract<SearchResults, { scope: "everything" }>;

/** One person, as the search answers them — enough to pick the right one. */
export type GuestHit = FullResults["guests"][number];

/** The record itself, with its identity number masked. */
export type GuestRecord = Awaited<ReturnType<ApiClient["guest"]["readRecord"]>>;

/** One reading of one number, and the audit entry it just wrote. */
export type CccdReveal = Awaited<ReturnType<ApiClient["guest"]["unmaskCccd"]>>;

/** What that call takes. */
export type RevealInput = Parameters<ApiClient["guest"]["unmaskCccd"]>[0];

/** The people found, and whether the answer they were cut from was cut short. */
export interface GuestList {
  readonly guests: GuestHit[];
  /**
   * True when the search hit its own ceiling, so there are people this list
   * does not contain. Measured against what came back rather than against what
   * survived any filter: the cap is applied by the API before this file sees
   * anything, and there is no second page to ask for.
   */
  readonly truncated: boolean;
}

/** What the operator typed into the search, before any of it is read. */
export interface GuestSearchFields {
  fullName: string;
  phone: string;
}

/** An empty search, and the identity the screen resets to. */
export const NO_GUEST_SEARCH_FIELDS: GuestSearchFields = {
  fullName: "",
  phone: "",
};

/**
 * What the operator typed, as criteria — or the reason it is not a search yet.
 *
 * Two dimensions and no more. `operationalSearchQuery` names nine, and the seven
 * left out are facts about a room or a stay: a person is not narrowed by a
 * housekeeping status, and a screen offering the desk a room-number box on the
 * way to a guest record would be the bookings search drawn twice. The number is
 * not offered either, and could not be — `contract/search.ts` refuses to make it
 * searchable, because a filter over it would confirm a number from outside the
 * audit trail one guess at a time.
 *
 * No dates, and therefore no business date. Every other search on the console
 * counts a typed date from the property's own day; this one has nothing to
 * count, so it does not wait on a read it would not use.
 */
export function guestSearchCriteria(fields: GuestSearchFields): SearchAttempt {
  const guestName = fields.fullName.trim();
  const guestPhone = fields.phone.trim();

  if (guestName === "" && guestPhone === "") {
    return {
      problem:
        "A search needs something to go on — a name, or a telephone number.",
    };
  }

  const criteria: SearchCriteria = {
    ...(guestName === "" ? {} : { guestName }),
    ...(guestPhone === "" ? {} : { guestPhone }),
  };

  return { criteria };
}

/**
 * The people in an answer, in the order the desk reads them.
 *
 * Ordered here rather than left in the API's order, for the reason
 * `booking-search.ts` orders stays: the list is walked with the arrow keys and
 * re-rendered on every refetch, and an order that depends on how the rows came
 * back is an order that can move under the operator between two presses. By
 * name, because a name is what was searched for; the id breaks the tie, so two
 * people called the same thing hold a fixed order rather than trading places.
 */
export function guestList(results: SearchResults): GuestList | null {
  if (results.scope !== "everything") {
    return null;
  }

  const guests = [...results.guests].sort(
    (left, right) =>
      left.fullName.localeCompare(right.fullName) ||
      left.id.localeCompare(right.id),
  );

  return { guests, truncated: results.guests.length >= SEARCH_RESULT_LIMIT };
}

/**
 * Who is offered the reveal — the matrix's *Unmask CCCD number* row, which is
 * `MANAGER`, `ADMIN` and a conditional `RECEPTIONIST`.
 *
 * The accountant is the one role that reaches this screen and is not offered it.
 * `nav-inventory.ts` gives them the family because they may read a guest record,
 * and the row above that one — *Read guest record, CCCD masked* — is where that
 * grant stops.
 *
 * Not a wall. The API's capability guard is the wall; what this decides is
 * whether a door is shown to somebody it would refuse, which is the console's
 * own rule for every other role-gated control.
 */
export function mayRevealCccd(role: StaffRole): boolean {
  return role === "RECEPTIONIST" || role === "MANAGER" || role === "ADMIN";
}

/** One line of a record: what it is, and what it says. */
export interface GuestFact {
  readonly label: string;
  readonly value: string;
}

// Day and time together, in Ho Chi Minh City — `housekeeping-board.ts`'s
// formatter and its argument: a bare clock would read "07:40" for a record
// touched a week ago. Both instants on a guest record are timestamps rather than
// calendar dates, so they cross into the property's zone here rather than being
// sliced out of the ISO text.
const instantFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // h23, for `business-date.ts`'s reason: h24 renders midnight as hour 24.
  hourCycle: "h23",
});

/** An instant, in the property's own zone. */
export function formatInstant(isoInstant: string): string {
  return instantFormatter.format(new Date(isoInstant));
}

/**
 * The record as the screen prints it, minus the identity number.
 *
 * Built from named fields, which is this module's confidentiality claim as code:
 * the plain number has no field here to travel in, so a screen drawing the
 * record cannot show one by iterating over whatever the response happens to
 * carry. The masked number is drawn beside its own control instead, because it
 * is the one field on the record that has an act attached to it.
 *
 * An empty field says it is empty rather than disappearing. A record is read at
 * the desk against a document in somebody's hand, and "no telephone number on
 * file" and "this screen did not show you the telephone number" are answers the
 * operator must be able to tell apart.
 */
export function guestFacts(record: GuestRecord): GuestFact[] {
  return [
    { label: "Telephone", value: record.phone ?? "None on file" },
    { label: "Email", value: record.email ?? "None on file" },
    {
      label: "Date of birth",
      value:
        record.dateOfBirth === null
          ? "None on file"
          : formatLongDate(record.dateOfBirth),
    },
    { label: "Nationality", value: record.nationality ?? "None on file" },
    { label: "Known since", value: formatInstant(record.createdAt) },
    { label: "Last changed", value: formatInstant(record.updatedAt) },
  ];
}

/** Either a reading the contract will take, or the sentence that says why not. */
export type RevealAttempt =
  | { readonly input: RevealInput }
  | { readonly problem: string };

/**
 * One decision to look at one number.
 *
 * **The reason is optional and stays optional**, which is the contract's own
 * choice: requiring one produces a column full of "check in", and the
 * attribution — who looked, and when — is what makes the reading accountable.
 * An empty box is therefore a reading with no reason rather than a refusal, and
 * the field is omitted rather than sent blank, so the audit column holds a null
 * instead of a string nobody wrote.
 *
 * The bound is the contract's schema run here rather than restated, so a length
 * changed in `packages/shared/src/contract/guest.ts` cannot drift from what this
 * form enforces — and a reason too long to store is refused where it can still
 * be shortened rather than after the press.
 */
export function revealAttempt(guestId: string, reason: string): RevealAttempt {
  const trimmed = reason.trim();
  const input: RevealInput = {
    guestId,
    ...(trimmed === "" ? {} : { reason: trimmed }),
  };

  const checked = revealSchema.safeParse(input);

  if (!checked.success) {
    // The one refusal an operator can act on is the reason, because it is the
    // only field they typed. Anything else the schema refuses is about the id
    // this screen supplied, and reporting that as a problem with the reason
    // would send them to fix a field which is already correct.
    return {
      problem:
        trimmed.length > 0
          ? "That reason is longer than the audit log stores. Shorten it to a line."
          : (checked.error.issues[0]?.message ??
            "That is not a reading the API takes."),
    };
  }

  return { input };
}

/**
 * The audit entry the reveal just wrote, said back to the person who caused it.
 *
 * The response carries the entry rather than a promise that one was made, and
 * this is the console honouring that: the operator reads when the reading was
 * recorded, at the moment they read the number. `unmaskedBy` is a staff id and
 * is not printed — it is the account that pressed the control, so the sentence
 * names it as such rather than putting a uuid in front of somebody.
 */
export function revealNotice(reveal: CccdReveal): string {
  return `Recorded against your account at ${formatInstant(reveal.unmaskedAt)}.`;
}
