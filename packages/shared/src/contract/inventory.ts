// Withdrawing a room from sale — `FR-INV-04`.
//
// A closure is a commercial act and not a cleaning one, which is the whole
// reason it has its own capability row (`inventory.close-room`, MANAGER and
// ADMIN) rather than riding on housekeeping's. Marking a room dirty says who
// may enter it today; closing it says the property has one fewer room to sell
// for a range of nights, and only the second changes what a guest can buy.
//
// Two routes and no update. A closure that needs different dates is reopened
// and taken again, because editing one in place would have to unwind the
// nights it already withdrew and re-withdraw a different set — the same work,
// with a partial failure in the middle of it.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";

/** A room held out of sale, as the desk sees it. */
export const roomClosureSchema = z.object({
  id: z.uuid(),
  roomNumber: z.string(),
  // ISO text, not the codec: a response is validated by decoding, and the
  // decoded `CalendarDate` is what would then be serialised. `stay-date.ts`
  // makes the argument; the controller performs the conversion.
  checkIn: isoStayDateSchema,
  checkOut: isoStayDateSchema,
  reason: z.string(),
  /** Nights withdrawn — the count of `type_inventory` rows this decremented. */
  nightsWithdrawn: z.number().int().min(1),
});

export const closeRoomInput = z
  .object({
    roomNumber: z.string().trim().min(1).max(10),
    checkIn: stayDateSchema,
    checkOut: stayDateSchema,
    // Required, and with a floor: a closure with no reason is indistinguishable
    // from a booking with a lost reference, and the desk asking "why is 304
    // out?" is the question this column exists to answer.
    reason: z.string().trim().min(3).max(500),
  })
  .refine((input) => input.checkIn.compare(input.checkOut) < 0, {
    message: "checkOut must fall after checkIn",
    path: ["checkOut"],
  });

/** Optional half-open overlap window for reading scheduled closures. */
export const roomClosureQuery = z
  .object({
    roomNumber: z.string().trim().min(1).max(10).optional(),
    checkIn: stayDateSchema.optional(),
    checkOut: stayDateSchema.optional(),
  })
  .refine(
    ({ checkIn, checkOut }) =>
      checkIn === undefined ||
      checkOut === undefined ||
      checkIn.compare(checkOut) < 0,
    { message: "checkOut must fall after checkIn", path: ["checkOut"] },
  );

export const inventory = {
  listRoomClosures: oc
    .route({ method: "GET", path: "/inventory/room-closures" })
    .input(roomClosureQuery)
    .output(z.array(roomClosureSchema)),

  closeRoom: oc
    // 201, because the response carries the id of something that now exists and
    // that the caller has to keep in order to lift it again.
    .route({
      method: "POST",
      path: "/inventory/room-closures",
      successStatus: 201,
    })
    .input(closeRoomInput)
    .output(roomClosureSchema),

  reopenRoom: oc
    .route({ method: "DELETE", path: "/inventory/room-closures/{id}" })
    .input(z.object({ id: z.uuid() }))
    .output(
      z.object({ id: z.uuid(), nightsRestored: z.number().int().min(1) }),
    ),
};
