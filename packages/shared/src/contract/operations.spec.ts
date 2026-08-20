// What the desk may say about its own drawer, and the four things it may not.
//
// The refusals under test are the ones a reader cannot see by looking at the
// shapes, and each is a figure that would otherwise be taken on trust from
// whoever typed it.
//
// The first is the variance. `schema/shift.ts` refuses the column and this
// contract refuses the field, so a close that carries one has to come out the
// far side without it — a schema that started accepting it would read exactly
// like a working one until a drawer reported itself square.
//
// The second is the shift a pending item is raised against. It is the caller's
// own open one, and a body that could name another would file a finding against
// a drawer that never saw it.
//
// The third is that money arrives as text and leaves as đồng, because that
// crossing is the one `money.ts` says cannot be made by a JSON number, and a
// negative count is not a quantity of cash.
//
// The fourth is that the backlog filter is a named member rather than a flag.
// "false" in a query string is a true boolean under most coercions, and the
// shift inheriting that mistake is handed a list of work already done.

import { describe, expect, it } from "vitest";
import {
  closeShiftInput,
  LONGEST_HANDOVER_NOTE,
  LONGEST_PENDING_ITEM,
  listPendingItemsInput,
  listShiftHistoryInput,
  openShiftInput,
  raisePendingItemInput,
} from "./operations.js";

/** A close the schema is otherwise happy with, so one field is under test at a
 *  time. Text on the way in, per `money.ts`. */
const A_CLOSE = {
  shiftId: "0d1a3f5c-4b8e-4a2d-9c1f-6e7b8a9d0c11",
  closingCount: "3450000",
};

describe("opening a drawer", () => {
  it("takes the đồng counted in as text and hands back an amount", () => {
    const opened = openShiftInput.parse({ openingFloat: "500000" });

    expect(opened.openingFloat).toBe(500_000n);
  });

  it("takes an empty drawer, which is a count and not a missing one", () => {
    expect(openShiftInput.parse({ openingFloat: "0" }).openingFloat).toBe(0n);
  });

  it("refuses a float below nothing", () => {
    const refused = openShiftInput.safeParse({ openingFloat: "-1" });

    expect(refused.success).toBe(false);
  });

  it("refuses a drawer opened without a count", () => {
    // The figure every variance on the shift is computed from. Absent, there is
    // nothing to hold the closing count against, and no later act can supply
    // what was in the drawer at eight o'clock this morning.
    expect(openShiftInput.safeParse({}).success).toBe(false);
  });

  it("takes no operator, so a drawer cannot be opened in another name", () => {
    const opened = openShiftInput.parse({
      openingFloat: "500000",
      operatorId: "0d1a3f5c-4b8e-4a2d-9c1f-6e7b8a9d0c11",
    });

    expect(opened).not.toHaveProperty("operatorId");
  });
});

describe("closing a drawer", () => {
  it("takes the count and the sentence the next shift needs", () => {
    const closed = closeShiftInput.parse({
      ...A_CLOSE,
      handoverNote: "Safe key with the manager. 305 says the kettle leaks.",
    });

    expect(closed.closingCount).toBe(3_450_000n);
    expect(closed.handoverNote).toBe(
      "Safe key with the manager. 305 says the kettle leaks.",
    );
  });

  it("takes a close with nothing to hand over", () => {
    expect(closeShiftInput.safeParse(A_CLOSE).success).toBe(true);
  });

  it("refuses a count below nothing", () => {
    const refused = closeShiftInput.safeParse({
      ...A_CLOSE,
      closingCount: "-500",
    });

    expect(refused.success).toBe(false);
  });

  it("refuses a close that counted nothing at all", () => {
    // A shift is closed exactly when it was counted, and the count is what the
    // whole act exists to record.
    const refused = closeShiftInput.safeParse({ shiftId: A_CLOSE.shiftId });

    expect(refused.success).toBe(false);
  });

  it("keeps no variance the closing receptionist declared", () => {
    // The figure is the property's arithmetic and never the caller's. A shape
    // that carried it through would let the person who counted the drawer say
    // what it was out by.
    const closed = closeShiftInput.parse({
      ...A_CLOSE,
      variance: "0",
      cashTaken: "2950000",
    });

    expect(closed).not.toHaveProperty("variance");
    expect(closed).not.toHaveProperty("cashTaken");
  });

  it("refuses a note of nothing but whitespace", () => {
    // Which reads to the next shift as a note nobody wrote — the absence
    // already says that, and says it without a row of spaces on the screen.
    const refused = closeShiftInput.safeParse({
      ...A_CLOSE,
      handoverNote: "   ",
    });

    expect(refused.success).toBe(false);
  });

  it("refuses a note longer than anybody taking the desk will read", () => {
    const refused = closeShiftInput.safeParse({
      ...A_CLOSE,
      handoverNote: "n".repeat(LONGEST_HANDOVER_NOTE + 1),
    });

    expect(refused.success).toBe(false);
  });
});

describe("reading the desk back", () => {
  it("fills in a page for a caller that named none", () => {
    const query = listShiftHistoryInput.parse({});

    expect(query.limit).toBe(50);
    expect(query.offset).toBe(0);
  });

  it("refuses a span that ends before it starts", () => {
    const refused = listShiftHistoryInput.safeParse({
      from: "2026-08-14",
      to: "2026-08-01",
    });

    expect(refused.success).toBe(false);
    expect(refused.error?.issues.some((issue) => issue.path[0] === "to")).toBe(
      true,
    );
  });

  it("takes a single day named at both ends", () => {
    // Inclusive of both, so one trading day is asked for by naming it twice
    // rather than by naming the day after it.
    expect(
      listShiftHistoryInput.safeParse({ from: "2026-08-14", to: "2026-08-14" })
        .success,
    ).toBe(true);
  });

  it("refuses a page wider than the screen will draw", () => {
    expect(listShiftHistoryInput.safeParse({ limit: 201 }).success).toBe(false);
  });
});

describe("what one shift leaves the next", () => {
  it("takes the finding in the words of whoever found it", () => {
    const raised = raisePendingItemInput.parse({
      description: "  305 deposit not receipted  ",
    });

    expect(raised.description).toBe("305 deposit not receipted");
  });

  it("refuses an item that says nothing", () => {
    // A row that exists only to be counted is a number with no task behind it,
    // and the shift inheriting it cannot act on it.
    expect(
      raisePendingItemInput.safeParse({ description: "   " }).success,
    ).toBe(false);
  });

  it("refuses an item longer than a glance", () => {
    expect(
      raisePendingItemInput.safeParse({
        description: "n".repeat(LONGEST_PENDING_ITEM + 1),
      }).success,
    ).toBe(false);
  });

  it("keeps no raising shift the caller supplied", () => {
    // The raiser is the drawer the caller is standing at. A named one could be
    // a closed shift, or somebody else's.
    const raised = raisePendingItemInput.parse({
      description: "Spare key with the manager",
      raisedByShiftId: "0d1a3f5c-4b8e-4a2d-9c1f-6e7b8a9d0c11",
    });

    expect(raised).not.toHaveProperty("raisedByShiftId");
  });

  it("asks for the backlog when nobody said which items", () => {
    // The question every incoming shift asks, and the one the unresolved index
    // is built for.
    expect(listPendingItemsInput.parse({}).state).toBe("OUTSTANDING");
  });

  it("refuses a flag where a named state belongs", () => {
    // "false" is the string a query string carries, and the coercion that reads
    // it as true would hand the next shift a list of work already done.
    expect(listPendingItemsInput.safeParse({ state: "false" }).success).toBe(
      false,
    );

    expect(listPendingItemsInput.safeParse({ state: true }).success).toBe(
      false,
    );
  });

  it("reads a limit that arrived as query text", () => {
    const query = listPendingItemsInput.parse({ limit: "25", offset: "50" });

    expect(query.limit).toBe(25);
    expect(query.offset).toBe(50);
  });
});
