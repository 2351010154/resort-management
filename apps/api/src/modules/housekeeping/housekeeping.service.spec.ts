// The two refusals that happen before any SQL does.
//
// Both are asserted against an executor that throws on first touch, because the
// claim is not only "this is rejected" but "this is rejected without a round
// trip". A capability boundary enforced after the write has already begun is
// one that depends on the transaction being rolled back afterwards, and a
// blank reason reaching Postgres is a check violation surfacing as a fault
// where an answer belongs.
//
// Everything these two methods do afterwards is a statement, and is asserted
// against a real database in `test/housekeeping-service.e2e-spec.ts`.

import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../../database/database.module.js";
import {
  HousekeepingService,
  type RoomReadiness,
} from "./housekeeping.service.js";

// Any property read off it fails the test, so "the database was not reached" is
// a fact the assertion holds rather than something the test hopes for.
const NO_DATABASE = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(
        `the refusal reached the database — it read ${String(property)}`,
      );
    },
  },
) as DbExecutor;

const service = new HousekeepingService();

/** The refusal a call provoked. Fails the test if the service accepted it. */
async function refused(
  work: Promise<unknown>,
): Promise<ORPCError<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("the service accepted a call it should have refused");
}

describe("setting a room's condition", () => {
  it("refuses to take a room out of order", async () => {
    // A different capability governs that status — `housekeeping.set-out-of-order`
    // in the RBAC matrix — and a caller holding only this one would be writing
    // it through the wrong door. The type says so too; this is what says so at
    // runtime, where the value arrives from the wire.
    const refusal = await refused(
      service.setCondition(NO_DATABASE, {
        roomNumber: "301",
        status: "OUT_OF_ORDER" as RoomReadiness,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });
});

describe("taking a room out of order", () => {
  it("refuses a reason that was demanded and not given", async () => {
    const refusal = await refused(
      service.setOutOfOrder(NO_DATABASE, {
        roomNumber: "301",
        outOfOrder: true,
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });

  it("refuses a reason that is only whitespace", async () => {
    // What an empty form field arrives as. Storage refuses it too, and one
    // refusal is an answer while the other is a 500.
    const refusal = await refused(
      service.setOutOfOrder(NO_DATABASE, {
        roomNumber: "301",
        outOfOrder: true,
        reason: "   ",
      }),
    );

    expect(refusal.code).toBe("BAD_REQUEST");
  });
});
