/* The rooms screen's one read and its two writes.
 *
 * **The read is the housekeeping board.** There is no room and no room-type read
 * route in the contract, and the board is the one call that answers every room of
 * the property — its number, its floor, what it is sold as, and the state it is
 * in. So this screen shares a cache entry with the housekeeping grid and with the
 * two desk queues, which is also why moving a room here is seen there without a
 * second request.
 *
 * **The two writes are deliberately not one.** `housekeeping.setOutOfOrder` is
 * room state and moves no counter; `inventory.closeRoom` withdraws nights from
 * sale and moves nothing about the room. `FR-HK-02` exists because the two have
 * been conflated often enough to be worth naming, and what that separation means
 * for a cache is below: one invalidates the board and the other does not touch
 * it.
 *
 * Nothing here reports its own failure — `lib/query-client.ts` raises the toast
 * for every read and every write centrally.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { HousekeepingBoard } from "@/features/housekeeping";
import { useHousekeepingBoard } from "@/features/housekeeping";
import { orpc } from "@/lib/api-query";
import type { ConsoleMeta } from "@/lib/query-client";

import {
  type RoomTypeGroup,
  roomsByType,
  type SetOutOfOrderInput,
  withOutOfOrder,
} from "./room-list";

/** What the screen knows about the list it is drawing. */
export type ListReading =
  | { readonly status: "pending" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly groups: readonly RoomTypeGroup[] };

/** The whole screen's data layer: the property's day and its rooms by type. */
export interface RoomsData {
  /** The day the board answered against, once it has. Every relative date the
   *  closure form takes is counted from it. */
  readonly businessDate: string | null;
  readonly list: ListReading;
}

/**
 * The property's rooms, grouped by what they are sold as.
 *
 * Memoized on the answer rather than recomputed per render: the groups are what
 * the roving list is drawn from, and a fresh array on every render is a list
 * rebuilt underneath the operator's arrow keys.
 */
export function useRoomList(): RoomsData {
  const board = useHousekeepingBoard();

  const groups = useMemo(
    () =>
      board.data === undefined ? undefined : roomsByType(board.data.rooms),
    [board.data],
  );

  return {
    businessDate: board.data?.businessDate ?? null,
    list: listReading(board.isError, groups),
  };
}

function listReading(
  failed: boolean,
  groups: readonly RoomTypeGroup[] | undefined,
): ListReading {
  if (failed) {
    return { status: "failed" };
  }

  return groups === undefined
    ? { status: "pending" }
    : { status: "ready", groups };
}

/**
 * Takes a room out of order, or puts it back — room state only.
 *
 * Optimistic, in the four steps `board-queries.ts` states and for the same
 * reason: the operator is on the telephone to maintenance while they press it,
 * and the guess is the whole tile the API would have written rather than the one
 * field that was sent — `isReady` is derived, and a room reading `OUT_OF_ORDER`
 * and ready at once for one second is a check-in button that flickers.
 * {@link withOutOfOrder} owns the guess and is specified on its own.
 *
 * One invalidation, and it is the board: this write moves no inventory counter,
 * so nothing about what a guest can buy has changed, and invalidating wider
 * would refetch screens this act cannot have touched.
 */
export function useSetOutOfOrder() {
  const queryClient = useQueryClient();
  const boardKey = orpc.housekeeping.board.key();

  return useMutation(
    orpc.housekeeping.setOutOfOrder.mutationOptions({
      meta: {
        errorMessage: "The room's out-of-order state could not be recorded.",
      } satisfies ConsoleMeta,

      onMutate: async (input: SetOutOfOrderInput) => {
        // A refetch already in flight would land after the optimistic write and
        // paint the room back to how it was before the press.
        await queryClient.cancelQueries({ queryKey: boardKey });

        const snapshot = queryClient.getQueriesData<HousekeepingBoard>({
          queryKey: boardKey,
        });

        queryClient.setQueriesData<HousekeepingBoard>(
          { queryKey: boardKey },
          (board) => (board ? withOutOfOrder(board, input) : board),
        );

        return { snapshot };
      },

      onError: (_error, _input, context) => {
        for (const [key, board] of context?.snapshot ?? []) {
          queryClient.setQueryData(key, board);
        }
      },

      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: boardKey });
      },
    }),
  );
}

/**
 * Withdraws a room from sale for a range of nights — `FR-INV-04`.
 *
 * Not optimistic, and it invalidates nothing. A closure changes `type_inventory`
 * and touches no room's condition, so the board this screen is drawn from is the
 * same board afterwards; the only read in the console a closure could stale is
 * one of sellable inventory, and no screen in the console asks that yet. Writing
 * an invalidation for a query nobody holds would be a claim about a cache entry
 * that does not exist, and the response the caller shows is the API's own count
 * of the nights it took.
 *
 * The id comes back and is not kept. Lifting a closure is `DELETE
 * /inventory/room-closures/{id}`, and the contract has no route that lists
 * closures — so an "undo" held in this component's state would work until the
 * operator reloaded and then quietly stop existing, which is worse than a screen
 * that does not claim to offer it.
 */
export function useCloseRoom() {
  return useMutation(
    orpc.inventory.closeRoom.mutationOptions({
      meta: {
        errorMessage: "The closure could not be scheduled.",
      } satisfies ConsoleMeta,
    }),
  );
}
