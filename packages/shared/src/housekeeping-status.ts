// What state a room is in, in one place because three layers spell it: a
// Postgres enum, the check-in guard that reads it, and the wire schema the
// housekeeping board renders. `FR-HK-01` is the authority for what the values
// mean; this file is the authority for what they are.

import { z } from "zod";

/**
 * Four conditions a room can be in — `FR-HK-01`.
 *
 * A tuple beside the schema for the reason `BOOKING_STATES` is one: Postgres
 * needs an enum type built from the identical values, and deriving both from
 * one array is what stops the database and the wire from drifting.
 *
 * These are orthogonal to occupancy, which is the whole point of the list. A
 * room is `DIRTY` whether or not it is sold tonight, and a booking's state says
 * nothing about whether anyone may walk into the room — `FR-HK-01` puts the two
 * on separate axes so a departure and a cleaning round can be recorded by
 * different people at different times.
 *
 * `INSPECTED` sits above `CLEAN` rather than beside it: it is the optional
 * supervisor pass, and `booking-state-machine.md` §4 admits a guest into either.
 * Making it a prerequisite would stop check-in at every property that does not
 * run the pass.
 *
 * `OUT_OF_ORDER` is a room state and nothing more. Withdrawing a room from sale
 * is `FR-INV-04`'s room closure, which moves `type_inventory.total_rooms` and
 * which the RBAC matrix §3 grants to a manager — housekeeping's own row grants
 * this status to a housekeeper. Two acts, two capabilities; `housekeeping.ts`
 * argues the storage side of the same separation.
 */
export const HOUSEKEEPING_STATUSES = [
  "CLEAN",
  "DIRTY",
  "INSPECTED",
  "OUT_OF_ORDER",
] as const;

export const housekeepingStatusSchema = z.enum(HOUSEKEEPING_STATUSES);

export type HousekeepingStatus = z.infer<typeof housekeepingStatusSchema>;
