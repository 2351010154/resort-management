/* The board's hooks and its decisions, in one import site.
 *
 * `HousekeepingScreen` is deliberately absent, which is the one place this
 * feature departs from the other barrels. `features/arrivals/arrivals-queries.ts`
 * imports `useHousekeepingBoard` from here — the board answers the property's
 * day and the assignable rooms for the check-in queue — and a barrel is resolved
 * as a whole (`components/ui/index.ts` makes the same argument about the
 * primitives). Exporting the grid here would put a screen no receptionist is
 * looking at into the arrivals bundle. The route imports it by its own path
 * instead, and that costs the route one longer import.
 */

export {
  type BoardQuery,
  type BoardRoom,
  type HousekeepingBoard,
  type SetConditionInput,
  useHousekeepingBoard,
  useSetRoomCondition,
  withRoomCondition,
} from "./board-queries";
export {
  type BoardFloor,
  type BoardReading,
  type BoardTile,
  boardReading,
  boardTile,
  CONDITION_LABELS,
  floorsOf,
  nextCondition,
  type RoomReadiness,
} from "./housekeeping-board";
