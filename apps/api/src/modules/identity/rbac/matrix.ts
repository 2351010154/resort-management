// The RBAC matrix, as data.
//
// docs/architecture/rbac-matrix.md is the authority and this file is its
// mirror: one entry per row of its §3, in the same order, under the same
// section headings, carrying the row's label verbatim so a diff between the
// two is a diff a reader can perform. Change the document first, then this
// table, then the code that names a key.
//
// §4 obliges a test that covers **every** row. That test is data-driven off
// this array — a row added here without a matching document row, or with a
// grant the document does not give it, is caught there rather than at review.
//
// A capability is not a route. Routes declare which capability they need, and
// several routes may need the same one; the guard resolves the caller's grant
// from this table and nothing else. That is what makes a route with no
// declaration unreachable instead of accidentally public (§2, deny by default).

import {
  GRANTS,
  type Grant,
  type StaffRole,
  STAFF_ROLES,
} from "./roles.js";

/** One row of the matrix. */
export interface Capability {
  /** Stable identifier a route declares. Never reused for a different row. */
  readonly key: string;
  /** The §3 section the row sits under, verbatim. */
  readonly section: string;
  /** The row's capability label, verbatim. */
  readonly row: string;
  /**
   * Reachable without any session at all — §3's first two rows and no others.
   * A stranger searches for a room and holds one; everything past that point
   * either identifies them or is scoped by a credential they were issued.
   */
  readonly unauthenticated: boolean;
  /** What the guest realm's single role may do. */
  readonly guest: Grant;
  /** What each staff role may do. */
  readonly staff: Readonly<Record<StaffRole, Grant>>;
  /** The row's Notes column, where it carries a constraint worth keeping. */
  readonly note?: string;
}

const DENIED_TO_ALL_STAFF: Readonly<Record<StaffRole, Grant>> = Object.freeze({
  HOUSEKEEPING: "denied",
  RECEPTIONIST: "denied",
  ACCOUNTANT: "denied",
  MANAGER: "denied",
  ADMIN: "denied",
});

/**
 * A row's staff column, written as its exceptions. Deny-by-default is the rule
 * (§2), so spelling out the four denials on every row would bury the two
 * grants that carry the row's meaning.
 */
function staff(
  granted: Partial<Record<StaffRole, Grant>>,
): Readonly<Record<StaffRole, Grant>> {
  return Object.freeze({ ...DENIED_TO_ALL_STAFF, ...granted });
}

export const CAPABILITIES = [
  // ── Public and guest realm ───────────────────────────────────────────────
  {
    key: "availability.search",
    section: "Public and guest realm",
    row: "Availability + rate search",
    unauthenticated: true,
    guest: "full",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Public, unauthenticated",
  },
  {
    // Public, and the second row that is. A guest books before they have an
    // account, not after: requiring a session here would put a sign-up wall in
    // front of the only thing a stranger came to the site to do, and the account
    // that a booking may later be attached to is offered once the money has
    // landed. The stay it creates belongs to whoever holds the credential
    // `booking.controller.ts` issues alongside it, which is what the two
    // conditional rows below are read against.
    //
    // It is also the first unauthenticated write in the application, and it
    // reserves inventory. Availability search above answers a question; this one
    // takes rooms off the shelf, so the route behind it is rate-limited by IP —
    // without that, the public door is a way to hold the property empty for
    // nothing.
    key: "booking.create-own",
    section: "Public and guest realm",
    row: "Create own booking",
    unauthenticated: true,
    guest: "full",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Public, unauthenticated; staff create on behalf; hold rate-limited",
  },
  {
    // ⚠ against a session **or** a booking-scoped token. The guest who booked
    // without an account has no session to be scoped by, and the token issued
    // when they took the hold is what names the one stay they may read. The
    // guard resolves which credential arrived; the handler still owes the
    // ownership check either way, which is what ⚠ has always meant on this row.
    key: "booking.read-own",
    section: "Public and guest realm",
    row: "Read own booking / stay history",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own records only; session or booking token",
  },
  {
    // The same pair of credentials as the read above, and for the same reason:
    // a guest who could not cancel the stay they booked anonymously would have
    // to telephone the desk to undo something they did on the web.
    key: "booking.cancel-own",
    section: "Public and guest realm",
    row: "Cancel own booking",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own, penalty per policy; session or booking token",
  },
  {
    // The pair the funnel's review screen collects, against a hold the caller
    // already has. Its own row rather than a second use of the create row above:
    // that one is public and takes rooms off the shelf, this one is authenticated
    // and edits a stay, and folding them together would make the unauthenticated
    // door wider than it is.
    //
    // The same two credentials as the read and the cancellation, for the same
    // reason — a guest who held a room without signing up has no session, and a
    // funnel that could not learn their address would have nowhere to send the
    // confirmation.
    //
    // Denied to every staff role. A receptionist correcting a guest's address
    // does it on the booking through the desk's own doors, where the change is
    // audited as the desk's act; this row is the guest speaking for themselves.
    key: "booking.contact-own",
    section: "Public and guest realm",
    row: "Name the contact on own hold",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own hold only, while HELD; session or booking token",
  },
  {
    // The funnel saying the guest is still on the hold it took. Its own row for
    // the reason the contact pair has one: it is an authenticated write to a
    // stay, where the create row above it is public and takes rooms off the
    // shelf, and folding them together would widen the unauthenticated door.
    //
    // Not filed under `booking.read-own` either, though nothing it writes is
    // about the booking as the guest reads it. That row is declared as a read on
    // every route that carries it, and a write borrowing a read's row is how a
    // 👁 grant stops meaning anything.
    //
    // The same two credentials as the read, the cancellation and the contact —
    // the guest this exists for has no account, and a hold that could not be kept
    // alive by the only credential the funnel issues would be a hold that always
    // died at the grace.
    //
    // Denied to every staff role. Nobody at the desk is standing on a funnel
    // screen, and a receptionist who wants a room held takes the booking through
    // the desk's own door, which has no TTL to keep alive.
    key: "booking.presence-own",
    section: "Public and guest realm",
    row: "Keep own hold alive",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own hold only; cooperative, never a defence; session or booking token",
  },
  {
    key: "guest.profile",
    section: "Public and guest realm",
    row: "Own profile, loyalty, VIP tier",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({ RECEPTIONIST: "read", MANAGER: "read", ADMIN: "read" }),
  },
  {
    key: "guest.id-scan.upload-own",
    section: "Public and guest realm",
    row: "Upload own ID scan",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
  },
  {
    key: "feedback.submit",
    section: "Public and guest realm",
    row: "Post-stay feedback",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({ MANAGER: "read", ADMIN: "read" }),
    note: "Tied to a CHECKED_OUT booking",
  },

  // ── Bookings and front desk ──────────────────────────────────────────────
  {
    key: "booking.read-any",
    section: "Bookings and front desk",
    row: "Read any booking",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "booking.write",
    section: "Bookings and front desk",
    row: "Create / modify booking",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "booking.cancel-policy",
    section: "Bookings and front desk",
    row: "Cancel with policy penalty",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "booking.cancel-waiver",
    section: "Bookings and front desk",
    row: "Cancel with waiver / override",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
    note: "Waives any cell of the §4 grid, not only a cancellation",
  },
  {
    key: "booking.check-in",
    section: "Bookings and front desk",
    row: "Check-in",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Requires assigned room",
  },
  {
    key: "booking.check-out",
    section: "Bookings and front desk",
    row: "Check-out",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Requires settled folio",
  },
  {
    key: "booking.assign-room",
    section: "Bookings and front desk",
    row: "Assign room / room move",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "booking.extend-stay",
    section: "Bookings and front desk",
    row: "Extend stay",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Fails without inventory",
  },
  {
    key: "booking.early-checkout",
    section: "Bookings and front desk",
    row: "Early checkout (policy charge)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "booking.mark-no-show",
    section: "Bookings and front desk",
    row: "Mark NO_SHOW manually",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
    note: "Night audit does it automatically",
  },
  {
    key: "booking.reinstate-no-show",
    section: "Bookings and front desk",
    row: "Reinstate NO_SHOW → CHECKED_IN",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
    note: "Late arrival; needs inventory",
  },
  {
    key: "search.operational",
    section: "Bookings and front desk",
    row: "Search rooms / guests / bookings",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      HOUSEKEEPING: "conditional",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "HK: rooms only",
  },
  {
    // The desk's answer to a guest who has lost both the confirmation email and
    // the browser that held their stay. Its own row rather than a use of
    // "Create / modify booking", because what it authorises is not an edit: no
    // column of the booking changes, and what happens instead is that a message
    // carrying a credential leaves the property for a guest's address. A row
    // that already means "change the dates" would carry that quietly.
    //
    // `RECEPTIONIST` and above, and the grant follows the conversation: this is
    // pressed while somebody is at the counter or on the telephone, which is the
    // front desk's work. `ACCOUNTANT` reads bookings and does not have that
    // conversation, so the row is denied there rather than granted `read` —
    // there is nothing here to read.
    //
    // Full and not conditional. The guard can see the whole decision: any stay,
    // no ownership to check, and the address the mail goes to is read off the
    // booking rather than named by the caller.
    key: "booking.resend-account-link",
    section: "Bookings and front desk",
    row: "Send a booking's account link again",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Mails the account link to the address on the booking, never to one the caller names; identity is checked out-of-band and the send is audited",
  },

  // ── Housekeeping and room state ──────────────────────────────────────────
  {
    key: "housekeeping.set-condition",
    section: "Housekeeping and room state",
    row: "Set CLEAN / DIRTY / INSPECTED",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      HOUSEKEEPING: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "housekeeping.set-out-of-order",
    section: "Housekeeping and room state",
    row: "Set OUT_OF_ORDER status",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      HOUSEKEEPING: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Room state only",
  },
  {
    key: "inventory.close-room",
    section: "Housekeeping and room state",
    row: "Room closure reducing sellable inventory",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
    note: "Changes total_rooms — a commercial act, not a cleaning one",
  },
  {
    key: "housekeeping.board",
    section: "Housekeeping and room state",
    row: "Housekeeping board",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      HOUSEKEEPING: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },

  // ── Rooms, rates, inventory ──────────────────────────────────────────────
  {
    key: "inventory.room-crud",
    section: "Rooms, rates, inventory",
    row: "Room type + room CRUD",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "pricing.rate-plans",
    section: "Rooms, rates, inventory",
    row: "Rate plans, rate calendar, promotions",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "read",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    // Read-only for every role including `ADMIN`, which is not an oversight and
    // is the one row where the inheritance in §2 has nothing to add. Nothing in
    // this milestone edits the catalog — §6 seeds it and calls it data — so
    // `full` here would be an authority over a write path that does not exist,
    // and the day it does the grant is decided with it rather than inherited
    // from a row that guessed.
    key: "service.read-catalog",
    section: "Rooms, rates, inventory",
    row: "Read the service catalog",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "read",
      ACCOUNTANT: "read",
      MANAGER: "read",
      ADMIN: "read",
    }),
    note: "What is for sale; posting one is a folio row",
  },
  {
    key: "pricing.stay-restrictions",
    section: "Rooms, rates, inventory",
    row: "Stay restrictions (min/max, CTA/CTD)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ RECEPTIONIST: "read", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "pricing.rate-override",
    section: "Rooms, rates, inventory",
    row: "Rate override on a booking",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
    note: "Beyond the plan's price",
  },
  {
    key: "inventory.overbooking-limits",
    section: "Rooms, rates, inventory",
    row: "Overbooking limits (P6.5)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
  },

  // ── Folio and money ──────────────────────────────────────────────────────
  {
    key: "folio.read",
    section: "Folio and money",
    row: "Read folio",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Guest: own, settled view",
  },
  {
    key: "folio.post-charge",
    section: "Folio and money",
    row: "Post charge (room, service, minibar)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "folio.post-payment",
    section: "Folio and money",
    row: "Post payment",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  // Opening a gateway attempt, next to the row it is the other half of. The
  // grants are "Post payment"'s exactly, because it is the same authority
  // reached the other way round: posting a payment files money the desk has
  // already been handed, and this sends the payer somewhere to hand it over.
  // A role trusted to record a settlement is trusted to ask for one — and the
  // narrower reading, receptionist only, would leave the accountant chasing an
  // unpaid balance with no way to raise a payment link.
  //
  // The guest realm holds this conditionally, which is the funnel's payment step
  // and the narrowest grant that can carry it. It was `denied` while a booking
  // had no owning account: a guest could not show that a stay was theirs, so any
  // grant at all would have opened a payment page against any stay whose id the
  // caller had. `booking.user_id` closes that, and closing it is what moves the
  // row — the account the funnel took the booking under is the thing an
  // ownership check compares against.
  //
  // `conditional` and not `full`, because the guard cannot see the comparison.
  // The handler owes it: a payment attempt is only this caller's to open when
  // the stay's `user_id` is the requester's account, and a stay the desk took
  // holds a null there and is therefore nobody's.
  //
  // The account is one of two ways that condition is paid. A funnel guest who
  // never signed up holds the booking-scoped token the hold issued, and it opens
  // this row for the one stay it names — without it the funnel would take a
  // booking from a stranger and then demand they register to pay for it, which
  // is the sign-up wall moved one screen later rather than removed.
  {
    key: "payment.open-attempt",
    section: "Folio and money",
    row: "Open a gateway payment attempt",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Guest: own booking, by session or booking token. The handler must confirm the stay belongs to the requesting account, or is the one the token names",
  },
  {
    key: "folio.refund-policy",
    section: "Folio and money",
    row: "Refund within policy",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "folio.refund-override",
    section: "Folio and money",
    row: "Refund override / discretionary",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "folio.reverse-posting",
    section: "Folio and money",
    row: "Reverse a posting",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Never a delete",
  },
  {
    key: "folio.close-invoice",
    section: "Folio and money",
    row: "Close folio, issue invoice",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "folio.invoice-adjust",
    section: "Folio and money",
    row: "Invoice adjust / replace",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "full", MANAGER: "full", ADMIN: "full" }),
    note: "điều chỉnh / thay thế",
  },
  {
    key: "payment.reconcile",
    section: "Folio and money",
    row: "Gateway reconciliation",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "operations.income-expense",
    section: "Folio and money",
    row: "Income / expense (thu chi)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "operations.cash-drawer",
    section: "Folio and money",
    row: "Cash drawer open / close / count",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "conditional",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "RCP: own shift",
  },
  {
    key: "operations.shift-handover",
    section: "Folio and money",
    row: "Shift handover notes",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "conditional",
      ACCOUNTANT: "read",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "RCP: own shift",
  },

  // ── Guest personal data ──────────────────────────────────────────────────
  {
    key: "guest.read-record",
    section: "Guest personal data",
    row: "Read guest record, CCCD masked",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
  },
  {
    key: "guest.unmask-cccd",
    section: "Guest personal data",
    row: "Unmask CCCD number",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "conditional",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Audit-logged per call",
  },
  // No viewing row and no deletion row, mirroring §3: both would be permissions
  // over an object that does not exist, because the scan is read for its
  // particulars and never stored.
  {
    key: "guest.id-scan.upload",
    section: "Guest personal data",
    row: "Upload ID scan",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Own, for guest. Transcribe-and-discard — the image is never stored (FR-GST-02)",
  },

  // ── Reports and audit ────────────────────────────────────────────────────
  {
    key: "reporting.operational",
    section: "Reports and audit",
    row: "Operational reports (arrivals, in-house)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      HOUSEKEEPING: "conditional",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "HK: own board",
  },
  {
    key: "reporting.performance",
    section: "Reports and audit",
    row: "Occupancy / ADR / RevPAR",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "read", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "reporting.financial",
    section: "Reports and audit",
    row: "Revenue and financial reports",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ACCOUNTANT: "full", MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "reporting.excel-export",
    section: "Reports and audit",
    row: "Excel export",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "conditional",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "RCP: operational lists only",
  },
  {
    key: "audit.read",
    section: "Reports and audit",
    row: "Audit log viewer",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      ACCOUNTANT: "conditional",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "ACC: financial entries only",
  },

  // ── System ───────────────────────────────────────────────────────────────
  {
    key: "identity.staff-accounts",
    section: "System",
    row: "Staff accounts + role assignment",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ADMIN: "full" }),
  },
  {
    key: "system.config",
    section: "System",
    row: "System config (tax rates, retention N, business date, gateway credentials)",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "read", ADMIN: "full" }),
  },
  {
    key: "operations.night-audit-trigger",
    section: "System",
    row: "Trigger night audit manually",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ MANAGER: "full", ADMIN: "full" }),
  },
  {
    key: "system.job-queue",
    section: "System",
    row: "Job queue / dead-letter inspection",
    unauthenticated: false,
    guest: "denied",
    staff: staff({ ADMIN: "full" }),
  },
] as const satisfies readonly Capability[];

/** Every key a route may declare. Anything else is a compile error. */
export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

const BY_KEY: ReadonlyMap<string, Capability> = new Map(
  CAPABILITIES.map((capability) => [capability.key, capability]),
);

/** Looks a row up. Throws rather than returning undefined: a route naming a
 *  capability that does not exist is a wiring bug, and failing closed at boot
 *  beats failing open at request time. */
export function capability(key: CapabilityKey): Capability {
  const found = BY_KEY.get(key);

  if (!found) {
    throw new Error(`Unknown capability: ${key}`);
  }

  return found;
}

/** The grant a staff role holds over a capability. */
export function staffGrant(key: CapabilityKey, role: StaffRole): Grant {
  return capability(key).staff[role];
}

/** The grant the guest realm holds over a capability. */
export function guestGrant(key: CapabilityKey): Grant {
  return capability(key).guest;
}

// Re-exported so a consumer iterating the matrix does not need a second import
// to name the axes it is iterating over.
export { GRANTS, STAFF_ROLES };
export type { Grant, StaffRole };
