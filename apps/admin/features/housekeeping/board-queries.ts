/* The housekeeping board, read and written.
 *
 * This is the console's worked example of the data layer, written against the
 * two contract routes that already exist — `GET /housekeeping/board` and
 * `PUT /housekeeping/rooms/{roomNumber}/condition`. It is real: the screen that
 * draws the board will consume these hooks unchanged. It is here rather than in
 * `lib/` because a question belongs to the feature that asks it, and the shape
 * below — a hook per question, keys from the contract, an optimistic write, one
 * invalidation at the end — is the shape every other feature copies.
 */

"use client";

import type { ApiClient } from "@mariva/api-client";
import type { HousekeepingStatus } from "@mariva/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

/* The board's shapes, taken from the client rather than restated.
 *
 * `@mariva/shared` exports the Zod schemas and the API client is typed from
 * them, so reading the types back off the client is the same types by
 * construction — a hand-written `interface BoardRoom` here would be a second
 * opinion that compiles until the day it is wrong. */
export type HousekeepingBoard = Awaited<
  ReturnType<ApiClient["housekeeping"]["board"]>
>;
export type BoardRoom = HousekeepingBoard["rooms"][number];
export type BoardQuery = Parameters<ApiClient["housekeeping"]["board"]>[0];
export type SetConditionInput = Parameters<
  ApiClient["housekeeping"]["setCondition"]
>[0];

/**
 * A room a guest may be walked into — `booking-state-machine.md` §4's guard.
 *
 * Needed here because the optimistic write below has to produce the whole tile
 * the API would have produced, and `isReady` is a field the API derives rather
 * than one the caller sends. `INSPECTED` is ready as well as `CLEAN`: the
 * supervisor pass is optional and a property that does not run it must still be
 * able to check anybody in.
 */
const READY_STATUSES: ReadonlySet<HousekeepingStatus> = new Set([
  "CLEAN",
  "INSPECTED",
]);

/**
 * The board for a day, or for the property's own day when none is given.
 *
 * `businessDate` is left optional exactly as the contract leaves it: the 04:00
 * rollover is the API's rule, and a console computing its own answer would draw
 * a board against a different day than the desk is working.
 */
export function useHousekeepingBoard(query: BoardQuery = {}) {
  return useQuery(
    orpc.housekeeping.board.queryOptions({
      input: query,
      meta: {
        errorMessage: "The housekeeping board could not be loaded.",
      } satisfies ConsoleMeta,
    }),
  );
}

/**
 * Records that a room has been cleaned, or inspected, or dirtied.
 *
 * ## The optimistic pattern, which every console mutation follows
 *
 * A housekeeper on a phone in a corridor taps a room and walks to the next one.
 * Waiting for a round trip before the tile changes makes the board feel broken
 * on a floor with bad signal, so the tile is repainted immediately and the
 * server is caught up with afterwards. The four steps are the contract of the
 * pattern and none of them is optional:
 *
 * 1. **`onMutate` cancels first.** A board refetch already in flight would land
 *    after the optimistic write and paint the room back to how it was before the
 *    tap.
 * 2. **Snapshot before writing.** Every board in the cache is captured, not just
 *    the one currently on screen — an operator may have two days open.
 * 3. **Write the whole tile the API would have written.** Not just the field
 *    that was sent: `isReady` is derived, and a tile that showed `DIRTY` and
 *    `isReady` at once for one second is a check-in button that flickers.
 * 4. **`onError` restores the snapshot, `onSettled` invalidates.** The restore
 *    is why an optimistic write is safe; the invalidation is why the tile ends
 *    up carrying what the server actually recorded — `updatedAt` and `updatedBy`
 *    are the API's to decide and the guess above cannot produce them.
 *
 * The failure is not reported here. `lib/query-client.ts` raises a toast for
 * every mutation error centrally, so this handler's whole job is putting the
 * cache back.
 */
export function useSetRoomCondition() {
  const queryClient = useQueryClient();
  const boardKey = orpc.housekeeping.board.key();

  return useMutation(
    orpc.housekeeping.setCondition.mutationOptions({
      meta: {
        errorMessage: "The room's condition could not be recorded.",
      } satisfies ConsoleMeta,

      onMutate: async (input: SetConditionInput) => {
        await queryClient.cancelQueries({ queryKey: boardKey });

        const snapshot = queryClient.getQueriesData<HousekeepingBoard>({
          queryKey: boardKey,
        });

        queryClient.setQueriesData<HousekeepingBoard>(
          { queryKey: boardKey },
          (board) => (board ? withRoomCondition(board, input) : board),
        );

        return { snapshot };
      },

      onError: (_error, _input, context) => {
        for (const [key, board] of context?.snapshot ?? []) {
          queryClient.setQueryData(key, board);
        }
      },

      onSettled: () => {
        // Only the board. Room condition is not money and not a stay — nothing
        // on a folio or a booking moves because a room was cleaned — so
        // invalidating wider would refetch screens this act cannot have changed.
        void queryClient.invalidateQueries({ queryKey: boardKey });
      },
    }),
  );
}

/** The board as it will read once the API has accepted the write. Pure, so the
 *  guess the optimistic step paints is the one thing that can be reasoned about
 *  without a cache in the way. */
export function withRoomCondition(
  board: HousekeepingBoard,
  input: SetConditionInput,
): HousekeepingBoard {
  return {
    ...board,
    rooms: board.rooms.map((room) =>
      room.roomNumber === input.roomNumber
        ? {
            ...room,
            status: input.status,
            isReady: READY_STATUSES.has(input.status),
          }
        : room,
    ),
  };
}
