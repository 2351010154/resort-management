"use client";

import { EmptyState, PageHeader } from "@/components/console";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLongDate } from "@/lib/business-date";
import { cn } from "@/lib/utils";

import {
  type BoardRoom,
  useHousekeepingBoard,
  useSetRoomCondition,
} from "./board-queries";
import {
  type BoardFloor,
  boardReading,
  boardTile,
  type RoomReadiness,
} from "./housekeeping-board";

/* The floors, as a grid somebody walks with a phone in one hand.
 *
 * `docs/screens.md` §"Staff surfaces" makes this screen the console's one
 * deliberate exception to keyboard-first, and states why: housekeepers walk the
 * corridors, so the board is a touch-first grid of rooms by floor with large
 * targets for advancing a room's state. So there is no roving group here, no
 * chord and no sequence — a tile is a real `<button>`, which a thumb presses and
 * a keyboard still reaches through Tab because that is what a button is. Nothing
 * on this screen is *only* reachable by pointer; what it is not is optimised for
 * a keyboard at the cost of a phone.
 *
 * `g h` is not bound here. `features/shell/nav-inventory.ts` carries this family
 * and `nav-shortcuts.tsx` binds the whole inventory's sequence from the shell.
 *
 * ## What closes the loop
 *
 * `features/arrivals/arrival-queue.ts` refuses a check-in into a room that is
 * not `CLEAN` or `INSPECTED` and tells the desk to ask housekeeping to release
 * it. This grid is where that release happens: a room dirtied by last night's
 * check-out is two taps from admitting the next guest, and until this screen
 * existed the console had no way to say it at all.
 *
 * ## No guest and no money
 *
 * Not a matter of care while writing markup. Every tile is drawn from
 * {@link boardTile}'s named fields and this file reads nothing else off a room,
 * so the rule is a projection with a spec behind it rather than a habit — see
 * `housekeeping-board.spec.ts`.
 *
 * **No animation.** `NFR-04` forbids entrance animation on operational
 * surfaces, and a tile that fades in is a room somebody is waiting to see.
 */

export function HousekeepingScreen() {
  const board = useHousekeepingBoard();
  const condition = useSetRoomCondition();
  const reading = boardReading(board.isError, board.data);

  function advance(roomNumber: string, status: RoomReadiness) {
    // Fire and forget. The tile has already repainted — `board-queries.ts`
    // writes the whole tile optimistically — and a failure is put in front of
    // the operator centrally by `lib/query-client.ts` while the cache is put
    // back. There is nothing for this screen to do with the promise.
    condition.mutate({ roomNumber, status });
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Housekeeping"
        description={
          reading.status === "ready"
            ? `Room readiness for ${formatLongDate(reading.businessDate)}. Tap to advance.`
            : "Reading room readiness."
        }
      />

      {reading.status === "pending" ? (
        <div
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          aria-busy
        >
          {[
            "101",
            "102",
            "103",
            "104",
            "201",
            "202",
            "203",
            "204",
            "301",
            "302",
          ].map((roomNumber) => (
            <Skeleton key={roomNumber} className="h-36" />
          ))}
        </div>
      ) : null}

      {reading.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p
          className="mt-6 border-danger border-l-2 pl-3 text-sm text-danger"
          role="alert"
        >
          Housekeeping could not be loaded. Room readiness is unavailable.
        </p>
      ) : null}

      {reading.status === "ready" && reading.floors.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No rooms on the board"
          description="Room readiness will appear here when rooms are available."
        />
      ) : null}

      {reading.status === "ready"
        ? reading.floors.map((floor) => (
            <FloorSection key={floor.floor} floor={floor} onAdvance={advance} />
          ))
        : null}
    </div>
  );
}

/** One floor and its doors. */
function FloorSection({
  floor,
  onAdvance,
}: {
  floor: BoardFloor;
  onAdvance(roomNumber: string, status: RoomReadiness): void;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {floorName(floor.floor)}
      </h2>

      {/* Two rooms across on a phone held in one hand, more as the screen
          allows it. The gap is deliberate rather than decorative: adjacent
          large targets with no space between them are how a thumb marks the
          wrong room clean. */}
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {floor.rooms.map((room) => (
          <li key={room.roomNumber}>
            <RoomTile room={room} onAdvance={onAdvance} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How a floor is named, including the two a hotel counts differently. */
function floorName(floor: number): string {
  if (floor === 0) {
    return "Ground floor";
  }

  return floor < 0 ? `Basement ${Math.abs(floor)}` : `Floor ${floor}`;
}

/** One room, and the tap that moves it on. */
function RoomTile({
  room,
  onAdvance,
}: {
  room: BoardRoom;
  onAdvance(roomNumber: string, status: RoomReadiness): void;
}) {
  const tile = boardTile(room);
  // Held as its own binding rather than read off the tile in the handler: a
  // narrowing on a property does not survive into a callback, and the
  // alternative is a non-null assertion standing where the compiler was already
  // able to prove it.
  const next = tile.next;

  const face = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="grid h-9 min-w-14 place-items-center rounded-md border border-border bg-card px-2 text-lg font-semibold tabular-nums shadow-xs">
          {tile.roomNumber}
        </span>
        <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {tile.roomTypeLabel}
        </span>
      </span>

      <span className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-semibold">{tile.conditionLabel}</span>
        <span className="text-muted-foreground">{tile.occupancyLabel}</span>
      </span>

      <span className="mt-auto pt-3 text-sm text-muted-foreground">
        {tile.touchedLabel}
      </span>
    </>
  );

  // A room nobody may write from here. It is still on the grid — a floor with a
  // hole in it is a room nobody is accounted for — and it carries the reason it
  // is shut, which is the question the desk asks about it.
  if (next === null) {
    return (
      <div className="flex min-h-36 flex-col rounded-lg border border-danger/30 bg-danger-soft p-4 text-left text-danger shadow-card">
        {face}
        <span className="mt-1 text-sm">
          {tile.noteLabel ?? "No reason recorded"}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      // Read out as one statement, because the tile's own text is four
      // fragments in reading order and a housekeeper using a screen reader on a
      // phone should hear the room, its state and the act in one pass.
      aria-label={`Room ${tile.roomNumber}, ${tile.roomTypeLabel}, ${tile.conditionLabel}, ${tile.occupancyLabel}. ${tile.advanceLabel}.`}
      onClick={() => {
        onAdvance(room.roomNumber, next);
      }}
      className={cn(
        // `min-h-28` is a target a thumb hits without aiming, and the whole tile
        // is the target rather than a control inside it.
        "flex min-h-36 w-full flex-col rounded-lg p-4 text-left shadow-card transition-[box-shadow,transform] duration-150 ease-ui hover:-translate-y-0.5 hover:shadow-raised active:translate-y-px",
        // A room that cannot take a guest is shaded rather than coloured. The
        // grid is read at arm's length and the thing being looked for is the
        // work left, not a status word.
        tile.isReady ? "bg-card" : "bg-warning-soft",
      )}
    >
      {face}
      <span className="mt-1 text-sm font-semibold">{tile.advanceLabel}</span>
    </button>
  );
}
