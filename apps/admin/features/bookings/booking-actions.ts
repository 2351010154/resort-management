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

/** Console affordances only. The API capability and transition guards remain authoritative. */
export function visibleBookingActions(
  role: StaffRole,
  state: BookingState,
): BookingAction[] {
  if (role === "ACCOUNTANT") return [];

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
