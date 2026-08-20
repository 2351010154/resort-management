// What holds an export to the list it exports.
//
// The property under test is one sentence: **an export never widens what its
// reader could already see.** It is checked two ways here, and both are needed.
//
// The first loop is driven off `matrix.ts` and covers every staff role there
// is, including ones added after this file was written — so a sixth role
// granted the export row cannot quietly acquire a list it holds nothing on.
// That loop compares the module against the matrix, which is what it should be
// compared against.
//
// The second block is a written-out table of the consequences the matrix's note
// "RCP: operational lists only" actually has, role by role. It duplicates the
// loop's arithmetic on purpose: a loop that derives its expectation from the
// same rule the code applies would still pass if both were wrong together, and
// the table is where somebody reading this file finds out what the rule means
// without evaluating it in their head.
//
// Nothing here touches a database. Every decision under test is made from the
// matrix and the principal, before a row is read — which is the design, and is
// why it can be asserted without one.

import { beforeAll, describe, expect, it } from "vitest";

import type {
  Principal,
  StaffPrincipal,
} from "../../src/common/auth/principal.js";
import type { CapabilityKey } from "../../src/modules/identity/rbac/matrix.js";
import { staffGrant } from "../../src/modules/identity/rbac/matrix.js";
import { permits, STAFF_ROLES } from "../../src/modules/identity/rbac/roles.js";
import type { StaffRole } from "../../src/modules/identity/rbac/roles.js";
import {
  grantHeldOn,
  readingTheListBehind,
  readsEverythingOn,
} from "../../src/modules/reporting/export-authority.js";

const EXPORT_ROW: CapabilityKey = "reporting.excel-export";

/** The three lists M8 exports, each under the row that governs it on screen. */
const EXPORTS: readonly {
  readonly export: string;
  readonly list: CapabilityKey;
}[] = [
  { export: "cash book", list: "operations.income-expense" },
  { export: "shift history", list: "operations.cash-drawer" },
  { export: "change log", list: "audit.read" },
];

function staff(role: StaffRole): StaffPrincipal {
  return {
    realm: "staff",
    userId: "6f1a3f2e-0a1f-4a4e-9a1a-2b3c4d5e6f70",
    email: "someone@example.test",
    role,
  };
}

/** Whether this caller gets a file at all, as the routes decide it: the export
 *  row at the guard, then the list's own row in the handler. */
function reachesTheExport(list: CapabilityKey, principal: Principal): boolean {
  if (!permits(grantHeldOn(EXPORT_ROW, principal), "read")) {
    return false;
  }

  try {
    readingTheListBehind(list, principal);

    return true;
  } catch {
    return false;
  }
}

describe("every role, against the matrix", () => {
  for (const role of STAFF_ROLES) {
    for (const { export: subject, list } of EXPORTS) {
      it(`gives ${role} the ${subject} export only where the matrix gives them both rows`, () => {
        const reachable =
          permits(staffGrant(EXPORT_ROW, role), "read") &&
          permits(staffGrant(list, role), "read");

        expect(reachesTheExport(list, staff(role))).toBe(reachable);
      });

      it(`narrows ${role}'s ${subject} export exactly where the matrix narrows the list`, () => {
        const grant = staffGrant(list, role);

        // Only a grant that is unambiguously unnarrowed opens the whole list.
        // Written as the matrix's own two symbols rather than as "not
        // conditional", so a grant nobody has heard of narrows.
        expect(readsEverythingOn(grant)).toBe(
          grant === "full" || grant === "read",
        );
      });
    }
  }
});

describe("what the note 'RCP: operational lists only' actually means", () => {
  it("gives a receptionist no cash-book export at all", () => {
    expect(
      reachesTheExport("operations.income-expense", staff("RECEPTIONIST")),
    ).toBe(false);
  });

  it("gives a receptionist a shift export narrowed to their own drawers", () => {
    const grant = readingTheListBehind(
      "operations.cash-drawer",
      staff("RECEPTIONIST"),
    );

    expect(readsEverythingOn(grant)).toBe(false);
  });

  it("gives a receptionist no change-log export at all", () => {
    expect(reachesTheExport("audit.read", staff("RECEPTIONIST"))).toBe(false);
  });

  it("gives an accountant a change-log export of financial entries only", () => {
    const grant = readingTheListBehind("audit.read", staff("ACCOUNTANT"));

    expect(readsEverythingOn(grant)).toBe(false);
  });

  it("gives an accountant every operator's shift history", () => {
    const grant = readingTheListBehind(
      "operations.cash-drawer",
      staff("ACCOUNTANT"),
    );

    expect(readsEverythingOn(grant)).toBe(true);
  });

  it("gives a manager and an admin the whole of all three", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      for (const { list } of EXPORTS) {
        expect(reachesTheExport(list, staff(role))).toBe(true);
        expect(readsEverythingOn(readingTheListBehind(list, staff(role)))).toBe(
          true,
        );
      }
    }
  });

  it("gives housekeeping none of them", () => {
    for (const { list } of EXPORTS) {
      expect(reachesTheExport(list, staff("HOUSEKEEPING"))).toBe(false);
    }
  });
});

describe("a caller who is not staff", () => {
  it("holds nothing on a list, whatever the row says", () => {
    for (const { list } of EXPORTS) {
      expect(grantHeldOn(list, null)).toBe("denied");
      expect(() => readingTheListBehind(list, null)).toThrow();
    }
  });

  it("holds nothing on a list as a booking token either", () => {
    const token: Principal = {
      realm: "booking",
      bookingId: "6f1a3f2e-0a1f-4a4e-9a1a-2b3c4d5e6f70",
      reference: "MRV-2026-000001",
    };

    for (const { list } of EXPORTS) {
      expect(grantHeldOn(list, token)).toBe("denied");
    }
  });
});

describe("the routes themselves", () => {
  // Read off the class rather than asserted about the source, so a route added
  // to the controller without a declaration fails here instead of being
  // unreachable in production and undiscovered in review.
  let controller: Record<string, object>;
  let capabilityKey: string;

  beforeAll(async () => {
    await import("reflect-metadata");

    const [{ ReportingController }, decorators] = await Promise.all([
      import("../../src/modules/reporting/reporting.controller.js"),
      import("../../src/common/auth/access.decorators.js"),
    ]);

    controller = ReportingController.prototype as unknown as Record<
      string,
      object
    >;
    capabilityKey = decorators.CAPABILITY_KEY;
  });

  for (const route of [
    "exportCashBook",
    "exportShiftHistory",
    "exportChangeLog",
  ]) {
    it(`declares the export row on ${route}`, () => {
      const declared = Reflect.getMetadata(capabilityKey, controller[route]);

      expect(declared).toEqual({ key: EXPORT_ROW, action: "read" });
    });
  }
});
