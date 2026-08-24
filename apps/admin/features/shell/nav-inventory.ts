/* What the console's navigation offers, and to whom.
 *
 * The inventory is data rather than markup, and it is pure, because two
 * different surfaces read the same list and must not disagree: the rail draws
 * it and the palette's `Go to` group registers it. A rail that listed a family
 * the palette could not reach — or an entry that went somewhere no role may
 * look — would be two opinions about one map.
 *
 * The families are the ones named by `docs/screens.md` §"Staff surfaces" and
 * `docs/architecture/repository-structure.md` §`apps/admin`, in that document's
 * order. **None of the routes exist yet.** They are the paths those screens
 * will occupy, and naming them here is the same decision `lib/auth/landing-route.ts`
 * already made for the landings: until a family lands its route is a 404, which
 * is the honest state of a console with a working session and no screens.
 * A placeholder screen behind each entry would be a second opinion about an
 * inventory that has an owner.
 */

import type { StaffRole } from "@mariva/shared";

export interface NavItem {
  /** The family, lowercase. Also the value the roving list tracks the entry
   *  by, and the second half of the command id. */
  id: string;
  /** The operational chapter used to group the rail without duplicating its map. */
  group: NavGroupId;
  /** What the operator reads in the rail and in the palette. */
  label: string;
  /** Where the family lives once it is built. */
  href: string;
  /**
   * The roles offered this family — `docs/architecture/rbac-matrix.md` §3.
   *
   * Read as "this role has a capability the family is for", not as a wall: the
   * API's guard is the wall. What this decides is whether an operator is
   * *offered* a door, and offering one that answers 403 is the console telling
   * a housekeeper their job includes a screen it does not.
   */
  roles: readonly StaffRole[];
  /** Extra terms the palette's filter should match. The console is worked in
   *  two languages and by people who name a screen after the task. */
  keywords?: readonly string[];
}

export type NavGroupId =
  | "today"
  | "reservations"
  | "property"
  | "money"
  | "management";

export interface NavGroup {
  id: NavGroupId;
  label: string;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "today", label: "Today" },
  { id: "reservations", label: "Reservations" },
  { id: "property", label: "Property" },
  { id: "money", label: "Money" },
  { id: "management", label: "Management" },
];

// The role sets, named once, because the matrix repeats itself and a typo in a
// literal list is the kind of thing that quietly hands somebody a screen.
//
// `DESK` is the three roles that work the front desk — the same three that
// share the dashboard landing. `LEDGER` adds the accountant, who reads money
// and the records money is attached to. `MANAGEMENT` is the two roles the
// matrix gives the commercial and configuration rows to.
const DESK = ["RECEPTIONIST", "MANAGER", "ADMIN"] as const;
const LEDGER = ["RECEPTIONIST", "ACCOUNTANT", "MANAGER", "ADMIN"] as const;
const MANAGEMENT = ["MANAGER", "ADMIN"] as const;

/**
 * Every family the console has, in the order `docs/screens.md` indexes them.
 *
 * Housekeeping is the one role that sees a single entry, and that is the
 * matrix read literally rather than an omission: it grants `HOUSEKEEPING` the
 * board, room state and its own operational list, and nothing else. The board
 * is where all three of those happen, and screens.md says why — housekeepers
 * see no money and no guest names.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    group: "today",
    label: "Dashboard",
    href: "/dashboard",
    // The launchpad's counts are arrivals, departures, rooms not ready and
    // unsettled folios — the desk's day. The accountant and the housekeeper
    // each land on the one screen their own day happens on instead.
    roles: DESK,
    keywords: ["home", "today", "tổng quan"],
  },
  {
    id: "arrivals",
    group: "today",
    label: "Arrivals",
    href: "/arrivals",
    roles: DESK,
    keywords: ["check in", "khách đến", "nhận phòng"],
  },
  {
    id: "departures",
    group: "today",
    label: "Departures",
    href: "/departures",
    roles: DESK,
    keywords: ["check out", "trả phòng", "khách đi"],
  },
  {
    id: "bookings",
    group: "reservations",
    label: "Bookings",
    href: "/bookings",
    // The accountant reads bookings and does not act on them — matrix
    // §"Bookings and front desk", *Read any booking*.
    roles: LEDGER,
    keywords: ["reservations", "đặt phòng", "walk-in"],
  },
  {
    id: "guests",
    group: "reservations",
    label: "Guests",
    href: "/guests",
    roles: LEDGER,
    keywords: ["profiles", "cccd", "khách"],
  },
  {
    id: "rooms",
    group: "property",
    label: "Rooms",
    href: "/rooms",
    // The receptionist is here for a room's state — marking one out of order —
    // while room and room-type CRUD and the closures that reduce sellable
    // inventory are the manager's. Both live on the room's detail, so the door
    // is shared and the controls behind it are not.
    roles: DESK,
    keywords: ["room types", "out of order", "phòng"],
  },
  {
    id: "housekeeping",
    group: "property",
    label: "Housekeeping",
    href: "/housekeeping",
    roles: ["HOUSEKEEPING", ...DESK],
    keywords: ["board", "clean", "dọn phòng", "buồng phòng"],
  },
  {
    id: "rates",
    group: "property",
    label: "Rates",
    href: "/rates",
    // The desk and the accountant read the rate calendar; only management
    // edits it. One door, and the grid decides what is editable in it.
    roles: LEDGER,
    keywords: ["prices", "restrictions", "giá phòng"],
  },
  {
    id: "folios",
    group: "money",
    label: "Folios",
    href: "/folios",
    roles: LEDGER,
    keywords: ["charges", "ledger", "hóa đơn tạm"],
  },
  {
    id: "payments",
    group: "money",
    label: "Payments",
    href: "/payments",
    roles: LEDGER,
    keywords: ["refunds", "reconciliation", "thanh toán"],
  },
  {
    id: "shifts",
    group: "money",
    label: "Shifts",
    href: "/shifts",
    roles: LEDGER,
    keywords: ["cash drawer", "handover", "ca làm việc"],
  },
  {
    id: "finance",
    group: "money",
    label: "Finance",
    href: "/finance",
    roles: ["ACCOUNTANT", ...MANAGEMENT],
    keywords: ["income", "expense", "thu chi"],
  },
  {
    id: "reports",
    group: "management",
    label: "Reports",
    href: "/reports",
    roles: LEDGER,
    keywords: ["revenue", "occupancy", "adr", "revpar", "báo cáo"],
  },
  {
    id: "audit",
    group: "management",
    label: "Audit",
    href: "/audit",
    // The accountant's read is limited to financial entries; the screen scopes
    // that, and the matrix's ⚠ is about what is in the list rather than about
    // reaching it.
    roles: ["ACCOUNTANT", ...MANAGEMENT],
    keywords: ["history", "who changed", "nhật ký"],
  },
  {
    id: "settings",
    group: "management",
    label: "Settings",
    href: "/settings",
    // Staff accounts are the administrator's alone and system configuration is
    // the manager's to read. Both are behind this one door and neither is
    // anybody else's.
    roles: MANAGEMENT,
    keywords: ["staff", "tax", "business date", "cài đặt"],
  },
];

/** What this role is offered, in the inventory's order. */
export function navItemsFor(role: StaffRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** The palette id an entry registers under. Namespaced like every other
 *  command, so `nav.payments` is reachable by typing either half. */
export function navCommandId(item: NavItem): string {
  return `nav.${item.id}`;
}

/**
 * Whether an entry is the one the operator is on.
 *
 * A prefix match rather than equality, because a family owns its subtree: a
 * receptionist inside `/bookings/BK-1042` is still in Bookings, and a rail that
 * dropped its mark the moment they opened a record would be telling them they
 * are nowhere. The boundary is the slash — `/rooms` must not light up for
 * `/rooms-archive`, which is a different family with a similar name.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
