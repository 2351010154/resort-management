// What state a room is in, as against who is staying in it.
//
// One table, and the argument for it being a table rather than a column on
// `room` is the three fields beside the status. A condition is something a named
// person put the room into at a known time — the housekeeping board is read to
// find out who last touched 402 and when — and `room` is the property's
// structure, owned by `modules/inventory`, which does not change when somebody
// finishes a cleaning round.
//
// The separation that matters most here is the one `FR-HK-02` names.
// `OUT_OF_ORDER` is a room state: it says nobody may walk in. It does *not*
// reduce what the property may sell, because sellable inventory is counted per
// room *type* per date in `type_inventory.total_rooms`, and moving that figure
// is `FR-INV-04`'s room closure — a commercial act the RBAC matrix §3 grants to
// a manager, against a cleaning act it grants to a housekeeper. Conflating them
// is the classic version of this bug: a housekeeper marks a room out of order,
// the type quietly loses a room from sale for every date in the calendar, and
// the property finds out by not being bookable. Nothing in this file writes to
// `type_inventory`, and `test/housekeeping-storage.e2e-spec.ts` asserts that as
// a fact about the tables rather than as a promise about the service.
//
// What is deliberately *not* here:
//
// - **A history of every status change.** The board answers "what state is this
//   room in now", and `FR-HK-01` asks for nothing else. An append-only log is a
//   different table with a different read pattern, and one written before
//   anything reads it is forty rows a day nobody queries.
// - **Cleaning assignments and schedules.** Who is rostered to clean which
//   floor is not in the requirements at any milestone.
// - **A link to the booking that dirtied the room.** Checkout sets `DIRTY`
//   (`booking-state-machine.md` §3), but the room stays dirty on its own
//   account afterwards — a key to the departed stay would go stale the moment
//   the next guest arrives and would invite the status being read through it.

import { HOUSEKEEPING_STATUSES } from "@mariva/shared";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { staffUser } from "./identity.js";
import { room } from "./inventory.js";

/**
 * The four conditions as a database type, from the same tuple the wire schema is
 * built from — the pattern `booking_state` and `room_type_code` set.
 */
export const housekeepingStatusEnum = pgEnum(
  "housekeeping_status",
  HOUSEKEEPING_STATUSES,
);

/**
 * The state one room is in, and who put it there.
 *
 * Exactly one row per room, enforced below rather than left to the service. Two
 * rows for room 402 would each be a complete-looking answer to "may a guest be
 * checked into this room", and the check-in guard would admit or refuse
 * depending on which one it read first.
 *
 * The default is `CLEAN`, which is the honest state of a room the property has
 * just built or just added to the system: nobody has stayed in it. Everything
 * afterwards is written by somebody — or by the checkout that hands the room
 * back to housekeeping.
 */
export const roomCondition = pgTable(
  "room_condition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    status: housekeepingStatusEnum("status").notNull().default("CLEAN"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // Nullable, and the null is a real answer rather than a missing one: the
    // checkout transition sets `DIRTY` with no member of staff deciding to
    // (`booking-state-machine.md` §3), and the housekeeping board should be able
    // to show that as the system's doing instead of attributing it to whoever
    // happened to press the checkout button.
    updatedBy: uuid("updated_by").references(() => staffUser.id),
    // Why a room is out of order — the leaking bathroom, the broken lock. Left
    // optional because the other three statuses have nothing to say, and a
    // mandatory field on all four would be answered with "clean".
    note: text("note"),
  },
  (table) => [
    // One condition per room. Unique rather than the primary key because every
    // table here carries a surrogate `id` — `type_inventory` states its own
    // one-row-per-pair rule the same way.
    uniqueIndex("room_condition_room_id_key").on(table.roomId),
    // The board's other question: every room that is not ready. Forty rows scan
    // fast enough that this earns its place only because the same index answers
    // the `OUT_OF_ORDER` list `FR-HK-02` puts in front of a manager.
    index("room_condition_status_idx").on(table.status),
    // An empty note is a reason that was demanded and not given. The distinction
    // that has to survive is between a room out of order for a stated reason and
    // one out of order for none — `guest.cccd_number` is kept honest by the same
    // check for the same reason.
    check(
      "room_condition_note_present_when_set",
      sql`${table.note} is null or length(trim(${table.note})) > 0`,
    ),
  ],
);

export type RoomConditionRow = typeof roomCondition.$inferSelect;
