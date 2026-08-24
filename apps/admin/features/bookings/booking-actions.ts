import type { BookingState, StaffRole } from "@mariva/shared";

export const BOOKING_ACTIONS = [
  "confirm",
  "cancel",
  "cancelWithWaiver",
  "markNoShow",
  "reinstate",
  "moveRoom",
  "changeRoomType",
  "extendStay",
  "shortenStay",
  "resendAccountLink",
] as const;

export type BookingAction = (typeof BOOKING_ACTIONS)[number];

/**
 * Console affordances only. The API capability and transition guards remain
 * authoritative.
 *
 * An allow-list rather than a list of the roles held back, because the roles
 * this screen is *for* are the short half and a role added to the matrix later
 * must arrive with nothing rather than with a receptionist's verbs. The
 * accountant reads bookings and does not act on them — matrix §"Bookings and
 * front desk", *Read any booking* — and housekeeping is not offered this
 * family at all. Both reach the screen anyway by typing the path, and offering
 * either an act the API answers 403 to is the console telling somebody their
 * job includes something it does not.
 */
export function visibleBookingActions(
  role: StaffRole,
  state: BookingState,
): BookingAction[] {
  if (role !== "RECEPTIONIST" && role !== "MANAGER" && role !== "ADMIN") {
    return [];
  }

  const manager = role === "MANAGER" || role === "ADMIN";
  const actions: BookingAction[] = [];

  if (state === "HELD") actions.push("confirm");
  if (state === "HELD" || state === "CONFIRMED") {
    actions.push("cancel");
    if (manager) actions.push("cancelWithWaiver");
  }
  if (state === "CONFIRMED" && manager) actions.push("markNoShow");
  if (state === "NO_SHOW" && manager) actions.push("reinstate");
  if (state === "CHECKED_IN") actions.push("moveRoom");
  if (state === "CONFIRMED" || state === "CHECKED_IN") {
    actions.push("changeRoomType", "extendStay");
  }
  if (state === "CHECKED_IN") actions.push("shortenStay");
  if (state !== "CANCELLED") actions.push("resendAccountLink");

  return actions;
}
