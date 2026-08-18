/* The bookings screen's decisions: what it asks the API, and what it does with
 * the answer.
 *
 * Pure, and separate from the hooks and the markup beside it, for the reason
 * `features/arrivals/arrival-queue.ts` and `features/dashboard/day-counts.ts`
 * both give: everything below is a judgement the API does not make for the
 * console — which window "today" is, whether what an operator typed is a search
 * the contract will accept, what a typed date means, whether a party is one a
 * room could hold, and what a freshly created stay looks like to the check-in
 * sequence. Those are the parts that can be wrong in a way nobody notices until
 * a guest is standing at the counter.
 *
 * Four rules hold throughout, and `booking-search.spec.ts` holds this file to
 * them:
 *
 * 1. **The day is the property's, not the browser's.** Nothing here reads a
 *    clock. The business date arrives on the housekeeping board, resolved by
 *    the API against `system_config.business_date_rollover_hour`, and both the
 *    default window and every relative date an operator types are counted from
 *    that string.
 * 2. **A list nobody could compute is not an empty list.** {@link stayList}
 *    answers `null` rather than `[]` when the search came back narrowed to a
 *    scope with no stays in it, because "no stay matches" is a real sentence and
 *    printing it over a refusal is the console lying about the property.
 * 3. **A capped answer says it was capped.** `search.operational` answers at
 *    most {@link SEARCH_RESULT_LIMIT} stays and offers no cursor, so a list cut
 *    from it can be short and the screen has to say so.
 * 4. **A refusal the operator can still fix is not sent.** The contract refuses
 *    a search with no criteria, a range with one end, and a departure that does
 *    not fall after an arrival; so does this, in words naming the field, before
 *    a request leaves the browser.
 */

import type { ApiClient } from "@mariva/api-client";
import {
  createBookingInput as createBookingSchema,
  type RatePlanCode,
  type RoomTypeCode,
  SEARCH_RESULT_LIMIT,
  type StaffRole,
} from "@mariva/shared";

/* `Arrival` travels as a type only, so nothing of the arrivals feature is
 * loaded here — the walk-in path is the one place its component is imported,
 * and that is a component's file. `shiftDate` is taken from the module that
 * owns it rather than through `features/dashboard`'s barrel, which re-exports
 * client components: a pure module that pulled one in would drag the whole
 * screen into a spec that only wants a date. */
import type { Arrival } from "@/features/arrivals";
import { shiftDate } from "@/features/dashboard/day-counts";
import { parseLiberalDate } from "@/lib/date-parser";

/* The shapes, read off the client rather than restated — the same argument
 * `day-counts.ts` and `arrival-queue.ts` make: `@mariva/shared` types the client
 * from the contract's own schemas, so a field renamed there breaks this file in
 * the pull request that renamed it, where a hand-written interface would compile
 * until it was wrong. */
export type SearchResults = Awaited<
  ReturnType<ApiClient["search"]["operational"]>
>;
export type SearchCriteria = Parameters<ApiClient["search"]["operational"]>[0];
type FullResults = Extract<SearchResults, { scope: "everything" }>;

/** One stay, as the search answers it. */
export type Stay = FullResults["bookings"][number];

/** A stay as the desk's own creating door answers it. */
export type CreatedBooking = Awaited<
  ReturnType<ApiClient["booking"]["createConfirmed"]>
>;

/** What that door takes. */
export type CreateBookingInput = Parameters<
  ApiClient["booking"]["createConfirmed"]
>[0];

/** The list, and whether the answer it was cut from had been cut short. */
export interface StayList {
  readonly stays: Stay[];
  /**
   * True when the search hit its own ceiling, so there are stays this list does
   * not contain. Measured against what came back rather than against what
   * survived any filter: the cap is applied by the API before this file sees
   * anything, and there is no second page to ask for.
   */
  readonly truncated: boolean;
}

/**
 * The window the screen opens on — every stay occupying the property today.
 *
 * `docs/screens.md` §"Staff surfaces" states it: Bookings opens anchored on
 * today, "arriving, in-house and departing stays". The API matches a stay to a
 * window by overlap, half-open on both sides, so `[today, tomorrow)` is exactly
 * those three groups and nothing else — an arrival is a stay whose first night
 * is today, a departure is one whose last night was yesterday and which is
 * therefore still overlapping, and everything between is in house.
 *
 * **No state filter**, which is what separates this from the two queues. The
 * arrivals card asks for `CONFIRMED` and the departures card for `CHECKED_IN`,
 * because each is a queue of one act; this screen is the desk answering "what
 * about this stay" on the telephone, and a cancelled booking somebody is asking
 * about is a stay it must be able to find.
 */
export function todaysCriteria(businessDate: string): SearchCriteria {
  return { from: businessDate, to: shiftDate(businessDate, 1) };
}

/**
 * Whether this operator may take a booking.
 *
 * The matrix's *Create / modify booking* row — `booking.write` — is `full` for
 * RECEPTIONIST, MANAGER and ADMIN and denied to everybody else, and the console
 * offers this family to one more role than that: `nav-inventory.ts` gives
 * Bookings to the accountant, who reads bookings under *Read any booking* and
 * does not act on them.
 *
 * So the accountant reaches this screen and is offered no creating control at
 * all — not a disabled one, and not one that answers 403 after the press. The
 * API's guard is still the wall; what this decides is whether a door is shown to
 * somebody it would refuse, which `nav-inventory.ts` makes the console's own
 * rule for the same reason.
 */
export function mayTakeBookings(role: StaffRole): boolean {
  return role === "RECEPTIONIST" || role === "MANAGER" || role === "ADMIN";
}

/** What the operator typed into the search, before any of it is read. */
export interface SearchFields {
  reference: string;
  guestName: string;
  guestPhone: string;
  from: string;
  to: string;
}

/** An empty search, and the identity the screen resets to. */
export const NO_SEARCH_FIELDS: SearchFields = {
  reference: "",
  guestName: "",
  guestPhone: "",
  from: "",
  to: "",
};

/** Either a search the contract will accept, or the sentence that says why not. */
export type SearchAttempt =
  | { readonly criteria: SearchCriteria }
  | { readonly problem: string };

/**
 * What the operator typed, as criteria — or the reason it is not a search yet.
 *
 * The three refusals below are `operationalSearchQuery`'s own, applied where the
 * operator can still fix them. A `400` arriving after the press would say the
 * same thing in the API's words and cost a round trip to say it.
 *
 * Dates are read with `lib/date-parser.ts`, counted from the property's business
 * date: the desk types "15/3", "+2d" or pastes an ISO date out of an email, and
 * a field that took one spelling would move the cost of the format onto the
 * person with a guest on the telephone. What leaves here is always `YYYY-MM-DD`,
 * which is what `stayDateSchema` decodes.
 */
export function searchCriteria(
  fields: SearchFields,
  businessDate: string,
): SearchAttempt {
  const reference = fields.reference.trim();
  const guestName = fields.guestName.trim();
  const guestPhone = fields.guestPhone.trim();
  const typedFrom = fields.from.trim();
  const typedTo = fields.to.trim();

  if ((typedFrom === "") !== (typedTo === "")) {
    return {
      problem:
        "A date range needs both ends. Give the arrival and the departure, or neither.",
    };
  }

  let from: string | undefined;
  let to: string | undefined;

  if (typedFrom !== "" && typedTo !== "") {
    const start = parseLiberalDate(typedFrom, businessDate);
    const end = parseLiberalDate(typedTo, businessDate);

    if (start === null || end === null) {
      return {
        problem:
          "A date can be written 15/3, 2026-03-15, today or +2d. That was not one of them.",
      };
    }

    if (start >= end) {
      // String comparison, because both are `YYYY-MM-DD` — the one format where
      // lexical order and calendar order are the same thing.
      return { problem: "The end of the range has to fall after its start." };
    }

    from = start;
    to = end;
  }

  if (
    reference === "" &&
    guestName === "" &&
    guestPhone === "" &&
    from === undefined
  ) {
    return {
      problem:
        "A search needs something to go on — a reference, a name, a telephone number or a range of dates.",
    };
  }

  return {
    criteria: {
      ...(reference === "" ? {} : { reference }),
      ...(guestName === "" ? {} : { guestName }),
      ...(guestPhone === "" ? {} : { guestPhone }),
      ...(from === undefined || to === undefined ? {} : { from, to }),
    },
  };
}

/**
 * The stays in an answer, in the order the desk reads them.
 *
 * Ordered here rather than left in the API's order even though the two agree
 * today — `search.service.ts` sorts by arrival and breaks the tie on the
 * reference — because the list is walked with the arrow keys and re-rendered on
 * every refetch, and an order that depends on how the rows came back is an order
 * that can move under the operator between two presses. Arrival first, because
 * the screen is anchored on a day and a day of stays reads chronologically.
 */
export function stayList(results: SearchResults): StayList | null {
  if (results.scope !== "everything") {
    return null;
  }

  const stays = [...results.bookings].sort(
    (left, right) =>
      left.checkIn.localeCompare(right.checkIn) ||
      left.reference.localeCompare(right.reference),
  );

  return { stays, truncated: results.bookings.length >= SEARCH_RESULT_LIMIT };
}

/** What the desk is taking down, and what happens once it is taken. */
export type BookingKind = "phone" | "walk-in";

/** What the new-booking form collects, before any of it is read. */
export interface NewBookingFields {
  kind: BookingKind;
  /* The two closed enums, typed as the contract's own codes rather than as
   * strings: the form offers `ROOM_TYPE_CODES` and `RATE_PLAN_CODES` and
   * nothing else, so a sixth type invented anywhere is a compile error here
   * instead of a `400` with a guest on the telephone. */
  roomType: RoomTypeCode;
  plan: RatePlanCode;
  checkIn: string;
  checkOut: string;
  adults: string;
  childAges: string;
  /* Who to write to, and what to call them. Two fields on the form because the
   * contract takes two, and read together because one constrains the other —
   * {@link newBookingInput} refuses an address with no name against it, and asks
   * a telephone booking for both. */
  contactName: string;
  contactEmail: string;
}

/** Either a stay the contract will take, or the sentence that says why not. */
export type NewBookingAttempt =
  | { readonly input: CreateBookingInput }
  | { readonly problem: string };

/**
 * The nights a new booking opens on.
 *
 * Tonight, for both kinds. A walk-in is somebody at the counter and is arriving
 * now by definition; a telephone booking is more often for a later date, but the
 * property's own day is the one date the desk never has to be told, and every
 * other one is one keystroke away — "+2d", "15/3" — through the same parser.
 */
export function defaultStay(businessDate: string): {
  checkIn: string;
  checkOut: string;
} {
  return { checkIn: businessDate, checkOut: shiftDate(businessDate, 1) };
}

/**
 * The stay as `createBookingInput` takes it, or the reason it is not one yet.
 *
 * **The bounds are the contract's own schema, run here.** A party a room could
 * hold and the band `FR-PRC-04` prices a child in are both numbers
 * `createBookingInput` already states, and restating them in the console would
 * be a second copy of a policy that can drift — so the assembled stay is put
 * through the schema itself and its refusal is what the operator reads. What is
 * checked before that is only what a schema cannot say kindly: a date nobody can
 * read, a count that is not a number, a departure before an arrival.
 *
 * **No price and no restriction check.** §8 has the booking freeze what it was
 * quoted and the quote is computed inside the transaction that consumes the
 * nights, so a figure sent from here would be a price the desk proposed. What
 * the calendar allows is the API's answer too: this form collects and submits.
 *
 * **A walk-in arrives today, and the arrival field is not asked about.** A
 * walk-in is a guest standing at the counter, so its first night is the
 * property's own day by definition — `check-in.guard.ts` refuses the check-in
 * that follows it on any other date, and a stay created for next week that the
 * desk is then walked into a check-in for is a sequence the API cannot let
 * finish. So the business date is what leaves here for that kind, whatever the
 * form holds; the form pins the field to the same date, so the operator is
 * never sent something other than what they read. A telephone booking is the
 * one that takes a date, because it is the one where the guest is elsewhere.
 *
 * **The contact is required of a telephone booking and optional for a walk-in,
 * and this file is the only place that distinction can be made.** The contract
 * takes both halves optionally on the desk's door and nothing on the wire says
 * which of the two conversations the operator is in — a `kind` field would be a
 * claim a caller makes freely, so the requirement it governed could be escaped
 * by making the other claim. The screen knows: a walk-in is somebody at the
 * counter who is handed their confirmation and may genuinely have no address,
 * while a telephone booking with none is a stay the property cannot write to
 * about its own cancellation or its arrival. So the refusal lives here, in
 * words naming the field, before a request leaves the browser.
 *
 * That screen rule is the stricter of the two and stays stricter. The contract
 * refuses only an address with no name against it, because a name on its own is
 * what a call sometimes leaves behind and is worth keeping; this form still asks
 * a telephone booking for both, because an operator with the guest on the line
 * can ask for the address and a stay the property cannot write to is one it
 * cannot send a cancellation or an arrival reminder about.
 */
export function newBookingInput(
  fields: NewBookingFields,
  businessDate: string,
): NewBookingAttempt {
  const checkIn =
    fields.kind === "walk-in"
      ? businessDate
      : parseLiberalDate(fields.checkIn, businessDate);
  const checkOut = parseLiberalDate(fields.checkOut, businessDate);

  if (checkIn === null || checkOut === null) {
    return {
      problem:
        "A date can be written 15/3, 2026-03-15, today or +2d. That was not one of them.",
    };
  }

  if (checkIn >= checkOut) {
    return { problem: "The departure has to fall after the arrival." };
  }

  const adults = parseCount(fields.adults);

  if (adults === null || adults < 1) {
    return { problem: "A stay is sold to at least one adult." };
  }

  const childAges = parseChildAges(fields.childAges);

  if (childAges === null) {
    return {
      problem:
        'Children are written as ages, separated by commas — "5, 9". A party of adults leaves it empty.',
    };
  }

  const contactName = fields.contactName.trim();
  const contactEmail = fields.contactEmail.trim();

  if (fields.kind === "phone" && (contactName === "" || contactEmail === "")) {
    return {
      problem:
        "A telephone booking needs a name and an email address — the guest is not here to be handed anything.",
    };
  }

  // An address with nobody's name against it, on either path. The name alone is
  // taken — it is what a telephone call leaves behind, and the property can
  // still say whose stay it is — but nothing can compose a message to a mailbox
  // it cannot address, so this is the half that is refused.
  if (contactName === "" && contactEmail !== "") {
    return {
      problem:
        "An email address needs a name to go with it — that is who the confirmation is addressed to.",
    };
  }

  const input: CreateBookingInput = {
    roomType: fields.roomType,
    plan: fields.plan,
    checkIn,
    checkOut,
    adults,
    childAges,
    // Omitted rather than sent empty when the desk has nobody to write to: the
    // contract refuses an empty name and an address that is not one, and a
    // walk-in genuinely has neither. Spread apart rather than as a pair, because
    // the two halves no longer travel together — a name taken over the telephone
    // with no address behind it is a contact the contract accepts, and an empty
    // string sent beside it would be refused as an address that is not one.
    ...(contactName === "" ? {} : { contactName }),
    ...(contactEmail === "" ? {} : { contactEmail }),
  };

  const checked = createBookingSchema.safeParse(input);

  // The schema's own words, and the first refusal rather than all of them: a
  // form with one message beside it is one thing to fix, and the operator
  // presses again. What is *sent* is the input above and never the parsed
  // output — the schema decodes a date into a `CalendarDate`, which is a shape
  // for a service to hold and not one to put on the wire.
  return checked.success
    ? { input }
    : { problem: checked.error.issues[0]?.message ?? "That is not a stay." };
}

/** A whole number an operator typed, or null. */
function parseCount(typed: string): number | null {
  const trimmed = typed.trim();

  return /^\d{1,3}$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

/**
 * The children's ages, as `FR-PRC-04` prices them — or null.
 *
 * Ages and not a head count, which is `availability.ts`'s rule carried to the
 * desk: three bands price a child and a number cannot say which band. An empty
 * field is a party of adults, which is the ordinary case and not an error.
 *
 * Separated by commas or spaces, because both are what somebody types. Anything
 * that is not a number refuses the whole list rather than being dropped — a
 * child silently discarded would sell a room to a party one head smaller than
 * the one arriving. Which ages are a *child's* is the contract's band and is
 * checked there, once, by {@link newBookingInput}.
 */
export function parseChildAges(typed: string): number[] | null {
  const trimmed = typed.trim();

  if (trimmed === "") {
    return [];
  }

  const ages = trimmed.split(/[\s,]+/).map(parseCount);

  return ages.every((age) => age !== null) ? ages : null;
}

/**
 * Whether the check-in follows the creation here, at the counter.
 *
 * Two questions, and the second one is not a restatement of the first. The kind
 * is what the operator said they were doing: a telephone booking stops at
 * `CONFIRMED` and surfaces in arrivals on its date, and nobody is registered on
 * it until they turn up. The date is what the property will actually allow —
 * `check-in.guard.ts` refuses a check-in before the arrival date, so a stay
 * arriving next week has no sequence that can complete, and opening one walks
 * the desk into a dead end it can only press Escape out of.
 *
 * Asked of the booking that came back rather than of the form that was typed,
 * because the answer that matters is about the stay the property now holds.
 * A creation whose arrival is not today gets the confirmation the telephone
 * path gets, which already says where the stay went.
 */
export function checkInFollows(
  booking: CreatedBooking,
  kind: BookingKind,
  businessDate: string,
): boolean {
  return kind === "walk-in" && booking.checkIn === businessDate;
}

/**
 * A stay the desk has just taken, in the shape the arrivals check-in sequence
 * reads.
 *
 * The walk-in path is `docs/screens.md`'s requirement that a guest at the desk
 * "is never parked in a queue": the booking and the check-in are one
 * conversation, so creation flows straight into the same sequence arrivals
 * works, rather than into a second implementation of it here.
 *
 * The two fields the creating route does not answer are both known rather than
 * assumed. A booking one request old holds no room — assignment is the sequence's
 * own second step — and nobody is registered on it, because a registration is
 * what checking in writes. Both are literally what the search would answer for
 * this stay if it were asked a moment from now.
 */
export function walkInArrival(booking: CreatedBooking): Arrival {
  return {
    id: booking.id,
    reference: booking.reference,
    state: booking.state,
    roomType: booking.roomType,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    roomNumber: null,
    guestNames: [],
  };
}
