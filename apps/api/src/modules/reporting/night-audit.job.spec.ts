// That a business date is closed exactly once, that closing it twice is not
// something the sweep has to remember not to do, and that a day it cannot close
// honestly it does not close at all.
//
// `FR-RPT-01`'s acceptance is "runs exactly once per business date", and
// `job-runner.service.ts` tests that property by running every sweep a second
// time inside the same transaction and requiring the second pass to come back
// empty. The stand-in below is therefore not a general database: it is the
// primary key on `night_audit_snapshot` and nothing else, because that key is
// the entire mechanism. A second insert of a day already frozen returns no row,
// the freeze answers `false`, and the day is not closed again — which is what
// the suite holds the sweep to, from both directions: the runner's two passes
// inside one transaction, and a manager re-running the night hours later.
//
// The second suite is the ordering `FR-RPT-01` states as a sequence. Room
// charges are posted and *then* the day is frozen, and the two are inside one
// transaction, so a snapshot can never be a figure taken before the night's rent
// reached the accounts. What proves it is the order the two arrive in below,
// because that is the only observable difference between a correct audit and one
// that freezes a day short by every night the hourly sweep had not got to.
//
// The third is the case the seven-day look-back opened. A day closed late has
// stays that occupied it and have since checked out, and nothing can charge them
// — so the audit refuses the date rather than freezing a room revenue that is
// permanently short, and the days behind it are closed regardless. Both halves
// matter: a guard that refused the whole backlog over one bad morning would be a
// worse failure than the one it prevents.

import "reflect-metadata";

import { parseDate } from "@internationalized/date";
import type { StayDate } from "@mariva/shared";
import type { PinoLogger } from "nestjs-pino";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import { booking } from "../../database/schema/booking.js";
import { typeInventory } from "../../database/schema/inventory.js";
import {
  nightAuditSnapshot,
  nightAuditSnapshotType,
} from "../../database/schema/night-audit.js";
import type { RoomChargeSweep } from "../folio/room-charge-sweep.js";
import type {
  OpsAlert,
  OpsAlertService,
} from "../notification/ops-alert.service.js";
import { NightAuditJob } from "./night-audit.job.js";
import { NightAuditService } from "./night-audit.service.js";

/** The day the property is having when the sweep runs, and never closes. */
const TODAY = parseDate("2027-11-04");

/** The one closed day the sweep below finds outstanding. */
const LAST_NIGHT = TODAY.subtract({ days: 1 });

/** The day before that, used where a backlog of two is what is under test. */
const THE_NIGHT_BEFORE = TODAY.subtract({ days: 2 });

/**
 * The days in the look-back window that are already frozen.
 *
 * `night-audit.job.ts` looks back seven days, so leaving the older ones on file
 * makes the gap exactly as wide as a case needs — one night by default, and two
 * where a backlog is the point.
 */
const ALREADY_CLOSED = [7, 6, 5, 4, 3, 2].map((back) =>
  TODAY.subtract({ days: back }).toString(),
);

const DELUXE = "room-type-deluxe";

describe("closing a business date", () => {
  it("freezes the day that ended and leaves the day being traded alone", async () => {
    const books = openBooks();

    const { closed } = await audit(books);

    expect(closed).toEqual([LAST_NIGHT.toString()]);
    expect(books.snapshots.get(LAST_NIGHT.toString())).toEqual({
      sellableRooms: 20,
      roomsSold: 1,
      netRoomRevenueVnd: 1_000_000n,
      otherRevenueVnd: 0n,
    });

    // The day the property is currently having has room charges still to post
    // and corrections still to make. A snapshot of it would be a figure the
    // evening then walks away from.
    expect(books.snapshots.has(TODAY.toString())).toBe(false);
  });

  it("writes the per-type rows beside it, so the KPIs have a denominator", async () => {
    const books = openBooks();

    await audit(books);

    expect(books.types).toEqual([
      {
        businessDate: LAST_NIGHT.toString(),
        roomTypeId: DELUXE,
        sellableRooms: 20,
        roomsSold: 1,
        netRoomRevenueVnd: 1_000_000n,
      },
    ]);
  });

  it("does nothing on the runner's second pass over the same transaction", async () => {
    const books = openBooks();

    // Exactly what `JobRunner` does when a sweep touched anything: the same
    // sweep, the same executor, the same date, before the commit.
    const { closed, again } = await audit(books, { twice: true });

    expect(closed).toEqual([LAST_NIGHT.toString()]);
    expect(again).toEqual([]);
    expect(books.snapshots.size).toBe(ALREADY_CLOSED.length + 1);
    expect(books.types).toHaveLength(1);
  });

  it("refuses the second freeze at the key, not at a look it took first", async () => {
    // The predicate is bypassed by handing the service a date that is already on
    // file, which is the state a race would produce between the read and the
    // insert. The insert is what refuses it, so no second snapshot is written
    // and no second set of type rows lands under the first.
    const books = openBooks();

    await new NightAuditService().freeze(books.executor, LAST_NIGHT);

    expect(
      await new NightAuditService().freeze(books.executor, LAST_NIGHT),
    ).toBe(false);
    expect(books.types).toHaveLength(1);
  });
});

describe("the night's rent and the freeze", () => {
  it("posts the room charges for the closing day before it freezes it", async () => {
    const books = openBooks();

    await audit(books);

    // Both, in this order, and over the day being closed rather than the day
    // being traded. A charge posted after the snapshot would be money on a night
    // the property has already reported.
    expect(books.order).toEqual([
      `charged ${LAST_NIGHT.toString()}`,
      `froze ${LAST_NIGHT.toString()}`,
    ]);
  });
});

describe("a day that would freeze short", () => {
  it("is not frozen, and somebody is woken about it", async () => {
    // A stay that occupied the night and carries no room charge for it. On the
    // ordinary path the sweep above has just charged it; here it cannot be
    // charged at all, which is what a day closed late looks like.
    const books = openBooks({
      uncharged: new Map([[LAST_NIGHT.toString(), ["a-departed-stay"]]]),
    });

    const { closed, paged } = await audit(books);

    expect(closed).toEqual([]);
    expect(books.snapshots.has(LAST_NIGHT.toString())).toBe(false);
    expect(books.types).toEqual([]);

    expect(paged).toHaveLength(1);
    expect(paged[0]?.kind).toBe("night-audit-day-would-freeze-short");
    expect(paged[0]?.details.businessDate).toBe(LAST_NIGHT.toString());
    expect(paged[0]?.details.naming).toBe("a-departed-stay");
    // The sentence has to say what a responder does next, because a day left
    // open is only recoverable while somebody knows it is open.
    expect(paged[0]?.text).toContain("re-run the night audit");
  });

  it("does not stop the days behind it from closing", async () => {
    // Two outstanding nights, the older of them unclosable. A guard that threw
    // would take the whole backlog down with it, which is a worse failure than
    // the one it exists to prevent.
    const books = openBooks({
      alreadyClosed: ALREADY_CLOSED.slice(0, -1),
      uncharged: new Map([[THE_NIGHT_BEFORE.toString(), ["a-departed-stay"]]]),
    });

    const { closed, paged } = await audit(books);

    expect(closed).toEqual([LAST_NIGHT.toString()]);
    expect(books.snapshots.has(THE_NIGHT_BEFORE.toString())).toBe(false);
    expect(paged).toHaveLength(1);
  });

  it("pages once per run, not once per pass", async () => {
    // The run above froze a day, so `JobRunner` calls the sweep a second time
    // inside the same transaction. The refused date is refused again — and one
    // incident reaching whoever is on call as two is the thing the mark keeps
    // from happening.
    const books = openBooks({
      alreadyClosed: ALREADY_CLOSED.slice(0, -1),
      uncharged: new Map([[THE_NIGHT_BEFORE.toString(), ["a-departed-stay"]]]),
    });

    const { again, paged } = await audit(books, { twice: true });

    expect(again).toEqual([]);
    expect(paged).toHaveLength(1);
  });
});

/**
 * One run of the sweep over these books, and everything it did.
 *
 * `twice` is the runner's second pass: the same sweep instance, the same
 * executor and the same date, which is the only arrangement that tests
 * idempotency rather than describing it.
 */
async function audit(
  books: TheDaysBooks,
  { twice = false }: { twice?: boolean } = {},
) {
  const paged: OpsAlert[] = [];

  const job = new NightAuditJob(
    {
      // The date is recorded here rather than read out of a predicate, and the
      // coupling is the sweep's own: it charges a date and then asks about that
      // same date, so this is what tells the books which night is being worked.
      run: async (_exec: DbExecutor, businessDate: StayDate) => {
        books.working = businessDate.toString();
        books.order.push(`charged ${businessDate.toString()}`);

        return await Promise.resolve([]);
      },
    } as unknown as RoomChargeSweep,
    new NightAuditService(),
    {
      page: async (alert: OpsAlert) => {
        paged.push(alert);

        return await Promise.resolve(true);
      },
    } as unknown as OpsAlertService,
    {
      setContext: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as PinoLogger,
  );

  const closed = await job.run(books.executor, TODAY);
  const again = twice ? await job.run(books.executor, TODAY) : [];

  return { closed, again, paged };
}

/** One Deluxe night, charged and standing, on the day that closed. */
function openBooks({
  alreadyClosed = ALREADY_CLOSED,
  uncharged = new Map<string, readonly string[]>(),
}: {
  alreadyClosed?: readonly string[];
  uncharged?: ReadonlyMap<string, readonly string[]>;
} = {}): TheDaysBooks {
  return new TheDaysBooks(
    alreadyClosed,
    [
      {
        postingId: "the-night",
        bookingId: "a-stay",
        roomTypeId: DELUXE,
        amount: 1_000_000n,
        type: "ROOM_CHARGE",
        reversesPostingId: null,
        reversedType: null,
      },
    ],
    uncharged,
  );
}

/** A frozen day, as the parent row holds it. */
interface Frozen {
  readonly sellableRooms: number;
  readonly roomsSold: number;
  readonly netRoomRevenueVnd: bigint;
  readonly otherRevenueVnd: bigint;
}

/**
 * The statements one run issues, and the one guarantee that matters.
 *
 * The primary key on `night_audit_snapshot` is kept and nothing else is: the
 * predicates are not read, because which days are outstanding, which stays are
 * uncharged and which lines are revenue are exactly what the sweep and the
 * roll-up are being asked, and a stand-in that filtered here would be answering
 * instead of them.
 *
 * `insert … on conflict do nothing … returning` is the whole of the idempotency
 * mechanism, so it is the one thing modelled faithfully — a day already on file
 * returns no row, which is what tells the service it did not close anything.
 */
class TheDaysBooks {
  readonly snapshots = new Map<string, Frozen>();
  readonly types: Record<string, unknown>[] = [];

  /** What the run did and in which order, for the sequencing assertion. */
  readonly order: string[] = [];

  /** The night currently being worked, set by the room-charge stand-in. */
  working = "";

  constructor(
    alreadyClosed: readonly string[],
    private readonly postings: readonly Record<string, unknown>[],
    private readonly uncharged: ReadonlyMap<string, readonly string[]>,
  ) {
    for (const businessDate of alreadyClosed) {
      this.snapshots.set(businessDate, {
        sellableRooms: 0,
        roomsSold: 0,
        netRoomRevenueVnd: 0n,
        otherRevenueVnd: 0n,
      });
    }
  }

  get executor(): DbExecutor {
    return this as unknown as DbExecutor;
  }

  select() {
    return {
      from: (table: unknown) => {
        const rows = async () => await Promise.resolve(this.rowsOf(table));

        // A statement ends at `where` or at `orderBy` depending on which one it
        // is, so the answer is both awaitable and orderable.
        const answered = {
          orderBy: rows,
          then: (
            resolve: (rows: readonly unknown[]) => unknown,
            reject: (error: unknown) => unknown,
          ) => rows().then(resolve, reject),
        };

        const chain = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => answered,
        };

        return chain;
      },
    };
  }

  insert(table: unknown) {
    if (table === nightAuditSnapshotType) {
      return {
        values: async (rows: readonly Record<string, unknown>[]) => {
          this.types.push(...rows);

          await Promise.resolve();
        },
      };
    }

    return {
      values: (row: { businessDate: string } & Frozen) => ({
        onConflictDoNothing: () => ({
          returning: async () => await Promise.resolve(this.freeze(row)),
        }),
      }),
    };
  }

  private rowsOf(table: unknown): readonly unknown[] {
    if (table === nightAuditSnapshot) {
      return [...this.snapshots.keys()].map((businessDate) => ({
        businessDate,
      }));
    }

    if (table === typeInventory) {
      return [{ roomTypeId: DELUXE, sellableRooms: 20 }];
    }

    if (table === booking) {
      return (this.uncharged.get(this.working) ?? []).map((id) => ({ id }));
    }

    return this.postings;
  }

  private freeze(row: { businessDate: string } & Frozen) {
    if (this.snapshots.has(row.businessDate)) {
      return [];
    }

    this.snapshots.set(row.businessDate, {
      sellableRooms: row.sellableRooms,
      roomsSold: row.roomsSold,
      netRoomRevenueVnd: row.netRoomRevenueVnd,
      otherRevenueVnd: row.otherRevenueVnd,
    });

    this.order.push(`froze ${row.businessDate}`);

    return [{ businessDate: row.businessDate }];
  }
}
