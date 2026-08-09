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
  /** Reachable without any session at all. Exactly one row is (§3, row 1). */
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
    key: "booking.create-own",
    section: "Public and guest realm",
    row: "Create own booking",
    unauthenticated: false,
    guest: "full",
    staff: staff({ RECEPTIONIST: "full", MANAGER: "full", ADMIN: "full" }),
    note: "Staff create on behalf",
  },
  {
    key: "booking.read-own",
    section: "Public and guest realm",
    row: "Read own booking / stay history",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own records only",
  },
  {
    key: "booking.cancel-own",
    section: "Public and guest realm",
    row: "Cancel own booking",
    unauthenticated: false,
    guest: "conditional",
    staff: staff({}),
    note: "Own, penalty per policy",
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
  // The guest realm is denied, and that is this milestone's boundary rather
  // than a judgement about guests paying online. A guest cannot show that a
  // booking is theirs yet — `schema/guest.ts` puts the join between a guest
  // account and a stay at M7 — so a guest-realm grant would let any signed-in
  // caller open a payment page against any stay whose id they had.
  {
    key: "payment.open-attempt",
    section: "Folio and money",
    row: "Open a gateway payment attempt",
    unauthenticated: false,
    guest: "denied",
    staff: staff({
      RECEPTIONIST: "full",
      ACCOUNTANT: "full",
      MANAGER: "full",
      ADMIN: "full",
    }),
    note: "Staff open it; the guest funnel is M7",
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
