// Room state and the board the floors are walked with — `FR-HK-01` and
// `FR-HK-02`, as routes.
//
// **Two write routes and not one taking four statuses.** The RBAC matrix spells
// readiness and out-of-order as two rows, so a caller holding
// `housekeeping.set-condition` must have no way to write the status the other
// row governs. One endpoint with the status in the body would put that boundary
// inside an enum, which is the shape `rbac-matrix.md` §2 refuses in the
// cancellation case for the same reason. So {@link setConditionInput} excludes
// `OUT_OF_ORDER` — the way `cancelInput` excludes the reason only the sweep may
// file — and taking a room out of order is its own route with its own reason.
// `housekeeping.service.ts` refuses it a second time at runtime, and that guard
// is not redundant: check-out reaches the service without passing through here.
//
// **The board carries what a housekeeper walks with and nothing else.**
// `screens.md` §Staff surfaces is explicit that housekeeping sees no money and
// no guest names, and the way to keep a field off a screen is to keep it out of
// the shape the screen is drawn from. `updatedBy` is a member of staff and not a
// guest — the board is read to find out who last touched 402 and when.
//
// **The board's day is the property's day.** `businessDate` is optional and
// resolved by the API when it is absent, which is the same shape
// `jobs.ts` gives a manual run and for the same reason: the 04:00 rollover is
// `business-date.service.ts`'s rule, and a client computing its own answer would
// render occupancy against a different day than the desk sees. The resolved date
// travels back on the response rather than being echoed as absent.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { housekeepingStatusSchema } from "../housekeeping-status.js";
import { roomTypeCodeSchema } from "../rate-calendar.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/** A room as the floor speaks it — the same bound `closeRoomInput` puts on one. */
const roomNumberSchema = z.string().trim().min(1).max(10);

/**
 * The three states a cleaning round moves a room between — `FR-HK-01`.
 *
 * `OUT_OF_ORDER` is excluded rather than validated away in the handler: it is
 * the one status this route's capability does not govern, and a schema that
 * admitted it would leave the refusal to be remembered somewhere else.
 */
export const roomReadinessSchema = housekeepingStatusSchema.exclude([
  "OUT_OF_ORDER",
]);

export const setConditionInput = z.object({
  roomNumber: roomNumberSchema,
  status: roomReadinessSchema,
});

/**
 * Taking a room out of order, or putting it back — `FR-HK-02`.
 *
 * A boolean and not two routes, because it is one fact about the room being set
 * either way and both directions are the same capability. The reason is
 * required by the service when the room is going out — `room_condition_note_
 * present_when_set` refuses a blank one in storage, and the desk asking "why is
 * 304 out?" is the question the column exists to answer — and it is optional
 * here because putting the room back needs none.
 *
 * Nothing on this route moves `type_inventory`. Withdrawing a room from sale is
 * `FR-INV-04`'s closure, a manager's capability and a commercial act;
 * `inventory.ts` owns those two routes.
 */
export const setOutOfOrderInput = z.object({
  roomNumber: roomNumberSchema,
  outOfOrder: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
});

/** A room's condition after a write, as the board will now show it. */
export const roomConditionSchema = z.object({
  roomNumber: z.string(),
  status: housekeepingStatusSchema,
  note: z.string().nullable(),
  /**
   * An instant and not a stay date. When a room was last touched is a moment —
   * two cleaning rounds on one day are two different answers — so it takes the
   * full timestamp the way a hold's expiry does.
   */
  updatedAt: z.iso.datetime(),
});

/**
 * One tile of the board.
 *
 * `roomType` is here because a housekeeper is sent to a room knowing what is in
 * it — the bedding a `PREMIER` is made up with is not the bedding a `SUPERIOR`
 * takes — and it is neither money nor a guest's name, which is the line
 * `screens.md` draws around this screen.
 *
 * `isReady` is `booking-state-machine.md` §4's room-ready guard as a column, so
 * the grid does not have to know that `INSPECTED` admits a guest too.
 * `isOccupied` is orthogonal to all of it: `FR-HK-01` puts cleaning and
 * occupancy on separate axes, and a room can be dirty and sold tonight.
 */
export const boardRoomSchema = z.object({
  roomNumber: z.string(),
  floor: z.number().int(),
  roomType: roomTypeCodeSchema,
  status: housekeepingStatusSchema,
  isReady: z.boolean(),
  isOccupied: z.boolean(),
  note: z.string().nullable(),
  /** Null for a room nobody has recorded a condition for yet. */
  updatedAt: z.iso.datetime().nullable(),
  /** The member of staff who last set it, by name. Null when checkout did. */
  updatedBy: z.string().nullable(),
});

export const housekeepingBoardQuery = z.object({
  businessDate: stayDateSchema.optional(),
});

export const housekeepingBoardSchema = z.object({
  /** The day the tiles were answered against, resolved. */
  businessDate: isoStayDateSchema,
  rooms: z.array(boardRoomSchema),
});

export const housekeeping = {
  setCondition: oc
    // PUT: the condition a room is in is a single fact, and setting `CLEAN`
    // twice leaves the room clean.
    .route({
      method: "PUT",
      path: "/housekeeping/rooms/{roomNumber}/condition",
    })
    .input(setConditionInput)
    .output(roomConditionSchema),

  setOutOfOrder: oc
    .route({
      method: "PUT",
      path: "/housekeeping/rooms/{roomNumber}/out-of-order",
    })
    .input(setOutOfOrderInput)
    .output(roomConditionSchema),

  board: oc
    .route({ method: "GET", path: "/housekeeping/board" })
    .input(housekeepingBoardQuery)
    .output(housekeepingBoardSchema),
};
