"use client";

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
    <div className="p-rhythm-3">
      <header>
        <p className="text-muted-foreground text-xs tracking-caps uppercase">
          Housekeeping
        </p>
        <h1 className="font-display text-display-sm mt-2">Room board</h1>
        <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
          {reading.status === "ready"
            ? `Every room as it stands on ${formatLongDate(reading.businessDate)}. Press a room to record what it is now.`
            : "Reading the property's rooms."}
        </p>
      </header>

      {reading.status === "pending" ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm" aria-busy>
          Reading the board.
        </p>
      ) : null}

      {reading.status === "failed" ? (
        // The console's error device is a rule on the leading edge rather than
        // a colour: --color-destructive and --color-primary are the same umber.
        <p className="border-destructive text-destructive mt-rhythm-2 border-l-2 pl-3 text-sm">
          The board could not be loaded. Nothing here is a statement about which
          rooms are ready.
        </p>
      ) : null}

      {reading.status === "ready" && reading.floors.length === 0 ? (
        <p className="text-muted-foreground mt-rhythm-2 text-sm">
          No rooms are on the board.
        </p>
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
    <section className="mt-rhythm-2">
      <h2 className="text-muted-foreground text-xs tracking-caps uppercase">
        {floorName(floor.floor)}
      </h2>

      {/* Two rooms across on a phone held in one hand, more as the screen
          allows it. The gap is deliberate rather than decorative: adjacent
          large targets with no space between them are how a thumb marks the
          wrong room clean. */}
      <ul className="mt-rhythm-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xl">{tile.roomNumber}</span>
        <span className="text-muted-foreground text-xs tracking-caps uppercase">
          {tile.roomTypeLabel}
        </span>
      </span>

      <span className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span>{tile.conditionLabel}</span>
        <span className="text-muted-foreground">{tile.occupancyLabel}</span>
      </span>

      <span className="text-muted-foreground mt-auto pt-2 text-xs">
        {tile.touchedLabel}
      </span>
    </>
  );

  // A room nobody may write from here. It is still on the grid — a floor with a
  // hole in it is a room nobody is accounted for — and it carries the reason it
  // is shut, which is the question the desk asks about it.
  if (next === null) {
    return (
      <div className="border-destructive text-destructive flex min-h-28 flex-col rounded-sm border border-l-2 p-3 text-left">
        {face}
        <span className="mt-1 text-xs">
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
        "border-border hover:bg-accent/60 focus-visible:bg-accent/60 flex min-h-28 w-full flex-col rounded-sm border p-3 text-left",
        // A room that cannot take a guest is shaded rather than coloured. The
        // grid is read at arm's length and the thing being looked for is the
        // work left, not a status word.
        tile.isReady ? "bg-card" : "bg-accent/40",
      )}
    >
      {face}
      <span className="mt-1 text-xs">{tile.advanceLabel}</span>
    </button>
  );
}
