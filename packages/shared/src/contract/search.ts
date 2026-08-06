// The one search the front desk runs — `FR-BOOK-05`, as a route.
//
// **One route and one capability row.** `search.operational` is a single row
// covering rooms, guests and bookings, and the matrix narrows it by grant rather
// than by splitting it: `HOUSEKEEPING` holds it `⚠` with the note "HK: rooms
// only". Three routes with three rows would have needed three keys the matrix
// does not have, so the narrowing is the handler's — which is exactly what
// `rbac-matrix.md` §2 says a `⚠` grant leaves owing.
//
// **The answer is a union and not a flag.** A rooms-only result has no field a
// booking or a guest could travel in, which is `guest.ts`'s argument about the
// unmasked CCCD applied to a whole scope: a caller that must not see stays
// cannot be handed them by a handler that forgot to empty an array, because
// there is no array. `scope` says which of the two the caller got, so a screen
// can tell "nothing matched" from "you were not asked to see this".
//
// **A dimension answers only the set it is a fact about.** Room readiness is a
// fact about a room and says nothing about a stay; a booking reference is a fact
// about a stay and nothing about a room. So each set below lists the dimensions
// that narrow it, and a set that none of the given dimensions apply to is
// returned empty rather than as everything the property has — a search that
// answered "every booking" to `roomStatus=DIRTY` would be an export.
//
// **No money and no CCCD, on any path.** Neither has a field here to be carried
// in, for the reason above: `FR-GST-03` masks the number by default and
// `guest.unmask-cccd` is the one route that reveals it, so a search that could
// return it would be a second door onto the audited one. The number is not
// searchable either — a filter over it would confirm a number from outside the
// audit trail one guess at a time, which is the disclosure the masking exists to
// stop. What a stay costs is the folio's, and a lookup does not need it.

import { oc } from "@orpc/contract";
import { z } from "zod";
import { bookingStateSchema } from "../booking-state.js";
import { housekeepingStatusSchema } from "../housekeeping-status.js";
import { roomTypeCodeSchema } from "../rate-calendar.js";
import { isoStayDateSchema, stayDateSchema } from "../stay-date.js";
import { boardRoomSchema } from "./housekeeping.js";

/**
 * How many hits of one kind a search answers with.
 *
 * A cap and not a page. The desk searches to find one stay, one person or one
 * room, and a result that runs past this is a search that needs narrowing
 * rather than a second page — the property has forty rooms and a front-desk
 * screen shows a handful of rows. `M7` can add a cursor the day a report needs
 * one, and until then an unbounded query behind a text field is the shape that
 * reads the whole booking table because somebody typed a single letter.
 */
export const SEARCH_RESULT_LIMIT = 50;

/** A room number as the desk speaks it — the same bound every route puts on one. */
const roomNumberSchema = z.string().trim().min(1).max(10);

/**
 * The dimensions `FR-BOOK-05` lists, each as its own field.
 *
 * Named fields and not one free-text box, and the reason is the CCCD: a single
 * `q` matched against "whatever a guest column holds" is a filter that grows a
 * new searchable column every time the guest table does, and the number is one
 * of them. Naming each dimension makes what is searchable a decision somebody
 * made rather than a consequence of a schema.
 *
 * Every field is optional and at least one is required. A search with no
 * criteria is not a search, and the honest answer to it is a 400 naming the
 * problem rather than the whole property.
 *
 * The date range is both ends or neither. A range with one end is an open
 * interval nobody asked for, and "from the 10th" reads as a window whose other
 * end the caller forgot rather than as everything after it.
 */
export const operationalSearchQuery = z
  .object({
    /** Matched as a fragment: the desk types `20` looking for 201 through 210. */
    roomNumber: roomNumberSchema.optional(),
    roomType: roomTypeCodeSchema.optional(),
    roomStatus: housekeepingStatusSchema.optional(),
    from: stayDateSchema.optional(),
    to: stayDateSchema.optional(),
    guestName: z.string().trim().min(1).max(120).optional(),
    guestPhone: z.string().trim().min(1).max(30).optional(),
    state: bookingStateSchema.optional(),
    reference: z.string().trim().min(1).max(40).optional(),
  })
  .refine(
    (query) => Object.values(query).some((value) => value !== undefined),
    { message: "a search needs at least one criterion" },
  )
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: "a date range needs both ends",
    path: ["to"],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from.compare(query.to) < 0,
    { message: "to must fall after from", path: ["to"] },
  );

/**
 * A stay, as a search answers it.
 *
 * `roomNumber` is the room the booking holds now, null while it holds none —
 * a stay is sold as a type and given a room later, and a search run the morning
 * of arrival is run before that has happened.
 *
 * `guestNames` are the people registered on it, which is empty until check-in
 * writes the registration records. It is here because "who is in 402" is the
 * question the desk asks the search, and it is not on the room hit below: a room
 * is what `HOUSEKEEPING` may see, and `screens.md` §Staff surfaces gives that
 * screen no guest names.
 */
export const bookingHitSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  state: bookingStateSchema,
  roomType: roomTypeCodeSchema,
  checkIn: isoStayDateSchema,
  checkOut: isoStayDateSchema,
  roomNumber: z.string().nullable(),
  guestNames: z.array(z.string()),
});

/**
 * A person, as a search answers them — enough to pick the right one and to
 * telephone them.
 *
 * Deliberately less than `guestRecordSchema`. A search is run against a name
 * somebody half remembers and returns a list of candidates, so it discloses what
 * distinguishes them and leaves the rest to `guest.read-record`, which is a
 * route asked about one named person. `cccdMasked` is the masking `FR-GST-03`
 * puts on every unaudited path, computed by the same function the record route
 * uses; the number behind it is neither returned nor searchable.
 */
export const guestHitSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  cccdMasked: z.string().nullable(),
});

/**
 * What the search answers with, in the two shapes the matrix allows.
 *
 * The rooms are `boardRoomSchema` — the housekeeping board's own tile, not a
 * second room vocabulary. A room's readiness, its type and whether somebody is
 * in it are the same facts whether they are reached from the board or from a
 * search, and two shapes for them is how the two come to disagree about what
 * `isReady` means.
 */
export const searchResultsSchema = z.discriminatedUnion("scope", [
  z.object({
    /** The narrowed answer — a `⚠` grant on this row, which is `HOUSEKEEPING`. */
    scope: z.literal("rooms"),
    rooms: z.array(boardRoomSchema),
  }),
  z.object({
    scope: z.literal("everything"),
    rooms: z.array(boardRoomSchema),
    bookings: z.array(bookingHitSchema),
    guests: z.array(guestHitSchema),
  }),
]);

export const search = {
  operational: oc
    // GET, because a search reads and nothing about running one twice differs
    // from running it once. The criteria travel in the query string, which is
    // what makes a result a link the desk can send to a colleague.
    .route({ method: "GET", path: "/search" })
    .input(operationalSearchQuery)
    .output(searchResultsSchema),
};
