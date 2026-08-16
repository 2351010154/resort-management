/* What the console's navigation offers, and to whom.
 *
 * The inventory is data rather than markup, and it is pure, because three
 * different surfaces read the same list and must not disagree: the rail draws
 * it, the palette's `Go to` group registers it, and the `g` sequence binds it.
 * A rail that listed a family the palette could not reach — or a chord that
 * went somewhere no role may look — would be three opinions about one map.
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

/**
 * The key that opens a navigation sequence. `g` then a letter — "go to".
 *
 * A prefix rather than a modifier because every modified chord worth having is
 * already spoken for by the browser or the operating system, and because two
 * unmodified letters are the fastest thing a touch typist can do. It is bound
 * from the shell and only while no sequence is in progress, so it costs a
 * screen the bare `g` and nothing else.
 */
export const NAV_PREFIX = "g";

/** How long a sequence waits for its second key before it gives up. Long
 *  enough for a deliberate two-finger press, short enough that a `g` typed by
 *  accident is not still armed when the operator's next real key arrives. */
export const NAV_SEQUENCE_TIMEOUT_MS = 1_500;

export interface NavItem {
  /** The family, lowercase. Also the value the roving list tracks the entry
   *  by, and the second half of the command id. */
  id: string;
  /** What the operator reads in the rail and in the palette. */
  label: string;
  /** Where the family lives once it is built. */
  href: string;
  /**
   * The second key of the sequence — `g d` is the dashboard.
   *
   * Written out per entry rather than derived from the label, because a derived
   * key moves when a family is added above it and the whole value of a
   * navigation chord is that it does not move. Every one of them is a letter in
   * its own family's name, and `nav-inventory.spec.ts` holds the set to that
   * rule and to being collision-free.
   */
  key: string;
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
    label: "Dashboard",
    href: "/dashboard",
    key: "d",
    // The launchpad's counts are arrivals, departures, rooms not ready and
    // unsettled folios — the desk's day. The accountant and the housekeeper
    // each land on the one screen their own day happens on instead.
    roles: DESK,
    keywords: ["home", "today", "tổng quan"],
  },
  {
    id: "arrivals",
    label: "Arrivals",
    href: "/arrivals",
    key: "a",
    roles: DESK,
    keywords: ["check in", "khách đến", "nhận phòng"],
  },
  {
    id: "departures",
    label: "Departures",
    href: "/departures",
    key: "e",
    roles: DESK,
    keywords: ["check out", "trả phòng", "khách đi"],
  },
  {
    id: "bookings",
    label: "Bookings",
    href: "/bookings",
    key: "b",
    // The accountant reads bookings and does not act on them — matrix
    // §"Bookings and front desk", *Read any booking*.
    roles: LEDGER,
    keywords: ["reservations", "đặt phòng", "walk-in"],
  },
  {
    id: "rooms",
    label: "Rooms",
    href: "/rooms",
    key: "r",
    // The receptionist is here for a room's state — marking one out of order —
    // while room and room-type CRUD and the closures that reduce sellable
    // inventory are the manager's. Both live on the room's detail, so the door
    // is shared and the controls behind it are not.
    roles: DESK,
    keywords: ["room types", "out of order", "phòng"],
  },
  {
    id: "housekeeping",
    label: "Housekeeping",
    href: "/housekeeping",
    key: "h",
    roles: ["HOUSEKEEPING", ...DESK],
    keywords: ["board", "clean", "dọn phòng", "buồng phòng"],
  },
  {
    id: "guests",
    label: "Guests",
    href: "/guests",
    key: "g",
    roles: LEDGER,
    keywords: ["profiles", "cccd", "khách"],
  },
  {
    id: "rates",
    label: "Rates",
    href: "/rates",
    key: "t",
    // The desk and the accountant read the rate calendar; only management
    // edits it. One door, and the grid decides what is editable in it.
    roles: LEDGER,
    keywords: ["prices", "restrictions", "giá phòng"],
  },
  {
    id: "folios",
    label: "Folios",
    href: "/folios",
    key: "f",
    roles: LEDGER,
    keywords: ["charges", "ledger", "hóa đơn tạm"],
  },
  {
    id: "payments",
    label: "Payments",
    href: "/payments",
    key: "p",
    roles: LEDGER,
    keywords: ["refunds", "reconciliation", "thanh toán"],
  },
  {
    id: "shifts",
    label: "Shifts",
    href: "/shifts",
    key: "s",
    roles: LEDGER,
    keywords: ["cash drawer", "handover", "ca làm việc"],
  },
  {
    id: "finance",
    label: "Finance",
    href: "/finance",
    key: "i",
    roles: ["ACCOUNTANT", ...MANAGEMENT],
    keywords: ["income", "expense", "thu chi"],
  },
  {
    id: "audit",
    label: "Audit",
    href: "/audit",
    key: "u",
    // The accountant's read is limited to financial entries; the screen scopes
    // that, and the matrix's ⚠ is about what is in the list rather than about
    // reaching it.
    roles: ["ACCOUNTANT", ...MANAGEMENT],
    keywords: ["history", "who changed", "nhật ký"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    key: "n",
    // Staff accounts are the administrator's alone and system configuration is
    // the manager's to read. Both are behind this one door and neither is
    // anybody else's.
    roles: MANAGEMENT,
    keywords: ["staff", "tax", "business date", "cài đặt"],
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    key: "o",
    roles: LEDGER,
    keywords: ["revenue", "occupancy", "adr", "revpar", "báo cáo"],
  },
];

/** What this role is offered, in the inventory's order. */
export function navItemsFor(role: StaffRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** The written chord for an entry, in the spelling `useHotkeys` takes and
 *  `formatShortcut` renders. Derived rather than authored so the hint beside a
 *  rail entry cannot advertise a key the sequence does not answer to. */
export function navShortcut(item: NavItem): string {
  return `${NAV_PREFIX} ${item.key}`;
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
