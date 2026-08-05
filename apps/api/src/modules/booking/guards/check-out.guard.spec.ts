// §4's folio-settled guard, at zero and on both sides of it. The negative case
// is not symmetry for its own sake: an overpaid guest is owed a refund at the
// desk, and §4 says "Balance ≠ 0" rather than "> 0" precisely so a check-out
// cannot close over money the property is still holding.

import type { CheckOutRefusal } from "@mariva/shared";
import { ORPCError } from "@orpc/nest";
import { describe, expect, it } from "vitest";
import { FolioStubService } from "../ports/folio-stub.service.js";
import { validateFolioSettled } from "./check-out.guard.js";

describe("the folio-settled guard", () => {
  it("admits a balanced folio", () => {
    expect(() => validateFolioSettled(0n)).not.toThrow();
  });

  it.each([
    ["outstanding", 1_250_000n],
    ["overpaid", -1_250_000n],
    ["one đồng short", 1n],
  ])("refuses a folio that is %s", (_case, balance) => {
    let thrown: unknown;
    try {
      validateFolioSettled(balance);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ORPCError);
    const orpc = thrown as ORPCError<string, { code: CheckOutRefusal }>;
    expect(orpc.code).toBe("CONFLICT");
    expect(orpc.data.code).toBe("FOLIO_NOT_SETTLED");
    // The desk is told the figure, not just that there is one.
    expect(orpc.message).toContain("balance");
  });
});

describe("the M4 folio stub", () => {
  // `M6` replaces the binding in `booking.module.ts`, not this class. Until it
  // does, there is no ledger to owe anything to — see `folio-stub.service.ts`.
  it("reports every folio settled, so the guard admits it", async () => {
    const balance = await new FolioStubService().getBalance(
      "8f2a5c1e-0000-4000-8000-000000000003",
    );

    expect(balance).toBe(0n);
    expect(() => validateFolioSettled(balance)).not.toThrow();
  });
});
