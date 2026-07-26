// The matrix is a mirror of docs/architecture/rbac-matrix.md, and a mirror can
// be wrong in ways a compiler cannot see: a duplicated key, a row that grants
// `ADMIN` less than `MANAGER`, a row nobody can reach that nobody meant to make
// unreachable. Those are the checks here.
//
// What this file cannot check is that a row exists for every row of the
// document — no test can read prose and be sure. What it can do is make every
// *structural* rule in §2 mechanical, so the only thing left to human review is
// whether the grants themselves match, which is a line-by-line comparison a
// reviewer can actually perform.

import { describe, expect, it } from "vitest";
import { CAPABILITIES, capability } from "./matrix.js";
import { GRANTS, STAFF_ROLES } from "./roles.js";

describe("the RBAC matrix", () => {
  it("gives every capability a unique key", () => {
    const keys = CAPABILITIES.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every capability a section and a row label from the document", () => {
    for (const row of CAPABILITIES) {
      expect(row.section.length, row.key).toBeGreaterThan(0);
      expect(row.row.length, row.key).toBeGreaterThan(0);
    }
  });

  it("uses only the four defined grants", () => {
    for (const row of CAPABILITIES) {
      expect(GRANTS).toContain(row.guest);

      for (const role of STAFF_ROLES) {
        expect(GRANTS, `${row.key} / ${role}`).toContain(row.staff[role]);
      }
    }
  });

  // §2: "`ADMIN` ⊇ `MANAGER`." Fifty-four rows typed by hand is fifty-four
  // chances to break that quietly, and the break would only surface as a
  // manager doing something an administrator cannot.
  it("never gives MANAGER something ADMIN lacks", () => {
    for (const row of CAPABILITIES) {
      if (row.staff.MANAGER !== "denied") {
        expect(row.staff.ADMIN, row.key).not.toBe("denied");
      }
    }
  });

  // Exactly one row is public — the availability search a stranger performs
  // before they have any reason to have an account. A second one appearing is
  // worth a conversation, which is what a failing test is.
  it("marks exactly one row reachable without a session", () => {
    const open = CAPABILITIES.filter((row) => row.unauthenticated);

    expect(open.map((row) => row.key)).toEqual(["availability.search"]);
  });

  // "Delete ID scan" is granted to nobody on purpose: the R2 lifecycle rule is
  // the only path, and no manual one exists. Asserting it here keeps the row
  // from being read as an oversight and quietly "fixed".
  it("leaves ID scan deletion unreachable by every role", () => {
    const row = capability("guest.id-scan.delete");

    expect(row.guest).toBe("denied");

    for (const role of STAFF_ROLES) {
      expect(row.staff[role], role).toBe("denied");
    }
  });

  it("refuses to look up a capability that does not exist", () => {
    // @ts-expect-error — the point of the key union is that this is a compile
    // error; the runtime throw is the second line of defence for a key that
    // arrives as a string from somewhere the compiler cannot see.
    expect(() => capability("booking.invented")).toThrow(/Unknown capability/);
  });
});
